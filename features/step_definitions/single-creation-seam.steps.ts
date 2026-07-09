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
