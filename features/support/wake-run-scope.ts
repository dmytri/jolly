// Verification support for the verification-economy scenario "A wake reader
// selects a completed run's record, never a live sibling's partial one"
// (@logic @invariant).
//
// Per the feature's Rule "The wake is read run-scoped", overlapped tier legs
// write the wake concurrently, so every reader that consumes "the last run's
// record" must select a COMPLETED run's record and leave a live sibling's
// partial one unread. The law covers every wake reader: the spend-ledger join,
// the budget-fit check, and the pressure and worker-count priors. This module
// builds a fixture wake carrying exactly that state — one completed sandbox
// run's record beside a live sibling's partial one, and a spend ledger both
// runs appended to, the sibling last — and enumerates what each REAL reader
// seam selects from it, so the run-scope law is judged against the same
// functions the real checks consume, never a parallel re-implementation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveWorkerCount,
  readPressureRecord,
  type PressureRecord,
} from "./pressure.ts";
import {
  lastRunEntries,
  readSpendLedger,
  SHARED_PROVISIONING,
  type SpendEntry,
} from "./spend-ledger.ts";
import { readTierWallClock } from "./wake.ts";

export interface WakeReaderFixture {
  dir: string;
  /** The completed sandbox run's record: started, finished, pressure line. */
  completedRecordPath: string;
  /** The live sibling's record: started, mid-run — no finish, no pressure. */
  partialRecordPath: string;
  /** The spend ledger both runs appended to, the live sibling last. */
  ledgerPath: string;
  completedRunId: string;
  liveRunId: string;
  /** The completed record's pressure-line worker count. */
  completedWorkers: number;
  /** The completed run's wall clock, in seconds. */
  completedClockSeconds: number;
}

/**
 * Write a fixture wake into `dir`: one completed sandbox run's record beside a
 * live sibling invocation's partial one. The sibling started while the
 * completed run was still spending and appended to the shared ledger last —
 * the append-order trap a run-scoped reader must not fall into.
 */
export function writeWakeReaderFixture(dir: string): WakeReaderFixture {
  mkdirSync(dir, { recursive: true });
  const completedRunId = "run-completed-fixture";
  const liveRunId = "run-live-fixture";
  const completedWorkers = 3;

  const completedRecordPath = join(dir, "completed-sandbox.ndjson");
  const pressure: PressureRecord = {
    workers: completedWorkers,
    peakRssBytes: 4_000_000_000,
    memoryCeilingBytes: 16_000_000_000,
    oomKills: [],
  };
  const completedLines = [
    { testRunStarted: { timestamp: { seconds: 1_000, nanos: 0 } } },
    {
      testRunFinished: {
        timestamp: { seconds: 1_042, nanos: 500_000_000 },
        success: true,
      },
    },
    { pressure },
  ];
  writeFileSync(
    completedRecordPath,
    completedLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf8",
  );

  // The live sibling: testRunStarted and a test case under way. No
  // testRunFinished and no pressure line — both arrive only when its
  // coordinating process exits.
  const partialRecordPath = join(dir, "live-sibling-sandbox.ndjson");
  const partialLines = [
    { testRunStarted: { timestamp: { seconds: 1_010, nanos: 0 } } },
    {
      testCaseStarted: {
        id: "tcs-1",
        testCaseId: "tc-1",
        timestamp: { seconds: 1_011, nanos: 0 },
      },
    },
  ];
  writeFileSync(
    partialRecordPath,
    partialLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf8",
  );

  const ledgerPath = join(dir, "sandbox-spend-ledger.ndjson");
  const entries: SpendEntry[] = [
    {
      run: completedRunId,
      tier: "sandbox",
      at: 1_000_000,
      scenario: "(run)",
      spend: "run-start",
    },
    {
      run: completedRunId,
      tier: "sandbox",
      at: 1_000_500,
      scenario: SHARED_PROVISIONING,
      spend: "shared-provisioning",
      class: "saleor-environment",
    },
    {
      run: liveRunId,
      tier: "sandbox",
      at: 1_010_000,
      scenario: "(run)",
      spend: "run-start",
    },
    {
      run: completedRunId,
      tier: "sandbox",
      at: 1_020_000,
      scenario: "The full pipeline proof",
      spend: "vercel-deploy",
    },
    {
      run: completedRunId,
      tier: "sandbox",
      at: 1_042_500,
      scenario: "(run)",
      spend: "run-end",
    },
    {
      run: liveRunId,
      tier: "sandbox",
      at: 1_043_000,
      scenario: "A sibling's pipeline proof",
      spend: "git-clone",
    },
  ];
  writeFileSync(
    ledgerPath,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );

  return {
    dir,
    completedRecordPath,
    partialRecordPath,
    ledgerPath,
    completedRunId,
    liveRunId,
    completedWorkers,
    completedClockSeconds: 42.5,
  };
}

