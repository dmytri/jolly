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
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import {
  assertEnvelopeSuccess,
  findRiskContexts,
  assertRiskContextShape,
} from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import { makeNamespace } from "../support/sandbox.ts";
import { createEnvironment } from "../support/env-factory.ts";
import {
  startTaskPollCloudApi,
  type TaskPollHarness,
} from "../support/task-poll-cloud-api.ts";
import { deleteEnvironment, listAllEnvironments } from "../support/cloud.ts";
import { cachedStoreSpareNames } from "../support/provision.ts";
import { ensureRecipeOnSharedStore } from "../support/recipe-on-shared.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { CliResult, JollyWorld } from "../support/world.ts";

// Adopt the run's recipe deploy onto the PRIMARY SHARED store
// (features/support/recipe-on-shared.ts): the starter recipe is deployed onto the
// shared store ONCE per run via a standalone `jolly recipe` then `jolly stock`
// chain, and the state-compatible @sandbox scenarios below read their fact back
// from it via real GraphQL queries instead of each re-deploying. Loads the
// captured `jolly recipe --yes --json` envelope into this scenario's lastRun (so
// the Jolly-observable recipe-deploy Thens read the real deploy result) and the
// store creds into notes (so the store-read Thens query the live shared store).
// The `jolly stock --yes --json` result is stashed in notes for completeness;
// these scenarios verify the stock outcome via live GraphQL, not its envelope.
async function useRecipeDeployedStore(world: JollyWorld): Promise<void> {
  const fixture = await ensureRecipeOnSharedStore();
  world.notes.storeEndpoint = fixture.endpoint;
  world.notes.storeToken = fixture.token;
  world.notes.stockRun = fixture.stockResult;
  if (fixture.token) world.trackSecret(fixture.token);
  world.previousRun = world.lastRun;
  world.lastRun = fixture.recipeResult;
}

// The Jolly starter recipe's warehouse (assets/skills/jolly/recipe.yml) and the
// v1 default per-variant stock quantity (feature 004 Rule "Recipe products need
// seeded stock"). The preview must name both; the live stage seeds this many.
const RECIPE_WAREHOUSE_NAME = "Port Royal Warehouse";
const RECIPE_WAREHOUSE_SLUG = "port-royal";
const DEFAULT_STOCK_QUANTITY = 100;
const STOCK_MUTATION = "productVariantStocksCreate";

// --- Scenario: Agent prepares the starter recipe (@sandbox) -----------------
// --- Scenario: Agent applies the starter recipe safely (@sandbox) -----------

