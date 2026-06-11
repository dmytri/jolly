// Step definitions for feature 005: Stripe checkout setup.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Background ───────────────────────────────────────────────────────────

Given("Jolly uses Saleor Cloud as the commerce backend", function (this: JollyWorld) {
  // Contract.
});

// `Jolly uses Saleor Paper...` is in 002-v1-end-to-end... Background steps

Given("Stripe is the v1 payment provider target", function (this: JollyWorld) {
  // Contract.
});

Given("v1 uses Stripe test mode only", function (this: JollyWorld) {
  // Contract.
});

// ── Collect Stripe credentials ───────────────────────────────────────────

Given("the setup flow reaches payment configuration", function (this: JollyWorld) {
  // Contract.
});

When("the agent handles Stripe setup", function (this: JollyWorld) {
  // Contract.
});

Then("the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode", function (this: JollyWorld) {
  // Contract.
});

Then("the agent should ask the customer to paste the publishable key and secret key", function (this: JollyWorld) {
  // Contract.
});

Then("no other Stripe configuration should be required from the customer at this point", function (this: JollyWorld) {
  // Contract.
});

// ── Write keys to .env ───────────────────────────────────────────────────

Given('the agent has collected the publishable key "pk_test_jolly_demo" and secret key "sk_test_jolly_demo"', function (this: JollyWorld) {
  this.trackSecret("pk_test_jolly_demo");
  this.trackSecret("sk_test_jolly_demo");
});

When(
  'the agent runs `jolly create stripe --publishable-key pk_test_jolly_demo --secret-key sk_test_jolly_demo`',
  function (this: JollyWorld) {
    this.runCli(["create", "stripe", "--publishable-key", "pk_test_jolly_demo", "--secret-key", "sk_test_jolly_demo"]);
  },
);

Then("Jolly should write both keys to .env", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.ok("JOLLY_STRIPE_PUBLISHABLE_KEY" in values, "JOLLY_STRIPE_PUBLISHABLE_KEY missing from .env");
  assert.ok("JOLLY_STRIPE_SECRET_KEY" in values, "JOLLY_STRIPE_SECRET_KEY missing from .env");
});

Then(".env should contain JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_jolly_demo", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.equal(values["JOLLY_STRIPE_PUBLISHABLE_KEY"], "pk_test_jolly_demo");
});

Then(".env should contain JOLLY_STRIPE_SECRET_KEY=sk_test_jolly_demo", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.equal(values["JOLLY_STRIPE_SECRET_KEY"], "sk_test_jolly_demo");
});

// ── Dry-run stripe ───────────────────────────────────────────────────────

When(
  'the agent runs `jolly create stripe --publishable-key pk_test_jolly --secret-key sk_test_jolly --dry-run --json`',
  function (this: JollyWorld) {
    this.trackSecret("pk_test_jolly");
    this.trackSecret("sk_test_jolly");
    this.runCli(["create", "stripe", "--publishable-key", "pk_test_jolly", "--secret-key", "sk_test_jolly", "--dry-run", "--json"]);
  },
);

// ── Sandbox scenarios (contract only, no real Stripe in harness) ─────────

Given("Stripe credentials are available in .env", function (this: JollyWorld) {
  // Contract for @sandbox.
});

When("Jolly proceeds with Stripe configuration", function (this: JollyWorld) {
  // Contract.
});

Then("it should use Saleor-supported Stripe payment setup paths where available", function (this: JollyWorld) {
  // Contract.
});

Then("it should not implement a custom payment backend inside Jolly", function (this: JollyWorld) {
  // Contract.
});

Then("the customer's agent should decide whether approval is needed before modifying remote payment configuration", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly remote\\/action commands involved in payment setup should support --dry-run", function (this: JollyWorld) {
  // Contract.
});

// ── Verify checkout readiness ────────────────────────────────────────────

Given("Stripe setup has been completed", function (this: JollyWorld) {
  // Contract.
});

When("the storefront is deployed", function (this: JollyWorld) {
  // Contract.
});

Then("jolly doctor should verify that checkout can progress to the Stripe test payment step", function (this: JollyWorld) {
  // Contract.
});

Then("it should confirm Stripe is in test mode", function (this: JollyWorld) {
  // Contract.
});

Then("it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps", function (this: JollyWorld) {
  // Contract.
});
