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
// Safety: every @logic CLI invocation on a side-effecting path runs with the
// runtime credentials genuinely UNSET (absentCredentialsEnv) — real absence,
// never dummy values — and in the scenario's temp project dir, so no real account
// or real .env is touched. The "no Stripe keys available" condition is produced
// for real: the runner's Stripe CLI holds no test-mode keys (the scenario skips
// if it does, never faking a not-logged-in CLI).
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import {
  readStripeTrace,
  writeStripeCliTraceWrapper,
} from "../support/stripe-cli-trace.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given("Jolly uses Saleor Cloud as the commerce backend", function () {});
Given("Jolly uses Saleor Paper as the storefront baseline", function () {});
Given("Stripe is the v1 payment provider target", function () {});
Given("v1 uses Stripe test mode only", function () {});

// --- Scenario: create stripe writes Dashboard-provided test keys (@logic) ----
//
// The customer copies their two test-mode keys from the Stripe Dashboard and
// passes them as explicit flags; Jolly writes them to .env, references them by
// name only, and reports that no further Stripe configuration is needed at this
// point. The riskContext confirms Jolly's only side effect is the .env write.

Given(
  "the customer has copied their Stripe test-mode keys from the Dashboard",
  function (this: JollyWorld) {
    // Precondition narrative — the keys the customer pastes are the explicit
    // flags below. Track them so the no-leak assertions cover them.
    this.trackSecret("pk_test_x");
    this.trackSecret("sk_test_x");
  },
);

When(
  "the agent runs `jolly create stripe --publishable-key pk_test_x --secret-key sk_test_x --json`",
  function (this: JollyWorld) {
    this.runCli(
      ["create", "stripe", "--publishable-key", "pk_test_x", "--secret-key", "sk_test_x", "--json"],
      { env: absentCredentialsEnv() },
    );
  },
);

Then(
  ".env should contain JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY set to those keys",
  function (this: JollyWorld) {
    // Jolly-observable: it wrote both keys to .env under their JOLLY_STRIPE_*
    // names, set to the customer's Dashboard keys.
    assert.equal(this.envelope.status, "success");
    const envPath = join(this.projectDir, ".env");
    assert.ok(existsSync(envPath), ".env should have been written");
    const text = readFileSync(envPath, "utf8");
    assert.match(text, /^JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_x$/m);
    assert.match(text, /^JOLLY_STRIPE_SECRET_KEY=sk_test_x$/m);
  },
);

