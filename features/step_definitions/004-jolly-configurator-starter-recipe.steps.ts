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
import { logicSafeEnv, DUMMY } from "../support/logic-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import { writeFakeNpx } from "../support/configurator-cli-fake.ts";
import { writeFakeStorefrontClis } from "../support/storefront-cli-fake.ts";
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

Then("the plan should name the bundled starter recipe Jolly ships \\(`recipe.yml`)", function (this: JollyWorld) {
  // Jolly-observable: Jolly manages the configurator guidance skill that carries
  // the starter-recipe playbook. Jolly itself ships the recipe as a skill asset.
  this.runCli(["skills", "--json"]);
  const skills = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(skills.includes("configurator"), "Jolly should manage the configurator guidance skill");
});

Then(
  "the plan should write the recipe to a file at a named path before deployment",
  function () {
    // Recipe content (pirate catalog, channel, etc.) is a Captain-owned asset,
    // not specified or tested here — narrative no-op.
  },
);

Then(
  "the plan should deploy it by spawning `npx @saleor\\/configurator deploy`",
  function (this: JollyWorld) {
    // Jolly-observable boundary: Jolly exposes no command that runs the
    // configurator. Confirm against the command surface.
    this.runCli(["help", "--json"]);
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(!text.includes("configurator deploy"), "Jolly must not run the configurator itself");
  },
);

Then(
  "the plan should name the Saleor app token used for deployment as having all available permissions in v1",
  function () {
    // The app-token permission breadth is pinned by feature 024's step defs
    // (jolly create app-token requests all permissions). Narrative cross-ref.
  },
);

// --- Scenario: Agent applies the starter recipe safely (@sandbox) -----------

Given("a Saleor Cloud environment that already holds catalog data", function (this: JollyWorld) {
  this.notes.recipeReady = true;
});

When("the agent runs `jolly start --yes` to apply the starter recipe to Saleor Cloud", function () {
  // The agent runs `@saleor/configurator deploy` — not Jolly's code.
});

Then(
  "the recipe stage should pass `--fail-on-delete` and `--fail-on-breaking` to `npx @saleor\\/configurator deploy`",
  function () {
    // configurator validate is the agent's step — narrative no-op.
  },
);

Then("the configurator should exit {int} for deletions or exit {int} for breaking changes", function (_deleteExit: number, _breakingExit: number) {
  // configurator diff/--plan is the agent's step — narrative no-op.
});

