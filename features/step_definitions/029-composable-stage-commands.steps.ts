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
import type { JollyWorld } from "../support/world.ts";

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

// ─── jolly recipe ───────────────────────────────────────────────────────────

Given(
  "a configured Saleor store with a resolvable token",
  function (this: JollyWorld) {
    writeStoreEnv(this);
  },
);

When(
  "the agent runs `jolly recipe --yes --json`",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    this.notes["stageUnderTest"] = "recipe";
    this.runCli(["recipe", "--yes", "--json"], { timeoutMs: HEAVY });
  },
);

Then(
  'the `recipe` stage should report "completed", having deployed the bundled starter recipe through `@saleor\\/configurator`',
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "recipe"),
      "completed",
      `recipe stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    // The starter recipe deploys product types; their presence proves a real
    // configurator deploy landed against the store.
    const { endpoint, token } = storeCreds();
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
  "it should not provision a store, prepare the storefront, or deploy",
  function (this: JollyWorld) {
    onlyStageIs(this, "recipe");
    assert.equal(this.findCheck("store-provisioned"), undefined, "recipe provisioned a store");
    assert.ok(
      !existsSync(join(this.projectDir, "storefront", "package.json")),
      "recipe prepared the storefront",
    );
    assert.equal(this.findCheck("vercel-deployed"), undefined, "recipe deployed to Vercel");
  },
);

// ─── jolly stock ────────────────────────────────────────────────────────────

Given(
  "a configured Saleor store whose recipe catalog is deployed",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    writeStoreEnv(this);
    // Deploy the recipe catalog by composing the recipe stage command.
    this.runCli(["recipe", "--yes", "--json"], { timeoutMs: HEAVY });
    assert.equal(
      stageStatus(this, "recipe"),
      "completed",
      `recipe precondition did not complete: ${JSON.stringify(this.lastRun?.envelope ?? this.lastRun?.stdout)}`,
    );
  },
);

When(
  "the agent runs `jolly stock --yes --json`",
  { timeout: HEAVY },
  function (this: JollyWorld) {
    this.notes["stageUnderTest"] = "stock";
    this.runCli(["stock", "--yes", "--json"], { timeoutMs: HEAVY });
  },
);

Then(
  'the `stock` stage should report "completed", having seeded stock for the recipe variants through Saleor GraphQL',
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    assert.equal(
      stageStatus(this, "stock"),
      "completed",
      `stock stage not completed: ${JSON.stringify(this.envelope.data)}`,
    );
    const { endpoint, token } = storeCreds();
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
