// Eval-tier machinery (feature 025): the opt-in skill-behavior affordance
// evaluation. A BASELINE coding agent — the bundled `pi` agent
// (`@earendil-works/pi-coding-agent`) run as `pi -p <task> --model <model>` —
// is driven over the REAL Captain-owned Jolly skill and the REAL published-shape
// Jolly CLI, in a safe, bounded, per-run workspace, and the eval asserts
// AFFORDANCES (the agent invoked Jolly's documented commands; the documented
// local artifacts appeared) — never a working deployed store.
//
// Live by design (feature 025): the agent runs against the REAL integrated
// test-env credentials, never fakes. Safety is harmless-by-design, not faking:
//   - The agent runs under a FAKE, throwaway $HOME (a per-run temp dir), so
//     pi's own config/state/credentials are isolated and leave no trace.
//   - The workspace `.env` is seeded with ONLY the REAL runtime JOLLY_* Saleor
//     Cloud values a baseline agent needs to AUTHENTICATE — no dummy
//     credentials, no `.invalid` endpoints, no fake CLIs. The store endpoint and
//     SALEOR_TOKEN are deliberately left unset so `jolly start` provisions a fresh
//     `jolly-cannon-fodder` store on the real creation path. The agent acts against real
//     services exactly as a customer's agent would.
//   - Every cloud resource the agent creates is `jolly-cannon-fodder`-namespaced and
//     reclaimed in best-effort teardown (the step definitions register it). The
//     workspace and fake $HOME are removed too.
//
// Harness-only knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_OPENROUTER_API_KEY — the OpenRouter model API key, provided into
//                                the agent's env as OPENROUTER_API_KEY (the var
//                                pi reads for the OpenRouter provider).
//   HARNESS_EVAL_MODEL         — the model id (default deepseek/deepseek-v4-flash).
//   HARNESS_EVAL_PROVIDER      — the pi provider (default openrouter).
//   HARNESS_EVAL_TIMEOUT_MS    — overall agent run budget (default 600000).
//   HARNESS_EVAL_TRANSCRIPT_DIR — opt-in: when set, a run's evidence (agent
//                                stdout/stderr, the Jolly-invocation trace and
//                                the final workspace .env) is persisted under a
//                                per-run namespaced subdir before teardown,
//                                scrubbing HARNESS_OPENROUTER_API_KEY. Unset →
//                                kept nowhere (the throwaway temp dir as today).
//                                Observability only; never changes pass/fail.
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
  type CloudEnvironment,
} from "./cloud.ts";
import { findEnvelope, type Envelope } from "./envelope.ts";
import { cachedStoreSpareNames } from "./provision.ts";
import { makeNamespace, runId } from "./sandbox.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JOLLY_BIN = join(REPO_ROOT, "bin", "jolly");
const JOLLY_DIST = join(REPO_ROOT, "dist", "index.js");
const SKILL_SRC = join(REPO_ROOT, "assets", "skills", "jolly");
const PI_BIN = join(REPO_ROOT, "node_modules", ".bin", "pi");

/**
 * The published live entry point the canonical scenario points the agent at
 * (the string the homepage copy box hands a customer's agent). `jolly.cool/setup`
 * is served — via a Vercel rewrite — from `assets/homepage/setup.md`.
 */
export const PUBLISHED_SETUP_URL = "https://jolly.cool/setup";

/** The local source the live URL is published from (Vercel rewrite target). */
const LOCAL_SETUP_MD = join(REPO_ROOT, "assets", "homepage", "setup.md");

/** The default skill set `jolly init` verifies on disk (mirrors src DEFAULT_SKILLS). */
const DEFAULT_SKILL_IDS = [
  "jolly",
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
];

export function evalModel(): string {
  const m = process.env.HARNESS_EVAL_MODEL;
  return m && m.trim() !== "" ? m.trim() : "deepseek/deepseek-v4-flash";
}

export function evalProvider(): string {
  const p = process.env.HARNESS_EVAL_PROVIDER;
  return p && p.trim() !== "" ? p.trim() : "openrouter";
}

