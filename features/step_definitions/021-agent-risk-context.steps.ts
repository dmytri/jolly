// Feature 021 — Structured agent risk context.
//
// These @logic scenarios pin that every side-effecting command emits a
// feature-021 riskContext carried INSIDE the feature-020 envelope (data and/or
// checks), with the full shape (action/target/riskLevel/categories/reversible/
// sideEffects/dryRunAvailable), categories drawn only from the feature-010
// high-risk list, and that the riskContext is identical in structure for a
// --dry-run preview and a real run. The @sandbox "consistent across preview and
// execution" scenario runs against a real endpoint (skips locally).
//
// Safety: every command runs under logicSafeEnv() — dummy credentials for all
// groups + an unroutable `.invalid` Cloud API base — so the "real execution"
// comparison can never reach a real account (the "012 incident" lesson).
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertRiskContextShape,
  findRiskContexts,
  RISK_CATEGORIES,
  type RiskContext,
} from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background ------------------------------------------------------------

Given(
  "approval granularity is decided by the customer's agent, not hardcoded by Jolly",
  function () {
    // Capability statement; verified by the riskContext-only contract below.
  },
);

Given("side-effecting commands support `--dry-run`", function () {
  // Capability statement; exercised per-scenario.
});

// --- Scenario: Jolly exposes risk context before an impactful action -------

Given(
  "a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource",
  function (this: JollyWorld) {
    // `create store --create-environment --dry-run` is a representative
    // impactful action: it prepares a remote environment-creation request.
    this.runCli(
      ["create", "store", "--create-environment", "--dry-run", "--json"],
      { env: logicSafeEnv() },
    );
  },
);

When("Jolly prepares to perform the action", function (this: JollyWorld) {
  // The action was prepared in the Given (dry-run preview).
  assert.ok(this.lastRun?.envelope, "expected an envelope from the prepared action");
});

function onlyRiskContext(world: JollyWorld): RiskContext {
  const contexts = findRiskContexts(world.envelope);
  assert.ok(contexts.length > 0, "expected a riskContext inside the envelope");
  const rc = contexts[0];
  assertRiskContextShape(rc);
  return rc;
}

Then(
  "it should expose a structured `riskContext` for the agent to assess",
  function (this: JollyWorld) {
    onlyRiskContext(this);
  },
);

Then(
  "the `riskContext` should include the `action` being performed",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.equal(typeof rc.action, "string");
    assert.ok(rc.action.length > 0, "action must be non-empty");
  },
);

Then(
  "it should include the `target` resource and its scope",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.ok(rc.target !== undefined && rc.target !== null, "target is required");
  },
);

Then(
  "it should include a `riskLevel` of low, medium, or high",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.ok(["low", "medium", "high"].includes(rc.riskLevel));
  },
);

Then(
  "it should include the applicable risk `categories`",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.ok(Array.isArray(rc.categories));
    for (const category of rc.categories) {
      assert.ok(
        RISK_CATEGORIES.includes(category as never),
        `category "${category}" not in the feature 010 high-risk list`,
      );
    }
  },
);

Then(
  "it should include whether the action is `reversible`",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.equal(typeof rc.reversible, "boolean");
  },
);

Then(
  "it should include the expected `sideEffects`",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.ok(Array.isArray(rc.sideEffects));
  },
);

Then(
  "it should include whether a dry run is available via `dryRunAvailable`",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.equal(typeof rc.dryRunAvailable, "boolean");
  },
);

Then(
  "the customer's agent should decide whether to ask for human approval based on this context",
  function (this: JollyWorld) {
    // Jolly never hardcodes the approval decision: the envelope carries the
    // riskContext but no approve/deny verdict field.
    const rc = onlyRiskContext(this) as unknown as Record<string, unknown>;
    for (const verdictKey of ["approved", "approve", "denied", "decision", "autoApprove"]) {
      assert.ok(
        !(verdictKey in rc),
        `riskContext must not embed an approval verdict ("${verdictKey}")`,
      );
    }
  },
);

// --- @sandbox: Risk context is consistent across preview and execution -----
// Runs against a real endpoint; skips locally (saleorEndpoint gated). The body
// is written for credentialed CI: the dry-run and real riskContexts must match.

Given("a command supports `--dry-run`", function (this: JollyWorld) {
  // The command under test is `create store --url ...`, which has a producible
  // real execution (writes the endpoint to .env) and a --dry-run preview.
  this.notes.riskContextUrl = "https://example.saleor.cloud/graphql/";
});