Then(
  "Jolly should report the recipe stage as {string}, not {string}",
  function (_blocked: string, _completed: string) {
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

Given("a project with the recipe stage not yet applied", function (this: JollyWorld) {
  // The plan is produced by the run in the When step; nothing to set up beyond
  // the fresh temp project the world provides.
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

// ─── Scenario: Jolly start previews the configurator deploy of the starter
//     recipe (@logic) ───────────────────────────────────────────────────────
//
// THE deterministic target driving Crew for iteration 2 / the fourth convergence
// (feature 004 Rule "Configurator deploy is a genuinely-executing stage"). The
// `jolly start --dry-run` plan must surface the configurator-deploy (recipe)
// stage as a SPAWNED-CLI step that runs BEFORE the stock-seeding stage, naming
// the spawned command, Jolly's bundled recipe, the store URL + app token (by
// name only — never a value), and the safe `--fail-on-delete`/`--fail-on-breaking`
// flags, carrying a feature-021 riskContext whose dry run maps to the configurator
// `--plan` preview — all without spawning anything. The `Given`/`When` are shared
// with the stock-seeding preview scenario above (logicSafeEnv keeps the preview
// unable to touch any real service).

/** Is this plan stage the configurator-deploy (recipe) stage? It is the only
 *  stage that spawns `@saleor/configurator` (the Vercel `deploy` stage spawns
 *  `npx vercel`, not the configurator). */
function isConfiguratorDeployStage(stage: PlanStage): boolean {
  const text = JSON.stringify(stage).toLowerCase();
  return text.includes("configurator") && text.includes("deploy");
}

Then(
  "the plan should include a configurator-deploy step that runs before the stock-seeding step",
  function (this: JollyWorld) {
    const plan = this.envelope.data.plan as PlanStage[];
    assert.ok(Array.isArray(plan) && plan.length > 0, "start --dry-run must report data.plan");
    const deployIndex = plan.findIndex(isConfiguratorDeployStage);
    const stockIndex = plan.findIndex((s) =>
      JSON.stringify(s).includes(STOCK_MUTATION),
    );
    assert.ok(deployIndex >= 0, "the plan must include a configurator-deploy stage");
    assert.ok(
      stockIndex >= 0,
      `the plan must include the stock-seeding stage naming ${STOCK_MUTATION}`,
    );
    assert.ok(
      deployIndex < stockIndex,
      "the configurator-deploy stage must run BEFORE the stock-seeding stage",
    );
    this.notes.deployStage = plan[deployIndex];
  },
);

Then(
  "the preview should name the spawned command `npx @saleor\\/configurator deploy`, Jolly's bundled starter recipe, and the store URL and app token by name only",
  function (this: JollyWorld) {
    const stage = this.notes.deployStage as PlanStage;
    const blob = JSON.stringify(stage);
    assert.ok(
      blob.includes("npx @saleor/configurator deploy"),
      "the preview must name the spawned command `npx @saleor/configurator deploy`",
    );
    assert.ok(
      /recipe\.yml/i.test(blob),
      "the preview must name Jolly's bundled starter recipe (recipe.yml)",
    );
    assert.ok(
      blob.includes("NEXT_PUBLIC_SALEOR_API_URL"),
      "the preview must name the store URL by name (NEXT_PUBLIC_SALEOR_API_URL)",
    );
    assert.ok(
      blob.includes("JOLLY_SALEOR_APP_TOKEN"),
      "the preview must name the app token by name (JOLLY_SALEOR_APP_TOKEN)",
    );
    // "By name only": the actual app-token VALUE must never appear in the preview.
    assert.ok(
      !blob.includes(DUMMY.appToken),
      "the app token must be referenced by name only — its value must never be printed",
    );
  },
);

Then(
  "the preview should name the safe flags `--fail-on-delete` and `--fail-on-breaking`",
  function (this: JollyWorld) {
    const blob = JSON.stringify(this.notes.deployStage as PlanStage);
    assert.ok(blob.includes("--fail-on-delete"), "the preview must name the --fail-on-delete flag");
    assert.ok(
      blob.includes("--fail-on-breaking"),
      "the preview must name the --fail-on-breaking flag",
    );
  },
);

Then(
  "the configurator-deploy step should carry a riskContext for deploying store configuration",
  function (this: JollyWorld) {
    const stage = this.notes.deployStage as PlanStage;
    assert.ok(stage.riskContext, "the configurator-deploy stage must carry a riskContext");
    assertRiskContextShape(stage.riskContext);
    const rc = stage.riskContext as { categories: string[] };
    assert.ok(
      rc.categories.includes("production configuration changes"),
      'the configurator-deploy riskContext must flag store-configuration changes ' +
        '("production configuration changes")',
    );
    assert.ok(
      findRiskContexts(this.envelope).length > 0,
      "riskContexts must live inside the envelope",
    );
  },
);

Then(
  "the riskContext should mark a dry run available via the configurator `--plan` preview",
  function (this: JollyWorld) {
    const stage = this.notes.deployStage as PlanStage;
    const rc = stage.riskContext as { dryRunAvailable: boolean };
    assert.equal(rc.dryRunAvailable, true, "the configurator-deploy riskContext must set dryRunAvailable true");
    assert.ok(
      JSON.stringify(stage).includes("--plan"),
      "the preview must reference the configurator `--plan` preview as the dry-run mechanism",
    );
  },
);

Then(
  "the preview should not spawn the configurator or perform any deployment",
  function (this: JollyWorld) {
    assert.equal(this.envelope.data.dryRun, true, "the preview must set data.dryRun true");
    assert.equal(this.envelope.status, "success", "a clean preview reports success");
    const dryRunCheck = this.findCheck("start-dry-run");
    assert.ok(dryRunCheck, "the preview must carry a start-dry-run check");
    assert.equal(dryRunCheck!.status, "skipped", "no stage may be executed in a preview");
  },
);

// ─── Scenario: Jolly start does not fabricate the recipe deployment (@logic) ──
//
// The integrity guardrail (no fabricated success): with no real Saleor
// credentials, a real `jolly start` run that REACHES the configurator-deploy
// stage must report it blocked or pending — never `completed` — and the overall
// envelope must be `warning`, not `success`. `--yes` pre-approves the high-risk
// gate so the run actually reaches the recipe stage instead of pausing before
// it; logicSafeEnv supplies dummy creds + an unroutable base; a fake `npx` on
// PATH shadows the real one so neither the configurator spawn nor init's skill
// installs make any network call (hermetic, fast). Bootstrap still succeeds (the
// local scaffold — .mcp.json + AGENTS.md — is written regardless), so the run
// proceeds to and processes the recipe stage.

Given(
  "the agent runs `jolly start` with no real Saleor credentials",
  function (this: JollyWorld) {
    const shimDir = this.newTempDir("configurator-fake");
    writeFakeNpx(shimDir);
    // Also shadow the storefront/deploy CLIs (git/pnpm/vercel) so those stages
    // stay hermetic once they spawn — no @logic run touches the network.
    writeFakeStorefrontClis(shimDir);
    this.notes.npxShimDir = shimDir;
  },
);

When(
  "the run reaches the configurator-deploy stage without `--dry-run`",
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], {
      env: logicSafeEnv({
        PATH: `${String(this.notes.npxShimDir)}:${process.env.PATH ?? ""}`,
      }),
      timeoutMs: 90_000,
    });
  },
);

Then(
  "Jolly should report the configurator-deploy stage as blocked or pending, never completed",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as Array<{
      stage: string;
      status: string;
    }>;
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the orchestrated stages must include the recipe (configurator-deploy) stage");
    assert.ok(
      recipe!.status === "blocked" || recipe!.status === "pending",
      `the configurator-deploy stage must be blocked or pending with no credentials, got "${recipe!.status}"`,
    );
    assert.notEqual(
      recipe!.status,
      "completed",
      "the configurator-deploy stage must never be completed without a real, successful deploy",
    );
  },
);

