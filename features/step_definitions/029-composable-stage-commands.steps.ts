// Feature 029: composable stage commands.
//
// Each side-effecting stage `jolly start` performs is also a first-class
// `jolly` command that runs exactly that one stage against already-prepared
// preconditions, never the whole pipeline. These @sandbox @heavy scenarios
// build their preconditions from the shared per-run jolly-cannon-fodder store
// (provisioned by the @sandbox Before hook, which exports
// NEXT_PUBLIC_SALEOR_API_URL + SALEOR_TOKEN into process.env) composed with the
// new stage commands themselves — deliberately avoiding the `jolly start`
// orchestrator so a stage is exercised in isolation.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues, writeEnvValues } from "../../src/lib/env-file.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import { addVercelProject, removeVercelProject, workerNamespace } from "../support/sandbox.ts";
import { ensureRecipeDeployedStore } from "../support/recipe-fixture.ts";
import type { JollyWorld } from "../support/world.ts";
// src/index.ts runs the CLI on import; import its runtime seams dynamically in
// the composition step under JOLLY_NO_MAIN. The type is erased, so a type-only
// import is import-safe.
import type { StageRunner } from "../../src/index.ts";
import { STAND_IN_TOKEN } from "../support/creds-env.ts";

// The shared store's runtime values (set into process.env by the @sandbox
// Before hook). Written into a scenario project `.env` so the stage command
// under test resolves the endpoint + store token the .env-first way a real
// caller does.
function storeCreds(): { endpoint: string; token: string } {
  const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token = process.env["SALEOR_TOKEN"] ?? "";
  assert.ok(endpoint, "shared store endpoint NEXT_PUBLIC_SALEOR_API_URL is not set");
  assert.ok(token, "shared store token SALEOR_TOKEN is not set");
  return { endpoint, token };
}

function writeStoreEnv(world: JollyWorld): { endpoint: string; token: string } {
  const creds = storeCreds();
  writeEnvValues(world.projectDir, {
    NEXT_PUBLIC_SALEOR_API_URL: creds.endpoint,
    SALEOR_TOKEN: creds.token,
  });
  return creds;
}

interface Stage {
  stage: string;
  status: string;
}

function stages(world: JollyWorld): Stage[] {
  return (world.envelope.data["stages"] ?? []) as Stage[];
}

function stageStatus(world: JollyWorld, name: string): string | undefined {
  return stages(world).find((s) => s.stage === name)?.status;
}

// The core composability contract: the command ran exactly one stage — the one
// named — and never the whole pipeline.
function onlyStageIs(world: JollyWorld, name: string): void {
  const list = stages(world);
  assert.equal(
    list.length,
    1,
    `expected exactly one stage (${name}), got: ${JSON.stringify(list)}`,
  );
  assert.equal(list[0]?.stage, name, `expected the only stage to be "${name}"`);
}

const HEAVY = 900_000;

// ─── Background ─────────────────────────────────────────────────────────────

Given(
  "each side-effecting stage `jolly start` performs is also a first-class `jolly` command that runs that one stage against already-prepared preconditions, never the whole pipeline",
  function () {
    // Framing for the feature; every scenario proves it by running one stage
    // command in isolation and asserting exactly that one stage ran.
  },
);

// ─── jolly deploy ───────────────────────────────────────────────────────────

Given(
  "a prepared storefront directory and a configured Saleor store",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    writeStoreEnv(this);
    // Prepare the storefront by composing the storefront stage command — not the
    // `jolly start` pipeline.
    this.runCli(["storefront", "--yes", "--json"], { timeoutMs: HEAVY });
    assert.equal(
      stageStatus(this, "storefront"),
      "completed",
      `storefront precondition did not complete: ${JSON.stringify(this.lastRun?.envelope ?? this.lastRun?.stdout)}`,
    );
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "package.json")),
      "storefront/ was not prepared",
    );
    // A disposable, namespaced Vercel project so the deploy is cannon fodder we
    // tear down.
    const project = workerNamespace();
    addVercelProject(project);
    this.cleanup.register(`vercel project ${project}`, () => removeVercelProject(project));
    this.notes["vercelProject"] = project;
  },
);

