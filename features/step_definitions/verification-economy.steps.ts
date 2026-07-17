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
import { statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/repo-root.ts";
import type { JollyWorld } from "../support/world.ts";
import {
  checkTierBudgets,
  fixtureTier,
  readTierBudgets,
  readTierCommands,
  readTierWallClock,
  readWakeRecord,
  runTierCommand,
  withoutRecordWrite,
  type BudgetJudgment,
  type ScenarioCost,
  type TierBudgets,
  type TierClock,
  type TierCommand,
  type TierRun,
} from "../support/wake.ts";
import {
  duplicateSharedClasses,
  lastRunEntries,
  ledgerEntriesWithin,
  readSpendLedger,
  scenarioTagsFromSpecs,
  unlicensedSpends,
  SHARED_PROVISIONING,
  SPEND_LEDGER_PATH,
  TOOLCHAIN_SPENDS,
  type RunWindow,
  type SpendEntry,
  type SpendViolation,
} from "../support/spend-ledger.ts";
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

// ─── Expensive spend is licensed, recorded, and joined ─────────────────────

Given(
  "the spend ledger the sandbox tier's last run recorded into the wake",
  function (this: JollyWorld) {
    const entries = lastRunEntries(readSpendLedger());
    assert.ok(
      entries.length > 0,
      `the wake carries no spend ledger at ${SPEND_LEDGER_PATH} — no sandbox ` +
        `run has recorded one; run the sandbox tier (broad-sandbox and ` +
        `broad-sandbox-serial in RIGGING.md) so the recorder writes it`,
    );
    this.notes.ledgerEntries = entries;
  },
);

When(
  "each ledger entry is joined to the tags of the scenario it is attributed to",
  function (this: JollyWorld) {
    this.notes.scenarioTags = scenarioTagsFromSpecs();
    this.notes.spendViolations = unlicensedSpends(
      this.notes.ledgerEntries as SpendEntry[],
      this.notes.scenarioTags as Map<string, Set<string>>,
    );
  },
);

Then(
  "every spend of the full toolchain chain should belong to the run's shared provisioning or to the scenario tagged @pipeline",
  function (this: JollyWorld) {
    const violations = (this.notes.spendViolations as SpendViolation[]).filter(
      (violation) => violation.spend !== "environment-creation",
    );
    assert.equal(
      violations.length,
      0,
      `toolchain spends recorded outside the run's shared provisioning, the ` +
        `@pipeline licence, and the @creates-env single-element licence:\n${violations
          .map((violation) => `  - ${violation.message}`)
          .join("\n")}`,
    );
  },
);

Then(
  "a single toolchain element driven by a scenario tagged @creates-env against its own environment should be licensed, never the chain",
  function (this: JollyWorld) {
    // Real-ledger side: every toolchain spend attributed to a @creates-env
    // scenario in this run's ledger was judged by the same checker the Then
    // above consumed; a single element is licensed, so none of those entries
    // may stand in the violation list unless the scenario spent the chain.
    const entries = this.notes.ledgerEntries as SpendEntry[];
    const tags = this.notes.scenarioTags as Map<string, Set<string>>;
    const violations = this.notes.spendViolations as SpendViolation[];
    const elementViolations = violations.filter((violation) => {
      const scenarioTags = tags.get(violation.scenario);
      return (
        scenarioTags?.has("@creates-env") === true &&
        violation.spend !== "environment-creation"
      );
    });
    for (const violation of elementViolations) {
      assert.match(
        violation.message,
        /CHAIN/,
        `a @creates-env scenario's toolchain violation must be a chain breach, ` +
          `never a licensed single element: ${violation.message}`,
      );
    }
    this.attach(
      `@creates-env toolchain entries in this run's ledger: ${entries.filter(
        (entry) =>
          tags.get(entry.scenario)?.has("@creates-env") === true &&
          (TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend),
      ).length}; chain breaches: ${elementViolations.length}`,
      "text/plain",
    );

    // Planted red: the same checker must license one element and redden the
    // chain, so the licence never widens to the chain silently.
    const creatorTags = new Map<string, Set<string>>([
      ["A creator scenario", new Set(["@sandbox", "@creates-env"])],
    ]);
    const element: SpendEntry[] = [
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "A creator scenario",
        spend: "configurator-deploy",
      },
    ];
    assert.equal(
      unlicensedSpends(element, creatorTags).length,
      0,
      "a single toolchain element driven by a @creates-env scenario must be licensed",
    );
    const chain: SpendEntry[] = [
      element[0]!,
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "A creator scenario",
        spend: "vercel-deploy",
      },
    ];
    const chainViolations = unlicensedSpends(chain, creatorTags);
    assert.ok(
      chainViolations.length > 0 &&
        chainViolations.every((violation) => /CHAIN/.test(violation.message)),
      "a @creates-env scenario spending the toolchain CHAIN must redden, naming the chain breach",
    );
  },
);

