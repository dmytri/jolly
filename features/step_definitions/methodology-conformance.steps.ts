// Feature methodology-conformance — derived checks that make Shipshape
// methodology rules executable (@logic @invariant):
//   - a green tree carries no standing perturbation token in src/ or bin/,
//   - a credentialed tier fails loudly when its credential is absent,
//   - every plank names a current step-definition pattern, and a
//     `@planks-provisional(...)` annotation liquidates itself at promotion,
//   - no dead verification-support artifact accumulates: no orphaned
//     step-definition pattern and no unreferenced features/support/ export, and
//   - every verification surface in the tree is run by a configured tier command.
// All are verification support; each is proven honest by a planted red inside
// its own scenario. The plank checks read the TypeScript AST, so they see what
// the text-search plank inventory cannot.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import {
  persistedAgentRuns,
  preserveWakeRecord,
  runTierWithoutCredential,
  scenarioSummary,
  tierCommand,
  type CredentiallessRun,
} from "../support/tier-credential.ts";
import type { TierCommand } from "../support/wake.ts";
import {
  scanForToken,
  type TokenMatch,
} from "../support/methodology-conformance.ts";
import {
  carriesLeadingKeyword,
  collectPlanks,
  collectProvisionalPlanks,
  collectStepUsagePatterns,
  findProvisionalPlankViolations,
  findUnpatternedPlanks,
  parseScenarioIndex,
  type InjectedSource,
  type Plank,
} from "../support/plank-conformance.ts";
import {
  enumerateTestSurfaces,
  findUnreachedSurfaces,
  readConfiguredCommands,
  type ConfiguredCommand,
  type SurfaceViolation,
  type TestSurface,
} from "../support/verification-surface-conformance.ts";
import {
  collectStepUsageEntries,
  collectSupportExports,
  findOrphanPatterns,
  findUnreachableSupportSymbols,
  findUnreferencedExports,
  type OrphanPattern,
  type StepUsageEntry,
  type SupportExport,
  type UnreachableSymbol,
  type UnreferencedExport,
} from "../support/dead-artifact-conformance.ts";

/** The implementation directories from RIGGING.md. */
const IMPLEMENTATION_DIRS = ["src/", "bin/"];

Given(
  "the implementation directories {string} and {string}",
  function (this: JollyWorld, first: string, second: string) {
    this.notes.implDirs = [first, second];
  },
);

When(
  "the perturbation-quiescence check scans them for the {string} token",
  function (this: JollyWorld, token: string) {
    this.notes.scanToken = token;
    this.notes.scanMatches = scanForToken(this.notes.implDirs as string[], token);
  },
);

Then("it should report no match", function (this: JollyWorld) {
  const matches = this.notes.scanMatches as TokenMatch[];
  assert.equal(
    matches.length,
    0,
    `standing "${this.notes.scanToken}" token(s):\n${matches
      .map((match) => `  ${match.file}:${match.line}`)
      .join("\n")}`,
  );
});

Then(
  "planting the {string} token in a {string} file should redden the check",
  function (this: JollyWorld, token: string, dir: string) {
    const dirs = this.notes.implDirs as string[];
    const plantRel = join(dir, `.perturbation-quiescence-plant-${process.pid}.ts`);
    const plantAbs = join(REPO_ROOT, plantRel);
    // Teardown registered before creation, loud on failure via the registry.
    this.cleanup.register(`quiescence plant ${plantRel}`, () => {
      rmSync(plantAbs, { force: true });
    });
    writeFileSync(plantAbs, `// ${token}: planted red proof\n`, "utf8");
    const matches = scanForToken(dirs, token);
    // Remove immediately; the registered teardown remains the safety net.
    rmSync(plantAbs, { force: true });
    assert.ok(
      matches.some((match) => match.file === plantRel),
      `planted "${token}" token in ${plantRel} was not detected by the scan`,
    );
  },
);


Given(
  "the {string} step texts in the implementation directories",
  function (this: JollyWorld, token: string) {
    this.notes.plankToken = token;
    this.notes.implDirs = IMPLEMENTATION_DIRS;
    this.notes.planks = collectPlanks(IMPLEMENTATION_DIRS);
    assert.ok(
      (this.notes.planks as Plank[]).length > 0,
      `no ${token} step texts found in ${IMPLEMENTATION_DIRS.join(", ")}`,
    );
  },
);

When(
  "each is cross-referenced by exact string match against the step-definition patterns reported by {string}",
  function (this: JollyWorld, _tool: string) {
    const patterns = collectStepUsagePatterns();
    this.notes.usagePatterns = patterns;
    this.notes.unpatternedPlanks = findUnpatternedPlanks(
      this.notes.planks as Plank[],
      patterns,
    );
  },
);