function evalTimeoutMs(): number {
  const raw = process.env.HARNESS_EVAL_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

/**
 * Per-Jolly-invocation timeout for the PATH shims. A full `jolly start --yes`
 * runs every remaining stage (store provisioning + poll, storefront clone +
 * `pnpm install`, recipe, deploy, …) in one process, which can run as long as
 * the agent's own overall run budget (`evalTimeoutMs`). A shim timeout shorter
 * than that budget kills the single real invocation mid-stage before it can
 * finish, so the default here tracks `evalTimeoutMs()` rather than an
 * arbitrary shorter constant. HARNESS_EVAL_CLI_TIMEOUT_MS overrides directly
 * when a narrower per-invocation cap is wanted.
 */
function evalCliTimeoutMs(): number {
  const raw = process.env.HARNESS_EVAL_CLI_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : evalTimeoutMs();
}

/** The OpenRouter model key the underlying agent reads to reach the model. */
export function modelApiKey(): string | undefined {
  const key = process.env.HARNESS_OPENROUTER_API_KEY;
  return key && key.trim() !== "" ? key.trim() : undefined;
}

export interface EvalContext {
  /** The per-run agent workspace (the agent's cwd). */
  workspace: string;
  /** The throwaway $HOME isolating pi's own config/state/creds. */
  fakeHome: string;
  /** Directory holding the `jolly`/`npx` PATH shims (first on the agent PATH). */
  shimDir: string;
  /** JSONL file the shims append one record per Jolly invocation to. */
  traceFile: string;
  /** The real Jolly skill directory made available to the agent. */
  skillDir: string;
  /**
   * Directory the agent writes its session JSONL to. The agent records its own
   * per-turn `usage` there (model invocations, prompt and completion tokens),
   * which is the source of record for what a run cost (feature
   * verification-economy): the tokens come from the agent, never from an
   * estimate the harness computes for itself.
   */
  sessionDir: string;
}

/**
 * Ensure the published-shape CLI bundle exists (`dist/index.js`, what
 * `bin/jolly` imports). The eval drives the published shape, not the raw-`.ts`
 * dev entry, so the bundle must be built. Returns an error message on failure
 * (the caller turns it into a skip), or undefined on success.
 */
export function ensureCliBundle(): string | undefined {
  if (existsSync(JOLLY_DIST)) return undefined;
  const built = spawnSync(
    "npx",
    [
      "esbuild",
      "src/index.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${JOLLY_DIST}`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  if (built.status !== 0 || !existsSync(JOLLY_DIST)) {
    return `could not build the published CLI bundle: ${built.stderr ?? built.error?.message ?? "unknown error"}`;
  }
  return undefined;
}

/** Assert the real, no-mocks inputs feature 025's Background requires exist. */
export function assertRealInputs(): void {
  for (const [label, path] of [
    ["published CLI launcher (bin/jolly)", JOLLY_BIN],
    ["Captain-owned Jolly skill (assets/skills/jolly/SKILL.md)", join(SKILL_SRC, "SKILL.md")],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`feature 025 requires the real ${label}, missing at ${path}`);
    }
  }
}

// The real npx is resolved on demand (the shim dir is first on PATH and would
// otherwise re-resolve `npx` to the shim itself).
function realNpxPath(): string {
  const result = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["npx"],
    { encoding: "utf8" },
  );
  const first = (result.stdout ?? "").split(/\r?\n/).find((l) => l.trim() !== "");
  return first?.trim() || "npx";
}

/**
 * Write the `jolly` and `npx` PATH shims. Each logs argv (and the real
 * invocation's stdout/stderr/exit) to the JSONL trace, then execs the real
 * binary — so the eval observes exactly what the agent ran (feature 025: "a
 * PATH shim that logs argv and then execs the real binary"). Absolute paths
 * are baked into the scripts so they need no env to function.
 */
function writeShims(shimDir: string, traceFile: string): void {
  const cliTimeout = evalCliTimeoutMs();
  const jollyShim = `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const argv = process.argv.slice(2);
const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(JOLLY_BIN)}, ...argv], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: ${cliTimeout},
});
const rec = { tool: "jolly", argv, exit: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
try { fs.appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify(rec) + "\\n"); } catch {}
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status == null ? 1 : r.status);
`;

  const npxShim = `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const argv = process.argv.slice(2);
let i = 0;
while (i < argv.length && argv[i].startsWith("-")) i++;
const pkg = argv[i];
if (pkg === "@dk/jolly" || pkg === "jolly") {
  const rest = argv.slice(i + 1);
  const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(JOLLY_BIN)}, ...rest], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: ${cliTimeout},
  });
  const rec = { tool: "npx-jolly", argv: rest, exit: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  try { fs.appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify(rec) + "\\n"); } catch {}
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status == null ? 1 : r.status);
}
const r = spawnSync(${JSON.stringify(realNpxPath())}, argv, { stdio: "inherit" });
process.exit(r.status == null ? 1 : r.status);
`;

  writeFileSync(join(shimDir, "jolly"), jollyShim, { mode: 0o755 });
  writeFileSync(join(shimDir, "npx"), npxShim, { mode: 0o755 });
}

