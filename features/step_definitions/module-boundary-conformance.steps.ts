// Feature module-boundary-conformance — the module-layering invariants are
// enforced by a tool, not only by convention (@logic @property).
//
// This is a scantling attestation, not an example: `.dependency-cruiser.mjs`
// (Captain-owned) encodes two invariants already held by the real import graph
// — src/lib never imports src/index.ts, and src/** never imports the
// verification layer (features/support, features/step_definitions). A proof-
// style checker covers every module pair, so the scenario names the seam (the
// source tree + the scantling), runs the verifier named in RIGGING.md (the
// `conformance` command, `depcruise --config .dependency-cruiser.mjs src bin`),
// and asserts a clean discharge rather than re-enacting one import pair.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

const SCANTLING = ".dependency-cruiser.mjs";

Given(
  "Jolly's source tree and the boundary scantling at {string}",
  function (this: JollyWorld, scantling: string) {
    // The seam under attestation: the production source tree and the Captain-
    // owned boundary scantling the verifier discharges against.
    const scantlingPath = join(REPO_ROOT, scantling);
    assert.ok(
      existsSync(scantlingPath),
      `the boundary scantling ${scantling} must exist at the repo root to attest against`,
    );
    assert.ok(
      existsSync(join(REPO_ROOT, "src")) && existsSync(join(REPO_ROOT, "bin")),
      "Jolly's source tree (src/, bin/) must exist to validate",
    );
    this.notes.scantling = scantling;
  },
);

When(
  "dependency-cruiser validates the module graph against it",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    // Run the REAL, locally installed validator — not `npx depcruise`, which
    // reaches the registry for an uninstalled binary and resolves a dependency-
    // confusion placeholder that exits 0 (a false clean discharge). Requiring the
    // local bin makes an unfitted tool a loud fitting-out blocker, not a stale
    // green.
    const scantling = this.notes.scantling as string;
    const localBin = join(REPO_ROOT, "node_modules", ".bin", "depcruise");
    assert.ok(
      existsSync(localBin),
      `dependency-cruiser is not installed (${join("node_modules", ".bin", "depcruise")} is ` +
        `absent). RIGGING.md ## Dependencies selects it as the boundary-scantling ` +
        `validator and says its version lives in package.json, but it is absent from ` +
        `package.json/devDependencies. Fitting out is incomplete: add \`dependency-cruiser\` ` +
        `and install it so the \`conformance\` command resolves the real local binary.`,
    );
    const result = spawnSync(
      localBin,
      ["--config", scantling, "src", "bin"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    if (result.error) {
      throw new Error(`failed to run dependency-cruiser: ${result.error.message}`);
    }
    this.notes.conformance = {
      exitCode: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
);

Then("no boundary violation is found", function (this: JollyWorld) {
  const run = this.notes.conformance as {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  const output = `${run.stdout}\n${run.stderr}`;
  assert.equal(
    run.exitCode,
    0,
    `dependency-cruiser reported a module-boundary violation ` +
      `(exit ${run.exitCode}):\n${output}`,
  );
  // Assert the artifact only a real clean discharge produces, so a placeholder
  // or empty run can never satisfy the attestation on exit code alone.
  assert.match(
    output,
    /no dependency violations found/i,
    `dependency-cruiser did not report a clean discharge; output:\n${output}`,
  );
});
