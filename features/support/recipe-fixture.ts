// Feature 004 — shared recipe-deployed store fixture.
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
// a recipe-deployed store, not the act of deploying, so this fixture deploys the
// recipe to ONE separate, cached store ONCE per run and the scenarios read their
// fact back from it via real GraphQL queries.
//
// It deliberately mirrors provision.ts's shared-store conventions: a persistent
// cross-invocation marker (its OWN, distinct from the shared store's), a
// run-scoped lock + state file so exactly one worker deploys and the rest adopt
// its derived values, and the jolly-cannon-fodder- prefix so it is this test
// org's disposable, prefix-reclaimable cannon fodder. It is a SEPARATE store
// from the primary shared one (provision.ts): the recipe deploy never mutates
// the primary shared store other scenarios depend on. reclaimStaleResources
// (provision.ts) spares this marker's exact current name the same way it spares
// the shared marker's, so the cached recipe store survives between invocations
// while an orphaned former one is still reclaimed by prefix.
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
import { deleteEnvironment } from "./cloud.ts";
import { findEnvelope, type Envelope } from "./envelope.ts";
import { createEnvironment, type CliRunner } from "./env-factory.ts";
import { makeNamespace, runId, workerNamespace } from "./sandbox.ts";
import { REPO_ROOT } from "./repo-root.ts";
import type { CliResult } from "./world.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { probeEndpointConnectivity } from "../../src/lib/cloud-api.ts";

/** Name prefix for the long-lived, cross-run recipe-deployed store. Distinct
 * from SHARED_STORE_PREFIX so the two cached stores never collide; still under
 * the jolly-cannon-fodder- protection/reclaim boundary. */
export const RECIPE_STORE_PREFIX = "jolly-cannon-fodder-recipe";

/** The recipe-deployed store plus the captured envelope of the ONE
 * `jolly start --yes --json` run that deployed the recipe to it this run. */
export interface RecipeFixture {
  endpoint: string;
  token: string;
  result: CliResult;
}

interface RecipeStoreMarker {
  org: string;
  key: string;
  name: string;
  url: string;
  token: string;
}

/** Filesystem paths every worker of a run agrees on (the run id is shared): a
 * lock so exactly one worker deploys the recipe, and a state file the winner
 * writes with the derived values + captured envelope for the rest to read. */
function recipeLockPath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-recipe-env.lock`);
}
function recipeStatePath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-recipe-env.json`);
}

/** The persistent cross-invocation marker recording the last known-good
 * recipe-deployed store, independent of any single run's id so a LATER
 * invocation can find and reuse it (its own marker, distinct from the shared
 * store's). */
function recipeStoreMarkerPath(): string {
  return join(tmpdir(), "jolly-cannon-fodder-recipe-store-marker.json");
}

export function readRecipeStoreMarker(): RecipeStoreMarker | undefined {
  try {
    return JSON.parse(readFileSync(recipeStoreMarkerPath(), "utf8")) as RecipeStoreMarker;
  } catch {
    return undefined;
  }
}

function writeRecipeStoreMarker(marker: RecipeStoreMarker): void {
  writeFileSync(recipeStoreMarkerPath(), JSON.stringify(marker));
}

/** A fresh name guaranteed not to collide with an existing domain label (the
 * fixed prefix alone is not enough — see provision.ts's freshSharedStoreName).
 * Still exempted from generic leftover reclaim by the current marker's name. */