When(
  "the agent runs `jolly deploy --yes --json`",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    this.notes["stageUnderTest"] = "deploy";
    this.runCli(["deploy", "--yes", "--json"], {
      env: { JOLLY_VERCEL_PROJECT: String(this.notes["vercelProject"]) },
      timeoutMs: HEAVY,
    });
  },
);

Then(
  'the `deploy` stage should report "completed" with the deployed `*.vercel.app` URL captured from the Vercel CLI\'s output',
  function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "deploy"),
      "completed",
      `deploy stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    const match = /https:\/\/[a-z0-9-]+\.vercel\.app/i.exec(JSON.stringify(this.envelope));
    assert.ok(match, "no *.vercel.app deployment URL in the envelope");
    this.notes["deployedUrl"] = match[0];
  },
);

Then(
  "it should persist `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL` on the Vercel project through the Vercel CLI, so a plain `npx vercel deploy` re-deploy also builds them",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    // Read the project's persisted env vars back through the Vercel CLI, in the
    // storefront dir the deploy linked to the disposable project.
    const ls = spawnSync(
      "npx",
      ["--yes", "vercel", "env", "ls", "production"],
      {
        cwd: join(this.projectDir, "storefront"),
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env },
      },
    );
    const out = `${ls.stdout ?? ""}\n${ls.stderr ?? ""}`;
    assert.match(
      out,
      /NEXT_PUBLIC_SALEOR_API_URL/,
      `NEXT_PUBLIC_SALEOR_API_URL is not persisted on the Vercel project:\n${out}`,
    );
    assert.match(
      out,
      /NEXT_PUBLIC_DEFAULT_CHANNEL/,
      `NEXT_PUBLIC_DEFAULT_CHANNEL is not persisted on the Vercel project:\n${out}`,
    );
  },
);

Then(
  "it should write `NEXT_PUBLIC_DEFAULT_CHANNEL` to `.env`, so the local storefront and a re-deploy read the store channel with no key juggling",
  function (this: JollyWorld) {
    const channel = loadEnvValues(this.projectDir)["NEXT_PUBLIC_DEFAULT_CHANNEL"];
    assert.ok(
      channel && channel.trim().length > 0,
      "NEXT_PUBLIC_DEFAULT_CHANNEL was not written to .env",
    );
  },
);

Then(
  "it should not provision a store, clone the storefront, or run any other stage",
  function (this: JollyWorld) {
    onlyStageIs(this, "deploy");
    assert.equal(
      this.findCheck("store-provisioned"),
      undefined,
      "deploy provisioned a store (store-provisioned check present)",
    );
  },
);

// ─── jolly storefront ───────────────────────────────────────────────────────

Given(
  "a fresh project directory with no storefront prepared",
  function (this: JollyWorld) {
    assert.ok(
      !existsSync(join(this.projectDir, "storefront", "package.json")),
      "storefront/ already prepared in a supposedly fresh project directory",
    );
  },
);

When(
  "the agent runs `jolly storefront --yes --json`",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    this.notes["stageUnderTest"] = "storefront";
    this.runCli(["storefront", "--yes", "--json"], { timeoutMs: HEAVY });
  },
);

Then(
  'the `storefront` stage should report "completed", backed by a real cloned Paper storefront with installed dependencies on disk',
  function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "storefront"),
      "completed",
      `storefront stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "package.json")),
      "no cloned Paper storefront on disk",
    );
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "node_modules")),
      "storefront dependencies were not installed",
    );
  },
);

Then(
  "it should not provision a store, deploy, or run any other stage",
  function (this: JollyWorld) {
    onlyStageIs(this, "storefront");
    assert.equal(this.findCheck("store-provisioned"), undefined, "storefront provisioned a store");
    assert.equal(this.findCheck("vercel-deployed"), undefined, "storefront deployed to Vercel");
  },
);

