// Verification support for the methodology-conformance scenario "A credentialed
// tier fails loudly when its credential is absent" (@logic @invariant).
//
// Credentials are fitted, never gated on. A tier that SKIPS itself when its
// credential is absent reports green while proving nothing, so absence must be
// loud: the run fails and names the missing input as the fitting-out blocker it
// needs (feature 025's "fail loudly when its inputs are absent" Rule; the @eval
// tier policy in RIGGING.md).
//
// The check runs the tier's configured command VERBATIM, exactly as RIGGING.md
// carries it, against the REAL project rather than a fixture tier: the gate under
// test lives in the project's own hooks, and a fixture tier carries its own
// cucumber config, so it would never load them. The credential is produced ABSENT
// for real — no key material reaches the child — never substituted with a dummy
// value (AGENTS.md, "Real services always").
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EVAL_SPEND_LEDGER_PATH } from "./eval-spend-ledger.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { runId } from "./sandbox.ts";
import { readTierCommands, type TierCommand } from "./wake.ts";

/**
 * The command that RUNS the named tier, as `RIGGING.md` configures it: the
 * tier's `broad-<tier>` entry under `## Commands`.
 */
export function tierCommand(
  riggingFile: string,
  tier: string,
): TierCommand | undefined {
  return readTierCommands(riggingFile).find(
    (command) => command.key === `broad-${tier}`,
  );
}

export interface CredentiallessRun {
  exitCode: number | null;
  output: string;
  /** True when the run outran its budget instead of failing fast. */
  timedOut: boolean;
}

/**
 * Run the tier command with the credential genuinely absent.
 *
 * The credential is passed EMPTY rather than deleted, and that is what makes the
 * absence stick: `support/dotenv.ts` fills any key that is `undefined` in the
 * child environment from the repository `.env`, which on a fitted-out machine
 * carries this very credential — so a deleted key would be handed straight back,
 * the run would go fully credentialed, and the check would pass while proving
 * nothing. An empty value is not a dummy credential: it is no key material at
 * all, and every reader of it (`support/eval.ts` modelApiKey) treats empty and
 * unset alike, as absent. A truly unfitted machine reaches the same gate by the
 * same path.
 *
 * The budget is a failure ceiling, not a wait: a tier that fails loudly on an
 * absent credential fails in seconds, and one that runs its agent instead blows
 * the budget and reports `timedOut`.
 */
export function runTierWithoutCredential(options: {
  command: TierCommand;
  credential: string;
  /** Directory the eval harness persists one subdirectory into per agent run. */
  transcriptDir: string;
  budgetMs: number;
}): CredentiallessRun {
  const { command, credential, transcriptDir, budgetMs } = options;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env[credential] = "";
  // The inner run shares this run's namespace, so the start-of-run reclamation it
  // performs (hooks.ts BeforeAll) reads this run's resources as its own and leaves
  // them standing, rather than reclaiming them out from under the outer run.
  env.HARNESS_RUN_ID = runId();
  // The eval harness persists one subdirectory here per baseline-agent run
  // (support/eval.ts persistEvalTranscript), so this directory is the observable
  // record of whether the model-invoking seam was ever reached.
  env.HARNESS_EVAL_TRANSCRIPT_DIR = transcriptDir;

  const run = spawnSync("sh", ["-c", command.command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: budgetMs,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exitCode: run.status,
    output: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
    timedOut:
      (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
  };
}

/**
 * Preserve the tier's wake record and return the restore. The tier command owns
 * that record (RIGGING.md), and it runs here against the real project, so an
 * unfitted run would otherwise overwrite the tier's real yesterday's-weather with
 * a run that only proved a fitting-out blocker.
 */
export function preserveWakeRecord(command: TierCommand): () => void {
  if (command.recordPath === undefined) return () => {};
  // The tier's own message stream, and the spend ledger the same nested run
  // appends to. Both are real wake artifacts every wake reader joins on, so a
  // credential-less rehearsal must leave neither changed.
  const paths = [join(REPO_ROOT, command.recordPath), EVAL_SPEND_LEDGER_PATH];
  const saved = paths.map((path) => {
    if (!existsSync(path)) return { path, content: undefined };
    const stats = statSync(path);
    return { path, content: readFileSync(path), atime: stats.atime, mtime: stats.mtime };
  });
  return () => {
    for (const entry of saved) {
      if (entry.content === undefined) {
        rmSync(entry.path, { force: true });
        continue;
      }
      writeFileSync(entry.path, entry.content);
      // Restore the timestamps too. A leg's run window ENDS at its record's
      // mtime, so restoring content alone leaves the old run's wall clock
      // hanging off a new mtime: a phantom window over a run that never
      // happened, in which the real run's run-end no longer sits. That reads
      // downstream as a broken or disarmed recorder.
      utimesSync(entry.path, entry.atime!, entry.mtime!);
    }
  };
}

/** The baseline-agent runs the eval harness persisted: one subdirectory each. */
export function persistedAgentRuns(transcriptDir: string): string[] {
  if (!existsSync(transcriptDir)) return [];
  return readdirSync(transcriptDir);
}

export interface ScenarioSummary {
  /** The cucumber scenario summary line, such as `2 scenarios (2 failed)`. */
  line: string;
  total: number;
  /** The scenario counts by result, such as `{ failed: 2 }`. */
  counts: Record<string, number>;
}

/** Cucumber's scenario summary line: `<n> scenarios (<n> failed, <n> skipped)`. */
const SUMMARY = /^(\d+) scenarios?(?: \(([^)]*)\))?$/m;

/**
 * The run's scenario summary. This reads the SCENARIO line, never the step line:
 * a run whose scenarios fail in a Before hook reports its steps as skipped, and
 * what the tier must never do is skip a SCENARIO.
 */
export function scenarioSummary(output: string): ScenarioSummary | undefined {
  const match = SUMMARY.exec(output);
  if (!match) return undefined;
  const counts: Record<string, number> = {};
  for (const part of (match[2] ?? "").split(",")) {
    const entry = /(\d+)\s+(\w+)/.exec(part.trim());
    if (entry) counts[entry[2]!] = Number(entry[1]);
  }
  return { line: match[0], total: Number(match[1]), counts };
}
