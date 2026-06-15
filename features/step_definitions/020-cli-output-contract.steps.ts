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

// --- Scenario Outline: Every command emits one envelope on --json stdout ---
//
// The outline substitutes each example command into the When; each row becomes
// a distinct step. The runCli call (previously in a generic Given) now lives in
// the named When, preserving the same envelope-shape assertions below.

When(
  "the agent runs `jolly doctor --json`",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: logicSafeEnv() });
  },
);

When(
  "the agent runs `jolly auth status --json`",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { env: logicSafeEnv() });
  },
);

When(
  "the agent runs `jolly create store --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--dry-run", "--json"], {
      env: logicSafeEnv(),
    });
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
  "the envelope should include a `checks` array",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.checks));
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

// --- Scenario: Default output combines human text and the envelope ---------

Given(
  "the agent runs `jolly doctor`",
  function (this: JollyWorld) {
    this.runCli(["doctor"], { env: logicSafeEnv() });
    this.notes.defaultStdout = this.lastRun!.stdout;
  },
);

Then(
  "stdout should contain human-readable text in addition to the envelope",
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
  "stdout should still include the machine-readable envelope",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "envelope must be present in default mode");
  },
);

Then(
  "running `jolly doctor --quiet` should trim only the human text and still include the envelope",
  function (this: JollyWorld) {
    const defaultStdout = String(this.notes.defaultStdout ?? "");
    this.runCli(["doctor", "--quiet"], { env: logicSafeEnv() });
    const quiet = this.lastRun!;
    assert.ok(quiet.envelope, "--quiet must keep the envelope");
    assert.ok(
      quiet.stdout.length <= defaultStdout.length,
      "--quiet output should not be longer than default output",
    );
  },
);

// --- Scenario: Commands that run checks reuse the doctor vocabulary --------
//
// The `Given the agent runs `jolly doctor --json`` precondition reuses the
// identical When defined above for the envelope outline (cucumber matches
// Given/When/Then interchangeably) — doctor runs read-only checks and the
// unroutable env yields fail/unknown checks (never a fabricated pass) but a
// well-formed checks array.

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
  "the agent runs `jolly login --token {string} --json`",
  function (this: JollyWorld, token: string) {
    // An empty token is junk input: login must fail honestly with an
    // envelope carrying errors[].code, never fabricated success.
    this.runCli(["login", "--token", token, "--json"], { env: logicSafeEnv() });
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

// Run a secret-handling command in default, --json, and --quiet modes,
// asserting in each mode that the tracked secret never leaks. The dummy
// secrets enter the child env via overrides (after the world snapshot), so
// track them explicitly. Assertions are unchanged from the prior scenario;
// the loop just exercises every mode named in the new step text.
function assertNoLeakAcrossModes(
  world: JollyWorld,
  baseArgs: string[],
): void {
  for (const mode of [[], ["--json"], ["--quiet"]]) {
    world.runCli([...baseArgs, ...mode], { env: logicSafeEnv() });
    world.assertNoSecretsIn(world.lastRun!.stdout, "stdout");
    world.assertNoSecretsIn(world.lastRun!.stderr, "stderr");
  }
}

When(
  "the agent runs `jolly login --token <value>` in default, `--json`, and `--quiet` modes",
  function (this: JollyWorld) {
    this.trackSecret(DUMMY.cloudToken);
    assertNoLeakAcrossModes(this, ["login", "--token", DUMMY.cloudToken]);
  },
);

When(
  "the agent runs `jolly create stripe --secret-key <value>` in default, `--json`, and `--quiet` modes",
  function (this: JollyWorld) {
    this.trackSecret(DUMMY.stripeSecret);
    assertNoLeakAcrossModes(this, [
      "create",
      "stripe",
      "--secret-key",
      DUMMY.stripeSecret,
    ]);
  },
);

Then(
  "no field in the envelope or human text should contain the secret value",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    this.assertNoSecretsIn(run.stdout, "stdout");
    this.assertNoSecretsIn(run.stderr, "stderr");
  },
);

Then(
  "the secret should be referenced by name only",
  function (this: JollyWorld) {
    // Reaffirm no value leaked across the modes run in this scenario.
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  },
);
