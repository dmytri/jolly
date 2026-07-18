// Feature methodology-conformance — six derived checks that make Shipshape
// methodology rules executable (@logic @invariant):
//   - a green tree carries no standing perturbation token in src/ or bin/,
//   - the watchbill-shape check accepts a well-formed watchbill and rejects a
//     malformed one,
//   - every plank sits in a docblock on the declaration it describes,
//   - no feature file carries a bare `#` comment line,
//   - every plank names a step that still exists in a feature, and
//   - a credentialed tier fails loudly when its credential is absent.
// All are verification support; each is proven honest by a planted red inside
// its own scenario. The plank checks read the TypeScript AST, so they see what
// the text-search plank inventory cannot: plank FORM.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  findBareComments,
  scanForToken,
  validateWatchbillShape,
  type CommentLine,
  type ShapeResult,
  type TokenMatch,
} from "../support/methodology-conformance.ts";
import {
  collectPlanks,
  collectProvisionalPlanks,
  collectStepUsagePatterns,
  findPlankFormViolations,
  findProvisionalPlankViolations,
  findUnpatternedPlanks,
  parseScenarioIndex,
  type InjectedSource,
  type Plank,
  type PlankViolation,
} from "../support/plank-conformance.ts";
import {
  findDependencyRecordViolations,
  referenceCorpus,
  type DependencyViolation,
} from "../support/dependency-record-conformance.ts";
import {
  enumerateTestSurfaces,
  findUnreachedSurfaces,
  readConfiguredCommands,
  type ConfiguredCommand,
  type SurfaceViolation,
  type TestSurface,
} from "../support/verification-surface-conformance.ts";
import {
  findArchitectureDrift,
  type ArchitectureViolation,
  type ClaimKind,
} from "../support/architecture-conformance.ts";

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
  "a well-formed {string} fixture with ordered watches {string} and {string}, each holding only a {string} array of {string} references or a tier tag",
  function (
    this: JollyWorld,
    _fileName: string,
    firstWatch: string,
    secondWatch: string,
    scenariosKey: string,
    _referenceForm: string,
  ) {
    this.notes.watchbillFixture = {
      [firstWatch]: {
        [scenariosKey]: [
          "features/methodology-conformance.feature:A green tree carries no standing perturbation token",
        ],
      },
      [secondWatch]: {
        [scenariosKey]: ["@logic"],
      },
    };
  },
);

When("the watchbill-shape check validates the fixture", function (this: JollyWorld) {
  this.notes.watchbillResult = validateWatchbillShape(this.notes.watchbillFixture);
});

Then("it should report the fixture well-formed", function (this: JollyWorld) {
  const result = this.notes.watchbillResult as ShapeResult;
  assert.equal(
    result.valid,
    true,
    `expected the fixture well-formed, got errors:\n${result.errors.join("\n")}`,
  );
});

Then(
  "a fixture whose watch carries prose, metadata, or a key other than {string} should redden the check",
  function (this: JollyWorld, scenariosKey: string) {
    const malformed: Array<[string, unknown]> = [
      [
        "extra key alongside scenarios",
        { watch1: { [scenariosKey]: ["features/x.feature:Y"], note: "do this first" } },
      ],
      [
        "prose key at watch level",
        { watch1: { [scenariosKey]: ["features/x.feature:Y"] }, comment: "prose" },
      ],
      [
        "metadata object as a scenario entry",
        { watch1: { [scenariosKey]: [{ ref: "features/x.feature:Y" }] } },
      ],
      [
        "free-form scenario entry",
        { watch1: { [scenariosKey]: ["do the thing"] } },
      ],
      [
        "unordered watch name",
        { watch2: { [scenariosKey]: ["features/x.feature:Y"] } },
      ],
    ];
    for (const [label, fixture] of malformed) {
      const result = validateWatchbillShape(fixture);
      assert.equal(
        result.valid,
        false,
        `expected malformed fixture rejected (${label}): ${JSON.stringify(fixture)}`,
      );
    }
  },
);

When(
  "the plank-form check reads every {string} token in them",
  function (this: JollyWorld, token: string) {
    this.notes.plankToken = token;
    this.notes.plankFormViolations = findPlankFormViolations(
      this.notes.implDirs as string[],
    );
  },
);

Then(
  "each should sit in a docblock attached to a declaration and carry a {string}, {string}, or {string} step",
  function (this: JollyWorld, _given: string, _when: string, _then: string) {
    const violations = this.notes.plankFormViolations as PlankViolation[];
    assert.equal(
      violations.length,
      0,
      `malformed planks:\n${violations.map((violation) => `  - ${violation.message}`).join("\n")}`,
    );
  },
);

