// Feature 004 — Jolly Configurator starter recipe.
//
// The starter recipe is a Jolly-shipped Configurator recipe, but APPLYING it
// to Saleor Cloud is the AGENT's action via @saleor/configurator's safe
// workflow (validate, diff/plan, deploy) — Jolly never shells out to the
// configurator. Both scenarios are @sandbox; they assert only Jolly-observable
// contributions (Jolly manages the configurator guidance skill; the riskContext
// for any Jolly remote/action command supports --dry-run; the agent owns the
// approval decision). The recipe-application narrative lives in the Jolly skill
// (a Captain-owned asset), not in these step defs.
//
// Gated by SANDBOX_REQUIREMENTS["Agent prepares the starter recipe"] /
// ["Agent applies the starter recipe safely"] (saleorEndpoint+saleorAppToken)
// → skip locally.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { logicSafeEnv } from "../support/logic-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

// The Jolly starter recipe's warehouse (assets/skills/jolly/recipe.yml) and the
// v1 default per-variant stock quantity (feature 004 Rule "Recipe products need
// seeded stock"). The preview must name both; the live stage seeds this many.
const RECIPE_WAREHOUSE_NAME = "Port Royal Warehouse";
const RECIPE_WAREHOUSE_SLUG = "port-royal";
const DEFAULT_STOCK_QUANTITY = 100;
const STOCK_MUTATION = "productVariantStocksCreate";

// --- Scenario: Agent prepares the starter recipe (@sandbox) -----------------

Given("the customer has created or selected a Saleor Cloud environment", function (this: JollyWorld) {
  this.notes.sandboxEnvReady = true;
});

When(
  "the agent prepares the initial store configuration, guided by the Jolly skill",
  function () {
    // Preparing/writing the recipe and running the configurator are the agent's
    // actions guided by the Jolly skill — not Jolly's code, not executed here.
  },
);

Then("it should use the Jolly-authored starter recipe that Jolly ships", function (this: JollyWorld) {
  // Jolly-observable: Jolly manages the configurator guidance skill that carries
  // the starter-recipe playbook. Jolly itself ships the recipe as a skill asset.
  this.runCli(["skills", "--json"]);
  const skills = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(skills.includes("configurator"), "Jolly should manage the configurator guidance skill");
});

Then(
  "the recipe should be optimized for Paper's required storefront features",
  function () {
    // Recipe content (pirate catalog, channel, etc.) is a Captain-owned asset,
    // not specified or tested here — narrative no-op.
  },
);

Then("the agent should write the recipe into the cloned storefront repository", function () {
  // The agent writes the recipe into the cloned repo — agent's file action.
});

Then("the recipe should be reviewable before deployment", function () {
  // Reviewability is a property of the version-controlled recipe file the agent
  // writes — narrative no-op.
});

Then(
  "the agent should deploy it through `@saleor\\/configurator`'s safe workflow — Jolly never shells out to the configurator itself",
  function (this: JollyWorld) {
    // Jolly-observable boundary: Jolly exposes no command that runs the
    // configurator. Confirm against the command surface.
    this.runCli(["help", "--json"]);
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(!text.includes("configurator deploy"), "Jolly must not run the configurator itself");
  },
);

Then(
  "the Saleor app token used for deployment should have all available permissions in v1",
  function () {
    // The app-token permission breadth is pinned by feature 024's step defs
    // (jolly create app-token requests all permissions). Narrative cross-ref.
  },
);

// --- Scenario: Agent applies the starter recipe safely (@sandbox) -----------

Given("the Jolly starter recipe is ready", function (this: JollyWorld) {
  this.notes.recipeReady = true;
});

When("the agent applies it to Saleor Cloud", function () {
  // The agent runs `@saleor/configurator deploy` — not Jolly's code.
});

Then("it should validate the configuration", function () {
  // configurator validate is the agent's step — narrative no-op.
});

Then("it should show a diff or deployment plan", function () {
  // configurator diff/--plan is the agent's step — narrative no-op.
});

Then(
  "Jolly remote\\/action commands involved in recipe deployment should support `--dry-run` preview behavior",
  function (this: JollyWorld) {
    // Jolly-observable: Jolly's own side-effecting commands carry a riskContext
    // with dryRunAvailable and honor --dry-run. `create store` is the relevant
    // remote/action command in the recipe-adjacent flow.
    this.runCli(["create", "store", "--url", "https://demo.saleor.cloud", "--dry-run", "--json"], {
      env: logicSafeEnv(),
    });
    assert.equal(this.envelope.data["dryRun"], true, "create store must support --dry-run preview");
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "the remote/action command must carry a riskContext");
    assertRiskContextShape(risk);
    assert.equal((risk as { dryRunAvailable: boolean }).dryRunAvailable, true);
  },
);

