// Feature 026 — Live-by-design verification conformance (@logic @property).
//
// AGENTS.md binds the methodology ("Real services always — never mock or fake");
// this scenario makes its one testable invariant executable, so a suite that is
// green while still carrying a forbidden double fails HERE instead of passing
// silently. We enumerate the test doubles in Jolly's verification layer (the
// step definitions and test support code) and assert none is forbidden: no fake
// CLI standing in for a real one (Stripe, Vercel, @saleor/configurator, the
// storefront CLI), no dummy or forced-safe credential, and no unroutable
// stand-in endpoint substituting for a real service. The single admissible
// double is one whose SITE is annotated `@exceptional-double` naming the
// unproducible condition it injects (an org at its environment limit; a
// deliberately unreachable service for a "stored, not verified" path) — every
// other failure is produced from real bad input, never doubled.
//
// This is a conformance invariant about the verification layer itself, so the
// "double" is detected by scanning that layer's source. The scanner excludes its
// own file so its detection-pattern literals are never self-flagged.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import { SEEDED_CREDENTIAL_VARS } from "../support/eval.ts";
import {
  type CloudEnvironment,
  environmentIdentities,
  leftoverTestEnvironments,
  listAllEnvironments,
  listOrganizations,
} from "../support/cloud.ts";
import { fullRegressionBudgetMs } from "../support/wake.ts";
import {
  type AffordanceSite,
  enumerateHarnessAffordances,
  findUnguardedHarnessAffordances,
} from "../support/harness-affordance-conformance.ts";
import type { InjectedSource } from "../support/module-conformance.ts";
import {
  collectExecutablePickles,
  enumerateCompositionSpies,
  findCompositionLaneViolations,
  type CompositionSpy,
  type PickleInfo,
} from "../support/composition-lane-conformance.ts";
import {
  enumerateProductionEnvReads,
  findEnvNamespaceViolations,
  type EnvRead,
  type EnvViolation,
} from "../support/env-namespace-conformance.ts";
import { makeNamespace } from "../support/sandbox.ts";
import {
  cachedStoreSpareNames,
  provisionSharedEnvironment,
  reclaimStaleResources,
  unreclaimedLeftovers,
} from "../support/provision.ts";

const TEST_LAYER_DIRS = [
  join(REPO_ROOT, "features", "step_definitions"),
  join(REPO_ROOT, "features", "support"),
];

/** This scanner's own file — excluded so its pattern literals aren't self-flagged. */
const SELF = join("features", "step_definitions", "026-live-by-design-verification.steps.ts");

type DoubleKind =
  | "fake-cli"
  | "dummy-or-forced-safe-credential"
  | "unroutable-endpoint"
  | "in-process-loopback"
  | "simulated-response";

interface DoubleHit {
  file: string; // repo-relative
  line: number; // 1-based
  kind: DoubleKind;
  text: string; // the offending source line, trimmed
  /** The condition named by an `@exceptional-double` annotation at/just above the site, if any. */
  justification?: string;
  /** The licensed @pipeline sandbox source run named by a `@golden-capture`
   * annotation at/just above the site, if any (feature 026's golden-capture
   * Rule: a canned response recorded mechanically from a real run, each capture
   * site naming its source run inline). */
  capture?: string;
}

