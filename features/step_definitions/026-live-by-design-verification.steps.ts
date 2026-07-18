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
import { assertEnvelopeSuccess } from "../support/envelope.ts";
import { createEnvironment } from "../support/env-factory.ts";
import { SEEDED_CREDENTIAL_VARS } from "../support/eval.ts";
import {
  type CloudEnvironment,
  deleteEnvironment,
  environmentIdentities,
  leftoverTestEnvironments,
  listAllEnvironments,
  listOrganizations,
  observeEnvironmentCreatedAt,
} from "../support/cloud.ts";
import { fullRegressionBudgetMs } from "../support/wake.ts";
import {
  type AffordanceSite,
  enumerateHarnessAffordances,
  findUnguardedHarnessAffordances,
} from "../support/harness-affordance-conformance.ts";
import type { InjectedSource } from "../support/module-conformance.ts";
import { makeNamespace } from "../support/sandbox.ts";
import {
  cachedStoreSpareNames,
  provisionSharedEnvironment,
  reclaimStaleResources,
  type ProvisionOutcome,
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

// Feature 026 — third scenario (@sandbox): the eval's pre-run capacity
// reclamation, gated behaviorally. Feature 025 requires the eval harness to
// reclaim capacity BEFORE the agent provisions — deleting leftover
// jolly-cannon-fodder-namespaced environments from previous runs so a finite org
// environment limit never starves the run's store stage. @eval never gates CI, so
// an eval carrying only teardown and no pre-run reclamation would silently let
// leftovers fill the org and the live store stage would fail unobserved. A pure
// selection check would pass against never-called reclamation code, so the
// conformance is the OBSERVABLE EFFECT: seed a real jolly-cannon-fodder leftover, run the
// eval's reclamation seam (the same one the @eval run invokes before the agent
// provisions), and assert the leftover is gone afterward while every
// non-jolly-cannon-fodder environment survives. Live by design — the leftover is a REAL
// environment created via Jolly's own create-environment path, never a fake.

/**
 * Create a real jolly-cannon-fodder-namespaced environment via Jolly's own
 * create-environment path. An org environment limit is reclaimed, never a skip
 * (AGENTS.md): if the org rejects creation at its limit, delete prior-run
 * jolly-cannon-fodder leftovers to free a slot and retry once.
 */
async function seedNamespacedEnvironment(world: JollyWorld, name: string) {
  const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"]!;
  // Route through the single env-creation seam rather than re-implementing the
  // create-and-wait-out-the-limit flow. Wait out a transient org environment
  // limit the same way the provisioner does (under a parallel run a sibling
  // worker frees a slot when its scenario tears down), and reclaim a slot by
  // deleting any prior-run leftover that frees capacity without touching this
  // run's live environments or either cached store (shared and recipe).
  const spareNames = cachedStoreSpareNames();
  const result = await createEnvironment(
    (args, options) => world.runCliAsync(args, options),
    {
      name,
      domainLabel: name,
      runOptions: { timeoutMs: 540_000 },
      limitBudgetMs: 540_000,
      reclaim: { token, runNamespace: makeNamespace(world.runId), spareNames },
    },
  );
  assertEnvelopeSuccess(
    result.envelope,
    "the seeded leftover environment must be created (live by design)",
  );
  return result;
}

Given(
  "a leftover `jolly-cannon-fodder`-namespaced Saleor environment standing in the org from a previous run that never finished starting and does not serve requests",
  { timeout: 600_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.reclaimToken = token;
    // The seeded leftover is freshly created and never finished starting: a brand
    // new Cloud environment does not serve GraphQL for minutes, so reclamation must
    // key on the org's environment registry (the jolly-cannon-fodder- prefix), not on
    // whether the leftover answers a live probe.

    // Snapshot every NON-jolly-cannon-fodder environment now (read-only) so the survival
    // assertion can confirm reclamation never deletes one.
    const before = await listAllEnvironments(token);
    this.notes.nonTestEnvKeysBefore = before
      .filter(
        (e) =>
          !environmentIdentities(e).some((id) =>
            id.startsWith("jolly-cannon-fodder-"),
          ),
      )
      .map((e) => `${e.org}/${e.key}`);

    // Seed a REAL leftover under a PRIOR-run namespace, exactly as a genuine
    // previous-run leftover would stand: the jolly-cannon-fodder- prefix marks it a
    // reclamation target, and carrying a run id that is NOT this run's is what
    // lets the run-scoped provisioner reclamation delete it while protecting
    // this run's own live environment and any sibling parallel worker's. The
    // prior namespace still embeds this run's id so teardown attributes it.
    // Teardown registered BEFORE creation (a crash mid-create stays cleanable);
    // the reclamation under test removes it first, leaving teardown a 404 no-op.
    const priorNamespace = this.namespace.replace("jolly-cannon-fodder-", "jolly-cannon-fodder-prior-");
    const name = `${priorNamespace}-leftover`;
    this.notes.leftoverName = name;
    this.cleanup.register(`seeded leftover environment ${name}`, async () => {
      for (const env of await listAllEnvironments(token)) {
        if (env.name.startsWith(priorNamespace)) {
          await deleteEnvironment(token, env.org, env.key);
        }
      }
    });
    await seedNamespacedEnvironment(this, name);

    // Confirm the seed really stands before reclamation runs.
    const seeded = await listAllEnvironments(token);
    assert.ok(
      seeded.some((e) => e.name === name),
      `the seeded leftover ${name} must stand in the org before reclamation`,
    );
  },
);

// Feature 026 — fourth scenario (@sandbox): the @sandbox PROVISIONER reclaims a
// leftover jolly-cannon-fodder environment instead of skipping. AGENTS.md ("Leftover
// handling"): before creating the run's shared environment, the harness deletes
// leftover jolly-cannon-fodder-namespaced environments to reclaim capacity — the
// jolly-cannon-fodder- prefix IS the protection boundary — rather than skipping the run.
// The masked defect was a skip-on-leftover branch; this scenario makes the
// reclaim-not-skip contract executable and falsifiable. Live by design: a REAL
// leftover (seeded by the shared Given through Jolly's own create path) and the
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

Then(
  "it should reclaim the leftover `jolly-cannon-fodder`-namespaced environment and provision the run's environment, not skip the run",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const name = this.notes.leftoverName as string;
    const outcome = this.notes.provisionOutcome as ProvisionOutcome;
    assert.equal(
      outcome.status,
      "ready",
      "provisioning must reclaim the leftover and provision the run's environment",
    );
    const after = await listAllEnvironments(token);
    assert.ok(
      !after.some((e) => e.name === name),
      `the leftover ${name} must be reclaimed during provisioning; it still stands in the org`,
    );
    const reclaimed = this.notes.reclaimed as CloudEnvironment[];
    assert.ok(
      reclaimed.some((e) => e.name === name),
      `provisioning must reclaim the leftover ${name} to free capacity`,
    );
  },
);