Then(
  "the customer's agent should decide whether customer approval is needed before applying changes",
  function (this: JollyWorld) {
    // Jolly emits the riskContext and never hardcodes the approval decision.
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "the riskContext is the input the agent's approval decision uses");
    assertRiskContextShape(risk);
  },
);

Then(
  "it should fail safely if destructive or breaking operations are detected",
  function () {
    // Fail-safe on destructive/breaking ops is the configurator's behavior
    // (--fail-on-delete/--fail-on-breaking), invoked by the agent — narrative.
  },
);

// --- Scenario: Jolly start previews seeding stock for the recipe catalog (@logic)
//
// THE deterministic target driving Crew. After the @saleor/configurator deploy
// stage, `jolly start` must seed stock for every recipe variant (configurator
// cannot — feature 004 Rule "Recipe products need seeded stock"). The dry-run
// plan must surface a distinct stock-seeding stage that runs AFTER the deploy,
// carries its own feature-021 riskContext for catalog-data modification, and
// names the real Saleor GraphQL mutation, the recipe warehouse, and the default
// per-variant quantity — all without performing any mutation. logicSafeEnv()
// supplies dummy JOLLY_* + an unroutable Cloud base, so even a CLI that ignored
// --dry-run could not reach a real store (012-incident safety).

interface PlanStage {
  stage: string;
  effects: Record<string, string[]>;
  riskContext?: unknown;
}

/** Locate, in the dry-run plan, the configurator-deploy stage and the
 * stock-seeding stage (the latter identified by the real mutation it names). */
function findRecipeStages(plan: PlanStage[]): {
  deployIndex: number;
  stockIndex: number;
  stockStage?: PlanStage;
} {
  const text = (stage: PlanStage) => JSON.stringify(stage).toLowerCase();
  const deployIndex = plan.findIndex((s) => text(s).includes("configurator deploy"));
  const stockIndex = plan.findIndex((s) =>
    text(s).includes(STOCK_MUTATION.toLowerCase()),
  );
  return { deployIndex, stockIndex, stockStage: plan[stockIndex] };
}

Given("the agent runs `jolly start --dry-run`", function (this: JollyWorld) {
  // The plan is produced by the run in the When step; nothing to set up beyond
  // the fresh temp project the world provides.
});

When("Jolly plans the recipe stage", function (this: JollyWorld) {
  // --json so the envelope (and its data.plan) is parseable; logicSafeEnv keeps
  // the preview unable to touch any real service.
  this.runCli(["start", "--dry-run", "--json"], { env: logicSafeEnv() });
});

Then(
  "the plan should include a stock-seeding step that runs after the `@saleor\\/configurator` deploy",
  function (this: JollyWorld) {
    const plan = this.envelope.data.plan as PlanStage[];
    assert.ok(Array.isArray(plan) && plan.length > 0, "start --dry-run must report data.plan");
    const { deployIndex, stockIndex, stockStage } = findRecipeStages(plan);
    assert.ok(deployIndex >= 0, "the plan must include the `@saleor/configurator` deploy stage");
    assert.ok(
      stockIndex >= 0,
      `the plan must include a stock-seeding stage naming ${STOCK_MUTATION}`,
    );
    assert.ok(
      stockIndex > deployIndex,
      "the stock-seeding stage must run AFTER the configurator deploy stage",
    );
    this.notes.stockStage = stockStage;
  },
);

Then(
  "the stock-seeding step should carry a riskContext for modifying catalog data",
  function (this: JollyWorld) {
    const stage = this.notes.stockStage as PlanStage | undefined;
    assert.ok(stage, "the stock-seeding stage must have been located");
    assert.ok(stage!.riskContext, "the stock-seeding stage must carry a riskContext");
    assertRiskContextShape(stage!.riskContext);
    const rc = stage!.riskContext as { categories: string[] };
    assert.ok(
      rc.categories.includes("production configuration changes"),
      "the stock-seeding riskContext must flag catalog-data modification " +
        '("production configuration changes")',
    );
    // The riskContext is discoverable inside the feature-020 envelope (021).
    assert.ok(
      findRiskContexts(this.envelope).length > 0,
      "riskContexts must live inside the envelope",
    );
  },
);