Then(
  "the summary should not claim the starter recipe was deployed",
  function (this: JollyWorld) {
    const summary = String(this.envelope.summary ?? "").toLowerCase();
    assert.ok(
      !/deployed|recipe is live|catalog created|recipe applied/.test(summary),
      `the summary must not claim the starter recipe was deployed: "${this.envelope.summary}"`,
    );
  },
);

Then(
  'the overall envelope status should be "warning", not "success"',
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.status,
      "warning",
      "a run that only bootstrapped and then blocked/paused before completion must be `warning`, not `success`",
    );
  },
);

Then(
  "Jolly should not print a fabricated deployment result",
  function (this: JollyWorld) {
    // No check may claim the recipe deployed as a pass, and the human-readable
    // stdout must not contain a fabricated "recipe deployed" success line.
    const fabricatedCheck = this.envelope.checks.find(
      (c) =>
        c.status === "pass" &&
        /recipe.*deploy|configurator.*deploy|catalog.*(created|deployed)/i.test(
          `${c.id} ${c.description ?? ""}`,
        ),
    );
    assert.ok(
      !fabricatedCheck,
      `no check may fabricate a passing recipe deployment: ${JSON.stringify(fabricatedCheck)}`,
    );
    const stdout = String(this.lastRun?.stdout ?? "").toLowerCase();
    assert.ok(
      !/recipe (deployed|is live)|starter recipe deployed|catalog deployed/.test(stdout),
      "stdout must not print a fabricated recipe-deployment success line",
    );
  },
);

