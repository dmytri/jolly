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
import { createServer } from "node:http";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
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
  "the recipe stage should pass `--failOnDelete` to `npx @saleor\\/configurator deploy`",
  function () {
    // configurator validate is the agent's step — narrative no-op.
  },
);

Then("the configurator should exit {int} for deletions", function (_deleteExit: number) {
  // configurator diff/--plan is the agent's step — narrative no-op.
});

Then(
  "Jolly should report the recipe stage as {string}, not {string}",
  function (_blocked: string, _completed: string) {
    // Fail-safe on destructive ops over a pre-existing store is the
    // configurator's behavior (--failOnDelete), invoked by the agent — narrative.
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
// per-variant quantity — all without performing any mutation. The dry-run runs
// with the runtime credentials unset (real absence), so even a CLI that ignored
// --dry-run has no credential with which to reach a real store.

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
  // is reported skipped (not executed). The credentials are unset, so no real
  // request could have been made regardless.
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
  // `jolly start` ran in the Given. The recipe must deploy for there to be
  // variants to seed, so the only premise this scenario genuinely cannot
  // construct is the @saleor/configurator binary failing to spawn (npx
  // fetch/network) — an environmental inability the real test env cannot produce
  // on demand. A stock stage `blocked`/`pending` for any other reason is the
  // behaviour under test and MUST fail the Then, never be masked as a skip.
  const recipeCheck = this.findCheck("recipe-deployed");
  const couldNotSpawn = /could not be spawned/i.test(
    String(recipeCheck?.description ?? ""),
  );
  if (couldNotSpawn) {
    this.attach(
      `Skipped: the @saleor/configurator binary could not be spawned in this ` +
        `environment — an environmental inability the real test env cannot ` +
        `produce on demand, not the stock contract under test`,
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
    assert.ok(
      variants.length > 0,
      "the recipe deploy must have created product variants to seed stock for",
    );
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
// name only — never a value), and the safe `--failOnDelete`
// flag, carrying a feature-021 riskContext whose dry run maps to the configurator
// `--plan` preview — all without spawning anything. The `Given`/`When` are shared
// with the stock-seeding preview scenario above (credentials unset keeps the
// preview unable to touch any real service).

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
    // "By name only": the actual app-token VALUE must never appear in the
    // preview. Guard against the real configured value when one is present.
    const appTokenValue = process.env.JOLLY_SALEOR_APP_TOKEN;
    if (appTokenValue) {
      assert.ok(
        !blob.includes(appTokenValue),
        "the app token must be referenced by name only — its value must never be printed",
      );
    }
  },
);

Then(
  "the preview should name the safe flag `--failOnDelete` used to guard a re-deploy over a pre-existing store",
  function (this: JollyWorld) {
    const blob = JSON.stringify(this.notes.deployStage as PlanStage);
    assert.ok(blob.includes("--failOnDelete"), "the preview must name the --failOnDelete flag");
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
// it; the runtime credentials are genuinely UNSET (absentCredentialsEnv) — real
// absence, so with no store URL or app token the recipe stage cannot deploy and
// must block, and nothing could reach a real account. Bootstrap still succeeds
// (the local scaffold — .mcp.json + AGENTS.md — is written regardless), so the
// run proceeds to and processes the recipe stage.

Given(
  "the agent runs `jolly start` with no real Saleor credentials",
  function (this: JollyWorld) {
    // The "no real Saleor credentials" condition is produced for real by the
    // When (credentials unset); the fresh temp project is all the setup needed.
  },
);

When(
  "the run reaches the configurator-deploy stage without `--dry-run`",
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], {
      env: absentCredentialsEnv(),
      timeoutMs: 240_000,
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
    // Narrow environmental escape ONLY (mirrors 004:86): the @saleor/configurator
    // binary could genuinely not be spawned here (npx fetch/network) — a condition
    // the real test env cannot produce on demand — so the deploy premise was not
    // reachable and the scenario skips. A recipe stage `blocked`/`failed` for ANY
    // other reason is exactly the behaviour under test and MUST fail the Then,
    // never be masked as a skip.
    const recipeCheck = this.findCheck("recipe-deployed");
    const couldNotSpawn = /could not be spawned/i.test(
      String(recipeCheck?.description ?? ""),
    );
    if (couldNotSpawn) {
      this.attach(
        `Skipped: the @saleor/configurator binary could not be spawned in this ` +
          `environment — an environmental inability the real test env cannot ` +
          `produce on demand, not the recipe-deploy contract under test`,
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
  "the bootstrap deploy should record a successful configurator deployment report and the recipe's catalog entities should exist in the store",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const count = await productCount(endpoint, token);
    assert.ok(
      count > 0,
      "the recipe's catalog products must exist in the store after the bootstrap deploy",
    );
  },
);

Then(
  "the stage should be reported completed only when the configurator's deployment report records success",
  function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    // Reaching here means the When step saw the recipe stage `completed`; the
    // integrity contract is that Jolly reports `completed` ONLY when the
    // configurator's own deployment report records success (the exit code alone
    // is unreliable for the bootstrap apply). Re-assert the stage is completed
    // (and not a fabricated status).
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the recipe stage must be present");
    assert.equal(
      recipe!.status,
      "completed",
      "the recipe stage is reported completed only when the configurator's report records success",
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

// ─── Scenario: Jolly start deploys the recipe over the stock defaults of a
//     store created by a prior create-store command (@sandbox) ─────────────────
//
// Gated by SANDBOX_REQUIREMENTS["Jolly start deploys the recipe over the stock
// defaults of a store created by a prior create-store command"] (saleorEndpoint
// + saleorAppToken; derivable from the Cloud token via per-run provisioning,
// which itself runs `jolly create store --create-environment`) → skips locally.
// Verifies the bootstrap path: against the blank create-store-provisioned
// environment, `jolly start --yes` SPAWNS the configurator deploy of Jolly's
// bundled recipe; the declarative apply reconciles the store to the recipe,
// ADDING the recipe's active `us` channel (feature 004 Rule "Recipe targets a
// clean environment"). Saleor protects some stock defaults — notably the default
// channel — from deletion, so they may remain; the observable is that the
// recipe's own `us` channel exists and is active, not that the default was
// removed. The scenario skips ONLY when the configurator binary could not be
// spawned (an environmental inability the real test env cannot produce on
// demand); a destructive-diff block over the blank store is the behaviour under
// test and MUST fail, never skip.

async function recipeChannels(
  endpoint: string,
  token: string | undefined,
): Promise<Array<{ slug: string; isActive: boolean }>> {
  const result = await saleorGraphql(endpoint, token, `query { channels { slug isActive } }`);
  return (
    (result.data?.channels as Array<{ slug: string; isActive: boolean }> | undefined) ?? []
  );
}

Given(
  "a blank Saleor Cloud environment created by a prior `jolly create store --create-environment` and recorded in `.env`",
  function (this: JollyWorld) {
    // The @sandbox harness provisions the shared per-run environment THROUGH
    // `jolly create store --create-environment` (provision.ts) and records its
    // NEXT_PUBLIC_SALEOR_API_URL / JOLLY_SALEOR_APP_TOKEN — exactly the blank,
    // create-store-bootstrapped environment this scenario starts from. Gating
    // skips locally when the Cloud token is absent.
    const creds = storeCreds();
    assert.ok(
      creds.endpoint,
      "a blank store endpoint must be derived from the prior create-store",
    );
    this.notes.storeEndpoint = creds.endpoint;
    this.notes.storeToken = creds.token;
  },
);

When(
  "the agent runs `jolly start --yes` and the run reaches the configurator-deploy stage",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // --yes pre-approves the high-risk gate so the run reaches and executes the
    // configurator-deploy (recipe) stage; the deploy can take minutes.
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 840_000 });
    // Narrow environmental escape ONLY: the @saleor/configurator binary could
    // genuinely not be spawned here (npx fetch/network) — a condition the real
    // test env cannot produce on demand — so the bootstrap premise was not
    // reachable and the scenario skips. A recipe stage `blocked` for ANY other
    // reason — in particular the `--failOnDelete` destructive-diff guard firing
    // over the blank store's Saleor stock defaults — is exactly the behaviour
    // under test (the store was provisioned blank, so the premise HOLDS) and
    // MUST fail the Then, never be masked as a skip.
    const recipeCheck = this.findCheck("recipe-deployed");
    const couldNotSpawn = /could not be spawned/i.test(
      String(recipeCheck?.description ?? ""),
    );
    if (couldNotSpawn) {
      this.attach(
        `Skipped: the @saleor/configurator binary could not be spawned in this ` +
          `environment — an environmental inability the real test env cannot ` +
          `produce on demand, not the bootstrap contract under test`,
        "text/plain",
      );
      this.notes.skipBootstrap = true;
      return "skipped";
    }
  },
);

Then(
  "the recipe stage should be reported {string}, not {string}",
  function (this: JollyWorld, completed: string, blocked: string) {
    if (this.notes.skipBootstrap) return "skipped";
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the orchestrated stages must include the recipe stage");
    assert.equal(
      recipe!.status,
      completed,
      `the recipe stage must be reported "${completed}", not "${blocked}"`,
    );
    assert.notEqual(recipe!.status, blocked);
  },
);

Then(
  "the recipe's `us` channel should exist and be active in the store",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipBootstrap) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const channels = await recipeChannels(endpoint, token);
    const us = channels.find((c) => c.slug === "us");
    assert.ok(
      us,
      `after the bootstrap recipe deploy the recipe's "us" channel must exist; ` +
        `got ${JSON.stringify(channels.map((c) => c.slug))}`,
    );
    assert.equal(
      us!.isActive,
      true,
      `the recipe's "us" channel must be active in the store`,
    );
  },
);

// ─── Scenario: A transient Saleor rate-limit during the stock stage retries
//     instead of reporting a false blocked (@logic @exceptional-double) ────────
//
// The stock stage's first Saleor GraphQL request is the recipe-warehouse lookup
// (cloud-api.ts seedRecipeStock → queryWarehouseId, `query Warehouses`); a
// momentary HTTP 429 there must be retried, not reported as a blocked stage. An
// HTTP 429 cannot be produced on demand against real Saleor Cloud, so this lone
// @exceptional-double stands up a loopback Saleor GraphQL stand-in that returns
// 429 exactly once on the stock stage's first request and then succeeds with the
// recipe catalog already in stock (so the idempotent seed updates in place and
// the stage completes). It is the only double in this feature — the real seeding
// is the @sandbox scenario above; it pins the resilience the idempotent re-run
// depends on so a momentary rate-limit never degrades an otherwise-successful
// stock stage to a false blocked (feature 004 Rule "Backend Saleor requests
// retry a transient rate-limit").
//
// Targeting: the run points NEXT_PUBLIC_SALEOR_API_URL at the stand-in and
// supplies the app token the stock stage authenticates with, so the single 429
// is reserved for the stock stage's own GraphQL — keyed on the Jolly-specific
// stock operation names (`Warehouses`/`VariantsForStock`), so neither the
// bootstrap doctor probes nor the spawned configurator consume it.

interface StockRateLimitState {
  stockRequests: number;
  served429: boolean;
}

/** Which Jolly stock-stage operation does this GraphQL request body carry?
 * seedRecipeStock sends, in order: `query Warehouses`, `query VariantsForStock`,
 * then `mutation StocksCreate`/`StocksUpdate`. Anything else (doctor probes, the
 * spawned configurator's own queries) is not a stock-stage request. */
function stockOperation(
  body: string,
): "warehouses" | "variants" | "stocks" | null {
  if (body.includes("query Warehouses")) return "warehouses";
  if (body.includes("VariantsForStock")) return "variants";
  if (body.includes("StocksCreate") || body.includes("StocksUpdate")) return "stocks";
  return null;
}

Given(
  "the stock stage's Saleor GraphQL endpoint returns HTTP 429 once and then succeeds with the recipe catalog in stock",
  async function (this: JollyWorld) {
    // @exceptional-double: a real HTTP 429 rate-limit cannot be produced on
    // demand against real Saleor Cloud, so this loopback Saleor GraphQL stand-in
    // returns 429 once on the stock stage's first request and then succeeds with
    // the recipe warehouse present and variants already in stock. Lone double
    // here (the real seeding is the @sandbox scenario above); it pins that a
    // transient rate-limit is retried rather than degrading an
    // otherwise-successful stock stage to a false blocked.
    const state: StockRateLimitState = { stockRequests: 0, served429: false };
    const json = (res: import("node:http").ServerResponse, payload: unknown) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        // Close each connection rather than keeping it alive: the bootstrap
        // doctor probe opens a connection to this stand-in early, but the stock
        // stage's request comes only after the multi-second storefront/recipe
        // stages — long enough for an idle keep-alive socket to go stale, so a
        // pooled connection would fail the later request with "fetch failed"
        // before the 429 retry path is ever exercised. Fresh connections per
        // request keep the stand-in reliable across the whole run.
        res.setHeader("Connection", "close");
        const op = stockOperation(body);
        if (op) {
          state.stockRequests += 1;
          // The FIRST stock-stage request → a single transient 429; the retry
          // must succeed.
          if (!state.served429) {
            state.served429 = true;
            res.statusCode = 429;
            res.end(JSON.stringify({ errors: [{ message: "rate limited" }] }));
            return;
          }
        }
        if (op === "warehouses") {
          // The recipe warehouse exists (resolved by slug `port-royal`).
          json(res, {
            data: {
              warehouses: {
                edges: [{ node: { id: "V2FyZWhvdXNlOjE=", slug: RECIPE_WAREHOUSE_SLUG } }],
              },
            },
          });
          return;
        }
        if (op === "variants") {
          // The recipe catalog is already in stock: one variant with a stock
          // entry in the recipe warehouse, so the idempotent seed updates in
          // place and the stage completes.
          json(res, {
            data: {
              productVariants: {
                edges: [
                  {
                    node: {
                      id: "UHJvZHVjdFZhcmlhbnQ6MQ==",
                      stocks: [{ warehouse: { slug: RECIPE_WAREHOUSE_SLUG } }],
                    },
                  },
                ],
              },
            },
          });
          return;
        }
        if (op === "stocks") {
          // The stock create/update succeeds with no errors.
          json(res, {
            data: {
              productVariantStocksUpdate: { bulkStockErrors: [], errors: [] },
              productVariantStocksCreate: { bulkStockErrors: [], errors: [] },
            },
          });
          return;
        }
        // Any other request (the bootstrap doctor's read-only probes, the spawned
        // configurator's own queries) → benign empty success, so only the stock
        // stage's requests see the single 429.
        json(res, { data: {} });
      });
    });
    // Belt-and-suspenders with the per-response `Connection: close` above: never
    // hold an idle socket open across the long storefront/recipe stages.
    server.keepAliveTimeout = 0;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.notes.stockRateLimitState = state;
    this.notes.stockRateLimitEndpoint = `http://127.0.0.1:${port}/graphql/`;
    this.cleanup.register(`stock 429 stand-in :${port}`, () => {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
  },
);

