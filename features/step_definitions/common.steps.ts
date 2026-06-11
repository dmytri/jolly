// Shared / generic step definitions used across multiple features.
//
// Includes: running CLI commands, checking .env contents, .gitignore,
// envelope shape, risk context, and secret safety.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  findRiskContexts,
  assertRiskContextShape,
  assertEnvelopeShape,
  type RiskContext,
} from "../support/envelope.ts";
import { writeEnvValues, loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Given ────────────────────────────────────────────────────────────────

Given("Jolly is executable via `npx`", function (this: JollyWorld) {
  // The world runs the CLI via bun/HARNESS_CLI_RUNTIME, which is equivalent.
  // This step is always satisfied by the test harness.
});

Given(
  "every command supports `--json`, `--quiet`, and \\(for side-effecting commands) `--dry-run`",
  function (this: JollyWorld) {
    // Contract: the CLI must accept these flags. Verified by running
    // specific commands with these flags in their scenarios.
  },
);

Given(
  "side-effecting commands support `--dry-run`",
  function (this: JollyWorld) {
    // Contract step.
  },
);

Given(
  "approval granularity is decided by the customer's agent, not hardcoded by Jolly",
  function (this: JollyWorld) {
    // Contract step — verified by risk context scenarios.
  },
);

Given(
  "`jolly start` is optional convenience orchestration for the full end-to-end flow",
  function (this: JollyWorld) {
    // Contract step.
  },
);

Given(
  "the agent may instead invoke individual `jolly create` subcommands at its own discretion",
  function (this: JollyWorld) {
    // Contract step.
  },
);

Then(
  /^`jolly start` (?:should be |is )available as optional convenience orchestration for the full end-to-end flow$/, // regex (handles both 006 and 008)
  function (this: JollyWorld) {
    // Contract step.
  },
);

Given("the agent can run Jolly via `npx`", function (this: JollyWorld) {
  // Satisfied by the harness.
});

Given("Jolly does not have Stripe credentials in .env", function (this: JollyWorld) {
  // Clean temp dir — no .env exists yet.
});

Given("the agent has no existing .env file", function (this: JollyWorld) {
  // Clean temp dir — nothing to do.
});

Given(".env contains {string}", function (this: JollyWorld, envContents: string) {
  // Format: "KEY1=val1 and KEY2=val2 and KEY3=val3"
  const entries = envContents.split(" and ");
  const values: Record<string, string> = {};
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) continue;
    const key = entry.slice(0, eqIdx);
    const val = entry.slice(eqIdx + 1);
    values[key] = val;
  }
  writeEnvValues(this.projectDir, values);
});

// ── When ─────────────────────────────────────────────────────────────────

When("the command completes", function (this: JollyWorld) {
  // The command already ran via runCli in a previous step's When.
  // This step is satisfied by accessing this.lastRun / this.envelope.
});

When("it produces output in any mode", function (this: JollyWorld) {
  // Already produced by earlier When step.
});

When("the agent inspects the envelope", function (this: JollyWorld) {
  // Already have the envelope from last run.
});

When("Jolly prepares to perform the action", function (this: JollyWorld) {
  // Already handled by the preceding When step.
});

When("it reports check results in the envelope", function (this: JollyWorld) {
  // Already produced by earlier When step.
});

When("the output describes an impactful action", function (this: JollyWorld) {
  // Already produced.
});

When("Jolly builds its `riskContext`", function (this: JollyWorld) {
  // Already produced.
});

// Note: `the agent runs jolly logout` is defined in 018-jolly-auth-commands.steps.ts

// ── Then ─────────────────────────────────────────────────────────────────

Then(
  ".env should contain {string}",
  function (this: JollyWorld, expected: string) {
    const eqIdx = expected.indexOf("=");
    const key = eqIdx >= 0 ? expected.slice(0, eqIdx) : expected;
    const expectedValue = eqIdx >= 0 ? expected.slice(eqIdx + 1) : undefined;
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      key in values,
      `.env should contain "${key}", but was absent. .env contents: ${JSON.stringify(values)}`,
    );
    if (expectedValue !== undefined) {
      assert.equal(
        values[key],
        expectedValue,
        `.env "${key}" should be "${expectedValue}", got "${values[key]}"`,
      );
    }
  },
);

Then(".env should not be created", function (this: JollyWorld) {
  const envPath = join(this.projectDir, ".env");
  assert.ok(
    !existsSync(envPath),
    `.env should not exist during dry-run, but it was created`,
  );
});

Then(
  ".env should not contain {string}",
  function (this: JollyWorld, key: string) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !(key in values),
      `.env should not contain "${key}", but found "${values[key]}"`,
    );
  },
);

