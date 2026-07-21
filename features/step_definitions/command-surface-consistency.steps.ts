// Command-surface consistency (feature command-surface-consistency).
//
// Jolly names its top-level command surface in two invocation-style places:
// `jolly --help` (the envelope's `data.commands`) and the unknown-command error
// (the remediation on the UNKNOWN_COMMAND error entry). This @property scenario
// pins that the two name the same set of commands. The two `When` steps that run
// `jolly --help` and `jolly frobnicate --json` are shared (006/027); this file
// carries only the cross-run comparison Then.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";
import type { CliResult } from "../support/world.ts";
import {
  commandSites,
  commandSurfaceViolations,
  declaredSurface,
  type CommandSite,
  type SurfaceViolation,
} from "../support/command-surface-conformance.ts";

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

// ─── Every command site derives from one declared command surface ───────────
//
// The four sites a command name is written in today (completion registration,
// help command data, dispatch switch, unknown-command remediation) are joined
// against the one declaration they must all derive from. Where no declaration
// exists, that absence is the violation: four hand-maintained copies join to
// nothing.

Given("the command surface Jolly declares", function (this: JollyWorld) {
  this.notes.declaredSurface = declaredSurface();
});

When(
  "the completion registration, the help command data, the dispatch cases, and the unknown-command remediation are each read",
  function (this: JollyWorld) {
    const sites = commandSites();
    this.notes.commandSites = sites;
    this.notes.surfaceViolations = commandSurfaceViolations(
      this.notes.declaredSurface as string[] | undefined,
      sites,
    );
  },
);

Then("each site's command set should equal the declared surface", function (this: JollyWorld) {
  const violations = this.notes.surfaceViolations as SurfaceViolation[];
  assert.equal(
    violations.length,
    0,
    `command sites disagreeing with the declared surface:\n${violations
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
});

Then(
  "a command present in one site and absent from another should redden the check, naming the command and the site missing it",
  function (this: JollyWorld) {
    const sites = this.notes.commandSites as CommandSite[];
    const surface = ["login", "logout"];
    const planted: CommandSite[] = [
      { name: "the planted complete site", file: "src/planted.ts", commands: ["login", "logout"] },
      { name: "the planted incomplete site", file: "src/planted.ts", commands: ["login"] },
    ];
    const violations = commandSurfaceViolations(surface, planted);
    const missing = violations.find(
      (violation) =>
        violation.command === "logout" && violation.site === "the planted incomplete site",
    );
    assert.ok(missing, "a command absent from one site was not reported");
    assert.ok(
      missing.message.includes("logout") &&
        missing.message.includes("the planted incomplete site"),
      `the report must name the command and the site missing it: ${missing.message}`,
    );
    assert.equal(
      violations.filter((violation) => violation.site === "the planted complete site").length,
      0,
      "a site whose set equals the surface must not be reported",
    );
    assert.ok(sites.length === 4, `expected the four command sites; got ${sites.length}`);
  },
);
