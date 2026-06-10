// Steps for features/005-stripe-checkout-setup.feature.
//
// Scenario 1 (@logic) covers the agent-facing instructions (setup guide
// content) and Jolly's local secret handling. Secret handling uses the
// harness seam (QM-owned convention, per AGENTS.md "Secret and Environment
// Handling"):
//   src/lib/env-file.ts
//     export function writeEnvValues(projectDir: string,
//       values: Record<string, string>): Record<string, string>
//       // ensures .env is git-ignored BEFORE writing, merges values into
//       // .env, and returns the full loaded post-update value map
//     export function loadEnvValues(projectDir: string): Record<string, string>
// Scenarios 2-3 (@sandbox) exercise Stripe configuration with real test-mode
// credentials.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { repoRoot, requireEnvelope, type Envelope } from "../support/cli.ts";
import { findRiskContexts, type RiskContext } from "../support/envelope.ts";
import { assertGuideMentions } from "../support/content.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

type EnvFileModule = {
  writeEnvValues: (projectDir: string, values: Record<string, string>) => Record<string, string>;
  loadEnvValues: (projectDir: string) => Record<string, string>;
};

async function loadEnvFileModule(): Promise<EnvFileModule> {
  const modulePath = join(repoRoot, "src", "lib", "env-file.ts");
  assert.ok(existsSync(modulePath), `env-file module not implemented yet: ${modulePath} (see seam contract in this step file)`);
  const module = await import(modulePath);
  assert.equal(typeof module.writeEnvValues, "function", "src/lib/env-file.ts must export writeEnvValues");
  assert.equal(typeof module.loadEnvValues, "function", "src/lib/env-file.ts must export loadEnvValues");
  return module as EnvFileModule;
}

Given(lit("Jolly uses Saleor Cloud as the commerce backend"), function () {
  // Premise (AGENTS.md V1 scope).
});

Given(lit("Stripe is the v1 payment provider target"), function () {
  // Premise.
});

Given(lit("v1 uses Stripe test mode only"), function () {
  // Premise.
});

// --- Scenario: Agent collects Stripe test mode credentials (@logic) ----------

Given(lit("the setup flow reaches payment configuration"), function () {
  // Premise.
});

When(lit("the agent handles Stripe setup"), function (this: JollyWorld) {
  this.vars.set("stripeSecret", `sk_test_${this.namespace}`);
  this.vars.set("stripePublishable", `pk_test_${this.namespace}`);
});

Then(
  lit("the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode"),
  function () {
    assertGuideMentions(/stripe\.com/i, "must point the customer at the Stripe Dashboard on stripe.com");
    assertGuideMentions(/test mode/i, "must tell the customer to switch to test mode");
  },
);

Then(lit("the agent should ask the customer to paste the publishable key and secret key"), function () {
  assertGuideMentions(/publishable key/i, "must ask for the publishable key");
  assertGuideMentions(/secret key/i, "must ask for the secret key");
});

Then(
  lit("no other Stripe configuration should be required from the customer at this point"),
  function () {
    assertGuideMentions(
      /only|no other|nothing else|just (the|these|those|two)/i,
      "must state that only the two keys are needed from the customer",
    );
  },
);

Then(
  lit("Jolly should write the keys to .env after ensuring .env is ignored by Git"),
  async function (this: JollyWorld) {
    const { writeEnvValues } = await loadEnvFileModule();
    const secret = this.vars.get("stripeSecret") as string;
    const publishable = this.vars.get("stripePublishable") as string;
    writeEnvValues(this.projectDir, {
      JOLLY_STRIPE_SECRET_KEY: secret,
      JOLLY_STRIPE_PUBLISHABLE_KEY: publishable,
    });
    const envPath = join(this.projectDir, ".env");
    assert.ok(existsSync(envPath), ".env was not written");
    const env = readFileSync(envPath, "utf8");
    assert.ok(env.includes(secret) && env.includes(publishable), "both keys must be persisted in .env");
    const gitignorePath = join(this.projectDir, ".gitignore");
    assert.ok(existsSync(gitignorePath), ".gitignore must exist after writing secrets");
    assert.ok(
      readFileSync(gitignorePath, "utf8").split("\n").some((line) => line.trim() === ".env"),
      ".gitignore must list .env",
    );
  },
);

Then(
  lit("Jolly should load the updated .env values for the current command flow where possible"),
  async function (this: JollyWorld) {
    const { loadEnvValues } = await loadEnvFileModule();
    const loaded = loadEnvValues(this.projectDir);
    assert.equal(loaded.JOLLY_STRIPE_SECRET_KEY, this.vars.get("stripeSecret"));
    assert.equal(loaded.JOLLY_STRIPE_PUBLISHABLE_KEY, this.vars.get("stripePublishable"));
  },
);

