// Feature methodology-conformance — two derived checks that make Shipshape
// methodology rules executable (@logic @invariant):
//   - a green tree carries no standing perturbation token in src/ or bin/, and
//   - the watchbill-shape check accepts a well-formed watchbill and rejects a
//     malformed one.
// Both are verification support; each is proven honest by a planted red inside
// its own scenario.
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