/**
 * Build the per-run eval context: a namespaced temp workspace seeded with the
 * real Jolly skill and the default skill set on disk (so `jolly init` verifies
 * offline, mirroring feature 007), a throwaway $HOME, the PATH-shim tracer, and
 * a `.env` seeded with the real integrated test-env credentials. Registers
 * teardown of the workspace and fake home with the supplied cleanup register
 * (LIFO best-effort, feature 023).
 */
export function setupEvalContext(
  namespace: string,
  register: (description: string, fn: () => void) => void,
): EvalContext {
  const root = mkdtempSync(join(tmpdir(), `${namespace}-eval-`));
  register(`eval temp root ${root}`, () => rmSync(root, { recursive: true, force: true }));

  const workspace = join(root, "workspace");
  const fakeHome = join(root, "home");
  const shimDir = join(root, "bin");
  const sessionDir = join(root, "session");
  for (const dir of [workspace, fakeHome, shimDir, sessionDir, join(fakeHome, ".config")]) {
    mkdirSync(dir, { recursive: true });
  }

  // Seed the default skill set on disk so `jolly init` verifies it without a
  // reachable registry (same approach as the feature 007 @logic steps). The
  // Jolly skill is the REAL Captain-owned asset (feature 025: no mocks); the
  // peripheral Saleor skills are minimal markers, only there so init succeeds.
  const skillsBase = join(workspace, ".agents", "skills");
  for (const id of DEFAULT_SKILL_IDS) {
    const dir = join(skillsBase, id);
    mkdirSync(dir, { recursive: true });
    if (id === "jolly") {
      cpSync(SKILL_SRC, dir, { recursive: true });
    } else {
      writeFileSync(join(dir, "SKILL.md"), `# ${id}\n`);
    }
  }
  const skillDir = join(skillsBase, "jolly");

  // Seed the workspace `.env` with the REAL integrated test-env credentials
  // (feature 025: live by design). This is the "scaffolded `.env`" artifact and
  // the file-form the agent reads (Jolly reads .env via loadEnvValues); the same
  // real values reach the agent process below. No dummy creds, no `.invalid`.
  //
  // Also default the store name to this run's `jolly-cannon-fodder`-namespace, so the
  // autonomous agent's `jolly start`/`create store` provisions a
  // `jolly-cannon-fodder`-namespaced environment (feature 025: every created resource
  // jolly-cannon-fodder-namespaced and reclaimable). Without it Jolly falls through to its
  // product default "jolly-store", which the jolly-cannon-fodder teardown cannot reclaim —
  // leaking the env and failing the namespacing assertion.
  writeFileSync(
    join(workspace, ".env"),
    `${realEnvFileContents()}JOLLY_STORE_NAME=${namespace}\nJOLLY_STORE_DOMAIN_LABEL=${namespace}\n`,
  );

  const traceFile = join(root, "jolly-trace.jsonl");
  writeFileSync(traceFile, "");
  writeShims(shimDir, traceFile);

  return { workspace, fakeHome, shimDir, traceFile, skillDir, sessionDir };
}

/**
 * The runtime credentials the eval workspace `.env` is seeded with: ONLY the
 * ones a baseline agent needs to AUTHENTICATE to the real services (feature 025
 * / 026). The store endpoint `NEXT_PUBLIC_SALEOR_API_URL` and the
 * `SALEOR_TOKEN` are deliberately left unset so `jolly start`
 * provisions a fresh `jolly-cannon-fodder` store on the real creation path instead of
 * reusing a pre-seeded one (a seeded endpoint makes `jolly start` treat the
 * store as pre-existing, so the configurator's `--failOnDelete` guard blocks
 * the starter recipe and the live stages can never complete).
 */
export const SEEDED_CREDENTIAL_VARS = [
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_SALEOR_CLOUD_API_URL",
] as const;

/**
 * The workspace `.env` contents: the REAL integrated test-env credentials taken
 * from the runtime environment (feature 025: live by design — no dummy values,
 * no `.invalid`). Only the variables actually present are written.
 */