// Signals of each forbidden-double category, matched against source lines. Tight
// tokens keep the scan faithful (it flags real doubles, not prose about them).
const SIGNALS: Array<{ kind: DoubleKind; re: RegExp }> = [
  // A fake CLI standing in for a real one: any import of a harness fake-CLI
  // module (the fake-CLI files themselves are flagged by filename, below).
  { kind: "fake-cli", re: /-cli-fake/ },
  // A dummy or forced-safe credential: the forced-safe env helper and the dummy
  // credential constants/literals it supplies.
  {
    kind: "dummy-or-forced-safe-credential",
    re: /\blogicSafeEnv\b|\bDUMMY\b|DO-NOT-VERIFY|dummyDoNotUse/,
  },
  // An unroutable stand-in endpoint substituting for a real service.
  { kind: "unroutable-endpoint", re: /\.invalid\b/ },
  // An in-process loopback HTTP server standing in for a real service (a Cloud
  // API / GraphQL / auth fixture answering the CLI's real request locally). Match
  // the call, not the bare `import { createServer }`.
  { kind: "in-process-loopback", re: /createServer\s*[(<]/ },
  // A simulated response injected in place of the real network resolution.
  { kind: "simulated-response", re: /mock-organizations/ },
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * The condition named by an `@exceptional-double` annotation at the given line
 * or in the six lines just above it (a multi-line justification comment names the
 * unproducible condition), or undefined when the site is not annotated. The text
 * after the marker is the named unproducible condition.
 */
function justificationAt(lines: string[], idx: number): string | undefined {
  for (let i = idx; i >= Math.max(0, idx - 6); i--) {
    const m = lines[i]?.match(/@exceptional-double:?\s*(.*)$/);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/**
 * The source run named by a `@golden-capture` annotation at the given line or
 * in the six lines just above it, or undefined when the site carries none. The
 * text after the marker names the licensed @pipeline sandbox run the capture
 * was recorded from.
 */
function captureSourceAt(lines: string[], idx: number): string | undefined {
  for (let i = idx; i >= Math.max(0, idx - 6); i--) {
    const m = lines[i]?.match(/@golden-capture:?\s*(.*)$/);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function enumerateDoubles(): DoubleHit[] {
  const hits: DoubleHit[] = [];
  for (const dir of TEST_LAYER_DIRS) {
    for (const file of listTsFiles(dir)) {
      const rel = relative(REPO_ROOT, file);
      if (rel === SELF) continue;
      const lines = readFileSync(file, "utf8").split("\n");

      // The existence of a fake-CLI module is itself a fake CLI standing in for
      // a real one — flag the file regardless of its content.
      if (/-cli-fake\.ts$/.test(basename(file))) {
        hits.push({
          file: rel,
          line: 1,
          kind: "fake-cli",
          text: `${basename(file)} (fake CLI module)`,
          justification: justificationAt(lines, 0),
          capture: captureSourceAt(lines, 0),
        });
      }

      lines.forEach((raw, idx) => {
        const trimmed = raw.trim();
        // Skip pure-comment / prose lines: the double lives in code; comments
        // explaining it must not be mistaken for it.
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const { kind, re } of SIGNALS) {
          if (re.test(raw)) {
            hits.push({
              file: rel,
              line: idx + 1,
              kind,
              text: trimmed,
              justification: justificationAt(lines, idx),
              capture: captureSourceAt(lines, idx),
            });
            break; // one classification per line is enough
          }
        }
      });
    }
  }
  return hits;
}

Given("Jolly's step definitions and test support code", function (this: JollyWorld) {
  // The verification layer under conformance: step definitions + test support.
  const files = TEST_LAYER_DIRS.flatMap(listTsFiles).map((f) => relative(REPO_ROOT, f));
  this.notes.testLayerFiles = files;
  assert.ok(
    files.length > 0,
    "the verification layer must contain step definitions and support code to inspect",
  );
});

When("the test doubles they use are enumerated", function (this: JollyWorld) {
  this.notes.doubleHits = enumerateDoubles();
});

Then(
  /^there should be no forbidden double — no fake CLI standing in for a real one \(Vercel, @saleor\/configurator, the storefront CLI\), no dummy or forced-safe credential, and no unroutable stand-in endpoint substituting for a real service$/,
  function (this: JollyWorld) {
    const hits = this.notes.doubleHits as DoubleHit[];
    // A double is forbidden unless its site is annotated @exceptional-double,
    // or is a golden capture whose site names its licensed source run.
    const forbidden = hits.filter(
      (h) => h.justification === undefined && h.capture === undefined,
    );
    if (forbidden.length === 0) return;

    const byKind = new Map<DoubleKind, DoubleHit[]>();
    for (const h of forbidden) {
      const list = byKind.get(h.kind) ?? [];
      list.push(h);
      byKind.set(h.kind, list);
    }
    const report = [...byKind.entries()]
      .map(([kind, list]) => {
        const files = [...new Set(list.map((h) => h.file))];
        const sample = list.slice(0, 6).map((h) => `      ${h.file}:${h.line}  ${h.text}`);
        const more = list.length > 6 ? [`      … and ${list.length - 6} more`] : [];
        return `  ${kind} — ${list.length} occurrence(s) across ${files.length} file(s):\n${[...sample, ...more].join("\n")}`;
      })
      .join("\n");

    assert.fail(
      `the verification layer carries ${forbidden.length} forbidden double(s); the ` +
        `live-by-design rule (AGENTS.md "Real services always") is violated:\n${report}\n` +
        `Each must be made real (produce the condition from real bad input or real ` +
        `services) or, for a genuinely unproducible exception, recorded as an ` +
        `@exceptional-double via the Captain.`,
    );
  },
);

Then(
  "any test double that remains should belong to a scenario tagged @exceptional-double whose site names the unproducible condition it injects, or be a golden capture whose site names the licensed @pipeline sandbox run it was recorded from",
  function (this: JollyWorld) {
    const hits = this.notes.doubleHits as DoubleHit[];
    const remaining = hits.filter(
      (h) => h.justification !== undefined || h.capture !== undefined,
    );
    // Every remaining double must either be annotated @exceptional-double AND
    // name a non-empty unproducible condition, or be a golden capture whose
    // @golden-capture annotation names its licensed @pipeline source run — the
    // bare marker is not enough in either branch.
    for (const h of remaining) {
      assert.ok(
        (h.justification && h.justification.length > 0) ||
          (h.capture && h.capture.length > 0),
        `the remaining double at ${h.file}:${h.line} must name the unproducible ` +
          `condition its @exceptional-double annotation injects, or name the ` +
          `licensed @pipeline sandbox run its @golden-capture annotation was ` +
          `recorded from`,
      );
    }
  },
);

// Feature 026 — second @logic @property scenario: the eval seed carries only
// AUTHENTICATION credentials, never a pre-provisioned store. Feature 025
// requires `jolly start` to provision a fresh `jolly-cannon-fodder` store on the real
// creation path; a seed that includes the store endpoint + SALEOR_TOKEN makes
// `jolly start` treat the store as pre-existing, so the configurator's
// `--failOnDelete` guard blocks the starter recipe and the live stages can
// never complete. `@eval` never gates CI, so a harness that silently seeds a
// pre-provisioned store would otherwise pass unnoticed — this gating @logic
// scenario inspects the harness's declared seed list (SEEDED_CREDENTIAL_VARS,
// exactly what realEnvFileContents writes) so the regression fails HERE.

// The credentials a baseline agent needs only to AUTHENTICATE to the real
// services: the Saleor Cloud token and the optional Cloud API override. Nothing
// here identifies a particular store. Stripe keys are NOT seeded — the Stripe
// app is installed via Saleor `appInstall` and its keys are entered by the
// human in the Dashboard, never written to the workspace `.env` by Jolly.
const AUTHENTICATION_CREDENTIALS = new Set<string>([
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_SALEOR_CLOUD_API_URL",
]);

// The store-identifying variables that must NOT be seeded: their presence makes
// `jolly start` reuse a pre-existing store instead of creating a fresh one.
const STORE_SEED_VARS = ["NEXT_PUBLIC_SALEOR_API_URL", "SALEOR_TOKEN"];

Given("the eval harness's workspace `.env` seed", function (this: JollyWorld) {
  // The subject under conformance: the harness's declared seed variable list,
  // the single source of truth for what the workspace `.env` is seeded with.
  this.notes.seedVars = [...SEEDED_CREDENTIAL_VARS];
  assert.ok(
    (this.notes.seedVars as string[]).length > 0,
    "the eval harness must declare a workspace `.env` seed to inspect",
  );
});

When("the credential variables it writes are enumerated", function (this: JollyWorld) {
  // realEnvFileContents writes each declared variable whose value is present in
  // the real test env, so the variables it writes are exactly those it declares.
  this.notes.enumeratedSeedVars = [...(this.notes.seedVars as string[])];
});

Then(
  "the seed should include only the credentials the agent needs to authenticate — the Saleor Cloud token and any Cloud API override",
  function (this: JollyWorld) {
    const vars = this.notes.enumeratedSeedVars as string[];
    const extraneous = vars.filter((v) => !AUTHENTICATION_CREDENTIALS.has(v));
    assert.deepEqual(
      extraneous,
      [],
      `the eval seed must carry only authentication credentials ` +
        `(${[...AUTHENTICATION_CREDENTIALS].join(", ")}); it also seeds: ${extraneous.join(", ")}`,
    );
  },
);

Then(
  "it should omit the store endpoint `NEXT_PUBLIC_SALEOR_API_URL` and the `SALEOR_TOKEN`, so a baseline agent's `jolly start` exercises the documented store-creation path from a fresh start instead of reusing a pre-seeded one",
  function (this: JollyWorld) {
    const seeded = new Set(this.notes.enumeratedSeedVars as string[]);
    for (const v of STORE_SEED_VARS) {
      assert.ok(
        !seeded.has(v),
        `the eval seed must omit ${v} so \`jolly start\` provisions a fresh ` +
          `jolly-cannon-fodder store on the real creation path; it is currently seeded`,
      );
    }
  },
);

// Feature 026 — the pre-run capacity reclamation (@sandbox), gated behaviorally.
// The harness reclaims capacity BEFORE provisioning — deleting leftover
// jolly-cannon-fodder-namespaced environments from previous runs so a finite org
// environment limit never starves the run's store stage. A pure selection check
// would pass against never-called reclamation code, so the conformance is the
// OBSERVABLE EFFECT, judged as an ACCOUNTING law: whatever stands stale in the
// org must be accounted for by the reclamation report, whether it carries the
// namespace in its NAME or only in its DOMAIN LABEL, and nothing the report
// accounted for may still stand afterward. Live by design — the leftovers are
// real environments observed as they stand, never seeded and never faked.

Given(
  "the `jolly-cannon-fodder`-namespaced Saleor environments standing in the org from previous runs, stale beyond the full-regression wall-clock budget in {string}",
  { timeout: 120_000 },
  async function (this: JollyWorld, riggingFile: string) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.reclaimToken = token;
    // The stale leftovers are OBSERVED, never seeded: seeding one is a real
    // environment creation, and the single licensed creator already proves that
    // seam. What stands in the org from previous runs is the genuine article,
    // and this scenario's law is an accounting one — whatever stands stale must
    // be accounted for, whether it hides behind Jolly's product-default NAME or
    // behind its domain LABEL.
    const before = await listAllEnvironments(token);
    // The same selection reclamation itself uses, so the accounting is judged
    // against the leftovers reclamation is obliged to take, not a looser set.
    this.notes.staleLeftovers = leftoverTestEnvironments(
      before,
      makeNamespace(this.runId),
      cachedStoreSpareNames(),
      fullRegressionBudgetMs(riggingFile),
    );
    // Snapshot every environment carrying the namespace in NEITHER identity
    // (read-only), so the survival assertion can confirm reclamation never
    // deletes one.
    this.notes.foreignEnvKeysBefore = before
      .filter(
        (e) =>
          !environmentIdentities(e).some((id) =>
            id.startsWith("jolly-cannon-fodder-"),
          ),
      )
      .map((e) => `${e.org}/${e.key}`);
  },
);

Then(
  "its reclamation report should account for every one of those stale leftovers, whether namespaced in the name or in the domain label",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    const stale = this.notes.staleLeftovers as CloudEnvironment[];
    const reclaimed = this.notes.reclaimed as CloudEnvironment[];
    const accounted = new Set(reclaimed.map((env) => `${env.org}/${env.key}`));
    const unaccounted = stale.filter(
      (env) => !accounted.has(`${env.org}/${env.key}`),
    );
    assert.deepEqual(
      unaccounted.map((env) => `${env.name} (domain label ${env.domainLabel})`),
      [],
      "the reclamation report must account for every stale leftover standing in " +
        "the org; a leftover selected on its domain label alone is exactly the " +
        "one a name-only report leaves squatting a slot forever",
    );
  },
);

Then(
  "an accounted leftover left standing in the org afterward should redden the check, naming it",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const reclaimed = this.notes.reclaimed as CloudEnvironment[];
    // The real arm: nothing the report accounted for may still stand.
    const standingAfter = await listAllEnvironments(token);
    const violations = unreclaimedLeftovers(reclaimed, standingAfter);
    assert.deepEqual(
      violations.map((violation) => violation.message),
      [],
      "an accounted leftover still standing in the org squats a slot the report claims it freed",
    );
    // The planted red: the same judgment, given a leftover that the report
    // accounted for and that still stands, must redden and name it.
    const planted: CloudEnvironment[] = [
      {
        ...(reclaimed[0] ??
          standingAfter[0] ?? {
            org: "planted-org",
            key: "planted-key",
            name: "jolly-cannon-fodder-planted-leftover",
            domainLabel: "jolly-cannon-fodder-planted-leftover",
          }),
        org: "planted-org",
        key: "planted-key",
        name: "jolly-cannon-fodder-planted-leftover",
        domainLabel: "jolly-cannon-fodder-planted-label",
      },
    ];
    const plantedViolations = unreclaimedLeftovers(planted, planted);
    assert.equal(
      plantedViolations.length,
      1,
      "an accounted leftover still standing must redden the check",
    );
    assert.ok(
      plantedViolations[0]!.message.includes(
        "jolly-cannon-fodder-planted-leftover",
      ) &&
        plantedViolations[0]!.message.includes(
          "jolly-cannon-fodder-planted-label",
        ),
      `the finding must name the leftover it caught: ${plantedViolations[0]!.message}`,
    );
  },
);

// The @sandbox PROVISIONER reclaims leftover jolly-cannon-fodder environments
// instead of skipping. AGENTS.md ("Leftover handling"): before creating the run's
// shared environment, the harness deletes leftover jolly-cannon-fodder-namespaced
// environments to reclaim capacity — the namespace IS the protection boundary —
// rather than skipping the run. The masked defect was a skip-on-leftover branch;
// this makes the reclaim-not-skip contract executable and falsifiable. Live by
// design: the REAL leftovers standing in the org and the
// REAL provisioner creating a REAL shared environment. provisionSharedEnvironment
// is driven directly — not the once-per-run memoized ensureSharedEnvironment — so
// the provision path runs fresh regardless of where this scenario falls in the
// serial @sandbox suite.
When(
  "the @sandbox harness provisions its shared environment for a run",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const before = await listAllEnvironments(token);
    this.notes.provisionOutcome = await provisionSharedEnvironment();
    const after = await listAllEnvironments(token);
    const afterKeys = new Set(after.map((e) => `${e.org}/${e.key}`));
    // What provisioning reclaimed: present before, absent after.
    this.notes.reclaimed = before.filter(
      (e) => !afterKeys.has(`${e.org}/${e.key}`),
    );
  },
);

// Feature 026 — fifth scenario (@logic @property): the standalone reclaim
// entrypoint runs ONLY when invoked directly (`npm run reclaim`), never as an
// import side effect. cucumber.js seeds every invocation with the support-file
// glob (`import: features/support/**/*.ts`), so features/support/reclaim-cli.ts
// is imported on EVERY cucumber run. Without an entrypoint guard its body would
// fire reclaimStaleResources — and print — a SECOND time on every invocation,
// on top of the once-per-invocation BeforeAll reclaim (hooks.ts), doubling the
// per-invocation reclamation the janitor is meant to run exactly once.
//
// The observable: a mere support-glob import (reproduced by a real cucumber
// `--dry-run`, which imports every support file but executes no BeforeAll and no
// step) must trigger no reclaim call and print nothing. reclaim-cli.ts prints
// exactly one summary line whenever its body runs, so the ABSENCE of that line
// from a dry-run's output proves the import performed no reclaim and no console
// output. The token is blanked for the probe so the check is hermetic and fast:
// the console tell is present either way, but a blank token keeps the reclaim
// off the real Cloud API. Real by design — the real reclaim-cli.ts loaded by a
// real cucumber invocation, no stand-in.

const RECLAIM_CLI = join("features", "support", "reclaim-cli.ts");
/** reclaim-cli.ts prints exactly one of these lines whenever its body runs. */
const RECLAIM_SIGNATURE = /No stale jolly-cannon-fodder leftovers found\.|Reclaimed \d+ leftover environment/;
/** A tag no scenario carries, so the probe invocation selects and runs nothing. */
const NO_MATCH_TAG = "@__reclaim_import_probe_no_match__";

Given(
  // Regex, not a Cucumber-expression string: the literal `/` in `features/support/`
  // is alternation syntax in a string pattern and would break the match.
  /^cucumber's support-file glob, which imports every file under `features\/support\/`$/,
  function (this: JollyWorld) {
    // The mechanism under conformance: cucumber.js declares the support glob, so
    // reclaim-cli.ts is imported by every cucumber invocation.
    const config = readFileSync(join(REPO_ROOT, "cucumber.js"), "utf8");
    assert.match(
      config,
      /features\/support\/\*\*\/\*\.ts/,
      "cucumber.js must import every file under features/support/ (the support glob)",
    );
    assert.ok(
      existsSync(join(REPO_ROOT, RECLAIM_CLI)),
      `${RECLAIM_CLI} must exist under the support glob to be imported`,
    );
  },
);

When(
  /^`features\/support\/reclaim-cli\.ts` is loaded because a cucumber invocation imports it, rather than run standalone via `npm run reclaim`$/,
  { timeout: 120_000 },
  function (this: JollyWorld) {
    // Reproduce a mere support-glob import: a real cucumber --dry-run imports
    // every support file (running reclaim-cli.ts's module body) but executes no
    // BeforeAll hook and no step. Any reclaim console output therefore comes
    // solely from the import side effect, never from BeforeAll. The unmatched tag
    // keeps the invocation from running any scenario; the blank Cloud token keeps
    // the probe hermetic.
    const probe = spawnSync(
      "npx",
      ["cucumber-js", "--dry-run", "--tags", NO_MATCH_TAG],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, JOLLY_SALEOR_CLOUD_TOKEN: "" },
      },
    );
    if (probe.error) {
      throw new Error(`failed to run the cucumber import probe: ${probe.error.message}`);
    }
    this.notes.importProbeOutput = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;

    // The foil the scenario names ("rather than run standalone via `npm run
    // reclaim`"): run reclaim-cli.ts directly as the process entrypoint. Its body
    // MUST fire here — the guard suppresses the import side only, never the
    // entrypoint. This pins the positive side so a guard that wrongly suppressed
    // both (e.g. one keyed on a Node feature above the runtime floor) cannot pass.
    // The blank token keeps the reclaim off the real Cloud; the console tell fires
    // regardless (an empty reclaim still prints "No stale ... found.").
    const standalone = spawnSync(
      process.env.HARNESS_CLI_RUNTIME ?? "node",
      [join(REPO_ROOT, RECLAIM_CLI)],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, JOLLY_SALEOR_CLOUD_TOKEN: "" },
      },
    );
    if (standalone.error) {
      throw new Error(`failed to run the standalone reclaim probe: ${standalone.error.message}`);
    }
    this.notes.standaloneProbeOutput = `${standalone.stdout ?? ""}\n${standalone.stderr ?? ""}`;
  },
);

