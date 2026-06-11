// Step definitions for feature 010: Agent-decided approval model.
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

Given("a Jolly workflow is about to perform a potentially impactful action", function (this: JollyWorld) {
  // Contract.
});

When("the action could create, modify, deploy, delete, or expose remote resources", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should provide enough structured context for the customer's agent to assess risk", function (this: JollyWorld) {
  // Verified by 021 risk context scenarios.
});

Then("the customer's agent should decide whether to ask for human approval", function (this: JollyWorld) {
  // Contract - verified by 021 scenarios.
});

Then("the decision should respect the customer's instructions and the current agent environment's policies", function (this: JollyWorld) {
  // Contract.
});