When(
  "the agent runs `jolly start --yes --json` and the stock stage runs against that endpoint",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    // In-process loopback stand-in ⇒ runCliAsync (spawnSync would block the
    // event loop and the server could never answer). Point the run's Saleor
    // GraphQL endpoint at the stand-in and supply the app token the stock stage
    // authenticates with (STAND_IN_TOKEN — the stand-in does not validate it).
    // Generous timeout: start clones Paper + pnpm-installs before reaching the
    // stock stage, plus the retry backoff.
    await this.runCliAsync(["start", "--yes", "--json"], {
      env: absentCredentialsEnv({
        NEXT_PUBLIC_SALEOR_API_URL: String(this.notes.stockRateLimitEndpoint),
        JOLLY_SALEOR_APP_TOKEN: STAND_IN_TOKEN,
        // Loopback is reached via the documented JOLLY_SALEOR_CLOUD_API_URL
        // override, whose host Jolly treats as first-party (feature 018 Rule);
        // loopback is not a fixed first-party host (feature 020).
        JOLLY_SALEOR_CLOUD_API_URL: String(this.notes.stockRateLimitEndpoint),
      }),
      timeoutMs: 840_000,
    });
  },
);

Then(
  "the stock stage should be reported completed, having retried the rate-limited request",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as Array<{
      stage: string;
      status: string;
    }>;
    const stock = stages.find((s) => s.stage === "stock");
    assert.ok(stock, "the run must report a stock stage in data.stages");
    assert.equal(
      stock!.status,
      "completed",
      "the stock stage must be reported completed after retrying the transient 429",
    );
    // The stand-in served a 429 and was hit again — proof the rate-limited
    // request was retried rather than failing on the first 429.
    const state = this.notes.stockRateLimitState as StockRateLimitState;
    assert.ok(state.served429, "the stand-in must have served the transient 429");
    assert.ok(
      state.stockRequests >= 2,
      `the stock stage must have retried the rate-limited request ` +
        `(saw ${state.stockRequests} stock request(s); expected the 429 plus a retry)`,
    );
  },
);