Then(
  "every environment lacking the `jolly-cannon-fodder` prefix should still be present afterward",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const after = await listAllEnvironments(token);
    const afterKeys = new Set(after.map((e) => `${e.org}/${e.key}`));
    const before = this.notes.nonTestEnvKeysBefore as string[];
    const missing = before.filter((k) => !afterKeys.has(k));
    assert.deepEqual(
      missing,
      [],
      `reclamation must never delete a non-jolly-cannon-fodder environment; missing: ${missing.join(", ")}`,
    );
    // And everything it deleted carried the jolly-cannon-fodder- namespace in at
    // least one identity: a run that fell through to the product-default store
    // name is still ours, recognized by its domain label.
    const reclaimed = this.notes.reclaimed as CloudEnvironment[];
    const wrongful = reclaimed
      .filter(
        (e) =>
          !environmentIdentities(e).some((id) =>
            id.startsWith("jolly-cannon-fodder-"),
          ),
      )
      .map((e) => e.name);
    assert.deepEqual(
      wrongful,
      [],
      "reclamation must delete only jolly-cannon-fodder-namespaced environments",
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

// Feature 026 — the leaked-environment pair. A run that falls through to Jolly's
// product-default store name still carries the run's namespace in its DOMAIN
// LABEL. Reclamation that matches on name alone cannot see such an environment,
// so it squats an org slot forever and starves every scenario that creates one.
// The @logic scenario pins the SELECTION rule on the real selection seam; the
// @sandbox scenario pins the OBSERVABLE EFFECT against the real Cloud org, with
// a real leaked environment created through Jolly's own create path.

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

Given(
  "a leftover Saleor environment standing in the org whose name is Jolly's product default \"jolly-store\" and whose domain label carries the `jolly-cannon-fodder` namespace",
  { timeout: 600_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.reclaimToken = token;

    // Snapshot every environment that is not ours in EITHER identity, so the
    // survival assertion can confirm reclamation left each one alone.
    const before = await listAllEnvironments(token);
    this.notes.foreignEnvKeysBefore = before
      .filter(
        (e) =>
          !environmentIdentities(e).some((id) => id.startsWith("jolly-cannon-fodder-")),
      )
      .map((e) => `${e.org}/${e.key}`);

    // The leaked environment, created for real through Jolly's own create path:
    // the product-default NAME, and a PRIOR-run namespace in the domain label so
    // reclamation is entitled to delete it while this run's own environments and
    // the cached shared store stay protected. Teardown registered BEFORE
    // creation; the reclamation under test removes it first, leaving a 404 no-op.
    const domainLabel = `${priorRunNamespace(this)}-leaked`;
    this.notes.leakedDomainLabel = domainLabel;
    this.cleanup.register(`leaked environment ${domainLabel}`, async () => {
      for (const env of await listAllEnvironments(token)) {
        if (env.domainLabel === domainLabel) {
          await deleteEnvironment(token, env.org, env.key);
        }
      }
    });
    const result = await createEnvironment(
      (args, options) => this.runCliAsync(args, options),
      {
        name: PRODUCT_DEFAULT_STORE_NAME,
        domainLabel,
        runOptions: { timeoutMs: 540_000 },
        limitBudgetMs: 540_000,
        reclaim: {
          token,
          runNamespace: makeNamespace(this.runId),
          spareNames: cachedStoreSpareNames(),
        },
      },
    );
    assertEnvelopeSuccess(
      result.envelope,
      "the leaked environment must be created (live by design)",
    );

    // Confirm the leak really stands, in the shape the scenario names.
    const seeded = await listAllEnvironments(token);
    const leaked = seeded.find((e) => e.domainLabel === domainLabel);
    assert.ok(leaked, `the leaked environment ${domainLabel} must stand in the org`);
    assert.equal(
      leaked!.name,
      PRODUCT_DEFAULT_STORE_NAME,
      "the leak's Cloud name must be Jolly's product default, which is what hides it from a name-only match",
    );
  },
);

Given(
  "the leftover is stale, older than the full-regression wall-clock budget in {string}",
  function (this: JollyWorld, riggingFile: string) {
    // The staged leftover: the leaked environment (domain-label scenario) or
    // the prior-run leftover (provisioner scenario), whichever this scenario's
    // first Given staged.
    const identity = (this.notes.leakedDomainLabel ?? this.notes.leftoverName) as
      | string
      | undefined;
    assert.ok(
      identity,
      "a leftover must be staged before its age can be observed as stale",
    );
    // @exceptional-double: a resource age beyond the full-regression budget —
    // elapsed wall clock cannot be produced on demand (feature 030's staleness
    // gate). The staged leftover is real and its reclamation deletes it for
    // real; only the age observation is injected: for this one identity the
    // platform-served `created` is observed as one minute older than the
    // budget the named rigging file configures, and the real age-gate
    // arithmetic still decides staleness.
    const budgetMs = fullRegressionBudgetMs(riggingFile);
    const createdIso = new Date(Date.now() - budgetMs - 60_000).toISOString();
    // Teardown registered before the injection lands; removal is idempotent.
    let revert: (() => void) | undefined;
    this.cleanup.register(`stale-age observation for ${identity}`, () => {
      revert?.();
    });
    revert = observeEnvironmentCreatedAt(identity, createdIso);
  },
);

When(
  "the @sandbox harness performs its pre-run capacity reclamation",
  { timeout: 300_000 },
  async function (this: JollyWorld) {
    // The real pre-run reclamation the @sandbox tier runs from BeforeAll.
    const token = this.notes.reclaimToken as string;
    this.notes.reclaimed = await reclaimStaleResources(token);
  },
);

Then(
  "the leaked environment should no longer exist in the org",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = this.notes.reclaimToken as string;
    const domainLabel = this.notes.leakedDomainLabel as string;
    const after = await listAllEnvironments(token);
    assert.ok(
      !after.some((e) => e.domainLabel === domainLabel),
      `the leaked environment ${domainLabel} must be reclaimed; it still stands in the org and squats a slot`,
    );
    const reclaimed = this.notes.reclaimed as CloudEnvironment[];
    assert.ok(
      reclaimed.some((e) => e.domainLabel === domainLabel),
      `reclamation must report the leaked environment ${domainLabel} among those it deleted`,
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
