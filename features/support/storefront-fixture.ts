// Shared PREPARED-STOREFRONT fixture (features 029 + 002 deploy consumers).
//
// The real Paper clone + `pnpm install` is the single most expensive thing a
// deploy scenario needs as a PRECONDITION — a full `git clone` of saleor/storefront
// plus a whole Next.js `pnpm install`. Scenarios that assert the `deploy` stage's
// behaviour do not test the ACT of cloning/installing Paper (feature 029 has a
// dedicated `jolly storefront` scenario for that); they just need a prepared Paper
// tree on disk to deploy. So this fixture builds that tree ONCE per run into a
// persistent TEMPLATE directory and each consumer materializes a private copy of
// it into its own `<projectDir>/storefront`, instead of every deploy scenario
// paying a fresh clone+install.
//
// It mirrors recipe-on-shared.ts's cross-worker conventions: a run-scoped O_EXCL
// lock + state file so exactly one worker builds the template and the rest adopt
// its path; per-worker memo. It is LAZY: triggered only when a consumer calls
// materializePreparedStorefront (029's `jolly deploy` Given, and later the 002
// consumers), never from a Before hook, so light-only runs never pay the build.
//
// What the template contains must MATCH what `jolly storefront` produces on disk
// (src/index.ts runStorefrontStage): a shallow `--depth 1 --branch main` clone of
// https://github.com/saleor/storefront.git, the upstream `.git` stripped and a
// fresh `git init`, package.json's `pnpm.onlyBuiltDependencies` extended with
// Paper's native build deps, and a real `npx --yes pnpm install`. Replicated
// faithfully below so a materialized copy is indistinguishable from a real
// `jolly storefront` clone.
//
// CRITICAL reclaim-sparing: the template dir lives under tmpdir() with a
// jolly-cannon-fodder- prefix, so provision.ts's reclaim loop (which deletes stale
// jolly-cannon-fodder-* local dirs from other runs) WOULD delete it mid-run — the
// template is NOT run-namespaced, exactly like jolly-cannon-fodder-pkg-cache. Its
// name is exported here and spared by EXACT name in that reclaim loop, alongside
// the pkg-cache spare.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeNamespace, runId } from "./sandbox.ts";

/**
 * The FIXED basename of the persistent prepared-storefront template dir under
 * tmpdir(). Not run-namespaced (built once and reused across runs, like the
 * pkg-cache), so provision.ts's tmpdir-reclaim loop MUST spare it by exact name —
 * see reclaimStaleResources. Exported so that spare and this fixture agree on the
 * one string.
 */
export const STOREFRONT_TEMPLATE_DIRNAME = "jolly-cannon-fodder-storefront-template";

/** The persistent template directory path (fixed, cross-run). */
function templateDir(): string {
  return join(tmpdir(), STOREFRONT_TEMPLATE_DIRNAME);
}

/** Filesystem paths every worker of a run agrees on (the run id is shared): a
 * lock so exactly one worker builds the template, and a state file the winner
 * writes with the template path for the rest to read. */
function templateLockPath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-storefront-template.lock`);
}
function templateStatePath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-storefront-template.json`);
}

let ensuring: Promise<string> | undefined;

/** A prepared template is complete only when both the clone (package.json) and
 * the install (node_modules) landed — a partial dir left by a crashed prior build
 * must be rebuilt, never adopted. */
function templateIsComplete(dir: string): boolean {
  return existsSync(join(dir, "package.json")) && existsSync(join(dir, "node_modules"));
}

/**
 * Ensure the prepared-storefront template has been built once this run and return
 * its path. Exactly one worker across the whole run builds it (whoever wins the
 * filesystem lock); every other worker reads the path the winner publishes to the
 * state file. Memoized per worker. LAZY: only the deploy consumers call this (via
 * materializePreparedStorefront), so a run that never deploys never pays the build.
 */
export function ensurePreparedStorefront(): Promise<string> {
  ensuring ??= coordinatePreparedStorefront();
  return ensuring;
}

/**
 * Cross-worker coordination, mirroring recipe-on-shared.ts's
 * coordinateRecipeOnShared. The lock winner builds (or adopts an already-complete)
 * template and publishes its path; the rest wait for the state file and adopt it.
 */