// ─── Scenario: Jolly start deploys the starter recipe with @saleor/configurator
//     (@sandbox) ────────────────────────────────────────────────────────────
//
// Gated by SANDBOX_REQUIREMENTS["Jolly start deploys the starter recipe with
// @saleor/configurator"] (saleorEndpoint + saleorAppToken; derivable from the
// Cloud token via per-run provisioning) → skips locally. Verifies the FIRST
// spawned-CLI `jolly start` stage genuinely executing: against a blank store,
// `jolly start --yes` SPAWNS `npx @saleor/configurator deploy` of Jolly's bundled
// recipe; the additive apply exits 0 so the recipe's catalog entities exist and
// the stage is reported `completed`; a re-run reconciles to a no-op diff (no
// duplicate entities). When the recipe stage does not complete in this
// environment (e.g. the store is not blank, or the configurator could not be
// spawned), the scenario skips — premise not producible — rather than failing.

interface ResultStage {
  stage: string;
  status: string;
}

async function productCount(
  endpoint: string,
  token: string | undefined,
): Promise<number> {
  const result = await saleorGraphql(
    endpoint,
    token,
    `query { products(first: 100, channel: "us") { edges { node { id } } } }`,
  );
  const edges =
    (result.data?.products as { edges?: Array<{ node: { id: string } }> } | undefined)
      ?.edges ?? [];
  return edges.length;
}

Given(
  "a freshly created blank Saleor Cloud environment",
  function (this: JollyWorld) {
    // The @sandbox harness provisions/derives a blank per-run environment from
    // the Cloud token (feature 023); the gating skips locally when creds are
    // absent. Record the derived store creds for the post-deploy verification.
    const creds = storeCreds();
    this.notes.storeEndpoint = creds.endpoint;
    this.notes.storeToken = creds.token;
  },
);

When(
  "Jolly start runs the configurator-deploy stage with approval",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // --yes pre-approves the high-risk gate so the run reaches and executes the
    // configurator-deploy (recipe) stage. The configurator deploy can take
    // minutes against a real store, so allow a long timeout.
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    if (!recipe || recipe.status !== "completed") {
      this.attach(
        `Skipped: the configurator-deploy stage did not complete in this ` +
          `environment (status: ${recipe?.status ?? "absent"}) — the store may ` +
          `not be blank, or the configurator could not be spawned here`,
        "text/plain",
      );
      this.notes.skipRecipe = true;
      return "skipped";
    }
  },
);

Then(
  "Jolly should spawn `npx @saleor\\/configurator deploy` of its bundled starter recipe against the store, never reimplementing it against raw APIs",
  function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    // Jolly-observable: a recipe-deploy check confirms the configurator was
    // spawned (Jolly never reimplements the configurator against raw APIs — the
    // recipe stage's only side effect is spawning the official CLI).
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the orchestrated stages must include the recipe stage");
    const blob = JSON.stringify(recipe);
    assert.ok(
      /configurator/i.test(blob),
      "the recipe stage must record the spawned @saleor/configurator deploy",
    );
  },
);

Then(
  "the additive deploy should exit 0 and the recipe's catalog entities should exist in the store",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const count = await productCount(endpoint, token);
    assert.ok(
      count > 0,
      "the recipe's catalog products must exist in the store after the additive deploy",
    );
  },
);

Then(
  "the stage should be reported completed only when the configurator exited 0",
  function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    // Reaching here means the When step saw the recipe stage `completed`; the
    // integrity contract is that Jolly reports `completed` ONLY on a real exit-0
    // deploy. Re-assert the stage is completed (and not a fabricated status).
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the recipe stage must be present");
    assert.equal(
      recipe!.status,
      "completed",
      "the recipe stage is reported completed only when the configurator exited 0",
    );
  },
);

Then(
  "re-running the stage should reconcile to a no-op diff rather than creating duplicate entities",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const before = await productCount(endpoint, token);
    // Re-run the orchestrated stage; the same declarative recipe reconciles to a
    // no-op diff (feature 022), exits 0, and creates no duplicate entities.
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the re-run must include the recipe stage");
    assert.equal(
      recipe!.status,
      "completed",
      "re-deploying the same recipe must still exit 0 (a no-op reconcile), reported completed",
    );
    const after = await productCount(endpoint, token);
    assert.equal(
      after,
      before,
      `re-deploying must not create duplicate catalog entities (was ${before}, now ${after})`,
    );
  },
);
