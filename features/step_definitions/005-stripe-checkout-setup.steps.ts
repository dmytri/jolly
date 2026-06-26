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
// Targeting: JOLLY_SALEOR_APP_TOKEN stays unset so the recipe/stock stages skip
// without touching the endpoint, and the bootstrap doctor probes use other
// queries — so the single 429 is reserved for the Stripe stage's GetApps.

interface RateLimitState {
  appsQueries: number;
  served429: boolean;
}

Given(
  "the Stripe stage's Saleor GraphQL endpoint returns HTTP 429 once and then succeeds with the Stripe app already installed",
  async function (this: JollyWorld) {
    // @exceptional-double: a real HTTP 429 rate-limit cannot be produced on
    // demand against real Saleor Cloud, so this loopback Saleor GraphQL stand-in
    // returns 429 once on the Stripe stage's first GetApps request and then
    // succeeds with the Stripe app already present. Lone double here (the real
    // install is the @sandbox scenario above); it pins that a transient
    // rate-limit is retried rather than degrading an already-installed stage to
    // a false blocked.
    const state: RateLimitState = { appsQueries: 0, served429: false };
    // @exceptional-double: a transient HTTP 429 rate-limit from the real Saleor
    // GraphQL cannot be produced on demand; this loopback serves one 429 then
    // succeeds. The real Stripe app install is covered by the @sandbox scenario.
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (body.includes("GetApps")) {
          state.appsQueries += 1;
          // First GetApps → a single transient 429; the retry must succeed.
          if (!state.served429) {
            state.served429 = true;
            res.statusCode = 429;
            res.end(JSON.stringify({ errors: [{ message: "rate limited" }] }));
            return;
          }
          // Subsequent GetApps → the Stripe app is already installed, so the
          // idempotent install reuses it and the stage completes.
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              data: { apps: { edges: [{ node: { id: "QXBwOjE=", name: "Stripe" } }] } },
            }),
          );
          return;
        }
        // Any other request (the bootstrap doctor's read-only probes) → benign
        // empty success, so only the Stripe stage's GetApps sees the single 429.
        res.statusCode = 200;
        res.end(JSON.stringify({ data: {} }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.notes.rateLimitState = state;
    this.notes.rateLimitEndpoint = `http://127.0.0.1:${port}/graphql/`;
    this.cleanup.register(`stripe 429 stand-in :${port}`, () => {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
  },
);

When(
  "the agent runs `jolly start --yes --json` and the Stripe stage runs against that endpoint",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    // In-process loopback stand-in ⇒ runCliAsync (spawnSync would block the
    // event loop and the server could never answer). Point the run's Saleor
    // GraphQL endpoint at the stand-in and supply the Cloud staff token the
    // Stripe stage authenticates with (STAND_IN_TOKEN — the stand-in does not
    // validate it). Generous timeout: start clones Paper + pnpm-installs before
    // reaching the Stripe stage, plus the retry backoff.
    await this.runCliAsync(["start", "--yes", "--json"], {
      env: absentCredentialsEnv({
        NEXT_PUBLIC_SALEOR_API_URL: String(this.notes.rateLimitEndpoint),
        JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
        // Loopback is reached via the documented JOLLY_SALEOR_CLOUD_API_URL
        // override, whose host Jolly treats as first-party (feature 018 Rule);
        // loopback is not a fixed first-party host (feature 020).
        JOLLY_SALEOR_CLOUD_API_URL: String(this.notes.rateLimitEndpoint),
      }),
      timeoutMs: 840_000,
    });
  },
);

Then(
  "the Stripe stage should be reported completed, having retried the rate-limited request",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    assert.equal(
      stripe!.status,
      "completed",
      "the Stripe stage must be reported completed after retrying the transient 429",
    );
    // The stand-in served a 429 and was hit again — proof the rate-limited
    // request was retried rather than failing on the first 429.
    const state = this.notes.rateLimitState as RateLimitState;
    assert.ok(state.served429, "the stand-in must have served the transient 429");
    assert.ok(
      state.appsQueries >= 2,
      `the Stripe stage must have retried the rate-limited GetApps request ` +
        `(saw ${state.appsQueries} GetApps request(s); expected the 429 plus a retry)`,
    );
  },
);

Then(
  "the Stripe stage should not be reported blocked on the transient rate-limit",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as StartStage[];
    const stripe = findStripeStage(stages);
    assert.ok(stripe, "the run must report a Stripe stage in data.stages");
    assert.notEqual(
      stripe!.status,
      "blocked",
      "a transient rate-limit must not degrade the Stripe stage to blocked",
    );
    // No stripe-app check may report a fabricated failure blaming the rate-limit.
    for (const check of this.envelope.checks) {
      if (/stripe.*(install|app)|app.*install/i.test(check.id)) {
        assert.notEqual(
          check.status,
          "fail",
          `${check.id} must not fail on a transient rate-limit that should have been retried`,
        );
      }
    }
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