async function coordinatePreparedStorefront(): Promise<string> {
  let owner = false;
  try {
    closeSync(openSync(templateLockPath(), "wx")); // atomic O_EXCL: one winner
    owner = true;
  } catch {
    owner = false;
  }
  if (owner) {
    const dir = buildTemplate();
    writeFileSync(templateStatePath(), JSON.stringify({ dir }));
    return dir;
  }
  const deadline = Date.now() + 900_000;
  for (;;) {
    if (existsSync(templateStatePath())) {
      const state = JSON.parse(readFileSync(templateStatePath(), "utf8")) as { dir: string };
      return state.dir;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "timed out waiting for the prepared-storefront template another worker is building",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Build the prepared-storefront template ONCE, replicating src/index.ts's
 * runStorefrontStage clone+install so the template matches what `jolly storefront`
 * produces on disk. If a complete template already exists (a prior run's, spared
 * from reclaim), adopt it rather than rebuild. Returns the template dir path.
 */
function buildTemplate(): string {
  const dir = templateDir();
  if (templateIsComplete(dir)) return dir;
  // A partial dir from a crashed prior build must not be adopted — start clean.
  rmSync(dir, { recursive: true, force: true });

  // Shallow clone Paper from main — identical git args to runStorefrontStage. The
  // upstream .git is stripped and re-inited below, so --depth 1 loses nothing.
  process.stderr.write(`[storefront-fixture] cloning Saleor Paper into ${dir}\n`);
  const clone = spawnSync(
    "git",
    ["clone", "--depth", "1", "--branch", "main", "https://github.com/saleor/storefront.git", dir],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env } },
  );
  if (clone.error || clone.status !== 0) {
    const reason = clone.error ? clone.error.message : `git clone exited ${clone.status}`;
    const stderr = (clone.stderr ?? "").toString().slice(0, 2000);
    throw new Error(`prepared-storefront template: git clone of Saleor Paper failed: ${reason}.${stderr ? ` ${stderr}` : ""}`);
  }
  // Strip the upstream .git history and initialize a fresh repository.
  rmSync(join(dir, ".git"), { recursive: true, force: true });
  const init = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
  if (init.error || init.status !== 0) {
    throw new Error(
      `prepared-storefront template: git init of the fresh repository failed: ` +
        `${init.error ? init.error.message : `git init exited ${init.status}`}`,
    );
  }

  // Approve Paper's native build scripts in package.json (sharp/esbuild/unrs-resolver),
  // exactly as runStorefrontStage does, so a fresh `pnpm install` builds them.
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  const pnpmCfg = (pkg.pnpm ??= {}) as Record<string, unknown>;
  const approved = new Set(
    (Array.isArray(pnpmCfg.onlyBuiltDependencies) ? pnpmCfg.onlyBuiltDependencies : []) as string[],
  );
  for (const dep of ["sharp", "esbuild", "unrs-resolver"]) approved.add(dep);
  pnpmCfg.onlyBuiltDependencies = [...approved];
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // Install with pnpm via `npx --yes pnpm install` — identical to runStorefrontStage
  // — pointed at the same warm pnpm store / npm cache the other fixtures use so the
  // package fetch cost is paid once across the whole suite.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const pkgCache = process.env.HARNESS_PKG_CACHE ?? join(tmpdir(), "jolly-cannon-fodder-pkg-cache");
  const pnpmStore = join(pkgCache, "pnpm-store");
  const npmCache = join(pkgCache, "npm-cache");
  mkdirSync(pnpmStore, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  if (!env.npm_config_store_dir) env.npm_config_store_dir = pnpmStore;
  if (!env.npm_config_cache) env.npm_config_cache = npmCache;

  process.stderr.write(`[storefront-fixture] installing Paper dependencies in ${dir}\n`);
  const install = spawnSync("npx", ["--yes", "pnpm", "install"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 600_000,
    env,
  });
  if (install.error || install.status !== 0) {
    const reason = install.error ? install.error.message : `npx pnpm install exited ${install.status}`;
    const stderr = (install.stderr ?? "").toString().slice(0, 2000);
    // Leave no partial template behind for the next run to adopt.
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`prepared-storefront template: pnpm install failed: ${reason}.${stderr ? ` ${stderr}` : ""}`);
  }
  return dir;
}

/**
 * Ensure the shared prepared-storefront template exists (building it once per run
 * on first call) and copy it into a consumer's destination storefront directory
 * (the consumer's `<projectDir>/storefront`). A private per-consumer copy, so a
 * scenario's own deploy mutations (Vercel link, .env, git) never touch the shared
 * template. Mirrors what a real `jolly storefront` clone would have left on disk.
 */
export async function materializePreparedStorefront(destStorefrontDir: string): Promise<void> {
  const template = await ensurePreparedStorefront();
  rmSync(destStorefrontDir, { recursive: true, force: true });
  cpSync(template, destStorefrontDir, { recursive: true });
}