export function realEnvFileContents(): string {
  const lines = SEEDED_CREDENTIAL_VARS.map((k) => [k, process.env[k]] as const)
    .filter(([, v]) => v !== undefined && v.trim() !== "")
    .map(([k, v]) => `${k}=${v}`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * The eval's pre-run capacity reclamation (features 025 + 026): BEFORE the
 * baseline agent's `jolly start` provisions its fresh store, delete every
 * leftover `jolly-cannon-fodder`-namespaced environment standing in the org from previous
 * runs, so a finite org environment limit never starves the run at its store
 * stage — the same capacity reclamation the @sandbox provision path performs.
 * The `jolly-cannon-fodder-` prefix IS the protection boundary (AGENTS.md): only
 * `jolly-cannon-fodder`-namespaced environments are ever deleted; anything lacking the
 * prefix is never touched. Deletion is idempotent and returns the environments it
 * removed, for observability and the feature 026 conformance assertion. A no-op
 * when no leftover stands.
 */
export async function reclaimLeftoverTestEnvironments(
  token: string,
): Promise<CloudEnvironment[]> {
  const all = await listAllEnvironments(token);
  // Reclaim PRIOR-run leftovers only (the run-scoped helper excludes this run's
  // namespace). At eval reclaim time this run has provisioned nothing yet, so
  // this clears every standing leftover exactly as before — and under a parallel
  // @sandbox run it never deletes a sibling worker's live environment. Also
  // spares BOTH the @sandbox tier's currently-cached shared store and the
  // feature-004 recipe-deployed store (by exact name, via their marker files) so
  // an eval run never tears down a store a concurrent or later @sandbox run is
  // relying on.
  const spareNames = cachedStoreSpareNames();
  const leftovers = leftoverTestEnvironments(all, makeNamespace(runId()), spareNames);
  for (const env of leftovers) {
    await deleteEnvironment(token, env.org, env.key);
  }
  return leftovers;
}

export interface AgentRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run the baseline `pi` agent over the task, in the eval workspace, under the
 * fake $HOME, with the shimmed PATH and the REAL integrated test-env credentials
 * (feature 025: live by design). The real JOLLY_* values that `support/dotenv.ts`
 * loaded into process.env pass straight through; the model key enters the agent
 * env as OPENROUTER_API_KEY. Safety is harmless-by-design (namespacing +
 * teardown registered by the step definitions), never credential-faking.
 */
/**
 * Copy the runner's real Vercel CLI session into the agent's isolated fake
 * $HOME so `npx vercel` is authenticated there (live-by-design deploy). The
 * Vercel CLI stores its session under $XDG_DATA_HOME/com.vercel.cli (Linux) or
 * ~/.vercel; mirror whichever exists. Best-effort.
 */
function passThroughVercelSession(fakeHome: string): void {
  const realHome = process.env.HOME ?? "";
  const realDataHome =
    process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim() !== ""
      ? process.env.XDG_DATA_HOME
      : join(realHome, ".local", "share");
  const fakeDataHome = join(fakeHome, ".local", "share");
  try {
    const xdgSrc = join(realDataHome, "com.vercel.cli");
    if (existsSync(xdgSrc)) {
      mkdirSync(fakeDataHome, { recursive: true });
      cpSync(xdgSrc, join(fakeDataHome, "com.vercel.cli"), { recursive: true });
    }
    const legacySrc = join(realHome, ".vercel");
    if (existsSync(legacySrc)) {
      cpSync(legacySrc, join(fakeHome, ".vercel"), { recursive: true });
    }
  } catch {
    // best-effort
  }
}

export function runBaselineAgent(ctx: EvalContext, task: string): AgentRun {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // Isolation + routing.
  env.HOME = ctx.fakeHome;
  env.XDG_CONFIG_HOME = join(ctx.fakeHome, ".config");
  env.XDG_DATA_HOME = join(ctx.fakeHome, ".local", "share");
  env.XDG_CACHE_HOME = join(ctx.fakeHome, ".cache");
  env.PATH = `${ctx.shimDir}:${process.env.PATH ?? ""}`;
  env.OPENROUTER_API_KEY = modelApiKey() ?? "";
  // Never leak the harness's own knobs into the agent.
  delete env.HARNESS_OPENROUTER_API_KEY;

  // Pass a real Vercel CLI session into the agent's isolated home when one
  // exists on the runner (live by design): the customer's own agent would be
  // logged in to Vercel, so the eval's agent gets the same session and can drive
  // the live Vercel deploy stage (feature 002).
  passThroughVercelSession(ctx.fakeHome);

  const timeout = evalTimeoutMs();
  const start = Date.now();
  const result = spawnSync(
    PI_BIN,
    [
      "-p",
      task,
      "--provider",
      evalProvider(),
      "--model",
      evalModel(),
      "--skill",
      ctx.skillDir,
      // The agent records its own per-turn usage into this session, which the
      // affordance map reads (feature verification-economy).
      "--session-dir",
      ctx.sessionDir,
    ],
    {
      cwd: ctx.workspace,
      env,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const durationMs = Date.now() - start;
  const timedOut =
    result.error !== undefined &&
    (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  if (result.error && !timedOut) {
    throw new Error(`failed to run the baseline agent: ${result.error.message}`);
  }
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
    timedOut,
  };
}

/**
 * Opt-in local-setup mode (HARNESS_EVAL_SETUP_LOCAL): point the eval agent at
 * the LOCAL `assets/homepage/setup.md` instead of the live `jolly.cool/setup`,
 * so the setup guide can be iterated on and validated locally before redeploying
 * jolly.cool. Unset (default) → the canonical scenario keeps verifying the real
 * published entry point, unchanged.
 */
export function evalSetupLocal(): boolean {
  const raw = process.env.HARNESS_EVAL_SETUP_LOCAL;
  return raw !== undefined && raw.trim() !== "" && raw.trim() !== "0";
}

/**
 * Resolve the agent task string. Default: returned unchanged (the live
 * `jolly.cool/setup` URL the scenario docstring carries). With the opt-in
 * HARNESS_EVAL_SETUP_LOCAL knob set: serve `assets/homepage/setup.md` over an
 * ephemeral 127.0.0.1 HTTP server for the run and substitute that local URL into
 * the task in place of the live URL, so the agent fetches the LOCAL guide. The
 * server is registered for teardown with the supplied cleanup register.
 *
 * The agent fetches this local guide with its own tooling — it is not routed
 * through Jolly's first-party request guard — so only the URL the task points at
 * moves from the published mirror to its local source; the guide content is the
 * real `assets/homepage/setup.md`, not a stand-in.
 */
export function resolveEvalTask(
  task: string,
  register: (description: string, fn: () => void) => void,
): string {
  if (!evalSetupLocal()) return task;

  // Serve the local guide from a SEPARATE Node process, not an in-process
  // server: the agent run goes through a blocking spawnSync (runBaselineAgent),
  // which would freeze an in-process server's event loop and deadlock the
  // agent's fetch. The child binds an ephemeral 127.0.0.1 port and writes it to
  // a file; we block (without the event loop) until it appears.
  const portFile = join(mkdtempSync(join(tmpdir(), "jolly-setup-srv-")), "port");
  const child = spawn(
    process.execPath,
    ["-e", LOCAL_SETUP_SERVER_SRC, LOCAL_SETUP_MD, portFile],
    { stdio: "ignore", detached: false },
  );
  register(`eval local-setup server (pid ${child.pid})`, () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // best-effort
    }
    rmSync(portFile, { force: true });
  });

  const port = waitForPortFile(portFile);
  const localUrl = `http://127.0.0.1:${port}/setup`;
  return task.split(PUBLISHED_SETUP_URL).join(localUrl);
}

/**
 * The tiny setup-server program run in a child Node process (process.execPath
 * `-e`). argv: [setupMdPath, portFile]. Binds an ephemeral 127.0.0.1 port,
 * serves the file's current contents (read per request, so guide edits take
 * effect without a restart) for any path, and writes the chosen port to
 * portFile so the parent can discover it.
 */
const LOCAL_SETUP_SERVER_SRC = `
const http = require("node:http");
const fs = require("node:fs");
const [mdPath, portFile] = process.argv.slice(1);
// @exceptional-double: the published homepage (jolly.cool) is not the unit under test;
// this server returns the REAL shipped setup.md locally so the @eval agent reads the
// actual published instructions without a network dependency on the live site.
const server = http.createServer((req, res) => {
  let body = "";
  try { body = fs.readFileSync(mdPath, "utf8"); } catch (e) { body = String(e); }
  res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
  res.end(body);
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});
`;

/**
 * Block — without spinning the event loop (Atomics.wait), so it works even
 * though the surrounding step later calls a blocking spawnSync — until the
 * child setup-server has written its chosen port, then return it.
 */
function waitForPortFile(portFile: string): number {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const raw = readFileSync(portFile, "utf8").trim();
      const port = Number.parseInt(raw, 10);
      if (Number.isFinite(port) && port > 0) return port;
    }
    Atomics.wait(sleeper, 0, 0, 25);
  }
  throw new Error(
    `local-setup server did not report its port within 5s (${portFile})`,
  );
}

