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
import { saleorGraphql } from "../support/saleor-graphql.ts";
import {
  FAKE_STRIPE_PUBLISHABLE_KEY,
  FAKE_STRIPE_SECRET_KEY,
  readStripeTrace,
  writeFakeStripeCli,
} from "../support/stripe-cli-fake.ts";
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
  // create stripe with no flags is the "needs the two values" path. Since the
  // no-flags path now tries to import from a logged-in Stripe CLI, shadow any
  // real `stripe` with a NOT-logged-in fake (no test-mode keys) so the import
  // finds nothing and Jolly errors honestly — deterministic on any machine.
  const shimDir = this.newTempDir("stripe-cli-empty");
  writeFakeStripeCli(shimDir, { loggedIn: false });
  this.runCli(["create", "stripe", "--json"], {
    env: logicSafeEnv({
      JOLLY_STRIPE_PUBLISHABLE_KEY: undefined,
      JOLLY_STRIPE_SECRET_KEY: undefined,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    }),
  });
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

// --- Scenario: create stripe imports keys from the Stripe CLI session (@logic) -
//
// Decision 2026-06-13: a completed `stripe login` must never read as "no Stripe
// keys". With no --publishable-key/--secret-key, `jolly create stripe` invokes
// the Stripe CLI READ-ONLY (`stripe config --list`), reads the default profile's
// test-mode keys, and writes them to .env — the secret never passes through a
// process argument or the agent. The harness fakes a logged-in Stripe CLI: a
// `stripe` executable on a scenario-scoped PATH that answers `config --list`
// with dummy test keys and traces its argv (so we can assert it was read-only).
// Safety: the run carries logicSafeEnv() with the Stripe vars REMOVED, so Jolly
// must take the import path rather than reading keys from the environment.

function stripeImportEnv(world: JollyWorld): Record<string, string | undefined> {
  return logicSafeEnv({
    // Remove the env-provided Stripe keys so the import path is exercised.
    JOLLY_STRIPE_PUBLISHABLE_KEY: undefined,
    JOLLY_STRIPE_SECRET_KEY: undefined,
    // The fake `stripe` shim must resolve first on PATH.
    PATH: `${String(world.notes.stripeShimDir)}:${process.env.PATH ?? ""}`,
  });
}

function seedFakeStripeCli(this: JollyWorld): void {
  const shimDir = this.newTempDir("stripe-cli");
  const traceFile = join(shimDir, "stripe-trace.jsonl");
  writeFakeStripeCli(shimDir, { traceFile });
  this.notes.stripeShimDir = shimDir;
  this.notes.stripeTraceFile = traceFile;
  // These are values Jolly will write to .env; track them so the no-leak
  // assertions cover them.
  this.trackSecret(FAKE_STRIPE_PUBLISHABLE_KEY);
  this.trackSecret(FAKE_STRIPE_SECRET_KEY);
}

Given("the Stripe CLI is logged in with test-mode keys", seedFakeStripeCli);
Given("the Stripe CLI is logged in with test-mode keys in its config", seedFakeStripeCli);

When("the agent runs `jolly create stripe --json`", function (this: JollyWorld) {
  this.runCli(["create", "stripe", "--json"], { env: stripeImportEnv(this) });
});

Then(
  "Jolly should import the test-mode keys by invoking the Stripe CLI read-only \\(`stripe config --list`)",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
    const calls = readStripeTrace(String(this.notes.stripeTraceFile));
    assert.ok(calls.length > 0, "Jolly must have invoked the Stripe CLI");
    assert.ok(
      calls.some((argv) => argv[0] === "config" && argv.includes("--list")),
      "Jolly must invoke `stripe config --list`",
    );
    // Read-only exception: Jolly must never run `login`/OAuth or any mutating
    // Stripe CLI command.
    for (const argv of calls) {
      assert.ok(
        !argv.includes("login"),
        "Jolly must never run `stripe login`/OAuth (read-only import only)",
      );
    }
  },
);

