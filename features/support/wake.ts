// Verification support for the verification-economy scenario "Every scenario
// that runs records its wall-clock cost" (@logic @invariant).
//
// Every tier run writes its cucumber message stream into the wake
// (coverage/weather/<tier>.ndjson, per RIGGING.md). That stream is the
// per-scenario record: each scenario's wall-clock duration is the span between
// its testCaseStarted and testCaseFinished timestamps, and its name comes from
// the pickle the test case was built from. Yesterday's weather is read from it,
// and the harbour verification-economy audit reads per-scenario duration from
// it, so a scenario missing from the record is a cost that no one pays
// attention to.
//
// The check reads a record produced by a REAL completed cucumber run: the
// scenario provisions one over a small fixture in the wake, so the reader is
// exercised against the same message stream the tiers write, with no dependence
// on which tier last ran.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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
 * but the record does not finish is reported unrecorded.
 */
export function readWakeRecord(recordPath: string): WakeRecord {
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

/** A record with one scenario's finish struck out: the planted red. */
export function recordWithScenarioDropped(
  recordPath: string,
  droppedPath: string,
): string {
  const lines = readFileSync(recordPath, "utf8").split("\n").filter(Boolean);
  const firstFinish = lines.findIndex((line) => JSON.parse(line).testCaseFinished);
  if (firstFinish === -1) {
    throw new Error(`${recordPath} records no finished scenario to drop`);
  }
  const dropped = JSON.parse(lines[firstFinish]!).testCaseFinished;
  writeFileSync(
    droppedPath,
    lines.filter((_, index) => index !== firstFinish).join("\n"),
    "utf8",
  );
  return dropped.testCaseStartedId;
}

export interface FixtureTierRun {
  /** The message stream the run wrote: the wake's per-scenario record. */
  recordPath: string;
  /** The scenarios the fixture tier runs, in file order. */
  scenarioNames: string[];
  /** Remove the fixture and its record. */
  remove: () => void;
}

const FIXTURE_FEATURE = `Feature: Fixture tier
  Scenario: A fixture scenario that costs a little
    Given the fixture step runs
  Scenario: A second fixture scenario that costs a little
    Given the fixture step runs
`;

// The fixture step spends a little real time, so each fixture scenario carries a
// wall-clock duration the record must show: a step that costs nothing spans no
// measurable tick and would prove nothing about what the record captures.
const FIXTURE_STEPS = `import { Given } from "@cucumber/cucumber";
import { setTimeout as wait } from "node:timers/promises";
Given("the fixture step runs", async function () {
  await wait(25);
});
`;

/**
 * Run a real cucumber tier over a two-scenario fixture, writing its message
 * stream exactly as a tier run writes its record into the wake. The fixture
 * lives in the wake (git-ignored) so its steps resolve the project's cucumber
 * install, and it carries its own config so the project's own hooks and support
 * are not loaded into the inner run.
 */
export function runFixtureTier(): FixtureTierRun {
  const dir = join(REPO_ROOT, "coverage", "weather", `fixture-${process.pid}`);
  const remove = () => rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const featurePath = join(dir, "fixture.feature");
  const stepsPath = join(dir, "fixture-steps.mjs");
  const configPath = join(dir, "fixture-cucumber.mjs");
  const recordPath = join(dir, "record.ndjson");
  writeFileSync(featurePath, FIXTURE_FEATURE, "utf8");
  writeFileSync(stepsPath, FIXTURE_STEPS, "utf8");
  writeFileSync(
    configPath,
    `export default ${JSON.stringify({
      paths: [featurePath],
      import: [stepsPath],
      format: [`message:${recordPath}`],
    })};\n`,
    "utf8",
  );

  // Cucumber resolves --config against the cwd, so name it relative to the root.
  const run = spawnSync("npx", ["cucumber-js", "--config", relative(REPO_ROOT, configPath)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (run.status !== 0) {
    throw new Error(
      `the fixture tier run failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`,
    );
  }
  return {
    recordPath,
    scenarioNames: [
      "A fixture scenario that costs a little",
      "A second fixture scenario that costs a little",
    ],
    remove,
  };
}