/** The opt-in transcript directory, or undefined when the knob is unset. */
export function evalTranscriptDir(): string | undefined {
  const raw = process.env.HARNESS_EVAL_TRANSCRIPT_DIR;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * Persist a run's evidence for after-the-fact understanding (feature 023's
 * "Eval transcript keeping", opt-in). When HARNESS_EVAL_TRANSCRIPT_DIR is set,
 * write — under a per-run namespaced subdir, before teardown — the agent's full
 * stdout/stderr, the Jolly-invocation trace, and the final
 * workspace `.env`, scrubbing HARNESS_OPENROUTER_API_KEY from the text. It is
 * observability only: best-effort, and it never changes pass/fail. Returns the
 * directory written to, or undefined when the knob is unset.
 */
export function persistEvalTranscript(
  ctx: EvalContext,
  run: AgentRun,
  namespace: string,
): string | undefined {
  const baseDir = evalTranscriptDir();
  if (baseDir === undefined) return undefined;
  const outDir = join(baseDir, namespace);
  mkdirSync(outDir, { recursive: true });

  const apiKey = process.env.HARNESS_OPENROUTER_API_KEY;
  const scrub = (text: string): string =>
    apiKey && apiKey.length > 0 ? text.split(apiKey).join("[REDACTED]") : text;
  const write = (name: string, text: string): void =>
    writeFileSync(join(outDir, name), scrub(text));

  write("agent.stdout.txt", run.stdout);
  write("agent.stderr.txt", run.stderr);
  for (const [name, path] of [
    ["jolly-trace.jsonl", ctx.traceFile],
  ] as const) {
    if (existsSync(path)) write(name, readFileSync(path, "utf8"));
  }
  const envFile = join(ctx.workspace, ".env");
  if (existsSync(envFile)) write("env", readFileSync(envFile, "utf8"));

  return outDir;
}