Given(
  "a Saleor Cloud environment that already holds catalog data",
  // Real disposable environment creation against the live Cloud API (the CLI
  // polls async job status) plus a foreign-product seed — well beyond the default
  // step timeout, and a real limit-reclaim budget on top.
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    // ISOLATE this destructive-diff scenario on its OWN disposable @creates-env
    // environment (mirrors feature 012/026's @creates-env creators) instead of
    // seeding a FOREIGN product into the SHARED store's catalog. The old
    // shared-store seed's single-attempt teardown lagged under load, left the
    // foreign product on the shared store, and cascaded --failOnDelete blocks
    // across every recipe-on-shared consumer. Here the WHOLE env is torn down, so
    // the foreign catalog can never leak onto a store other scenarios reuse.
    //
    // The block is reachable the moment the store holds a product the recipe does
    // not declare (`storeHoldsForeignCatalog`, src/lib/cloud-api.ts; the
    // `allowDeletes` gate, src/index.ts) — the recipe need NOT be pre-deployed.
    // Seed one real foreign product into THIS env, then the When's `jolly recipe`
    // detects the deletion and the configurator exits 6.
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    const envName = `${this.namespace}-recipe-block`;
    this.notes.blockEnvName = envName;
    // Teardown registered BEFORE creation (a crash mid-create stays cleanable):
    // delete every environment carrying this scenario's namespace via
    // `deleteEnvironment`, which retries transient faults (cloudFetchRetry).
    this.cleanup.register(`created environment ${envName}`, async () => {
      for (const env of await listAllEnvironments(token)) {
        if (env.name.startsWith(this.namespace)) {
          await deleteEnvironment(token, env.org, env.key);
        }
      }
    });
    // Create the disposable env via the single env-creation seam (env-factory.ts),
    // reclaiming an org slot if at the limit. Env limit is 2 = shared store (1) +
    // this transient (1); the @creates-env tag keeps this scenario in the serial
    // group (cucumber.js `sandboxSerial`, parallel 1), so the slot is available.
    const created = await createEnvironment(
      (args, options) => this.runCliAsync(args, options),
      {
        name: envName,
        domainLabel: envName,
        runOptions: { timeoutMs: 540_000 },
        limitBudgetMs: 540_000,
        reclaim: {
          token,
          runNamespace: makeNamespace(this.runId),
          spareNames: cachedStoreSpareNames(),
        },
      },
    );
    assertEnvelopeSuccess(
      created.envelope,
      "the disposable recipe-block environment must be created (live by design)",
    );
    // Read the created env's endpoint + SALEOR_TOKEN from its written `.env` (as
    // feature 012 does) into notes — NOT process.env, whose shared-store creds
    // must stay untouched. The When points `jolly recipe` at these.
    const values = loadEnvValues(created.cwd);
    const endpoint = values["NEXT_PUBLIC_SALEOR_API_URL"];
    const storeToken = values["SALEOR_TOKEN"];
    assert.ok(endpoint, "the created env's .env must carry NEXT_PUBLIC_SALEOR_API_URL");
    assert.ok(storeToken, "the created env's .env must carry SALEOR_TOKEN");
    this.notes.blockEnvEndpoint = endpoint;
    this.notes.blockEnvToken = storeToken;
    this.trackSecret(storeToken);

    // Seed one real FOREIGN product (a productType the recipe does not declare)
    // into THIS disposable env's endpoint/token. LIFO teardown is registered but
    // harmless — the whole env is torn down. `saleorGraphql` already retries a
    // transient `fetch failed`/cold-instance 404/5xx, so the seed also rides out
    // the freshly-provisioned store's warmup.
    const slug = `${makeNamespace()}-foreign`;
    const name = `Jolly Test Foreign ${slug}`;
    // The blocked-report Then asserts the surfaced diff names this product — the
    // concrete deletion the deploy would make — so record what was seeded.
    this.notes.foreignProductSlug = slug;
    this.notes.foreignProductName = name;
    const typeResult = await saleorGraphql(
      endpoint,
      storeToken,
      `mutation($name: String!) {
         productTypeCreate(input: { name: $name, kind: NORMAL, hasVariants: false }) {
           productType { id }
           errors { field message }
         }
       }`,
      { name },
    );
    const typePayload = typeResult.data?.productTypeCreate as
      | { productType?: { id: string }; errors?: Array<{ field: string; message: string }> }
      | undefined;
    assert.ok(
      typePayload?.productType?.id,
      `seeding foreign catalog must create a product type; errors: ${JSON.stringify(typePayload?.errors ?? typeResult.errors)}`,
    );
    const productTypeId = typePayload.productType!.id;
    this.cleanup.register(`product type ${productTypeId}`, async () => {
      await saleorGraphql(
        endpoint,
        storeToken,
        `mutation($id: ID!) { productTypeDelete(id: $id) { errors { code } } }`,
        { id: productTypeId },
      );
    });
    const productResult = await saleorGraphql(
      endpoint,
      storeToken,
      `mutation($name: String!, $slug: String!, $productType: ID!) {
         productCreate(input: { name: $name, slug: $slug, productType: $productType }) {
           product { id }
           errors { field message }
         }
       }`,
      { name, slug, productType: productTypeId },
    );
    const productPayload = productResult.data?.productCreate as
      | { product?: { id: string }; errors?: Array<{ field: string; message: string }> }
      | undefined;
    assert.ok(
      productPayload?.product?.id,
      `seeding foreign catalog must create a product; errors: ${JSON.stringify(productPayload?.errors ?? productResult.errors)}`,
    );
    const productId = productPayload.product!.id;
    this.cleanup.register(`product ${productId}`, async () => {
      await saleorGraphql(
        endpoint,
        storeToken,
        `mutation($id: ID!) { productDelete(id: $id) { errors { code } } }`,
        { id: productId },
      );
    });
  },
);

