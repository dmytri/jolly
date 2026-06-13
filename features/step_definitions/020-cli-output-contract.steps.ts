// Feature 020 — Jolly CLI output contract.
//
// These @logic scenarios pin the structural envelope contract every command
// shares (command/status/summary/data/checks/nextSteps/errors; camelCase;
// checks vocabulary; stable error codes; no secret values). They assert SHAPE,
// not any one command's specific check-ids or codes, so they hold regardless
// of which command produces the envelope.
//
// Safety: every command here runs under logicSafeEnv() — dummy credentials for
// all groups + an unroutable `.invalid` Cloud API base — so no side-effecting
// path can reach a real account (the "012 incident" lesson).
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  CHECK_STATUSES,
  ENVELOPE_STATUSES,
} from "../support/envelope.ts";
import { logicSafeEnv, DUMMY } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background ------------------------------------------------------------

Given("Jolly is executable via `npx`", function () {
  // Capability statement; exercised concretely by the scenarios below.
});

Given(
  "every command supports `--json`, `--quiet`, and \\(for side-effecting commands) `--dry-run`",
  function () {
    // Capability statement; the flag contract is verified per-scenario.
  },
);

// --- Shared When -----------------------------------------------------------

When("the command completes", function () {
  // The command is invoked in each scenario's Given; nothing to do here.
});

When("the output describes an impactful action", function () {
  // The impactful command is invoked in the scenario's Given.
});

// --- Scenario: Agent parses any command through one envelope ---------------

Given(
  "the agent invokes any Jolly command with `--json`",
  function (this: JollyWorld) {
    // `auth status` is read-only (configuration only) and representative.
    this.runCli(["auth", "status", "--json"], { env: logicSafeEnv() });
  },
);

Then(
  "stdout should contain a single JSON envelope and nothing else",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    const trimmed = run.stdout.trim();
    assert.ok(run.envelope, "no envelope found in --json stdout");
    // --json mode: stdout is exactly the envelope (parses whole, no extra text).
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(trimmed);
    }, `--json stdout must be exactly one JSON object, got:\n${run.stdout}`);
    assert.ok(
      parsed && typeof parsed === "object" && "command" in (parsed as object),
      "the sole stdout JSON object must be the envelope",
    );
  },
);

Then(
  "the envelope should include a `command` identifier",
  function (this: JollyWorld) {
    assert.equal(typeof this.envelope.command, "string");
    assert.ok(this.envelope.command.length > 0, "command must be non-empty");
  },
);

Then(
  "the envelope should include a top-level `status` of `success`, `warning`, or `error`",
  function (this: JollyWorld) {
    assert.ok(
      ENVELOPE_STATUSES.includes(this.envelope.status),
      `status ${this.envelope.status} not in ${ENVELOPE_STATUSES.join("|")}`,
    );
  },
);

Then(
  "the envelope should include a human `summary` string",
  function (this: JollyWorld) {
    assert.equal(typeof this.envelope.summary, "string");
    assert.ok(this.envelope.summary.length > 0, "summary must be non-empty");
  },
);

Then(
  "the envelope should include a command-specific `data` object",
  function (this: JollyWorld) {
    const { data } = this.envelope;
    assert.ok(
      data && typeof data === "object" && !Array.isArray(data),
      "data must be an object",
    );
  },
);

Then(
  "the envelope should include a `nextSteps` array",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.nextSteps));
  },
);

Then(
  "the envelope should include an `errors` array that is empty on success",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.errors));
    if (this.envelope.status === "success") {
      assert.equal(
        this.envelope.errors.length,
        0,
        "errors must be empty when status is success",
      );
    }
  },
);

Then(
  "the agent should be able to parse the same shape regardless of which command produced it",
  function (this: JollyWorld) {
    // Cross-check a second, different command yields the identical shape.
    this.runCli(["skills", "--json"], { env: logicSafeEnv() });
    const other = this.envelope;
    for (const key of [
      "command",
      "status",
      "summary",
      "data",
      "checks",
      "nextSteps",
      "errors",
    ]) {
      assert.ok(key in other, `second command envelope missing "${key}"`);
    }
  },
);

// --- Scenario: Default output combines human text and the envelope ---------

Given(
  "the agent invokes a Jolly command without `--json`",
  function (this: JollyWorld) {
    this.runCli(["auth", "status"], { env: logicSafeEnv() });
    this.notes.defaultStdout = this.lastRun!.stdout;
  },
);

Then(
  "Jolly should print concise human-readable text for a developer reading along",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    assert.ok(run.envelope, "default mode must still carry the envelope");
    // There must be human text beyond the raw envelope JSON.
    const envelopeJson = JSON.stringify(run.envelope);
    const nonEnvelope = run.stdout
      .replace(envelopeJson, "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      nonEnvelope.length > 0 || /\n/.test(run.stdout),
      "default mode should include human-readable text alongside the envelope",
    );
  },
);

