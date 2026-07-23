// Verification support for feature verification-economy's Rule "Every tier
// that can spend records a ledger": the @eval tier's spend ledger.
//
// The @eval tier drives a live baseline agent over the real Jolly CLI, and the
// expensive service effects that CLI would produce are served from the golden
// captures (feature 025, "Live agent, golden-captured services"). "Served from
// a capture" is a claim about what the run actually spawned, so it is recorded
// at run time rather than asserted from prose: the eval PATH shims already log
// argv and then either replay a capture or exec the real binary, so each shim
// branch appends one ledger entry carrying WHICH branch it took.
//
// The ledger lives in the wake (git-ignored coverage/weather/), one JSON object
// per line, appended across invocations; readers select one run by its run id.
// An eval tier-record run appends a run-end entry at its coordinating process's
// exit (armEvalRunEndRecording, wired in cucumber.js), so completion is legible
// in the ledger itself and readers stay run-scoped, per the feature's Rule "The
// wake is read run-scoped".
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { messageRecordPathFromArgv } from "./pressure.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { runId } from "./sandbox.ts";

/** The wake path of the eval spend ledger. */
export const EVAL_SPEND_LEDGER_PATH = join(
  REPO_ROOT,
  "coverage",
  "weather",
  "eval-spend-ledger.ndjson",
);

/**
 * The expensive external commands an eval run can spawn: the managed skill
 * installs `jolly init` drives through `npx skills add`, the configurator
 * deploy, the storefront clone and its install, and the Vercel deploy. Each is
 * served from a golden capture in this tier; a live one is the finding.
 */
const EVAL_EXPENSIVE_SPENDS = [
  "skills-install",
  "configurator-deploy",
  "git-clone",
  "pnpm-install",
  "vercel-deploy",
] as const;

type EvalSpendKind = (typeof EVAL_EXPENSIVE_SPENDS)[number] | "run-start" | "run-end";

/** How the spend was answered: replayed from a golden capture, or run for real. */
type SpendService = "capture" | "live";

export interface EvalSpendEntry {
  /** The run id (HARNESS_RUN_ID) the spend belongs to. */
  run: string;
  tier: "eval";
  /** Epoch milliseconds at which the spend was recorded. */
  at: number;
  /** The scenario the spend is attributed to. */
  scenario: string;
  spend: EvalSpendKind;
  served: SpendService;
  /** The intercepted argv, for observability and for naming the command. */
  argv?: string[];
}

/**
 * The recording snippet baked into every eval PATH shim. The shims are
 * generated JavaScript running in the agent's own child processes, so the
 * recorder travels with them as source rather than as an import: they run
 * under the agent's throwaway $HOME with no module resolution back into this
 * tree. `fs` is already required by every shim that embeds this.
 */
export function evalLedgerShimPrelude(runIdentifier: string = runId()): string {
  return `
const EVAL_LEDGER = ${JSON.stringify(EVAL_SPEND_LEDGER_PATH)};
const EVAL_RUN = ${JSON.stringify(runIdentifier)};
function recordEvalSpend(spend, served, spendArgv) {
  try {
    fs.appendFileSync(EVAL_LEDGER, JSON.stringify({
      run: EVAL_RUN,
      tier: "eval",
      at: Date.now(),
      scenario: process.env.HARNESS_SPEND_SCENARIO || "(unattributed)",
      spend: spend,
      served: served,
      argv: spendArgv,
    }) + "\\n");
  } catch {}
}
function classifyEvalNpxSpend(pkg, rest) {
  if (!pkg) return undefined;
  const name = String(pkg).replace(/^(@?[^@]+(?:\\/[^@]+)?)@.*$/, "$1");
  if (name === "skills") return "skills-install";
  if (name === "@saleor/configurator") return "configurator-deploy";
  if (name === "vercel") return "vercel-deploy";
  if (name === "pnpm") return (rest || []).includes("install") ? "pnpm-install" : undefined;
  return undefined;
}
`;
}

/** Append one entry from this process (run-start, run-end). */
function appendEvalEntry(entry: EvalSpendEntry): void {
  try {
    mkdirSync(join(REPO_ROOT, "coverage", "weather"), { recursive: true });
    appendFileSync(EVAL_SPEND_LEDGER_PATH, JSON.stringify(entry) + "\n");
  } catch (error) {
    // Loud, not fatal: a run missing its trace never reads as completed, which
    // is exactly what the ledger-presence check reddens on.
    process.stderr.write(`eval ledger write failed: ${String(error)}\n`);
  }
}