export interface TraceRecord {
  tool: "jolly" | "npx-jolly";
  argv: string[];
  exit: number | null;
  stdout: string;
  stderr: string;
}

/** Parse the JSONL Jolly-invocation trace the shims wrote. */
export function parseTrace(traceFile: string): TraceRecord[] {
  if (!existsSync(traceFile)) return [];
  const records: TraceRecord[] = [];
  for (const line of readFileSync(traceFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const rec = JSON.parse(line) as TraceRecord;
      if (Array.isArray(rec.argv)) records.push(rec);
    } catch {
      // Ignore a malformed line rather than failing the whole parse.
    }
  }
  return records;
}

/** The Jolly subcommand of a trace record: first non-flag argv token. */
export function subcommandOf(rec: TraceRecord): string | undefined {
  return rec.argv.find((a) => !a.startsWith("-"));
}

/** Jolly's documented top-level commands (feature 006/008 thin surface). */
export const DOCUMENTED_COMMANDS = new Set([
  "login",
  "logout",
  "auth",
  "init",
  "start",
  "doctor",
  "upgrade",
  "skills",
  "create",
]);

/**
 * The output envelope emitted by the first traced invocation of any of the
 * given subcommands (used to assert diagnostics ran and emitted the standard
 * feature 020 envelope). Returns the envelope and the subcommand that produced
 * it, or undefined if none of those commands ran or none emitted an envelope.
 */
export function envelopeFromTrace(
  records: TraceRecord[],
  subcommands: string[],
): { command: string; envelope: Envelope } | undefined {
  for (const rec of records) {
    const sub = subcommandOf(rec);
    if (sub && subcommands.includes(sub)) {
      const envelope = findEnvelope(rec.stdout);
      if (envelope) return { command: sub, envelope };
    }
  }
  return undefined;
}