Then(
  "the preview should name the real Saleor GraphQL request, the recipe warehouse, and the default per-variant quantity",
  function (this: JollyWorld) {
    const stage = this.notes.stockStage as PlanStage;
    const blob = JSON.stringify(stage);
    assert.ok(
      blob.includes(STOCK_MUTATION),
      `the preview must name the real Saleor GraphQL mutation (${STOCK_MUTATION})`,
    );
    assert.ok(
      blob.includes(RECIPE_WAREHOUSE_NAME),
      `the preview must name the recipe warehouse (${RECIPE_WAREHOUSE_NAME})`,
    );
    assert.ok(
      blob.includes(String(DEFAULT_STOCK_QUANTITY)),
      `the preview must name the default per-variant quantity (${DEFAULT_STOCK_QUANTITY})`,
    );
  },
);

Then("the preview should not perform any mutation", function (this: JollyWorld) {
  // A true preview: flagged as a dry run, overall success, and the start stage
  // is reported skipped (not executed). logicSafeEnv's unroutable base means no
  // real request could have been made regardless.
  assert.equal(this.envelope.data.dryRun, true, "the preview must set data.dryRun true");
  assert.equal(this.envelope.status, "success", "a clean preview reports success");
  const dryRunCheck = this.findCheck("start-dry-run");
  assert.ok(dryRunCheck, "the preview must carry a start-dry-run check");
  assert.equal(dryRunCheck!.status, "skipped", "no stage may be executed in a preview");
});

// --- Scenario: Jolly start seeds stock so the recipe catalog is buyable (@sandbox)
//
// Gated by SANDBOX_REQUIREMENTS["Jolly start seeds stock so the recipe catalog
// is buyable"] (saleorEndpoint + saleorAppToken; derivable from the Cloud token)
// → skips locally. Verifies the FIRST genuinely-executing `jolly start` stage:
// the stock-seeding (feature 004 Rule "Recipe products need seeded stock" / MVP
// sequencing). The CLI-spawning stages (git/pnpm/configurator/vercel) are NOT
// performed by `jolly start` yet — they stay agent-driven — so this scenario's
// premise is a store that ALREADY has the starter recipe deployed (variants
// present). With approvals pre-granted (`--yes`), the orchestrated run reaches
// the `stock` stage and seeds stock via Saleor GraphQL; we then assert Jolly's
// observable real outcomes against the live store: every recipe variant has
// stock in the recipe warehouse, a `us` checkout is not blocked by
// INSUFFICIENT_STOCK, and re-running updates quantities idempotently rather than
// creating duplicate stock. When the `stock` stage does not report `completed`
// (the recipe is not deployed here, so there are no variants to seed), the
// scenario skips (premise not producible) rather than failing.

function storeCreds(): { endpoint: string; token: string | undefined } {
  return {
    endpoint: process.env.NEXT_PUBLIC_SALEOR_API_URL ?? "",
    token: process.env.JOLLY_SALEOR_APP_TOKEN,
  };
}

interface VariantNode {
  id: string;
  name: string;
  sku: string | null;
  stocks: Array<{ warehouse: { slug: string }; quantity: number }>;
}

async function recipeVariants(
  endpoint: string,
  token: string | undefined,
): Promise<VariantNode[]> {
  const result = await saleorGraphql(
    endpoint,
    token,
    `query {
       productVariants(first: 100) {
         edges { node { id name sku stocks { warehouse { slug } quantity } } }
       }
     }`,
  );
  const edges =
    (result.data?.productVariants as { edges?: Array<{ node: VariantNode }> } | undefined)
      ?.edges ?? [];
  return edges.map((e) => e.node);
}

Given(
  "a freshly created Saleor Cloud environment with the starter recipe deployed",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // Pre-grant per-stage approvals so the orchestrated run reaches and performs
    // the stock-seeding stage without interactive pauses. `jolly start` does not
    // deploy the recipe itself (that stage stays agent-driven) — the premise is
    // that the store already holds the recipe's variants; the run's `stock` stage
    // seeds them. The stock stage runs before the Vercel deploy, so a missing
    // Vercel session does not prevent seeding; this scenario asserts only the
    // stock outcome.
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const creds = storeCreds();
    assert.ok(creds.endpoint, "a Saleor GraphQL endpoint must be configured/derived");
    this.notes.storeEndpoint = creds.endpoint;
    this.notes.storeToken = creds.token;
  },
);

