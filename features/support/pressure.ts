// Verification support for the verification-economy pressure Rule (@logic
// @invariant): the wake records the pressure a run ran under, and the next
// run's worker count derives from the record.
//
// Overlapped tier legs contend for this machine's memory as well as its clock,
// so every tier-record run appends ONE pressure line — the run's worker count,
// its peak resident set size, and any out-of-memory kill events — into the
// same per-tier message stream the wall clock already uses (the `--format
// message:<path>` file the tier command itself names), never a new artifact.
//
// The recorder arms at run-config load (cucumber.js imports this module), in
// the coordinating main process only: worker children carry CUCUMBER_WORKER_ID
// and no `message:<path>` argv, so the guard keeps them out by construction. A
// focused run, static discovery, and step-usage enumeration carry no
// `message:<path>` target either, so only real tier-record runs record.
//
// Peak RSS is sampled from /proc over the run's own process tree (the main
// process and every descendant worker), because a parent's own maxRSS cannot
// see its children. Out-of-memory kills are read from the kernel log
// (/dev/kmsg) at run end, attributed to the run by the sampled pid set; where
// the kernel log is unreadable, the record carries the empty event list the
// environment allows observing.
import { appendFileSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface OomKillEvent {
  /** The killed process id, when the kernel line carries one. */
  pid?: number;
  /** The killed process name, when the kernel line carries one. */
  comm?: string;
  /** The kernel log line, verbatim. */
  raw: string;
}

export interface PressureRecord {
  /** The run's parallel worker count, as configured for the selected profile. */
  workers: number;
  /** Peak resident set size of the run's process tree, in bytes (sampled). */
  peakRssBytes: number;
  /** The memory ceiling the run contends under: this machine's total memory. */
  memoryCeilingBytes: number;
  /** Kernel out-of-memory kills of the run's own processes. */
  oomKills: OomKillEvent[];
}

/** A tier's pressure record, named for judging (the OOM-kill check). */
export interface TierPressure {
  tier: string;
  pressure: PressureRecord;
}

export interface OomFinding {
  tier: string;
  event: OomKillEvent;
  message: string;
}

/** Peak RSS at or above this fraction of the ceiling is a pressure signal: the
 * run rode the edge of memory, so the next run backs off before the crash is
 * rediscovered at full price. */
const AT_CEILING_FRACTION = 0.97;

/** Linux page size on this project's runtimes (x86-64/aarch64 default). */
const PAGE_SIZE_BYTES = 4096;

const SAMPLE_INTERVAL_MS = 250;

/**
 * The last pressure line a tier record carries, or `undefined` when the run
 * that wrote the record recorded none — which is exactly the condition the
 * pressure-record conformance scenario reddens on.
 */
export function readPressureRecord(recordPath: string): PressureRecord | undefined {
  if (!existsSync(recordPath)) return undefined;
  let last: PressureRecord | undefined;
  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let message: { pressure?: PressureRecord };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.pressure) last = message.pressure;
  }
  return last;
}

/** True when the record carries a pressure signal: an out-of-memory kill, or a
 * peak resident set size at the run's memory ceiling. */
export function pressureSignal(record: PressureRecord): boolean {
  return (
    record.oomKills.length > 0 ||
    record.peakRssBytes >= record.memoryCeilingBytes * AT_CEILING_FRACTION
  );
}

// ─── The rigging's declared worker ceilings ─────────────────────────────────

/**
 * The parallelism each run profile is configured for, before the weather's
 * backoff and the rigging's declared ceiling bound it. Held here, beside the
 * derivation that consumes it, so the runner configuration carries no second
 * copy and the 028 profile check can recompute the same expectation.
 */
export const CONFIGURED_PARALLELISM: Record<string, number> = {
  default: 1,
  logic: 2,
  sandbox: 2,
  sandboxSerial: 1,
  eval: 1,
  all: 1,
};

/** A `## Tiers` worker-ceiling line: `- workers-sandbox: 1`. */
const WORKER_CEILING_LINE = /^- workers-([a-z-]+): (\d+)/;

/**
 * The worker ceilings `RIGGING.md` declares under `## Tiers`, keyed by tier.
 * A ceiling is an operator capacity limit, declared in the rigging where it is
 * legible, rather than pinned as a prior in the runner configuration where it
 * reads as an ordinary starting value.
 */