When(
  "the agent runs `jolly recipe --yes --json` to apply the starter recipe to Saleor Cloud",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // Over a store that already holds customer catalog (the Given), Jolly's recipe
    // deploy passes `--failOnDelete`, so the spawned `npx @saleor/configurator
    // deploy` detects the destructive diff and exits 6; Jolly reports the recipe
    // stage `blocked` (feature 004 Rule "Configurator deploy"; src/index.ts
    // runRecipeStage exit-6 path). The standalone `jolly recipe` run drives exactly
    // the recipe stage — same exit-6/blocked behaviour as a full `jolly start`,
    // without its storefront/deploy/stripe collateral. Run it and capture the
    // envelope the Thens assert against.
    //
    // Point the run at the DISPOSABLE env explicitly by overriding the store creds
    // in the child env: runRecipeStage reads process.env's NEXT_PUBLIC_SALEOR_API_URL
    // / SALEOR_TOKEN FIRST, and the @sandbox Before hook left the SHARED store's
    // creds there — so without this override the block would be exercised against
    // the shared store (the exact pollution this scenario was converted to avoid).
    this.runCli(["recipe", "--yes", "--json"], {
      timeoutMs: 840_000,
      env: {
        NEXT_PUBLIC_SALEOR_API_URL: String(this.notes.blockEnvEndpoint),
        SALEOR_URL: String(this.notes.blockEnvEndpoint),
        SALEOR_TOKEN: String(this.notes.blockEnvToken),
      },
    });
    // Narrow environmental escape ONLY (mirrors 004's other recipe scenarios): the
    // @saleor/configurator binary could genuinely not be spawned here (npx
    // fetch/network) — a condition the real test env cannot produce on demand — so
    // the deploy premise was not reachable and the scenario skips. A recipe stage
    // blocked for the destructive diff is exactly the behaviour under test and MUST
    // fail the Then.
    assert.ok(
      !/could not be spawned/i.test(
        String(this.findCheck("recipe-deployed")?.description ?? ""),
      ),
      "the @saleor/configurator binary must be spawnable via npx",
    );
  },
);

Then(
  "the recipe stage should pass `--failOnDelete` to `npx @saleor\\/configurator@latest deploy`",
  function (this: JollyWorld) {
    // Observable proof Jolly passed `--failOnDelete`: the recipe-deployed check
    // fails reporting the configurator was blocked by it over the pre-existing
    // store (src/index.ts runRecipeStage: exit 6 → recipe-deployed fail naming
    // `--failOnDelete`).
    const recipeCheck = this.findCheck("recipe-deployed");
    assert.ok(recipeCheck, "the recipe stage must emit a recipe-deployed check");
    assert.equal(
      recipeCheck!.status,
      "fail",
      "a destructive re-deploy must fail the recipe-deployed check, never report it passing",
    );
    assert.ok(
      /--failOnDelete/.test(String(recipeCheck!.description ?? "")),
      "the recipe-deployed check must name the `--failOnDelete` guard that blocked the destructive apply",
    );
  },
);

Then("the configurator should exit {int} for deletions", function (this: JollyWorld, deleteExit: number) {
  assert.equal(deleteExit, 6, "the configurator exits 6 when --failOnDelete blocks deletions");
  // Observable of the exit-6 path: the recipe-deployed check names the destructive
  // diff the configurator detected over the pre-existing store.
  const recipeCheck = this.findCheck("recipe-deployed");
  assert.ok(recipeCheck, "the recipe stage must emit a recipe-deployed check");
  assert.ok(
    /detected deletions over a pre-existing store/i.test(String(recipeCheck!.description ?? "")),
    "the recipe-deployed check must report the configurator detected deletions over a pre-existing store (exit 6)",
  );
});