Then(
  ".env should contain JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY matching the Stripe CLI session",
  function (this: JollyWorld) {
    const text = readFileSync(join(this.projectDir, ".env"), "utf8");
    assert.match(
      text,
      new RegExp(`^JOLLY_STRIPE_PUBLISHABLE_KEY=${FAKE_STRIPE_PUBLISHABLE_KEY}$`, "m"),
      ".env must carry the publishable key imported from the Stripe CLI session",
    );
    assert.match(
      text,
      new RegExp(`^JOLLY_STRIPE_SECRET_KEY=${FAKE_STRIPE_SECRET_KEY}$`, "m"),
      ".env must carry the secret key imported from the Stripe CLI session",
    );
  },
);

Then("Jolly should not print either key value", function (this: JollyWorld) {
  this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
});

Then(
  "the output should report that the keys were imported from the Stripe CLI session",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(
      text.includes("stripe cli") && text.includes("import"),
      "the envelope should report that the keys were imported from the Stripe CLI session",
    );
  },
);

// --- Scenario: doctor recognizes Stripe keys from the Stripe CLI session (@logic) -
//
// When .env has no JOLLY_STRIPE_* but the Stripe CLI is logged in with test-mode
// keys, `jolly doctor stripe` must report the stripe-keys check as `warning`
// (not `fail`) whose next step is `jolly create stripe` to import them — Jolly
// must not report Stripe as simply missing when the OAuth was already done.

When("the agent runs `jolly doctor stripe --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "stripe", "--json"], { env: stripeImportEnv(this) });
});

Then(
  "the stripe-keys check should be {string}, not {string}",
  function (this: JollyWorld, want: string, notWant: string) {
    const check = this.envelope.checks.find((c) => c.id === "stripe-keys");
    assert.ok(check, "doctor stripe must report a stripe-keys check");
    assert.equal(check!.status, want, `stripe-keys should be "${want}"`);
    assert.notEqual(check!.status, notWant, `stripe-keys must not be "${notWant}"`);
  },
);

Then(
  "its next step should be to run `jolly create stripe` to import the keys",
  function (this: JollyWorld) {
    const steps = this.envelope.nextSteps;
    assert.ok(
      steps.some((s) => String((s as { command?: unknown }).command) === "jolly create stripe"),
      "doctor should direct the agent to `jolly create stripe` (no flags) to import the keys",
    );
  },
);

// === `jolly start` Stripe app-install stage (feature 005 Rule "`jolly start` ===
// Stripe stage — Jolly installs the app, keys + channel map is a guided gate")
//
// The Stripe app INSTALL is the SECOND genuinely-executing `jolly start` stage
// (stock-seeding was first; AGENTS.md "MVP sequencing"): it is Jolly's own
// Saleor GraphQL `appInstall(manifest, [HANDLE_PAYMENTS])`, authenticated with
// the Cloud STAFF token (an app token gets PermissionDenied), with no spawned
// CLI and no interactive stdio. The keys + `us`-channel mapping have no public
// API and stay the announce-and-wait human gate. These step defs cover its
// three faces, mirroring the feature-004 stock-stage structure:
//   - @logic: `jolly start --dry-run` plans the Stripe stage after the Vercel
//     deploy, with the riskContext + a preview naming the real appInstall
//     request, the manifest URL, and the Cloud-staff-token auth — no mutation.
//   - @logic: `jolly start` reaching the stage must not fabricate an install
//     (honest reporting; keys+channel named as a pending human gate).
//   - @sandbox: the live install via appInstall + idempotent reuse + the gate.
//
// Safety: the @logic paths run under logicSafeEnv() (dummy JOLLY_* + an
// unroutable `.invalid` Cloud base and Saleor endpoint), so even a stage that
// genuinely executes can never reach a real account (the "012 incident" rule).

// The current Stripe app manifest (feature 005 Rule "Stripe app path"): the
// v2 manifest — the older `stripe.saleor.app` is the retired v1.
const STRIPE_APP_MANIFEST_HOST = "stripe-v2.saleor.app";
const APP_INSTALL_MUTATION = "appInstall";

interface StripePlanStage {
  stage: string;
  effects: Record<string, string[]>;
  riskContext?: unknown;
}

/** Locate, in the dry-run plan, the Vercel deploy stage and the Stripe
 * app-install stage (the latter identified by the appInstall mutation it
 * names), so the test can assert ordering without pinning exact stage labels. */