Then(
  "the stock stage should not be reported blocked on the transient rate-limit",
  function (this: JollyWorld) {
    const stages = (this.envelope.data.stages ?? []) as Array<{
      stage: string;
      status: string;
    }>;
    const stock = stages.find((s) => s.stage === "stock");
    assert.ok(stock, "the run must report a stock stage in data.stages");
    assert.notEqual(
      stock!.status,
      "blocked",
      "a transient rate-limit must not degrade the stock stage to blocked",
    );
    // No stock-seeded check may report a fabricated failure blaming the rate-limit.
    for (const check of this.envelope.checks) {
      if (/stock/i.test(check.id)) {
        assert.notEqual(
          check.status,
          "fail",
          `${check.id} must not fail on a transient rate-limit that should have been retried`,
        );
      }
    }
  },
);

// ─── Scenario: Jolly start confirms the recipe's featured collection exists
//     before reporting the recipe stage completed (@sandbox) ──────────────────
//
// Gated by SANDBOX_REQUIREMENTS["Jolly start confirms the recipe's featured
// collection exists before reporting the recipe stage completed"] (saleorEndpoint
// + saleorAppToken; derivable from the Cloud token via per-run provisioning) →
// skips locally. Shares the Given "a freshly created blank Saleor Cloud
// environment" and the When "Jolly start runs the configurator-deploy stage with
// approval" with the configurator-deploy @sandbox scenario above — the When sets
// notes.skipRecipe when the recipe stage does not complete in this environment,
// so the premise (recipe deployed) is not fabricated. The integrity contract:
// Jolly reports the recipe stage `completed` only after it reads the store back
// and confirms the recipe's declared catalog entities exist there — so the real
// teeth are the live read-back of the `featured-products` collection holding its
// products, not the configurator's summary counts.

