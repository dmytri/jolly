// Feature 004 — the starter recipe deployed ONTO the primary shared store.
//
// Three recipe @sandbox scenarios assert STATE facts about a store that has the
// starter recipe deployed to it:
//   - "Jolly start deploys the starter recipe with @saleor/configurator"
//   - "Jolly start seeds stock so the recipe catalog is buyable"
//   - "Jolly start confirms the recipe's featured collection exists before
//      reporting the recipe stage completed"
// Each used to run its own full `jolly start --yes --json` — a real
// @saleor/configurator deploy plus stock seed — so the recipe was deployed to a
// fresh store five times per run (~20 min). But those three assert the RESULT of
// a recipe-deployed store, not the act of deploying, so this fixture builds that
// state ONCE per run and the scenarios read their fact back via real GraphQL.
//
// It builds the state ON the PRIMARY SHARED store (provision.ts), not a separate
// dedicated one: the test org's environment limit is 2, and keeping two
// persistent fixtures (shared + a separate recipe store) starved the @creates-env
// scenarios of a slot. Deploying onto the shared store is SAFE — every shared-store
// mutation the recipe/stock chain makes is additive/idempotent, no scenario needs a
// blank shared store, and nothing here deletes recipe entities or completes a
// stock-deducting order — so ONE persistent env now serves both roles.
//
// The state is built with the STANDALONE stage commands, not `jolly start`: a
// single `jolly recipe --yes --json` run deploys the starter recipe, then a
// single `jolly stock --yes --json` run seeds stock for its variants (stock needs
// the recipe deployed first, so the order is fixed). Both runs target the SAME
// shared store and are captured as separate results — this doubles as feature
// 029's proof that `jolly recipe`/`jolly stock` each run standalone, so 029 reads
// these same two captured runs instead of re-deploying.
//
// It mirrors provision.ts's cross-worker conventions: a run-scoped lock + state
// file so exactly one worker runs the deploy chain and the rest adopt its captured
// envelopes. There is no store to provision or cache here — provisionSharedEnvironment
// already stood up and readiness-gated the shared store, and this fixture only
// deploys onto its creds. It is LAZY (CARVE-OUT B): triggered only when 004/029
// consume it, never from the @sandbox Before hook, so light-only runs and 026's
// direct provisionSharedEnvironment call don't pay the multi-minute deploy. The
// @sandbox @heavy serial tier guarantees no concurrent toolchain.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEnvelope } from "./envelope.ts";
import { ensureSharedEnvironment } from "./provision.ts";
import { saleorGraphql } from "./saleor-graphql.ts";
import { makeNamespace, runId, workerNamespace } from "./sandbox.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { deriveRecipeIdentifiers } from "../../src/lib/cloud-api.ts";
import type { CliResult } from "./world.ts";

/** The shared store's creds plus the captured envelopes of the ONE standalone
 * chain that deployed the recipe onto it this run: a `jolly recipe --yes --json`
 * run that deployed the starter recipe, then a `jolly stock --yes --json` run
 * that seeded stock for the recipe variants. Two separate real runs against the
 * SAME shared store, captured as separate results so consumers read the right
 * run's evidence. Same return contract the former separate-store fixture had. */
export interface RecipeOnSharedFixture {
  endpoint: string;
  token: string;
  recipeResult: CliResult;
  stockResult: CliResult;
}

/** Filesystem paths every worker of a run agrees on (the run id is shared): a
 * lock so exactly one worker deploys the recipe, and a state file the winner
 * writes with the captured envelopes for the rest to read. */
function recipeLockPath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-recipe-on-shared.lock`);
}
function recipeStatePath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-recipe-on-shared.json`);
}

let ensuring: Promise<RecipeOnSharedFixture> | undefined;