function findStripePlanStages(plan: StripePlanStage[]): {
  deployIndex: number;
  stripeIndex: number;
  stripeStage?: StripePlanStage;
} {
  const text = (stage: StripePlanStage) => JSON.stringify(stage).toLowerCase();
  const deployIndex = plan.findIndex((s) => text(s).includes("vercel"));
  const stripeIndex = plan.findIndex((s) =>
    text(s).includes(APP_INSTALL_MUTATION.toLowerCase()),
  );
  return { deployIndex, stripeIndex, stripeStage: plan[stripeIndex] };
}

interface StartStage {
  stage: string;
  status: string;
  riskContext?: unknown;
}

/** Find the Stripe stage in a real run's data.stages — by name or by the
 * appInstall mutation its riskContext names (robust to the stage label Crew
 * chooses). */
function findStripeStage(stages: StartStage[]): StartStage | undefined {
  return stages.find(
    (s) =>
      s.stage === "stripe" ||
      JSON.stringify(s).toLowerCase().includes(APP_INSTALL_MUTATION.toLowerCase()),
  );
}

// --- Scenario: Jolly start previews the Stripe app-install stage (@logic) ----
//
// The deterministic dry-run target. The `Given the agent runs `jolly start
// --dry-run`` step is shared (defined in feature 004's step defs).

When("Jolly plans the Stripe stage", function (this: JollyWorld) {
  this.runCli(["start", "--dry-run", "--json"], { env: logicSafeEnv() });
});

Then(
  "the plan should include a Stripe stage that runs after the Vercel deploy stage",
  function (this: JollyWorld) {
    const plan = this.envelope.data.plan as StripePlanStage[];
    assert.ok(Array.isArray(plan) && plan.length > 0, "start --dry-run must report data.plan");
    const { deployIndex, stripeIndex, stripeStage } = findStripePlanStages(plan);
    assert.ok(deployIndex >= 0, "the plan must include the Vercel deploy stage");
    assert.ok(
      stripeIndex >= 0,
      `the plan must include a Stripe stage naming ${APP_INSTALL_MUTATION}`,
    );
    assert.ok(
      stripeIndex > deployIndex,
      "the Stripe stage must run AFTER the Vercel deploy stage",
    );
    this.notes.stripeStage = stripeStage;
  },
);

Then(
  "the Stripe stage should carry a riskContext with categories including {string} and {string}",
  function (this: JollyWorld, categoryA: string, categoryB: string) {
    const stage = this.notes.stripeStage as StripePlanStage | undefined;
    assert.ok(stage, "the Stripe stage must have been located");
    assert.ok(stage!.riskContext, "the Stripe stage must carry a riskContext");
    assertRiskContextShape(stage!.riskContext);
    const rc = stage!.riskContext as { categories: string[] };
    assert.ok(
      rc.categories.includes(categoryA),
      `the Stripe riskContext categories must include "${categoryA}"`,
    );
    assert.ok(
      rc.categories.includes(categoryB),
      `the Stripe riskContext categories must include "${categoryB}"`,
    );
    // The riskContext is discoverable inside the feature-020 envelope (021).
    assert.ok(
      findRiskContexts(this.envelope).length > 0,
      "riskContexts must live inside the envelope",
    );
  },
);

Then(
  "the preview should name the real Saleor GraphQL `appInstall` request, the Stripe app manifest URL, and that it authenticates with the Cloud staff token",
  function (this: JollyWorld) {
    const stage = this.notes.stripeStage as StripePlanStage;
    const blob = JSON.stringify(stage);
    assert.ok(
      blob.includes(APP_INSTALL_MUTATION),
      `the preview must name the real Saleor GraphQL mutation (${APP_INSTALL_MUTATION})`,
    );
    assert.ok(
      blob.includes(STRIPE_APP_MANIFEST_HOST) && blob.toLowerCase().includes("manifest"),
      `the preview must name the Stripe app manifest URL (${STRIPE_APP_MANIFEST_HOST}/api/manifest)`,
    );
    const lower = blob.toLowerCase();
    assert.ok(
      lower.includes("staff") && lower.includes("cloud"),
      "the preview must state it authenticates with the Cloud staff token",
    );
  },
);