export function readTierWorkerCeilings(riggingFile = "RIGGING.md"): Record<string, number> {
  const text = readFileSync(join(REPO_ROOT, riggingFile), "utf8");
  const ceilings: Record<string, number> = {};
  let inTiers = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inTiers = line.trim() === "## Tiers";
      continue;
    }
    if (!inTiers) continue;
    const value = WORKER_CEILING_LINE.exec(line.trim());
    if (!value) continue;
    ceilings[value[1]!] = Number(value[2]);
  }
  return ceilings;
}

/** The worker ceiling the rigging declares for a tier, when it declares one. */
export function tierWorkerCeiling(tier: string, riggingFile = "RIGGING.md"): number | undefined {
  return readTierWorkerCeilings(riggingFile)[tier];
}

/**
 * The worker count a tier's run profile runs at: the plain value the rigging
 * declares under `## Tiers`, read as configured. This box's capacity is an
 * operator fact that does not change between runs, so the count is declared
 * rather than derived at run time; deriving it builds an auto-tuner that
 * computes the declared value and adds its own failure modes to guard. The one
 * seam the runner configuration and the feature 028 profile check both read,
 * so the profile cannot carry a count the rigging did not declare.
 */
export function declaredTierWorkers(
  tier: string,
  riggingFile = "RIGGING.md",
): number {
  const declared = tierWorkerCeiling(tier, riggingFile);
  return declared ?? CONFIGURED_PARALLELISM[tier] ?? 1;
}

/** A run profile whose worker count differs from the count the rigging declares. */
export interface WorkerCountFinding {
  profile: string;
  profileWorkers: number;
  declaredWorkers: number;
  message: string;
}

/**
 * The finding a profile carrying a worker count other than the declared one
 * produces, naming the profile and both counts. Pure over its inputs, so the
 * planted red judges the same code path the real assertion does.
 */
export function workerCountFinding(
  profile: string,
  profileWorkers: number,
  declaredWorkers: number,
): WorkerCountFinding | undefined {
  if (profileWorkers === declaredWorkers) return undefined;
  return {
    profile,
    profileWorkers,
    declaredWorkers,
    message:
      `run profile "${profile}" runs ${profileWorkers} worker(s); RIGGING.md ` +
      `declares ${declaredWorkers} for that tier`,
  };
}

/**
 * A profile's worker count: yesterday's weather for that tier, restored toward
 * its configured parallelism, bounded above by the ceiling the rigging declares
 * for it. The one seam the runner configuration and the 028 profile check both
 * read, so the profile cannot carry a count the rigging did not license.
 */
export function deriveTierWorkers(
  tier: string,
  recordPath: string,
  riggingFile = "RIGGING.md",
): number {
  return deriveWorkerCount(
    recordPath,
    CONFIGURED_PARALLELISM[tier] ?? 1,
    tierWorkerCeiling(tier, riggingFile),
  );
}

/**
 * The worker count a tier's next run starts from: yesterday's weather. A record
 * carrying a pressure signal backs off below its green worker count (never
 * under 1); a record carrying none restores the count toward the profile's
 * configured parallelism, one worker per clean run; no pressure record at all
 * leaves the configured parallelism standing.
 *
 * Backoff without restore is a ratchet: a single pressure signal pins the tier
 * at its backed-off count for every later run, because each of those runs then
 * records the backed-off count as its own green. The sandbox tier sat at 1
 * worker that way and paid a 1334s wall against a 900s budget. Restoring toward
 * the configured parallelism on a clean record closes that gap, and the backoff
 * arm still catches the pressure the step up rediscovers.
 */
export function deriveWorkerCount(
  recordPath: string,
  configuredWorkers: number,
  ceilingWorkers?: number,
): number {
  const bound = effectiveParallelism(configuredWorkers, ceilingWorkers);
  const record = readPressureRecord(recordPath);
  if (!record || !Number.isInteger(record.workers) || record.workers < 1) {
    return bound;
  }
  if (pressureSignal(record)) return Math.max(1, Math.min(bound, record.workers - 1));
  return Math.min(bound, record.workers + 1);
}

