// Shared per-run Saleor environment provisioning (features 023 + 012).
//
// When a @sandbox scenario needs NEXT_PUBLIC_SALEOR_API_URL /
// SALEOR_TOKEN and they are not configured but
// JOLLY_SALEOR_CLOUD_TOKEN is present, the harness provisions ONE shared
// environment for the whole run — through Jolly's own
// `create store --create-environment` with the `--name`/`--domain-label`
// overrides carrying the per-run jolly-cannon-fodder namespace — derives both values
// from it, and tears it down when the run ends (AfterAll in hooks.ts).
//
// Leftover jolly-cannon-fodder environments from previous runs are RECLAIMED before
// creating, never skipped: the jolly-cannon-fodder- prefix is the protection boundary
// (AGENTS.md "Leftover handling"), so they are this dedicated test org's
// disposable resources and are deleted freely to free capacity.
//
// Skip-not-fail stays only for what cannot be derived or produced harmlessly:
//   - ENVIRONMENT_LIMIT_REACHED that reclamation could not clear (genuine
//     non-jolly-cannon-fodder capacity the harness must never delete)
// Any other provisioning failure is a real failure and throws.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteEnvironment, listAllEnvironments } from "./cloud.ts";
import { findEnvelope, type Envelope } from "./envelope.ts";
import { CleanupRegistry, makeNamespace, runId, workerNamespace, type CleanupFailure } from "./sandbox.ts";
import { REPO_ROOT } from "./world.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";