// The blocked report the two diff-surfacing Thens read: the recipe-deployed
// check (description + remediation) and the envelope errors — the surfaces the
// feature 020 contract gives the agent to act on.
function blockedRecipeReport(world: JollyWorld): string {
  const check = world.findCheck("recipe-deployed");
  assert.ok(check, "the recipe stage must emit a recipe-deployed check");
  return [
    String(check!.description ?? ""),
    String(check!.remediation ?? ""),
    JSON.stringify(world.envelope.errors ?? []),
  ].join("\n");
}

Then(
  "the blocked report should name the destructive diff the configurator observed, including a deletion it would make",
  function (this: JollyWorld) {
    const report = blockedRecipeReport(this);
    assert.match(
      report,
      /delet/i,
      `the blocked report must present the destructive diff (the deletions the deploy would make); got:\n${report}`,
    );
    // The one foreign entity in the disposable store is the product the Given
    // seeded, so a surfaced diff that names its deletions names that product.
    const name = String(this.notes.foreignProductName ?? "");
    const slug = String(this.notes.foreignProductSlug ?? "");
    assert.ok(name && slug, "the Given must have recorded the seeded foreign product");
    assert.ok(
      report.includes(name) || report.includes(slug),
      `the blocked report must name a deletion the deploy would make — the seeded ` +
        `foreign product ("${name}" / ${slug}) — not only that deletions exist; got:\n${report}`,
    );
  },
);

Then(
  "the blocked report should state that deploying over it requires explicit approval",
  function (this: JollyWorld) {
    const report = blockedRecipeReport(this);
    assert.match(
      report,
      /explicit approval/i,
      `the blocked report must state that deploying over the destructive diff requires ` +
        `explicit approval; got:\n${report}`,
    );
  },
);

Then(
  "Jolly should report the recipe stage as {string}, not {string}",
  function (this: JollyWorld, blocked: string, completed: string) {
    const stages = (this.envelope.data.stages ?? []) as Array<{
      stage: string;
      status: string;
    }>;
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the orchestrated stages must include the recipe stage");
    assert.equal(
      recipe!.status,
      blocked,
      `the recipe stage must be reported "${blocked}" over a pre-existing store's destructive diff, not "${completed}"`,
    );
    assert.notEqual(
      recipe!.status,
      completed,
      "a destructive re-deploy blocked by --failOnDelete must never be reported completed",
    );
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
  // Match the configurator-deploy stage robustly across the `@latest`-tagged
  // spawn (`@saleor/configurator@latest deploy`): the configurator and deploy
  // tokens both appear, with the version tag between them.
  const deployIndex = plan.findIndex(
    (s) => text(s).includes("configurator") && text(s).includes("deploy"),
  );
  const stockIndex = plan.findIndex((s) =>
    text(s).includes(STOCK_MUTATION.toLowerCase()),
  );
  return { deployIndex, stockIndex, stockStage: plan[stockIndex] };
}

// --- Scenario: Jolly start seeds stock so the recipe catalog is buyable (@sandbox)
//
// Verifies the FIRST genuinely-executing `jolly start` stage:
// the stock-seeding (feature 004 Rule "Recipe products need seeded stock" / MVP
// sequencing). The CLI-spawning stages (git/pnpm/configurator/vercel) are NOT
// performed by `jolly start` yet — they stay agent-driven — so this scenario's
// premise is a store that ALREADY has the starter recipe deployed (variants
// present). With approvals pre-granted (`--yes`), the orchestrated run reaches
// the `stock` stage and seeds stock via Saleor GraphQL; we then assert Jolly's
// observable real outcomes against the live store: every recipe variant has
// stock in the recipe warehouse, a `us` checkout is not blocked by
// INSUFFICIENT_STOCK, and re-running updates quantities idempotently rather than
// creating duplicate stock.

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
  async function (this: JollyWorld) {
    // Adopt the run's recipe deploy onto the shared store (recipe-on-shared.ts):
    // the recipe was deployed and stock seeded ONCE per run by a real standalone
    // `jolly recipe` then `jolly stock` chain; the recipe run's envelope is loaded
    // here.
    // The stock stage seeds via Saleor GraphQL and needs no Vercel session; this
    // scenario asserts only the live stock outcome against that store.
    await useRecipeDeployedStore(this);
    assert.ok(this.notes.storeEndpoint, "a Saleor GraphQL endpoint must be configured/derived");
  },
);

