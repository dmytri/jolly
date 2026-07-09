// Feature module-boundary-conformance — Jolly's module-layering invariants are
// enforced by a tool, not only by convention (@logic @property).
//
// The ts-morph checker (features/support/module-conformance.ts) resolves each
// import to its source file and reports any src/lib import of src/index.ts or
// any src import of the verification layer. The scenario names the seam (the
// source tree), runs the checker, and asserts no boundary violation.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import {
  findModuleLayeringViolations,
  type Violation,
} from "../support/module-conformance.ts";

Given("Jolly's source tree", function (this: JollyWorld) {
  assert.ok(
    existsSync(join(REPO_ROOT, "src")) && existsSync(join(REPO_ROOT, "bin")),
    "Jolly's source tree (src/, bin/) must exist to check",
  );
});

When(
  "its import graph is checked against the module-layering boundaries",
  function (this: JollyWorld) {
    this.notes.boundaryViolations = findModuleLayeringViolations();
  },
);

Then("no boundary violation is found", function (this: JollyWorld) {
  const violations = this.notes.boundaryViolations as Violation[];
  assert.equal(
    violations.length,
    0,
    `module-layering boundary violations found:\n${violations
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
});