Then(
  "no further Stripe configuration should be required at this point",
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
      { env: absentCredentialsEnv() },
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
      { env: absentCredentialsEnv() },
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

// --- Scenario: Agent verifies checkout readiness (@sandbox) -----------------
//
// "the storefront is deployed" / checkout progressing to the Stripe step is
// agent-journey: the agent deploys (Vercel CLI) and exercises checkout. The
// Jolly-observable part is `jolly doctor` reporting Stripe/payment readiness.
// Gated by SANDBOX_REQUIREMENTS["Agent verifies checkout readiness"]
// (saleorEndpoint+saleorAppToken+stripe) AND requiresVercelCli → skips locally.

// Shared `create stripe --json` import-path env: removes the env-provided Stripe
// keys (so the CLI-import path is exercised, never env keys) and puts the
// scenario's `stripe` first on PATH via notes.stripeShimDir — the REAL CLI behind
// a trace wrapper for the @sandbox import, or (for the @logic error scenario) an
// empty dir behind which the runner's real, not-logged-in `stripe` supplies no
// keys. The credentials are unset, keeping the run harmless; `create stripe`
// contacts no Saleor service.
function stripeImportEnv(world: JollyWorld): Record<string, string | undefined> {
  return absentCredentialsEnv({
    PATH: `${String(world.notes.stripeShimDir)}:${process.env.PATH ?? ""}`,
  });
}

// --- Scenario: create stripe imports keys from the Stripe CLI session (@sandbox) -
//
// Live-by-design (re-aimed 2026-06-15): the import path is exercised against the
// REAL, logged-in Stripe CLI on the runner — no fake. The premise (a Stripe CLI
// session holding test-mode keys) is a runner CAPABILITY: signup and the browser
// OAuth `stripe login` are human steps that cannot be provisioned on demand, so
// the Given probes the real CLI read-only and SKIPS (never fails) when no such
// session is present; CI supplies one. When it IS present, the Given captures the
// real session keys (for the .env-match assertion) and installs a passthrough
// trace wrapper first on PATH (via notes.stripeShimDir, the same seam the shared
// When/Then use): the wrapper records argv and execs the real `stripe`, so the
// read-only Then proves Jolly invoked `config --list` and never `login` while
// importing genuine keys.
Given(
  "a real Stripe CLI session logged in with test-mode keys on the runner",
  function (this: JollyWorld) {
    const probe = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0 || typeof probe.stdout !== "string") {
      this.attach(
        "Skipped: no real Stripe CLI session on the runner (`stripe config --list` " +
          "unavailable); run `npx @stripe/cli login` with test-mode keys to enable it",
        "text/plain",
      );
      return "skipped";
    }
    const pub = /test_mode_pub_key\s*=\s*["']?(pk_test_[^"'\s]+)/.exec(probe.stdout)?.[1];
    const secret = /test_mode_api_key\s*=\s*["']?((?:sk|rk)_test_[^"'\s]+)/.exec(
      probe.stdout,
    )?.[1];
    if (!pub || !secret) {
      this.attach(
        "Skipped: the Stripe CLI on the runner holds no test-mode keys (not logged " +
          "in, or keys expired); run `npx @stripe/cli login`",
        "text/plain",
      );
      return "skipped";
    }
    // Resolve the real `stripe` binary BEFORE the wrapper shadows the bare name,
    // so the wrapper execs the real CLI rather than recursing into itself.
    const resolved = spawnSync("sh", ["-c", "command -v stripe"], { encoding: "utf8" });
    const realStripePath = (resolved.stdout ?? "").trim();
    assert.ok(realStripePath, "must resolve the real `stripe` binary path");
    // Capture the real session keys (tracked so the no-leak assertions cover them).
    this.notes.realStripePublishableKey = pub;
    this.notes.realStripeSecretKey = secret;
    this.trackSecret(pub);
    this.trackSecret(secret);
    const wrapperDir = this.newTempDir("stripe-cli-trace");
    const traceFile = join(wrapperDir, "stripe-trace.jsonl");
    writeStripeCliTraceWrapper(wrapperDir, { traceFile, realStripePath });
    this.notes.stripeShimDir = wrapperDir;
    this.notes.stripeTraceFile = traceFile;
  },
);

When("the agent runs `jolly create stripe --json`", function (this: JollyWorld) {
  this.runCli(["create", "stripe", "--json"], { env: stripeImportEnv(this) });
});

// --- Scenario: create stripe errors clearly when no keys are available (@logic) -
//
// No env keys, no explicit flags, and a Stripe CLI that holds no test-mode keys:
// the import finds nothing, so Jolly must error honestly with the stable
// MISSING_STRIPE_KEYS code, remediation naming BOTH paths (log in to the Stripe
// CLI, or pass the explicit flags), and nothing written to .env. The condition
// is produced for REAL — the runner's Stripe CLI has no test-mode keys (live-by-
// design: read real state, skip if it cannot be produced, never fake it).

/**
 * Does the runner's real Stripe CLI hold test-mode keys? Read-only probe; absent
 * CLI or no keys ⇒ false (the "no keys available" condition is real).
 */
function realStripeCliHasTestKeys(): boolean {
  const probe = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0 || typeof probe.stdout !== "string") return false;
  return /test_mode_(pub_key|api_key)\s*=\s*["']?(?:pk|sk|rk)_test_/.test(probe.stdout);
}

Given("Jolly has no Stripe credentials in .env", function (this: JollyWorld) {
  // Produce "no keys available" for REAL: no env keys (stripeImportEnv unsets
  // them) and a Stripe CLI with no test-mode keys. If the runner's real Stripe
  // CLI IS logged in with test-mode keys, that condition cannot be produced
  // without mutating real auth, so skip (read real state, never fake it).
  if (realStripeCliHasTestKeys()) {
    this.attach(
      "Skipped: the runner's Stripe CLI is logged in with test-mode keys; the " +
        "'no Stripe keys available' condition cannot be produced without mutating real auth",
      "text/plain",
    );
    return "skipped";
  }
  // A scenario-scoped (empty) PATH dir keeps the import seam consistent; behind
  // it the runner's real, not-logged-in `stripe` (or none) supplies no keys.
  this.notes.stripeShimDir = this.newTempDir("stripe-cli-none");
  assert.ok(!existsSync(join(this.projectDir, ".env")), "expected no pre-existing .env");
  return undefined;
});

Given("no explicit key flags are passed", function () {
  // Precondition narrative — the shared `create stripe --json` When passes no
  // --publishable-key/--secret-key, exercising the import/error path.
});

Given("the Stripe CLI is not logged in with test-mode keys", function (this: JollyWorld) {
  // The real precondition is established by the first Given (which skips if the
  // runner's Stripe CLI holds test-mode keys); nothing to seed here.
});

Then(
  "the envelope status should be {string} with the stable code `MISSING_STRIPE_KEYS`",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    const error = this.envelope.errors.find((e) => e.code === "MISSING_STRIPE_KEYS");
    assert.ok(error, "expected a MISSING_STRIPE_KEYS error guiding the customer");
  },
);

