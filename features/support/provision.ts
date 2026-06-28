// Shared per-run Saleor environment provisioning (features 023 + 012).
//
// When a @sandbox scenario needs NEXT_PUBLIC_SALEOR_API_URL /
// SALEOR_TOKEN and they are not configured but
// JOLLY_SALEOR_CLOUD_TOKEN is present, the harness provisions ONE shared
// environment for the whole run — through Jolly's own
// `create store --create-environment` with the `--name`/`--domain-label`
// overrides carrying the per-run jolly-test namespace — derives both values
// from it, and tears it down when the run ends (AfterAll in hooks.ts).
//
// Leftover jolly-test environments from previous runs are RECLAIMED before
// creating, never skipped: the jolly-test- prefix is the protection boundary
// (AGENTS.md "Leftover handling"), so they are this dedicated test org's
// disposable resources and are deleted freely to free capacity.
//
// Skip-not-fail stays only for what cannot be derived or produced harmlessly:
//   - ENVIRONMENT_LIMIT_REACHED that reclamation could not clear (genuine
//     non-jolly-test capacity the harness must never delete)
// Any other provisioning failure is a real failure and throws.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteEnvironment, listAllEnvironments } from "./cloud.ts";
import { findEnvelope } from "./envelope.ts";
import { CleanupRegistry, makeNamespace, runId, type CleanupFailure } from "./sandbox.ts";
import { REPO_ROOT } from "./world.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";

export type ProvisionOutcome =
  | { status: "ready" }
  | { status: "skip"; reason: string };

/** Name and domain label of the run's shared environment. */
export function sharedEnvironmentName(): string {
  return `${makeNamespace(runId())}-shared`;
}

const teardownRegistry = new CleanupRegistry();
let provisioning: Promise<ProvisionOutcome> | undefined;

/**
 * Provision the shared environment exactly once per run (lazy: only the
 * first scenario that actually needs a derived endpoint pays for it) and
 * export the derived values into process.env for the rest of the run.
 */
export function ensureSharedEnvironment(): Promise<ProvisionOutcome> {
  provisioning ??= provisionSharedEnvironment();
  return provisioning;
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
 * The un-memoized provisioning logic: reclaim leftover jolly-test environments,
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

  // Reclaim leftover jolly-test environments before creating, instead of
  // skipping: they consume capacity and can block creation, and the jolly-test-
  // prefix positively marks them as this dedicated test org's disposable
  // resources (AGENTS.md "Leftover handling"). Delete them freely to free
  // capacity; an environment lacking the prefix is never touched.
  const before = await listAllEnvironments(cloudToken);
  for (const env of before) {
    if (env.name.startsWith("jolly-test-")) {
      await deleteEnvironment(cloudToken, env.org, env.key);
    }
  }

  // Catch-all teardown registered BEFORE the CLI can create anything: if the
  // run dies without an envelope (timeout, crash), a diff against this
  // snapshot still finds and deletes whatever this run created — and only
  // jolly-test environments of THIS run, never a pre-existing resource.
  const snapshot = new Set(before.map((env) => env.key));
  const runNamespace = makeNamespace(runId());
  teardownRegistry.register(
    "shared Saleor Cloud environment (catch-all diff vs pre-provisioning snapshot)",
    async () => {
      for (const env of await listAllEnvironments(cloudToken)) {
        if (!snapshot.has(env.key) && env.name.startsWith(runNamespace)) {
          await deleteEnvironment(cloudToken, env.org, env.key);
        }
      }
    },
  );

  // Scratch project directory: the CLI writes the derived values to its
  // .env. Kept (and removed in teardown) rather than scenario-scoped — the
  // environment is shared by the whole run.
  const scratchDir = mkdtempSync(join(tmpdir(), `${sharedEnvironmentName()}-`));
  teardownRegistry.register(`scratch directory ${scratchDir}`, () => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const name = sharedEnvironmentName();
  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
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
  const envelope = findEnvelope(stdout);
  if (!envelope) {
    throw new Error(
      `shared-environment provisioning produced no output envelope ` +
        `(exit ${spawned.status}).\nstdout:\n${stdout}\nstderr:\n${spawned.stderr}`,
    );
  }

  // Precise teardown for the reported environment (LIFO: runs before the
  // catch-all diff, which then finds nothing left).
  const data = envelope.data;
  if (
    typeof data.organizationSlug === "string" &&
    typeof data.environmentKey === "string"
  ) {
    const org = data.organizationSlug;
    const key = data.environmentKey;
    teardownRegistry.register(
      `shared Saleor Cloud environment ${org}/${key}`,
      () => deleteEnvironment(cloudToken, org, key),
    );
  }

  if (
    envelope.status === "error" &&
    envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
  ) {
    return {
      status: "skip",
      reason:
        "Cloud API rejected environment creation with ENVIRONMENT_LIMIT_REACHED " +
        "(organization sandbox limit). Delete an unused environment or upgrade " +
        "the plan to run these scenarios.",
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
