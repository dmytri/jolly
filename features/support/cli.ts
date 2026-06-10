// CLI invocation seam for BDD steps. See features/023-test-architecture.feature.
//
// Harness convention (QM-owned): tests exercise the CLI by running the
// repository entry point `src/index.ts` directly (the local equivalent of the
// production `npx @saleor/jolly` invocation — npx packaging itself is a
// release-time concern, not a per-scenario one). The runtime is Bun when
// available, otherwise Node >= 23 (native TypeScript type stripping). Override
// with JOLLY_TEST_RUNTIME=bun|node.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cliEntry = join(repoRoot, "src", "index.ts");

let cachedRuntime: string | null = null;

export function cliRuntime(): string {
  if (cachedRuntime) return cachedRuntime;
  const forced = process.env.JOLLY_TEST_RUNTIME;
  if (forced) return (cachedRuntime = forced);
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  cachedRuntime = probe.status === 0 ? "bun" : "node";
  return cachedRuntime;
}

export function cliImplemented(): boolean {
  return existsSync(cliEntry);
}

export interface RunResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Parsed output envelope (feature 020), if one could be extracted. */
  envelope: Envelope | undefined;
}

// The feature 020 output envelope. `data` is command-specific.
export interface Envelope {
  command: string;
  status: string;
  summary: string;
  data: Record<string, unknown>;
  checks?: unknown[];
  nextSteps?: unknown[];
  errors?: unknown[];
  [key: string]: unknown;
}

export interface RunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Text piped to stdin (then stdin is closed). */
  input?: string;
  timeoutMs?: number;
}

// Minimal, controlled environment so host credentials never leak into tests
// and commands never see unexpected JOLLY_* state.
function baseEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG", "NODE_OPTIONS"];
  const env: Record<string, string> = { NO_COLOR: "1", CI: "1" };
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function runJolly(args: string[], opts: RunOptions): Promise<RunResult> {
  const runtime = cliRuntime();
  const argv = runtime === "node" ? ["--no-warnings", cliEntry, ...args] : [cliEntry, ...args];
  const env = { ...baseEnv(), ...opts.env };
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(runtime, argv, { cwd: opts.cwd, env: env as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();

    const timer = setTimeout(() => {
      stderr += `\n[test harness] timed out after ${timeoutMs}ms; killing process`;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ args, stdout, stderr: `${stderr}\n${error.message}`, exitCode: null, envelope: undefined });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ args, stdout, stderr, exitCode: code, envelope: extractEnvelope(stdout) });
    });
  });
}

// Extract the feature 020 envelope from stdout. With --json the whole stdout
// is the envelope; in default mode the envelope is embedded in mixed output,
// so take the last parseable JSON object that looks like an envelope.
export function extractEnvelope(stdout: string): Envelope | undefined {
  const looksLikeEnvelope = (value: unknown): value is Envelope =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Envelope).command === "string" &&
    typeof (value as Envelope).status === "string";

  const trimmed = stdout.trim();
  try {
    const whole = JSON.parse(trimmed);
    if (looksLikeEnvelope(whole)) return whole;
  } catch {
    // fall through to embedded-object scan
  }

  let found: Envelope | undefined;
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] !== "{") continue;
    const candidate = readBalancedObject(stdout, i);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.text);
      if (looksLikeEnvelope(parsed)) found = parsed;
      i = candidate.end;
    } catch {
      // not JSON from this brace; keep scanning
    }
  }
  return found;
}

function readBalancedObject(text: string, start: number): { text: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { text: text.slice(start, i + 1), end: i };
    }
  }
  return null;
}

/**
 * stdout with every envelope-looking JSON block removed — what a human reads
 * in default mode. Formatting-independent (uses the balanced-brace scan).
 */
export function stripEnvelopeJson(stdout: string): string {
  let result = "";
  let i = 0;
  while (i < stdout.length) {
    if (stdout[i] === "{") {
      const candidate = readBalancedObject(stdout, i);
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate.text);
          if (parsed && typeof parsed === "object" && typeof parsed.command === "string" && typeof parsed.status === "string") {
            i = candidate.end + 1;
            continue;
          }
        } catch {
          // not JSON; fall through and keep the character
        }
      }
    }
    result += stdout[i];
    i++;
  }
  return result;
}

/** True when the text carries real human-readable words (not JSON punctuation). */
export function hasHumanText(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text.replace(/[{}[\]",:]/g, " "));
}

/** Assert a run produced an envelope; failure message carries CLI output for diagnosis. */
export function requireEnvelope(run: RunResult): Envelope {
  if (run.envelope) return run.envelope;
  const detail = [
    `jolly ${run.args.join(" ")} produced no parseable output envelope (feature 020).`,
    cliImplemented() ? "" : `Note: ${cliEntry} does not exist yet (CLI not implemented).`,
    `exit code: ${run.exitCode}`,
    `stdout: ${run.stdout.slice(0, 2000) || "(empty)"}`,
    `stderr: ${run.stderr.slice(0, 2000) || "(empty)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  throw new Error(detail);
}
