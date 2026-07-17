// Feature verification-economy — three derived checks that make the cost of the
// suite observable (@logic @invariant):
//   - a tier run through its configured command writes that tier's wall-clock
//     record,
//   - an interactive scenario waits for the prompt it is answering rather than
//     for a guessed delay, and
//   - an interactive scenario reads the output it asserts on rather than
//     whatever a timer caught.
// All are verification support; each is proven honest by a planted red inside
// its own scenario.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";
import {
  fixtureTier,
  readTierCommands,
  readWakeRecord,
  runTierCommand,
  withoutRecordWrite,
  type ScenarioCost,
  type TierCommand,
  type TierRun,
} from "../support/wake.ts";
import {
  findGuessedDelayWaits,
  type InjectedSource,
  type WaitViolation,
} from "../support/interactive-waits.ts";
import {
  findTimerEndedReads,
  type ReadViolation,
} from "../support/interactive-reads.ts";
import {
  findUnguardedAmbientProvisioning,
  type ProvisionViolation,
} from "../support/ambient-provisioning.ts";

Given(
  "the tier commands configured in {string}",
  function (this: JollyWorld, riggingFile: string) {
    const commands = readTierCommands(riggingFile);
    assert.ok(
      commands.length > 0,
      `${riggingFile} configures no tier command under "## Commands"`,
    );
    this.notes.tierCommands = commands;
  },
);

When(
  "a tier is run through its command as configured",
  { timeout: 130_000 },
  function (this: JollyWorld) {
    const commands = this.notes.tierCommands as TierCommand[];
    // The default tier: the one every inner-loop change pays for.
    const command = commands.find((entry) => entry.key === "broad");
    assert.ok(command, `no "broad" tier command is configured`);
    this.notes.tierCommand = command;
    // Teardown registered before creation, loud on failure via the registry.
    const tier = fixtureTier("as-configured");
    this.cleanup.register("wake fixture tier (as configured)", () => tier.remove());
    this.notes.fixtureTier = tier;
    this.notes.tierRun = runTierCommand(tier, command);
  },
);

Then(
  "that tier's wake record should carry every scenario the run started, each with its wall-clock duration",
  function (this: JollyWorld) {
    const command = this.notes.tierCommand as TierCommand;
    const run = this.notes.tierRun as TierRun;
    assert.ok(
      run.recordPath,
      `the tier command "${command.key}" writes no wake record:\n${command.command}`,
    );
    const record = readWakeRecord(run.recordPath);
    assert.ok(
      record,
      `the tier command "${command.key}" wrote no wake record at ${run.recordPath}`,
    );
    assert.deepEqual(
      record.unrecorded,
      [],
      `scenarios the run started that carry no wall-clock duration: ${record.unrecorded.join(", ")}`,
    );
    for (const name of (this.notes.fixtureTier as { scenarioNames: string[] })
      .scenarioNames) {
      // Explicitly typed: an inferred const narrowed by `assert.ok` inside a
      // loop trips TS7022 under the TS 7 checker.
      const cost: ScenarioCost | undefined = record.scenarios.find(
        (scenario) => scenario.name === name,
      );
      assert.ok(cost, `the record carries no entry for the scenario "${name}"`);
      assert.ok(
        cost.durationNs > 0,
        `the scenario "${name}" records a wall-clock duration of ${cost.durationNs}ns`,
      );
    }
  },
);

Then(
  "a configured tier command that writes no wake record should redden the check",
  { timeout: 130_000 },
  function (this: JollyWorld) {
    const configured = this.notes.tierCommand as TierCommand;
    const stripped = withoutRecordWrite(configured);
    // Teardown registered before creation, loud on failure via the registry.
    const tier = fixtureTier("no-record-write");
    this.cleanup.register("wake fixture tier (no record write)", () => tier.remove());
    const run = runTierCommand(tier, stripped);
    assert.equal(
      run.recordPath,
      undefined,
      "the planted command still carries a record-writing flag",
    );
    // The tier ran, so the check has a record to read; it wrote none, so it does not.
    const record = readWakeRecord(join(tier.dir, configured.recordPath!));
    assert.equal(
      record,
      undefined,
      `a tier command carrying no record-writing flag still left a wake record:\n${stripped.command}`,
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

When(
  "the reads it performs before asserting on the terminal output are enumerated",
  function (this: JollyWorld) {
    this.notes.readViolations = findTimerEndedReads();
  },
);

Then(
  "each should be ended by the output it asserts on, appearing in the terminal",
  function (this: JollyWorld) {
    const violations = this.notes.readViolations as ReadViolation[];
    assert.equal(
      violations.length,
      0,
      `interactive terminal reads ended by a timer rather than by the output they assert on:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a read ended by a fixed timeout, returning whatever the terminal had produced by then, should redden the check",
  function (this: JollyWorld) {
    const planted: InjectedSource = {
      file: "features/step_definitions/.planted-timer-ended-read.steps.ts",
      text: [
        'import { runUnderPty } from "../support/pty.ts";',
        "export function readInteractively(cwd: string) {",
        "  return runUnderPty({",
        '    runtime: "node",',
        '    argv: ["start"],',
        "    cwd,",
        "    env: {},",
        "    inputs: [],",
        "    timeoutMs: 15_000,",
        "  });",
        "}",
      ].join("\n"),
    };
    const violations = findTimerEndedReads([planted]);
    assert.ok(
      violations.some((violation) => violation.file === planted.file),
      "a terminal read left to end on the fixed `timeoutMs` was not reported",
    );
  },
);

// ─── Ambient state is provisioned once and shared ──────────────────────────

Given(
  "the verification support and step-definition files",
  function (this: JollyWorld) {
    this.notes.provisioningDirs = [
      "features/support/",
      "features/step_definitions/",
    ];
  },
);

When(
  "the sites that provision ambient state no scenario asserts, such as pre-warming an external CLI into the npx cache, are enumerated",
  function (this: JollyWorld) {
    this.notes.provisionViolations = findUnguardedAmbientProvisioning();
  },
);

Then(
  "each should run behind a once-per-run guard such as a lock, marker file, or module-level memo",
  function (this: JollyWorld) {
    const violations = this.notes.provisionViolations as ProvisionViolation[];
    assert.equal(
      violations.length,
      0,
      `ambient provisioning paid again on every scenario that runs through it:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a site that re-provisions per scenario without a guard should redden the check",
  function (this: JollyWorld) {
    const planted = {
      file: "features/step_definitions/.planted-reprovision.steps.ts",
      text: [
        'import { spawnSync } from "node:child_process";',
        "export function prewarmOnEveryScenario(): void {",
        '  spawnSync("npx", ["--yes", "some-cli", "--version"], {',
        '    encoding: "utf8",',
        "    timeout: 60_000,",
        '    stdio: "ignore",',
        "  });",
        "}",
      ].join("\n"),
    };
    const violations = findUnguardedAmbientProvisioning([planted]);
    assert.ok(
      violations.some((violation) => violation.file === planted.file),
      "an unguarded per-scenario re-provision of ambient state was not reported",
    );
  },
);
