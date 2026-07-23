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

// The subject this feature's @property scenarios scan: the shipped CLI's own
// source. Defined here, in the one feature that binds it, since the
// single-creation-seam feature that formerly shared it now names its subject
// through the structural checker's declared seams instead.
Given("Jolly's production source", function (this: JollyWorld) {
  assert.ok(
    existsSync(join(REPO_ROOT, "src", "index.ts")),
    "the production source (src/) must exist to check",
  );
});

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
// ─── Production env namespace: JOLLY_* products, guarded HARNESS_* knobs ────
