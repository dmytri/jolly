// Shared Saleor environment provisioning (features 023 + 012).
//
// When a @sandbox scenario needs NEXT_PUBLIC_SALEOR_API_URL /
// SALEOR_TOKEN and they are not configured but
// JOLLY_SALEOR_CLOUD_TOKEN is present, the harness provisions ONE shared
// store and caches it ACROSS cucumber invocations (not just within a run) via
// a persistent marker file (sharedStoreMarkerPath), so a run that doesn't
// itself test store creation skips the minutes-long create+deploy cost.
//
// The store's name is NOT a fixed, human-readable string: *.saleor.cloud
// domain labels turned out to be namespaced more broadly than this org's own
// environment list (creating "jolly-cannon-fodder-shared" failed
// DOMAIN_LABEL_TAKEN even though GET .../environments/ showed zero
// environments — some other collision, possibly platform-wide, made the
// literal string unusable). So each store this harness creates gets a fresh
// SHARED_STORE_PREFIX-<random> name (guaranteed available, same as the
// original per-run design), and the marker file remembers THAT specific
// store's name/url/token so the next invocation can find and reuse it by
// probing reachability, rather than recreating one under a name it already
// knows. The store is never torn down by AfterAll; it persists by design
// (see reclaimStaleResources below for what DOES get cleaned up, and hooks.ts
// for why AfterAll no longer touches it) — replaced only when the marker's
// store is gone or unreachable.
//
// Reclaiming leftovers from crashed/interrupted runs is a separate, PROACTIVE
// concern handled by reclaimStaleResources(), invoked once from an
// unconditional BeforeAll (hooks.ts) regardless of which tier/tags a given
// cucumber invocation selects — so leftovers from a run that only ever
// exercised one tier don't silently survive until someone happens to run a
// different tier later. The jolly-cannon-fodder- prefix is the protection
// boundary (AGENTS.md "Leftover handling"); SHARED_STORE_PREFIX is carved out
// of that reclaim so the persistent store is never mistaken for a leftover.
//
// Every provisioning failure is a real failure and throws, so a run that cannot
// stand up its store surfaces the fault loudly. The Cloud token is present by
// fitting-out; the provisioner reads it from the environment.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
  SHARED_STORE_PREFIX,
  type CloudEnvironment,
} from "./cloud.ts";
import { findEnvelope, type Envelope } from "./envelope.ts";
import { createEnvironment, type CliRunner } from "./env-factory.ts";
import { CleanupRegistry, makeNamespace, runId, workerNamespace, type CleanupFailure } from "./sandbox.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { STOREFRONT_TEMPLATE_DIRNAME } from "./storefront-fixture.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { probeEndpointConnectivity } from "../../src/lib/cloud-api.ts";

export type ProvisionOutcome = { status: "ready" };

/** Filesystem paths every worker of a run agrees on (the run id is shared): a
 * lock so exactly one worker provisions, and a state file the winner writes with
 * the derived values for the rest to read. */