function freshRecipeStoreName(): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${RECIPE_STORE_PREFIX}-${suffix}`;
}

let ensuring: Promise<RecipeFixture> | undefined;

/**
 * Ensure the run's ONE recipe-deployed store exists and the recipe has been
 * deployed to it once this run; return its derived creds + the captured deploy
 * envelope. Exactly one worker across the whole run deploys (whoever wins the
 * filesystem lock); every other worker reads the derived values the winner
 * publishes to the state file. Memoized per worker.
 */
export function ensureRecipeDeployedStore(): Promise<RecipeFixture> {
  ensuring ??= coordinateRecipeStore();
  return ensuring;
}

/**
 * Cross-worker coordination, mirroring provision.ts's coordinateSharedEnvironment.
 * The lock winner provisions/reuses the recipe store, deploys the recipe once,
 * and publishes the derived creds + captured stdout; the rest wait for the state
 * file and reconstruct the result from the published stdout.
 */
async function coordinateRecipeStore(): Promise<RecipeFixture> {
  let owner = false;
  try {
    closeSync(openSync(recipeLockPath(), "wx")); // atomic O_EXCL: one winner
    owner = true;
  } catch {
    owner = false;
  }
  if (owner) {
    const fixture = await provisionRecipeStore();
    writeFileSync(
      recipeStatePath(),
      JSON.stringify({
        endpoint: fixture.endpoint,
        token: fixture.token,
        args: fixture.result.args,
        cwd: fixture.result.cwd,
        exitCode: fixture.result.exitCode,
        stdout: fixture.result.stdout,
        stderr: fixture.result.stderr,
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
        args: string[];
        cwd: string;
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      return {
        endpoint: state.endpoint,
        token: state.token,
        result: {
          args: state.args,
          cwd: state.cwd,
          exitCode: state.exitCode,
          stdout: state.stdout,
          stderr: state.stderr,
          envelope: findEnvelope(state.stdout),
        },
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "timed out waiting for the recipe-deployed store another worker is provisioning",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Adopt the marker's cached recipe store if still reachable, otherwise create a
 * fresh one and cache it for the NEXT invocation; then deploy the recipe to it
 * ONCE via `jolly start --yes --json`, capturing the envelope. Mirrors
 * provision.ts's provisionSharedEnvironment, minus the leftover reclamation
 * (that stays owned by provision.ts's reclaimStaleResources, run unconditionally
 * from hooks.ts's BeforeAll, which now spares this marker too).
 */
async function provisionRecipeStore(): Promise<RecipeFixture> {
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";
  const marker = readRecipeStoreMarker();
  let endpoint: string;
  let token: string;
  if (marker && (await probeEndpointConnectivity(marker.url)).kind === "reachable") {
    endpoint = marker.url;
    token = marker.token;
  } else {
    // The marker is absent, or its store is gone/unreachable — best-effort clean
    // it up (deleteEnvironment 404s harmlessly if already gone) before replacing
    // it, so a broken cached store never lingers occupying a sandbox slot.
    if (marker) {
      try {
        await deleteEnvironment(cloudToken, marker.org, marker.key);
      } catch {
        // Best-effort: the replacement below is what matters.
      }
    }
    const created = await createRecipeStore(freshRecipeStoreName());
    // 600s: matches provision.ts's readiness gate — real cold starts occasionally
    // exceed both 180s and 300s, especially under several quick provisions.
    if (!(await waitForReady(created.url, 600_000))) {
      throw new Error(
        `provisioned recipe store ${created.url} did not become reachable within 600s ` +
          `(cold-start readiness budget exceeded)`,
      );
    }
    writeRecipeStoreMarker({
      org: created.org,
      key: created.key,
      name: created.name,
      url: created.url,
      token: created.token,
    });
    endpoint = created.url;
    token = created.token;
  }

  const result = deployRecipe(endpoint, token);
  return { endpoint, token, result };
}

/** Poll until the store's GraphQL endpoint actually serves, or return false
 * having waited out the budget (mirrors provision.ts's waitForReady). */
async function waitForReady(url: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await probeEndpointConnectivity(url)).kind === "reachable") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

/**
 * Run `jolly start --yes --json` ONCE against the recipe store to deploy the
 * starter recipe and seed stock, capturing the envelope. Runs in a throwaway
 * scratch project directory (removed immediately after — nothing here is reused)
 * with the store creds passed in the child's env, so the recipe/stock stages
 * (src/index.ts read process.env first) target THIS store, never the primary
 * shared store. Uses the same warm pnpm/npm cache the World does, so the
 * storefront clone+install tail is not re-fetched. A standalone spawnSync
 * (recipe deploy runs outside a scenario World), mirroring provision.ts.
 */
function deployRecipe(endpoint: string, token: string): CliResult {
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-recipe-`));
  try {
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    // Point the recipe/stock stages at the recipe store, never the primary
    // shared store whose creds the @sandbox Before hook left in process.env.
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

    const args = ["start", "--yes", "--json"];
    // Observability: the recipe is deployed exactly once per run, here. This
    // marker line lets a verification run confirm the once-per-run contract
    // (the scenarios below adopt the memoized result, never re-deploying).
    process.stderr.write(`[recipe-fixture] deploying starter recipe to ${endpoint}\n`);
    const spawned = spawnSync(runtime, [join(REPO_ROOT, "src", "index.ts"), ...args], {
      cwd: scratchDir,
      env,
      encoding: "utf8",
      timeout: 840_000,
    });
    if (spawned.error) {
      throw new Error(
        `failed to invoke Jolly CLI for recipe-store deploy via "${runtime}": ${spawned.error.message}`,
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
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Create a NEW recipe store, starting from the given name but minting another
 * fresh one on a domain-label collision. Derives runtime values from the scratch
 * project directory's `.env`. A faithful mirror of provision.ts's
 * createSharedStore, routed through the single env-creation seam
 * (env-factory.ts's createEnvironment) so the single-creation-seam conformance
 * check stays green.
 */
async function createRecipeStore(
  initialName: string,
): Promise<{ name: string; org: string; key: string; url: string; token: string }> {
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-recipe-create-`));

  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
  const run: CliRunner = (args) => {
    const spawned = spawnSync(runtime, [join(REPO_ROOT, "src", "index.ts"), ...args], {
      cwd: scratchDir,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 540_000,
    });
    if (spawned.error) {
      throw new Error(
        `failed to invoke Jolly CLI for recipe-store provisioning via "${runtime}": ${spawned.error.message}`,
      );
    }
    const stdout = spawned.stdout ?? "";
    return Promise.resolve({
      args,
      cwd: scratchDir,
      exitCode: spawned.status ?? -1,
      stdout,
      stderr: spawned.stderr ?? "",
      envelope: findEnvelope(stdout),
    });
  };

  let name = initialName;
  let envelope: Envelope;
  for (let labelAttempts = 0; ; ) {
    const result = await createEnvironment(run, {
      name,
      domainLabel: name,
      limitBudgetMs: 540_000,
    });
    const parsed = result.envelope;
    if (!parsed) {
      throw new Error(
        `recipe-store provisioning produced no output envelope ` +
          `(exit ${result.exitCode}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    const labelTaken =
      parsed.status === "error" &&
      parsed.errors.some((e) => e.code === "DOMAIN_LABEL_TAKEN");
    if (labelTaken && labelAttempts < 5) {
      labelAttempts++;
      name = freshRecipeStoreName();
      continue;
    }
    envelope = parsed;
    break;
  }

  try {
    if (
      envelope.status === "error" &&
      envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
    ) {
      throw new Error(
        "Cloud API still rejected recipe-store creation with ENVIRONMENT_LIMIT_REACHED " +
          "after waiting for a sibling worker to free a slot (organization sandbox " +
          "limit). Raise the org's environment limit or lower the sandbox worker count.",
      );
    }
    if (envelope.status !== "success") {
      throw new Error(
        `recipe-store provisioning failed: ${envelope.summary}\n` +
          JSON.stringify(envelope.errors),
      );
    }
    if (envelope.data.environmentName !== name) {
      throw new Error(
        `provisioned recipe environment does not carry the configured name: ` +
          `expected "${name}", got "${envelope.data.environmentName}" — ` +
          `jolly create store --create-environment must honor --name/--domain-label`,
      );
    }

    const values = loadEnvValues(scratchDir);
    const url = values["NEXT_PUBLIC_SALEOR_API_URL"];
    const saleorToken = values["SALEOR_TOKEN"];
    if (!url || !saleorToken) {
      throw new Error(
        "recipe-store provisioning did not yield both " +
          "NEXT_PUBLIC_SALEOR_API_URL and SALEOR_TOKEN in .env",
      );
    }
    const org = typeof envelope.data.organization === "string" ? envelope.data.organization : "";
    const key = typeof envelope.data.environmentKey === "string" ? envelope.data.environmentKey : "";
    return { name, org, key, url, token: saleorToken };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}