Then(lit("Jolly should not print the secret key value"), function (this: JollyWorld) {
  // The secret must exist in exactly one place: .env. No other artifact
  // (reports, glue files, logs written into the project) may carry it.
  const secret = this.vars.get("stripeSecret") as string;
  const offenders = readdirSync(this.projectDir, { recursive: true })
    .map(String)
    .filter((name) => name !== ".env" && !name.includes("node_modules"))
    .filter((name) => {
      try {
        return readFileSync(join(this.projectDir, name), "utf8").includes(secret);
      } catch {
        return false;
      }
    });
  assert.deepEqual(offenders, [], `secret key value found outside .env: ${offenders.join(", ")}`);
});

// --- Scenario: Jolly configures Saleor for Stripe (@sandbox) -----------------

Given(lit("Stripe credentials are available in .env"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_STRIPE_SECRET_KEY) return "skipped" as const;
});

When(lit("Jolly proceeds with Stripe configuration"), async function (this: JollyWorld) {
  // Preview of the payment-setup stage of the orchestrated flow.
  const run = await this.jolly(["start", "--dry-run", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 600_000,
  });
  this.vars.set("stripeEnvelope", requireEnvelope(run));
});

Then(lit("it should use Saleor-supported Stripe payment setup paths where available"), function (this: JollyWorld) {
  const serialized = JSON.stringify(this.vars.get("stripeEnvelope"));
  assert.ok(/stripe/i.test(serialized), "the flow must include a Stripe payment-setup stage");
  assert.ok(/saleor/i.test(serialized), "Stripe setup must go through Saleor's integration, not a side channel");
});

Then(lit("it should not implement a custom payment backend inside Jolly"), function () {
  // Enforcement-level boundary: Jolly's own code must not create Stripe
  // charges/payment intents — it configures Saleor's integration instead.
  const sources = collectSourceFiles(join(repoRoot, "src"));
  assert.ok(sources.length > 0, "src/ not implemented yet");
  const offenders = sources.filter((path) =>
    /paymentIntents\.create|charges\.create|stripe\.checkout\.sessions\.create/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(offenders, [], `custom payment processing found in: ${offenders.join(", ")}`);
});

Then(
  lit("the customer's agent should decide whether approval is needed before modifying remote payment configuration"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("stripeEnvelope") as Envelope;
    const contexts = findRiskContexts(envelope) as RiskContext[];
    const payment = contexts.find((rc) => (rc.categories as string[]).includes("payment setup"));
    assert.ok(payment, "payment configuration must expose a riskContext with the payment setup category");
  },
);

Then(lit("Jolly remote/action commands involved in payment setup should support --dry-run"), function (this: JollyWorld) {
  // The When step already ran the payment-setup flow under --dry-run and got
  // an envelope, which is the support being asserted.
  const envelope = this.vars.get("stripeEnvelope") as Envelope;
  assert.notEqual(envelope.status, "error", "--dry-run of the payment-setup flow must be supported");
});

// --- Scenario: Agent verifies checkout readiness (@sandbox) ------------------

Given(lit("Stripe setup has been completed"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_STRIPE_SECRET_KEY) return "skipped" as const;
});

When(lit("the storefront is deployed"), async function (this: JollyWorld) {
  const run = await this.jolly(["doctor", "stripe", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("stripeDoctor", requireEnvelope(run));
});

Then(
  lit("jolly doctor should verify that checkout can progress to the Stripe test payment step"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("stripeDoctor") as Envelope;
    assert.ok(
      /checkout/i.test(JSON.stringify(envelope.checks)),
      "doctor stripe must include a checkout-readiness check",
    );
  },
);

Then(lit("it should confirm Stripe is in test mode"), function (this: JollyWorld) {
  const envelope = this.vars.get("stripeDoctor") as Envelope;
  const testMode = (envelope.checks as { id: string; status: string }[]).find((c) => /test.?mode/i.test(c.id));
  assert.ok(testMode, "doctor stripe must include a test-mode check");
  assert.equal(testMode.status, "pass", "sandbox keys are test-mode keys; the check must pass");
});

Then(
  lit("it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("stripeDoctor") as Envelope;
    // The doctor must report on the manual-step dimension explicitly (even if
    // the answer is "none remaining").
    assert.ok(
      /webhook|manual|dashboard/i.test(JSON.stringify(envelope)),
      "doctor stripe must report remaining manual steps (or their absence)",
    );
  },
);

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(path));
    else if (/\.(ts|js|mts|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}
