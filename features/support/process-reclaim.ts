// Verification support for the verification-economy scenario "A tier run leaves
// none of its spawned processes running" (@sandbox @invariant).
//
// Reclamation (feature 030) covers cloud resources and scratch directories,
// age-gated and namespace-scoped. A spawned operating-system process falls
// outside it, so a detached child that outlives its run is reclaimed by nothing,
// and a child blocking with no terminal attached costs its run nothing it can
// observe — the tier reports green and the leak is invisible.
//
// The pressure recorder already tracks the run's process tree to attribute
// out-of-memory kills; this is a second reader of that set. At the coordinating
// process's exit — after the run's work is complete — it samples the process
// tree once more and records the descendants still alive as the run's leftover
// set into the same per-tier message stream the wall clock and pressure lines
// use. A clean run has reaped its workers, so the set is empty; a leak leaves a
// named process behind. Armed for any tier-record run, so the cheap default
// tier records it too, where an unreclaimed spawn is paid on every inner loop.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { messageRecordPathFromArgv } from "./pressure.ts";

export interface LeftoverProcess {
  /** The still-running process id. */
  pid: number;
  /** The process command name, from /proc/<pid>/stat. */
  comm: string;
}

/**
 * The still-running descendants of the given root at this instant, excluding
 * the root itself: the processes a run spawned that outlive it. Read from
 * /proc, so it observes the real process table rather than a tracked guess.
 */
export function leftoverDescendants(rootPid: number): LeftoverProcess[] {
  const parents = new Map<number, number>();
  const comms = new Map<number, string>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let stat: string;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      continue; // exited between listing and read
    }
    // "pid (comm) state ppid ...": comm may hold spaces and parens, so read it
    // between the first '(' and the last ')', and resume fields after the ')'.
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    const comm = open >= 0 && close > open ? stat.slice(open + 1, close) : "";
    const fields = stat.slice(close + 2).split(" ");
    parents.set(pid, Number(fields[1]));
    comms.set(pid, comm);
  }
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const siblings = children.get(ppid) ?? [];
    siblings.push(pid);
    children.set(ppid, siblings);
  }
  const leftovers: LeftoverProcess[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (pid !== rootPid) leftovers.push({ pid, comm: comms.get(pid) ?? "" });
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return leftovers;
}

/** Append the run's leftover-process record to its tier message stream. */
export function recordLeftoverProcesses(
  recordPath: string,
  leftovers: LeftoverProcess[],
): void {
  try {
    appendFileSync(recordPath, `${JSON.stringify({ processes: leftovers })}\n`);
  } catch (error) {
    // Loud, not fatal: an absent record reads as no completed run to judge,
    // which the reclamation check surfaces rather than passing silently over.
    process.stderr.write(
      `leftover-process record write failed for ${recordPath}: ${String(error)}\n`,
    );
  }
}

/**
 * The last leftover-process record a tier record carries, or `undefined` when
 * the run wrote none: the run predates the recorder, or was not a tier-record
 * run. An empty array means the run reclaimed every process it spawned.
 */
export function readLeftoverProcesses(
  recordPath: string,
): LeftoverProcess[] | undefined {
  if (!existsSync(recordPath)) return undefined;
  let last: LeftoverProcess[] | undefined;
  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let message: { processes?: LeftoverProcess[] };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (Array.isArray(message.processes)) last = message.processes;
  }
  return last;
}

export interface LeftoverFinding {
  process: LeftoverProcess;
  message: string;
}

/** Every leftover process a run left behind, named with its command and pid. */
export function leftoverProcessFindings(
  leftovers: LeftoverProcess[],
): LeftoverFinding[] {
  return leftovers.map((process) => ({
    process,
    message:
      `the run left process ${process.pid} (${process.comm || "unknown"}) ` +
      `still running after it exited, reclaimed by nothing`,
  }));
}

/**
 * Arm leftover-process recording for this run: a tier-record run appends one
 * leftover-process line at its coordinating process's exit, mirroring the
 * pressure recorder's gates — main process only, a run naming a `message:<path>`
 * record target. A worker child, a focused run, discovery, and step-usage name
 * no record target and record nothing. A command that stopped loading this
 * config stops recording, which the reclamation check reddens on.
 */
export function armProcessReclaimRecording(): void {
  if (process.env.CUCUMBER_WORKER_ID !== undefined) return; // worker child
  const recordPath = messageRecordPathFromArgv(process.argv);
  if (recordPath === undefined) return; // not a tier-record run
  process.on("exit", () => {
    recordLeftoverProcesses(recordPath, leftoverDescendants(process.pid));
  });
}