// ─── The affordance map (feature verification-economy, feature 025) ──────────
//
// What succeeding COST is the measure. The agent records its own per-turn usage
// into its session JSONL; the PATH shim records every Jolly invocation into the
// trace. Joined in turn order, the two give a turn-by-turn account of where the
// agent spent its budget, and against which piece of Jolly's output it began to
// flail.

/** One model invocation the agent made, as the agent itself recorded it. */
export interface ModelInvocation {
  /** 0-based turn index, in the order the agent made them. */
  turn: number;
  /** Prompt tokens the invocation consumed, from the agent's own usage record. */
  promptTokens: number;
  /** Completion tokens the invocation produced, from the agent's own usage record. */
  completionTokens: number;
  /** The shell commands this invocation asked to run, verbatim. */
  shellCommands: string[];
}

/** One entry of the affordance map: what a turn cost, and what Jolly it ran. */
export interface AffordanceEntry extends ModelInvocation {
  /**
   * The Jolly command this invocation ran, taken from the CLI trace, or
   * undefined when the invocation ran none.
   */
  jollyCommand?: string;
}

/** The agent's session JSONL: the newest session file in its session directory. */
function sessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  const sessions = readdirSync(sessionDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const newest = sessions[sessions.length - 1];
  return newest === undefined ? undefined : join(sessionDir, newest);
}

/**
 * Every model invocation the agent made, read from the usage IT recorded on
 * each assistant message in its session JSONL. An assistant message with no
 * usage is not a model invocation the agent accounted for, so it is not
 * counted: a run whose agent recorded no usage yields an empty list, which
 * reddens rather than reporting a cost of zero.
 */
