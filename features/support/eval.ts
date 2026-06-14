// Eval-tier machinery (feature 025): the opt-in skill-behavior affordance
// evaluation. A BASELINE coding agent — the bundled `pi` agent
// (`@earendil-works/pi-coding-agent`) run as `pi -p <task> --model <model>` —
// is driven over the REAL Captain-owned Jolly skill and the REAL published-shape
// Jolly CLI, in a safe, bounded, per-run workspace, and the eval asserts
// AFFORDANCES (the agent invoked Jolly's documented commands; the documented
// local artifacts appeared) — never a working deployed store.
//
// Safety is the hard constraint (feature 025 "Harmless by design"):
//   - The agent runs under a FAKE, throwaway $HOME (a per-run temp dir), so
//     pi's own config/state/credentials are isolated and leave no trace.
//   - It runs with FORCED SAFE credentials — dummy JOLLY_* values and an
//     unroutable `.invalid` Cloud API base (the "012 incident" discipline),
//     delivered both as a seeded workspace `.env` and as env overrides — so
//     even a create/deploy command cannot reach a real account or deploy.
//   - The workspace and the fake $HOME are removed in teardown.
//
// Harness-only knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_OPENROUTER_API_KEY — the OpenRouter model API key, provided into
//                                the agent's env as OPENROUTER_API_KEY (the var
//                                pi reads for the OpenRouter provider).
//   HARNESS_EVAL_MODEL         — the model id (default deepseek/deepseek-v4-flash).
//   HARNESS_EVAL_PROVIDER      — the pi provider (default openrouter).
//   HARNESS_EVAL_TIMEOUT_MS    — overall agent run budget (default 600000).
import { spawnSync } from "node:child_process";
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
import { DUMMY, logicSafeEnv } from "./logic-env.ts";
import { makeNamespace } from "./sandbox.ts";
import { writeFakeStripeCli } from "./stripe-cli-fake.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JOLLY_BIN = join(REPO_ROOT, "bin", "jolly");
const JOLLY_DIST = join(REPO_ROOT, "dist", "index.js");
const SKILL_SRC = join(REPO_ROOT, "assets", "skills", "jolly");
const PI_BIN = join(REPO_ROOT, "node_modules", ".bin", "pi");

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
  const jollyShim = `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const argv = process.argv.slice(2);
const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(JOLLY_BIN)}, ...argv], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 120000,
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
    timeout: 120000,
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
 * a forced-safe `.env`. Registers teardown of the workspace and fake home with
 * the supplied cleanup register (LIFO best-effort, feature 023).
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
  const skillsBase = join(workspace, ".claude", "skills");
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

  // Forced-safe credentials as a seeded workspace `.env`: dummy JOLLY_* values
  // and an unroutable `.invalid` Cloud API base. This is the "scaffolded `.env`"
  // artifact and the file-form safety net (Jolly reads .env via loadEnvValues);
  // env overrides on the agent process below are the second layer. The Stripe
  // keys are deliberately omitted so the agent must IMPORT them through Jolly
  // from the fake Stripe CLI session below (feature 025 Stripe affordance).
  writeFileSync(join(workspace, ".env"), safeEnvFileContents());

  const traceFile = join(root, "jolly-trace.jsonl");
  writeFileSync(traceFile, "");
  writeShims(shimDir, traceFile);

  // A harness-fake Stripe CLI on the agent's PATH (shimDir is first on PATH in
  // runBaselineAgent), standing in for a completed `stripe login`. It answers
  // `stripe config --list` read-only with dummy test keys and contacts no
  // network, so `jolly create stripe` can import them safely (feature 025).
  const stripeTraceFile = join(root, "stripe-trace.jsonl");
  writeFileSync(stripeTraceFile, "");
  writeFakeStripeCli(shimDir, { traceFile: stripeTraceFile });

  return { workspace, fakeHome, shimDir, traceFile, skillDir, stripeTraceFile };
}

/**
 * The forced-safe `.env` contents (dummy creds + unroutable Cloud API base).
 * The Stripe keys are omitted so the eval genuinely exercises importing them
 * through Jolly from the fake Stripe CLI session, rather than finding them
 * pre-seeded (feature 025 Stripe affordance).
 */
export function safeEnvFileContents(): string {
  const safe = logicSafeEnv({
    JOLLY_STRIPE_PUBLISHABLE_KEY: undefined,
    JOLLY_STRIPE_SECRET_KEY: undefined,
  });
  return (
    Object.entries(safe)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
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
 * fake $HOME, with the shimmed PATH and forced-safe credentials. The model key
 * enters the agent env as OPENROUTER_API_KEY; the real JOLLY_* values that
 * `support/dotenv.ts` loaded into process.env are overridden with dummies.
 */
export function runBaselineAgent(ctx: EvalContext, task: string): AgentRun {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // Forced-safe credential overrides (the "012 incident" discipline).
  for (const [k, v] of Object.entries(logicSafeEnv())) {
    if (v !== undefined) env[k] = v;
  }
  // Drop any Stripe keys (real ones loaded from the repo .env, or the dummy
  // overrides above) so the agent must IMPORT them through Jolly from the fake
  // Stripe CLI session — cloud safety overrides above are untouched.
  delete env.JOLLY_STRIPE_PUBLISHABLE_KEY;
  delete env.JOLLY_STRIPE_SECRET_KEY;
  // Isolation + routing.
  env.HOME = ctx.fakeHome;
  env.XDG_CONFIG_HOME = join(ctx.fakeHome, ".config");
  env.XDG_DATA_HOME = join(ctx.fakeHome, ".local", "share");
  env.XDG_CACHE_HOME = join(ctx.fakeHome, ".cache");
  env.PATH = `${ctx.shimDir}:${process.env.PATH ?? ""}`;
  env.OPENROUTER_API_KEY = modelApiKey() ?? "";
  // Never leak the harness's own knobs into the agent.
  delete env.HARNESS_OPENROUTER_API_KEY;

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

export { DUMMY };