Then(
  "every plank's step should match one current step-definition pattern",
  function (this: JollyWorld) {
    const unpatterned = this.notes.unpatternedPlanks as Plank[];
    assert.equal(
      unpatterned.length,
      0,
      `planks matching no current step-definition pattern:\n${unpatterned
        .map((plank) => `  - ${plank.file}:${plank.line} "${plank.step}"`)
        .join("\n")}`,
    );
  },
);

Then(
  "the match should compare the plank's whole text, stripping no leading Gherkin keyword from either side",
  function (this: JollyWorld) {
    // Take a real current pattern and prepend a keyword. The pattern side is
    // unchanged, so anything that still matches can only have stripped the
    // keyword from the plank side.
    const patterns = this.notes.usagePatterns as string[];
    const pattern = patterns[0];
    assert.ok(pattern, "step-usage reported no step-definition pattern to compare against");
    const planted: InjectedSource = {
      file: "src/.planted-keyword-prefixed-plank.ts",
      text: [
        `/** @planks("Given ${pattern.replace(/"/g, '\\"')}") */`,
        "export function keywordPrefixedSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const planks = collectPlanks(this.notes.implDirs as string[], [planted]);
    const unpatterned = findUnpatternedPlanks(planks, patterns);
    assert.ok(
      unpatterned.some((plank) => plank.file === planted.file),
      `a plank carrying a leading keyword before the current pattern "${pattern}" ` +
        "matched it, so the join stripped the keyword instead of comparing whole texts",
    );
  },
);

Then(
  "a plank carrying a leading {string}, {string}, or {string} should redden the check, naming the plank and its seam",
  function (this: JollyWorld, given: string, when: string, then: string) {
    const patterns = this.notes.usagePatterns as string[];
    const pattern = patterns[0];
    assert.ok(pattern, "step-usage reported no step-definition pattern to compare against");
    for (const keyword of [given, when, then]) {
      const planted: InjectedSource = {
        file: `src/.planted-${keyword.toLowerCase()}-plank.ts`,
        text: [
          `/** @planks("${keyword} ${pattern.replace(/"/g, '\\"')}") */`,
          `export function ${keyword.toLowerCase()}PrefixedSeam(): boolean {`,
          "  return true;",
          "}",
        ].join("\n"),
      };
      const planks = collectPlanks(this.notes.implDirs as string[], [planted]);
      const reported = findUnpatternedPlanks(planks, patterns).find(
        (plank) => plank.file === planted.file,
      );
      assert.ok(
        reported,
        `a plank carrying a leading "${keyword}" was not reported`,
      );
      assert.ok(
        carriesLeadingKeyword(reported.step),
        `the reported plank must carry the leading keyword: "${reported.step}"`,
      );
      assert.ok(
        reported.step.startsWith(`${keyword} `) &&
          reported.file === planted.file &&
          reported.line > 0,
        `the report must name the plank and its seam: ${JSON.stringify(reported)}`,
      );
    }
  },
);

Then(
  "a plank matching no current step-definition pattern should redden the check",
  function (this: JollyWorld) {
    const planted: InjectedSource = {
      file: "src/.planted-unpatterned-plank.ts",
      text: [
        '/** @planks("Then no current step-definition pattern carries this exact text") */',
        "export function unpatternedSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const planks = collectPlanks(this.notes.implDirs as string[], [planted]);
    const unpatterned = findUnpatternedPlanks(
      planks,
      this.notes.usagePatterns as string[],
    );
    assert.ok(
      unpatterned.some((plank) => plank.file === planted.file),
      "a plank naming no current step-definition pattern was not reported",
    );
  },
);

/**
 * A tier that fails loudly on an absent credential fails in seconds, at its
 * credential gate. This budget is the failure ceiling for a tier that runs its
 * agent instead: it bounds what a red costs, and the run resolves the moment the
 * tier exits.
 */
const CREDENTIAL_GATE_BUDGET_MS = 300_000;

Given(
  "the `@eval` tier command configured in {string}",
  function (this: JollyWorld, riggingFile: string) {
    const command = tierCommand(riggingFile, "eval");
    assert.ok(
      command,
      `${riggingFile} configures no "broad-eval" command, so the @eval tier has no command to run`,
    );
    this.notes.credentialedTier = command;
  },
);

When(
  "the tier is run with {string} absent from the environment",
  { timeout: CREDENTIAL_GATE_BUDGET_MS + 20_000 },
  function (this: JollyWorld, credential: string) {
    const command = this.notes.credentialedTier as TierCommand;

    // Teardown registered before creation, loud on failure via the registry.
    const transcriptDir = join(tmpdir(), `jolly-tier-credential-${process.pid}`);
    this.cleanup.register(`tier-credential transcripts ${transcriptDir}`, () => {
      rmSync(transcriptDir, { recursive: true, force: true });
    });
    const restoreWakeRecord = preserveWakeRecord(command);
    this.cleanup.register(`${command.key} wake record`, restoreWakeRecord);
    mkdirSync(transcriptDir, { recursive: true });

    this.notes.credentiallessRun = runTierWithoutCredential({
      command,
      credential,
      transcriptDir,
      budgetMs: CREDENTIAL_GATE_BUDGET_MS,
    });
    this.notes.persistedAgentRuns = persistedAgentRuns(transcriptDir);
    // Restore immediately; the registered teardown remains the safety net.
    restoreWakeRecord();
  },
);

Then(
  "the run should fail, naming {string} as the fitting-out blocker it needs",
  function (this: JollyWorld, credential: string) {
    const command = this.notes.credentialedTier as TierCommand;
    const run = this.notes.credentiallessRun as CredentiallessRun;
    const tail = run.output.slice(-2000);
    assert.ok(
      !run.timedOut,
      `the "${command.key}" tier did not fail when ${credential} was absent; it ran on until it outran its budget:\n${tail}`,
    );
    assert.notEqual(
      run.exitCode,
      0,
      `the "${command.key}" tier reported green with ${credential} absent, so it proved nothing:\n${tail}`,
    );
    assert.ok(
      run.output.includes(credential),
      `the "${command.key}" tier failed without naming ${credential}, so the run never says what fitting out must provide:\n${tail}`,
    );
    assert.match(
      run.output,
      /fitting[ -]out/i,
      `the "${command.key}" tier failed without naming ${credential} as a fitting-out blocker:\n${tail}`,
    );
  },
);

Then("it should report no scenario as skipped", function (this: JollyWorld) {
  const run = this.notes.credentiallessRun as CredentiallessRun;
  const summary = scenarioSummary(run.output);
  assert.ok(
    summary,
    `the run reported no scenario summary, so what it did with its scenarios is unknown:\n${run.output.slice(-2000)}`,
  );
  assert.ok(
    summary.total > 0,
    `the run started no scenario at all, so "no scenario skipped" would prove nothing: ${summary.line}`,
  );
  assert.equal(
    summary.counts.skipped ?? 0,
    0,
    `the tier skipped itself rather than failing loudly, so an unfitted run reads as green: ${summary.line}`,
  );
});

Then("it should invoke no model", function (this: JollyWorld) {
  const runs = this.notes.persistedAgentRuns as string[];
  assert.deepEqual(
    runs,
    [],
    `the tier reached the baseline agent — the one seam that invokes a model — and persisted ${runs.length} agent run(s): ${runs.join(", ")}. A tier missing its credential fails at the gate, before it spends a model invocation.`,
  );
});

// ─── Provisional planks: `@planks-provisional(...)` freshness ───────────────
// A seam a `@captain` skeleton describes carries `@planks-provisional("<spec>.
// feature:<Scenario Name>")` so the seam stays findable through promotion
// (Planking agreement). One naming a current `@captain` scenario conforms and
// waits; promotion removes the tag, so one naming a promoted scenario is red
// and owes its `@planks("...")` pattern; one naming no current scenario is
// stale. Each leg is proven by a virtual plant that never touches disk.

Then(
  "a `@planks-provisional\\(...)` annotation naming a current `@captain` scenario should conform, one naming a promoted or absent scenario should redden the check",
  function (this: JollyWorld) {
    const dirs = this.notes.implDirs as string[];
    const index = parseScenarioIndex("features/");

    // The tree as it stands: every real provisional plank must conform.
    const real = findProvisionalPlankViolations(
      collectProvisionalPlanks(dirs),
      index,
    );
    assert.equal(
      real.length,
      0,
      `provisional planks that no longer conform:\n${real
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );

    // Conform leg: a provisional naming a current @captain scenario waits.
    const captainFeature: InjectedSource = {
      file: "features/.planted-captain-skeleton.feature",
      text: [
        "Feature: Planted skeleton home",
        "",
        "  @captain",
        "  Scenario: A planted captain skeleton",
        "    Given the planted seam exists",
      ].join("\n"),
    };
    const conforming: InjectedSource = {
      file: "src/.planted-conforming-provisional.ts",
      text: [
        '/** @planks-provisional("features/.planted-captain-skeleton.feature:A planted captain skeleton") */',
        "export function plantedDescribedSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const conformIndex = parseScenarioIndex("features/", [captainFeature]);
    const conformViolations = findProvisionalPlankViolations(
      collectProvisionalPlanks(dirs, [conforming]),
      conformIndex,
    ).filter((violation) => violation.file === conforming.file);
    assert.equal(
      conformViolations.length,
      0,
      `a provisional plank naming a current @captain scenario must conform; got:\n${conformViolations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );

    // Redden leg 1: naming a promoted (current, non-@captain) scenario.
    const promoted: InjectedSource = {
      file: "src/.planted-promoted-provisional.ts",
      text: [
        '/** @planks-provisional("features/methodology-conformance.feature:Every plank names a current step-definition pattern") */',
        "export function plantedPromotedSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const promotedViolations = findProvisionalPlankViolations(
      collectProvisionalPlanks(dirs, [promoted]),
      index,
    );
    assert.ok(
      promotedViolations.some((violation) => violation.file === promoted.file),
      "a provisional plank naming a promoted scenario was not reported",
    );

    // Redden leg 2: naming no current scenario at all.
    const absent: InjectedSource = {
      file: "src/.planted-stale-provisional.ts",
      text: [
        '/** @planks-provisional("features/.no-such.feature:Never Written") */',
        "export function plantedStaleSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const absentViolations = findProvisionalPlankViolations(
      collectProvisionalPlanks(dirs, [absent]),
      index,
    );
    assert.ok(
      absentViolations.some((violation) => violation.file === absent.file),
      "a provisional plank naming no current scenario was not reported",
    );
  },
);

// ─── The dependency record and the package manifest agree ──────────────────
// ─── Every verification surface is run by a configured tier command ────────

Given(
  "the tier commands configured in {string} and the test surfaces in the tree",
  function (this: JollyWorld, riggingFile: string) {
    const riggingText = readFileSync(join(REPO_ROOT, riggingFile), "utf8");
    const manifestText = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    this.notes.configuredCommands = readConfiguredCommands(riggingText, manifestText);
    assert.ok(
      (this.notes.configuredCommands as ConfiguredCommand[]).length > 0,
      `${riggingFile} configures no commands under ## Commands`,
    );
  },
);

When("the verification surfaces are enumerated", function (this: JollyWorld) {
  this.notes.testSurfaces = enumerateTestSurfaces("features/");
});

Then(
  "every test surface should be run by a configured tier command",
  function (this: JollyWorld) {
    const violations = findUnreachedSurfaces(
      this.notes.testSurfaces as TestSurface[],
      this.notes.configuredCommands as ConfiguredCommand[],
    );
    assert.equal(
      violations.length,
      0,
      `test surfaces no configured tier command reaches:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a test surface no configured tier command reaches should redden the check",
  function (this: JollyWorld) {
    const planted: TestSurface = { dir: "planted-tests/", kind: "unit" };
    const violations: SurfaceViolation[] = findUnreachedSurfaces(
      [...(this.notes.testSurfaces as TestSurface[]), planted],
      this.notes.configuredCommands as ConfiguredCommand[],
    );
    assert.ok(
      violations.some((violation) => violation.surface.dir === planted.dir),
      "a planted test surface no command reaches was not reported",
    );
  },
);

// ─── No dead verification-support artifact accumulates ──────────────────────
//
// Two kinds of dead verification-support artifact accumulate when a scenario is
// removed without its support, and neither the runner's green nor a tooling
// gate sees them: a step-definition pattern no current scenario binds, reported
// by `step-usage` with an empty `matches` array, and an exported
// `features/support/` symbol no other file in the tree references. Each redden
// leg is proven by a virtual plant that never touches disk: a synthetic
// `step-usage` entry with no matches, and an injected support export whose
// symbol name is assembled at run time so no corpus file carries it as a token.

Given(
  "the step-definition patterns reported by {string} and the module-level symbols under {string}",
  function (this: JollyWorld, _tool: string, supportDir: string) {
    this.notes.supportDir = supportDir;
    this.notes.stepUsageEntries = collectStepUsageEntries();
    this.notes.supportExports = collectSupportExports(supportDir);
    assert.ok(
      (this.notes.stepUsageEntries as StepUsageEntry[]).length > 0,
      "step-usage reported no step-definition pattern",
    );
    assert.ok(
      (this.notes.supportExports as SupportExport[]).length > 0,
      `no exported symbol found under ${supportDir}`,
    );
  },
);

When(
  "the dead-artifact check enumerates the patterns no scenario binds and the support symbols no live entry point reaches",
  function (this: JollyWorld) {
    this.notes.orphanPatterns = findOrphanPatterns(
      this.notes.stepUsageEntries as StepUsageEntry[],
    );
    this.notes.unreferencedExports = findUnreferencedExports(
      this.notes.supportExports as SupportExport[],
    );
    this.notes.unreachableSymbols = findUnreachableSupportSymbols(
      this.notes.supportDir as string,
    );
  },
);

Then(
  "every step-definition pattern should be bound by at least one current scenario",
  function (this: JollyWorld) {
    const orphans = this.notes.orphanPatterns as OrphanPattern[];
    assert.equal(
      orphans.length,
      0,
      `step-definition patterns no current scenario binds:\n${orphans
        .map((orphan) => `  - ${orphan.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "every exported {string} symbol should be referenced by another file in the tree",
  function (this: JollyWorld, _supportDir: string) {
    const unreferenced = this.notes.unreferencedExports as UnreferencedExport[];
    assert.equal(
      unreferenced.length,
      0,
      `exported support symbols no other file references:\n${unreferenced
        .map((entry) => `  - ${entry.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "every non-exported {string} symbol should be reachable from a referenced export or a module-level side effect in its file",
  function (this: JollyWorld, _supportDir: string) {
    const unreachable = this.notes.unreachableSymbols as UnreachableSymbol[];
    assert.equal(
      unreachable.length,
      0,
      `non-exported support symbols no live entry point reaches:\n${unreachable
        .map((entry) => `  - ${entry.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "an orphaned step-definition pattern that no scenario binds should redden the check, naming the pattern and its file",
  function (this: JollyWorld) {
    const planted: StepUsageEntry = {
      pattern: "a planted orphan pattern no current scenario binds",
      uri: "features/step_definitions/.planted-orphan.steps.ts",
      line: 1,
      matches: [],
    };
    const reported = findOrphanPatterns([
      ...(this.notes.stepUsageEntries as StepUsageEntry[]),
      planted,
    ]).find((orphan) => orphan.pattern === planted.pattern);
    assert.ok(reported, "a planted orphaned step-definition pattern was not reported");
    assert.ok(
      reported.message.includes(planted.pattern) &&
        reported.message.includes(planted.uri),
      `the report must name the pattern and its file: ${JSON.stringify(reported)}`,
    );
  },
);

Then(
  "an unreferenced {string} export should redden the check, naming the symbol and its file",
  function (this: JollyWorld, supportDir: string) {
    // The planted symbol name is assembled at run time, so this source file
    // carries no literal a corpus reference search could match against.
    const symbol = ["planted", "support", "export", "noref"].join("");
    const file = `${supportDir}.planted-unreferenced-export.ts`;
    const injected = {
      file,
      text: `export function ${symbol}(): boolean {\n  return true;\n}\n`,
    };
    const planted = collectSupportExports(supportDir, [injected]).filter(
      (entry) => entry.file === file,
    );
    assert.ok(
      planted.some((entry) => entry.symbol === symbol),
      "the planted support export was not collected as an export",
    );
    const reported = findUnreferencedExports(planted).find(
      (entry) => entry.symbol === symbol,
    );
    assert.ok(reported, "a planted unreferenced support export was not reported");
    assert.ok(
      reported.message.includes(symbol) && reported.message.includes(file),
      `the report must name the symbol and its file: ${JSON.stringify(reported)}`,
    );
  },
);

Then(
  "a non-exported {string} symbol that only other unreachable symbols reference should redden the check, naming the symbol and its file",
  function (this: JollyWorld, supportDir: string) {
    // Two non-exported functions: alpha references beta, and nothing reachable
    // references alpha. So beta is referenced only by an unreachable symbol —
    // exactly the leg. The injected file has no export and no side effect, so
    // neither is reachable; the plant never touches disk.
    const file = `${supportDir}.planted-unreachable-symbol.ts`;
    const injected = {
      file,
      text: [
        "function plantedDeadAlpha(): number {",
        "  return plantedDeadBeta();",
        "}",
        "function plantedDeadBeta(): number {",
        "  return 1;",
        "}",
      ].join("\n"),
    };
    const reported = findUnreachableSupportSymbols(supportDir, [injected]);
    const beta = reported.find(
      (entry) => entry.file === file && entry.symbol === "plantedDeadBeta",
    );
    assert.ok(
      beta,
      "a non-exported symbol referenced only by an unreachable symbol was not reported",
    );
    assert.ok(
      beta.message.includes("plantedDeadBeta") && beta.message.includes(file),
      `the report must name the symbol and its file: ${JSON.stringify(beta)}`,
    );
  },
);
