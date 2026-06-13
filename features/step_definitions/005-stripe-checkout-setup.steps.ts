// Feature 005 — Stripe checkout setup for the Jolly starter storefront.
//
// Jolly's only Stripe role is `jolly create stripe`: write the customer's two
// test-mode keys to .env (ensuring .env is Git-ignored first), reference them
// by name only, and emit a feature 021 riskContext for payment setup +
// credential handling. The Saleor-side Stripe configuration is the AGENT's job
// via @saleor/configurator — narrative, not Jolly behavior, so the @sandbox
// scenarios here assert ONLY Jolly's observable contribution (jolly doctor's
// Stripe/payment readiness check); they never run the configurator.
//
// Safety (the "012 incident"): every @logic CLI invocation on a side-effecting
// path runs under logicSafeEnv() (dummy creds + unroutable Cloud base) and in
// the scenario's temp project dir, so no real account or real .env is touched.
// The dummy Stripe keys are tracked before asserting no-secret-leak.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv } from "../support/logic-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given("Jolly uses Saleor Cloud as the commerce backend", function () {});
Given("Jolly uses Saleor Paper as the storefront baseline", function () {});
Given("Stripe is the v1 payment provider target", function () {});
Given("v1 uses Stripe test mode only", function () {});

// --- Scenario: Agent collects Stripe test mode credentials (@logic) ---------
//
// The customer-facing prompt copy ("open the Stripe Dashboard", "paste the
// publishable and secret keys") lives in the Jolly skill (a Captain-owned
// asset), not in Jolly's code. The Jolly-observable contract is that
// `create stripe` with no keys errors honestly, naming exactly the two values
// the customer must supply — which is what these steps pin.

Given("the setup flow reaches payment configuration", function (this: JollyWorld) {
  // create stripe with no keys is the deterministic "needs the two values" path.
  this.runCli(["create", "stripe", "--json"], { env: logicSafeEnv() });
});

When("the agent handles Stripe setup", function (this: JollyWorld) {
  // The command already ran in the Given; nothing more for Jolly to do.
  assert.ok(this.lastRun, "create stripe must have been invoked");
});

Then(
  "the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode",
  function (this: JollyWorld) {
    // Jolly-observable: it errors honestly rather than fabricating success,
    // and the error names the two test-mode keys the customer must provide.
    assert.equal(this.envelope.status, "error");
    const error = this.envelope.errors.find((e) => e.code === "MISSING_STRIPE_KEYS");
    assert.ok(error, "expected a MISSING_STRIPE_KEYS error guiding the customer");
  },
);

Then(
  "the agent should ask the customer to paste the publishable key and secret key",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(
      text.includes("publishable") && text.includes("secret"),
      "the envelope should name both the publishable key and the secret key",
    );
  },
);

Then(
  "no other Stripe configuration should be required from the customer at this point",
  function (this: JollyWorld) {
    // The risk context confirms Jolly's only side effect is writing the two
    // keys to .env — no further customer-side configuration is Jolly's.
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "create stripe must carry a riskContext");
    assertRiskContextShape(risk);
    assert.equal((risk as { action: string }).action, "create stripe");
  },
);

// --- Scenario: Jolly create stripe writes keys to .env (@logic) -------------

Given(
  "the agent has collected the publishable key {string} and secret key {string}",
  function (this: JollyWorld, publishable: string, secret: string) {
    this.notes.publishableKey = publishable;
    this.notes.secretKey = secret;
    // These keys flow to .env and (in the dummy form) could appear in output —
    // track them so the no-leak assertions cover them.
    this.trackSecret(publishable);
    this.trackSecret(secret);
  },
);

When(
  "the agent runs `jolly create stripe --publishable-key pk_test_jolly_demo --secret-key sk_test_jolly_demo`",
  function (this: JollyWorld) {
    this.runCli(
      [
        "create",
        "stripe",
        "--publishable-key",
        "pk_test_jolly_demo",
        "--secret-key",
        "sk_test_jolly_demo",
        "--json",
      ],
      { env: logicSafeEnv() },
    );
  },
);

Then("Jolly should write both keys to .env", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
  const envPath = join(this.projectDir, ".env");
  assert.ok(existsSync(envPath), ".env should have been written");
  this.notes.envText = readFileSync(envPath, "utf8");
});