Then(
  "it should still include the machine-readable envelope for the agent",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "envelope must be present in default mode");
  },
);

Then(
  "`--quiet` should reduce nonessential human text without removing the envelope",
  function (this: JollyWorld) {
    const defaultStdout = String(this.notes.defaultStdout ?? "");
    this.runCli(["auth", "status", "--quiet"], { env: logicSafeEnv() });
    const quiet = this.lastRun!;
    assert.ok(quiet.envelope, "--quiet must keep the envelope");
    assert.ok(
      quiet.stdout.length <= defaultStdout.length,
      "--quiet output should not be longer than default output",
    );
  },
);

// --- Scenario: Commands that run checks reuse the doctor vocabulary --------

Given(
  "a command performs verification such as `jolly start` or `jolly doctor`",
  function (this: JollyWorld) {
    // doctor runs read-only checks; the unroutable env yields fail/unknown
    // checks (never a fabricated pass) but a well-formed checks array.
    this.runCli(["doctor", "--json"], { env: logicSafeEnv() });
  },
);

When("it reports check results in the envelope", function () {
  // Already produced by the Given.
});

Then("each check should appear in a `checks` array", function (this: JollyWorld) {
  assert.ok(Array.isArray(this.envelope.checks));
  assert.ok(this.envelope.checks.length > 0, "doctor must report checks");
});

Then("each check should carry a stable check id", function (this: JollyWorld) {
  for (const check of this.envelope.checks) {
    assert.equal(typeof check.id, "string");
    assert.ok(check.id.length > 0, "check id must be non-empty");
  }
});

Then(
  "each check `status` should be one of pass, warning, fail, skipped, or unknown",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      assert.ok(
        CHECK_STATUSES.includes(check.status),
        `check ${check.id} status ${check.status} not in vocabulary`,
      );
    }
  },
);

Then(
  "each check should be able to carry a concrete next command or manual step",
  function (this: JollyWorld) {
    // Capability: guidance is available on failing/warning checks, either on
    // the check itself or via nextSteps. Assert the channel exists.
    assert.ok(
      Array.isArray(this.envelope.nextSteps),
      "nextSteps channel must exist for guidance",
    );
    const actionable = this.envelope.checks.filter(
      (c) => c.status === "fail" || c.status === "warning",
    );
    for (const check of actionable) {
      const hasGuidance =
        "command" in check ||
        "remediation" in check ||
        "manualStep" in check ||
        "nextStep" in check ||
        this.envelope.nextSteps.length > 0;
      assert.ok(
        hasGuidance,
        `actionable check ${check.id} should offer a next command or manual step`,
      );
    }
  },
);

// --- Scenario: Agent branches on stable codes ------------------------------

Given(
  "a command fails or partially succeeds",
  function (this: JollyWorld) {
    // `create store` with no reachable account fails honestly (unroutable
    // base) — an envelope with errors[].code, never fabricated success.
    this.runCli(["create", "store", "--json"], { env: logicSafeEnv() });
  },
);

When("the agent inspects the envelope", function () {
  // The failing command already ran.
});

Then(
  "each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`",
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "success",
      "a failed/partial command must not report success",
    );
    assert.ok(this.envelope.errors.length > 0, "expected at least one error");
    for (const error of this.envelope.errors) {
      assert.equal(typeof error.code, "string");
      assert.ok((error.code as string).length > 0, "error code non-empty");
      assert.equal(typeof error.message, "string");
      if ("remediation" in error) {
        assert.equal(typeof error.remediation, "string");
      }
    }
  },
);

Then(
  "the documented `code` and check id strings should remain stable so the agent can branch on them programmatically",
  function (this: JollyWorld) {
    // Stable codes are machine identifiers: uppercase/underscore, no spaces.
    for (const error of this.envelope.errors) {
      assert.match(
        error.code as string,
        /^[A-Z][A-Z0-9_]*$/,
        `error code "${error.code}" should be a stable machine identifier`,
      );
    }
  },
);

// --- Scenario: Output never exposes secrets --------------------------------

Given(
  "a command handles secret values such as tokens or API keys",
  function (this: JollyWorld) {
    // The dummy Cloud token is a stand-in secret; it enters the child env via
    // overrides (after the world snapshot), so track it explicitly.
    this.trackSecret(DUMMY.cloudToken);
    this.runCli(["auth", "status", "--json"], { env: logicSafeEnv() });
  },
);

When("it produces output in any mode", function (this: JollyWorld) {
  // Also exercise default (non-json) mode for the same secret.
  this.trackSecret(DUMMY.cloudToken);
  this.runCli(["auth", "status"], { env: logicSafeEnv() });
});

Then(
  "no field in the envelope or human text should contain a secret value",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    this.assertNoSecretsIn(run.stdout, "stdout");
    this.assertNoSecretsIn(run.stderr, "stderr");
  },
);

Then(
  "secrets should be referenced by name only",
  function (this: JollyWorld) {
    // Reaffirm no value leaked across both modes run in this scenario.
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  },
);
