// Command-surface consistency (feature command-surface-consistency).
//
// Jolly names its top-level command surface in two invocation-style places:
// `jolly --help` (the envelope's `data.commands`) and the unknown-command error
// (the remediation on the UNKNOWN_COMMAND error entry). This @property scenario
// pins that the two name the same set of commands. The two `When` steps that run
// `jolly --help` and `jolly frobnicate --json` are shared (006/027); this file
// carries only the cross-run comparison Then.
import { Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";
import type { CliResult } from "../support/world.ts";

// The help envelope advertises its command set as `data.commands`.
function helpCommandSet(run: CliResult): string[] | undefined {
  const commands = run.envelope?.data?.["commands"];
  return Array.isArray(commands) ? commands.map(String) : undefined;
}

// The unknown-command error names its command set in the remediation prose of
// the UNKNOWN_COMMAND entry: "Supported commands: a, b, c. Run `jolly help`...".
function errorCommandSet(run: CliResult): string[] | undefined {
  const entry = run.envelope?.errors?.find((e) => e["code"] === "UNKNOWN_COMMAND");
  const remediation = entry?.["remediation"];
  if (typeof remediation !== "string") return undefined;
  const match = remediation.match(/Supported commands:\s*(.+?)\./);
  if (!match) return undefined;
  return match[1]!.split(/,\s*/).map((c) => c.trim()).filter(Boolean);
}

Then(
  "the command set `jolly --help` advertises should equal the set the unknown-command error names",
  function (this: JollyWorld) {
    const runs = [this.previousRun, this.lastRun].filter(Boolean) as CliResult[];
    let helpSet: string[] | undefined;
    let errorSet: string[] | undefined;
    for (const run of runs) {
      helpSet ??= helpCommandSet(run);
      errorSet ??= errorCommandSet(run);
    }
    assert.ok(helpSet, "`jolly --help` must advertise a command set in `data.commands`");
    assert.ok(errorSet, "the unknown-command error must name a command set in its remediation");
    assert.deepEqual(
      [...helpSet].sort(),
      [...errorSet].sort(),
      `the command set advertised by \`jolly --help\` (${JSON.stringify([...helpSet].sort())}) ` +
        `must equal the set the unknown-command error names (${JSON.stringify([...errorSet].sort())})`,
    );
  },
);