Then(
  "it should perform no reclaim call and no console output as a result of merely being imported",
  function (this: JollyWorld) {
    const output = this.notes.importProbeOutput as string;
    assert.doesNotMatch(
      output,
      RECLAIM_SIGNATURE,
      `merely importing ${RECLAIM_CLI} through cucumber's support glob triggered a ` +
        `reclaim and printed its summary; the reclaim body must be guarded to run only ` +
        `when the module is the process entrypoint (\`npm run reclaim\`). Probe output:\n${output}`,
    );
  },
);

Then(
  "a cucumber invocation's reclamation should happen exactly once, from the `BeforeAll` hook alone",
  function (this: JollyWorld) {
    // The import contributes zero reclamations (proven behaviorally above by the
    // dry-run probe: no reclaim-cli signature). The one per-invocation reclamation
    // is the unconditional BeforeAll in hooks.ts — assert it is the single site
    // that fires reclaimStaleResources on every invocation.
    const output = this.notes.importProbeOutput as string;
    const importReclamations = (output.match(new RegExp(RECLAIM_SIGNATURE, "g")) ?? []).length;
    assert.equal(
      importReclamations,
      0,
      "the support-glob import must contribute no reclamation; BeforeAll is the sole per-invocation site",
    );

    const hooks = readFileSync(join(REPO_ROOT, "features", "support", "hooks.ts"), "utf8");
    const beforeAllReclaims = (
      hooks.match(/BeforeAll\([\s\S]*?reclaimStaleResources\(/g) ?? []
    ).length;
    assert.equal(
      beforeAllReclaims,
      1,
      "hooks.ts must run reclaimStaleResources exactly once, from a single BeforeAll hook",
    );

    // The guard suppresses the import side ONLY: run standalone via `npm run
    // reclaim`, reclaim-cli.ts's body still fires (it prints its summary). Without
    // this, a guard that suppressed both import AND entrypoint would satisfy the
    // suppression asserts above yet silently break `npm run reclaim`.
    const standaloneOutput = this.notes.standaloneProbeOutput as string;
    assert.match(
      standaloneOutput,
      RECLAIM_SIGNATURE,
      `running reclaim-cli.ts standalone (as \`npm run reclaim\` does) must still perform ` +
        `the reclaim and print its summary; the entrypoint guard must suppress the import ` +
        `side only. Standalone output:\n${standaloneOutput}`,
    );
  },
);

// Feature 026 — the leaked environment. A run that falls through to Jolly's
// product-default store name still carries the run's namespace in its DOMAIN
// LABEL. Reclamation that matches on name alone cannot see such an environment,
// so it squats an org slot forever and starves every scenario that creates one.
// This @logic scenario pins the SELECTION rule on the real selection seam; the
// OBSERVABLE EFFECT against the real Cloud org is pinned by the @sandbox
// accounting scenario above, which requires every stale leftover to be
// accounted for whether it is namespaced in its name or its domain label.

/** The product-default store name a fall-through run leaves behind. */
const PRODUCT_DEFAULT_STORE_NAME = "jolly-store";

/** A namespace from a PREVIOUS run: what reclamation is entitled to delete. */
function priorRunNamespace(world: JollyWorld): string {
  return world.namespace.replace("jolly-cannon-fodder-", "jolly-cannon-fodder-prior-");
}

Given(
  "a leftover environment whose Cloud name is Jolly's product default \"jolly-store\" and whose domain label carries the `jolly-cannon-fodder` namespace",
  function (this: JollyWorld) {
    // The leak shape as it really stood in the org: the NAME gives nothing away,
    // the DOMAIN LABEL is the only thing that marks the environment as ours.
    // Neither fixture carries a `created` timestamp: an environment whose age
    // cannot be read is treated as stale by the selection seam, so this
    // scenario pins RECOGNITION (name vs domain label); freshness protection
    // is feature 030's, staged there with explicit `created` fixtures.
    this.notes.leakedEnvironment = {
      org: "acme",
      key: "leaked",
      name: PRODUCT_DEFAULT_STORE_NAME,
      domainLabel: `${priorRunNamespace(this)}-leftover`,
    } satisfies CloudEnvironment;
    // A bystander carrying the namespace in NEITHER identity: never ours to touch.
    this.notes.bystanderEnvironment = {
      org: "acme",
      key: "bystander",
      name: "acme-production",
      domainLabel: "acme-production",
    } satisfies CloudEnvironment;
    stageEnvironmentFixture(
      this,
      this.notes.leakedEnvironment as CloudEnvironment,
      this.notes.bystanderEnvironment as CloudEnvironment,
    );
  },
);

/** Stage fixture environments for the shared selection When below. Every Given
 * that composes an in-memory environment (this feature's recognition pair,
 * feature 030's age-gate pair) pushes here, so one When drives the one real
 * selection seam over whatever the scenario staged. */
export function stageEnvironmentFixture(
  world: JollyWorld,
  ...environments: CloudEnvironment[]
): void {
  const staged = (world.notes.fixtureEnvironments ??= []) as CloudEnvironment[];
  staged.push(...environments);
}

When("the environments a run may reclaim are selected", function (this: JollyWorld) {
  // The real selection seam every reclamation path routes through.
  const staged = (this.notes.fixtureEnvironments ?? []) as CloudEnvironment[];
  assert.ok(staged.length > 0, "no fixture environments staged for selection");
  this.notes.selectedForReclamation = leftoverTestEnvironments(
    staged,
    makeNamespace(this.runId),
    cachedStoreSpareNames(),
  );
});

Then("the leaked environment should be selected for reclamation", function (this: JollyWorld) {
  const leaked = this.notes.leakedEnvironment as CloudEnvironment;
  const selected = this.notes.selectedForReclamation as CloudEnvironment[];
  assert.ok(
    selected.some((e) => e.key === leaked.key),
    `an environment named ${leaked.name} whose domain label is ${String(leaked.domainLabel)} ` +
      `carries this harness's namespace and must be selected for reclamation; matching on ` +
      `name alone leaves it squatting an org slot forever`,
  );
});

Then(
  "an environment carrying the `jolly-cannon-fodder` namespace in neither its name nor its domain label should be left alone",
  function (this: JollyWorld) {
    const bystander = this.notes.bystanderEnvironment as CloudEnvironment;
    const selected = this.notes.selectedForReclamation as CloudEnvironment[];
    assert.ok(
      !selected.some((e) => e.key === bystander.key),
      `${bystander.name} carries the namespace in neither identity and must never be ` +
        `selected for reclamation`,
    );
  },
);

Then(
  "every environment lacking the `jolly-cannon-fodder` namespace in both its name and its domain label should still be present afterward",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const after = await listAllEnvironments(token);
    const afterKeys = new Set(after.map((e) => `${e.org}/${e.key}`));
    const before = this.notes.foreignEnvKeysBefore as string[];
    const missing = before.filter((k) => !afterKeys.has(k));
    assert.deepEqual(
      missing,
      [],
      `reclamation must never delete an environment that carries the namespace in neither identity; missing: ${missing.join(", ")}`,
    );
  },
);

// ─── Scenario: the shipped CLI does not fabricate a Cloud organization list ───
//
// A harness-only affordance fabricates a service response, so it is a test
// double living in production. A customer never sets the harness guard, so the
// customer's environment is the ambient one with every harness variable removed
// — recognised by the harness it names, not by a variable name this check pins,
// so production stays free to name its guard. The run then goes to the REAL
// Cloud API for its organizations, and the injected list must not survive.

/** A customer's environment: the real one, with every harness variable removed. */
function customerEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) {
    if (/harness/i.test(name)) env[name] = undefined;
  }
  return env;
}

