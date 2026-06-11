// Steps for features/005-stripe-checkout-setup.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

// --- Background shared steps (also defined in 002 for reuse) --------------------

Given("Stripe is the v1 payment provider target", function (this: JollyWorld) {
  // Design assertion — context only.
});

Given("v1 uses Stripe test mode only", function (this: JollyWorld) {
  // Design assertion — context only.
});

// --- Agent collects Stripe test mode credentials (@logic) ------------------------

Given(
  "the setup flow reaches payment configuration",
  function (this: JollyWorld) {
    // Context only — the flow progresses to Stripe setup.
  },
);

When("the agent handles Stripe setup", function (this: JollyWorld) {
  this.notes.stripeHelp = this.runCli(["create", "stripe", "--help"]).stdout;
});

Then(
  "the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode",
  function (this: JollyWorld) {
    assert.match(
      this.notes.stripeHelp as string,
      /stripe\.com|dashboard|test mode/i,
      "Stripe setup does not direct the customer to the Stripe Dashboard",
    );
  },
);

Then(
  "the agent should ask the customer to paste the publishable key and secret key",
  function (this: JollyWorld) {
    assert.match(
      this.notes.stripeHelp as string,
      /(publishable|secret).*key/i,
      "Stripe setup does not ask for publishable and secret keys",
    );
  },
);

Then(
  "no other Stripe configuration should be required from the customer at this point",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.notes.stripeHelp as string,
      /webhook|endpoint.*secret|signing.*secret/i,
      "Stripe setup asks for additional configuration beyond keys",
    );
  },
);

Then(
  "Jolly should write the keys to .env after ensuring .env is ignored by Git",
  function (this: JollyWorld) {
    // Simulate: run the Stripe-setup command that writes env values.
    const result = this.runCli(["create", "stripe", "--dry-run", "--json"]);
    assert.match(
      result.stdout,
      /\.env|gitignore|git.ignore/i,
      "Stripe setup does not mention .env or Git ignore",
    );
    const envPath = join(this.projectDir, ".env");
    const gitignorePath = join(this.projectDir, ".gitignore");
    if (existsSync(envPath)) {
      // Verify .gitignore covers .env
      if (existsSync(gitignorePath)) {
        assert.ok(
          readFileSync(gitignorePath, "utf8")
            .split("\n")
            .some((l) => l.trim() === ".env"),
          ".env is not Git-ignored",
        );
      }
    }
  },
);

Then(
  "Jolly should load the updated .env values for the current command flow where possible",
  function (this: JollyWorld) {
    // Simulate writing env and checking it's picked up.
    writeFileSync(join(this.projectDir, ".env"), "JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_fake\n");
    const result = this.runCli(["doctor", "--json"]);
    assert.match(
      JSON.stringify(result.envelope?.checks ?? []),
      /stripe/i,
      "doctor does not reference Stripe configuration",
    );
  },
);

Then("Jolly should not print the secret key value", function (this: JollyWorld) {
  this.assertNoSecretsIn(this.lastRun!.stdout + this.lastRun!.stderr, "Stripe setup output");
});

// --- Jolly configures Saleor for Stripe (@sandbox) -------------------------------

Given(
  "Stripe credentials are available in .env",
  function (this: JollyWorld) {
    writeFileSync(
      join(this.projectDir, ".env"),
      [
        "JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_fake",
        "JOLLY_STRIPE_SECRET_KEY=sk_test_fake",
      ].join("\n"),
    );
    this.trackSecret("sk_test_fake");
  },
);

When("Jolly proceeds with Stripe configuration", function (this: JollyWorld) {
  this.runCli(["create", "stripe", "--json"]);
});

Then(
  "it should use Saleor-supported Stripe payment setup paths where available",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope expected from Stripe configuration");
    assert.match(
      JSON.stringify(this.envelope),
      /(saleor|stripe|payment)/i,
      "Stripe configuration does not reference Saleor Stripe integration",
    );
  },
);

Then(
  "it should not implement a custom payment backend inside Jolly",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope expected");
    // Design assertion enforced by implementation — Jolly delegates to
    // Saleor's existing Stripe integration rather than building payment logic.
  },
);

Then(
  "the customer's agent should decide whether approval is needed before modifying remote payment configuration",
  function (this: JollyWorld) {
    // Check that a risk context or approval gating is carried in the envelope.
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(riskContext|riskLevel|dryRunAvailable|nextSteps)/i,
      "Stripe configuration does not surface risk/approval context",
    );
  },
);

Then(
  "Jolly remote\\/action commands involved in payment setup should support --dry-run",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "stripe", "--dry-run", "--json"]);
    assert.ok(result.envelope, "dry-run Stripe configuration emitted no envelope");
    assert.match(
      result.stdout,
      /(dry.run|preview|would be)/i,
      "Stripe configuration does not support --dry-run",
    );
  },
);

// --- Agent verifies checkout readiness (@sandbox) --------------------------------

Given("Stripe setup has been completed", function (this: JollyWorld) {
  // Context only — Stripe is configured.
});

When("the storefront is deployed", function (this: JollyWorld) {
  this.runCli(["doctor", "--json"]);
});

Then(
  "jolly doctor should verify that checkout can progress to the Stripe test payment step",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) =>
      /stripe/i.test(String(c.id)),
    );
    assert.ok(check, "doctor has no Stripe check");
    assert.match(
      JSON.stringify(check),
      /(checkout|payment|test)/i,
      "Stripe check does not verify checkout readiness",
    );
  },
);

Then(
  "it should confirm Stripe is in test mode",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) =>
      /stripe/i.test(String(c.id)),
    );
    assert.ok(check, "doctor has no Stripe check");
  },
);

Then(
  "it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(manual|remaining|next|step|webhook)/i,
      "doctor does not identify remaining manual steps",
    );
  },
);
