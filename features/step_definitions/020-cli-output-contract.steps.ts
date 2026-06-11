// Step definitions for feature 020: CLI output contract.
//
// Most steps are shared in common.steps.ts. This file provides the
// scenario-specific setup steps that are unique to 020 scenarios.
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

// ── Background steps (Jolly is executable, every command supports flags)
//    are in common.steps.ts ───────────────────────────────────────────────

// ── Parse through one envelope ───────────────────────────────────────────

Given("the agent invokes any Jolly command with `--json`", function (this: JollyWorld) {
  this.runCli(["--help", "--json"]);
});

Given("the agent invokes a Jolly command without `--json`", function (this: JollyWorld) {
  this.runCli(["--help"]);
});

// ── Commands reuse doctor vocabulary ─────────────────────────────────────

Given("a command performs verification such as `jolly start` or `jolly doctor`", function (this: JollyWorld) {
  this.runCli(["doctor"]);
});

// ── Branch on stable codes ───────────────────────────────────────────────

Given("a command fails or partially succeeds", function (this: JollyWorld) {
  // Run a command that should fail - pass invalid args.
  this.runCli(["nonexistent"]);
});

// ── Secrets ──────────────────────────────────────────────────────────────

Given("a command handles secret values such as tokens or API keys", function (this: JollyWorld) {
  // Already handled by login/stripe scenarios.
  this.runCli(["login", "--token", "test-secret-token", "--json"]);
});
