// Shared DEPLOYED-STOREFRONT fixture (feature 027's completed interactive
// start).
//
// "A project whose store, storefront, and deployment stages are already
// satisfied" needs a REAL live production deployment for its satisfied deploy
// stage — never a fabricated URL. A real Vercel deploy of the prepared Paper
// storefront is the single most expensive spend after environment creation, so
// this fixture provisions ONE shared deployment and caches it ACROSS runs
// behind a persistent marker, mirroring provision.ts's shared store:
//   - healthy = the marker's URL actually serves AND the deployment was built
//     against the CURRENT shared store endpoint (the storefront bakes
//     NEXT_PUBLIC_SALEOR_API_URL in at build time, so a store self-heal makes
//     the old deployment stale by construction);
//   - self-heal = run the REAL production seam (`jolly deploy --yes --json`)
//     over a scratch project assembled from the shared fixtures (shared store
//     creds in .env + materialized prepared-storefront template), targeting the
//     stable shared Vercel project. Production itself does the project add,
//     the vercel.json framework pin, the deploy, the protection disable, the
//     project link, and the serving readiness poll — so the deployment artifact
//     is production-shaped by construction, not a harness imitation.
// The heal is a shared-provisioning spend (class "vercel-deployment"), recorded
// once per resource class per run; adopting the marker's healthy deployment
// records nothing (feature verification-economy). The Vercel project is
// stable-named and deliberately long-lived, like the shared store: never torn
// down by scenario cleanup, replaced only through this self-heal.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEnvelope } from "./envelope.ts";
import { recordDeploymentCapture } from "./eval-captures.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { addVercelProject, makeNamespace, runId, workerNamespace } from "./sandbox.ts";
import { withSharedProvisioningSpend } from "./spend-ledger.ts";
import { materializePreparedStorefront } from "./storefront-fixture.ts";
import { writeEnvValues } from "../../src/lib/env-file.ts";

/**
 * The FIXED basename of the persistent cross-run shared-deployment marker.
 * Not run-namespaced (it must outlive every run), so provision.ts's
 * tmpdir-reclaim sweep spares it by EXACT name, alongside the shared-store
 * marker, the pkg-cache, and the storefront template.
 */
export const SHARED_DEPLOY_MARKER_FILENAME =
  "jolly-cannon-fodder-shared-deploy-marker.json";

/**
 * The stable name of the ONE long-lived shared Vercel project the deployment
 * lives on. Vercel project names are account-scoped and `vercel project add`
 * is idempotent, so a fixed name is safe (unlike Saleor domain labels). It is
 * jolly-cannon-fodder-namespaced but deliberately persistent: no scenario
 * registers its removal, and Vercel leftover cleanup is per-created-project
 * registration, never a prefix sweep.
 */
const SHARED_DEPLOY_PROJECT = "jolly-cannon-fodder-shared-deploy";

export interface SharedDeployment {
  /** The Vercel project the deployment lives on. */
  project: string;
  /** The live production URL the deployment serves. */
  url: string;
  /** The store endpoint the deployed storefront was built against. */
  storeEndpoint: string;
  /** The licensed sandbox run whose heal deployed it (golden-capture source). */
  sourceRun?: string;
}

function markerPath(): string {
  return join(tmpdir(), SHARED_DEPLOY_MARKER_FILENAME);
}

function readSharedDeployMarker(): SharedDeployment | undefined {
  try {
    const marker = JSON.parse(readFileSync(markerPath(), "utf8")) as SharedDeployment;
    return typeof marker.project === "string" &&
      typeof marker.url === "string" &&
      typeof marker.storeEndpoint === "string"
      ? marker
      : undefined;
  } catch {
    return undefined;
  }
}

function writeSharedDeployMarker(marker: SharedDeployment): void {
  writeFileSync(markerPath(), JSON.stringify(marker));
}

/** Filesystem paths every worker of a run agrees on (the run id is shared): a
 * lock so exactly one worker heals, and a state file the winner writes with the
 * deployment for the rest to read. */
function deployLockPath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-shared-deploy.lock`);
}
function deployStatePath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-shared-deploy.json`);
}

/**
 * Poll the deployed URL until it observably serves (any non-error response,
 * redirects followed), bounded by a deadline. A cold serverless deployment's
 * first hit can be slow; the wait ends the moment the signal fires.
 */