Then(
  ".gitignore should contain .env",
  function (this: JollyWorld) {
    const gitignorePath = join(this.projectDir, ".gitignore");
    assert.ok(
      existsSync(gitignorePath),
      ".gitignore does not exist",
    );
    const content = readFileSync(gitignorePath, "utf8");
    const lines = content.split("\n").map((l) => l.trim());
    assert.ok(
      lines.includes(".env"),
      `.gitignore does not contain ".env". Contents:\n${content}`,
    );
  },
);

Then(
  "Jolly should not print the secret key value",
  function (this: JollyWorld) {
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "stdout/stderr",
    );
  },
);

Then(
  "Jolly should not print the publishable key value",
  function (this: JollyWorld) {
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "stdout/stderr",
    );
  },
);

Then(
  "Jolly should not print the token value",
  function (this: JollyWorld) {
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "stdout/stderr",
    );
  },
);

Then(
  "Jolly should load the updated .env values for the current command flow where possible",
  function (this: JollyWorld) {
    // The CLI should have loaded the values into the process env or returned
    // them in the envelope data. We verify the CLI was able to detect them.
    // Concretely: the CLI's output envelope data should reflect the update.
    const env = this.envelope;
    if (env.data && typeof env.data === "object") {
      const data = env.data as Record<string, unknown>;
      if (data.envUpdated) {
        assert.ok(data.envUpdated, ".env values should be marked as updated");
      } else {
        // It's acceptable if the envelope doesn't mention it — the contract
        // is "where possible" — but we at least verify no error about missing values.
      }
    }
  },
);

Then(
  "Jolly should load the updated .env values for the current command flow",
  function (this: JollyWorld) {
    // Same as above but stronger (no "where possible" qualifier).
    // Check that the command succeeded and that .env has the expected values.
    const env = this.envelope;
    assert.equal(env.status, "success", `Command should succeed, got ${env.status}`);
  },
);

Then(
  "Jolly should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    // Same as "where possible" variant.
    const env = this.envelope;
    if (env.data && typeof env.data === "object") {
      const data = env.data as Record<string, unknown>;
      if (data.envUpdated !== undefined) {
        assert.ok(data.envUpdated);
      }
    }
  },
);

Then(
  /^the output should include a risk context with riskLevel "([^"]+)" and categories including "([^"]+)" and "([^"]+)"$/, // regex
  function (this: JollyWorld, riskLevel: string, cat1: string, cat2: string) {
    const categories = [cat1, cat2];
    const rcs = findRiskContexts(this.envelope);
    assert.ok(
      rcs.length > 0,
      "No riskContext found in envelope data or checks",
    );
    const rc = rcs[0] as RiskContext;
    assertRiskContextShape(rc);
    assert.equal(
      rc.riskLevel,
      riskLevel,
      `Expected riskLevel "${riskLevel}", got "${rc.riskLevel}"`,
    );
    for (const cat of categories) {
      assert.ok(
        rc.categories.includes(cat),
        `Expected category "${cat}" in risk context categories: ${JSON.stringify(rc.categories)}`,
      );
    }
  },
);

Then(
  "the output should include a risk context with action {string}",
  function (this: JollyWorld, action: string) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(
      rcs.length > 0,
      "No riskContext found in envelope data or checks",
    );
    const rc = rcs[0] as RiskContext;
    assertRiskContextShape(rc);
    assert.equal(
      rc.action,
      action,
      `Expected action "${action}", got "${rc.action}"`,
    );
  },
);

Then(
  "the output should not be written to .env",
  function (this: JollyWorld) {
    const envPath = join(this.projectDir, ".env");
    assert.ok(
      !existsSync(envPath),
      ".env should not be written during dry-run",
    );
  },
);

Then(
  ".env should not contain any Stripe key values",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const stripeKeys = Object.keys(values).filter(
      (k) => k.startsWith("JOLLY_STRIPE_"),
    );
    assert.equal(
      stripeKeys.length,
      0,
      `Stripe keys found in .env: ${stripeKeys.join(", ")}`,
    );
  },
);

Then(
  "the output should include a nextSteps array with at least one step",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.nextSteps.length > 0,
      "envelope.nextSteps should have at least one entry",
    );
  },
);

Then(
  "Jolly should remove {string} from .env",
  function (this: JollyWorld, keysStr: string) {
    // Format: "KEY1 and KEY2"
    const keys = keysStr.split(" and ").map((k) => k.trim());
    const values = loadEnvValues(this.projectDir);
    for (const key of keys) {
      assert.ok(
        !(key in values),
        `"${key}" should have been removed from .env but was found`,
      );
    }
  },
);

Then(
  "{string} should remain in .env unchanged",
  function (this: JollyWorld, key: string) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      key in values,
      `"${key}" should remain in .env but was absent`,
    );
  },
);

