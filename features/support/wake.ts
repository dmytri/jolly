// Verification support for the verification-economy scenario "A tier run through
// its configured command writes that tier's wall-clock record" (@logic @invariant).
//
// Per RIGGING.md, every tier command carries `--format message:coverage/weather/
// <tier>.ndjson`, so a tier run writes its own cucumber message stream by
// construction. That stream is the per-scenario record: a scenario's wall-clock
// duration is the span between its testCaseStarted and testCaseFinished
// timestamps, and its name comes from the pickle the test case was built from.
// Yesterday's weather is read from it, and the harbour verification-economy audit
// reads per-scenario duration from it, so a scenario missing from the record is a
// cost no one pays attention to.
//
// The command owns the write, so the check runs a configured tier command
// VERBATIM, exactly as RIGGING.md carries it, rather than a hand-written
// invocation that only resembles one: a command whose record-writing flag was
// dropped is the failure this check exists to catch, and a hand-written
// invocation cannot see it. The command runs against a fixture tier — a scratch
// project carrying the tier profile names and two cheap scenarios — so the real
// command is exercised without re-running a real tier from inside one.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./repo-root.ts";

export interface ScenarioCost {
  name: string;
  /** Wall-clock nanoseconds between the scenario's start and finish. */
  durationNs: number;
}

export interface WakeRecord {
  /** Every scenario that ran, with the wall-clock cost it recorded. */
  scenarios: ScenarioCost[];
  /** Scenarios the run started that carry no wall-clock duration. */
  unrecorded: string[];
}

interface Timestamp {
  seconds: number;
  nanos: number;
}

function toNanos(timestamp: Timestamp): number {
  return timestamp.seconds * 1_000_000_000 + timestamp.nanos;
}

/**
 * Read a tier run's message stream as the per-scenario record: every scenario
 * that ran, and the wall-clock duration it carries. A scenario the run started
 * but the record does not finish is reported unrecorded. A run that wrote no
 * record at all reports `undefined`: the check has nothing to read.
 */
export function readWakeRecord(recordPath: string): WakeRecord | undefined {
  if (!existsSync(recordPath)) return undefined;
  const pickleNames = new Map<string, string>();
  const testCasePickles = new Map<string, string>();
  const startedAt = new Map<string, { testCaseId: string; nanos: number }>();
  const finishedAt = new Map<string, number>();

  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.pickle) pickleNames.set(message.pickle.id, message.pickle.name);
    if (message.testCase) {
      testCasePickles.set(message.testCase.id, message.testCase.pickleId);
    }
    if (message.testCaseStarted) {
      startedAt.set(message.testCaseStarted.id, {
        testCaseId: message.testCaseStarted.testCaseId,
        nanos: toNanos(message.testCaseStarted.timestamp),
      });
    }
    if (message.testCaseFinished) {
      finishedAt.set(
        message.testCaseFinished.testCaseStartedId,
        toNanos(message.testCaseFinished.timestamp),
      );
    }
  }

  const scenarios: ScenarioCost[] = [];
  const unrecorded: string[] = [];
  for (const [startedId, started] of startedAt) {
    const pickleId = testCasePickles.get(started.testCaseId);
    const name = (pickleId && pickleNames.get(pickleId)) ?? started.testCaseId;
    const finished = finishedAt.get(startedId);
    if (finished === undefined) {
      unrecorded.push(name);
      continue;
    }
    scenarios.push({ name, durationNs: finished - started.nanos });
  }
  return { scenarios, unrecorded };
}

export interface TierCommand {
  /** The RIGGING.md command key, such as `broad` or `coverage-sandbox`. */
  key: string;
  /** The command as configured, verbatim. */
  command: string;
  /** The wake record the command writes, cwd-relative; absent when it writes none. */
  recordPath?: string;
}

/** The command keys that run a tier, and so own their tier's wake record. */
const TIER_COMMAND_KEY = /^(broad|coverage)(-[a-z-]+)?$/;
/** A RIGGING.md value line: `- <key>: \`<command>\`` and optional trailing prose. */
const VALUE_LINE = /^- ([a-z-]+): `(.+?)`/;
/** The record-writing flag a tier command carries. */
const RECORD_FLAG = /--format message:(\S+)/;

/**
 * The tier commands as `RIGGING.md` configures them, read from `## Commands`.
 */
