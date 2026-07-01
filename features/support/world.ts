// Cucumber world: per-scenario state, the CLI invocation seam, temp project
// directories, secret tracking, and the per-run namespace + cleanup registry
// (feature 023).
import { World, setWorldConstructor, type IWorldOptions } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findEnvelope,
  assertEnvelopeShape,
  type Envelope,
} from "./envelope.ts";
import { CleanupRegistry, makeNamespace, runId, workerId } from "./sandbox.ts";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

// A warm, shared pnpm store + npm/npx download cache across all scenarios. A real
// `pnpm install` hardlinks from the content-addressable store (and `npx pnpm`
// reuses its download) instead of re-fetching per scenario — the storefront
// clone+install tail is the suite's biggest cost. Decoupled from the per-scenario
// XDG_DATA_HOME the Vercel-auth scenarios isolate; the store is immutable and
// concurrency-safe, so sharing across parallel workers is fine. Real downloads,
// shared — NOT a mock. Override the location with HARNESS_PKG_CACHE.
const SHARED_PKG_CACHE = process.env.HARNESS_PKG_CACHE ?? join(tmpdir(), "jolly-test-pkg-cache");
const SHARED_PNPM_STORE = join(SHARED_PKG_CACHE, "pnpm-store");
const SHARED_NPM_CACHE = join(SHARED_PKG_CACHE, "npm-cache");
mkdirSync(SHARED_PNPM_STORE, { recursive: true });
mkdirSync(SHARED_NPM_CACHE, { recursive: true });

let worldCounter = 0;

export interface CliResult {
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  envelope?: Envelope;
}

export interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Text piped to the CLI's stdin (for commands that read interactive input). */
  input?: string;
}

export class JollyWorld extends World {
  /** Unique per-run identifier shared by all scenarios in this process. */
  readonly runId = runId();
  /** Namespace for every resource this scenario creates (collision-free). */
  readonly namespace: string;
  readonly cleanup = new CleanupRegistry();
  /** Secret values observed by this scenario; output must never echo them. */
  readonly secrets = new Set<string>();
  /** Free-form scratch state shared between steps of one scenario. */
  readonly notes: Record<string, unknown> = {};

  lastRun?: CliResult;
  previousRun?: CliResult;

  private projectDirPath?: string;

  constructor(options: IWorldOptions) {
    super(options);
    // The worker id keeps namespaces unique across parallel workers: the run id
    // is shared by every worker (cucumber.js), so the per-process counter alone
    // would collide between workers (both start at 1).
    this.namespace = `${makeNamespace(this.runId)}-w${workerId()}-${++worldCounter}`;
    for (const name of Object.keys(process.env)) {
      if (/^JOLLY_.*(TOKEN|SECRET|KEY|PASSWORD)/.test(name)) {
        const value = process.env[name];
        if (value && value.trim() !== "") this.secrets.add(value);
      }
    }
  }

  /** Scenario-scoped temp project directory (created lazily, removed in teardown). */
  get projectDir(): string {
    if (this.projectDirPath === undefined) {
      this.projectDirPath = this.newTempDir("project");
    }
    return this.projectDirPath;
  }

  newTempDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `${this.namespace}-${label}-`));
    this.cleanup.register(`temp directory ${dir}`, () => {
      rmSync(dir, { recursive: true, force: true });
    });
    return dir;
  }

  /**
   * Invoke the Jolly CLI. Default runtime is native Node >= 23 (which strips
   * types for these project files); HARNESS_CLI_RUNTIME overrides it. Runs in
   * the scenario's temp project directory unless overridden, with the test
   * process environment passed through (the same runtime JOLLY_* configuration
   * Jolly itself uses).
   */
  runCli(args: string[], options: RunCliOptions = {}): CliResult {
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const cwd = options.cwd ?? this.projectDir;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...options.env })) {
      if (value !== undefined) env[key] = value;
    }
    // Point pnpm + npm/npx at the shared warm cache unless the scenario set its
    // own, so package fetches happen once across the suite, not per scenario.
    if (!env.npm_config_store_dir) env.npm_config_store_dir = SHARED_PNPM_STORE;
    if (!env.npm_config_cache) env.npm_config_cache = SHARED_NPM_CACHE;
    if (!env.HARNESS_AGENT_POLL_WINDOW_SECONDS) env.HARNESS_AGENT_POLL_WINDOW_SECONDS = "1";
    const spawned = spawnSync(runtime, [CLI_ENTRY, ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 120_000,
      input: options.input,
    });
    if (spawned.error) {
      throw new Error(
        `Failed to invoke Jolly CLI via "${runtime}": ${spawned.error.message}`,
      );
    }
    const stdout = spawned.stdout ?? "";
    const result: CliResult = {
      args,
      cwd,
      exitCode: spawned.status ?? -1,
      stdout,
      stderr: spawned.stderr ?? "",
      envelope: findEnvelope(stdout),
    };
    this.previousRun = this.lastRun;
    this.lastRun = result;
    return result;
  }

  /**
   * Invoke the Jolly CLI without blocking the test process's event loop.
   * Required when the scenario hosts an in-process server the CLI must
   * reach (the feature 012 dry-run preview against the local harness Cloud
   * API): spawnSync would block the loop and deadlock the server. Same
   * runtime, env handling, and result bookkeeping as runCli.
   */
  async runCliAsync(args: string[], options: RunCliOptions = {}): Promise<CliResult> {
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const cwd = options.cwd ?? this.projectDir;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...options.env })) {
      if (value !== undefined) env[key] = value;
    }
    if (!env.npm_config_store_dir) env.npm_config_store_dir = SHARED_PNPM_STORE;
    if (!env.npm_config_cache) env.npm_config_cache = SHARED_NPM_CACHE;
    if (!env.HARNESS_AGENT_POLL_WINDOW_SECONDS) env.HARNESS_AGENT_POLL_WINDOW_SECONDS = "1";
    const result = await new Promise<CliResult>((resolve, reject) => {
      const child = spawn(runtime, [CLI_ENTRY, ...args], { cwd, env });
      let stdout = "";
      let stderr = "";
      const killTimer = setTimeout(
        () => child.kill("SIGKILL"),
        options.timeoutMs ?? 120_000,
      );
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
      child.stdin.end(options.input ?? "");
      child.on("error", (error) => {
        clearTimeout(killTimer);
        reject(
          new Error(`Failed to invoke Jolly CLI via "${runtime}": ${error.message}`),
        );
      });
      child.on("close", (code) => {
        clearTimeout(killTimer);
        resolve({
          args,
          cwd,
          exitCode: code ?? -1,
          stdout,
          stderr,
          envelope: findEnvelope(stdout),
        });
      });
    });
    this.previousRun = this.lastRun;
    this.lastRun = result;
    return result;
  }

  /** The last run's envelope, validated against the feature 020 shape. */
  get envelope(): Envelope {
    assert.ok(this.lastRun, "no Jolly command has been run in this scenario");
    assert.ok(
      this.lastRun.envelope,
      `no output envelope found in stdout of \`jolly ${this.lastRun.args.join(" ")}\` ` +
        `(exit ${this.lastRun.exitCode}).\nstdout:\n${this.lastRun.stdout}\nstderr:\n${this.lastRun.stderr}`,
    );
    assertEnvelopeShape(this.lastRun.envelope);
    return this.lastRun.envelope;
  }

  findCheck(idPrefix: string): Record<string, unknown> | undefined {
    return this.envelope.checks.find((check) =>
      String(check.id).startsWith(idPrefix),
    );
  }

  trackSecret(value: string): void {
    if (value && value.trim() !== "") this.secrets.add(value);
  }

  /** Assert no tracked secret value appears anywhere in the given text. */
  assertNoSecretsIn(text: string, context: string): void {
    for (const secret of this.secrets) {
      assert.ok(
        !text.includes(secret),
        `${context} leaks a secret value (referenced by name only is allowed)`,
      );
    }
  }
}

setWorldConstructor(JollyWorld);
