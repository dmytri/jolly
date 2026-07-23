// Feature verification-economy — derived checks that make the cost of the
// suite observable (@logic @invariant): the wall-clock and pressure records a
// tier command writes into the wake, prompt-observed interactive waits and
// reads, once-per-run ambient provisioning, the licensed-spend ledger join,
// run-scoped wake reading, and the tier budgets.
// All are verification support; each is proven honest by a planted red inside
// its own scenario.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../support/repo-root.ts";
import {
  EVAL_CAPTURES_PATH,
  deadRecordedEndpoints,
  probeRecordedEndpoint,
  readEvalCaptures,
  recordedEndpoints,
  type DeadEndpointFinding,
  type RecordedEndpoint,
} from "../support/eval-captures.ts";
import {
  EVAL_SPEND_LEDGER_PATH,
  lastEvalRunEntries,
  liveExpensiveSpends,
  readEvalSpendLedger,
  type EvalSpendEntry,
  type LiveSpendViolation,
} from "../support/eval-spend-ledger.ts";
import {
  stageVerifiedPreparedStorefront,
  templateIsComplete,
} from "../support/storefront-fixture.ts";
import type { JollyWorld } from "../support/world.ts";
import {
  checkTierBudgets,
  fixtureTier,
  readTierBudgets,
  operationalRecordPaths,
  readTierCommands,
  readTierWallClock,
  readWakeRecord,
  readConfiguredTierTags,
  runTierCommand,
  sweepLegWindows,
  tierNameFromRecordPath,
  withoutRecordWrite,
  type BudgetJudgment,
  type ScenarioCost,
  type TierBudgets,
  type TierClock,
  type TierCommand,
  type TierRun,
} from "../support/wake.ts";
import {
  deriveWorkerCount,
  oomKillFindings,
  readPressureRecord,
  workerRestoreFinding,
  type OomFinding,
  type PressureRecord,
  type TierPressure,
} from "../support/pressure.ts";
import {
  declaredReadCeilings,
  pinnedReadFindings,
  readStepMeasurements,
  type DeclaredCeiling,
  type PinnedReadFinding,
  type StepMeasurement,
} from "../support/read-ceilings.ts";
import {
  doubleClassifiedSpends,
  duplicateSharedClasses,
  lastRunEntries,
  ledgerEntriesWithin,
  licenceExclusivityViolations,
  licensedScenariosBySpendClass,
  readAllSpendLedgers,
  readSpendLedger,
  scenarioTagsFromSpecs,
  strayExemptionScenarios,
  sweepLegEntries,
  tiersMissingLedger,
  tiersThatCanSpend,
  tiersWithLedger,
  unlicensedSpends,
  EXPENSIVE_SPEND_LICENCES,
  SHARED_PROVISIONING,
  SPEND_LEDGER_PATH,
  TOOLCHAIN_SPENDS,
  type LedgerCoverageFinding,
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
import {
  enumerateWakeReaderSelections,
  runScopeViolations,
  writeWakeReaderFixture,
  WAKE_READERS,
  type ReaderSelection,
  type WakeReaderFixture,
} from "../support/wake-run-scope.ts";
import {
  joinDependencyNames,
  manifestDependencyNames,
  parseRecordedDependencies,
  type DependencyNameViolation,
} from "../support/dependency-record-conformance.ts";
import {
  leftoverProcessFindings,
  readLeftoverProcesses,
  type LeftoverFinding,
  type LeftoverProcess,
} from "../support/process-reclaim.ts";
// ─── The wake records the pressure a run ran under ──────────────────────────
Given(
  "the pressure record each tier's last run wrote into the wake",
  function (this: JollyWorld) {
    // Completed records only: a tier executing right now (this run's own tier,
    // mid-write) has no completed last run on record. Record PRESENCE is the
    // pressure-record scenario's job, with its own planted red; this scenario
    // judges the pressure events the wake carries, so a record predating the
    // recorder contributes nothing rather than blocking every tier it is not.
    const commands = readTierCommands("RIGGING.md");
    const paths = new Set<string>();
    for (const command of commands) {
      if (command.recordPath) paths.add(command.recordPath);
    }
    const records: TierPressure[] = [];
    for (const recordPath of paths) {
      const absolute = join(REPO_ROOT, recordPath);
      if (!readTierWallClock(absolute)) continue;
      const pressure = readPressureRecord(absolute);
      if (!pressure) continue;
      records.push({ tier: tierNameFromRecordPath(recordPath), pressure });
    }
    this.notes.tierPressureRecords = records;
    this.attach(
      `completed tier records carrying pressure: ${records.length}`,
      "text/plain",
    );
  },
);

When("the recorded pressure events are examined", function (this: JollyWorld) {
  this.notes.oomFindings = oomKillFindings(
    this.notes.tierPressureRecords as TierPressure[],
  );
});

Then("no tier's record should carry an out-of-memory kill", function (this: JollyWorld) {
  const findings = this.notes.oomFindings as OomFinding[];
  assert.equal(
    findings.length,
    0,
    `out-of-memory kills stand recorded in the wake — a harness defect, red and ` +
      `named, never absorbed by a silent rerun:\n${findings
        .map((finding) => `  - ${finding.message}`)
        .join("\n")}`,
  );
});

Then(
  "a record carrying one should redden the check, naming the tier and the event",
  function (this: JollyWorld) {
    const planted: TierPressure[] = [
      {
        tier: "planted",
        pressure: {
          workers: 2,
          peakRssBytes: 1,
          memoryCeilingBytes: 2,
          oomKills: [
            { pid: 4242, comm: "node", raw: "Out of memory: Killed process 4242 (node)" },
          ],
        },
      },
    ];
    const findings = oomKillFindings(planted);
    assert.ok(
      findings.length === 1 &&
        findings[0]!.message.includes("planted") &&
        findings[0]!.message.includes("4242"),
      `the planted out-of-memory kill must redden, naming the tier and the event: ${JSON.stringify(findings)}`,
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

// ─── The shared prepared-storefront fixture rebuilds an evicted template ────

/** Write a complete stand-in prepared-storefront template (package.json +
 * node_modules), the shape the fixture's completeness predicate requires. */
function stageStandInTemplate(dir: string): string {
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"paper-stand-in"}\n', "utf8");
  return dir;
}

// ─── Expensive spend is licensed, recorded, and joined ─────────────────────

Given(
  "the spend ledger each tier's last run recorded into the wake, every profile leg of it",
  function (this: JollyWorld) {
    // Every profile leg of every tier's last run: each configured tier command's
    // record path, its latest completed run selected run-scoped by its run-end,
    // so the order the legs ran in can never leave one leg's spends unjudged and
    // no tier that can spend goes unjudged.
    const legs = sweepLegWindows(readTierCommands("RIGGING.md"));
    assert.ok(
      legs.length > 0,
      "the wake carries no completed tier record — no tier has run through its " +
        "configured command; run a tier command from RIGGING.md so its record " +
        "exists to judge",
    );
    const selection = sweepLegEntries(readAllSpendLedgers(), legs);
    // A leg that recorded nothing spawned nothing expensive; only a leg that
    // recorded spends yet left no run-end is a broken or disarmed recorder.
    const unresolved = selection.legs.filter(
      (leg) => leg.run === undefined && !leg.spentNothing,
    );
    assert.equal(
      unresolved.length,
      0,
      `profile legs of the tiers' last runs with no completed run in ` +
        `the spend ledger at ${SPEND_LEDGER_PATH}: ` +
        `${unresolved.map((leg) => leg.tier).join(", ")} — the leg ran but its ` +
        `recorder left no run-end, so it is broken or disarmed; rerun the ` +
        `leg's tier command`,
    );
    assert.ok(
      selection.entries.length > 0,
      `the wake carries no spend ledger entry for the tiers' last ` +
        `sweep at ${SPEND_LEDGER_PATH}`,
    );
    this.notes.ledgerEntries = selection.entries;
    this.attach(
      `sweep legs judged: ${selection.legs
        .map((leg) => `${leg.tier}=${leg.run}`)
        .join(", ")}; entries: ${selection.entries.length}`,
      "text/plain",
    );
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
  "a toolchain element driven by a scenario tagged @toolchain-element against its own namespaced resources, where that element is the scenario's own assertion, should be licensed, never the chain",
  function (this: JollyWorld) {
    // Real-ledger side: every toolchain spend attributed to a
    // @toolchain-element scenario in this sweep's ledger was judged by the
    // same checker the chain Then consumed; the scenario's own element is
    // licensed, so such an entry stands in the violation list only as a chain
    // breach.
    const entries = this.notes.ledgerEntries as SpendEntry[];
    const tags = this.notes.scenarioTags as Map<string, Set<string>>;
    const violations = this.notes.spendViolations as SpendViolation[];
    const elementViolations = violations.filter(
      (violation) => tags.get(violation.scenario)?.has("@toolchain-element") === true,
    );
    for (const violation of elementViolations) {
      assert.match(
        violation.message,
        /CHAIN/,
        `a @toolchain-element scenario's toolchain violation must be a chain ` +
          `breach, never a licensed single element: ${violation.message}`,
      );
    }
    this.attach(
      `@toolchain-element toolchain entries in this sweep's ledger: ${entries.filter(
        (entry) =>
          tags.get(entry.scenario)?.has("@toolchain-element") === true &&
          (TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend),
      ).length}; chain breaches: ${elementViolations.length}`,
      "text/plain",
    );

    // Planted red: the same checker must license one element — the storefront
    // preparation, whose clone AND install are one element — and redden the
    // chain, so the licence never widens to the chain silently.
    const elementTags = new Map<string, Set<string>>([
      ["An element scenario", new Set(["@sandbox", "@toolchain-element"])],
    ]);
    const preparation: SpendEntry[] = [
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "An element scenario",
        spend: "git-clone",
      },
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "An element scenario",
        spend: "pnpm-install",
      },
    ];
    assert.equal(
      unlicensedSpends(preparation, elementTags).length,
      0,
      "the storefront preparation driven by a @toolchain-element scenario must " +
        "be licensed as the scenario's one element",
    );
    const chain: SpendEntry[] = [
      ...preparation,
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "An element scenario",
        spend: "vercel-deploy",
      },
    ];
    const chainViolations = unlicensedSpends(chain, elementTags);
    assert.ok(
      chainViolations.length > 0 &&
        chainViolations.every((violation) => /CHAIN/.test(violation.message)),
      "a @toolchain-element scenario spending the toolchain CHAIN must redden, naming the chain breach",
    );
  },
);

Then(
  "a spend aimed at a declared unroutable stand-in by a scenario carrying @exceptional-double should be classified to that scenario's double, never as a real toolchain spend",
  function (this: JollyWorld) {
    // Real-ledger side: every such spend in this sweep's ledger is classified
    // to its scenario's double by the same checker the licence Thens consumed,
    // so none of them stands as a real toolchain violation.
    const entries = this.notes.ledgerEntries as SpendEntry[];
    const tags = this.notes.scenarioTags as Map<string, Set<string>>;
    const violations = this.notes.spendViolations as SpendViolation[];
    const classified = doubleClassifiedSpends(entries, tags);
    for (const double of classified) {
      assert.ok(
        !violations.some(
          (violation) =>
            violation.scenario === double.scenario &&
            violation.spend === double.spend,
        ),
        `a spend classified to "${double.scenario}"'s double still stands as ` +
          `a real toolchain violation: ${double.spend} aimed at ${double.target}`,
      );
    }
    this.attach(
      `sweep spends classified to doubles: ${classified.length}`,
      "text/plain",
    );

    // Planted red: the same spend is the double's own failure path under the
    // @exceptional-double tag, and a real unlicensed toolchain spend without
    // it — so the classification can never silently swallow a real spend.
    const planted: SpendEntry[] = [
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "A double scenario",
        spend: "configurator-deploy",
        argv: [
          "--yes",
          "@saleor/configurator@latest",
          "deploy",
          "--url",
          "https://127.0.0.1:1/graphql/",
        ],
      },
    ];
    const doubleTags = new Map<string, Set<string>>([
      ["A double scenario", new Set(["@sandbox", "@exceptional-double"])],
    ]);
    assert.equal(
      unlicensedSpends(planted, doubleTags).length,
      0,
      "a spend aimed at the declared unroutable stand-in by an " +
        "@exceptional-double scenario must be classified to the double",
    );
    const plantedClassified = doubleClassifiedSpends(planted, doubleTags);
    assert.ok(
      plantedClassified.length === 1 &&
        plantedClassified[0]!.target.includes("127.0.0.1:1"),
      "the classification must name the double's declared unroutable stand-in",
    );
    const untagged = unlicensedSpends(
      planted,
      new Map<string, Set<string>>([["A double scenario", new Set(["@sandbox"])]]),
    );
    assert.equal(
      untagged.length,
      1,
      "the same spend without the @exceptional-double tag must stay a real " +
        "toolchain spend and redden",
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

// ─── Every tier that can spend records a ledger ─────────────────────────────

Then(
  "a tier that spawned an expensive command and wrote no ledger should redden the check",
  function () {
    // Planted red: a tier known to host a spend-licensed scenario (@logic +
    // @pipeline) whose ledger set carries no @logic entry. The same join the
    // real assertion uses must name that tier.
    const plantedTags = new Map<string, Set<string>>([
      ["A logic-tier pipeline proof", new Set(["@logic", "@pipeline"])],
    ]);
    const canSpend = tiersThatCanSpend(plantedTags);
    assert.ok(
      canSpend.has("@logic"),
      "the planted @logic @pipeline scenario must place @logic in the can-spend set",
    );
    const withoutLogicLedger = tiersWithLedger([
      {
        run: "planted",
        tier: "sandbox",
        at: Date.now(),
        scenario: "(run)",
        spend: "run-start",
      },
    ]);
    const findings = tiersMissingLedger(canSpend, withoutLogicLedger);
    assert.ok(
      findings.some((finding) => finding.tier === "@logic"),
      "a tier that can spend but wrote no ledger must redden the check, naming the tier",
    );
    // Plant removed: a ledger set that includes @logic leaves the check green.
    assert.equal(
      tiersMissingLedger(canSpend, new Set(["@logic"])).length,
      0,
      "a tier that can spend and wrote a ledger must leave the check green",
    );
  },
);

// ─── One licence holder per expensive spend class ───────────────────────────
// ─── The wake is read run-scoped ────────────────────────────────────────────

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
    // Operational records only. The `coverage-*` commands write an instrumented
    // record whose basename equals the operational one's, so collecting every
    // tier command's record path judges c8 overhead as the tier's own clock.
    const paths = operationalRecordPaths(readTierCommands("RIGGING.md"));
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
  },
);

// ─── A budget judged over an incomplete window ──────────────────────────────

// ─── A step pinned at its declared read ceiling ─────────────────────────────

Given(
  "the per-step durations the latest tier runs wrote into the wake",
  function (this: JollyWorld) {
    const commands = readTierCommands("RIGGING.md");
    const paths = new Set<string>();
    for (const command of commands) {
      if (command.recordPath) paths.add(command.recordPath);
    }
    const measurements: StepMeasurement[] = [];
    for (const recordPath of paths) {
      measurements.push(...readStepMeasurements(join(REPO_ROOT, recordPath)));
    }
    assert.ok(
      measurements.length > 0,
      "the wake carries no per-step durations — run a tier through its " +
        "configured command so its record exists to judge",
    );
    this.notes.stepMeasurements = measurements;
  },
);

Given("the read ceilings declared in the verification support", function (this: JollyWorld) {
  const ceilings = declaredReadCeilings();
  assert.ok(
    ceilings.length > 0,
    "the verification support declares no read ceiling — the scan found no " +
      "`timeoutMs` inside a step definition, so the join has nothing to judge",
  );
  this.notes.declaredCeilings = ceilings;
});

When(
  "each step's measured duration is joined against its declared ceiling",
  function (this: JollyWorld) {
    this.notes.pinnedReads = pinnedReadFindings(
      this.notes.declaredCeilings as DeclaredCeiling[],
      this.notes.stepMeasurements as StepMeasurement[],
    );
  },
);

Then("no step's measured duration should reach its declared ceiling", function (this: JollyWorld) {
  const findings = this.notes.pinnedReads as PinnedReadFinding[];
  assert.equal(
    findings.length,
    0,
    `steps ran pinned at their declared read ceiling:\n${findings
      .map((finding) => `  - ${finding.message}`)
      .join("\n")}`,
  );
});

Then(
  "planting a read whose signal never matches should redden the check before the plant is removed",
  function (this: JollyWorld) {
    const ceilings = this.notes.declaredCeilings as DeclaredCeiling[];
    const planted = ceilings[0]!;
    // A read whose signal never matches runs to its ceiling and returns
    // whatever the terminal held. That is what this measurement is.
    const plant: StepMeasurement = {
      file: planted.file,
      line: planted.line,
      pattern: "a read whose declared signal never matches",
      durationMs: planted.ceilingMs,
      recordPath: "planted.ndjson",
    };
    const withPlant = pinnedReadFindings(ceilings, [plant]);
    assert.equal(
      withPlant.length,
      1,
      "a read pinned at its declared ceiling must redden the check",
    );
    assert.ok(
      withPlant[0]!.message.includes("read ceiling"),
      `the finding must name the ceiling the read ran against: ${withPlant[0]!.message}`,
    );
    // Plant removed: the same read ending on its signal well inside the
    // ceiling leaves the check green.
    assert.equal(
      pinnedReadFindings(ceilings, [{ ...plant, durationMs: planted.ceilingMs * 0.1 }]).length,
      0,
      "a read ending on its signal well inside the ceiling must leave the check green",
    );
  },
);

// ─── A run reclaims the processes it spawned ─────────────────────────────────
// ─── The recorded dependencies match the package manifest ───────────────────

// ─── The eval tier serves its expensive commands from the captures ──────────
//
// The @eval tier's expensive external commands — the managed skill installs
// `jolly init` drives through `npx skills add`, the configurator deploy, the
// storefront clone and install, the Vercel deploy — are served from golden
// captures (feature 025). "Served from a capture" is a claim about what the
// run actually spawned, so the eval PATH shims record which branch answered
// each spawn into the eval ledger in the wake, and this check joins it.

Given(
  "the spend ledger the eval tier's last run wrote into the wake",
  function (this: JollyWorld) {
    const entries = lastEvalRunEntries(readEvalSpendLedger());
    assert.ok(
      entries.length > 0,
      `the wake carries no spend ledger at ${EVAL_SPEND_LEDGER_PATH} — no eval ` +
        `run has recorded its spends. Run the eval tier (broad-eval in ` +
        `RIGGING.md) so its ledger is written.`,
    );
    this.notes.evalLedgerEntries = entries;
  },
);

When(
  "each recorded spend is classified as served from a golden capture or run live",
  function (this: JollyWorld) {
    const entries = this.notes.evalLedgerEntries as EvalSpendEntry[];
    this.notes.evalLiveSpends = liveExpensiveSpends(entries);
    this.attach(
      `Eval run ${entries[0]?.run ?? "(unknown)"} spends:\n` +
        entries
          .filter((entry) => entry.spend !== "run-start" && entry.spend !== "run-end")
          .map((entry) => `  ${entry.served.padEnd(7)} ${entry.spend} — ${entry.scenario}`)
          .join("\n"),
      "text/plain",
    );
  },
);

Then("no managed skill install should have run live", function (this: JollyWorld) {
  const live = (this.notes.evalLiveSpends as LiveSpendViolation[]).filter(
    (violation) => violation.spend === "skills-install",
  );
  assert.equal(
    live.length,
    0,
    `managed skill installs run live in the eval tier:\n${live
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
});

Then("no configurator deploy should have run live", function (this: JollyWorld) {
  const live = (this.notes.evalLiveSpends as LiveSpendViolation[]).filter(
    (violation) => violation.spend === "configurator-deploy",
  );
  assert.equal(
    live.length,
    0,
    `configurator deploys run live in the eval tier:\n${live
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
});

Then(
  "no storefront dependency install should have run live",
  function (this: JollyWorld) {
    const live = (this.notes.evalLiveSpends as LiveSpendViolation[]).filter(
      (violation) => violation.spend === "pnpm-install",
    );
    assert.equal(
      live.length,
      0,
      `storefront dependency installs run live in the eval tier:\n${live
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a live expensive spend in an eval run should redden the check, naming the command and the scenario that made it",
  function () {
    // The planted red: a ledger carrying one live configurator deploy. The
    // same join the Then steps above ran must select it and name both the
    // command and the scenario.
    const planted: EvalSpendEntry[] = [
      {
        run: "planted",
        tier: "eval",
        at: Date.now(),
        scenario: "(run)",
        spend: "run-start",
        served: "live",
      },
      {
        run: "planted",
        tier: "eval",
        at: Date.now(),
        scenario: "A baseline agent follows the published /setup entry point to set up a project",
        spend: "configurator-deploy",
        served: "live",
        argv: ["npx", "@saleor/configurator@latest", "deploy"],
      },
    ];
    const violations = liveExpensiveSpends(planted);
    assert.equal(
      violations.length,
      1,
      "a live expensive spend must redden the check",
    );
    const violation = violations[0]!;
    assert.ok(
      violation.message.includes("npx @saleor/configurator@latest deploy"),
      `the violation must name the command: ${violation.message}`,
    );
    assert.ok(
      violation.message.includes(
        "A baseline agent follows the published /setup entry point to set up a project",
      ),
      `the violation must name the scenario that made the spend: ${violation.message}`,
    );
    // Plant removed: the same spend served from a capture leaves the check green.
    assert.equal(
      liveExpensiveSpends(
        planted.map((entry) =>
          entry.spend === "configurator-deploy"
            ? { ...entry, served: "capture" as const }
            : entry,
        ),
      ).length,
      0,
      "a spend served from a golden capture must leave the check green",
    );
  },
);

// ─── Every endpoint the eval captures record still serves ───────────────────
//
// The captures are recorded against persistent resources that outlive runs, so
// a recorded endpoint that stopped serving is a stale capture. The eval then
// drives a live agent against a dead URL, which the agent cannot tell apart
// from an affordance it failed to find, so it burns its whole budget and the
// run reads as an affordance failure when the affordance was never at fault.

Given("the golden captures committed for the eval tier", function (this: JollyWorld) {
  const captures = readEvalCaptures();
  const endpoints = recordedEndpoints(captures);
  assert.ok(
    endpoints.length > 0,
    `the committed capture store ${EVAL_CAPTURES_PATH} records no endpoint; ` +
      `run the sandbox tier so the licensed @pipeline run records the shared ` +
      `store and the shared deployment`,
  );
  this.notes.recordedEndpoints = endpoints;
});

When(
  "each recorded store endpoint is probed for readiness",
  { timeout: 180_000 },
  async function (this: JollyWorld) {
    const endpoints = this.notes.recordedEndpoints as RecordedEndpoint[];
    this.notes.deadEndpoints = await deadRecordedEndpoints(endpoints, (endpoint) =>
      probeRecordedEndpoint(endpoint),
    );
    this.attach(
      `Probed recorded endpoints:\n` +
        endpoints.map((e) => `  ${e.label}: ${e.url} (recorded by ${e.sourceRun})`).join("\n"),
      "text/plain",
    );
  },
);

Then("every recorded endpoint should answer as serving", function (this: JollyWorld) {
  const dead = this.notes.deadEndpoints as DeadEndpointFinding[];
  assert.equal(
    dead.length,
    0,
    `recorded capture endpoints that no longer serve:\n${dead
      .map((finding) => `  - ${finding.message}`)
      .join("\n")}`,
  );
});

Then(
  "a recorded endpoint that no longer serves should redden the check, naming the endpoint and the run that recorded it",
  async function () {
    // The planted red: the same join over a recorded endpoint whose probe
    // reports it dead. The probe is injected, so the plant needs no network and
    // no real endpoint is torn down to prove the check.
    const planted: RecordedEndpoint[] = [
      {
        label: "shared deployment",
        url: "https://jolly-cannon-fodder-shared-deploy.vercel.app",
        sourceRun: "run-planted-0000",
      },
    ];
    const findings = await deadRecordedEndpoints(planted, async () => ({
      serving: false,
      observed: "HTTP 404",
    }));
    assert.equal(findings.length, 1, "an endpoint that no longer serves must redden the check");
    const finding = findings[0]!;
    assert.ok(
      finding.message.includes("https://jolly-cannon-fodder-shared-deploy.vercel.app"),
      `the violation must name the endpoint: ${finding.message}`,
    );
    assert.ok(
      finding.message.includes("run-planted-0000"),
      `the violation must name the run that recorded it: ${finding.message}`,
    );
    // Plant removed: the same endpoint probing as serving leaves the check green.
    assert.equal(
      (
        await deadRecordedEndpoints(planted, async () => ({
          serving: true,
          observed: "HTTP 200",
        }))
      ).length,
      0,
      "an endpoint that still serves must leave the check green",
    );
  },
);