Given(
  "a customer's environment, where the harness guard is not set",
  function (this: JollyWorld) {
    this.notes.customerEnv = customerEnv();
  },
);

When(
  "the agent runs `jolly create store --create-environment --dry-run --json --mock-organizations=acme-co,other-co`",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    // --dry-run: the run resolves the organization for real and previews the
    // request, creating nothing.
    await this.runCliAsync(
      [
        "create",
        "store",
        "--create-environment",
        "--dry-run",
        "--json",
        "--mock-organizations=acme-co,other-co",
      ],
      { env: this.notes.customerEnv as Record<string, string | undefined> },
    );
  },
);

Then(
  'the envelope should not report "acme-co" or "other-co" among the organizations it resolved',
  function (this: JollyWorld) {
    const envelope = JSON.stringify(this.envelope);
    for (const injected of ["acme-co", "other-co"]) {
      assert.ok(
        !envelope.includes(injected),
        `the shipped CLI fabricated the organization "${injected}" for a customer: ${envelope}`,
      );
    }
  },
);

Then(
  "the run should resolve organizations from the Cloud API alone",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    // The organizations the envelope reports must be the ones the real Cloud API
    // serves this token — asked for here, independently, over the same real API.
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(
      token,
      "JOLLY_SALEOR_CLOUD_TOKEN must be present to resolve organizations from the Cloud API",
    );
    const liveSlugs = [...(await listOrganizations(token))].sort();
    assert.ok(
      liveSlugs.length > 0,
      "the Cloud API served no organization for this token — fitting out must provide a token that reaches one",
    );
    const data = (this.envelope.data ?? {}) as {
      availableOrganizations?: string[];
      selectedOrganization?: string;
    };
    assert.deepEqual(
      [...(data.availableOrganizations ?? [])].sort(),
      liveSlugs,
      "the organizations the run resolved must be the ones the Cloud API serves, and no others",
    );
    assert.ok(
      liveSlugs.includes(String(data.selectedOrganization)),
      `the selected organization must be one the Cloud API serves; got ${data.selectedOrganization}`,
    );
  },
);