let evalRunStartRecorded = false;

/**
 * Arm eval spend recording for this scenario: export the attribution the shims
 * read, and record one run-start entry per worker process, so an eval run
 * always leaves a ledger trace even when every spend was served from a capture
 * and nothing else was spawned.
 */
export function armEvalSpendRecording(scenario: string): void {
  process.env.HARNESS_SPEND_SCENARIO = scenario;
  if (evalRunStartRecorded) return;
  appendEvalEntry({
    run: runId(),
    tier: "eval",
    at: Date.now(),
    scenario: "(run)",
    spend: "run-start",
    served: "live",
  });
  evalRunStartRecorded = true;
}

/** True when this process's argv selects the eval profile. */
function evalProfileSelected(argv: readonly string[]): boolean {
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-p" || arg === "--profile") profile = argv[i + 1];
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
  }
  return profile === "eval";
}

/**
 * Arm run-end recording for this run: an eval tier-record run appends one
 * `run-end` entry at its coordinating process's exit, so a run-scoped reader
 * can tell a completed run from a live sibling's partial one. Mirrors the
 * sandbox ledger's gates: a worker child, a run naming no `message:<path>`
 * record target, and every non-eval profile arm nothing.
 */
export function armEvalRunEndRecording(): void {
  if (process.env.CUCUMBER_WORKER_ID !== undefined) return; // worker child
  if (messageRecordPathFromArgv(process.argv) === undefined) return; // not a tier-record run
  if (!evalProfileSelected(process.argv)) return;
  process.on("exit", () => {
    appendEvalEntry({
      run: runId(),
      tier: "eval",
      at: Date.now(),
      scenario: "(run)",
      spend: "run-end",
      served: "live",
    });
  });
}

// ─── Reading and judging the ledger ─────────────────────────────────────────

/** Every parseable entry of the eval ledger, in append order. */
export function readEvalSpendLedger(
  path: string = EVAL_SPEND_LEDGER_PATH,
): EvalSpendEntry[] {
  if (!existsSync(path)) return [];
  const entries: EvalSpendEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as EvalSpendEntry;
      if (
        typeof entry.run === "string" &&
        typeof entry.spend === "string" &&
        (entry.served === "capture" || entry.served === "live")
      ) {
        entries.push(entry);
      }
    } catch {
      // A malformed line is void, never a crash.
    }
  }
  return entries;
}

/**
 * The entries of the ledger's most recent COMPLETED eval run: the latest run id
 * carrying a `run-end` entry. A live sibling appends entries but no `run-end`
 * until it exits, so its partial run is never selected. Where the whole ledger
 * carries no `run-end`, the last entry's run id stands.
 */
export function lastEvalRunEntries(entries: EvalSpendEntry[]): EvalSpendEntry[] {
  let completed: string | undefined;
  for (const entry of entries) {
    if (entry.spend === "run-end") completed = entry.run;
  }
  if (completed === undefined) {
    const last = entries[entries.length - 1];
    if (!last) return [];
    completed = last.run;
  }
  return entries.filter((entry) => entry.run === completed);
}

/** The command line a ledger entry recorded, as the shim observed it. */
function evalSpendCommandLine(entry: EvalSpendEntry): string {
  const argv = entry.argv ?? [];
  return argv.length > 0 ? argv.join(" ") : entry.spend;
}

export interface LiveSpendViolation {
  scenario: string;
  spend: EvalSpendKind;
  command: string;
  message: string;
}

/**
 * Every expensive spend the eval run answered LIVE rather than from a golden
 * capture, restricted to the spend kinds asked about. The message names the
 * command and the scenario that made it, so the red says what to capture.
 */
export function liveExpensiveSpends(
  entries: EvalSpendEntry[],
  kinds: readonly EvalSpendKind[] = EVAL_EXPENSIVE_SPENDS,
): LiveSpendViolation[] {
  const violations: LiveSpendViolation[] = [];
  for (const entry of entries) {
    if (entry.served !== "live") continue;
    if (!kinds.includes(entry.spend)) continue;
    const command = evalSpendCommandLine(entry);
    violations.push({
      scenario: entry.scenario,
      spend: entry.spend,
      command,
      message:
        `the eval tier ran \`${command}\` live (${entry.spend}) for scenario ` +
        `"${entry.scenario}"; this tier serves every expensive external command ` +
        `from the golden captures recorded by the licensed @pipeline sandbox runs`,
    });
  }
  return violations;
}
