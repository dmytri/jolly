// Steps for features/020-cli-output-contract.feature (pinned contract).
// "Given Jolly is executable via `npx`" is defined in the feature 008 step
// file (shared step text).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertEnvelopeShape,
  type Envelope,
} from "../support/envelope.ts";
import type { CliResult, JollyWorld } from "../support/world.ts";

// A representative cross-section of the command surface: every command must
// share the one envelope shape.
const REPRESENTATIVE_COMMANDS: string[][] = [
  ["doctor"],
  ["auth", "status"],
  ["create", "storefront", "--dry-run"],
  ["create", "store", "--dry-run"],
];

Given(
  /^every command supports `--json`, `--quiet`, and \(for side-effecting commands\) `--dry-run`$/,
  function (this: JollyWorld) {
    // Pinned flag contract (feature 006); exercised throughout this file.
  },
);

// --- Agent parses any command through one envelope (@logic) -----------------------

Given(
  "the agent invokes any Jolly command with `--json`",
  function (this: JollyWorld) {
    this.notes.jsonRuns = REPRESENTATIVE_COMMANDS.map((args) =>
      this.runCli([...args, "--json"]),
    );
  },
);

// Shared by the two output-mode scenarios in this feature.
When("the command completes", function (this: JollyWorld) {
  assert.ok(this.lastRun, "no command was run");
});

Then(
  "stdout should contain a single JSON envelope and nothing else",
  function (this: JollyWorld) {
    for (const run of this.notes.jsonRuns as CliResult[]) {
      let parsed: unknown;
      assert.doesNotThrow(
        () => {
          parsed = JSON.parse(run.stdout.trim());
        },
        `--json stdout of \`jolly ${run.args.join(" ")}\` is not exactly one JSON document:\n${run.stdout}`,
      );
      assert.ok(
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
        "--json stdout is not a single JSON object",
      );
    }
  },
);

Then("the envelope should include a `command` identifier", function (this: JollyWorld) {
  for (const run of this.notes.jsonRuns as CliResult[]) {
    assert.equal(typeof run.envelope?.command, "string");
    assert.ok(run.envelope!.command.length > 0);
  }
});

Then(
  "the envelope should include a top-level `status` of `success`, `warning`, or `error`",
  function (this: JollyWorld) {
    for (const run of this.notes.jsonRuns as CliResult[]) {
      assert.ok(
        ["success", "warning", "error"].includes(run.envelope!.status),
        `unexpected status ${run.envelope!.status}`,
      );
    }
  },
);

Then("the envelope should include a human `summary` string", function (this: JollyWorld) {
  for (const run of this.notes.jsonRuns as CliResult[]) {
    assert.equal(typeof run.envelope?.summary, "string");
    assert.ok(run.envelope!.summary.trim().length > 0);
  }
});

Then(
  "the envelope should include a command-specific `data` object",
  function (this: JollyWorld) {
    for (const run of this.notes.jsonRuns as CliResult[]) {
      const data = run.envelope?.data;
      assert.ok(
        typeof data === "object" && data !== null && !Array.isArray(data),
        "envelope.data is not an object",
      );
    }
  },
);

Then("the envelope should include a `nextSteps` array", function (this: JollyWorld) {
  for (const run of this.notes.jsonRuns as CliResult[]) {
    assert.ok(Array.isArray(run.envelope?.nextSteps));
  }
});

Then(
  "the envelope should include an `errors` array that is empty on success",
  function (this: JollyWorld) {
    for (const run of this.notes.jsonRuns as CliResult[]) {
      assert.ok(Array.isArray(run.envelope?.errors));
      if (run.envelope!.status === "success") {
        assert.deepEqual(
          run.envelope!.errors,
          [],
          `\`jolly ${run.args.join(" ")}\` succeeded with non-empty errors`,
        );
      }
    }
  },
);

Then(
  "the agent should be able to parse the same shape regardless of which command produced it",
  function (this: JollyWorld) {
    for (const run of this.notes.jsonRuns as CliResult[]) {
      assertEnvelopeShape(run.envelope);
    }
  },
);

// --- Default output combines human text and the envelope (@logic) ------------------

Given(
  "the agent invokes a Jolly command without `--json`",
  function (this: JollyWorld) {
    this.notes.defaultRun = this.runCli(["doctor"]);
    this.notes.quietRun = this.runCli(["doctor", "--quiet"]);
  },
);

Then(
  "Jolly should print concise human-readable text for a developer reading along",
  function (this: JollyWorld) {
    const run = this.notes.defaultRun as CliResult;
    const humanText = run.stdout.replace(/\{[\s\S]*\}/, "").trim();
    assert.ok(humanText.length > 0, "default mode prints no human-readable text");
  },
);

Then(
  "it should still include the machine-readable envelope for the agent",
  function (this: JollyWorld) {
    const run = this.notes.defaultRun as CliResult;
    assert.ok(run.envelope, "default mode omits the machine-readable envelope");
    assertEnvelopeShape(run.envelope);
  },
);

Then(
  "`--quiet` should reduce nonessential human text without removing the envelope",
  function (this: JollyWorld) {
    const defaultRun = this.notes.defaultRun as CliResult;
    const quietRun = this.notes.quietRun as CliResult;
    assert.ok(quietRun.envelope, "--quiet removed the envelope");
    assert.ok(
      quietRun.stdout.length <= defaultRun.stdout.length,
      "--quiet did not reduce output",
    );
  },
);