When(
  "the agent previews the action with `--dry-run`",
  function (this: JollyWorld) {
    const url = String(this.notes.riskContextUrl);
    this.runCli(["create", "store", "--url", url, "--dry-run", "--json"]);
    const preview = findRiskContexts(this.envelope);
    assert.ok(preview.length > 0, "preview must carry a riskContext");
    this.notes.previewRiskContext = preview[0];
  },
);

Then(
  "the `riskContext` shown in preview should match the `riskContext` for real execution",
  function (this: JollyWorld) {
    const url = String(this.notes.riskContextUrl);
    // Real execution writes to the scenario's temp project .env (harmless).
    this.runCli(["create", "store", "--url", url, "--json"]);
    const real = findRiskContexts(this.envelope);
    assert.ok(real.length > 0, "real execution must carry a riskContext");
    this.notes.realRiskContext = real[0];
    assert.deepEqual(
      this.notes.realRiskContext,
      this.notes.previewRiskContext,
      "real-execution riskContext must equal the dry-run preview riskContext",
    );
  },
);

Then(
  "the real execution output must include a `riskContext` identical to the dry-run preview",
  function (this: JollyWorld) {
    assert.deepEqual(
      this.notes.realRiskContext,
      this.notes.previewRiskContext,
      "real-execution riskContext must be identical to the preview",
    );
  },
);

// `no remote side effects should occur during the dry run` is defined once in
// 001-agent-first-cli-and-onboarding.steps.ts (shared across features).

// --- Scenario: Risk context travels in the standard envelope ---------------

Given(
  "a command produces output with `--json`",
  function (this: JollyWorld) {
    this.runCli(["create", "stripe", "--dry-run", "--json"], {
      env: logicSafeEnv(),
    });
  },
);

// `When the output describes an impactful action` is defined in 020's steps.

Then(
  "the `riskContext` should be carried inside the output envelope `data` and\\/or `checks`",
  function (this: JollyWorld) {
    // findRiskContexts only looks inside envelope.data and envelope.checks.
    const contexts = findRiskContexts(this.envelope);
    assert.ok(
      contexts.length > 0,
      "riskContext must be carried inside the envelope data and/or checks",
    );
  },
);

Then(
  "it should not use a separate ad hoc format outside the feature {int} envelope",
  function (this: JollyWorld, _feature: number) {
    // The only JSON object on stdout is the envelope itself; the riskContext
    // lives inside it, never as a sibling top-level object.
    const trimmed = this.lastRun!.stdout.trim();
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    assert.ok("command" in parsed, "the sole stdout object must be the envelope");
    assert.ok(
      !("riskContext" in parsed),
      "riskContext must not be a sibling of the envelope; it lives inside data/checks",
    );
  },
);

// --- Scenario: High-risk categories are surfaced explicitly ----------------

Given(
  "an action falls into a high-risk category",
  function (this: JollyWorld) {
    // `create stripe` is payment setup + credential handling — two high-risk
    // categories — making it a representative high-risk action.
    this.runCli(
      ["create", "stripe", "--publishable-key", "pk_test_x", "--secret-key", "sk_test_x", "--dry-run", "--json"],
      { env: logicSafeEnv() },
    );
  },
);

When("Jolly builds its `riskContext`", function (this: JollyWorld) {
  assert.ok(this.lastRun?.envelope, "expected an envelope carrying riskContext");
});

Then(
  "the relevant categories should be listed explicitly",
  function (this: JollyWorld) {
    const rc = onlyRiskContext(this);
    assert.ok(rc.categories.length > 0, "high-risk action must list categories");
    for (const category of rc.categories) {
      assert.ok(
        RISK_CATEGORIES.includes(category as never),
        `category "${category}" not in the high-risk list`,
      );
    }
  },
);

Then(
  "destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category",
  function () {
    // The feature-010 high-risk vocabulary is exactly the categories the
    // envelope validator (RISK_CATEGORIES) enforces on every riskContext.
    assert.deepEqual(
      [...RISK_CATEGORIES].sort(),
      [
        "billing",
        "credential handling",
        "destructive operations",
        "live deployment",
        "payment setup",
        "production configuration changes",
      ],
    );
  },
);

// --- Scenario: Jolly start pauses for agent approval before each high-risk stage (@logic)
//
// Under "Agent-supervised orchestration" (feature 002), `jolly start` runs the
// high-risk stages itself and PAUSES for the agent's approval before each one,
// emitting that stage's riskContext (identical to its --dry-run form). A
// pre-authorization flag (`--yes`) approves up front so it proceeds without
// per-stage pauses, still emitting each riskContext for the record.
//
// Reaching the first high-risk stage (`create store`) only requires bootstrap +
// a present Cloud token; logicSafeEnv supplies a dummy one, so the run pauses at
// the create-store approval gate BEFORE making any network call — and the
// unroutable base means a `--yes` run that proceeds can never reach a real
// account.