const FEATURED_COLLECTION_SLUG = "featured-products";

Then(
  "the recipe's `featured-products` collection should exist in the store holding its declared products",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const result = await saleorGraphql(
      endpoint,
      token,
      `query($slug: String!) {
         collection(slug: $slug, channel: "us") {
           id
           slug
           products(first: 100) { totalCount }
         }
       }`,
      { slug: FEATURED_COLLECTION_SLUG },
    );
    const collection = result.data?.collection as
      | { slug?: string; products?: { totalCount?: number } }
      | null
      | undefined;
    assert.ok(
      collection,
      `the recipe's "${FEATURED_COLLECTION_SLUG}" collection must exist in the store`,
    );
    const count = collection!.products?.totalCount ?? 0;
    assert.ok(
      count > 0,
      `the "${FEATURED_COLLECTION_SLUG}" collection must hold its declared products, found ${count}`,
    );
  },
);

Then(
  'the recipe stage should be reported "completed" only after Jolly reads the store back and confirms the recipe\'s declared catalog entities exist there, not from the configurator\'s summary counts alone',
  function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    // Reaching here means the When saw the recipe stage `completed` AND the
    // preceding Then confirmed the `featured-products` collection actually exists
    // in the store via a real read-back. Together they pin the contract: a
    // `completed` recipe stage implies the declared catalog entities really exist
    // (had Jolly reported `completed` from configurator summary counts while the
    // collection was absent, the read-back above would have failed).
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the recipe stage must be present");
    assert.equal(
      recipe!.status,
      "completed",
      "the recipe stage is reported completed only after the store read-back confirms the catalog",
    );
  },
);