function sharedLockPath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-shared-env.lock`);
}
function sharedStatePath(): string {
  return join(tmpdir(), `${makeNamespace(runId())}-shared-env.json`);
}

const teardownRegistry = new CleanupRegistry();
let provisioning: Promise<ProvisionOutcome> | undefined;

/**
 * Ensure the run's ONE shared environment exists and export its derived values
 * into this worker's process.env. Exactly one worker across the whole run
 * provisions it (whoever wins the filesystem lock); every other worker reads the
 * derived values the winner publishes to the state file. Memoized per worker.
 */
export function ensureSharedEnvironment(): Promise<ProvisionOutcome> {
  provisioning ??= coordinateSharedEnvironment();
  return provisioning;
}

/**
 * Cross-worker coordination. Cucumber runs each parallel worker in its own child
 * process, so an in-memory memo cannot be shared; the lock and state files are
 * keyed on the shared run id, so all workers agree on their paths. The lock
 * winner provisions the single shared store and publishes its derived values;
 * the rest wait for the state file and adopt them.
 */
async function coordinateSharedEnvironment(): Promise<ProvisionOutcome> {
  let owner = false;
  try {
    closeSync(openSync(sharedLockPath(), "wx")); // atomic O_EXCL: one winner
    owner = true;
  } catch {
    owner = false;
  }
  if (owner) {
    const outcome = await provisionSharedEnvironment();
    writeFileSync(
      sharedStatePath(),
      JSON.stringify({
        status: "ready",
        url: process.env["NEXT_PUBLIC_SALEOR_API_URL"],
        token: process.env["SALEOR_TOKEN"],
      }),
    );
    return outcome;
  }
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (existsSync(sharedStatePath())) {
      const state = JSON.parse(readFileSync(sharedStatePath(), "utf8")) as {
        status: "ready";
        url: string;
        token: string;
      };
      process.env["NEXT_PUBLIC_SALEOR_API_URL"] = state.url;
      process.env["SALEOR_TOKEN"] = state.token;
      return { status: "ready" };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "timed out waiting for the shared environment another worker is provisioning",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** The derived SALEOR_TOKEN value, for per-scenario secret tracking. */
export function derivedSecrets(): string[] {
  const token = process.env["SALEOR_TOKEN"];
  return token && token.trim() !== "" ? [token] : [];
}

/**
 * Tear down whatever provisioning created (the environment, the scratch
 * project directory holding its .env). Idempotent and best-effort; the
 * AfterAll hook reports anything that could not be removed.
 */
export async function teardownSharedEnvironment(): Promise<CleanupFailure[]> {
  return teardownRegistry.runAll();
}

/**
 * Delete every OTHER run's jolly-cannon-fodder-namespaced Cloud environment and
 * local scratch dir, sparing this run's own namespace and — by EXACT name,
 * not by prefix — the one shared store the current marker file names. This
 * is the harness's own janitor: called once per cucumber invocation from an
 * unconditional BeforeAll (hooks.ts), so leftovers from a crashed/
 * interrupted/killed run are reclaimed proactively — regardless of which
 * tier/tags the NEXT invocation happens to select — rather than only when
 * someone next runs the same tier that leaked them. The jolly-cannon-fodder-
 * prefix is the protection boundary (AGENTS.md "Leftover handling"): only
 * that namespace is ever touched. An earlier design exempted the whole
 * SHARED_STORE_PREFIX from reclaim, which meant an orphaned FORMER shared
 * store (superseded by self-heal, or a race between overlapping invocations)
 * could never be reclaimed and would silently accumulate, consuming the
 * org's sandbox cap exactly like the leak this function exists to prevent.
 */
/**
 * The exact current name of the ONE long-lived cross-run cached store this org
 * keeps alive: the primary shared store (provision marker). Every
 * leftover-reclaim and leftover-assertion path spares this set by EXACT name, so
 * the run's own live cached store is never misread as a previous-run leftover and
 * deleted. An orphaned FORMER shared store — its name changed by self-heal — is
 * absent from this set and stays reclaimable by the jolly-cannon-fodder- prefix.
 * The starter recipe is now deployed ONTO this same shared store
 * (recipe-on-shared.ts), so there is no longer a separate recipe store to spare —
 * one persistent env serves both roles, leaving the org's slots for @creates-env.
 */
export function cachedStoreSpareNames(): Set<string> {
  const spareNames = new Set<string>();
  const shared = readSharedStoreMarker();
  if (shared) spareNames.add(shared.name);
  return spareNames;
}

export async function reclaimStaleResources(
  token: string = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "",
): Promise<CloudEnvironment[]> {
  if (token.trim() === "") return [];
  const runNamespace = makeNamespace(runId());
  const spareNames = cachedStoreSpareNames();
  const leftovers = leftoverTestEnvironments(
    await listAllEnvironments(token),
    runNamespace,
    spareNames,
  );
  for (const env of leftovers) {
    await deleteEnvironment(token, env.org, env.key);
  }
  for (const entry of readdirSync(tmpdir())) {
    if (
      entry.startsWith("jolly-cannon-fodder-") &&
      !entry.startsWith(runNamespace) &&
      entry !== "jolly-cannon-fodder-pkg-cache" &&
      entry !== STOREFRONT_TEMPLATE_DIRNAME
    ) {
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
    }
  }
  return leftovers;
}

/** The persistent cross-invocation marker recording the last known-good
 * shared store, independent of any single run's id so a LATER invocation can
 * find it. Lives in tmpdir alongside the run-scoped lock/state files but
 * carries no run id in its own path. */
function sharedStoreMarkerPath(): string {
  return join(tmpdir(), "jolly-cannon-fodder-shared-store-marker.json");
}

interface SharedStoreMarker {
  org: string;
  key: string;
  name: string;
  url: string;
  token: string;
}

export function readSharedStoreMarker(): SharedStoreMarker | undefined {
  try {
    return JSON.parse(readFileSync(sharedStoreMarkerPath(), "utf8")) as SharedStoreMarker;
  } catch {
    return undefined;
  }
}

function writeSharedStoreMarker(marker: SharedStoreMarker): void {
  writeFileSync(sharedStoreMarkerPath(), JSON.stringify(marker));
}

/** A fresh name guaranteed not to collide with an existing domain label (the
 * fixed SHARED_STORE_PREFIX string alone was not enough — see the file-level
 * comment). Still exempted from generic leftover reclaim by its prefix. */
function freshSharedStoreName(): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${SHARED_STORE_PREFIX}-${suffix}`;
}