export function readTierCommands(riggingFile: string): TierCommand[] {
  const text = readFileSync(join(REPO_ROOT, riggingFile), "utf8");
  const commands: TierCommand[] = [];
  let inCommands = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inCommands = line.trim() === "## Commands";
      continue;
    }
    if (!inCommands) continue;
    const value = VALUE_LINE.exec(line.trim());
    if (!value) continue;
    const [, key, command] = value as unknown as [string, string, string];
    if (!TIER_COMMAND_KEY.test(key)) continue;
    commands.push({ key, command, recordPath: RECORD_FLAG.exec(command)?.[1] });
  }
  return commands;
}

/** The same command with its record-writing flag dropped: the planted red. */
export function withoutRecordWrite(command: TierCommand): TierCommand {
  return {
    key: `${command.key} (record write dropped)`,
    command: command.command.replace(RECORD_FLAG, "").replace(/\s{2,}/g, " "),
    recordPath: undefined,
  };
}

export interface FixtureTier {
  /** The scratch project the tier command runs in. */
  dir: string;
  /** The scenarios the fixture tier runs. */
  scenarioNames: string[];
  /** Remove the fixture project and anything a run wrote into it. */
  remove: () => void;
}

// Each fixture scenario spends a little real time, so it carries a wall-clock
// duration the record must show: a step that costs nothing spans no measurable
// tick and would prove nothing about what the record captures.
const FIXTURE_FEATURE = `Feature: Fixture tier

  @logic @sandbox @eval
  Scenario: A fixture scenario that costs a little
    Given the fixture step runs

  @logic @sandbox @eval
  Scenario: A second fixture scenario that costs a little
    Given the fixture step runs
`;

const FIXTURE_STEPS = `import { Given } from "@cucumber/cucumber";
import { setTimeout as wait } from "node:timers/promises";
Given("the fixture step runs", async function () {
  await wait(25);
});
`;

/**
 * A scratch project a configured tier command runs against: it carries the tier
 * profile names the commands select with `-p`, and a two-scenario fixture in
 * place of a real tier. It sits inside the wake (git-ignored) so a run resolves
 * the project's own cucumber install by walking up to the repo root. Its
 * profiles override `paths` and `import`, so the project's hooks and support
 * are not loaded into the inner run — but by default they EXTEND the real
 * project run config, so the config-load machinery a tier command really loads
 * (the pressure recorder, the weather-derived worker counts) runs in the
 * fixture run exactly as in a real one: a real command whose config stopped
 * recording reddens here rather than passing against a fixture that records on
 * its own. `wireRunConfig: false` is the planted-red form — the same command
 * over a config with no recording machinery.
 */
export function fixtureTier(
  label: string,
  options: { wireRunConfig?: boolean } = {},
): FixtureTier {
  const wire = options.wireRunConfig ?? true;
  const dir = join(REPO_ROOT, "coverage", "weather", `fixture-${process.pid}-${label}`);
  const remove = () => rmSync(dir, { recursive: true, force: true });
  // The commands write their record under a cwd-relative coverage/weather path.
  mkdirSync(join(dir, "coverage", "weather"), { recursive: true });
  writeFileSync(join(dir, "fixture.feature"), FIXTURE_FEATURE, "utf8");
  writeFileSync(join(dir, "fixture-steps.mjs"), FIXTURE_STEPS, "utf8");
  const overrides = {
    paths: ["fixture.feature"],
    import: ["fixture-steps.mjs"],
  };
  const config = wire
    ? [
        `import * as base from ${JSON.stringify(pathToFileURL(join(REPO_ROOT, "cucumber.js")).href)};`,
        `const overrides = ${JSON.stringify(overrides)};`,
        "export default { ...base.default, ...overrides };",
        "export const logic = { ...base.logic, ...overrides };",
        "export const sandbox = { ...base.sandbox, ...overrides };",
        "export const sandboxSerial = { ...base.sandboxSerial, ...overrides };",
        "const evalProfile = { ...base.eval, ...overrides };",
        "export { evalProfile as eval };",
        "export const all = { ...base.all, ...overrides };",
        "",
      ].join("\n")
    : [
        `const profile = ${JSON.stringify(overrides)};`,
        "export default profile;",
        "export const logic = profile;",
        "export const sandbox = profile;",
        "export const sandboxSerial = profile;",
        "const evalProfile = profile;",
        "export { evalProfile as eval };",
        "export const all = profile;",
        "",
      ].join("\n");
  writeFileSync(join(dir, "cucumber.mjs"), config, "utf8");
  return {
    dir,
    scenarioNames: [
      "A fixture scenario that costs a little",
      "A second fixture scenario that costs a little",
    ],
    remove,
  };
}

