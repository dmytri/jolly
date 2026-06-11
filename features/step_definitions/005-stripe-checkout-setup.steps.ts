// Steps for features/005-stripe-checkout-setup.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeEnvValues } from "../../src/lib/env-file.ts";
import { loadSetupGuide } from "../support/homepage.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

function guide(world: JollyWorld): string {
  if (!world.notes.guide) world.notes.guide = loadSetupGuide();
  return world.notes.guide as string;
}

// --- Background ---------------------------------------------------------------

Given("Jolly uses Saleor Cloud as the commerce backend", function (this: JollyWorld) {
  // Pinned V1 boundary; context only.
});

// Shared with feature 017's Background.
Given("Jolly uses Saleor Paper as the storefront baseline", function (this: JollyWorld) {
  // Pinned V1 boundary; context only.
});

Given("Stripe is the v1 payment provider target", function (this: JollyWorld) {
  // Pinned V1 boundary; context only.
});

Given("v1 uses Stripe test mode only", function (this: JollyWorld) {
  // Pinned V1 boundary; context only.
});

// --- Agent collects Stripe test mode credentials (@logic) ---------------------

Given("the setup flow reaches payment configuration", function (this: JollyWorld) {
  guide(this);
});

When("the agent handles Stripe setup", function (this: JollyWorld) {
  // The customer pastes the two test-mode keys; Jolly persists them.
  this.notes.publishableKey = "pk_test_jolly_canary";
  this.notes.secretKey = "sk_test_jolly_canary_secret";
  this.trackSecret(this.notes.secretKey as string);
  writeEnvValues(this.projectDir, {
    JOLLY_STRIPE_PUBLISHABLE_KEY: this.notes.publishableKey as string,
    JOLLY_STRIPE_SECRET_KEY: this.notes.secretKey as string,
  });
});

Then(
  "the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(text, /stripe\.com|Stripe Dashboard/i);
    assert.match(text, /test mode/i);
  },
);

Then(
  "the agent should ask the customer to paste the publishable key and secret key",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(text, /publishable key/i);
    assert.match(text, /secret key/i);
  },
);

Then(
  "no other Stripe configuration should be required from the customer at this point",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /exactly (2|two)|only (the |these )?(2|two)|no other Stripe/i,
      "the guide does not bound Stripe input to the two keys",
    );
  },
);

Then(
  "Jolly should write the keys to .env after ensuring .env is ignored by Git",
  function (this: JollyWorld) {
    const env = readFileSync(join(this.projectDir, ".env"), "utf8");
    assert.match(env, /JOLLY_STRIPE_PUBLISHABLE_KEY=/);
    assert.match(env, /JOLLY_STRIPE_SECRET_KEY=/);
    const gitignore = readFileSync(join(this.projectDir, ".gitignore"), "utf8");
    assert.ok(
      gitignore.split("\n").some((line) => line.trim() === ".env"),
      ".env is not Git-ignored",
    );
  },
);

Then(
  "Jolly should load the updated .env values for the current command flow where possible",
  function (this: JollyWorld) {
    // The stripe doctor group must see the just-written keys from .env.
    const result = this.runCli(["doctor", "stripe", "--json"]);
    const check = result.envelope?.checks.find((c) => /stripe/i.test(String(c.id)));
    assert.ok(check, "doctor stripe reports no stripe check");
    assert.notEqual(
      check!.status,
      "skipped",
      "the freshly written .env Stripe values were not loaded for the command flow",
    );
  },
);

Then("Jolly should not print the secret key value", function (this: JollyWorld) {
  const run = this.lastRun!;
  this.assertNoSecretsIn(run.stdout + run.stderr, "Stripe setup output");
});

// --- Jolly configures Saleor for Stripe (@sandbox) ----------------------------

Given("Stripe credentials are available in .env", function (this: JollyWorld) {
  writeEnvValues(this.projectDir, {
    JOLLY_STRIPE_PUBLISHABLE_KEY: process.env.JOLLY_STRIPE_PUBLISHABLE_KEY!,
    JOLLY_STRIPE_SECRET_KEY: process.env.JOLLY_STRIPE_SECRET_KEY!,
  });
});

When(
  "Jolly proceeds with Stripe configuration",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    // Payment setup is part of the store-configuration path; preview it.
    this.runCli(["create", "recipe", "--dry-run", "--yes", "--json"], {
      timeoutMs: 240_000,
    });
  },
);

Then(
  "it should use Saleor-supported Stripe payment setup paths where available",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /stripe/i,
      "the configuration path does not cover Saleor's Stripe setup",
    );
  },
);

Then(
  "it should not implement a custom payment backend inside Jolly",
  function (this: JollyWorld) {
    const packageJson = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    assert.ok(
      !packageJson.dependencies?.stripe,
      "Jolly depends on the Stripe SDK as if it processed payments itself",
    );
  },
);

Then(
  "the customer's agent should decide whether approval is needed before modifying remote payment configuration",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope),
      /"(approvalRequired|requiresApproval)"\s*:\s*true/,
      "Jolly hardcodes the payment-setup approval decision",
    );
  },
);

Then(
  "Jolly remote\\/action commands involved in payment setup should support --dry-run",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.args.includes("--dry-run"));
    assert.doesNotMatch(
      JSON.stringify(this.envelope.errors),
      /unknown (flag|option)/i,
      "--dry-run is not supported on the payment-setup path",
    );
  },
);

// --- Agent verifies checkout readiness (@sandbox) -----------------------------

Given("Stripe setup has been completed", function (this: JollyWorld) {
  writeEnvValues(this.projectDir, {
    JOLLY_STRIPE_PUBLISHABLE_KEY: process.env.JOLLY_STRIPE_PUBLISHABLE_KEY!,
    JOLLY_STRIPE_SECRET_KEY: process.env.JOLLY_STRIPE_SECRET_KEY!,
  });
});

When(
  "the storefront is deployed",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { timeoutMs: 240_000 });
  },
);

Then(
  "jolly doctor should verify that checkout can progress to the Stripe test payment step",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) =>
      /checkout|stripe/i.test(String(c.id)),
    );
    assert.ok(check, "doctor reports no checkout/Stripe readiness check");
    assert.notEqual(
      check!.status,
      "fail",
      `checkout cannot progress to the Stripe test payment step: ${JSON.stringify(check)}`,
    );
  },
);

Then("it should confirm Stripe is in test mode", function (this: JollyWorld) {
  const check = this.envelope.checks.find((c) =>
    /stripe.*(test|mode)|testmode/i.test(String(c.id)),
  );
  assert.ok(check, "doctor reports no Stripe test-mode check");
  assert.equal(
    check!.status,
    "pass",
    `Stripe test mode is not confirmed: ${JSON.stringify(check)}`,
  );
});

Then(
  "it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps",
  function (this: JollyWorld) {
    // Every non-passing payment-related check must carry concrete guidance.
    for (const check of this.envelope.checks) {
      if (/stripe|webhook/i.test(String(check.id)) && check.status !== "pass") {
        assert.ok(
          check.remediation || this.envelope.nextSteps.length > 0,
          `payment check ${check.id} is not passing yet carries no guidance`,
        );
      }
    }
  },
);