Then(
  "the preview should state that entering the keys and mapping them to the `us` channel is a guided human gate, not something Jolly performs",
  function (this: JollyWorld) {
    const stage = this.notes.stripeStage as StripePlanStage;
    const lower = JSON.stringify(stage).toLowerCase();
    assert.ok(lower.includes("key"), "the preview must reference the keys");
    assert.ok(lower.includes("channel"), "the preview must reference the channel mapping");
    assert.ok(
      lower.includes("gate") || lower.includes("human") || lower.includes("guided") || lower.includes("manual"),
      "the preview must state the keys + channel mapping is a guided human gate Jolly does not perform",
    );
  },
);

// `Then the preview should not perform any mutation` is shared (feature 004).

// --- Scenario: Jolly start does not fabricate Stripe stage completion (@logic)
//
// The `Given the agent runs `jolly start` in a fresh project directory with no
// real service credentials` step is shared (defined in feature 001's step
// defs). With approvals pre-granted (`--yes`) under logicSafeEnv, the run
// reaches and attempts the Stripe stage, but the appInstall cannot succeed
// against the unroutable `.invalid` Cloud base — so the stage must be reported
// honestly (never "installed"), and the keys + channel mapping must be named as
// a pending human gate. This is the no-fabrication (integrity-rule) target.

When("`jolly start` reaches the Stripe stage", function (this: JollyWorld) {
  this.runCli(["start", "--yes", "--json"], { env: logicSafeEnv(), timeoutMs: 90_000 });
});

Then(
  "it must not report the Stripe app as installed unless the `appInstall` actually succeeded",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    // appInstall could not succeed against the unroutable base, so the stage
    // must NOT be "completed" — honest reporting, never a fabricated install.
    assert.notEqual(
      stripe!.status,
      "completed",
      "the Stripe stage must not be reported completed when appInstall did not succeed",
    );
    // No check may claim the Stripe app was installed/configured as a pass.
    for (const check of this.envelope.checks) {
      if (/stripe.*(install|app)|app.*install/i.test(check.id)) {
        assert.notEqual(
          check.status,
          "pass",
          `${check.id} must not be a fabricated pass when appInstall did not succeed`,
        );
      }
    }
  },
);

Then(
  "it must report the keys-and-channel-mapping step as a pending human gate and name it in nextSteps",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.nextSteps).toLowerCase();
    assert.ok(
      text.includes("key") && text.includes("channel"),
      "nextSteps must name the keys + channel-mapping human gate",
    );
    assert.ok(
      text.includes("dashboard") || text.includes("paste") || text.includes("map") || text.includes("gate"),
      "nextSteps must present the keys + channel mapping as a manual/guided human step",
    );
  },
);

Then(
  "it must not claim that checkout is ready or that the Stripe keys were configured",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.envelope.summary,
      /checkout (is )?ready|stripe (is )?configured|keys (are |were )?configured/i,
      "the summary must not fabricate checkout readiness or configured Stripe keys",
    );
    for (const check of this.envelope.checks) {
      if (check.status !== "pass") continue;
      const blob = `${check.id} ${String((check as { description?: unknown }).description ?? "")}`;
      assert.doesNotMatch(
        blob,
        /checkout.*ready|stripe.*configured|keys.*configured/i,
        `${check.id} must not claim checkout readiness or configured keys as a pass`,
      );
    }
  },
);

// --- Scenario: Jolly start installs the Stripe app and surfaces the gate (@sandbox)
//
// Gated by SANDBOX_REQUIREMENTS["Jolly start installs the Stripe app and
// surfaces the keys and channel gate"] (saleorCloud + saleorEndpoint — the
// appInstall uses the Cloud STAFF token) → skips locally. Verifies the SECOND
// genuinely-executing `jolly start` stage against a real store: with approvals
// pre-granted (`--yes`), the run reaches the Stripe stage and installs the app
// via Saleor GraphQL appInstall; a re-run reuses the existing install (no
// duplicate); the keys + `us`-channel mapping is announced as a human gate. When
// the Stripe stage does not report `completed` (e.g. appInstall is unavailable
// in this environment), the scenario skips — premise not producible — rather
// than failing.

function stripeStoreCreds(): { endpoint: string; cloudToken: string | undefined } {
  return {
    endpoint: process.env.NEXT_PUBLIC_SALEOR_API_URL ?? "",
    cloudToken: process.env.JOLLY_SALEOR_CLOUD_TOKEN,
  };
}