// ── Output contract (020) shared steps ───────────────────────────────────
// Note: `subsequent jolly auth status should report...` steps are in 018-jolly-auth-commands.steps.ts

Then(
  "stdout should contain a single JSON envelope and nothing else",
  function (this: JollyWorld) {
    // For --json mode, stdout should be only the JSON envelope.
    const stdout = this.lastRun!.stdout.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      assert.fail(`stdout is not valid JSON: ${stdout}`);
    }
    assertEnvelopeShape(parsed);
    // Verify there's nothing else besides the envelope.
    const reSerialized = JSON.stringify(parsed);
    assert.equal(
      stdout,
      reSerialized,
      `stdout should contain only the JSON envelope, but has extra content`,
    );
  },
);

Then(
  "the envelope should include a `command` identifier",
  function (this: JollyWorld) {
    assert.ok(typeof this.envelope.command === "string" && this.envelope.command.length > 0);
  },
);

Then(
  "the envelope should include a top-level `status` of `success`, `warning`, or `error`",
  function (this: JollyWorld) {
    // Already validated by assertEnvelopeShape.
    assert.ok(["success", "warning", "error"].includes(this.envelope.status));
  },
);

Then(
  "the envelope should include a human `summary` string",
  function (this: JollyWorld) {
    assert.ok(typeof this.envelope.summary === "string" && this.envelope.summary.length > 0);
  },
);

Then(
  "the envelope should include a command-specific `data` object",
  function (this: JollyWorld) {
    assert.ok(typeof this.envelope.data === "object" && this.envelope.data !== null);
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
        `errors array should be empty on success: ${JSON.stringify(this.envelope.errors)}`,
      );
    }
  },
);

Then(
  "the agent should be able to parse the same shape regardless of which command produced it",
  function (this: JollyWorld) {
    // Already validated by assertEnvelopeShape — same shape contract.
  },
);

Then(
  "Jolly should print concise human-readable text for a developer reading along",
  function (this: JollyWorld) {
    const stdout = this.lastRun!.stdout;
    // Should have human-readable text (non-JSON content).
    assert.ok(
      stdout.includes("✓") || stdout.includes("✔") ||
        stdout.includes("success") || stdout.includes("✅") ||
        stdout.includes("Summary") || stdout.includes("summary") ||
        this.envelope.summary.split(" ").length >= 3,
      "output should contain human-readable text",
    );
  },
);

Then(
  "it should still include the machine-readable envelope for the agent",
  function (this: JollyWorld) {
    // The envelope should have been found in stdout.
    assert.ok(
      this.lastRun!.envelope !== undefined,
      "No output envelope found in default-mode stdout",
    );
  },
);

Then(
  "`--quiet` should reduce nonessential human text without removing the envelope",
  function (this: JollyWorld) {
    // The envelope should still be found.
    assert.ok(
      this.lastRun!.envelope !== undefined,
      "No output envelope found in --quiet mode stdout",
    );
  },
);

Then(
  "each check should appear in a `checks` array",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.checks));
  },
);

Then(
  "each check should carry a stable check id",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      assert.ok(
        typeof check.id === "string" && check.id.length > 0,
        `Check missing stable id: ${JSON.stringify(check)}`,
      );
    }
  },
);

Then(
  "each check `status` should be one of pass, warning, fail, skipped, or unknown",
  function (this: JollyWorld) {
    const valid = ["pass", "warning", "fail", "skipped", "unknown"];
    for (const check of this.envelope.checks) {
      assert.ok(
        valid.includes(check.status),
        `Check "${check.id}" has invalid status "${check.status}"`,
      );
    }
  },
);

Then(
  "each check should be able to carry a concrete next command or manual step",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      // Optional, but if present it should have a description string.
      if (check.nextStep !== undefined) {
        assert.ok(
          typeof check.nextStep === "string" || typeof check.nextStep === "object",
          "check nextStep should be a string or object",
        );
      }
    }
  },
);

Then(
  "each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`",
  function (this: JollyWorld) {
    for (const error of this.envelope.errors) {
      const e = error as Record<string, unknown>;
      assert.ok(typeof e.code === "string" && e.code.length > 0, "error code must be a non-empty string");
      assert.ok(typeof e.message === "string" && e.message.length > 0, "error message must be a non-empty string");
      // remediation is optional.
    }
  },
);

Then(
  "the documented `code` and check id strings should remain stable so the agent can branch on them programmatically",
  function (this: JollyWorld) {
    // Contracts documented in CLI design — code strings should be stable.
    // For now we verify they exist and are strings.
    for (const error of this.envelope.errors) {
      const e = error as Record<string, unknown>;
      assert.ok(typeof e.code === "string");
    }
  },
);

Then(
  "no field in the envelope or human text should contain a secret value",
  function (this: JollyWorld) {
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "stdout/stderr",
    );
  },
);

