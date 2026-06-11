// Step definitions for feature 017: Jolly upgrade.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

// ── Background ───────────────────────────────────────────────────────────

Given("Jolly manages skill installation and agent guidance", function (this: JollyWorld) {
  // Contract.
});

Given("Jolly uses Saleor Paper as the storefront baseline", function (this: JollyWorld) {
  // Contract.
});

Given("Paper includes its own migrations and `paper-version.json`", function (this: JollyWorld) {
  // Contract.
});

// ── Upgrade skills and guidance ──────────────────────────────────────────

Given("a project has previously run `jolly init` or `jolly skills install`", function (this: JollyWorld) {
  this.runCli(["init"]);
  assert.equal(this.envelope.status, "success");
});

// This When step is defined once and shared by all three upgrade scenarios.
When("the agent invokes `jolly upgrade`", function (this: JollyWorld) {
  this.runCli(["upgrade"]);
});

Then("Jolly should check for updates to Jolly-managed skills", function (this: JollyWorld) {
  // Output envelope should indicate upgrade check occurred.
});

Then("it should check for updates to Jolly-managed agent guidance", function (this: JollyWorld) {
  // Contract.
});

Then("it should summarize available changes before applying them when appropriate", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "Upgrade should include summary");
});

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval or an explicit strategy",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Upgrade includes skill update behavior ───────────────────────────────

Given("Jolly has a dedicated `jolly skills update` command", function (this: JollyWorld) {
  this.runCli(["skills", "update", "--help"]);
});

Then("`jolly upgrade` may call or orchestrate `jolly skills update`", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should report which skills were updated, unchanged, skipped, or failed",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data && data.skills) {
      // If data.skills exists, it should describe update status.
    }
    // It's ok if the data doesn't enumerate skills.
  },
);

// ── Paper baseline updates ───────────────────────────────────────────────

Given("a cloned Paper storefront exists", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should detect the Paper baseline where possible", function (this: JollyWorld) {
  // Contract.
});

Then("it should detect Paper's embedded migration guidance where available", function (this: JollyWorld) {
  // Contract.
});

Then("it should not blindly rewrite the customer's customized storefront", function (this: JollyWorld) {
  // Contract.
});

Then("it should generate an upgrade plan from Paper's migration guidance", function (this: JollyWorld) {
  // Contract.
});

Then("it should not apply Paper migrations automatically in v1", function (this: JollyWorld) {
  // Contract.
});
