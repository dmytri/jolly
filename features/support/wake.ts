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
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 * the project's own cucumber install by walking up to the repo root, and it
 * carries its own config, so the project's hooks and support are not loaded into
 * the inner run.
 */
export function fixtureTier(label: string): FixtureTier {
  const dir = join(REPO_ROOT, "coverage", "weather", `fixture-${process.pid}-${label}`);
  const remove = () => rmSync(dir, { recursive: true, force: true });
  // The commands write their record under a cwd-relative coverage/weather path.
  mkdirSync(join(dir, "coverage", "weather"), { recursive: true });
  writeFileSync(join(dir, "fixture.feature"), FIXTURE_FEATURE, "utf8");
  writeFileSync(join(dir, "fixture-steps.mjs"), FIXTURE_STEPS, "utf8");
  const profile = {
    paths: ["fixture.feature"],
    import: ["fixture-steps.mjs"],
  };
  writeFileSync(
    join(dir, "cucumber.mjs"),
    [
      `const profile = ${JSON.stringify(profile)};`,
      "export default profile;",
      "export const logic = profile;",
      "export const sandbox = profile;",
      "export const sandboxSerial = profile;",
      "const evalProfile = profile;",
      "export { evalProfile as eval };",
      "export const all = profile;",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    dir,
    scenarioNames: [
      "A fixture scenario that costs a little",
      "A second fixture scenario that costs a little",
    ],
    remove,
  };
}

export interface TierRun {
  /** The wake record the command wrote, absolute; absent when it wrote none. */
  recordPath?: string;
  exitCode: number | null;
  output: string;
}

/** Run a tier command exactly as configured, against the fixture tier. */
export function runTierCommand(tier: FixtureTier, command: TierCommand): TierRun {
  const run = spawnSync("sh", ["-c", command.command], {
    cwd: tier.dir,
    encoding: "utf8",
    timeout: 120_000,
    // The command is verbatim; only the environment names where its `npx`
    // resolves the project's own cucumber, so the run installs nothing.
    env: {
      ...process.env,
      PATH: `${join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    },
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