export type ProvisionOutcome =
  | { status: "ready" }
  | { status: "skip"; reason: string };

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
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  if (!cloudToken || cloudToken.trim() === "") {
    return { status: "skip", reason: "missing JOLLY_SALEOR_CLOUD_TOKEN" };
  }
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
      JSON.stringify(
        outcome.status === "ready"
          ? {
              status: "ready",
              url: process.env["NEXT_PUBLIC_SALEOR_API_URL"],
              token: process.env["SALEOR_TOKEN"],
            }
          : outcome,
      ),
    );
    return outcome;
  }
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (existsSync(sharedStatePath())) {
      const state = JSON.parse(readFileSync(sharedStatePath(), "utf8")) as
        | { status: "ready"; url: string; token: string }
        | { status: "skip"; reason: string };
      if (state.status === "skip") return { status: "skip", reason: state.reason };
      process.env["NEXT_PUBLIC_SALEOR_API_URL"] = state.url;
      process.env["SALEOR_TOKEN"] = state.token;
      return { status: "ready" };
    }
    if (Date.now() >= deadline) {
      return {
        status: "skip",
        reason: "timed out waiting for the shared environment another worker is provisioning",
      };
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
 * The un-memoized provisioning logic: reclaim leftover jolly-cannon-fodder environments,
 * then create the run's shared environment and derive its runtime values.
 * `ensureSharedEnvironment` wraps this once-per-run; the feature 026 @sandbox
 * conformance scenario drives it directly to exercise the provision path fresh,
 * regardless of suite order.
 */
export async function provisionSharedEnvironment(): Promise<ProvisionOutcome> {
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  if (!cloudToken || cloudToken.trim() === "") {
    // Callers gate on the Cloud token before calling; this is a backstop.
    return { status: "skip", reason: "missing JOLLY_SALEOR_CLOUD_TOKEN" };
  }

  // Reclaim every OTHER run's jolly-cannon-fodder environments before creating.
  // They are this dedicated test org's disposable cannon fodder, positively
  // marked by the jolly-cannon-fodder- prefix (AGENTS.md "Leftover handling"),
  // so ownership is irrelevant and they are deleted freely to free capacity —
  // this reclaim IS the run's teardown. Nothing tears the shared store down
  // mid-run (that would race a sibling worker, since cucumber's AfterAll runs
  // per worker), so a later run wipes the slate. The current run's namespace is
  // spared so the reclaim never deletes the live store this run is using; an
  // environment lacking the prefix is never touched.
  const runNamespace = makeNamespace(runId());
  const before = await listAllEnvironments(cloudToken);
  for (const env of before) {
    if (env.name.startsWith("jolly-cannon-fodder-") && !env.name.startsWith(runNamespace)) {
      await deleteEnvironment(cloudToken, env.org, env.key);
    }
  }

  // Reclaim leaked LOCAL scratch dirs from other runs the same way. The
  // per-scenario temp dirs (world.ts newTempDir) are jolly-cannon-fodder-<run>
  // namespaced and removed in teardown, but a crashed or cut-off teardown leaks
  // them until they fill the disk (ENOSPC). Delete every jolly-cannon-fodder tmp
  // entry outside this run's namespace, sparing the shared package cache. Mirrors
  // the Cloud reclaim: a later run wipes what a crash left behind.
  for (const entry of readdirSync(tmpdir())) {
    if (
      entry.startsWith("jolly-cannon-fodder-") &&
      !entry.startsWith(runNamespace) &&
      entry !== "jolly-cannon-fodder-pkg-cache"
    ) {
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
    }
  }

  // Scratch project directory: the CLI writes the derived values to its
  // .env. Kept (and removed in teardown) rather than scenario-scoped — the
  // environment is shared by the whole run.
  const scratchDir = mkdtempSync(join(tmpdir(), `${workerNamespace()}-`));
  teardownRegistry.register(`scratch directory ${scratchDir}`, () => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const name = workerNamespace();
  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";

  // Create the environment, waiting out a transient org environment-limit. Under
  // a parallel run the limit is consumed by sibling workers' live stores, which
  // they tear down as their scenarios finish, freeing a slot. Run-scoped
  // reclamation never deletes a sibling's live store, so capacity is recovered by
  // waiting and retrying, not by deleting. Skip only after the wait budget.
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
        `failed to invoke Jolly CLI for shared-environment provisioning via "${runtime}": ${spawned.error.message}`,
      );
    }
    const stdout = spawned.stdout ?? "";
    const parsed = findEnvelope(stdout);
    if (!parsed) {
      throw new Error(
        `shared-environment provisioning produced no output envelope ` +
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

  // No teardown is registered for the shared store: tearing it down would run in
  // a per-worker AfterAll and could delete the store while a sibling worker is
  // still using it. The store is reclaimed by the next run's delete-every-other-
  // run's-cannon-fodder pass above, so teardown effectively happens after all
  // tiers, by construction.
  const data = envelope.data;

  if (
    envelope.status === "error" &&
    envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
  ) {
    return {
      status: "skip",
      reason:
        "Cloud API still rejected environment creation with ENVIRONMENT_LIMIT_REACHED " +
        "after waiting for a sibling worker to free a slot (organization sandbox " +
        "limit). Raise the org's environment limit or lower the sandbox worker count.",
    };
  }
  if (envelope.status !== "success") {
    throw new Error(
      `shared-environment provisioning failed: ${envelope.summary}\n` +
        JSON.stringify(envelope.errors),
    );
  }

  // The created environment must be positively identifiable as this run's:
  // Jolly must have honored the --name/--domain-label overrides.
  if (data.environmentName !== name) {
    throw new Error(
      `provisioned environment does not carry the per-run namespace: ` +
        `expected name "${name}", got "${data.environmentName}" — ` +
        `jolly create store --create-environment must honor --name/--domain-label`,
    );
  }

  // Derive the runtime values for the whole run from the CLI's .env.
  const values = loadEnvValues(scratchDir);
  const url = values["NEXT_PUBLIC_SALEOR_API_URL"];
  const saleorToken = values["SALEOR_TOKEN"];
  if (!url || !saleorToken) {
    throw new Error(
      "shared-environment provisioning did not yield both " +
        "NEXT_PUBLIC_SALEOR_API_URL and SALEOR_TOKEN in .env",
    );
  }
  process.env["NEXT_PUBLIC_SALEOR_API_URL"] = url;
  process.env["SALEOR_TOKEN"] = saleorToken;
  return { status: "ready" };
}
