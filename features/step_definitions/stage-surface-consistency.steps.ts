// Stage-surface consistency (feature stage-surface-consistency).
//
// Jolly names its setup stages in four independent places: the stage runners,
// the stage descriptions, the high-risk gate, and the side-effecting close list.
// This @property scenario pins that each site's stage set equals the stages one
// declared surface names for that site's facet, so a stage added, renamed, or
// split in one site and not the others is reported rather than discovered by a
// human reading four lists.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";
import {
  DECLARED_SURFACE,
  declaredStageSurface,
  stageSites,
  stageSurfaceViolations,
  type StageSite,
  type StageSurface,
  type StageViolation,
} from "../support/stage-surface-conformance.ts";

Given(
  "the stage surface Jolly declares, naming each stage with the facets it carries",
  function (this: JollyWorld) {
    this.notes.declaredStageSurface = declaredStageSurface();
  },
);

When(
  "the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read",
  function (this: JollyWorld) {
    const sites = stageSites();
    this.notes.stageSites = sites;
    this.notes.stageViolations = stageSurfaceViolations(
      this.notes.declaredStageSurface as StageSurface | undefined,
      sites,
    );
  },
);

Then(
  "each site's stage set should equal the stages declared for that site's facet",
  function (this: JollyWorld) {
    const violations = this.notes.stageViolations as StageViolation[];
    assert.equal(
      violations.length,
      0,
      `stage sites disagreeing with the declared surface \`${DECLARED_SURFACE}\`:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

// The two planted reds run the join over a synthetic surface and synthetic
// sites, so the proof does not depend on the tree's own stage lists.

Then(
  "a stage present in one site and absent from another should redden the check, naming the stage and the site missing it",
  function (this: JollyWorld) {
    const sites = this.notes.stageSites as StageSite[];
    const surface: StageSurface = {
      store: ["runner", "description"],
      recipe: ["runner", "description"],
    };
    const planted: StageSite[] = [
      {
        name: "the planted complete site",
        file: "src/planted.ts",
        facet: "runner",
        stages: ["store", "recipe"],
      },
      {
        name: "the planted incomplete site",
        file: "src/planted.ts",
        facet: "description",
        stages: ["store"],
      },
    ];
    const violations = stageSurfaceViolations(surface, planted);
    const missing = violations.find(
      (violation) =>
        violation.stage === "recipe" && violation.site === "the planted incomplete site",
    );
    assert.ok(missing, "a stage absent from one site was not reported");
    assert.ok(
      missing.message.includes("recipe") &&
        missing.message.includes("the planted incomplete site"),
      `the report must name the stage and the site missing it: ${missing.message}`,
    );
    assert.equal(
      violations.filter((violation) => violation.site === "the planted complete site").length,
      0,
      "a site whose set equals the stages declared for its facet must not be reported",
    );
    assert.equal(sites.length, 4, `expected the four stage sites; got ${sites.length}`);
  },
);

Then(
  "a stage named in a site but absent from the declared surface should redden the check, naming the stage and the site that names it",
  function () {
    const surface: StageSurface = { store: ["sideEffecting"] };
    const planted: StageSite[] = [
      {
        name: "the planted close list",
        file: "src/planted-close.ts",
        facet: "sideEffecting",
        stages: ["store", "plantedstage"],
      },
    ];
    const violations = stageSurfaceViolations(surface, planted);
    const undeclared = violations.find((violation) => violation.stage === "plantedstage");
    assert.ok(
      undeclared,
      "a stage named in a site and absent from the declared surface was not reported",
    );
    assert.ok(
      undeclared.message.includes("plantedstage") &&
        undeclared.message.includes("the planted close list"),
      `the report must name the stage and the site that names it: ${undeclared.message}`,
    );
  },
);