/** A plank the text-search inventory reports as present, in each malformed form. */
function plantedMalformedPlank(kind: string): InjectedSource {
  const step = 'When the agent runs `jolly doctor`';
  const bodies: Record<string, string> = {
    "type alias": [
      `/** @planks("${step}") */`,
      "type DoctorReport = { ok: boolean };",
      "export function runDoctor(): DoctorReport {",
      "  return { ok: true };",
      "}",
    ].join("\n"),
    "line comment": [
      `// @planks("${step}")`,
      "export function runDoctor(): boolean {",
      "  return true;",
      "}",
    ].join("\n"),
    "function body": [
      "export function runDoctor(): boolean {",
      `  /* @planks("${step}") */`,
      "  return true;",
      "}",
    ].join("\n"),
  };
  return {
    file: `src/.planted-${kind.split(" ").join("-")}.ts`,
    text: bodies[kind]!,
  };
}

Then(
  "a {string} token attached to a type alias rather than the seam beneath it should redden the check",
  function (this: JollyWorld, _token: string) {
    const planted = plantedMalformedPlank("type alias");
    const violations = findPlankFormViolations(this.notes.implDirs as string[], [planted]);
    assert.ok(
      violations.some((violation) => violation.file === planted.file),
      `a plank docblock on a type alias sitting above the seam was not reported:\n${planted.text}`,
    );
  },
);

Then(
  "a {string} token in a line comment or inside a function body should redden the check",
  function (this: JollyWorld, _token: string) {
    for (const kind of ["line comment", "function body"]) {
      const planted = plantedMalformedPlank(kind);
      const violations = findPlankFormViolations(this.notes.implDirs as string[], [
        planted,
      ]);
      assert.ok(
        violations.some((violation) => violation.file === planted.file),
        `a plank token in a ${kind} was not reported:\n${planted.text}`,
      );
    }
  },
);

Given("the specs directory {string}", function (this: JollyWorld, dir: string) {
  this.notes.specsDir = dir;
});

When("the spec-comment check reads every feature file", function (this: JollyWorld) {
  this.notes.bareComments = findBareComments(this.notes.specsDir as string);
});

