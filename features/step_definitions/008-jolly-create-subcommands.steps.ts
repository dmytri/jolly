// Step definitions for feature 008: Jolly create subcommands.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

// ── Background steps are in common.steps.ts ──────────────────────────────

// ── Discover create subcommands ──────────────────────────────────────────

Given("the agent needs to create a specific resource", function (this: JollyWorld) {
  // Contract.
});

When("it inspects `jolly create --help`", function (this: JollyWorld) {
  this.runCli(["create", "--help"]);
});

Then("it should see focused subcommands", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
});

Then("each subcommand should have a clear resource boundary", function (this: JollyWorld) {
  // Contract.
});

Then("the help output should be understandable to both agents and humans", function (this: JollyWorld) {
  // Help output should have text.
  assert.ok(this.lastRun!.stdout.length > 0);
});

// ── Compose or use start ─────────────────────────────────────────────────

Given("the customer wants the full end-to-end setup", function (this: JollyWorld) {
  // Contract.
});

When("the agent decides how to proceed", function (this: JollyWorld) {
  // Contract.
});

Then("the agent may invoke `jolly start` as a convenience wrapper for the full flow", function (this: JollyWorld) {
  // Contract.
});

Then("the agent may invoke individual `jolly create` subcommands at its own discretion", function (this: JollyWorld) {
  // Contract.
});

Then("each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur", function (this: JollyWorld) {
  // Contract.
});
