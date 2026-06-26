// Logic-tier units for the interactive `jolly start` human close (feature 027
// Rule "Interactive start runs end-to-end in one session", lines on the closing
// output). The close is a CONCISE prose summary — not the machine envelope —
// that:
//   - on success names the live store URLs (Saleor Dashboard AND deployed
//     storefront) and the remaining Stripe Dashboard key step;
//   - on a GENUINE stage failure reports the failure honestly and never
//     fabricates success (it does not claim the store is live or that only the
//     Stripe step remains);
//   - never renders the per-check `checks[]` enumeration or the `nextSteps[]`
//     `next:` lines on the human stream.
//
// Pinned seam: src/lib/start-close.ts exports
//   interactiveCloseSummary(core, { endpoint?, stripeStep }) -> Envelope
// a pure transform of the completed runStartCore envelope into the human close.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { interactiveCloseSummary } from "../src/lib/start-close.ts";
import type { Envelope } from "../features/support/envelope.ts";

const STRIPE_STEP =
  "Last step is yours, once Jolly's done: paste the Stripe keys in the Saleor Dashboard.";
const SIDE_EFFECTING = ["store", "storefront", "recipe", "stock", "deploy", "stripe"];

function baseCore(overrides: Partial<Envelope> = {}): Envelope {
  return {
    command: "start",
    status: "warning",
    summary: "Bootstrap complete; proceeding through the orchestrated stages.",
    data: {
      stages: SIDE_EFFECTING.map((stage) => ({ stage, status: "completed" })),
      store: { dashboardUrl: "https://shop.saleor.cloud/dashboard/" },
      deploy: {
        storefrontUrl: "https://shop.vercel.app",
        deploymentUrl: "https://shop.vercel.app",
      },
    },
    checks: [
      { id: "store-provisioned", status: "pass" },
      { id: "vercel-deployed", status: "pass" },
    ],
    nextSteps: [{ description: "Open the installed Stripe app's configuration ..." }],
    errors: [],
    ...overrides,
  } as Envelope;
}

describe("interactiveCloseSummary — success close", () => {
  test("names the Saleor Dashboard URL, the deployed storefront URL, and the Stripe step", () => {
    const r = interactiveCloseSummary(baseCore(), { stripeStep: STRIPE_STEP });
    assert.match(r.summary, /shop\.saleor\.cloud\/dashboard\//, "names the Dashboard URL");
    assert.match(r.summary, /shop\.vercel\.app/, "names the deployed storefront URL");
    assert.match(r.summary, /stripe/i, "names the remaining Stripe step");
  });

  test("renders no per-check or next-step machine detail on the human stream", () => {
    const r = interactiveCloseSummary(baseCore(), { stripeStep: STRIPE_STEP });
    assert.equal(r.checks.length, 0, "no checks[] enumeration");
    assert.equal(r.nextSteps.length, 0, "no nextSteps[] lines");
  });

  test("derives the Dashboard URL from the configured endpoint on the reuse path (no store data)", () => {
    const core = baseCore();
    (core.data as Record<string, unknown>).store = undefined; // reuse path carries no store data
    const r = interactiveCloseSummary(core, {
      endpoint: "https://shop.saleor.cloud/graphql/",
      stripeStep: STRIPE_STEP,
    });
    assert.match(r.summary, /shop\.saleor\.cloud\/dashboard\//);
    assert.match(r.summary, /shop\.vercel\.app/);
  });
});

describe("interactiveCloseSummary — genuine stage failure is honest, never fabricated", () => {
  function withFailedStage(stage: string, checkId: string, reason: string): Envelope {
    const core = baseCore();
    const stages = (core.data as { stages: Array<{ stage: string; status: string }> }).stages;
    for (const s of stages) if (s.stage === stage) s.status = "blocked";
    (core.data as Record<string, unknown>).deploy = {}; // no storefront URL on a failed deploy
    core.checks = [
      // Pre-flight bootstrap readiness checks that the run's own stages then
      // resolve (feature 027: never presented as a failure of the completed run).
      { id: "doctor-saleor-endpoint", status: "fail", description: "No Saleor GraphQL endpoint configured." },
      { id: "doctor-saleor-app-token", status: "fail", description: "No Saleor app token configured." },
      { id: "doctor-storefront-present", status: "fail", description: "No Paper storefront detected locally." },
      { id: "store-provisioned", status: "pass" },
      { id: checkId, status: "fail", description: reason },
    ] as Envelope["checks"];
    return core;
  }

  const FAIL_WORDS = /fail|did not|could not|stopped|not finish|incomplete|blocked/i;
  const FABRICATED_SUCCESS = /store is live|storefront is (?:deployed|live)|setup ran/i;
  // Pre-flight readiness wording the run resolved — must never appear as a failure reason.
  const PREFLIGHT_READINESS = /No Saleor GraphQL endpoint configured|No Saleor app token configured|No Paper storefront detected/i;

  test("a failed deploy stage is reported, not papered over as success", () => {
    const core = withFailedStage(
      "deploy",
      "vercel-deployed",
      "Did not deploy to Vercel: the Vercel CLI exited 1.",
    );
    const r = interactiveCloseSummary(core, {
      endpoint: "https://shop.saleor.cloud/graphql/",
      stripeStep: STRIPE_STEP,
    });
    assert.match(r.summary, /deploy/i, "names the failed deploy stage");
    assert.match(r.summary, FAIL_WORDS, "uses honest failure language");
    assert.doesNotMatch(r.summary, FABRICATED_SUCCESS, "must not fabricate success");
    assert.doesNotMatch(
      r.summary,
      /\.vercel\.app/,
      "must not present a deployed storefront URL when the deploy failed",
    );
    assert.doesNotMatch(
      r.summary,
      PREFLIGHT_READINESS,
      "must not present pre-flight readiness checks (resolved by the stages) as failures",
    );
    assert.equal(r.checks.length, 0, "still concise — no check enumeration");
  });

  test("a failed recipe stage is reported honestly", () => {
    const core = withFailedStage(
      "recipe",
      "recipe-deployed",
      "Did not deploy the starter recipe: @saleor/configurator deploy exited 3.",
    );
    const r = interactiveCloseSummary(core, {
      endpoint: "https://shop.saleor.cloud/graphql/",
      stripeStep: STRIPE_STEP,
    });
    assert.match(r.summary, /recipe/i, "names the failed recipe stage");
    assert.match(r.summary, FAIL_WORDS, "uses honest failure language");
    assert.doesNotMatch(r.summary, FABRICATED_SUCCESS, "must not fabricate success");
    assert.doesNotMatch(
      r.summary,
      PREFLIGHT_READINESS,
      "must not present pre-flight readiness checks (resolved by the stages) as failures",
    );
  });
});