// ─── Tier budgets (the verification-economy budget scenario) ────────────────

export interface TierBudgets {
  /** The plain full-regression ceiling, in seconds. */
  plainSeconds?: number;
  /** Per-tier ceilings, keyed by the kebab-case tier name, in seconds. */
  perTierSeconds: Record<string, number>;
}

/** A `## Tiers` budget line: `- budget: 1200` or `- budget-<tier>: 210`. */
const BUDGET_LINE = /^- budget(-[a-z-]+)?: (\d+)/;

/** The tier budgets as `RIGGING.md` configures them, read from `## Tiers`. */
export function readTierBudgets(riggingFile: string): TierBudgets {
  const text = readFileSync(join(REPO_ROOT, riggingFile), "utf8");
  const budgets: TierBudgets = { perTierSeconds: {} };
  let inTiers = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inTiers = line.trim() === "## Tiers";
      continue;
    }
    if (!inTiers) continue;
    const value = BUDGET_LINE.exec(line.trim());
    if (!value) continue;
    const [, suffix, seconds] = value;
    if (suffix === undefined) budgets.plainSeconds = Number(seconds);
    else budgets.perTierSeconds[suffix.slice(1)] = Number(seconds);
  }
  return budgets;
}

/**
 * The plain full-regression wall-clock budget from `RIGGING.md`, in
 * milliseconds. This is the staleness threshold reclamation's age gate uses
 * (feature 030): no live invocation can be older than the whole regression's
 * ceiling, so a namespaced leftover older than this belongs to no live run.
 * Loud when absent: an age gate with no threshold would either reclaim a live
 * sibling's resources or protect every leftover forever.
 */
export function fullRegressionBudgetMs(riggingFile = "RIGGING.md"): number {
  const budgets = readTierBudgets(riggingFile);
  if (budgets.plainSeconds === undefined) {
    throw new Error(
      `${riggingFile} configures no plain full-regression budget under "## Tiers" ` +
        `(a "- budget: <seconds>" line); the reclamation age gate needs it`,
    );
  }
  return budgets.plainSeconds * 1000;
}

/** The kebab-case tier name a record path carries: `sandboxSerial` → `sandbox-serial`. */
export function tierNameFromRecordPath(recordPath: string): string {
  const base = recordPath.split("/").pop() ?? recordPath;
  return base
    .replace(/\.ndjson$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

export interface TierClock {
  /** The kebab-case tier name, matching the `budget-<tier>` key. */
  tier: string;
  recordPath: string;
  /** The run's wall clock, testRunStarted to testRunFinished, in seconds. */
  seconds: number;
}

/**
 * The wall clock of the run a tier's wake record carries: the span between its
 * testRunStarted and testRunFinished timestamps. Undefined when the record is
 * absent or carries no complete run.
 */
export function readTierWallClock(recordPath: string): TierClock | undefined {
  if (!existsSync(recordPath)) return undefined;
  let startedNs: number | undefined;
  let finishedNs: number | undefined;
  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let message: {
      testRunStarted?: { timestamp: Timestamp };
      testRunFinished?: { timestamp: Timestamp };
    };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.testRunStarted) startedNs = toNanos(message.testRunStarted.timestamp);
    if (message.testRunFinished) finishedNs = toNanos(message.testRunFinished.timestamp);
  }
  if (startedNs === undefined || finishedNs === undefined) return undefined;
  return {
    tier: tierNameFromRecordPath(recordPath),
    recordPath,
    seconds: (finishedNs - startedNs) / 1_000_000_000,
  };
}

/**
 * The run window a completed tier record occupies: its wall clock, ending at
 * the record file's last write. Undefined while the record is absent or
 * carries no completed run.
 */
export function recordRunWindow(
  recordPath: string,
): { startMs: number; endMs: number } | undefined {
  const clock = readTierWallClock(recordPath);
  if (!clock) return undefined;
  const endMs = statSync(recordPath).mtimeMs;
  return { startMs: endMs - clock.seconds * 1000, endMs };
}

