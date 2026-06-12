// Step definitions for feature 001: agent-first Jolly onboarding and CLI.
//
// Two scenarios: the @sandbox "Jolly start completes successfully" end-to-end
// run (FULL_END_TO_END credentials; the homepage/setup-guide scenarios were
// retired when homepage/ became a Captain-owned asset outside the spec/test
// loop) and the @logic "jolly start --dry-run" true-preview scenario.
//
// CLI contract pinned by these steps (for Crew Mates):
//   jolly start --json — runs the full setup flow; the final success
//   envelope must carry key URLs in data, run jolly doctor automatically
//   and include its results as data.doctor.checks (feature 014), and give
//   nextSteps guidance toward customizing the storefront with the
//   customer's own agent. Secrets are referenced by name, never printed.
//
//   jolly start --dry-run --json — a true preview plan, not a status report:
//   data.dryRun === true; data.plan is a non-empty array of stage entries,
//   each { stage, effects } where effects carries the four intended-effect
//   arrays directoriesCreated / filesWritten / networkHostsContacted /
//   repositoriesCloned (strings; empty when the stage has no such effect).
//   Every side-effecting plan entry (any non-empty effects array) carries a
//   feature 021 riskContext with dryRunAvailable true. A "start-dry-run"
//   check (the `<command>-dry-run` convention every other command follows)
//   plus the dryRun marker make the preview programmatically distinguishable
//   from execution progress, and nextSteps direct the agent to run
//   `jolly start` (without --dry-run) to execute the plan. The dry run
//   touches nothing: no files created or modified, no network calls.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CHECK_STATUSES,
  assertRiskContextShape,
  type RiskContext,
} from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

Given(
  "`jolly start` has completed the end-to-end setup flow",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // The end-to-end flow provisions real resources (Saleor environment,
    // storefront, Vercel deploy, Stripe test config) — generous timeout.
    this.runCli(["start", "--json"], { timeoutMs: 840_000 });
    assert.equal(
      this.envelope.status,
      "success",
      `jolly start should complete successfully: ${this.envelope.summary}\n${JSON.stringify(this.envelope.errors)}`,
    );
  },
);

When("Jolly prints the final success output", function (this: JollyWorld) {
  // Already captured by runCli; the Then steps inspect it.
  assert.ok(this.lastRun, "jolly start must have run");
});

Then(
  "it should include a concise human-readable summary",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.summary.trim().length > 0,
      "envelope.summary should be a non-empty human-readable summary",
    );
  },
);

Then(
  "it should include machine-readable JSON or report data for the customer's agent on stdout",
  function (this: JollyWorld) {
    // findEnvelope + assertEnvelopeShape (via world.envelope) already proved
    // a valid machine-readable envelope is on stdout.
    assert.ok(this.lastRun!.envelope, "stdout should carry the JSON envelope");
    assert.ok(
      typeof this.envelope.data === "object" && this.envelope.data !== null,
      "the envelope should carry a data report object",
    );
  },
);

Then(
  "it should include key URLs and status values",
  function (this: JollyWorld) {
    const serialized = JSON.stringify(this.envelope.data);
    assert.match(
      serialized,
      /https?:\/\//,
      `envelope.data should include key URLs (store/storefront/deployment): ${serialized}`,
    );
    assert.ok(
      this.envelope.checks.length > 0,
      "envelope.checks should carry status values for the setup stages",
    );
  },
);

Then(
  "it should include final verification results from an automatic `jolly doctor` run",
  function (this: JollyWorld) {
    const doctor = this.envelope.data.doctor as
      | Record<string, unknown>
      | undefined;
    assert.ok(
      doctor && Array.isArray(doctor.checks),
      `envelope.data.doctor.checks should carry the automatic doctor results: ${JSON.stringify(this.envelope.data)}`,
    );
    for (const check of doctor.checks as Array<Record<string, unknown>>) {
      assert.ok(
        typeof check.id === "string" && (check.id as string).length > 0,
        `doctor check missing stable id: ${JSON.stringify(check)}`,
      );
      assert.ok(
        (CHECK_STATUSES as readonly string[]).includes(String(check.status)),
        `doctor check "${check.id}" has invalid status "${check.status}"`,
      );
    }
  },
);

Then(
  "it should include next-step guidance for customizing the storefront with the customer's own agent and workflow",
  function (this: JollyWorld) {
    const steps = this.envelope.nextSteps.map((step) =>
      String(step.description ?? ""),
    );
    assert.ok(steps.length > 0, "envelope.nextSteps should not be empty");
    assert.ok(
      steps.some((text) => /custom|storefront|agent|iterat/i.test(text)),
      `nextSteps should guide toward customizing the storefront with the customer's own agent: ${JSON.stringify(steps)}`,
    );
  },
);

Then("it should avoid printing secret values", function (this: JollyWorld) {
  this.assertNoSecretsIn(
    this.lastRun!.stdout + this.lastRun!.stderr,
    "jolly start final output",
  );
});

// ── Scenario: Jolly start --dry-run previews the plan without side effects
//    (@logic) ─────────────────────────────────────────────────────────────
// jolly start is the most side-effecting command Jolly has, so this @logic
// run forces dummy credentials for every workflow credential group: even a
// CLI that ignores --dry-run cannot reach a real Saleor, Vercel, or Stripe
// account (harmless by design; see the feature 012 incident in HANDOVER.md).
// The API URL points at the reserved .invalid TLD, which never resolves.

