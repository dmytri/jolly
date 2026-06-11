// Step definitions for feature 006: Npx-first Jolly CLI command surface.
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

// Note: `\`jolly start\` should be available...` step is in common.steps.ts (regex
// that matches both "should be available" and "is available" variants).

Given("the customer wants the end-to-end guided Saleor storefront setup", function (this: JollyWorld) {
  // Contract.
});

When("the agent invokes the primary guided command", function (this: JollyWorld) {
  this.runCli(["start"]);
});

Then(
  "the agent may instead invoke individual composable subcommands for each stage",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "the output should follow Jolly's hybrid human-readable plus machine-readable format",
  function (this: JollyWorld) {
    // The envelope is already found in stdout.
  },
);