// --- Commands that run checks reuse the doctor vocabulary (@logic) ------------------

Given(
  "a command performs verification such as `jolly start` or `jolly doctor`",
  function (this: JollyWorld) {
    // An empty project guarantees at least one non-passing check with guidance.
    this.runCli(["doctor", "--json"]);
  },
);

When("it reports check results in the envelope", function (this: JollyWorld) {
  assert.ok(this.envelope.checks.length > 0, "doctor reported no checks");
});

Then("each check should appear in a `checks` array", function (this: JollyWorld) {
  assert.ok(Array.isArray(this.envelope.checks));
});

Then("each check should carry a stable check id", function (this: JollyWorld) {
  for (const check of this.envelope.checks) {
    assert.equal(typeof check.id, "string");
    assert.ok(check.id.length > 0, "a check has an empty id");
  }
  // Stability: a second run reports the same ids.
  const again = this.runCli(["doctor", "--json"]);
  assert.deepEqual(
    again.envelope!.checks.map((c) => c.id).sort(),
    this.envelope.checks.map((c) => c.id).sort(),
    "check ids are not stable across runs",
  );
});

Then(
  "each check `status` should be one of pass, warning, fail, skipped, or unknown",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      assert.ok(
        ["pass", "warning", "fail", "skipped", "unknown"].includes(
          String(check.status),
        ),
        `check ${check.id} has status ${check.status}`,
      );
    }
  },
);

Then(
  "each check should be able to carry a concrete next command or manual step",
  function (this: JollyWorld) {
    // In an empty project at least one check is not passing; that check (or
    // the envelope's nextSteps) must carry concrete guidance.
    const guided = this.envelope.checks.some(
      (c) => typeof c.remediation === "string" && (c.remediation as string).length > 0,
    );
    assert.ok(
      guided || this.envelope.nextSteps.length > 0,
      "no check carries a concrete next command or manual step",
    );
  },
);

// --- Agent branches on stable codes (@logic) -----------------------------------------

Given("a command fails or partially succeeds", function (this: JollyWorld) {
  this.notes.failedRun = this.runCli(["create", "nonexistent-resource", "--json"]);
});

When("the agent inspects the envelope", function (this: JollyWorld) {
  const run = this.notes.failedRun as CliResult;
  assert.ok(run.envelope, "the failing command emitted no envelope");
  assert.equal(run.envelope!.status, "error", "the failing command did not report error status");
});

Then(
  "each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`",
  function (this: JollyWorld) {
    const envelope = (this.notes.failedRun as CliResult).envelope as Envelope;
    assert.ok(envelope.errors.length > 0, "the failure carries no errors[] entries");
    for (const error of envelope.errors) {
      assert.equal(typeof error.code, "string");
      assert.ok((error.code as string).length > 0);
      assert.equal(typeof error.message, "string");
    }
  },
);

Then(
  "the documented `code` and check id strings should remain stable so the agent can branch on them programmatically",
  function (this: JollyWorld) {
    const first = (this.notes.failedRun as CliResult).envelope as Envelope;
    const second = this.runCli(["create", "nonexistent-resource", "--json"]).envelope!;
    assert.deepEqual(
      second.errors.map((e) => e.code),
      first.errors.map((e) => e.code),
      "error codes are not stable across identical runs",
    );
  },
);

// --- Output never exposes secrets (@logic) -------------------------------------------

Given(
  "a command handles secret values such as tokens or API keys",
  function (this: JollyWorld) {
    this.notes.canary = "jolly-canary-secret-0451";
    this.trackSecret(this.notes.canary as string);
    this.notes.secretEnv = {
      JOLLY_SALEOR_APP_TOKEN: this.notes.canary as string,
      JOLLY_SALEOR_CLOUD_TOKEN: this.notes.canary as string,
      JOLLY_STRIPE_SECRET_KEY: `sk_test_${this.notes.canary as string}`,
      JOLLY_VERCEL_TOKEN: this.notes.canary as string,
    };
    this.trackSecret(`sk_test_${this.notes.canary as string}`);
  },
);

When("it produces output in any mode", function (this: JollyWorld) {
  const env = this.notes.secretEnv as Record<string, string>;
  this.notes.secretRuns = [
    this.runCli(["doctor", "--json"], { env }),
    this.runCli(["doctor"], { env }),
    this.runCli(["auth", "status", "--json"], { env }),
    this.runCli(["auth", "status", "--quiet"], { env }),
  ];
});

Then(
  "no field in the envelope or human text should contain a secret value",
  function (this: JollyWorld) {
    for (const run of this.notes.secretRuns as CliResult[]) {
      this.assertNoSecretsIn(
        run.stdout + run.stderr,
        `output of \`jolly ${run.args.join(" ")}\``,
      );
    }
  },
);

Then("secrets should be referenced by name only", function (this: JollyWorld) {
  const combined = (this.notes.secretRuns as CliResult[])
    .map((run) => run.stdout)
    .join("\n");
  assert.match(
    combined,
    /JOLLY_[A-Z_]*(TOKEN|KEY)/,
    "secret-handling output never references any secret by its variable name",
  );
});
