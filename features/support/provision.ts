// Shared Saleor environment provisioning (features 023 + 012).
//
// When a @sandbox scenario needs NEXT_PUBLIC_SALEOR_API_URL /
// SALEOR_TOKEN and they are not configured but
// JOLLY_SALEOR_CLOUD_TOKEN is present, the harness provisions ONE shared
// store per worker — through Jolly's own `create store --create-environment`
// with a STABLE `--name`/`--domain-label` (SHARED_STORE_PREFIX, not a
// per-run id). Jolly's own reuse-by-label logic (feature 012) means a
// healthy store from a PRIOR cucumber invocation is reused rather than
// recreated, cutting the minutes-long create+deploy cost for every run that
// does not itself test store creation. The store is never torn down; it
// persists across invocations by design (see reclaimStaleResources below for
// what DOES get cleaned up, and hooks.ts for why AfterAll no longer touches
// it).
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
import { CleanupRegistry, makeNamespace, runId, workerNamespace, type CleanupFailure } from "./sandbox.ts";
import { REPO_ROOT } from "./repo-root.ts";
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
 * local scratch dir, sparing this run's own namespace and the persistent
 * SHARED_STORE_PREFIX store. This is the harness's own janitor: called once
 * per cucumber invocation from an unconditional BeforeAll (hooks.ts), so
 * leftovers from a crashed/interrupted/killed run are reclaimed proactively —
 * regardless of which tier/tags the NEXT invocation happens to select —
 * rather than only when someone next runs the same tier that leaked them.
 * The jolly-cannon-fodder- prefix is the protection boundary (AGENTS.md
 * "Leftover handling"): only that namespace is ever touched.
 */
export async function reclaimStaleResources(
  token: string = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "",
): Promise<CloudEnvironment[]> {
  if (token.trim() === "") return [];
  const runNamespace = makeNamespace(runId());
  const leftovers = leftoverTestEnvironments(await listAllEnvironments(token), runNamespace);
  for (const env of leftovers) {
    await deleteEnvironment(token, env.org, env.key);
  }
  for (const entry of readdirSync(tmpdir())) {
    if (
      entry.startsWith("jolly-cannon-fodder-") &&
      !entry.startsWith(runNamespace) &&
      entry !== "jolly-cannon-fodder-pkg-cache"
    ) {
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
    }
  }
  return leftovers;
}

/**
 * Create (or, via Jolly's own reuse-by-label logic, feature 012, adopt) the
 * stable-named shared store and derive its runtime values from the scratch
 * project directory's `.env`. Does not probe readiness — callers do that, so
 * a stale cached store's unreachability can be told apart from a fresh
 * create's cold start.
 */
async function createOrReuseSharedStore(
  name: string,
): Promise<{ url: string; token: string }> {
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-`));
  teardownRegistry.register(`scratch directory ${scratchDir}`, () => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";

  // Create-or-reuse, waiting out a transient org environment-limit. Under a
  // parallel run the limit is consumed by sibling workers' live stores, which
  // they tear down as their scenarios finish, freeing a slot. Skip only after
  // the wait budget.
  const limitDeadline = Date.now() + 540_000;
  let envelope: Envelope;
  for (;;) {
    const spawned = spawnSync(
      runtime,
      [
        join(REPO_ROOT, "src", "index.ts"),
        "create",
        "store",
        "--create-environment",
        "--name",
        name,
        "--domain-label",
        name,
        "--json",
      ],
      { cwd: scratchDir, env: { ...process.env }, encoding: "utf8", timeout: 540_000 },
    );
    if (spawned.error) {
      throw new Error(
        `failed to invoke Jolly CLI for shared-store provisioning via "${runtime}": ${spawned.error.message}`,
      );
    }
    const stdout = spawned.stdout ?? "";
    const parsed = findEnvelope(stdout);
    if (!parsed) {
      throw new Error(
        `shared-store provisioning produced no output envelope ` +
          `(exit ${spawned.status}).\nstdout:\n${stdout}\nstderr:\n${spawned.stderr}`,
      );
    }
    const atLimit =
      parsed.status === "error" &&
      parsed.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED");
    if (atLimit && Date.now() < limitDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
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
  // the --name/--domain-label overrides whether it created fresh or reused.
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
  return { url, token: saleorToken };
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
 * The un-memoized provisioning logic: create-or-reuse the stable-named shared
 * store (features 023 + 012) and derive its runtime values. Leftover
 * reclamation is no longer done here — see reclaimStaleResources(), run
 * unconditionally from hooks.ts's BeforeAll. `ensureSharedEnvironment` wraps
 * this once-per-run; the feature 026 @sandbox conformance scenario drives it
 * directly to exercise the provision path fresh, regardless of suite order.
 */
export async function provisionSharedEnvironment(): Promise<ProvisionOutcome> {
  const name = SHARED_STORE_PREFIX;

  // Reclaim here too (not just from hooks.ts's BeforeAll): this function is
  // also driven directly by the feature 026 conformance scenario to exercise
  // the provision path fresh regardless of suite order, so reclaiming must be
  // an observable effect of provisioning itself, not only of having started
  // this cucumber invocation.
  await reclaimStaleResources();

  let { url, token: saleorToken } = await createOrReuseSharedStore(name);
  process.env["NEXT_PUBLIC_SALEOR_API_URL"] = url;
  process.env["SALEOR_TOKEN"] = saleorToken;

  if (await waitForReady(url, 180_000)) return { status: "ready" };

  // The cached store never became reachable — treat it as broken rather than
  // merely cold, delete it, and provision fresh once under the same stable
  // name. A store that still isn't reachable after recreating is a real
  // fault, not a stale cache, so it throws.
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";
  const stale = (await listAllEnvironments(cloudToken)).find((env) => env.name === name);
  if (stale) await deleteEnvironment(cloudToken, stale.org, stale.key);

  ({ url, token: saleorToken } = await createOrReuseSharedStore(name));
  process.env["NEXT_PUBLIC_SALEOR_API_URL"] = url;
  process.env["SALEOR_TOKEN"] = saleorToken;

  if (await waitForReady(url, 180_000)) return { status: "ready" };
  throw new Error(
    `provisioned store ${url} did not become reachable within 180s, even after ` +
      `recreating the cached shared store (cold-start readiness budget exceeded)`,
  );
}