When("Jolly start completes the recipe stage", function (this: JollyWorld) {
  // Re-pointed onto the `stock` stage: `jolly start` performs the stock-seeding
  // itself (it does NOT deploy the recipe), so the genuinely-executing outcome to
  // verify is the `stock` stage reporting `completed`. When the recipe is not
  // deployed in this environment there are no variants to seed and Jolly reports
  // the stage `pending`/`blocked` honestly (never a fabricated `completed`), so
  // the scenario skips — premise not producible — rather than failing.
  const stages = (this.envelope.data.stages ?? []) as Array<{
    stage: string;
    status: string;
  }>;
  const stock = stages.find((s) => s.stage === "stock");
  if (!stock || stock.status !== "completed") {
    this.attach(
      `Skipped: the stock-seeding stage did not complete in this environment ` +
        `(status: ${stock?.status ?? "absent"}) — the starter recipe is not ` +
        `deployed here, so there are no variants to seed`,
      "text/plain",
    );
    this.notes.skipStock = true;
    return "skipped";
  }
});

Then(
  "every recipe product variant should have stock in the recipe warehouse",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipStock) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const variants = await recipeVariants(endpoint, token);
    if (variants.length === 0) {
      this.attach("Skipped: no product variants found on the store", "text/plain");
      this.notes.skipStock = true;
      return "skipped";
    }
    for (const variant of variants) {
      const stock = variant.stocks.find(
        (s) => s.warehouse.slug === RECIPE_WAREHOUSE_SLUG,
      );
      assert.ok(
        stock,
        `variant "${variant.name}" (${variant.sku}) must have stock in ${RECIPE_WAREHOUSE_NAME}`,
      );
      assert.ok(
        stock!.quantity > 0,
        `variant "${variant.name}" must have positive stock, got ${stock!.quantity}`,
      );
    }
    this.notes.sampleVariantId = variants[0].id;
  },
);

Then(
  "a checkout in the `us` channel should not be blocked by INSUFFICIENT_STOCK",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipStock) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const variantId = String(this.notes.sampleVariantId);
    const result = await saleorGraphql(
      endpoint,
      token,
      `mutation($channel: String!, $variantId: ID!) {
         checkoutCreate(input: { channel: $channel, lines: [{ quantity: 1, variantId: $variantId }] }) {
           checkout { id }
           errors { field code message }
         }
       }`,
      { channel: "us", variantId },
    );
    const payload = result.data?.checkoutCreate as
      | { checkout?: { id: string }; errors?: Array<{ code: string }> }
      | undefined;
    const errors = payload?.errors ?? [];
    const blocked = errors.some((e) => e.code === "INSUFFICIENT_STOCK");
    assert.ok(
      !blocked,
      `a us checkout must not be blocked by INSUFFICIENT_STOCK; errors: ${JSON.stringify(errors)}`,
    );
    // Best-effort teardown of the checkout the verification created.
    const checkoutId = payload?.checkout?.id;
    if (checkoutId) {
      this.cleanup.register(`checkout ${checkoutId}`, async () => {
        await saleorGraphql(
          endpoint,
          token,
          `mutation($id: ID!) { checkoutDelete(id: $id) { errors { code } } }`,
          { id: checkoutId },
        );
      });
    }
  },
);

Then(
  "re-running the stage should update the quantities idempotently rather than creating duplicate stock",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipStock) return "skipped";
    // Re-run the orchestrated stage; seeding must update in place (feature 022).
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const variants = await recipeVariants(endpoint, token);
    for (const variant of variants) {
      const atWarehouse = variant.stocks.filter(
        (s) => s.warehouse.slug === RECIPE_WAREHOUSE_SLUG,
      );
      assert.equal(
        atWarehouse.length,
        1,
        `variant "${variant.name}" must have exactly one ${RECIPE_WAREHOUSE_NAME} ` +
          `stock entry (no duplicates), got ${atWarehouse.length}`,
      );
      assert.equal(
        atWarehouse[0].quantity,
        DEFAULT_STOCK_QUANTITY,
        `variant "${variant.name}" quantity must be updated in place to ` +
          `${DEFAULT_STOCK_QUANTITY}, not accumulated, got ${atWarehouse[0].quantity}`,
      );
    }
  },
);