// ─── Scenario: no harness-only affordance is reachable without the guard ──────
//
// The affordances are enumerated from the production source: every read of a
// `mock-*` flag is a seam that can fabricate a service response. Each must
// consult the harness guard, so the shipped surface can never reach it. The
// planted red proves the check can go red: an affordance read in a seam that
// consults no guard at all.

// `Given Jolly's production source` is already defined, and shared, by the
// single-creation-seam conformance steps.

When(
  "the harness-only affordances it declares are enumerated",
  function (this: JollyWorld) {
    this.notes.harnessAffordances = enumerateHarnessAffordances();
  },
);

Then(
  "each should fabricate a service response only when the harness guard is set",
  function (this: JollyWorld) {
    const sites = this.notes.harnessAffordances as AffordanceSite[];
    assert.ok(
      sites.length > 0,
      "no harness-only affordance was found — the enumeration is not reading Jolly's production source",
    );
    const unguarded = sites.filter((site) => !site.guarded);
    assert.deepEqual(
      unguarded.map(
        (site) => `${site.file}:${site.line} ${site.affordance}`,
      ),
      [],
      `harness-only affordances reachable from the shipped surface with no guard (${unguarded.length} of ${sites.length} sites)`,
    );
  },
);

Then(
  "a harness-only affordance reachable from the shipped surface with no guard should redden the check",
  function (this: JollyWorld) {
    // The planted red: a virtual source, never written to disk, reading the
    // affordance in a seam that consults no guard. A check that cannot go red
    // proves nothing about the affordances that pass it.
    const unguarded: InjectedSource = {
      file: "src/.planted-unguarded-affordance.ts",
      text: `export function plantedUnguardedAffordance(args: {
  options: Record<string, string | undefined>;
}) {
  const mock = args.options["mock-organizations"];
  if (mock === undefined) return [];
  return mock.split(",").map((slug) => ({ slug: slug.trim() }));
}`,
    };
    const reddened = findUnguardedHarnessAffordances([unguarded]);
    assert.ok(
      reddened.some((violation) => violation.file === unguarded.file),
      "an unguarded harness-only affordance did not redden the check",
    );
  },
);