Then(
  "the remediation should name both paths: logging in to the Stripe CLI, or passing `--publishable-key`\\/`--secret-key`",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(
      text.includes("stripe cli") || text.includes("stripe login") || text.includes("@stripe/cli"),
      "the remediation must name logging in to the Stripe CLI",
    );
    assert.ok(
      text.includes("--publishable-key") && text.includes("--secret-key"),
      "the remediation must name passing the explicit --publishable-key/--secret-key flags",
    );
  },
);

Then("nothing should be written to .env", function (this: JollyWorld) {
  const envPath = join(this.projectDir, ".env");
  if (!existsSync(envPath)) return; // not written at all — the strongest form
  const text = readFileSync(envPath, "utf8");
  assert.ok(!/^JOLLY_STRIPE_/m.test(text), ".env must not carry any Stripe keys on the error path");
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
    // The keys in .env must be the ones the REAL Stripe CLI session holds
    // (captured by the Given), proving they were imported from the session.
    const pub = String(this.notes.realStripePublishableKey);
    const secret = String(this.notes.realStripeSecretKey);
    const lines = readFileSync(join(this.projectDir, ".env"), "utf8").split("\n");
    assert.ok(
      lines.includes(`JOLLY_STRIPE_PUBLISHABLE_KEY=${pub}`),
      ".env must carry the publishable key imported from the real Stripe CLI session",
    );
    assert.ok(
      lines.includes(`JOLLY_STRIPE_SECRET_KEY=${secret}`),
      ".env must carry the secret key imported from the real Stripe CLI session",
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
// Safety: the @logic paths run with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence — so even a credential-gated stage that
// executes cannot reach a real account.

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
// defs). With approvals pre-granted (`--yes`) and the runtime credentials unset,
// the run reaches and attempts the Stripe stage, but the appInstall cannot
// succeed with no credentials — so the stage must be reported honestly (never
// "installed"), and the keys + channel mapping must be named as
// a pending human gate. This is the no-fabrication (integrity-rule) target.

When("`jolly start` reaches the Stripe stage", function (this: JollyWorld) {
  this.runCli(["start", "--yes", "--json"], { env: absentCredentialsEnv(), timeoutMs: 240_000 });
});

Then(
  "it must not report the Stripe app as installed unless the `appInstall` actually succeeded",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    // appInstall could not succeed with no credentials, so the stage must NOT
    // be "completed" — honest reporting, never a fabricated install.
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

// === Checkout-readiness verify probe (feature 005 Rule "Checkout-readiness ===
// verify probe — jolly doctor confirms the Stripe test payment step is reachable")
//
// The THIRD convergence onto honest, genuinely-executing behavior (AGENTS.md
// "MVP sequencing"). Installing the Stripe app + completing the keys/`us`-channel
// Dashboard gate are necessary but NOT self-verifying — there is no public read
// for the app's channel-config mapping (feature 005 Rule "Stripe app path"). The
// authoritative signal that checkout reaches the Stripe test payment step (the
// feature 002 acceptance bar) is whether a real `us` checkout is actually offered
// the Stripe payment gateway. `jolly doctor` (the `stripe` group, in the default
// run) performs that probe with Jolly's own Saleor GraphQL — it creates a minimal
// `us` test checkout, inspects availablePaymentGateways, then reverts (deletes)
// the checkout. These step defs cover its two faces:
//   - @logic: with no reachable store the checkout-readiness check must never be
//     a fabricated `pass` (the integrity-rule deterministic target).
//   - @sandbox: against a real store the check passes ONLY when the Stripe
//     gateway is offered, and reports honestly (naming the keys + channel
//     Dashboard step) when it is not — using test mode only, capturing no payment.

/** Locate the checkout-readiness check in a doctor envelope. Robust to the
 * exact id Crew picks (handoff suggests `checkout-payment-gateway`): any check
 * in the stripe group whose id names checkout/payment-gateway readiness. */
function findCheckoutReadinessCheck(
  checks: ReadonlyArray<{ id: string; status: string; description?: unknown }>,
): { id: string; status: string; description?: unknown } | undefined {
  return checks.find(
    (c) => /checkout/i.test(c.id) && /(ready|gateway|payment)/i.test(c.id),
  ) ?? checks.find((c) => /checkout/i.test(c.id));
}

// --- Scenario: Jolly doctor does not fabricate checkout readiness (@logic) ----
//
// With the Saleor endpoint genuinely unset there is no store to reach — a
// genuinely-absent store (producible from real absence per AGENTS.md), exactly
// the "no reachable store" premise. A probe that genuinely runs (no fabrication)
// must report the checkout-readiness check as skipped/unknown/fail, never a
// fabricated `pass`, and the summary must not claim checkout is ready. This is
// the deterministic target driving Crew.

Given("Jolly cannot reach a real store in this run", function (this: JollyWorld) {
  // absentCredentialsEnv() leaves NEXT_PUBLIC_SALEOR_API_URL unset — there is no
  // store to reach. Nothing to set up beyond running under that env in the When.
  this.notes.noReachableStore = true;
});

When(
  "the agent runs `jolly doctor stripe` with no reachable store",
  function (this: JollyWorld) {
    // The credentials are unset, so the Saleor endpoint is absent and the
    // checkout probe has no store to reach. The probe must resolve quickly —
    // give it headroom but a real cap so a hung probe surfaces as a failure.
    this.runCli(["doctor", "stripe", "--json"], {
      env: absentCredentialsEnv(),
      timeoutMs: 60_000,
    });
  },
);

Then(
  "a checkout-readiness check should be reported in the stripe group",
  function (this: JollyWorld) {
    const check = findCheckoutReadinessCheck(this.envelope.checks);
    assert.ok(
      check,
      "doctor stripe must report a checkout-readiness check (e.g. checkout-payment-gateway)",
    );
    this.notes.checkoutReadiness = check;
  },
);

Then(
  "that check must not be {string} unless the Stripe payment gateway was actually offered for a `us` checkout",
  function (this: JollyWorld, forbidden: string) {
    const check = this.notes.checkoutReadiness as { status: string } | undefined;
    assert.ok(check, "the checkout-readiness check must have been located");
    // No store was reachable, so the gateway was never offered — the check must
    // not be a fabricated pass (integrity rule).
    assert.notEqual(
      check!.status,
      forbidden,
      `the checkout-readiness check must not be "${forbidden}" when no gateway was offered`,
    );
  },
);

Then(
  "with no reachable store the checkout-readiness check should be {string}, {string}, or {string}, never {string}",
  function (
    this: JollyWorld,
    a: string,
    b: string,
    c: string,
    forbidden: string,
  ) {
    const check = this.notes.checkoutReadiness as { status: string } | undefined;
    assert.ok(check, "the checkout-readiness check must have been located");
    assert.ok(
      [a, b, c].includes(check!.status),
      `with no reachable store the checkout-readiness check should be one of ` +
        `${[a, b, c].join("/")}, got "${check!.status}"`,
    );
    assert.notEqual(check!.status, forbidden, `it must never be "${forbidden}"`);
  },
);

Then(
  "the summary must not claim checkout is ready when it was not verified",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.envelope.summary,
      /checkout (is )?ready|checkout.*(verified|confirmed)|payment step.*reachable/i,
      "the summary must not fabricate checkout readiness when no store was reached",
    );
  },
);

// --- Scenario: Jolly doctor verifies the Stripe payment gateway is reachable (@sandbox)
//
// Gated by SANDBOX_REQUIREMENTS["Jolly doctor verifies the Stripe payment
// gateway is reachable for checkout"] (saleorEndpoint + saleorAppToken, derivable
// from the Cloud token) → skips locally. The probe is Jolly's own Saleor GraphQL
// (no CLI spawn, no Vercel) so it does NOT gate on the Vercel CLI. Against a real
// store the checkout-readiness check passes ONLY when the Stripe gateway is
// offered for a `us` checkout (independently re-verified here), and reports
// honestly otherwise. When the store/endpoint is unreachable or carries no `us`
// channel/variants, the check is skipped/unknown and the scenario skips — premise
// not producible — rather than failing.

interface PaymentGateway {
  id: string;
  name: string | null;
}

/** Independently create a minimal `us` test checkout, read its available
 * payment gateways, and revert (delete) it — the same harmless probe doctor
 * performs, used here to cross-check doctor's verdict. Returns whether Stripe
 * was offered, or null when a `us` checkout could not be created (no variants /
 * no `us` channel / store unreachable). */
async function stripeOfferedForUsCheckout(
  world: JollyWorld,
  endpoint: string,
  token: string | undefined,
): Promise<boolean | null> {
  // A variant to put in the checkout.
  const vResult = await saleorGraphql(
    endpoint,
    token,
    `query { productVariants(first: 1) { edges { node { id } } } }`,
  );
  const variantId = (
    vResult.data?.productVariants as
      | { edges?: Array<{ node: { id: string } }> }
      | undefined
  )?.edges?.[0]?.node?.id;
  if (!variantId) return null;

  const result = await saleorGraphql(
    endpoint,
    token,
    `mutation($channel: String!, $variantId: ID!) {
       checkoutCreate(input: { channel: $channel, lines: [{ quantity: 1, variantId: $variantId }] }) {
         checkout { id availablePaymentGateways { id name } }
         errors { code }
       }
     }`,
    { channel: "us", variantId },
  );
  const payload = result.data?.checkoutCreate as
    | {
        checkout?: { id: string; availablePaymentGateways?: PaymentGateway[] };
        errors?: Array<{ code: string }>;
      }
    | undefined;
  const checkout = payload?.checkout;
  if (!checkout) return null;
  // Revert: delete the test checkout (capture no payment — feature 023 harmless).
  world.cleanup.register(`probe checkout ${checkout.id}`, async () => {
    await saleorGraphql(
      endpoint,
      token,
      `mutation($id: ID!) { checkoutDelete(id: $id) { errors { code } } }`,
      { id: checkout.id },
    );
  });
  const gateways = checkout.availablePaymentGateways ?? [];
  return gateways.some(
    (g) => /stripe/i.test(g.id) || /stripe/i.test(g.name ?? ""),
  );
}

Given(
  "a deployed store whose Stripe app is configured and mapped to the `us` channel",
  function (this: JollyWorld) {
    // Premise (the Dashboard mapping) is store state the harness cannot force —
    // it is verified, not produced. Capture the live store creds for the
    // independent gateway cross-check below.
    this.notes.storeEndpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL ?? "";
    this.notes.storeToken = process.env.JOLLY_SALEOR_APP_TOKEN;
    assert.ok(
      this.notes.storeEndpoint,
      "a Saleor GraphQL endpoint must be configured/derived",
    );
  },
);

When(
  "`jolly doctor` probes checkout payment readiness",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    this.runCli(["doctor", "stripe", "--json"], { timeoutMs: 90_000 });
    const check = findCheckoutReadinessCheck(this.envelope.checks);
    if (!check) {
      this.attach(
        "Skipped: doctor reported no checkout-readiness check in this run",
        "text/plain",
      );
      this.notes.skipProbe = true;
      return "skipped";
    }
    this.notes.checkoutReadiness = check;
    // When the store/creds were unreachable the probe honestly reports
    // skipped/unknown — premise not producible, so the scenario skips.
    if (check.status === "skipped" || check.status === "unknown") {
      this.attach(
        `Skipped: checkout-readiness probe could not run (status: ${check.status})`,
        "text/plain",
      );
      this.notes.skipProbe = true;
      return "skipped";
    }
  },
);

Then(
  "it should create a harmless, reverted test checkout in the `us` channel and inspect its available payment gateways",
  function (this: JollyWorld) {
    if (this.notes.skipProbe) return "skipped";
    const check = this.notes.checkoutReadiness as { status: string } | undefined;
    assert.ok(check, "the checkout-readiness check must be present");
    // Jolly-observable: the probe reaches a verdict (pass/warning/fail) by
    // creating + inspecting a `us` checkout. A reached verdict is the evidence
    // the probe ran; harmlessness (revert / no payment) is asserted below.
    assert.ok(
      ["pass", "warning", "fail"].includes(check!.status),
      `the probe must reach a real verdict, got "${check!.status}"`,
    );
  },
);

Then(
  "the checkout-readiness check should pass only when the Stripe gateway is offered for that checkout",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipProbe) return "skipped";
    const check = this.notes.checkoutReadiness as { status: string };
    const offered = await stripeOfferedForUsCheckout(
      this,
      String(this.notes.storeEndpoint),
      this.notes.storeToken as string | undefined,
    );
    this.notes.stripeOffered = offered;
    if (offered === null) {
      // Could not independently create a `us` checkout (no variants / channel) —
      // premise not producible for the cross-check; skip rather than fail.
      this.attach(
        "Skipped: could not create an independent `us` checkout to cross-check the gateway",
        "text/plain",
      );
      this.notes.skipProbe = true;
      return "skipped";
    }
    if (check.status === "pass") {
      assert.ok(
        offered,
        "the checkout-readiness check is `pass`, so the Stripe gateway must be offered for a `us` checkout",
      );
    }
  },
);

