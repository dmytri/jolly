// Feature 005 — Stripe checkout setup for the Jolly starter storefront.
//
// Jolly's Stripe role is the `jolly start` Stripe app-install stage: it installs
// the Saleor Stripe app via Saleor GraphQL `appInstall` (Cloud staff token), then
// announces the keys + `us`-channel mapping as a guided human Dashboard gate. The
// `jolly doctor` checkout-readiness probe confirms the Stripe test payment step
// is reachable. The Saleor-side keys + channel mapping is the AGENT's job —
// narrative, not Jolly behavior — so the @sandbox scenarios here assert ONLY
// Jolly's observable contribution.
//
// Safety: every @logic CLI invocation on a side-effecting path runs with the
// runtime credentials genuinely UNSET (absentCredentialsEnv) — real absence,
// never dummy values — and in the scenario's temp project dir, so no real account
// or real .env is touched.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import { prepareFastForwardDeployStart } from "../support/fast-forward-deploy.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given("Jolly uses Saleor Cloud as the commerce backend", function () {});
Given("Jolly uses Saleor Paper as the storefront baseline", function () {});
Given("Stripe is the v1 payment provider target", function () {});
Given("v1 uses Stripe test mode only", function () {});

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
// --- Scenario: Jolly start installs the Stripe app and surfaces the gate (@sandbox)
//
// Verifies the SECOND genuinely-executing `jolly start` stage against a real
// store: with approvals pre-granted (`--yes`), the run reaches the Stripe stage
// and installs the app via Saleor GraphQL appInstall; a re-run reuses the
// existing install (no duplicate); the keys + `us`-channel mapping is announced
// as a human gate.

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

/** Run the Stripe app-install stage in isolation via the composable `jolly stripe`
 * stage command (feature 029), against the shared @sandbox store: the store's
 * endpoint is written to the project .env by the Given (prepareFastForwardDeployStart)
 * and the Cloud staff token reaches the stage through the run env, so runStripeStage
 * installs the Saleor Stripe app via Saleor GraphQL appInstall for real. This runs
 * ONLY the Stripe stage — it does NOT re-reconcile the store/recipe/stock stages the
 * shared store already carries, which is the redundant per-run latency the previous
 * fast-forward `jolly start` paid (it re-ran the recipe + stock reconcile each time
 * just to reach the Stripe stage). `jolly start` composes this same Stripe seam and
 * announces the SAME keys+channel gate through a shared builder (src/index.ts), and
 * @logic (005 "does not fabricate Stripe stage completion") pins that composition —
 * so this @sandbox pin stays on the real install + gate alone. Both of this
 * scenario's runs share this project dir + shared store, so the re-run reuses the
 * same install. */
function runStripeStageCommand(world: JollyWorld): void {
  world.runCli(["stripe", "--yes", "--json"], {
    env: absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
    }),
    timeoutMs: 180_000,
  });
}

Given(
  "a configured Saleor Cloud store with a resolvable Cloud staff token",
  function (this: JollyWorld) {
    // The shared @sandbox store (provisioned by the Before hook) is the real,
    // reachable Saleor Cloud environment. Write its endpoint into the project
    // .env so the isolated `jolly stripe` stage command resolves it (the Cloud
    // staff token reaches the stage through the run env), and stash the endpoint
    // + Cloud staff token for the post-run app-listing assertions. Only the .env
    // endpoint write is needed here; the storefront fast-forward it also does is
    // harmless for the Stripe stage, which touches no storefront.
    prepareFastForwardDeployStart(this);
    const creds = stripeStoreCreds();
    assert.ok(creds.endpoint, "a Saleor GraphQL endpoint must be configured/derived");
    this.notes.storeEndpoint = creds.endpoint;
    this.notes.storeToken = creds.cloudToken;
  },
);

When(
  "`jolly stripe` runs the Stripe app-install stage against that store",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    // The composable stage command runs ONLY the Stripe app-install stage against
    // the configured store — the real appInstall under test — skipping the
    // store/recipe/stock reconcile the full `jolly start` pipeline re-ran each run.
    runStripeStageCommand(this);
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(
      stripe && stripe.status === "completed",
      `the Stripe app-install stage must complete (status: ${stripe?.status ?? "absent"})`,
    );
  },
);