/**
 * Create a NEW shared store, starting from the given name but minting ANOTHER
 * fresh one on a domain-label collision (rare — see freshSharedStoreName —
 * but a collision on a name we just picked is never a genuine conflict with a
 * live resource of ours worth waiting out, unlike ENVIRONMENT_LIMIT_REACHED,
 * so retry with a different name rather than backing off on the same one).
 * Derives runtime values from the scratch project directory's `.env`. Does
 * not probe readiness — callers do that, so a stale cached store's
 * unreachability can be told apart from a fresh create's cold start.
 */
async function createSharedStore(
  initialName: string,
): Promise<{ name: string; org: string; key: string; url: string; token: string }> {
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-`));
  teardownRegistry.register(`scratch directory ${scratchDir}`, () => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";

  // Spawn the Jolly CLI in the scratch project directory. The create-store
  // argument shape and the ENVIRONMENT_LIMIT_REACHED wait-out flow live in the
  // env-factory seam; this runner supplies only the spawn mechanism (a
  // standalone spawnSync, since shared-store provisioning runs outside a
  // scenario World).
  const run: CliRunner = (args) => {
    const spawned = spawnSync(
      runtime,
      [join(REPO_ROOT, "src", "index.ts"), ...args],
      { cwd: scratchDir, env: { ...process.env }, encoding: "utf8", timeout: 540_000 },
    );
    if (spawned.error) {
      throw new Error(
        `failed to invoke Jolly CLI for shared-store provisioning via "${runtime}": ${spawned.error.message}`,
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

  // Waiting out ENVIRONMENT_LIMIT_REACHED (under a parallel run a sibling worker
  // frees a slot) is the seam's job, given the 540s budget. A DOMAIN_LABEL_TAKEN
  // collision on a name we just minted is never a genuine conflict with a live
  // resource worth waiting out, so mint a fresh name and retry immediately
  // (bounded attempts, not a time budget) here at the caller.
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
        `shared-store provisioning produced no output envelope ` +
          `(exit ${result.exitCode}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    const labelTaken =
      parsed.status === "error" &&
      parsed.errors.some((e) => e.code === "DOMAIN_LABEL_TAKEN");
    if (labelTaken && labelAttempts < 5) {
      labelAttempts++;
      name = freshSharedStoreName();
      continue;
    }
    envelope = parsed;
    break;
  }

  if (
    envelope.status === "error" &&
    envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
  ) {
    throw new Error(
      "Cloud API still rejected store creation with ENVIRONMENT_LIMIT_REACHED " +
        "after waiting for a sibling worker to free a slot (organization sandbox " +
        "limit). Raise the org's environment limit or lower the sandbox worker count.",
    );
  }
  if (envelope.status !== "success") {
    throw new Error(
      `shared-store provisioning failed: ${envelope.summary}\n` +
        JSON.stringify(envelope.errors),
    );
  }

  // The environment must be positively identifiable: Jolly must have honored
  // the --name/--domain-label overrides.
  if (envelope.data.environmentName !== name) {
    throw new Error(
      `provisioned environment does not carry the configured name: ` +
        `expected "${name}", got "${envelope.data.environmentName}" — ` +
        `jolly create store --create-environment must honor --name/--domain-label`,
    );
  }

  const values = loadEnvValues(scratchDir);
  const url = values["NEXT_PUBLIC_SALEOR_API_URL"];
  const saleorToken = values["SALEOR_TOKEN"];
  if (!url || !saleorToken) {
    throw new Error(
      "shared-store provisioning did not yield both " +
        "NEXT_PUBLIC_SALEOR_API_URL and SALEOR_TOKEN in .env",
    );
  }
  const org = typeof envelope.data.organization === "string" ? envelope.data.organization : "";
  const key = typeof envelope.data.environmentKey === "string" ? envelope.data.environmentKey : "";
  return { name, org, key, url, token: saleorToken };
}