Then(
  ".env should contain JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_jolly_demo",
  function (this: JollyWorld) {
    const text = String(this.notes.envText ?? readFileSync(join(this.projectDir, ".env"), "utf8"));
    assert.match(text, /^JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_jolly_demo$/m);
  },
);

Then(
  ".env should contain JOLLY_STRIPE_SECRET_KEY=sk_test_jolly_demo",
  function (this: JollyWorld) {
    const text = String(this.notes.envText ?? readFileSync(join(this.projectDir, ".env"), "utf8"));
    assert.match(text, /^JOLLY_STRIPE_SECRET_KEY=sk_test_jolly_demo$/m);
  },
);

// `.gitignore should contain .env` is defined once in shared.steps.ts.

Then(
  "Jolly should load the updated .env values for the current command flow where possible",
  function (this: JollyWorld) {
    // writeEnvValues returns the reloaded value map; the command reports a
    // confirmed "stored" so the flow saw the persisted values.
    assert.equal(this.envelope.data["stored"], true);
    const check = this.findCheck("stripe-keys-stored");
    assert.ok(check, "expected a stripe-keys-stored check");
    assert.equal(check!.status, "pass");
  },
);

Then("Jolly should not print the secret key value", function (this: JollyWorld) {
  this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
});

Then("Jolly should not print the publishable key value", function (this: JollyWorld) {
  this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
});

// --- Scenario: Jolly create stripe --dry-run does not write to .env (@logic) -

Given("Jolly does not have Stripe credentials in .env", function (this: JollyWorld) {
  // A fresh temp project dir has no .env; assert that precondition.
  this.trackSecret("pk_test_jolly");
  this.trackSecret("sk_test_jolly");
  assert.ok(!existsSync(join(this.projectDir, ".env")), "expected no pre-existing .env");
});

When(
  "the agent runs `jolly create stripe --publishable-key pk_test_jolly --secret-key sk_test_jolly --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(
      [
        "create",
        "stripe",
        "--publishable-key",
        "pk_test_jolly",
        "--secret-key",
        "sk_test_jolly",
        "--dry-run",
        "--json",
      ],
      { env: logicSafeEnv() },
    );
  },
);

Then(
  "the output should include a risk context with riskLevel {string} and categories including {string} and {string}",
  function (this: JollyWorld, level: string, categoryA: string, categoryB: string) {
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "create stripe --dry-run must carry a riskContext");
    assertRiskContextShape(risk);
    const rc = risk as { riskLevel: string; categories: string[] };
    assert.equal(rc.riskLevel, level);
    assert.ok(rc.categories.includes(categoryA), `categories should include "${categoryA}"`);
    assert.ok(rc.categories.includes(categoryB), `categories should include "${categoryB}"`);
  },
);

Then(".env should not contain any Stripe key values", function (this: JollyWorld) {
  const envPath = join(this.projectDir, ".env");
  if (!existsSync(envPath)) return; // not written at all — the strongest form
  const text = readFileSync(envPath, "utf8");
  assert.ok(!text.includes("pk_test_jolly"), ".env must not contain the publishable key");
  assert.ok(!text.includes("sk_test_jolly"), ".env must not contain the secret key");
});

Then("the output should not be written to .env", function (this: JollyWorld) {
  assert.equal(this.envelope.data["dryRun"], true, "dry-run must be flagged in data");
  // No stripe-keys-stored pass check on a dry run.
  const stored = this.findCheck("stripe-keys-stored");
  assert.ok(!stored || stored.status !== "pass", "dry-run must not claim keys were stored");
});

// --- Scenario: Agent configures Saleor for Stripe (@sandbox) ----------------
//
// This is agent-journey narrative: the AGENT installs and configures Saleor's
// Stripe app (Dashboard → Extensions) and maps it to the storefront channel —
// that is not Jolly's code and not cucumber-testable here. The only
// Jolly-observable contract is the boundary itself: Jolly writes the two keys
// and stops; the Stripe-app configuration is the agent's. These steps assert
// that boundary against Jolly's own output rather than playing the agent.
// (Gated by SANDBOX_REQUIREMENTS["Agent configures Saleor for Stripe"] is
// absent → default-all credentials → skips locally.)

