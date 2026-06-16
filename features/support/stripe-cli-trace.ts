// Real Stripe CLI observation helpers (NOT a fake).
//
// These drive the REAL `stripe` CLI and only observe it; they never stand in for
// it. `writeStripeCliTraceWrapper` installs a passthrough `stripe` that records
// each invocation's argv and then EXECs the real binary, so an @sandbox scenario
// can prove Jolly invoked `config --list` read-only (never `login`/OAuth) while
// importing genuine session keys. `readStripeTrace` parses that argv trace.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Write an executable passthrough `stripe` into `dir` that records each
 * invocation's argv (one JSON array per line in `traceFile`) and then EXECs the
 * REAL `stripe` binary at `realStripePath`, streaming its real stdout/stderr and
 * exit code through. This is NOT a fake: it runs the real, logged-in Stripe CLI
 * and returns its real test-mode keys — the trace is observation only. Put `dir`
 * first on the PATH of the process under test; `realStripePath` is the absolute
 * path resolved BEFORE the wrapper shadows the bare name, so it never recurses.
 */
export function writeStripeCliTraceWrapper(
  dir: string,
  opts: { traceFile: string; realStripePath: string },
): string {
  const script = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
try { fs.appendFileSync(${JSON.stringify(opts.traceFile)}, JSON.stringify(argv) + "\\n"); } catch {}
const r = spawnSync(${JSON.stringify(opts.realStripePath)}, argv, { stdio: "inherit" });
process.exit(typeof r.status === "number" ? r.status : 1);
`;
  const path = join(dir, "stripe");
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

/** Parse the Stripe CLI's argv trace (one JSON array per invocation). */
export function readStripeTrace(traceFile: string): string[][] {
  if (!existsSync(traceFile)) return [];
  const text = readFileSync(traceFile, "utf8");
  const calls: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const argv = JSON.parse(line);
      if (Array.isArray(argv)) calls.push(argv);
    } catch {
      // ignore a malformed line
    }
  }
  return calls;
}