const DRY_RUN_LOGIC_ENV = {
  JOLLY_SALEOR_CLOUD_TOKEN: "test-cloud-token-for-logic",
  JOLLY_SALEOR_APP_TOKEN: "test-app-token-for-logic",
  NEXT_PUBLIC_SALEOR_API_URL: "https://jolly-test.invalid/graphql",
  JOLLY_VERCEL_TOKEN: "test-vercel-token-for-logic",
  JOLLY_STRIPE_PUBLISHABLE_KEY: "pk_test_logic_dummy",
  JOLLY_STRIPE_SECRET_KEY: "sk_test_logic_dummy",
};

const EFFECT_KEYS = [
  "directoriesCreated",
  "filesWritten",
  "networkHostsContacted",
  "repositoriesCloned",
] as const;

/** Recursive listing of a directory: relative path, kind, size, mtime. */
function snapshotDir(root: string): string[] {
  const entries: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (stat.isDirectory()) {
        entries.push(`${rel}/`);
        walk(path, rel);
      } else {
        entries.push(`${rel} size=${stat.size} mtime=${stat.mtimeMs}`);
      }
    }
  };
  walk(root, "");
  return entries;
}

function planEntries(world: JollyWorld): Array<Record<string, unknown>> {
  const plan = world.envelope.data.plan;
  assert.ok(
    Array.isArray(plan) && plan.length > 0,
    `envelope.data.plan should be a non-empty per-stage array: ${JSON.stringify(world.envelope.data)}`,
  );
  return plan as Array<Record<string, unknown>>;
}

function effectsOf(entry: Record<string, unknown>): Record<string, string[]> {
  const effects = entry.effects;
  assert.ok(
    typeof effects === "object" && effects !== null,
    `plan entry "${String(entry.stage)}" should carry an effects object: ${JSON.stringify(entry)}`,
  );
  return effects as Record<string, string[]>;
}

Given(
  "the agent runs Jolly in a fresh project directory",
  function (this: JollyWorld) {
    // projectDir is a freshly created scenario-scoped temp directory;
    // snapshot it so the no-files-touched assertion can compare after.
    this.notes.projectSnapshot = snapshotDir(this.projectDir);
  },
);

When(
  "the agent runs `jolly start --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(["start", "--dry-run", "--json"], { env: DRY_RUN_LOGIC_ENV });
  },
);

Then(
  "the output envelope data should mark the run as a dry run",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.data.dryRun,
      true,
      `envelope.data.dryRun should be true: ${JSON.stringify(this.envelope.data)}`,
    );
  },
);

Then(
  "the data should include a per-stage plan of intended effects: directories created, files written, network hosts contacted, and repositories cloned",
  function (this: JollyWorld) {
    const plan = planEntries(this);
    for (const entry of plan) {
      assert.ok(
        typeof entry.stage === "string" && entry.stage.length > 0,
        `plan entry should name its stage: ${JSON.stringify(entry)}`,
      );
      const effects = effectsOf(entry);
      for (const key of EFFECT_KEYS) {
        assert.ok(
          Array.isArray(effects[key]) &&
            effects[key].every((item) => typeof item === "string"),
          `plan stage "${entry.stage}" effects.${key} should be an array of strings: ${JSON.stringify(effects)}`,
        );
      }
    }
    // In a fresh project every stage is still to do, so each kind of
    // intended effect must appear somewhere in the plan: directories and
    // files from scaffolding, hosts from Saleor/Vercel/Stripe API calls,
    // and the Paper storefront repository clone.
    for (const key of EFFECT_KEYS) {
      const all = plan.flatMap((entry) => effectsOf(entry)[key]);
      assert.ok(
        all.length > 0,
        `a fresh-project plan should list at least one entry under ${key}: ${JSON.stringify(plan)}`,
      );
    }
  },
);

Then(
  "each side-effecting stage in the plan should carry a feature {int} riskContext",
  function (this: JollyWorld, _featureNum: number) {
    const plan = planEntries(this);
    const sideEffecting = plan.filter((entry) =>
      EFFECT_KEYS.some((key) => (effectsOf(entry)[key] ?? []).length > 0),
    );
    assert.ok(
      sideEffecting.length > 0,
      `a fresh-project plan should contain side-effecting stages: ${JSON.stringify(plan)}`,
    );
    for (const entry of sideEffecting) {
      assertRiskContextShape(entry.riskContext);
      assert.equal(
        (entry.riskContext as RiskContext).dryRunAvailable,
        true,
        `stage "${entry.stage}" riskContext.dryRunAvailable should be true — this very preview proves a dry run is available`,
      );
    }
  },
);

Then(
  "the preview must be distinguishable from execution progress, with nextSteps directing the agent to run `jolly start` to execute the plan",
  function (this: JollyWorld) {
    // Programmatic distinguishability: the `<command>-dry-run` check id
    // convention every other Jolly command follows, on top of data.dryRun.
    const check = this.findCheck("start-dry-run");
    assert.ok(
      check,
      `expected a "start-dry-run" check marking the preview: ${JSON.stringify(this.envelope.checks)}`,
    );
    assert.equal(check.status, "pass", "the start-dry-run check should pass");
    const steps = this.envelope.nextSteps.map((step) =>
      String(step.description ?? ""),
    );
    assert.ok(
      steps.some(
        (text) => /jolly start/.test(text) && !/--dry-run/.test(text),
      ),
      `nextSteps should direct the agent to run \`jolly start\` (without --dry-run) to execute the plan: ${JSON.stringify(steps)}`,
    );
  },
);

Then(
  "no files should be created or modified in the project directory",
  function (this: JollyWorld) {
    const before = this.notes.projectSnapshot as string[] | undefined;
    assert.ok(before, "the fresh-project Given must have run first");
    assert.deepEqual(
      snapshotDir(this.projectDir),
      before,
      "the dry run must not create or modify any file in the project directory",
    );
  },
);