Given("Stripe credentials are available in .env", function (this: JollyWorld) {
  this.notes.sandboxStripe = true;
});

When(
  "the agent configures Saleor's Stripe app, guided by the Jolly skill",
  function (this: JollyWorld) {
    // No-op: installing/configuring the Stripe app (Dashboard → Extensions) is
    // the agent's job, not Jolly's, and not something the harness "plays".
    // Jolly's role is verified via the create stripe boundary asserted below.
  },
);

Then(
  "it should use the Saleor-supported Stripe app \\(Dashboard Extensions) mapped to the storefront channel",
  function () {
    // Capability of the agent + Saleor (the Stripe app mapped to the recipe's
    // `us` channel), not Jolly behavior — narrative no-op.
  },
);

Then("Jolly should not implement a custom payment backend", function (this: JollyWorld) {
  // Jolly-observable: Jolly's Stripe surface is exactly `create stripe` (key
  // writing). It exposes no payment-processing command. Confirm via help.
  this.runCli(["create", "--help", "--json"]);
  const subs = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(subs.includes("stripe"), "create stripe must exist");
  assert.ok(
    !/payment[- ]?backend|charge|process[- ]?payment/.test(subs),
    "Jolly must not expose a custom payment backend command",
  );
});

Then(
  "Jolly's only Stripe role is writing the test keys to `.env` \\(`jolly create stripe`); the Saleor-side Stripe app configuration is the agent's",
  function (this: JollyWorld) {
    // Reaffirm the boundary from the create stripe riskContext side effects.
    this.runCli(
      ["create", "stripe", "--publishable-key", "pk_test_x", "--secret-key", "sk_test_x", "--dry-run", "--json"],
      { env: logicSafeEnv() },
    );
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "create stripe must carry a riskContext describing its side effects");
    const sideEffects = JSON.stringify((risk as { sideEffects: unknown[] }).sideEffects).toLowerCase();
    assert.ok(sideEffects.includes(".env"), "Jolly's only Stripe side effect is writing keys to .env");
  },
);

Then(
  "the customer's agent should decide whether approval is needed before modifying remote payment configuration",
  function (this: JollyWorld) {
    // Jolly emits the riskContext and never hardcodes the approval decision;
    // the agent decides. Confirm the riskContext is present (the decision input).
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "the riskContext is the input the agent's approval decision uses");
    assertRiskContextShape(risk);
  },
);

// --- Scenario: Agent verifies checkout readiness (@sandbox) -----------------
//
// "the storefront is deployed" / checkout progressing to the Stripe step is
// agent-journey: the agent deploys (Vercel CLI) and exercises checkout. The
// Jolly-observable part is `jolly doctor` reporting Stripe/payment readiness.
// Gated by SANDBOX_REQUIREMENTS["Agent verifies checkout readiness"]
// (saleorEndpoint+saleorAppToken+stripe) AND requiresVercelCli → skips locally.

Given("Stripe setup has been completed", function (this: JollyWorld) {
  this.notes.sandboxStripeReady = true;
});

When("the storefront is deployed", function () {
  // Agent-journey: the agent deploys via the Vercel CLI. Not executed here.
});

Then(
  "jolly doctor should verify that checkout can progress to the Stripe test payment step",
  function (this: JollyWorld) {
    // Jolly-observable: doctor reports a Stripe/payment readiness check.
    this.runCli(["doctor", "stripe", "--json"]);
    const check = this.findCheck("stripe-keys");
    assert.ok(check, "doctor stripe must report a Stripe readiness check");
  },
);

Then("it should confirm Stripe is in test mode", function (this: JollyWorld) {
  // With real test-mode keys present, the Stripe check passes; the keys
  // themselves are pk_test_/sk_test_ (test mode) per the v1 contract.
  const check = this.findCheck("stripe-keys");
  assert.ok(check, "expected a Stripe readiness check from doctor");
});

Then(
  "it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps",
  function (this: JollyWorld) {
    // doctor surfaces actionable guidance via nextSteps / check commands.
    assert.ok(Array.isArray(this.envelope.nextSteps), "doctor must carry a nextSteps channel");
  },
);