/** The wake readers the run-scope law names. */
export const WAKE_READERS = [
  "spend-ledger join",
  "budget-fit wall clock",
  "pressure prior",
  "worker-count prior",
] as const;

export type SelectedRecord = "completed" | "partial" | "none";

export interface ReaderSelection {
  reader: string;
  selected: SelectedRecord;
  detail: string;
}

/**
 * What each wake reader selects from the fixture wake, judged by the record it
 * consumed: the completed run's, the live sibling's partial one, or none. Each
 * reader is the REAL seam the real checks consume. `ledgerSelection` is
 * injectable for the planted red only; it defaults to the production ledger
 * reader.
 */
export function enumerateWakeReaderSelections(
  fixture: WakeReaderFixture,
  options: {
    ledgerSelection?: (entries: SpendEntry[]) => SpendEntry[];
  } = {},
): ReaderSelection[] {
  const ledgerSelection = options.ledgerSelection ?? lastRunEntries;
  const selections: ReaderSelection[] = [];

  // The spend-ledger join: the selection the licence and shared-once checks
  // consume as "the sandbox tier's last run".
  const selected = ledgerSelection(readSpendLedger(fixture.ledgerPath));
  const runs = new Set(selected.map((entry) => entry.run));
  selections.push({
    reader: "spend-ledger join",
    selected: runs.has(fixture.liveRunId)
      ? "partial"
      : runs.has(fixture.completedRunId)
        ? "completed"
        : "none",
    detail: `selected ${selected.length} ledger entries of run(s) ${
      [...runs].join(", ") || "(none)"
    }`,
  });

  // The budget-fit check: one wall clock per record.
  const partialClock = readTierWallClock(fixture.partialRecordPath);
  const completedClock = readTierWallClock(fixture.completedRecordPath);
  selections.push({
    reader: "budget-fit wall clock",
    selected: partialClock ? "partial" : completedClock ? "completed" : "none",
    detail: partialClock
      ? `read a ${partialClock.seconds.toFixed(1)}s clock out of the live sibling's record`
      : completedClock
        ? `read the completed run's ${completedClock.seconds.toFixed(1)}s clock`
        : "read no clock",
  });

  // The pressure prior: the wall-clock-gated pressure read the OOM check uses.
  const gatedPressureFrom: string[] = [];
  for (const recordPath of [fixture.completedRecordPath, fixture.partialRecordPath]) {
    if (!readTierWallClock(recordPath)) continue;
    if (readPressureRecord(recordPath)) gatedPressureFrom.push(recordPath);
  }
  selections.push({
    reader: "pressure prior",
    selected: gatedPressureFrom.includes(fixture.partialRecordPath)
      ? "partial"
      : gatedPressureFrom.includes(fixture.completedRecordPath)
        ? "completed"
        : "none",
    detail: `read pressure from ${gatedPressureFrom.length} record(s)`,
  });

  // The worker-count prior: yesterday's weather. A sentinel fallback distinct
  // from every fixture count makes "consumed nothing" legible.
  const sentinel = 99;
  const priorFromPartial = deriveWorkerCount(fixture.partialRecordPath, sentinel);
  const priorFromCompleted = deriveWorkerCount(fixture.completedRecordPath, sentinel);
  selections.push({
    reader: "worker-count prior",
    selected:
      priorFromPartial !== sentinel
        ? "partial"
        : priorFromCompleted === fixture.completedWorkers
          ? "completed"
          : "none",
    detail:
      priorFromPartial !== sentinel
        ? `derived ${priorFromPartial} workers out of the live sibling's record`
        : `derived ${priorFromCompleted} workers from the completed run's record`,
  });

  return selections;
}

export interface RunScopeViolation {
  reader: string;
  message: string;
}

/** Every reader whose selection is not the completed run's record. */
export function runScopeViolations(
  selections: ReaderSelection[],
): RunScopeViolation[] {
  return selections
    .filter((selection) => selection.selected !== "completed")
    .map((selection) => ({
      reader: selection.reader,
      message:
        selection.selected === "partial"
          ? `the ${selection.reader} reader consumed the live sibling's partial record: ${selection.detail}`
          : `the ${selection.reader} reader selected no completed run's record: ${selection.detail}`,
    }));
}