/** One profile leg of the sandbox tier's last sweep: the leg's latest
 * completed record, as the run window a run-scoped ledger reader joins on. */
export interface SweepLegWindow {
  /** The kebab-case leg name, such as `sandbox` or `sandbox-serial`. */
  tier: string;
  recordPath: string;
  startMs: number;
  endMs: number;
}

/**
 * Every profile leg of the sandbox tier's last sweep: the sandbox-family
 * record paths the configured tier commands own, grouped by leg name, each
 * leg's latest completed record standing as that leg's run window. A leg whose
 * record carries no completed run is not part of the last sweep and
 * contributes no window.
 */
export function sandboxSweepLegWindows(commands: TierCommand[]): SweepLegWindow[] {
  const paths = new Set<string>();
  for (const command of commands) {
    if (!/^(broad|coverage)-sandbox/.test(command.key)) continue;
    if (command.recordPath) paths.add(command.recordPath);
  }
  const legs = new Map<string, SweepLegWindow>();
  for (const recordPath of paths) {
    const window = recordRunWindow(join(REPO_ROOT, recordPath));
    if (!window) continue;
    const tier = tierNameFromRecordPath(recordPath);
    const current = legs.get(tier);
    if (!current || window.endMs > current.endMs) {
      legs.set(tier, { tier, recordPath, ...window });
    }
  }
  return [...legs.values()];
}

export interface BudgetViolation {
  tier: string;
  budgetSeconds: number;
  recordedSeconds: number;
  message: string;
}

export interface BudgetJudgment {
  /** Tiers whose recorded wall clock exceeds their budget. */
  perTier: BudgetViolation[];
  /** The tier records summed, in seconds. */
  sumSeconds: number;
  /** The summed-records breach of the plain budget, when one exists. */
  sum?: BudgetViolation;
}

/** Compare each tier's recorded wall clock, and their sum, to the budgets. */
export function checkTierBudgets(
  budgets: TierBudgets,
  clocks: TierClock[],
): BudgetJudgment {
  const perTier: BudgetViolation[] = [];
  for (const clock of clocks) {
    const budgetSeconds = budgets.perTierSeconds[clock.tier];
    if (budgetSeconds !== undefined && clock.seconds > budgetSeconds) {
      perTier.push({
        tier: clock.tier,
        budgetSeconds,
        recordedSeconds: clock.seconds,
        message:
          `the ${clock.tier} tier recorded ${clock.seconds.toFixed(1)}s against ` +
          `its ${budgetSeconds}s budget`,
      });
    }
  }
  const sumSeconds = clocks.reduce((sum, clock) => sum + clock.seconds, 0);
  const judgment: BudgetJudgment = { perTier, sumSeconds };
  if (budgets.plainSeconds !== undefined && sumSeconds > budgets.plainSeconds) {
    judgment.sum = {
      tier: "(all tiers summed)",
      budgetSeconds: budgets.plainSeconds,
      recordedSeconds: sumSeconds,
      message:
        `the tier records summed reach ${sumSeconds.toFixed(1)}s against the ` +
        `plain ${budgets.plainSeconds}s regression budget`,
    };
  }
  return judgment;
}

export interface TierRun {
  /** The wake record the command wrote, absolute; absent when it wrote none. */
  recordPath?: string;
  exitCode: number | null;
  output: string;
}

/** Run a tier command exactly as configured, against the fixture tier. */
export function runTierCommand(tier: FixtureTier, command: TierCommand): TierRun {
  // The command is verbatim; only the environment names where its `npx`
  // resolves the project's own cucumber, so the run installs nothing. The
  // spawned command is a FRESH coordinating invocation, never a worker of the
  // run that spawned it, so the inherited cucumber worker id is dropped: kept,
  // it would disarm the inner run's config-load machinery (the pressure
  // recorder guards against recording from worker children).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
  };
  delete env.CUCUMBER_WORKER_ID;
  const run = spawnSync("sh", ["-c", command.command], {
    cwd: tier.dir,
    encoding: "utf8",
    timeout: 120_000,
    env,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (run.status !== 0) {
    throw new Error(
      `the tier command "${command.key}" failed (exit ${run.status}):\n${command.command}\n${output}`,
    );
  }
  return {
    recordPath: command.recordPath && join(tier.dir, command.recordPath),
    exitCode: run.status,
    output,
  };
}
