// Sandbox-tier machinery (feature 023): a unique per-run namespace for every
// created resource, an idempotent best-effort LIFO cleanup registry, and the
// Vercel project + account helpers the deploy scenarios use.
//
// Credentials for every tier are present by fitting-out; the underlying CLIs and
// API clients read them from the environment. Assume they are present — the
// harness reads real service identity only where a scenario asserts it.
//
// Harness-internal knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_RUN_ID       — override the generated per-run identifier
//   HARNESS_CLI_RUNTIME  — runtime used to invoke the CLI (default "node",
//                          native Node >= 23 with type stripping)
import { spawnSync } from "node:child_process";

/**
 * The logged-in Vercel account reported by `npx vercel whoami` (the last
 * non-empty stdout line, trimmed). Read-only identity probe; used to assert
 * doctor's vercel-auth check names the real account.
 */
export function vercelWhoamiAccount(): string {
  const result = spawnSync("npx", ["vercel", "whoami"], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines[lines.length - 1]! : "";
}

/**
 * Pre-create a `jolly-cannon-fodder`-namespaced Vercel project so the deploy stage's
 * `vercel deploy --project <name>` targets it (the CLI's `--project` requires an
 * existing project). Best-effort and never throws; an already-existing project is
 * a no-op. Goes through the official Vercel CLI under its own session — never
 * api.vercel.com.
 */
export function addVercelProject(name: string): void {
  try {
    spawnSync("npx", ["vercel", "project", "add", name], {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // best-effort
  }
}

/**
 * Best-effort teardown of a `jolly-cannon-fodder`-namespaced Vercel project a deploy
 * created (harmless-by-design: every created resource is namespaced and removed,
 * AGENTS.md). `vercel project remove` prompts "Are you sure?" with no skip flag,
 * so answer it via stdin. Goes through the official Vercel CLI under its own
 * session — never api.vercel.com. Idempotent and never throws.
 */
export function removeVercelProject(name: string): void {
  try {
    spawnSync("npx", ["vercel", "project", "remove", name], {
      input: "y\n",
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // best-effort
  }
}

let processRunId: string | undefined;

/**
 * The per-run identifier: HARNESS_RUN_ID when set, otherwise generated once
 * per test process. Created resources embed it so repeated and parallel runs
 * never collide and leaked resources are attributable to a run.
 */
export function runId(): string {
  const override = process.env.HARNESS_RUN_ID;
  if (override !== undefined && override.trim() !== "") return override.trim();
  if (processRunId === undefined) {
    processRunId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
  return processRunId;
}

/** Namespace prefix for every resource a test run creates. */
export function makeNamespace(id: string = runId()): string {
  return `jolly-cannon-fodder-${id}`;
}

/**
 * The cucumber parallel worker id (`CUCUMBER_WORKER_ID`), or "0" in a
 * single-worker run. Each parallel worker namespaces its own shared sandbox
 * environment by this id on top of the run id, so concurrent workers never
 * share or reclaim each other's live store (cucumber.js sandbox profile).
 */
export function workerId(): string {
  const id = process.env.CUCUMBER_WORKER_ID;
  return id !== undefined && id.trim() !== "" ? id.trim() : "0";
}

/**
 * The per-worker resource namespace: the run namespace with the worker id
 * appended. Every parallel worker derives its own isolated namespace, so no two
 * workers share the Saleor environment they provision or the Vercel project they
 * deploy to (AGENTS.md "Sandbox harness mechanics" per-worker isolation). The
 * jolly-cannon-fodder- prefix is preserved, so every derived name stays this
 * dedicated test org's disposable, reclaimable cannon fodder.
 */
export function workerNamespace(id: string = workerId()): string {
  return `${makeNamespace(runId())}-w${id}`;
}

export interface CleanupFailure {
  description: string;
  error: string;
}

/**
 * LIFO, idempotent, best-effort teardown. Each sandbox creation registers a
 * cleanup; runAll() pops in reverse order, never throws, and returns what it
 * could not remove so the hook can report it by namespaced identifier.
 */
export class CleanupRegistry {
  private entries: Array<{ description: string; fn: () => void | Promise<void> }> =
    [];

  register(description: string, fn: () => void | Promise<void>): void {
    this.entries.push({ description, fn });
  }

  get size(): number {
    return this.entries.length;
  }

  /** The registered descriptions, for assertions that teardown is armed. */
  get descriptions(): string[] {
    return this.entries.map((entry) => entry.description);
  }

  async runAll(): Promise<CleanupFailure[]> {
    const failures: CleanupFailure[] = [];
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      try {
        await entry.fn();
      } catch (error) {
        failures.push({
          description: entry.description,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }
}