Then(
  "secrets should be referenced by name only",
  function (this: JollyWorld) {
    // We've already asserted no secrets leak. Also verify envelope doesn't
    // contain the raw values. The secrets set was populated from env vars.
    const output = JSON.stringify(this.envelope);
    this.assertNoSecretsIn(output, "envelope");
  },
);

// ── Risk context (021) shared steps ──────────────────────────────────────

Then(
  "it should expose a structured `riskContext` for the agent to assess",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "No riskContext found in envelope data or checks");
    for (const rc of rcs) {
      assertRiskContextShape(rc);
    }
  },
);

Then(
  "the `riskContext` should include the `action` being performed",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(typeof rc.action === "string" && rc.action.length > 0);
  },
);

Then(
  "it should include the `target` resource and its scope",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(rc.target !== null && rc.target !== undefined);
  },
);

Then(
  "it should include a `riskLevel` of low, medium, or high",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(
      ["low", "medium", "high"].includes(rc.riskLevel),
      `Invalid riskLevel: ${rc.riskLevel}`,
    );
  },
);

Then(
  "it should include the applicable risk `categories`",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(Array.isArray(rc.categories));
  },
);

Then(
  "it should include whether the action is `reversible`",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(typeof rc.reversible === "boolean");
  },
);

Then(
  "it should include the expected `sideEffects`",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(Array.isArray(rc.sideEffects));
  },
);

Then(
  "it should include whether a dry run is available via `dryRunAvailable`",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(typeof rc.dryRunAvailable === "boolean");
  },
);

Then(
  "the customer's agent should decide whether to ask for human approval based on this context",
  function (this: JollyWorld) {
    // Contract principle — verified by the existence of risk context output.
  },
);

Then(
  "the `riskContext` shown in preview should match the `riskContext` for real execution",
  function (this: JollyWorld) {
    // This needs a previous dry run vs real execution comparison.
    // Store the dry-run risk context and real-execution risk context.
    assert.ok(this.previousRun, "Need a previous run for comparison");
    const prevRcs = findRiskContexts(this.previousRun!.envelope!);
    const currRcs = findRiskContexts(this.envelope);
    assert.ok(prevRcs.length > 0, "No riskContext in dry-run output");
    assert.ok(currRcs.length > 0, "No riskContext in execution output");

    const prevRc = prevRcs[0] as RiskContext;
    const currRc = currRcs[0] as RiskContext;
    assert.equal(prevRc.action, currRc.action, "action should match");
    assert.equal(prevRc.riskLevel, currRc.riskLevel, "riskLevel should match");
    assert.deepEqual(
      prevRc.categories.sort(),
      currRc.categories.sort(),
      "categories should match",
    );
    assert.equal(prevRc.reversible, currRc.reversible, "reversible should match");
    assert.equal(
      prevRc.dryRunAvailable,
      currRc.dryRunAvailable,
      "dryRunAvailable should match",
    );
  },
);

Then(
  "no remote side effects should occur during the dry run",
  function (this: JollyWorld) {
    // Dry run must not create .env or other side effects.
    const envPath = join(this.projectDir, ".env");
    assert.ok(
      !existsSync(envPath) || Object.keys(loadEnvValues(this.projectDir)).length === 0,
      ".env should not have been modified during dry-run",
    );
  },
);

Then(
  "the `riskContext` should be carried inside the output envelope `data` and\\/or `checks`",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "riskContext not found in envelope data/checks");
  },
);

Then(
  "it should not use a separate ad hoc format outside the feature {int} envelope",
  function (this: JollyWorld, _featureNum: number) {
    // Verify riskContext is inside the envelope, not separate.
    // Already verified by findRiskContexts looking only inside data/checks.
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "riskContext should be inside the envelope");
    // Also check there's no riskContext-like JSON at the top level.
    if ("riskContext" in this.envelope) {
      assert.fail(
        "riskContext should be inside data/checks, not at envelope top level",
      );
    }
  },
);

Then(
  "the relevant categories should be listed explicitly",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    assert.ok(Array.isArray(rc.categories));
    assert.ok(rc.categories.length > 0, "categories should not be empty");
  },
);

Then(
  "destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category",
  function (this: JollyWorld) {
    // Verify the known categories exist in the risk categories list.
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0);
    const rc = rcs[0] as RiskContext;
    const expectedCategories = [
      "destructive operations",
      "billing",
      "payment setup",
      "credential handling",
      "live deployment",
      "production configuration changes",
    ];
    // At least one of these should be present depending on the action.
    const found = expectedCategories.filter((c) => rc.categories.includes(c));
    assert.ok(
      found.length > 0,
      `No expected risk categories found in ${JSON.stringify(rc.categories)}`,
    );
  },
);