// ─── jolly recipe / jolly stock ─────────────────────────────────────────────
//
// These two scenarios prove `jolly recipe` and `jolly stock` each run standalone.
// Rather than re-deploy, they adopt the run's ONE recipe-deployed store
// (features/support/recipe-fixture.ts): its state is built ONCE per run by a
// standalone `jolly recipe --yes --json` then `jolly stock --yes --json` chain,
// both captured. Each scenario reads back the SAME captured run its Given names —
// the recipe run for the recipe scenario, the stock run for the stock scenario —
// and its Thens assert the captured envelope's single completed stage plus a live
// GraphQL read-back of the outcome. This is the identical isolation evidence the
// old When-based Thens asserted (exactly one stage ran; the store/deploy checks
// are absent), read from the shared standalone runs instead of a fresh one.

async function useRecipeStandaloneRun(
  world: JollyWorld,
  run: "recipe" | "stock",
): Promise<void> {
  const fixture = await ensureRecipeDeployedStore();
  world.notes.storeEndpoint = fixture.endpoint;
  world.notes.storeToken = fixture.token;
  if (fixture.token) world.trackSecret(fixture.token);
  world.previousRun = world.lastRun;
  world.lastRun = run === "recipe" ? fixture.recipeResult : fixture.stockResult;
}

Given(
  "the shared recipe store, whose starter recipe was deployed by a single `jolly recipe --yes --json` run against a freshly configured store",
  { timeout: HEAVY },
  async function (this: JollyWorld) {
    await useRecipeStandaloneRun(this, "recipe");
  },
);

Then(
  'that run should report the `recipe` stage "completed", having deployed the bundled starter recipe through `@saleor\\/configurator`',
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "recipe"),
      "completed",
      `recipe stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    // The starter recipe deploys product types; their presence proves a real
    // configurator deploy landed against the recipe store.
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const result = await saleorGraphql(
      endpoint,
      token,
      "query { productTypes(first: 1) { edges { node { id } } } }",
    );
    const edges = (result.data?.["productTypes"] as { edges?: unknown[] } | undefined)?.edges ?? [];
    assert.ok(edges.length > 0, "no product types on the store after the recipe stage");
  },
);

Then(
  "that run should not have provisioned a store, prepared the storefront, or deployed",
  function (this: JollyWorld) {
    // The captured recipe run carries exactly one stage — recipe — so it ran no
    // store, storefront, stock, or deploy stage; and no store-provisioned or
    // vercel-deployed check appears in its envelope.
    onlyStageIs(this, "recipe");
    assert.equal(this.findCheck("store-provisioned"), undefined, "recipe provisioned a store");
    assert.equal(this.findCheck("vercel-deployed"), undefined, "recipe deployed to Vercel");
  },
);

Given(
  "the shared recipe store, whose stock was seeded by a single `jolly stock --yes --json` run after its recipe was deployed",
  { timeout: HEAVY },
  async function (this: JollyWorld) {
    await useRecipeStandaloneRun(this, "stock");
  },
);

Then(
  'that run should report the `stock` stage "completed", having seeded stock for the recipe variants through Saleor GraphQL',
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "stock"),
      "completed",
      `stock stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    const endpoint = String(this.notes.storeEndpoint);
    const token = this.notes.storeToken as string | undefined;
    const result = await saleorGraphql(
      endpoint,
      token,
      "query { productVariants(first: 100) { edges { node { stocks { quantity } } } } }",
    );
    const edges =
      (result.data?.["productVariants"] as { edges?: Array<{ node?: { stocks?: Array<{ quantity?: number }> } }> } | undefined)?.edges ?? [];
    const seeded = edges.some((e) => (e.node?.stocks ?? []).some((s) => (s.quantity ?? 0) > 0));
    assert.ok(seeded, "no recipe variant carries seeded stock after the stock stage");
  },
);

Then(
  "that run should not have deployed or run any other stage",
  function (this: JollyWorld) {
    // The captured stock run carries exactly one stage — stock — and no
    // vercel-deployed check.
    onlyStageIs(this, "stock");
    assert.equal(this.findCheck("vercel-deployed"), undefined, "the stock stage deployed to Vercel");
  },
);