async function deploymentServes(url: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const response = await fetch(url, { method: "GET", redirect: "follow" });
      if (response.status < 400) return true;
    } catch {
      // Not reachable yet.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

let ensuring: Promise<SharedDeployment> | undefined;

/**
 * Ensure the run's ONE shared live storefront deployment exists and return it.
 * Exactly one worker across the whole run provisions or heals it (whoever wins
 * the filesystem lock); every other worker reads the deployment the winner
 * publishes to the state file. Memoized per worker. LAZY: only the
 * satisfied-deployment consumers call this, so a run that never needs the
 * deployment never pays a probe or a heal.
 */
export function ensureSharedDeployment(): Promise<SharedDeployment> {
  ensuring ??= coordinateSharedDeployment();
  return ensuring;
}

async function coordinateSharedDeployment(): Promise<SharedDeployment> {
  let owner = false;
  try {
    closeSync(openSync(deployLockPath(), "wx")); // atomic O_EXCL: one winner
    owner = true;
  } catch {
    owner = false;
  }
  if (owner) {
    const deployment = await provisionSharedDeployment();
    writeFileSync(deployStatePath(), JSON.stringify(deployment));
    return deployment;
  }
  const deadline = Date.now() + 1_200_000;
  for (;;) {
    if (existsSync(deployStatePath())) {
      return JSON.parse(readFileSync(deployStatePath(), "utf8")) as SharedDeployment;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "timed out waiting for the shared deployment another worker is provisioning",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Adopt the marker's cached deployment if it is still healthy — built against
 * the CURRENT shared store and actually serving — otherwise self-heal by
 * deploying the prepared storefront through the real production seam and cache
 * the result for the NEXT invocation.
 */
async function provisionSharedDeployment(): Promise<SharedDeployment> {
  const storeEndpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  const storeToken = process.env["SALEOR_TOKEN"];
  if (!storeEndpoint || !storeToken) {
    throw new Error(
      "the shared store must be provisioned before the shared deployment " +
        "(NEXT_PUBLIC_SALEOR_API_URL + SALEOR_TOKEN absent from process.env)",
    );
  }
  const marker = readSharedDeployMarker();
  if (
    marker &&
    marker.storeEndpoint === storeEndpoint &&
    (await deploymentServes(marker.url, 90_000))
  ) {
    // The adopted deployment is the golden-capture source for the eval's
    // Vercel-deploy effect (feature 025): keep the committed capture current.
    recordDeploymentCapture(marker);
    return marker;
  }
  // A fresh shared deployment is a shared-provisioning spend, recorded once per
  // resource class per run; adopting the healthy cached deployment above
  // records nothing (feature verification-economy).
  const deployment = await withSharedProvisioningSpend("vercel-deployment", () =>
    deployPreparedStorefront(storeEndpoint, storeToken),
  );
  const healed: SharedDeployment = { ...deployment, sourceRun: runId() };
  writeSharedDeployMarker(healed);
  // The heal ran the real `jolly deploy`, whose real Vercel CLI children the
  // sandbox PATH shim observed: fold those observations into the committed
  // golden captures (feature 025).
  recordDeploymentCapture(healed);
  return healed;
}

/**
 * Deploy the prepared storefront to the stable shared Vercel project through
 * the REAL production seam: a scratch project carrying the shared store's
 * creds and a materialized prepared-storefront template, driven by
 * `jolly deploy --yes --json`. Production does the project add, the framework
 * pin, the real `npx vercel deploy`, the protection disable, and the serving
 * readiness poll itself, so the resulting deployment is exactly what a
 * completed run leaves.
 */
async function deployPreparedStorefront(
  storeEndpoint: string,
  storeToken: string,
): Promise<SharedDeployment> {
  const scratchDir = join(tmpdir(), `${workerNamespace()}-shared-deploy-build`);
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });
  try {
    writeEnvValues(scratchDir, {
      NEXT_PUBLIC_SALEOR_API_URL: storeEndpoint,
      SALEOR_URL: storeEndpoint,
      SALEOR_TOKEN: storeToken,
    });
    await materializePreparedStorefront(join(scratchDir, "storefront"));

    // Make the rare heal build deterministic BEFORE the deploy: create the
    // project when absent (idempotent, as production does), link the scratch
    // storefront to it, and pin VERCEL_FORCE_NO_BUILD_CACHE=1 at PROJECT level
    // so the remote builder never restores a prior build's cache — a
    // cache-restored heal build failed Paper's codegen where the uncached
    // build of the same source and store succeeded. A local env var cannot do
    // this: the build runs on Vercel's builder, which reads project env.
    // Best-effort add: re-adding an existing env var fails harmlessly.
    addVercelProject(SHARED_DEPLOY_PROJECT);
    linkStorefrontToSharedProject(join(scratchDir, "storefront"), SHARED_DEPLOY_PROJECT);
    spawnSync(
      "npx",
      ["--yes", "vercel", "env", "add", "VERCEL_FORCE_NO_BUILD_CACHE", "production"],
      {
        cwd: join(scratchDir, "storefront"),
        encoding: "utf8",
        timeout: 120_000,
        input: "1\n",
        env: { ...process.env },
      },
    );

    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    // The scratch project sits under tmpdir, outside the repo, so point npm/npx
    // at the suite's shared warm cache exactly as world.runCli does, keeping
    // the spawned CLI's package fetches once-per-suite.
    const pkgCache =
      process.env.HARNESS_PKG_CACHE ?? join(tmpdir(), "jolly-cannon-fodder-pkg-cache");
    const run = spawnSync(
      runtime,
      [join(REPO_ROOT, "src", "index.ts"), "deploy", "--yes", "--json"],
      {
        cwd: scratchDir,
        encoding: "utf8",
        timeout: 900_000,
        env: {
          ...process.env,
          JOLLY_VERCEL_PROJECT: SHARED_DEPLOY_PROJECT,
          npm_config_cache: process.env.npm_config_cache ?? join(pkgCache, "npm-cache"),
          npm_config_store_dir:
            process.env.npm_config_store_dir ?? join(pkgCache, "pnpm-store"),
          // The heal builds rarely (once per store heal), so trade the remote
          // build cache for determinism: a heal build that restored the prior
          // deployment's cache failed `pnpm run build` where the uncached build
          // of the same source and store succeeded. Vercel's own env knob; the
          // production argv stays verbatim.
          VERCEL_FORCE_NO_BUILD_CACHE: "1",
        },
      },
    );
    if (run.error) {
      throw new Error(`shared-deployment heal failed to spawn: ${run.error.message}`);
    }
    const envelope = findEnvelope(run.stdout ?? "");
    // commandStage nests the stage outcome under a key named after the stage:
    // data.deploy.deploymentUrl (src/index.ts commandStage / runDeployStage).
    const stageData = envelope?.data["deploy"] as Record<string, unknown> | undefined;
    const url =
      stageData && typeof stageData["deploymentUrl"] === "string"
        ? (stageData["deploymentUrl"] as string)
        : undefined;
    if (envelope?.status !== "success" || !url) {
      throw new Error(
        `shared-deployment heal did not complete a real deploy ` +
          `(exit ${run.status}, status ${envelope?.status}).\n` +
          `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
      );
    }
    if (!(await deploymentServes(url, 180_000))) {
      throw new Error(
        `shared deployment ${url} did not become reachable within 180s of its deploy`,
      );
    }
    return { project: SHARED_DEPLOY_PROJECT, url, storeEndpoint };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Link a project's storefront/ to the shared Vercel project through the real
 * Vercel CLI, exactly as production links it after a completed deploy
 * (src/index.ts runDeployStage), so the satisfied project carries the same
 * `.vercel/project.json` artifact an earlier completed run leaves.
 */
export function linkStorefrontToSharedProject(
  storefrontDir: string,
  project: string,
): void {
  const link = spawnSync(
    "npx",
    ["--yes", "vercel", "link", "--yes", "--project", project],
    { cwd: storefrontDir, encoding: "utf8", timeout: 120_000, env: { ...process.env } },
  );
  if (link.error || link.status !== 0) {
    throw new Error(
      `failed to link ${storefrontDir} to the shared Vercel project "${project}": ` +
        `${link.error?.message ?? ""}\n${link.stdout ?? ""}\n${link.stderr ?? ""}`,
    );
  }
}