interface StartStage {
  stage: string;
  status: string;
  riskContext?: unknown;
}

function startStages(envelopeData: Record<string, unknown>): StartStage[] {
  const raw = (envelopeData as { stages?: unknown }).stages;
  assert.ok(Array.isArray(raw), "jolly start must report data.stages as an array");
  return raw as StartStage[];
}

Given(
  "the agent runs `jolly start` without a pre-authorization flag",
  function (this: JollyWorld) {
    // No --yes: the run must pause for the agent's approval at each high-risk
    // stage. The When step runs it.
  },
);

When(
  "`jolly start` reaches a high-risk stage \\(`create store`, `@saleor\\/configurator deploy`, or the `npx vercel` deploy)",
  function (this: JollyWorld) {
    // Real run with no --yes: pauses at the first high-risk approval gate.
    this.runCli(["start", "--json"], { env: logicSafeEnv() });
    const realEnvelope = this.envelope;
    this.notes.startEnvelope = realEnvelope;
    const stagesList = startStages(realEnvelope.data);
    this.notes.approvalStage = stagesList.find((s) => s.status === "awaiting-approval");
    // The --dry-run plan, to compare each stage's riskContext against.
    const dry = this.runCli(["start", "--dry-run", "--json"], { env: logicSafeEnv() });
    this.notes.dryPlan =
      (dry.envelope?.data as { plan?: Array<Record<string, unknown>> }).plan ?? [];
  },
);

Then(
  "it should emit that stage's `riskContext` in the feature {int} envelope before performing the action",
  function (this: JollyWorld, _featureNum: number) {
    const stage = this.notes.approvalStage as StartStage | undefined;
    assert.ok(
      stage,
      "start (no --yes) must report a high-risk stage awaiting the agent's approval",
    );
    assert.ok(stage!.riskContext, `the awaiting-approval stage "${stage!.stage}" must carry a riskContext`);
    assertRiskContextShape(stage!.riskContext);
    // The riskContext is carried inside the feature 020 envelope.
    const realEnvelope = this.notes.startEnvelope as typeof this.envelope;
    assert.ok(
      findRiskContexts(realEnvelope).length > 0,
      "the high-risk stage's riskContext must live inside the envelope",
    );
  },
);

Then(
  "it should pause for the agent to approve and not self-approve or perform the action",
  function (this: JollyWorld) {
    const realEnvelope = this.notes.startEnvelope as typeof this.envelope;
    // Paused at a gate, never reported as success/completed.
    assert.equal(
      realEnvelope.status,
      "warning",
      "a run paused for approval must report envelope status warning, not success",
    );
    const stage = this.notes.approvalStage as StartStage;
    assert.equal(stage.status, "awaiting-approval", "the high-risk stage must await approval");
    // Jolly never self-approves: the riskContext carries no approval verdict.
    const rc = stage.riskContext as Record<string, unknown>;
    for (const verdictKey of ["approved", "approve", "denied", "decision", "autoApprove"]) {
      assert.ok(!(verdictKey in rc), `riskContext must not embed an approval verdict ("${verdictKey}")`);
    }
  },
);

Then(
  "the emitted `riskContext` should be identical to the one shown for that stage under `--dry-run`",
  function (this: JollyWorld) {
    const stage = this.notes.approvalStage as StartStage;
    const dryPlan = this.notes.dryPlan as Array<Record<string, unknown>>;
    const dryStage = dryPlan.find((s) => s.stage === stage.stage);
    assert.ok(
      dryStage,
      `the --dry-run plan must include the high-risk stage "${stage.stage}" for comparison`,
    );
    assert.deepEqual(
      stage.riskContext,
      dryStage!.riskContext,
      "the real-run riskContext must be identical to the --dry-run preview for that stage",
    );
  },
);

Then(
  "running `jolly start --yes` should pre-approve and proceed through the high-risk stages without per-stage pauses, still emitting each `riskContext` for the record",
  function (this: JollyWorld) {
    // --yes pre-approves: no stage is left awaiting the agent's approval, yet
    // each high-risk stage's riskContext is still emitted for the record. The
    // unroutable logic-safe base means any stage that proceeds cannot reach a
    // real account.
    this.runCli(["start", "--yes", "--json"], { env: logicSafeEnv() });
    const yesEnvelope = this.envelope;
    const awaiting = startStages(yesEnvelope.data).filter((s) => s.status === "awaiting-approval");
    assert.equal(
      awaiting.length,
      0,
      "with --yes there must be no stage left awaiting per-stage approval",
    );
    assert.ok(
      findRiskContexts(yesEnvelope).length > 0,
      "each high-risk stage's riskContext must still be emitted for the record under --yes",
    );
  },
);
