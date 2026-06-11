// Step definitions for feature 003: Saleor source repositories and integration boundaries.
import { Given, When, Then } from "@cucumber/cucumber";
import type { JollyWorld } from "../support/world.ts";

Given("Jolly needs to create a storefront project", function (this: JollyWorld) {
  // Contract.
});

When("the customer's agent reaches the storefront creation step", function (this: JollyWorld) {
  // Contract.
});

Then("it should clone or directly use `saleor/storefront`", function (this: JollyWorld) {
  // Contract.
});

Then("it should treat Paper as the first storefront baseline", function (this: JollyWorld) {
  // Contract.
});

Then("it should preserve Paper's architecture unless the customer explicitly asks for customization", function (this: JollyWorld) {
  // Contract.
});

Then("it should install and preserve Paper's agent guidance where applicable", function (this: JollyWorld) {
  // Contract.
});

Then("it should not require the deprecated Saleor CLI to create the storefront", function (this: JollyWorld) {
  // Contract.
});

// ── Configurator scenario ────────────────────────────────────────────────

Given("Jolly needs to inspect, plan, or apply Saleor store configuration", function (this: JollyWorld) {
  // Contract.
});

Given("the agent has a Saleor Cloud GraphQL URL and app token", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly CLI and\\/or Jolly skills should use `saleor/configurator` directly where appropriate", function (this: JollyWorld) {
  // Contract.
});

Then("they should prefer configurator's safe workflow of validate, diff, plan, and deploy", function (this: JollyWorld) {
  // Contract.
});

Then("they should parse structured output when available", function (this: JollyWorld) {
  // Contract.
});

Then("they should require human approval before applying destructive or write operations", function (this: JollyWorld) {
  // Contract.
});

// ── Skills scenario ──────────────────────────────────────────────────────

Given("the customer's agent environment supports agent skills", function (this: JollyWorld) {
  // Contract.
});

When("Jolly onboarding prepares the agent", function (this: JollyWorld) {
  // Contract.
});

Then("it should direct the agent to install relevant skills from `saleor/agent-skills`", function (this: JollyWorld) {
  // Contract.
});

Then("it should include Paper's embedded skill after the storefront is cloned", function (this: JollyWorld) {
  // Contract.
});

Then("it should explain which skills are mandatory, recommended, or situational", function (this: JollyWorld) {
  // Contract.
});

Then(
  /^it should direct the agent to install relevant skills from `saleor\/agent-skills`$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^implementation agents may study `saleor\/cli`$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Deprecated CLI scenario ──────────────────────────────────────────────

Given("some Saleor Cloud registration and setup behavior is poorly documented elsewhere", function (this: JollyWorld) {
  // Contract.
});

When("Jolly needs examples of legacy flows", function (this: JollyWorld) {
  // Contract.
});

Then("implementation agents may study `saleor/cli`", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly must not shell out to it", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly must not require customers or agents to install it", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior", function (this: JollyWorld) {
  // Contract.
});

Then(
  /^it should clone or directly use `saleor\/storefront`$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^Jolly CLI and\/or Jolly skills should use `saleor\/configurator` directly where appropriate$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);
