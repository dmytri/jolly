// Feature single-creation-seam — every real creation of an expensive external
// resource happens at one seam (@logic @property).
//
// The ts-morph checker (features/support/module-conformance.ts) locates every
// `create store --create-environment` CLI-spawn argument array in the
// verification layer and reports any real one outside
// features/support/env-factory.ts. A `--dry-run` preview array and an
// `env-factory-exception:`-marked loopback-fake array create no real resource
// and are not reported. The scenario names the verification layer, runs the
// checker, and asserts every real invocation lives in the seam.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import {
  findCreationSeamViolations,
  findVercelProjectSeamViolations,
  locateProductionSpawnSeams,
  type SeamLocation,
  type Violation,
} from "../support/module-conformance.ts";

Given("Jolly's verification layer", function (this: JollyWorld) {
  assert.ok(
    existsSync(join(REPO_ROOT, "features", "support")) &&
      existsSync(join(REPO_ROOT, "features", "step_definitions")),
    "the verification layer (features/support, features/step_definitions) must exist to check",
  );
});

When(
  "its real `create store --create-environment` invocations are located",
  function (this: JollyWorld) {
    this.notes.seamViolations = findCreationSeamViolations();
  },
);

Then(
  "every one lives in the single env-creation seam {string}",
  function (this: JollyWorld, seam: string) {
    assert.ok(
      existsSync(join(REPO_ROOT, seam)),
      `the single env-creation seam ${seam} must exist`,
    );
    const violations = this.notes.seamViolations as Violation[];
    assert.equal(
      violations.length,
      0,
      `real \`create store --create-environment\` invocations outside ${seam}:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

When(
  "its real `vercel project add` invocations are located",
  function (this: JollyWorld) {
    this.notes.vercelProjectViolations = findVercelProjectSeamViolations();
  },
);

Then(
  "every one lives in the single Vercel-project seam {string}",
  function (this: JollyWorld, seam: string) {
    assert.ok(
      existsSync(join(REPO_ROOT, seam)),
      `the single Vercel-project seam ${seam} must exist`,
    );
    const violations = this.notes.vercelProjectViolations as Violation[];
    assert.equal(
      violations.length,
      0,
      `real \`vercel project add\` invocations outside ${seam}:\n${violations
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Given("Jolly's production source", function (this: JollyWorld) {
  assert.ok(
    existsSync(join(REPO_ROOT, "src", "index.ts")),
    "the production source (src/) must exist to check",
  );
});

When(
  "its real `vercel deploy --prod` invocations are located",
  function (this: JollyWorld) {
    this.notes.seamLocations = locateProductionSpawnSeams(["deploy", "--prod"]);
  },
);

When(
  "its real `npx @saleor\\/configurator deploy` invocations are located",
  function (this: JollyWorld) {
    // Feature 004 pins the spawned form as `npx @saleor/configurator@latest
    // deploy` (official current CLI), so the locator matches that exact spawn
    // element; a drift to any other form reddens this check loudly.
    this.notes.seamLocations = locateProductionSpawnSeams([
      "@saleor/configurator@latest",
      "deploy",
    ]);
  },
);

When(
  "its real Paper storefront `git clone` invocations are located",
  function (this: JollyWorld) {
    this.notes.seamLocations = locateProductionSpawnSeams([
      "clone",
      "https://github.com/saleor/storefront.git",
    ]);
  },
);

Then(
  "every one shares a single enclosing production seam",
  function (this: JollyWorld) {
    const locations = this.notes.seamLocations as SeamLocation[];
    assert.ok(
      locations.length >= 1,
      "no real invocation located — the creation seam is missing from production source",
    );
    const seams = new Map(
      locations.map((location) => [location.seamKey, location.seamLabel]),
    );
    assert.equal(
      seams.size,
      1,
      `real invocations spread across ${seams.size} enclosing seams instead of one:\n${[
        ...seams.values(),
      ]
        .map((label) => `  - ${label}`)
        .join("\n")}`,
    );
  },
);