/**
 * The parallelism a tier may actually reach: its configured count, bounded by
 * the ceiling the rigging declares for it. A declared ceiling is a capacity
 * limit the operator owns, so the restore arm climbs to it and stops there
 * instead of reading the held count as the recovery gap.
 */
function effectiveParallelism(configuredWorkers: number, ceilingWorkers?: number): number {
  if (ceilingWorkers === undefined) return configuredWorkers;
  return Math.max(1, Math.min(configuredWorkers, ceilingWorkers));
}

/** A derived worker count held below the configured parallelism by a record
 * that carries no pressure signal: the recovery gap, named. */
export interface WorkerRestoreFinding {
  recordedWorkers: number;
  derivedWorkers: number;
  configuredWorkers: number;
  message: string;
}

/**
 * Judge a derivation against the restore rule. A clean record must move the
 * count toward the configured parallelism; a derivation that leaves it at or
 * below the recorded count while the configured parallelism is higher is the
 * recovery gap, and is returned as a finding.
 */
export function workerRestoreFinding(
  record: PressureRecord,
  derivedWorkers: number,
  configuredWorkers: number,
  ceilingWorkers?: number,
): WorkerRestoreFinding | undefined {
  const bound = effectiveParallelism(configuredWorkers, ceilingWorkers);
  if (pressureSignal(record)) return undefined;
  if (record.workers >= bound) return undefined;
  if (derivedWorkers > record.workers) return undefined;
  return {
    recordedWorkers: record.workers,
    derivedWorkers,
    configuredWorkers: bound,
    message:
      `a record carrying no pressure signal recorded ${record.workers} worker(s) and ` +
      `derived ${derivedWorkers}, holding below the configured parallelism of ` +
      `${bound} instead of restoring toward it`,
  };
}

/** Judge tier pressure records: every recorded out-of-memory kill is a finding,
 * red and named, never a silent rerun. */
export function oomKillFindings(records: TierPressure[]): OomFinding[] {
  const findings: OomFinding[] = [];
  for (const { tier, pressure } of records) {
    for (const event of pressure.oomKills) {
      findings.push({
        tier,
        event,
        message:
          `the ${tier} tier's last run recorded an out-of-memory kill` +
          `${event.pid !== undefined ? ` of pid ${event.pid}` : ""}` +
          `${event.comm !== undefined ? ` (${event.comm})` : ""}: ${event.raw}`,
      });
    }
  }
  return findings;
}

// ─── Recording (armed from the run config, main process only) ───────────────

/** The `message:<path>` target the run's own argv names, when it names one.
 * Exported for the run-end recorder (spend-ledger.ts), which gates on the same
 * tier-record signal. */
export function messageRecordPathFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let value: string | undefined;
    if (arg === "--format") value = argv[i + 1];
    else if (arg.startsWith("--format=")) value = arg.slice("--format=".length);
    if (value === undefined) continue;
    const match = /^message:(.+)$/.exec(value);
    if (match) return match[1];
  }
  return undefined;
}

/** The run's worker count: the CLI `--parallel` override, else the selected
 * profile's configured count, else the default profile's. */
function workersFromArgv(
  argv: readonly string[],
  workersByProfile: Record<string, number>,
): number {
  let profile = "default";
  let workers: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--parallel") workers = Number(argv[i + 1]);
    else if (arg.startsWith("--parallel=")) workers = Number(arg.slice("--parallel=".length));
    else if (arg === "-p" || arg === "--profile") profile = argv[i + 1] ?? profile;
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
  }
  if (workers !== undefined && Number.isInteger(workers) && workers >= 1) return workers;
  return workersByProfile[profile] ?? workersByProfile["default"] ?? 1;
}

/** Seconds since boot, from /proc/uptime, in microseconds (kmsg's clock). */
function bootMicroseconds(): number {
  const uptime = Number.parseFloat(readFileSync("/proc/uptime", "utf8").split(" ")[0]!);
  return Math.floor(uptime * 1_000_000);
}

