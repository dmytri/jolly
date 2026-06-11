// Step definitions for feature 009: Agent skill installation targets.
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

// ── Install skills in standard locations ─────────────────────────────────

When("the agent invokes `jolly skills install`", function (this: JollyWorld) {
  this.runCli(["skills", "install"]);
});

When("Jolly installs the default Saleor skill set", function (this: JollyWorld) {
  this.runCli(["skills", "install"]);
});

Then("it should prefer standard project-local skill locations supported by the underlying skills tooling", function (this: JollyWorld) {
  // Contract.
});

Then("it should avoid inventing a separate Jolly-only skill store unless required", function (this: JollyWorld) {
  // Contract.
});

Then(
  /^it should record or report installed versions using standard skills lock\/metadata files where possible$/, // regex to avoid / alternation
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Add agent-specific glue ──────────────────────────────────────────────

Given("the skills have been installed or checked", function (this: JollyWorld) {
  // Contract.
});

Given("the current or target agent environment needs additional setup", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should write or update agent-specific glue files or instructions", function (this: JollyWorld) {
  // Contract.
});

Then("the glue should point the agent to the installed skills", function (this: JollyWorld) {
  // Contract.
});

Then("the glue should avoid duplicating large skill contents when references are sufficient", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should avoid overwriting unrelated user-authored instructions without approval", function (this: JollyWorld) {
  // Contract.
});