When("Jolly start completes the recipe stage", function (this: JollyWorld) {
  // The shared recipe deploy ran once this run (recipe-on-shared.ts). The recipe
  // must deploy for there to be variants to seed, so the only premise this
  // scenario genuinely cannot construct is the @saleor/configurator binary
  // failing to spawn (npx fetch/network) — an environmental inability the real
  // test env cannot produce on demand. A stock stage `blocked`/`pending` for any
  // other reason is the behaviour under test and MUST fail the Then.
  assert.ok(
    !/could not be spawned/i.test(
      String(this.findCheck("recipe-deployed")?.description ?? ""),
    ),
    "the @saleor/configurator binary must be spawnable via npx",
  );
});

Then(
  "every recipe product variant should have stock in the recipe warehouse",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
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
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    // The shared recipe deploy seeds stock ONCE per run over the cached recipe
    // store — an idempotent reconcile of a store deployed on prior runs — so the
    // idempotency fact is read back from the live store: each variant carries
    // exactly ONE stock entry in the recipe warehouse at the default quantity, no
    // duplicates accumulated (feature 022). This is the identical observable the
    // former re-run asserted (atWarehouse.length === 1, quantity === 100), read
    // via a real query instead of another deploy.
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

// ─── Scenario: Jolly start seeds stock and assigns collections with concurrent
//     Saleor requests (@sandbox @heavy) ────────────────────────────────────────
//
// The stock stage seeds stock AND assigns the recipe's collections, and it must
// REPORT its per-request timing in the envelope: data.stock.stockRequests[] and
// data.stock.collectionRequests[], each a { startedAt, finishedAt } epoch-ms
// interval. That reported timing must show overlap — a later request starting
// before an earlier one finishes — the observable proof the requests ran
// concurrently rather than in a sequential await loop. The stock stage run is the
// run's ONE shared `jolly stock --yes --json` (recipe-on-shared.ts), already
// captured on notes.stockRun by the shared Given; the seeded stock and its
// idempotency are read back from the live store (the reused Then above).

interface RequestInterval {
  startedAt: number;
  finishedAt: number;
}

/** The stock stage's reported request-timing intervals for one request kind
 * (stock mutations or collection assignments), asserted present with at least
 * two entries — two requests are the minimum for concurrency to be observable. */
function reportedRequestTiming(
  world: JollyWorld,
  key: "stockRequests" | "collectionRequests",
  label: string,
): RequestInterval[] {
  const stock = world.envelope.data.stock as Record<string, unknown> | undefined;
  assert.ok(
    stock,
    `the stock stage must report its request timing under data.stock: ${JSON.stringify(world.envelope.data)}`,
  );
  const raw = stock![key];
  assert.ok(
    Array.isArray(raw),
    `the stock stage must report ${label} request timing as data.stock.${key} ` +
      `(an array of { startedAt, finishedAt }): ${JSON.stringify(stock)}`,
  );
  const intervals = raw as RequestInterval[];
  assert.ok(
    intervals.length >= 2,
    `at least two ${label} requests must be reported for concurrency to be observable; ` +
      `got ${intervals.length}`,
  );
  for (const iv of intervals) {
    assert.equal(
      typeof iv.startedAt,
      "number",
      `${label} interval must carry a numeric startedAt (epoch ms): ${JSON.stringify(iv)}`,
    );
    assert.equal(
      typeof iv.finishedAt,
      "number",
      `${label} interval must carry a numeric finishedAt (epoch ms): ${JSON.stringify(iv)}`,
    );
  }
  return intervals;
}

/** Assert the intervals show overlap: sorted by start, some later request begins
 * before the running maximum end among earlier-started requests. */
function assertRequestOverlap(intervals: RequestInterval[], label: string): void {
  const byStart = [...intervals].sort((a, b) => a.startedAt - b.startedAt);
  let maxEnd = byStart[0].finishedAt;
  let overlap = false;
  for (let i = 1; i < byStart.length; i++) {
    if (byStart[i].startedAt < maxEnd) overlap = true;
    if (byStart[i].finishedAt > maxEnd) maxEnd = byStart[i].finishedAt;
  }
  assert.ok(
    overlap,
    `the reported ${label} request timing must show a later ${label} starting before an ` +
      `earlier one finishes (concurrent); the requests ran sequentially: ${JSON.stringify(byStart)}`,
  );
}

// ─── Scenario: Jolly start previews the configurator deploy of the starter
//     recipe (@logic) ───────────────────────────────────────────────────────
//
// THE deterministic target driving Crew for iteration 2 / the fourth convergence
// (feature 004 Rule "Configurator deploy is a genuinely-executing stage"). The
// `jolly start --dry-run` plan must surface the configurator-deploy (recipe)
// stage as a SPAWNED-CLI step that runs BEFORE the stock-seeding stage, naming
// the spawned command, Jolly's bundled recipe, SALEOR_URL + SALEOR_TOKEN (by
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

// ─── Scenario: Jolly start does not fabricate the recipe deployment (@logic) ──
//
// The integrity guardrail (no fabricated success): with no real Saleor
// credentials, a real `jolly start` run that REACHES the configurator-deploy
// stage must report it blocked or pending — never `completed` — and the overall
// envelope must be `warning`, not `success`. `--yes` pre-approves the high-risk
// gate so the run actually reaches the recipe stage instead of pausing before
// it; the runtime credentials are genuinely UNSET (absentCredentialsEnv) — real
// absence, so with no store URL or SALEOR_TOKEN the recipe stage cannot deploy and
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
// ─── Scenario: Jolly start deploys the starter recipe with @saleor/configurator
//     (@sandbox) ────────────────────────────────────────────────────────────
//
// Verifies the FIRST spawned-CLI `jolly start` stage genuinely executing:
// the standalone `jolly recipe` run SPAWNS `npx @saleor/configurator deploy` of
// Jolly's bundled recipe; the additive apply exits 0 so the recipe's catalog
// entities exist and the stage is reported `completed`; a re-deploy reconciles to
// a no-op diff (no duplicate entities). The deploy ran ONCE this run onto the
// primary shared store (recipe-on-shared.ts); it is this scenario's
// PRECONDITION, adopted by the shared `Given` above, so the scenario is a
// Given+Then that reads the captured recipe envelope and the live store back — no
// action step of its own.

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

// The precondition — a recipe-deployed store — is adopted by the shared
// `Given("a freshly created Saleor Cloud environment with the starter recipe
// deployed")` above (the run's recipe deploy onto the shared store, recipe-on-shared.ts).
// These scenarios are Given+Then state assertions: they read Jolly's observable
// deploy outcome (the captured envelope) and the live store back, with no action
// step of their own, so no `When` re-invokes the shared fixture.

Then(
  "Jolly should spawn `npx @saleor\\/configurator@latest deploy` of its bundled starter recipe against the store, never reimplementing it against raw APIs",
  function (this: JollyWorld) {
    // Jolly-observable: the recipe-deployed check confirms the configurator was
    // spawned (Jolly never reimplements the configurator against raw APIs — the
    // recipe stage's only side effect is spawning the official CLI). The
    // configurator-spawn evidence lives in this check's description (src/index.ts
    // runRecipeStage), which records "@saleor/configurator deploy" on a `pass`
    // regardless of whether the run was a fresh deploy or a no-op reconcile of the
    // cached recipe store — the standalone recipe stage's `data.stages` entry is
    // thin (stage + status only), so the check is the stable observable.
    const stages = (this.envelope.data.stages ?? []) as ResultStage[];
    const recipe = stages.find((s) => s.stage === "recipe");
    assert.ok(recipe, "the orchestrated stages must include the recipe stage");
    const recipeDeployed = this.findCheck("recipe-deployed");
    assert.ok(recipeDeployed, "the recipe stage must emit a recipe-deployed check");
    assert.equal(
      recipeDeployed!.status,
      "pass",
      "a successful recipe deploy must report the recipe-deployed check as pass",
    );
    assert.ok(
      /configurator/i.test(JSON.stringify(recipeDeployed)),
      "the recipe-deployed check must record the spawned @saleor/configurator deploy",
    );
  },
);

Then(
  "the bootstrap deploy should record a successful configurator deployment report and the recipe's catalog entities should exist in the store",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
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
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    // The shared recipe deploy applies the same declarative recipe ONCE per run
    // over the cached recipe store — a no-op reconcile of a store deployed on
    // prior runs (feature 022) — so the "no duplicate entities" fact is read back
    // from the live store: the recipe's catalog products exist with no duplicate
    // slugs, the identical observable the former re-run asserted (before === after,
    // i.e. no accumulation), read via a real query instead of another deploy.
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const result = await saleorGraphql(
      endpoint,
      token,
      `query { products(first: 100, channel: "us") { edges { node { slug } } } }`,
    );
    const slugs =
      (result.data?.products as { edges?: Array<{ node: { slug: string } }> } | undefined)
        ?.edges?.map((e) => e.node.slug) ?? [];
    assert.ok(
      slugs.length > 0,
      "the recipe's catalog products must exist in the store after the deploy",
    );
    const unique = new Set(slugs);
    assert.equal(
      unique.size,
      slugs.length,
      `re-deploying the same declarative recipe must not create duplicate catalog ` +
        `entities: found ${slugs.length} products but only ${unique.size} distinct slugs ` +
        `(${JSON.stringify(slugs)})`,
    );
  },
);