Then(
  "every environment-creation spend should belong to the run's shared provisioning or to a scenario tagged @creates-env",
  function (this: JollyWorld) {
    const violations = (this.notes.spendViolations as SpendViolation[]).filter(
      (violation) => violation.spend === "environment-creation",
    );
    assert.equal(
      violations.length,
      0,
      `environment-creation spends recorded outside a @creates-env licence and ` +
        `outside shared provisioning:\n${violations
          .map((violation) => `  - ${violation.message}`)
          .join("\n")}`,
    );
  },
);

Then(
  "a spend attributed to an unlicensed scenario should redden the check, naming the scenario and the spend it made",
  function (this: JollyWorld) {
    // The planted red: fabricated entries attributed to a scenario holding no
    // licence, judged by the same checker the real assertions above use.
    const planted: SpendEntry[] = [
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "An unlicensed scenario",
        spend: "git-clone",
        argv: ["clone", "https://example.com/repo.git"],
      },
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "An unlicensed scenario",
        spend: "environment-creation",
      },
    ];
    const violations = unlicensedSpends(planted, new Map());
    assert.equal(violations.length, 2, "both planted unlicensed spends must redden");
    for (const violation of violations) {
      assert.ok(
        violation.message.includes("An unlicensed scenario") &&
          violation.message.includes(violation.spend),
        `the violation must name the scenario and the spend it made: ${violation.message}`,
      );
    }
  },
);

When(
  "the entries attributed to the run's shared provisioning are grouped by resource class",
  function (this: JollyWorld) {
    this.notes.duplicateClasses = duplicateSharedClasses(
      this.notes.ledgerEntries as SpendEntry[],
    );
  },
);

Then("no resource class should appear more than once", function (this: JollyWorld) {
  const duplicates = this.notes.duplicateClasses as Array<{
    resourceClass: string;
    count: number;
  }>;
  assert.equal(
    duplicates.length,
    0,
    `shared provisioning paid a resource class more than once in one run:\n${duplicates
      .map((entry) => `  - ${entry.resourceClass}: ${entry.count} times`)
      .join("\n")}`,
  );
});

Then(
  "a resource class provisioned twice in one run should redden the check, naming the class",
  function (this: JollyWorld) {
    const twice: SpendEntry[] = [1, 2].map(() => ({
      run: "planted",
      tier: "sandbox",
      at: Date.now(),
      scenario: SHARED_PROVISIONING,
      spend: "shared-provisioning",
      class: "saleor-environment",
    }));
    const duplicates = duplicateSharedClasses(twice);
    assert.ok(
      duplicates.some((entry) => entry.resourceClass === "saleor-environment"),
      "a resource class provisioned twice was not reported by name",
    );
  },
);

// ─── A sandbox run leaves a ledger, or the check reddens ────────────────────

/** The latest completed sandbox run's wall-clock window, from the wake records
 * the configured sandbox tier commands own. */
function latestSandboxRunWindow(commands: TierCommand[]): RunWindow | undefined {
  let latest: RunWindow | undefined;
  const paths = new Set<string>();
  for (const command of commands) {
    if (!/^(broad|coverage)-sandbox/.test(command.key)) continue;
    if (command.recordPath) paths.add(command.recordPath);
  }
  for (const recordPath of paths) {
    const clock = readTierWallClock(join(REPO_ROOT, recordPath));
    if (!clock) continue;
    const stat = statSync(join(REPO_ROOT, recordPath));
    const endMs = stat.mtimeMs;
    const startMs = endMs - clock.seconds * 1000;
    if (!latest || startMs > latest.startMs) latest = { startMs, endMs };
  }
  return latest;
}

When(
  "the sandbox tier has run through its command as configured",
  function (this: JollyWorld) {
    const commands = this.notes.tierCommands as TierCommand[];
    const window = latestSandboxRunWindow(commands);
    assert.ok(
      window,
      "the sandbox tier has not run through its configured command: no sandbox " +
        "wake record exists to read; run broad-sandbox or broad-sandbox-serial",
    );
    this.notes.sandboxRunWindow = window;
  },
);

