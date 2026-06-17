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
//   - The workspace `.env` is seeded with the REAL runtime JOLLY_* Saleor Cloud
//     / Stripe values and the real Saleor endpoint — no dummy credentials, no
//     `.invalid` endpoints, no fake CLIs. The agent acts against real services
//     exactly as a customer's agent would.
//   - Every cloud resource the agent creates is `jolly-test`-namespaced and
//     reclaimed in best-effort teardown (the step definitions register it);
//     Stripe runs in test mode. The workspace and fake $HOME are removed too.
//
// Harness-only knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_OPENROUTER_API_KEY — the OpenRouter model API key, provided into
//                                the agent's env as OPENROUTER_API_KEY (the var
//                                pi reads for the OpenRouter provider).
//   HARNESS_EVAL_MODEL         — the model id (default deepseek/deepseek-v4-flash).
//   HARNESS_EVAL_PROVIDER      — the pi provider (default openrouter).
//   HARNESS_EVAL_TIMEOUT_MS    — overall agent run budget (default 600000).
//   HARNESS_EVAL_TRANSCRIPT_DIR — opt-in: when set, a run's evidence (agent
//                                stdout/stderr, the Jolly + Stripe-CLI traces,
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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findEnvelope, type Envelope } from "./envelope.ts";

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
 * `pnpm install`, recipe, deploy, …) in one process, which far exceeds the
 * default. HARNESS_EVAL_CLI_TIMEOUT_MS raises the cap so the live-by-design run
 * can actually complete the store/deploy stages it is meant to exercise.
 */
function evalCliTimeoutMs(): number {
  const raw = process.env.HARNESS_EVAL_CLI_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** Whether the baseline-agent runner (the bundled `pi` binary) is available. */
export function runnerAvailable(): boolean {
  return existsSync(PI_BIN);
}

/** The OpenRouter model key, or undefined when the eval cannot run. */
export function modelApiKey(): string | undefined {
  const key = process.env.HARNESS_OPENROUTER_API_KEY;
  return key && key.trim() !== "" ? key.trim() : undefined;
}

export interface EvalGate {
  ok: boolean;
  reason?: string;
}

/**
 * Gate the eval the way @sandbox gates on credentials: skip — never fail —
 * when the runner or the model key is absent (feature 025 "skip-not-fail when
 * unavailable").
 */
export function evalGate(): EvalGate {
  if (!runnerAvailable()) {
    return {
      ok: false,
      reason:
        `baseline-agent runner not found at ${PI_BIN} ` +
        "(@earendil-works/pi-coding-agent is a devDependency; run `npm install`)",
    };
  }
  if (modelApiKey() === undefined) {
    return {
      ok: false,
      reason: "missing HARNESS_OPENROUTER_API_KEY (the OpenRouter model key)",
    };
  }
  return { ok: true };
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
  /** JSONL file the fake Stripe CLI appends one argv record per invocation to. */
  stripeTraceFile: string;
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
  for (const dir of [workspace, fakeHome, shimDir, join(fakeHome, ".config")]) {
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
  writeFileSync(join(workspace, ".env"), realEnvFileContents());

  const traceFile = join(root, "jolly-trace.jsonl");
  writeFileSync(traceFile, "");
  writeShims(shimDir, traceFile);

  // The Stripe CLI trace file the real-session trace wrapper appends to. The
  // wrapper itself is installed onto shimDir by the "a real Stripe CLI test-mode
  // session is available" step when a real session is present — never a fake.
  const stripeTraceFile = join(root, "stripe-trace.jsonl");
  writeFileSync(stripeTraceFile, "");

  return { workspace, fakeHome, shimDir, traceFile, skillDir, stripeTraceFile };
}

/** The runtime credentials the eval workspace `.env` is seeded with. */
const SEEDED_CREDENTIAL_VARS = [
  "NEXT_PUBLIC_SALEOR_API_URL",
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_SALEOR_APP_TOKEN",
  "JOLLY_SALEOR_CLOUD_API_URL",
  "JOLLY_STRIPE_PUBLISHABLE_KEY",
  "JOLLY_STRIPE_SECRET_KEY",
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
 * ~/.vercel; mirror whichever exists. Best-effort and skip-not-fail: absent a
 * session the deploy stage gates as before.
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
    // best-effort: absent/unreadable session → deploy stage gates (skip-not-fail)
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
  // the live Vercel deploy stage (feature 002). Absent a session, the deploy
  // stage gates (skip-not-fail) exactly as before.
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
 * 127.0.0.1 is first-party, so Jolly's NON_FIRST_PARTY_HOST guard never refuses
 * it, and the agent's documented network rules are unchanged — only the URL the
 * task points at moves from the published mirror to its local source.
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
 * stdout/stderr, the Jolly-invocation trace, the Stripe-CLI trace, and the final
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
    ["stripe-trace.jsonl", ctx.stripeTraceFile],
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
