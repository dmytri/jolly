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
