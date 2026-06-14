// A harness-fake `npx`, used by feature 004 (@logic) to keep the
// configurator-deploy stage hermetic. `jolly start`'s recipe stage spawns
// `npx @saleor/configurator deploy ...`; the real `npx` would download
// @saleor/configurator from the registry before it ever contacts the (dummy,
// unroutable) store, which is slow and network-dependent. This fake `npx`,
// placed first on the child's PATH, answers WITHOUT any network call:
//
//   - `@saleor/configurator ...`  → exits non-zero (a deploy that did not
//     complete — here, an unroutable store), so the recipe stage can only be
//     reported blocked, never a fabricated completion.
//   - anything else (e.g. `skills add`) → a harmless best-effort failure. Init
//     still writes .mcp.json + AGENTS.md, so `jolly start`'s bootstrap succeeds
//     and the run reaches the orchestration stages regardless.
//
// Mirrors features/support/stripe-cli-fake.ts (the same PATH-shim pattern).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FakeNpxOptions {
  /** Exit code the fake returns for an `@saleor/configurator` invocation.
   *  Default 1 — an honest failure the recipe stage must report as blocked. */
  configuratorExitCode?: number;
  /** When set, the fake appends each invocation's argv (JSON) one line per call. */
  traceFile?: string;
}

/**
 * Write an executable fake `npx` into `dir` and return its path. Put `dir` first
 * on the PATH of the process under test so a bare `npx` resolves here.
 */
export function writeFakeNpx(dir: string, opts: FakeNpxOptions = {}): string {
  const exit = opts.configuratorExitCode ?? 1;
  const traceLine = opts.traceFile
    ? `try { fs.appendFileSync(${JSON.stringify(opts.traceFile)}, JSON.stringify(argv) + "\\n"); } catch {}`
    : "";
  const script = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const argv = process.argv.slice(2);
${traceLine}
if (argv.join(" ").includes("@saleor/configurator")) {
  // Stand in for a configurator deploy that could not complete (here, an
  // unroutable store). Exit non-zero WITHOUT any network call so the recipe
  // stage is reported blocked, never a fabricated completion.
  process.stderr.write("fake npx: @saleor/configurator deploy did not complete\\n");
  process.exit(${exit});
}
// Anything else (e.g. \`skills add\`) is a harmless best-effort no-op failure.
process.stderr.write("fake npx: offline stub\\n");
process.exit(1);
`;
  const path = join(dir, "npx");
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

/** Parse the fake `npx` argv trace (one JSON array per invocation). */
export function readNpxTrace(traceFile: string): string[][] {
  if (!existsSync(traceFile)) return [];
  const calls: string[][] = [];
  for (const line of readFileSync(traceFile, "utf8").split("\n")) {
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