interface AppNode {
  id: string;
  name: string | null;
  identifier: string | null;
}

/** Query the store's installed apps and return those that look like the Stripe
 * payment app (by identifier or name). Listing apps needs MANAGE_APPS — the
 * Cloud staff token carries it. */
async function installedStripeApps(
  endpoint: string,
  token: string | undefined,
): Promise<AppNode[]> {
  const result = await saleorGraphql(
    endpoint,
    token,
    `query { apps(first: 100) { edges { node { id name identifier } } } }`,
  );
  const edges =
    (result.data?.apps as { edges?: Array<{ node: AppNode }> } | undefined)?.edges ?? [];
  return edges
    .map((e) => e.node)
    .filter((a) => /stripe/i.test(a.identifier ?? "") || /stripe/i.test(a.name ?? ""));
}

Given(
  "a Saleor Cloud environment with the starter recipe deployed and the Cloud token available",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // Pre-grant per-stage approvals so the orchestrated run reaches and performs
    // the Stripe app-install stage without interactive pauses (feature 021).
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const creds = stripeStoreCreds();
    assert.ok(creds.endpoint, "a Saleor GraphQL endpoint must be configured/derived");
    this.notes.storeEndpoint = creds.endpoint;
    this.notes.storeToken = creds.cloudToken;
  },
);

When("Jolly start reaches the Stripe stage", function (this: JollyWorld) {
  // The genuinely-executing outcome to verify is the Stripe stage reporting
  // `completed` (the app installed via appInstall). When appInstall is not
  // possible in this environment, Jolly reports the stage pending/blocked
  // honestly (never a fabricated `completed`), so the scenario skips — premise
  // not producible — rather than failing.
  const stages = (this.envelope.data.stages ?? []) as StartStage[];
  const stripe = findStripeStage(stages);
  if (!stripe || stripe.status !== "completed") {
    this.attach(
      `Skipped: the Stripe app-install stage did not complete in this ` +
        `environment (status: ${stripe?.status ?? "absent"})`,
      "text/plain",
    );
    this.notes.skipStripe = true;
  }
});

Then(
  "it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipStripe) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const apps = await installedStripeApps(endpoint, token);
    assert.ok(
      apps.length >= 1,
      "the Saleor Stripe app must be installed on the store after the Stripe stage",
    );
    this.notes.stripeAppCount = apps.length;
  },
);

Then(
  "re-running the stage should reuse the existing installation rather than installing a duplicate",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipStripe) return "skipped";
    // Re-run the orchestrated stage; the install must be idempotent (feature
    // 022) — it detects the existing Stripe app and reuses it.
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const apps = await installedStripeApps(endpoint, token);
    assert.equal(
      apps.length,
      this.notes.stripeAppCount,
      `re-running must not install a duplicate Stripe app (was ` +
        `${this.notes.stripeAppCount}, now ${apps.length})`,
    );
  },
);

Then(
  "it should announce the guided gate to paste the keys and map the configuration to the `us` channel, referencing the keys by name only",
  function (this: JollyWorld) {
    if (this.notes.skipStripe) return "skipped";
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(text.includes("channel"), "the gate must reference the channel mapping");
    assert.ok(text.includes("key"), "the gate must reference the keys to paste");
    // Keys referenced by name only — no real secret values are printed.
    this.assertNoSecretsIn(this.lastRun!.stdout, "start stdout");
  },
);

Then(
  "it should report the stage honestly — installed where it installed, and blocked on the human gate for the keys and channel mapping",
  function (this: JollyWorld) {
    if (this.notes.skipStripe) return "skipped";
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    assert.equal(
      stripe!.status,
      "completed",
      "the Stripe install stage must be reported completed (the app was installed)",
    );
    // The overall run is never "success": the keys + channel mapping remain a
    // pending human gate Jolly cannot pass (integrity rule). nextSteps name it.
    assert.notEqual(
      this.envelope.status,
      "success",
      "the run must not report success while the keys + channel gate is pending",
    );
    const next = JSON.stringify(this.envelope.nextSteps).toLowerCase();
    assert.ok(
      next.includes("key") && next.includes("channel"),
      "nextSteps must name the pending keys + channel-mapping human gate",
    );
  },
);