// ─── The composition lane: composition-ground spies serve only @composition ─
// A spy justified on the composition ground (internal wiring / launch order /
// await joins) is admissible because the seams it wires are proven for real at
// their own seams. The lane stays legible only while every such spy serves
// scenarios that DECLARE it with the @composition tag (feature 026 Rule).

When(
  "the test doubles justified on the composition ground are enumerated",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    this.notes.compositionSpies = enumerateCompositionSpies();
    this.notes.executablePickles = collectExecutablePickles();
    assert.ok(
      (this.notes.compositionSpies as CompositionSpy[]).length > 0,
      "no composition-ground spy was found — the enumeration is not reading the verification layer",
    );
  },
);

Then(
  "each should serve only scenarios tagged {string}",
  function (this: JollyWorld, tag: string) {
    const violations = findCompositionLaneViolations(
      this.notes.compositionSpies as CompositionSpy[],
      this.notes.executablePickles as PickleInfo[],
      tag,
    );
    assert.equal(
      violations.length,
      0,
      `composition-ground spies serving scenarios outside the ${tag} lane:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a composition-ground spy serving a scenario without the tag should redden the check, naming the spy and the scenario",
  function (this: JollyWorld) {
    // Enumeration half: a planted composition-ground spy source is seen. The
    // annotation marker is assembled at run time so THIS file's own source
    // never carries it as a literal — the scanner reads raw lines, and a
    // literal here would read as a real composition-ground annotation tied to
    // whatever step registration follows it.
    const marker = ["@exceptional", "double:"].join("-");
    const planted: InjectedSource = {
      file: "features/support/.planted-composition-spy.ts",
      text: [
        'import { Given } from "@cucumber/cucumber";',
        `// ${marker} internal composition/wiring — the planted seams are`,
        "// replaced with recording spies to observe launch order (composition ground).",
        'Given("the planted seams are replaced with recording spies", function () {});',
      ].join("\n"),
    };
    const spies = enumerateCompositionSpies([planted]).filter(
      (spy) => spy.file === planted.file,
    );
    assert.ok(
      spies.length > 0,
      "a planted composition-ground spy was not enumerated",
    );
    // Join half: an untagged scenario binding the spy's pattern is reported,
    // naming both.
    const untagged: PickleInfo = {
      uri: "features/.planted-untagged.feature",
      name: "A planted scenario outside the composition lane",
      tags: ["@logic"],
      steps: ["the planted seams are replaced with recording spies"],
    };
    const violations = findCompositionLaneViolations(spies, [untagged], "@composition");
    assert.ok(
      violations.some(
        (violation) =>
          violation.file === planted.file &&
          violation.message.includes(untagged.name),
      ),
      "a composition-ground spy serving an untagged scenario was not reported naming the spy and the scenario",
    );
  },
);

