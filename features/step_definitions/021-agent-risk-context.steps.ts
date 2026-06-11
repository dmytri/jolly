// Step definitions for feature 021: Structured agent risk context.
//
// Most step definitions are shared in common.steps.ts (including the
// Background steps: approval granularity, side-effecting commands).
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

// ── Background steps (approval granularity, side-effecting commands)
//    are in common.steps.ts ───────────────────────────────────────────────

// ── Expose risk context before impactful action ──────────────────────────

Given(
  "a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource",
  function (this: JollyWorld) {
    // Use login --dry-run as a representative side-effecting command.
    this.runCli(["login", "--token", "test-risk-token", "--dry-run", "--json"]);
  },
);

// ── Consistent across preview and execution ──────────────────────────────

Given("a command supports `--dry-run`", function (this: JollyWorld) {
  // Contract.
});

When("the agent previews the action with `--dry-run`", function (this: JollyWorld) {
  this.runCli(["login", "--token", "test-risk-token", "--dry-run", "--json"]);
});

// ── Travels in standard envelope ─────────────────────────────────────────

Given("a command produces output with `--json`", function (this: JollyWorld) {
  this.runCli(["login", "--token", "test-risk-token", "--dry-run", "--json"]);
});

// ── High-risk categories ─────────────────────────────────────────────────

Given("an action falls into a high-risk category", function (this: JollyWorld) {
  this.runCli(["login", "--token", "test-risk-token", "--dry-run", "--json"]);
});