// (shared with jolly stripe)
Then(
  "it should not deploy or run any other stage",
  function (this: JollyWorld) {
    onlyStageIs(this, String(this.notes["stageUnderTest"]));
    assert.equal(this.findCheck("vercel-deployed"), undefined, "the stage deployed to Vercel");
  },
);

// ─── jolly stripe ───────────────────────────────────────────────────────────

Given(
  "a configured Saleor store with a resolvable staff token",
  function (this: JollyWorld) {
    writeStoreEnv(this);
  },
);

When(
  "the agent runs `jolly stripe --yes --json`",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    this.notes["stageUnderTest"] = "stripe";
    this.runCli(["stripe", "--yes", "--json"], { timeoutMs: HEAVY });
  },
);

Then(
  'the `stripe` stage should report "completed" or "blocked" honestly, having attempted the Saleor app install for the Stripe payment app',
  function (this: JollyWorld) {
    const status = stageStatus(this, "stripe");
    assert.ok(
      status === "completed" || status === "blocked",
      `stripe stage reported "${status}", expected "completed" or "blocked"`,
    );
    // The attempt is backed by an explaining stripe check either way.
    assert.ok(
      this.findCheck("stripe") !== undefined,
      "no stripe check reporting the app-install attempt",
    );
  },
);

// --- Scenario: jolly start composes the stage seams in order (@logic @exceptional-double) ---
//
// @exceptional-double: proving the orchestrator CALLS each stage seam in order,
// with its gates and state hand-off, does not require re-running the real heavy
// stages — their behaviour is verified by the jolly <stage> command scenarios
// above. So the seams are replaced with recording spies and runStartCore is
// driven in-process; only the composition (call order) is asserted.

const SIDE_EFFECTING_STAGES = ["store", "recipe", "stock", "storefront", "stripe", "deploy"];

Given("the stage seams are replaced with recording spies", function (this: JollyWorld) {
  const order: string[] = [];
  this.notes.spyOrder = order;
  const spies: Record<string, StageRunner> = {};
  for (const stage of SIDE_EFFECTING_STAGES) {
    spies[stage] = async () => {
      order.push(stage);
      return { status: "completed" as const };
    };
  }
  this.notes.spyRunners = spies;
});

When(
  "`jolly start --yes` runs its orchestration",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    // A fresh project dir with a Cloud token (so the auth stage completes and the
    // run reaches the side-effecting stages) and no store endpoint (so the store
    // stage is not skipped as already-satisfied). JOLLY_PROJECT_DIR points Jolly at
    // it without a process-wide chdir; restored in finally. JOLLY_NO_MAIN keeps the
    // dynamic import from executing the CLI against cucumber's argv.
    const dir = this.newTempDir("compose");
    writeEnvValues(dir, { JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN });
    const previous = process.env["JOLLY_PROJECT_DIR"];
    const previousNoMain = process.env["JOLLY_NO_MAIN"];
    process.env["JOLLY_PROJECT_DIR"] = dir;
    process.env["JOLLY_NO_MAIN"] = "1";
    try {
      const { runStartCore, parseArgs } = await import("../../src/index.ts");
      const args = parseArgs(["start", "--yes", "--json"]);
      await runStartCore(
        args,
        undefined,
        undefined,
        this.notes.spyRunners as Record<string, StageRunner>,
      );
    } finally {
      if (previous === undefined) delete process.env["JOLLY_PROJECT_DIR"];
      else process.env["JOLLY_PROJECT_DIR"] = previous;
      if (previousNoMain === undefined) delete process.env["JOLLY_NO_MAIN"];
      else process.env["JOLLY_NO_MAIN"] = previousNoMain;
    }
  },
);

Then(
  "it should invoke the store, storefront, recipe, stock, deploy, and stripe seams in that order",
  function (this: JollyWorld) {
    assert.deepEqual(
      this.notes.spyOrder,
      ["store", "storefront", "recipe", "stock", "deploy", "stripe"],
      `jolly start must compose the stage seams in plan order; got ${JSON.stringify(this.notes.spyOrder)}`,
    );
  },
);