Then(
  "it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
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
    // Re-run the isolated stage; the install must be idempotent (feature 022) —
    // it detects the existing Stripe app and reuses it. Same `jolly stripe` run
    // in the same project dir + shared store, so the stripe stage runs for real
    // again and reuses the existing install rather than installing a duplicate.
    runStripeStageCommand(this);
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
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(text.includes("channel"), "the gate must reference the channel mapping");
    assert.ok(text.includes("key"), "the gate must reference the keys to paste");
    // Keys referenced by name only — no real secret values are printed.
    this.assertNoSecretsIn(this.lastRun!.stdout, "start stdout");
  },
);

Then(
  "it should report the Stripe stage as completed \\(the app was installed) and name the keys-and-`us`-channel Dashboard mapping as the remaining human step in nextSteps, without claiming the keys are configured or checkout is ready",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    assert.equal(
      stripe!.status,
      "completed",
      "the Stripe install stage must be reported completed (the app was installed)",
    );
    // The keys + channel mapping is a SURFACED pending human-gate next step, not a
    // run-status downgrade (feature 005 Rule; the 0.10.11 model — a live store is
    // the win, features 002/027). Honesty here = the gate is named in nextSteps so
    // the run cannot hide it, and the run must NOT fabricate that the keys are
    // configured or checkout is ready (the latter is confirmed only by jolly doctor).
    const next = JSON.stringify(this.envelope.nextSteps).toLowerCase();
    assert.ok(
      next.includes("key") && next.includes("channel"),
      "nextSteps must name the pending keys + channel-mapping human gate",
    );
    const haystack = `${this.envelope.summary} ${next}`.toLowerCase();
    assert.ok(
      !/keys (?:are )?configured|stripe configured|checkout is ready|checkout ready/.test(haystack),
      "the run must not fabricate that the Stripe keys are configured or checkout is ready",
    );
  },
);

// --- Scenario: A transient Saleor rate-limit during the Stripe stage retries
//     instead of reporting a false blocked (@logic @exceptional-double) --------
//
// The Stripe stage's first Saleor GraphQL request is the GetApps idempotency
// query (cloud-api.ts installStripeApp → queryGetApps); a momentary HTTP 429
// there must be retried, not reported as a blocked stage. An HTTP 429 cannot be
// produced on demand against real Saleor Cloud, so this lone @exceptional-double
// stands up a loopback Saleor GraphQL stand-in that returns 429 exactly once on
// that GetApps request and then succeeds with the Stripe app already present
// (so the idempotent install reuses it and the stage completes). It is the only
// double in this feature — the real install is the @sandbox scenario above.
//
// Targeting: SALEOR_TOKEN stays unset so the recipe/stock stages skip
// without touching the endpoint, and the bootstrap doctor probes use other
// queries — so the single 429 is reserved for the Stripe stage's GetApps.

interface RateLimitState {
  appsQueries: number;
  served429: boolean;
}

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
// --- Scenario: Jolly doctor verifies the Stripe payment gateway is reachable (@sandbox)
//
// The probe is Jolly's own Saleor GraphQL
// (no CLI spawn, no Vercel). Against a real
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
    this.notes.storeToken = process.env.SALEOR_TOKEN;
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
    assert.ok(check, "doctor stripe must report a checkout-readiness check");
    this.notes.checkoutReadiness = check;
  },
);

Then(
  "it should create a harmless, reverted test checkout in the `us` channel and inspect its available payment gateways",
  function (this: JollyWorld) {
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
    const check = this.notes.checkoutReadiness as { status: string };
    const offered = await stripeOfferedForUsCheckout(
      this,
      String(this.notes.storeEndpoint),
      this.notes.storeToken as string | undefined,
    );
    this.notes.stripeOffered = offered;
    assert.notEqual(
      offered,
      null,
      "an independent `us` checkout must be creatable to cross-check the gateway",
    );
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