/**
 * Ensure the starter recipe has been deployed onto the primary shared store once
 * this run (standalone `jolly recipe` then `jolly stock`); return the shared
 * store's creds + BOTH captured run results. Exactly one worker across the whole
 * run runs the chain (whoever wins the filesystem lock); every other worker reads
 * the captured envelopes the winner publishes to the state file. Memoized per
 * worker. LAZY: only the 004/029 consumers call this, so a run that never touches
 * the recipe scenarios never pays the deploy.
 */
export function ensureRecipeOnSharedStore(): Promise<RecipeOnSharedFixture> {
  ensuring ??= coordinateRecipeOnShared();
  return ensuring;
}

/** The subset of a CliResult carried across workers via the state file; the
 * envelope is reconstructed from stdout on the reading side (findEnvelope). */
interface SerializedResult {
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function serializeResult(result: CliResult): SerializedResult {
  return {
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function deserializeResult(state: SerializedResult): CliResult {
  return {
    args: state.args,
    cwd: state.cwd,
    exitCode: state.exitCode,
    stdout: state.stdout,
    stderr: state.stderr,
    envelope: findEnvelope(state.stdout),
  };
}

/**
 * Cross-worker coordination, mirroring provision.ts's coordinateSharedEnvironment.
 * The lock winner awaits the shared store, runs the standalone recipe-then-stock
 * chain once against its creds, and publishes the derived creds + BOTH runs'
 * captured stdout; the rest wait for the state file and reconstruct both results
 * (each envelope re-parsed from the published stdout).
 */
async function coordinateRecipeOnShared(): Promise<RecipeOnSharedFixture> {
  let owner = false;
  try {
    closeSync(openSync(recipeLockPath(), "wx")); // atomic O_EXCL: one winner
    owner = true;
  } catch {
    owner = false;
  }
  if (owner) {
    const fixture = await deployRecipeOnShared();
    writeFileSync(
      recipeStatePath(),
      JSON.stringify({
        endpoint: fixture.endpoint,
        token: fixture.token,
        recipe: serializeResult(fixture.recipeResult),
        stock: serializeResult(fixture.stockResult),
      }),
    );
    return fixture;
  }
  const deadline = Date.now() + 900_000;
  for (;;) {
    if (existsSync(recipeStatePath())) {
      const state = JSON.parse(readFileSync(recipeStatePath(), "utf8")) as {
        endpoint: string;
        token: string;
        recipe: SerializedResult;
        stock: SerializedResult;
      };
      return {
        endpoint: state.endpoint,
        token: state.token,
        recipeResult: deserializeResult(state.recipe),
        stockResult: deserializeResult(state.stock),
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "timed out waiting for the recipe deploy another worker is running on the shared store",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Await the primary shared store (provision.ts already provisioned and
 * readiness-gated it), then deploy the recipe onto it ONCE via the standalone
 * `jolly recipe` then `jolly stock` chain, capturing both envelopes. There is no
 * separate store to create or cache — the shared store is the target — so this is
 * just: get the shared creds, run the chain.
 */
async function deployRecipeOnShared(): Promise<RecipeOnSharedFixture> {
  await ensureSharedEnvironment();
  const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token = process.env["SALEOR_TOKEN"] ?? "";
  // Fail LOUD on a polluted shared store BEFORE paying for a deploy that would
  // block on --failOnDelete and then cascade a misleading "recipe stage not
  // completed" across every 004/029 consumer (Fix 4 cleanliness diagnostic).
  await assertSharedStoreClean(endpoint, token);
  const { recipeResult, stockResult } = deployRecipe(endpoint, token);
  return { endpoint, token, recipeResult, stockResult };
}

/**
 * Pre-deploy cleanliness DIAGNOSTIC (detect, never auto-delete — AGENTS.md
 * forbids deleting a resource this run did not create): one cheap GraphQL read of
 * the shared store's product slugs, reusing the {@link deriveRecipeIdentifiers} /
 * storeHoldsForeignCatalog shape src/index.ts uses to decide `--failOnDelete`. If
 * any product slug lies OUTSIDE the recipe's declared slugs, the shared store is
 * polluted (most likely a leaked foreign product from an aborted scenario) and the
 * recipe deploy would block on exit 6 — so throw NOW naming the exact foreign
 * slug(s), turning a silent 10-scenario cascade into one clear failure that names
 * the polluting condition at the fixture.
 */
async function assertSharedStoreClean(
  endpoint: string,
  token: string,
): Promise<void> {
  const recipeYaml = join(REPO_ROOT, "assets", "skills", "jolly", "recipe.yml");
  const { productSlugs } = deriveRecipeIdentifiers(recipeYaml);
  const declared = new Set(productSlugs);
  const result = await saleorGraphql(
    endpoint,
    token,
    `query { products(first: 100) { edges { node { slug } } } }`,
  );
  const edges =
    (result.data?.products as { edges?: Array<{ node: { slug: string } }> } | undefined)
      ?.edges ?? [];
  const foreign = edges.map((edge) => edge.node.slug).filter((slug) => !declared.has(slug));
  if (foreign.length > 0) {
    throw new Error(
      `[recipe-on-shared] shared store polluted by ${foreign
        .map((slug) => `"${slug}"`)
        .join(", ")} (likely a leaked foreign product) — ` +
        `product slug(s) outside the starter recipe's declared catalog. A recipe ` +
        `deploy would hit --failOnDelete (exit 6) and cascade a misleading ` +
        `"recipe stage not completed" across every 004/029 consumer. Detected, NOT ` +
        `auto-deleted (AGENTS.md forbids deleting what this run did not create): ` +
        `remove the foreign product(s) from the shared store, then re-run.`,
    );
  }
}

/** A standalone stage command's status from its envelope: commandStage
 * (src/index.ts) reports `data.stages` as a single `{ stage, status }`. */
function stageStatus(result: CliResult, stage: string): string | undefined {
  const stages = (result.envelope?.data.stages ?? []) as Array<{
    stage: string;
    status: string;
  }>;
  return stages.find((entry) => entry.stage === stage)?.status;
}

/** A stage command's diagnostic check description (the recipe-deployed check
 * already carries the --failOnDelete/deletions-blocked reason, src/index.ts). */
function stageCheckDescription(result: CliResult, checkId: string): string {
  const check = result.envelope?.checks.find((entry) => entry.id === checkId);
  return String(check?.description ?? "(no check description in envelope)");
}

/**
 * Deploy the recipe onto the shared store ONCE with the STANDALONE stage
 * commands: run `jolly recipe --yes --json` to deploy the starter recipe, then
 * `jolly stock --yes --json` to seed stock for its variants (stock needs the
 * recipe deployed, so the order is fixed). Returns BOTH runs' captured results.
 * Each runs in the same throwaway scratch project directory (removed immediately
 * after — nothing here is reused) with the shared store's creds passed in the
 * child's env, so the stages (src/index.ts read process.env first) target the
 * shared store explicitly. Uses the same warm pnpm/npm cache the World does. This
 * mirrors how feature 029's old When steps invoked `jolly recipe`/`jolly stock`
 * directly — so the standalone commands run here exactly as they did when 029
 * tested them one-off. A standalone spawnSync (this runs outside a scenario
 * World), mirroring provision.ts.
 */
function deployRecipe(
  endpoint: string,
  token: string,
): { recipeResult: CliResult; stockResult: CliResult } {
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-recipe-`));
  try {
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    // Point the recipe/stock stages at the shared store explicitly (the
    // @sandbox Before hook already left the shared store's creds in process.env,
    // but set them unconditionally so the stages target it regardless).
    env["NEXT_PUBLIC_SALEOR_API_URL"] = endpoint;
    env["SALEOR_URL"] = endpoint;
    env["SALEOR_TOKEN"] = token;
    // Warm shared pnpm store + npm/npx cache (same as world.runCli), so package
    // fetches happen once across the suite rather than per invocation.
    const pkgCache = process.env.HARNESS_PKG_CACHE ?? join(tmpdir(), "jolly-cannon-fodder-pkg-cache");
    const pnpmStore = join(pkgCache, "pnpm-store");
    const npmCache = join(pkgCache, "npm-cache");
    mkdirSync(pnpmStore, { recursive: true });
    mkdirSync(npmCache, { recursive: true });
    if (!env.npm_config_store_dir) env.npm_config_store_dir = pnpmStore;
    if (!env.npm_config_cache) env.npm_config_cache = npmCache;
    if (!env.HARNESS_AGENT_POLL_WINDOW_SECONDS) env.HARNESS_AGENT_POLL_WINDOW_SECONDS = "1";

    // Run one standalone stage command against the shared store, capturing its
    // result exactly as world.runCli would (same runtime, cwd, env, envelope
    // parse). Faithful to 029's old `this.runCli(["recipe"/"stock", ...])`.
    const runStage = (args: string[]): CliResult => {
      const spawned = spawnSync(runtime, [join(REPO_ROOT, "src", "index.ts"), ...args], {
        cwd: scratchDir,
        env,
        encoding: "utf8",
        timeout: 840_000,
      });
      if (spawned.error) {
        throw new Error(
          `failed to invoke Jolly CLI for recipe-on-shared \`${args.join(" ")}\` via "${runtime}": ` +
            spawned.error.message,
        );
      }
      const stdout = spawned.stdout ?? "";
      return {
        args,
        cwd: scratchDir,
        exitCode: spawned.status ?? -1,
        stdout,
        stderr: spawned.stderr ?? "",
        envelope: findEnvelope(stdout),
      };
    };

    // Observability: the recipe is deployed onto the shared store exactly once
    // per run, here. These marker lines let a verification run confirm the
    // once-per-run contract (the scenarios below adopt the memoized results,
    // never re-running).
    process.stderr.write(`[recipe-on-shared] deploying starter recipe to ${endpoint}\n`);
    const recipeResult = runStage(["recipe", "--yes", "--json"]);
    // Fail LOUD: a blocked (exit 6 / --failOnDelete) recipe deploy must NEVER be
    // memoized silently — every 004/029 consumer would then red with a misleading
    // "recipe stage not completed." Throw here naming WHY (the recipe-deployed
    // check's own reason plus the exit code), so a 10-scenario cascade collapses
    // into ONE clear failure at the fixture that names the polluting condition.
    const recipeStageStatus = stageStatus(recipeResult, "recipe");
    if (recipeStageStatus !== "completed") {
      throw new Error(
        `[recipe-on-shared] the shared-store recipe deploy did not complete: recipe ` +
          `stage status "${recipeStageStatus ?? "unknown"}" (exit ${recipeResult.exitCode}). ` +
          `recipe-deployed check: ${stageCheckDescription(recipeResult, "recipe-deployed")}`,
      );
    }
    process.stderr.write(`[recipe-on-shared] seeding recipe stock on ${endpoint}\n`);
    const stockResult = runStage(["stock", "--yes", "--json"]);
    // Same fail-loud contract for the stock seed: a blocked stock stage memoized
    // silently would red every stock-reading consumer with a misleading message,
    // so throw here naming the stock-seeded check's reason plus the exit code.
    const stockStageStatus = stageStatus(stockResult, "stock");
    if (stockStageStatus !== "completed") {
      throw new Error(
        `[recipe-on-shared] the shared-store stock seed did not complete: stock ` +
          `stage status "${stockStageStatus ?? "unknown"}" (exit ${stockResult.exitCode}). ` +
          `stock-seeded check: ${stageCheckDescription(stockResult, "stock-seeded")}`,
      );
    }
    return { recipeResult, stockResult };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}