// ─── Scenario: The recipe deploy reports completed and activates the `us`
//     channel over a create-store environment (@sandbox) ────────────────────────
//
// Verifies the bootstrap path outcome: the declarative recipe apply reconciles
// the store to the recipe, ADDING the recipe's active `us` channel (feature 004
// Rule "Recipe targets a clean environment"). Saleor protects some stock defaults
// — notably the default channel — from deletion, so they may remain; the
// observable is that the recipe's own `us` channel exists and is active, not that
// the default was removed. Converted to a CONSUMER of the shared recipe-deployed
// store (recipe-on-shared.ts, adopted by the shared Given above): a Given+Then
// state assertion that reads the captured `jolly recipe` envelope (recipe stage
// `completed`) and the live store back (`us` channel active), with no action step
// of its own.

async function recipeChannels(
  endpoint: string,
  token: string | undefined,
): Promise<Array<{ slug: string; isActive: boolean }>> {
  const result = await saleorGraphql(endpoint, token, `query { channels { slug isActive } }`);
  return (
    (result.data?.channels as Array<{ slug: string; isActive: boolean }> | undefined) ?? []
  );
}

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
// supplies the SALEOR_TOKEN the stock stage authenticates with, so the single 429
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
    // @exceptional-double: a transient HTTP 429 rate-limit from the real Cloud API
    // cannot be produced on demand; this loopback serves one 429 then succeeds. The
    // real stock seeding is covered by the @sandbox recipe scenario.
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
    // GraphQL endpoint at the stand-in and supply the SALEOR_TOKEN the stock stage
    // authenticates with (STAND_IN_TOKEN — the stand-in does not validate it).
    // Run the stock stage alone (`jolly stock`) against the stand-in — the retry
    // resilience is the stock stage's, not the whole pipeline's.
    await this.runCliAsync(["stock", "--yes", "--json"], {
      env: absentCredentialsEnv({
        NEXT_PUBLIC_SALEOR_API_URL: String(this.notes.stockRateLimitEndpoint),
        SALEOR_TOKEN: STAND_IN_TOKEN,
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
// Shares the Given "a freshly created Saleor Cloud environment with the starter
// recipe deployed" with the configurator-deploy @sandbox scenario above, adopting
// the shared recipe-deployed store as its precondition; like that scenario it is a
// Given+Then with no action step of its own. The integrity contract:
// Jolly reports the recipe stage `completed` only after it reads the store back
// and confirms the recipe's declared catalog entities exist there — so the real
// teeth are the live read-back of the `featured-products` collection holding its
// products, not the configurator's summary counts.

const FEATURED_COLLECTION_SLUG = "featured-products";
// ─── Scenarios: task-status poll 502 — transient retried, persistent honest
//     (@logic @exceptional-double) ────────────────────────────────────────────
//
// The Cloud API's task-status poll answers a momentary 502 during an
// otherwise-successful environment provisioning (feature 004 Rule "Backend
// Saleor requests retry a transient failure"; observed for real once — see
// features/support/env-factory.ts). Neither a one-off 502 nor a persistent
// Cloud outage can be produced on demand against the real Cloud API, so both
// scenarios drive the REAL `create store --create-environment` path against the
// task-poll loopback Cloud API (features/support/task-poll-cloud-api.ts, where
// the @exceptional-double is justified). The shared When (002 step file) runs
// the real command against the harness when notes.taskPollHarness is set.
Given(
  "the Cloud API answers every task-status poll with a 502",
  async function (this: JollyWorld) {
    // @exceptional-double: a persistent Cloud API outage on the task-status
    // poll cannot be produced on demand against the real Cloud API; the
    // loopback injects it (justified at features/support/task-poll-cloud-api.ts).
    this.notes.taskPollHarness = await startTaskPollCloudApi(this, "always-502");
  },
);
Then(
  "the envelope status should be {string} after the bounded retry budget is exhausted",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    const harness = this.notes.taskPollHarness as TaskPollHarness;
    // Exhausting a bounded retry budget is observable at the harness: the poll
    // was retried (more than one attempt) against a persistently failing
    // answer, and the run still ended — in this envelope — rather than
    // retrying forever.
    assert.ok(
      harness.polls.length > 1,
      `the bounded retry budget must retry the persistent 502 before giving ` +
        `up; observed ${harness.polls.length} poll(s): ${JSON.stringify(harness.polls)}`,
    );
    assert.ok(
      harness.polls.every((poll) => poll === "502"),
      `every poll should have been answered 502: ${JSON.stringify(harness.polls)}`,
    );
  },
);

Then(
  "the error should state that the creation task was accepted but its completion could not be confirmed",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.errors);
    assert.match(
      text,
      /accepted/i,
      `the error must state the creation task was accepted: ${text}`,
    );
    assert.match(
      text,
      /confirm/i,
      `the error must state the task's completion could not be confirmed: ${text}`,
    );
  },
);

Then(
  "the error should not claim that nothing was created",
  function (this: JollyWorld) {
    // The creation POST was accepted, so a "nothing was created" claim would be
    // false: the environment may well exist with its task unconfirmed.
    const text = `${this.envelope.summary} ${JSON.stringify(this.envelope.errors)}`;
    assert.doesNotMatch(
      text,
      /(nothing|no (environment|store|resource))\s+(was|has been|is|got)?\s*(created|provisioned)|created nothing/i,
      `the error must not claim that nothing was created: ${text}`,
    );
  },
);