Then(
  "none should carry a bare {string} comment line",
  function (this: JollyWorld, marker: string) {
    const comments = this.notes.bareComments as CommentLine[];
    assert.equal(
      comments.length,
      0,
      `feature files carrying a bare "${marker}" comment line:\n${comments
        .map((comment) => `  ${comment.file}:${comment.line} ${comment.text}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a feature file carrying a {string} comment line should redden the check",
  function (this: JollyWorld, marker: string) {
    const planted: InjectedSource = {
      file: "features/.planted-bare-comment.feature",
      text: [
        "Feature: Planted",
        "",
        `  ${marker} the agent runs this first`,
        "  Scenario: A planted scenario",
        "    Given the fixture step runs",
      ].join("\n"),
    };
    const comments = findBareComments(this.notes.specsDir as string, [planted]);
    assert.ok(
      comments.some((comment) => comment.file === planted.file),
      `a feature file carrying a bare "${marker}" comment line was not reported:\n${planted.text}`,
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

// ─── The architecture document's structural claims ──────────────────────────
//
// ARCHITECTURE.md is a deliberate second copy of tree facts, kept honest by
// this check rather than by discipline. Each claim family is proven by its own
// planted drift inside the redden step.

const TECHNOLOGIES_MARKER = "**Technologies:**";

function architectureViolations(
  world: JollyWorld,
  kind: ClaimKind,
): ArchitectureViolation[] {
  return (world.notes.architectureViolations as ArchitectureViolation[]).filter(
    (violation) => violation.kind === kind,
  );
}

function assertNoArchitectureDrift(world: JollyWorld, kind: ClaimKind): void {
  const violations = architectureViolations(world, kind);
  assert.equal(
    violations.length,
    0,
    `architecture-document ${kind} claims drifted from the tree:\n${violations
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
}

Given(
  "the architecture document {string}",
  function (this: JollyWorld, name: string) {
    const path = join(REPO_ROOT, name);
    assert.ok(existsSync(path), `${name} is absent from the project root`);
    this.notes.architectureText = readFileSync(path, "utf8");
  },
);

When(
  "the architecture-conformance check reads its structural claims",
  function (this: JollyWorld) {
    this.notes.architectureViolations = findArchitectureDrift(
      this.notes.architectureText as string,
    );
  },
);

Then(
  "the counts it states for feature files, step-definition files, and unit-test files should match the tree",
  function (this: JollyWorld) {
    assertNoArchitectureDrift(this, "count");
  },
);

Then(
  "every module it lists under {string} should exist, and every module in {string} should be listed",
  function (this: JollyWorld, _listedDir: string, _treeDir: string) {
    assertNoArchitectureDrift(this, "module");
  },
);

Then(
  "every verification technology it names should be referenced in the tree",
  function (this: JollyWorld) {
    assertNoArchitectureDrift(this, "technology");
  },
);

Then(
  "a drifted count, a missing or unlisted module, or a named technology with no reference should redden the check",
  function (this: JollyWorld) {
    const text = this.notes.architectureText as string;

    // A drifted count.
    const drifted = text.replace(
      /(\d+)(\s+Gherkin\s+feature files)/,
      (_match, count: string, rest: string) => `${Number(count) + 1}${rest}`,
    );
    assert.notEqual(
      drifted,
      text,
      "the document no longer states a feature-file count in a plantable form",
    );
    assert.ok(
      findArchitectureDrift(drifted).some((violation) => violation.kind === "count"),
      "a drifted feature-file count was not reported",
    );

    // A listed module that does not exist.
    const modulesHeading = text.match(/^#{1,6}\s.*Library Modules.*$/m);
    assert.ok(
      modulesHeading,
      "the document no longer carries a Library Modules heading to plant under",
    );
    const ghost = "planted-ghost-module.ts";
    const withGhost = text.replace(
      modulesHeading[0],
      `${modulesHeading[0]}\n\n| \`${ghost}\` | planted |`,
    );
    assert.ok(
      findArchitectureDrift(withGhost).some(
        (violation) =>
          violation.kind === "module" && violation.message.includes(ghost),
      ),
      `the planted listing of "src/lib/${ghost}" was not reported as missing`,
    );

    // A named technology with no reference.
    const verificationIndex = text.indexOf("BDD Verification");
    const markerIndex = text.indexOf(TECHNOLOGIES_MARKER, verificationIndex);
    assert.ok(
      verificationIndex !== -1 && markerIndex !== -1,
      "the document no longer carries a BDD Verification Technologies line to plant on",
    );
    const insertAt = markerIndex + TECHNOLOGIES_MARKER.length;
    const plantedTech = "planted-untraceable-tech";
    const withTech = `${text.slice(0, insertAt)} \`${plantedTech}\`,${text.slice(insertAt)}`;
    assert.ok(
      findArchitectureDrift(withTech).some(
        (violation) =>
          violation.kind === "technology" && violation.message.includes(plantedTech),
      ),
      `the planted technology "${plantedTech}" was not reported as unreferenced`,
    );
  },
);

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

Given(
  "the dependency entries recorded in {string} and the dependency lists in {string}",
  function (this: JollyWorld, riggingFile: string, manifestFile: string) {
    this.notes.riggingText = readFileSync(join(REPO_ROOT, riggingFile), "utf8");
    this.notes.manifestText = readFileSync(join(REPO_ROOT, manifestFile), "utf8");
  },
);

When("the dependency-record check joins them", function (this: JollyWorld) {
  this.notes.dependencyViolations = findDependencyRecordViolations({
    riggingText: String(this.notes.riggingText),
    manifestText: String(this.notes.manifestText),
  });
});

Then(
  "every dependency recorded in {string} should be installed in {string}",
  function (this: JollyWorld, _riggingFile: string, _manifestFile: string) {
    const violations = (
      this.notes.dependencyViolations as DependencyViolation[]
    ).filter((violation) => violation.kind === "recorded-uninstalled");
    assert.equal(
      violations.length,
      0,
      `recorded-but-uninstalled dependencies:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "every {string} dependency should be referenced by the tree",
  function (this: JollyWorld, _manifestFile: string) {
    const violations = (
      this.notes.dependencyViolations as DependencyViolation[]
    ).filter((violation) => violation.kind === "installed-unreferenced");
    assert.equal(
      violations.length,
      0,
      `installed-but-unreferenced dependencies:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a recorded-but-uninstalled or installed-but-unreferenced dependency should redden the check",
  function (this: JollyWorld) {
    const riggingText = String(this.notes.riggingText);
    const manifestText = String(this.notes.manifestText);

    // Recorded but not installed: plant a ghost entry into the record. The
    // ghost names are assembled at run time so this file's own source never
    // carries them as literals — a literal here would be a tree reference that
    // defeats the installed-but-unreferenced half of the proof.
    const recordedGhost = ["planted", "ghost", "package"].join("-");
    const unreferencedGhost = ["planted", "unreferenced", "package"].join("-");
    const plantedRigging = riggingText.replace(
      "## Dependencies",
      `## Dependencies\n\n- ${recordedGhost}: planted for the redden proof`,
    );
    assert.notEqual(plantedRigging, riggingText, "the record no longer carries a ## Dependencies heading to plant under");
    const recordedRed = findDependencyRecordViolations({
      riggingText: plantedRigging,
      manifestText,
    });
    assert.ok(
      recordedRed.some(
        (violation) =>
          violation.kind === "recorded-uninstalled" &&
          violation.message.includes(recordedGhost),
      ),
      "a recorded-but-uninstalled dependency was not reported",
    );

    // Installed but referenced nowhere: plant a ghost into the manifest.
    const manifest = JSON.parse(manifestText) as {
      devDependencies?: Record<string, string>;
    };
    manifest.devDependencies = {
      ...manifest.devDependencies,
      [unreferencedGhost]: "1.0.0",
    };
    const plantedManifestText = JSON.stringify(manifest);
    const installedRed = findDependencyRecordViolations({
      riggingText,
      manifestText: plantedManifestText,
      corpus: referenceCorpus(plantedManifestText),
    });
    assert.ok(
      installedRed.some(
        (violation) =>
          violation.kind === "installed-unreferenced" &&
          violation.message.includes(unreferencedGhost),
      ),
      "an installed-but-unreferenced dependency was not reported",
    );
  },
);

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