// ─── Production env namespace: JOLLY_* products, guarded HARNESS_* knobs ────

When(
  "the environment variables production code reads are enumerated",
  function (this: JollyWorld) {
    this.notes.productionEnvReads = enumerateProductionEnvReads("src/");
    assert.ok(
      (this.notes.productionEnvReads as EnvRead[]).length > 0,
      "no environment read was found — the enumeration is not reading Jolly's production source",
    );
  },
);

Then(
  "each should be a `JOLLY_*` product setting, a target project's own expected variable, or a harness affordance readable only when the harness guard is set",
  function (this: JollyWorld) {
    const violations = findEnvNamespaceViolations(
      this.notes.productionEnvReads as EnvRead[],
    );
    assert.equal(
      violations.length,
      0,
      `environment reads outside the namespace contract:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a harness-only knob should carry the `HARNESS_` prefix, never `JOLLY_`",
  function (this: JollyWorld) {
    const misNamespaced = findEnvNamespaceViolations(
      this.notes.productionEnvReads as EnvRead[],
    ).filter((violation) => violation.kind === "mis-namespaced");
    assert.equal(
      misNamespaced.length,
      0,
      `harness-only knobs hiding outside the HARNESS_ prefix:\n${misNamespaced
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a mis-namespaced knob or an unguarded harness read should redden the check, naming the variable and the site",
  function (this: JollyWorld) {
    // A harness-only knob hiding under the JOLLY_ prefix.
    const misNamespaced: InjectedSource = {
      file: "src/.planted-mis-namespaced-knob.ts",
      text: [
        "export function plantedMisNamespacedKnob(): string | undefined {",
        "  return process.env.JOLLY_HARNESS_SPEED;",
        "}",
      ].join("\n"),
    };
    const misReads = enumerateProductionEnvReads("src/", [misNamespaced]);
    const misViolations = findEnvNamespaceViolations(misReads).filter(
      (violation) => violation.file === misNamespaced.file,
    );
    assert.ok(
      misViolations.some(
        (violation) =>
          violation.kind === "mis-namespaced" &&
          violation.message.includes("JOLLY_HARNESS_SPEED"),
      ),
      "a planted mis-namespaced knob was not reported naming the variable and the site",
    );

    // A HARNESS_* affordance read with no guard consulted in its seam.
    const unguarded: InjectedSource = {
      file: "src/.planted-unguarded-harness-read.ts",
      text: [
        "export function plantedUnguardedRead(): string | undefined {",
        "  return process.env.HARNESS_PLANTED_KNOB;",
        "}",
      ].join("\n"),
    };
    const unguardedReads = enumerateProductionEnvReads("src/", [unguarded]);
    const unguardedViolations = findEnvNamespaceViolations(unguardedReads).filter(
      (violation) => violation.file === unguarded.file,
    );
    assert.ok(
      unguardedViolations.some(
        (violation) =>
          violation.kind === "unguarded-harness" &&
          violation.message.includes("HARNESS_PLANTED_KNOB"),
      ),
      "a planted unguarded harness read was not reported naming the variable and the site",
    );
  },
);