/** One /proc pass: resident set bytes of the given root and every descendant. */
function sampleProcessTree(rootPid: number): { rssBytes: number; pids: number[] } {
  const parents = new Map<number, number>();
  const rssPages = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let stat: string;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      continue; // exited between listing and read
    }
    // "pid (comm) state ppid ... rss ..." — comm may hold spaces and parens,
    // so fields resume after the LAST ')': state, then ppid, ... rss is the
    // kernel's field 24, index 21 of the post-comm tokens.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const fields = afterComm.split(" ");
    parents.set(pid, Number(fields[1]));
    rssPages.set(pid, Number(fields[21]));
  }
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const siblings = children.get(ppid) ?? [];
    siblings.push(pid);
    children.set(ppid, siblings);
  }
  let rssBytes = 0;
  const pids: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    pids.push(pid);
    rssBytes += (rssPages.get(pid) ?? 0) * PAGE_SIZE_BYTES;
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return { rssBytes, pids };
}

/** Kernel out-of-memory kills since the given boot-relative microsecond mark,
 * attributed to the run by its sampled pid set. Empty where /dev/kmsg is
 * unreadable: the record carries what the environment allows observing. */
function oomKillsSince(sinceBootUs: number, runPids: ReadonlySet<number>): OomKillEvent[] {
  let fd: number;
  try {
    fd = openSync("/dev/kmsg", constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return [];
  }
  const events: OomKillEvent[] = [];
  try {
    const buffer = Buffer.alloc(8192);
    for (;;) {
      let bytes: number;
      try {
        bytes = readSync(fd, buffer, 0, buffer.length, null); // one record per read
      } catch {
        break; // EAGAIN: the buffered log is drained (or a record was overwritten)
      }
      if (bytes <= 0) break;
      const record = buffer.toString("utf8", 0, bytes);
      const semicolon = record.indexOf(";");
      if (semicolon < 0) continue;
      const [, , timestampUs] = record.slice(0, semicolon).split(",");
      if (Number(timestampUs) < sinceBootUs) continue;
      const line = record.slice(semicolon + 1).trim();
      const kill = /Killed process (\d+) \(([^)]*)\)/.exec(line);
      if (!kill || !/out of memory|oom/i.test(line)) continue;
      const pid = Number(kill[1]);
      if (!runPids.has(pid)) continue; // another process's kill is not this run's event
      events.push({ pid, comm: kill[2], raw: line });
    }
  } finally {
    closeSync(fd);
  }
  return events;
}

/**
 * Arm pressure recording for this run. Called from cucumber.js at config load
 * with each profile's configured worker count; records only in the
 * coordinating main process of a run whose argv names a `message:<path>`
 * record target. One pressure line is appended to that record at process exit.
 */
export function armPressureRecording(workersByProfile: Record<string, number>): void {
  if (process.env.CUCUMBER_WORKER_ID !== undefined) return; // worker child: the main process records
  const recordPath = messageRecordPathFromArgv(process.argv);
  if (recordPath === undefined) return; // not a tier-record run
  const workers = workersFromArgv(process.argv, workersByProfile);
  const startedAtBootUs = bootMicroseconds();
  let peakRssBytes = 0;
  const seenPids = new Set<number>();
  const sample = () => {
    try {
      const { rssBytes, pids } = sampleProcessTree(process.pid);
      if (rssBytes > peakRssBytes) peakRssBytes = rssBytes;
      for (const pid of pids) seenPids.add(pid);
    } catch {
      // A vanished /proc entry mid-walk is the next sample's problem.
    }
  };
  sample();
  // unref: the sampler must never hold the run's process open past its work.
  const sampler = setInterval(sample, SAMPLE_INTERVAL_MS);
  sampler.unref();
  process.on("exit", () => {
    clearInterval(sampler);
    sample();
    const pressure: PressureRecord = {
      workers,
      peakRssBytes,
      memoryCeilingBytes: totalmem(),
      oomKills: oomKillsSince(startedAtBootUs, seenPids),
    };
    try {
      appendFileSync(recordPath, `${JSON.stringify({ pressure })}\n`);
    } catch (error) {
      // Loud, not fatal: absence of the pressure line is exactly what the
      // derived pressure-record check reddens on at its next run.
      process.stderr.write(`pressure record write failed for ${recordPath}: ${String(error)}\n`);
    }
  });
}
