// Feature methodology-conformance — four derived checks that make Shipshape
// methodology rules executable (@logic @invariant):
//   - a green tree carries no standing perturbation token in src/ or bin/,
//   - the watchbill-shape check accepts a well-formed watchbill and rejects a
//     malformed one,
//   - every plank sits in a docblock on the declaration it describes, and
//   - every plank names a step that still exists in a feature.
// All are verification support; each is proven honest by a planted red inside
// its own scenario. The plank checks read the TypeScript AST, so they see what
// the text-search plank inventory cannot: plank FORM.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import {
  scanForToken,
  validateWatchbillShape,
  type ShapeResult,
  type TokenMatch,
} from "../support/methodology-conformance.ts";
import {
  collectFeatureSteps,
  collectPlanks,
  findPlankFormViolations,
  findStalePlanks,
  type InjectedSource,
  type Plank,
  type PlankViolation,
} from "../support/plank-conformance.ts";

/** The implementation directories from RIGGING.md, and the specs directory. */
const IMPLEMENTATION_DIRS = ["src/", "bin/"];
const SPECS_DIR = "features/";

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
  "they are joined against the step text of every feature file, with {string} and {string} normalized to the keyword they inherit",
  function (this: JollyWorld, _and: string, _but: string) {
    const featureSteps = collectFeatureSteps(SPECS_DIR);
    this.notes.featureSteps = featureSteps;
    this.notes.stalePlanks = findStalePlanks(this.notes.planks as Plank[], featureSteps);
  },
);

Then("every plank's step should be found in a feature", function (this: JollyWorld) {
  const stale = this.notes.stalePlanks as Plank[];
  assert.equal(
    stale.length,
    0,
    `planks naming a step no feature carries:\n${stale
      .map((plank) => `  - ${plank.file}:${plank.line} "${plank.step}"`)
      .join("\n")}`,
  );
});

Then(
  "a plank naming a deleted or renamed step should redden the check",
  function (this: JollyWorld) {
    const planted: InjectedSource = {
      file: "src/.planted-stale-plank.ts",
      text: [
        '/** @planks("Then the deleted step no feature carries any longer") */',
        "export function strandedSeam(): boolean {",
        "  return true;",
        "}",
      ].join("\n"),
    };
    const planks = collectPlanks(this.notes.implDirs as string[], [planted]);
    const stale = findStalePlanks(planks, this.notes.featureSteps as Set<string>);
    assert.ok(
      stale.some((plank) => plank.file === planted.file),
      "a plank naming a step no feature carries was not reported stale",
    );
  },
);