export function readModelInvocations(sessionDir: string): ModelInvocation[] {
  const file = sessionFile(sessionDir);
  if (!file) return [];
  const invocations: ModelInvocation[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let entry: {
      type?: string;
      message?: {
        role?: string;
        content?: Array<{ type?: string; name?: string; arguments?: { command?: string } }>;
        usage?: { input?: number; output?: number };
      };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (entry.type !== "message" || message?.role !== "assistant") continue;
    const usage = message.usage;
    if (!usage || typeof usage.input !== "number" || typeof usage.output !== "number") {
      continue;
    }
    const shellCommands = (message.content ?? [])
      .filter((part) => part.type === "toolCall" && typeof part.arguments?.command === "string")
      .map((part) => part.arguments!.command!);
    invocations.push({
      turn: invocations.length,
      promptTokens: usage.input,
      completionTokens: usage.output,
      shellCommands,
    });
  }
  return invocations;
}

/** A trace record's command line, as the shim observed it. */
export function traceCommandLine(record: TraceRecord): string {
  return `${record.tool === "npx-jolly" ? "npx jolly" : "jolly"} ${record.argv.join(" ")}`.trim();
}

/**
 * The affordance map: one entry per model invocation, carrying the tokens the
 * agent recorded for it and the Jolly command it ran.
 *
 * The command comes from the CLI trace, never from the text of the tool call:
 * the trace is what actually executed. The two are joined in turn order — the
 * traced invocations are consumed in sequence by the turns whose shell commands
 * asked for Jolly — so a turn that ran no Jolly command records none.
 *
 * A run whose agent recorded no usage has no map to report, so this throws
 * rather than returning entries that would read as a cost of zero.
 */
export function buildAffordanceMap(
  invocations: ModelInvocation[],
  trace: TraceRecord[],
): AffordanceEntry[] {
  if (invocations.length === 0) {
    throw new Error(
      "the agent recorded no usage, so the run's cost is unknown — a run that reports no model invocation cannot report a cost of zero",
    );
  }
  const remaining = [...trace];
  return invocations.map((invocation) => {
    const commands: string[] = [];
    // Consume the traced invocations this turn's shell commands asked for, in
    // order. A turn that merely MENTIONS jolly without invoking it (reading a
    // file, grepping output) matches no traced record and records none: the
    // trace is what actually executed.
    for (const shellCommand of invocation.shellCommands) {
      while (remaining.length > 0 && shellCommandRan(shellCommand, remaining[0]!)) {
        commands.push(traceCommandLine(remaining.shift()!));
      }
    }
    return commands.length === 0
      ? { ...invocation }
      : { ...invocation, jollyCommand: commands.join(" && ") };
  });
}

/**
 * Whether a shell command the agent asked to run is the traced invocation: it
 * names jolly and carries every non-flag token of the traced argv, so a
 * `jolly doctor` record is never attributed to a `jolly start` call.
 */
function shellCommandRan(shellCommand: string, record: TraceRecord): boolean {
  if (!/\bjolly\b/.test(shellCommand)) return false;
  return record.argv
    .filter((token) => !token.startsWith("-"))
    .every((token) => shellCommand.includes(token));
}

/** The prompt and completion tokens summed across every invocation. */
export function totalTokens(invocations: ModelInvocation[]): number {
  return invocations.reduce(
    (sum, invocation) => sum + invocation.promptTokens + invocation.completionTokens,
    0,
  );
}

/** A ceiling the run crossed, and the turn at which it crossed it. */
export interface BudgetBreach {
  /** Which ceiling was crossed. */
  budget: "turns" | "tokens";
  /** The turn at which the running total crossed the ceiling. */
  turn: number;
  /** The ceiling itself. */
  limit: number;
  /** What the run had spent by that turn. */
  spent: number;
}

/**
 * The first ceiling the run crossed, walking its turns in order, or undefined
 * when the run stayed inside both.
 *
 * The TURN the run crossed at is the finding worth having: a total says the run
 * got more expensive, the turn says where the agent started to flail, and that
 * is what names the copy to fix. Tokens are the prompt and completion tokens
 * summed across every invocation, from the agent's own recorded usage.
 */
export function findBudgetBreach(
  invocations: ModelInvocation[],
  turnBudget: number,
  tokenBudget: number,
): BudgetBreach | undefined {
  let tokens = 0;
  for (const invocation of invocations) {
    tokens += invocation.promptTokens + invocation.completionTokens;
    const turns = invocation.turn + 1;
    if (turns > turnBudget) {
      return { budget: "turns", turn: invocation.turn, limit: turnBudget, spent: turns };
    }
    if (tokens > tokenBudget) {
      return { budget: "tokens", turn: invocation.turn, limit: tokenBudget, spent: tokens };
    }
  }
  return undefined;
}

/** A turn spent reaching for `--help` to recover from a Jolly command that errored. */
export interface WastedTurn {
  /** The Jolly command whose envelope failed to carry the recovery. */
  command: string;
  /** The `--help` invocation that followed it. */
  help: string;
  /** Whether that command's envelope carried nextSteps. */
  carriedNextSteps: boolean;
  /** Whether that command's envelope carried remediation on any check. */
  carriedRemediation: boolean;
  /** What the erroring envelope told the agent, so the copy to fix is named. */
  summary: string;
  /** The error codes the erroring envelope carried. */
  errorCodes: string[];
}

function reportedError(record: TraceRecord): boolean {
  const envelope = findEnvelope(record.stdout) ?? findEnvelope(record.stderr);
  if (envelope) return envelope.status === "error";
  return record.exit !== null && record.exit !== 0;
}

function isHelp(record: TraceRecord): boolean {
  return record.argv.includes("--help") || record.argv.includes("-h");
}

/**
 * Wasted turns: a `--help` invocation reaching for the recovery that the
 * erroring command's own envelope should have carried (feature 020 requires the
 * error envelope to carry its nextSteps and remediation). Re-running a command
 * to resume a pending human gate is not flailing and is not reported.
 */
export function findWastedHelpTurns(trace: TraceRecord[]): WastedTurn[] {
  const wasted: WastedTurn[] = [];
  trace.forEach((record, index) => {
    if (!reportedError(record)) return;
    const next = trace[index + 1];
    if (!next || !isHelp(next)) return;
    const envelope = findEnvelope(record.stdout) ?? findEnvelope(record.stderr);
    const errors = (envelope?.errors ?? []) as Array<Record<string, unknown>>;
    wasted.push({
      command: traceCommandLine(record),
      help: traceCommandLine(next),
      carriedNextSteps: (envelope?.nextSteps?.length ?? 0) > 0,
      // The recovery an error envelope owes the agent (feature 020): a
      // remediation on the error it reported, or on a failing check.
      carriedRemediation:
        errors.some(
          (error) =>
            typeof error.remediation === "string" && error.remediation.trim() !== "",
        ) ||
        (envelope?.checks ?? []).some(
          (check) => typeof check.remediation === "string" && check.remediation.trim() !== "",
        ),
      summary: envelope?.summary ?? `(no envelope; exit ${record.exit})`,
      errorCodes: errors
        .map((error) => (typeof error.code === "string" ? error.code : "?"))
        .filter(Boolean),
    });
  });
  return wasted;
}