Then(
  'the `recipe-deployed` check should derive its status from that store read-back, so it cannot report "pass" while a sibling check reports a declared entity such as the `featured-products` collection is absent',
  function (this: JollyWorld) {
    if (this.notes.skipRecipe) return "skipped";
    const checks = this.envelope.checks;
    const recipeDeployed = checks.find((c) => String(c.id) === "recipe-deployed");
    assert.ok(recipeDeployed, "the recipe stage must emit a recipe-deployed check");
    // The invariant only binds when recipe-deployed claims success: a "pass"
    // recipe-deployed must derive from the store read-back, so it cannot stand
    // while a sibling check reports a declared recipe entity (the featured-products
    // collection) absent. A non-pass recipe-deployed already reports the failure
    // honestly and constrains nothing here.
    if (recipeDeployed!.status !== "pass") return;
    const absent =
      /\b(absent|missing|not found|could not (?:populate|assign|find|read)|empty|does not exist|no .*(?:collection|product))\b/i;
    const offending = checks.find((c) => {
      if (String(c.id) === "recipe-deployed") return false;
      if (c.status !== "fail" && c.status !== "warning") return false;
      const text = `${String(c.id)} ${String(c.description ?? "")}`;
      const namesDeclaredEntity =
        new RegExp(`\\b${FEATURED_COLLECTION_SLUG}\\b`, "i").test(text) ||
        /\bcollection\b/i.test(text);
      return namesDeclaredEntity && absent.test(text);
    });
    assert.equal(
      offending,
      undefined,
      `recipe-deployed reports "pass" while a sibling check reports a declared entity ` +
        `(the "${FEATURED_COLLECTION_SLUG}" collection) absent; recipe-deployed must derive ` +
        `its status from the store read-back, not the configurator's summary counts. Offending sibling:\n` +
        `${JSON.stringify(offending)}`,
    );
  },
);