/** Poll until the store's GraphQL endpoint actually serves, or return false
 * having waited out the budget. A freshly created store's platform task
 * reporting SUCCEEDED means the environment RECORD exists, not that its
 * instance is serving yet (cold start); a cached store from a prior
 * invocation should normally answer immediately. */
async function waitForReady(url: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await probeEndpointConnectivity(url)).kind === "reachable") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

/**
 * The un-memoized provisioning logic: adopt the marker's cached shared store
 * if it's still reachable, otherwise create a fresh one and cache it for the
 * NEXT invocation (features 023 + 012). Leftover reclamation is no longer
 * done here — see reclaimStaleResources(), run unconditionally from
 * hooks.ts's BeforeAll. `ensureSharedEnvironment` wraps this once-per-run;
 * the feature 026 @sandbox conformance scenario drives it directly to
 * exercise the provision path fresh, regardless of suite order.
 */
export async function provisionSharedEnvironment(): Promise<ProvisionOutcome> {
  // Reclaim here too (not just from hooks.ts's BeforeAll): this function is
  // also driven directly by the feature 026 conformance scenario to exercise
  // the provision path fresh regardless of suite order, so reclaiming must be
  // an observable effect of provisioning itself, not only of having started
  // this cucumber invocation.
  await reclaimStaleResources();

  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";
  const marker = readSharedStoreMarker();
  if (marker && (await probeEndpointConnectivity(marker.url)).kind === "reachable") {
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] = marker.url;
    process.env["SALEOR_TOKEN"] = marker.token;
    return { status: "ready" };
  }
  // The marker is absent, or its store is gone/unreachable — best-effort
  // clean it up (deleteEnvironment 404s harmlessly if it's already gone)
  // before replacing it, so a broken cached store never lingers occupying a
  // sandbox slot.
  if (marker) {
    try {
      await deleteEnvironment(cloudToken, marker.org, marker.key);
    } catch {
      // Best-effort: the replacement below is what matters.
    }
  }

  const created = await createSharedStore(freshSharedStoreName());
  process.env["NEXT_PUBLIC_SALEOR_API_URL"] = created.url;
  process.env["SALEOR_TOKEN"] = created.token;

  // 600s: matches src/index.ts's own store readiness gate — real cold starts
  // have been observed to occasionally exceed both 180s and 300s, especially
  // when several environments are provisioned in quick succession.
  if (!(await waitForReady(created.url, 600_000))) {
    throw new Error(
      `provisioned store ${created.url} did not become reachable within 600s ` +
        `(cold-start readiness budget exceeded)`,
    );
  }

  writeSharedStoreMarker({
    org: created.org,
    key: created.key,
    name: created.name,
    url: created.url,
    token: created.token,
  });
  return { status: "ready" };
}