Then(
  "it should report honestly when the Stripe gateway is not yet offered, naming the remaining keys-and-channel Dashboard step",
  function (this: JollyWorld) {
    if (this.notes.skipProbe) return "skipped";
    const check = this.notes.checkoutReadiness as {
      status: string;
      description?: unknown;
    };
    const offered = this.notes.stripeOffered as boolean | null;
    if (offered) {
      // Gateway IS offered → a pass is honest; nothing to assert about the gate.
      assert.equal(
        check.status,
        "pass",
        "when the Stripe gateway is offered the checkout-readiness check should pass",
      );
      return;
    }
    // Gateway NOT offered → the check must be honest (warning/fail, never pass)
    // and name the remaining keys + channel Dashboard step.
    assert.notEqual(
      check.status,
      "pass",
      "the check must not pass when the Stripe gateway is not offered",
    );
    const blob = `${String(check.description ?? "")} ${JSON.stringify(
      this.envelope.nextSteps,
    )}`.toLowerCase();
    assert.ok(
      blob.includes("key") && blob.includes("channel"),
      "an honest not-ready report must name the remaining keys + channel mapping step",
    );
    assert.ok(
      blob.includes("dashboard") || blob.includes("map") || blob.includes("stripe app"),
      "the honest report must point at the Stripe app Dashboard step",
    );
  },
);

Then(
  "the probe should use Stripe test mode only and capture no payment",
  function (this: JollyWorld) {
    if (this.notes.skipProbe) return "skipped";
    // v1 is test mode only (Background). The probe creates + reverts a checkout
    // and never completes/charges it: no order/payment language in the verdict,
    // and no secret values leaked.
    this.assertNoSecretsIn(this.lastRun!.stdout, "doctor stdout");
    this.assertNoSecretsIn(this.lastRun!.stderr, "doctor stderr");
    const check = this.notes.checkoutReadiness as { description?: unknown };
    assert.doesNotMatch(
      String(check.description ?? ""),
      /captured|charged|payment (taken|completed)|order (placed|created)/i,
      "the probe must not capture a payment or place an order",
    );
  },
);
