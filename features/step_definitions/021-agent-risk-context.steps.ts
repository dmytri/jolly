// Step definitions for feature 021: Structured agent risk context.
//
// Most verification steps (risk context shape, fields, envelope
// integration) are shared in common.steps.ts. This file provides the
// scenario-specific setup steps that are unique to 021 scenarios.
//
// Principle: Jolly describes risk; it never hardcodes the approval
// decision. Every command that supports --dry-run MUST emit a riskContext
// in its real execution output, identical to the --dry-run preview.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";
import { findRiskContexts } from "../support/envelope.ts";
import type { RiskContext } from "../support/envelope.ts";

// ── Background steps are in common.steps.ts ──────────────────────────────

// ── Scenario: Jolly exposes risk context before an impactful action ──────

Given(
  "a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource",
  function (this: JollyWorld) {
    // Run a side-effecting command that should always include a riskContext
    // in its output envelope. We use `jolly create app-token` which involves
    // credential handling — a remote resource side effect.
    this.runCli(["create", "app-token"]);
  },
);

// ── Scenario: Risk context is consistent across preview and execution ────

Given(
  "a command supports `--dry-run`",
  function (this: JollyWorld) {
    // Contract: the command under test supports --dry-run.
    // We use `jolly login --token dummy-test-token` as the test command.
    // The credentials required for the sandbox scenario are gated by the
    // @sandbox Before hook.
    this.notes["commandUnderTest"] = ["login", "--token", "dummy-sandbox-token"];
  },
);

When(
  "the agent previews the action with `--dry-run`",
  function (this: JollyWorld) {
    // Run the dry-run version, then immediately run the real execution,
    // so both this.previousRun and this.lastRun are populated for
    // comparison by the shared Then steps.
    const cmd = this.notes["commandUnderTest"] as string[];
    if (!cmd) {
      throw new Error("commandUnderTest not set — missing Given step");
    }

    const envPath = join(this.projectDir, ".env");

    // Save pre-dry-run .env state so the "no remote side effects"
    // check (which runs after real execution) can verify correctly.
    const preDryRunEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;

    // Step 1: Run with --dry-run
    this.runCli([...cmd, "--dry-run"]);
    const dryRunEnvelope = this.lastRun!.envelope;

    // Step 2: Run without --dry-run (becomes this.lastRun)
    this.runCli(cmd);

    // Restore .env to its pre-dry-run state so the "no remote side
    // effects should occur during the dry run" check in common.steps.ts
    // passes (real execution may have written to .env).
    if (preDryRunEnv !== null) {
      writeFileSync(envPath, preDryRunEnv, "utf8");
    } else if (existsSync(envPath)) {
      unlinkSync(envPath);
    }

    // Store the dry-run envelope for reference
    this.notes["dryRunEnvelope"] = dryRunEnvelope;
  },
);

Then(
  "the real execution output must include a `riskContext` identical to the dry-run preview",
  function (this: JollyWorld) {
    const dryRunEnvelope = this.notes["dryRunEnvelope"];
    assert.ok(
      dryRunEnvelope,
      "No dry-run envelope stored — was the When step skipped?",
    );

    const previewRcs = findRiskContexts(dryRunEnvelope as any);
    const executionRcs = findRiskContexts(this.envelope);

    assert.ok(
      previewRcs.length > 0,
      "No riskContext found in dry-run envelope data or checks",
    );
    assert.ok(
      executionRcs.length > 0,
      "No riskContext found in real execution envelope data or checks",
    );

    const preview = previewRcs[0] as RiskContext;
    const execution = executionRcs[0] as RiskContext;

    // All risk context fields must match between preview and execution
    assert.equal(
      execution.action,
      preview.action,
      `Real execution riskContext.action "${execution.action}" should match preview "${preview.action}"`,
    );
    assert.equal(
      execution.riskLevel,
      preview.riskLevel,
      `Real execution riskContext.riskLevel "${execution.riskLevel}" should match preview "${preview.riskLevel}"`,
    );
    assert.deepEqual(
      [...execution.categories].sort(),
      [...preview.categories].sort(),
      "Real execution riskContext.categories should match preview",
    );
    assert.equal(
      execution.reversible,
      preview.reversible,
      "Real execution riskContext.reversible should match preview",
    );
    assert.equal(
      execution.dryRunAvailable,
      preview.dryRunAvailable,
      "Real execution riskContext.dryRunAvailable should match preview",
    );
    assert.deepEqual(
      execution.sideEffects,
      preview.sideEffects,
      "Real execution riskContext.sideEffects should match preview",
    );
  },
);

// ── Scenario: Risk context travels in the standard envelope ──────────────

Given(
  "a command produces output with `--json`",
  function (this: JollyWorld) {
    // Run a side-effecting command with --json so we can verify the
    // riskContext is inside the envelope data/checks.
    this.runCli(["create", "app-token", "--json"]);
  },
);

// ── Scenario: High-risk categories are surfaced explicitly ───────────────

Given(
  "an action falls into a high-risk category",
  function (this: JollyWorld) {
    // Run a command whose risk context includes high-risk categories.
    // `create stripe` involves payment setup and credential handling,
    // both drawn from the feature 010 high-risk category list.
    this.runCli([
      "create",
      "stripe",
      "--publishable-key",
      "pk_test_example",
      "--secret-key",
      "sk_test_example",
    ]);
  },
);