Then("the wake should carry a spend ledger for that run", function (this: JollyWorld) {
  const window = this.notes.sandboxRunWindow as RunWindow;
  const within = ledgerEntriesWithin(window, readSpendLedger());
  assert.ok(
    within.length > 0,
    `the wake carries no spend ledger entry for the sandbox tier's last run ` +
      `(window ${new Date(window.startMs).toISOString()} .. ` +
      `${new Date(window.endMs).toISOString()}): the run recorded nothing at ` +
      `${SPEND_LEDGER_PATH}, so its recorder is broken or disarmed`,
  );
});

Then(
  "a sandbox run that produced no ledger should redden the check, so a broken recorder cannot disarm it",
  function (this: JollyWorld) {
    // The planted red: a run window that contains no ledger entry at all. The
    // same selection the real assertion above uses must come back empty, which
    // is exactly the condition that reddens it.
    const planted: SpendEntry[] = [
      {
        run: "planted",
        tier: "sandbox",
        at: 1_000,
        scenario: "(run)",
        spend: "run-start",
      },
    ];
    const window: RunWindow = { startMs: 2_000, endMs: 3_000 };
    assert.equal(
      ledgerEntriesWithin(window, planted).length,
      0,
      "a run window holding no ledger entry must select nothing, so the presence check reddens",
    );
  },
);

// ─── The suite fits its budgets ─────────────────────────────────────────────

Given(
  "the tier budgets configured in {string}",
  function (this: JollyWorld, riggingFile: string) {
    const budgets = readTierBudgets(riggingFile);
    assert.ok(
      budgets.plainSeconds !== undefined &&
        Object.keys(budgets.perTierSeconds).length > 0,
      `${riggingFile} configures no tier budgets under "## Tiers"`,
    );
    this.notes.tierBudgets = budgets;
  },
);

Given(
  "the wall-clock record each tier's last run wrote into the wake",
  function (this: JollyWorld) {
    // Every tier command owns a wake record; one clock per distinct record. A
    // record is fully written only at testRunFinished, so a tier that is
    // executing right now (this run's own tier, mid-write) has no completed
    // last run on record and is not judged here: record PRESENCE is the
    // wall-clock-record scenario's job, with its own planted red; this
    // scenario judges the clocks the wake carries.
    const commands = readTierCommands("RIGGING.md");
    const paths = new Set<string>();
    for (const command of commands) {
      if (command.recordPath) paths.add(command.recordPath);
    }
    const clocks: TierClock[] = [];
    for (const recordPath of paths) {
      const clock = readTierWallClock(join(REPO_ROOT, recordPath));
      if (clock) clocks.push(clock);
    }
    assert.ok(
      clocks.length > 0,
      "the wake carries no completed tier wall-clock record — run a tier " +
        "through its configured command so its record exists to judge",
    );
    this.notes.tierClocks = clocks;
  },
);

When(
  "each tier's recorded wall clock is compared to that tier's budget",
  function (this: JollyWorld) {
    this.notes.budgetJudgment = checkTierBudgets(
      this.notes.tierBudgets as TierBudgets,
      this.notes.tierClocks as TierClock[],
    );
  },
);

Then("no tier's recorded wall clock should exceed its budget", function (this: JollyWorld) {
  const judgment = this.notes.budgetJudgment as BudgetJudgment;
  assert.equal(
    judgment.perTier.length,
    0,
    `tiers over their budget:\n${judgment.perTier
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
});

Then(
  "the tier records summed should fit the plain regression budget",
  function (this: JollyWorld) {
    const judgment = this.notes.budgetJudgment as BudgetJudgment;
    assert.equal(
      judgment.sum,
      undefined,
      judgment.sum?.message ?? "the summed tier records fit the regression budget",
    );
  },
);

Then(
  "a tier over its budget should redden the check, naming the tier, its budget, and the recorded time",
  function (this: JollyWorld) {
    const budgets: TierBudgets = { plainSeconds: 10, perTierSeconds: { planted: 2 } };
    const clocks: TierClock[] = [
      { tier: "planted", recordPath: "planted.ndjson", seconds: 7 },
      { tier: "other", recordPath: "other.ndjson", seconds: 6 },
    ];
    const judgment = checkTierBudgets(budgets, clocks);
    const violation = judgment.perTier.find((entry) => entry.tier === "planted");
    assert.ok(violation, "a tier over its budget was not reported");
    assert.ok(
      violation.message.includes("planted") &&
        violation.message.includes("2") &&
        violation.message.includes("7"),
      `the violation must name the tier, its budget, and the recorded time: ${violation.message}`,
    );
    assert.ok(
      judgment.sum,
      "summed records over the plain regression budget were not reported",
    );
  },
);
