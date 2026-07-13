// Feature verification-economy — two derived checks that make the cost of the
// suite observable (@logic @invariant):
//   - every scenario that runs records its wall-clock cost into the wake, and
//   - an interactive scenario waits for the prompt it is answering rather than
//     for a guessed delay.
// Both are verification support; each is proven honest by a planted red inside
// its own scenario.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";
import {
  readWakeRecord,
  recordWithScenarioDropped,
  runFixtureTier,
  type FixtureTierRun,
  type WakeRecord,
} from "../support/wake.ts";
import {
  findGuessedDelayWaits,
  type InjectedSource,
  type WaitViolation,
} from "../support/interactive-waits.ts";

Given("a completed tier run", { timeout: 130_000 }, function (this: JollyWorld) {
  // Teardown registered before creation, loud on failure via the registry.
  let run: FixtureTierRun | undefined;
  this.cleanup.register("wake fixture tier run", () => run?.remove());
  run = runFixtureTier();
  this.notes.tierRun = run;
});

When("the wake's per-scenario record is read", function (this: JollyWorld) {
  const run = this.notes.tierRun as FixtureTierRun;
  this.notes.wakeRecord = readWakeRecord(run.recordPath);
});

Then(
  "every scenario that ran should carry its wall-clock duration",
  function (this: JollyWorld) {
    const run = this.notes.tierRun as FixtureTierRun;
    const record = this.notes.wakeRecord as WakeRecord;
    assert.deepEqual(
      record.unrecorded,
      [],
      `scenarios that ran but carry no wall-clock duration: ${record.unrecorded.join(", ")}`,
    );
    for (const name of run.scenarioNames) {
      const cost = record.scenarios.find((scenario) => scenario.name === name);
      assert.ok(cost, `the record carries no entry for the scenario "${name}"`);
      assert.ok(
        cost.durationNs > 0,
        `the scenario "${name}" records a wall-clock duration of ${cost.durationNs}ns`,
      );
    }
  },
);

Then(
  "a scenario present in the run but absent from the record should redden the check",
  function (this: JollyWorld) {
    const run = this.notes.tierRun as FixtureTierRun;
    const droppedPath = join(run.recordPath, "..", "record-dropped.ndjson");
    recordWithScenarioDropped(run.recordPath, droppedPath);
    const record = readWakeRecord(droppedPath);
    assert.equal(
      record.unrecorded.length,
      1,
      `a record missing one scenario's finish must report exactly one unrecorded scenario, got ${record.unrecorded.length}`,
    );
    assert.equal(
      record.scenarios.length,
      (this.notes.wakeRecord as WakeRecord).scenarios.length - 1,
      "the record missing one scenario's finish must carry one fewer cost entry",
    );
  },
);

Given(
  "the verification support that drives an interactive terminal",
  function (this: JollyWorld) {
    this.notes.interactiveSeam = "features/support/pty.ts";
  },
);

When(
  "the waits it performs before sending each input are enumerated",
  function (this: JollyWorld) {
    this.notes.waitViolations = findGuessedDelayWaits();
  },
);

Then(
  "each should be ended by the prompt it observed in the terminal output",
  function (this: JollyWorld) {
    const violations = this.notes.waitViolations as WaitViolation[];
    assert.equal(
      violations.length,
      0,
      `interactive inputs fed on a guessed delay rather than on an observed prompt:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a wait ended by a fixed delay guessed to outlast the prompt should redden the check",
  function (this: JollyWorld) {
    const planted: InjectedSource = {
      file: "features/step_definitions/.planted-guessed-delay.steps.ts",
      text: [
        'import { runUnderPty } from "../support/pty.ts";',
        "export function driveInteractively(cwd: string) {",
        "  return runUnderPty({",
        '    runtime: "node",',
        '    argv: ["start"],',
        "    cwd,",
        "    env: {},",
        '    inputs: ["\\r", "\\r"],',
        "    inputDelayMs: 600,",
        "  });",
        "}",
      ].join("\n"),
    };
    const violations = findGuessedDelayWaits([planted]);
    assert.ok(
      violations.some((violation) => violation.file === planted.file),
      "an interactive input fed on the guessed `inputDelayMs` cadence was not reported",
    );
  },
);
