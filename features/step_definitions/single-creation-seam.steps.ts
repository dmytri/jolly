// Feature single-creation-seam — every CLI-spawned creation of an external
// resource lives at its single declared seam (@logic @property).
//
// One structural fact, discharged once for every resource. The ts-morph checker
// (features/support/module-conformance.ts) declares a seam per CLI-spawned
// resource: in the verification layer the real `create store
// --create-environment` spawn lives in features/support/env-factory.ts and the
// real `vercel project add` spawn in features/support/sandbox.ts; in production
// the Vercel deployment, the starter-recipe deploy, and the Paper storefront
// clone each share one enclosing function. A `--dry-run` preview and a marked
// loopback fake create no real resource and are excluded.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import {
  DECLARED_CREATION_SEAMS,
  findCreationSeamFindings,
  judgeProductionSeam,
  type CreationSeamFinding,
  type DeclaredCreationSeam,
  type SeamLocation,
} from "../support/module-conformance.ts";

Given(
  "the creation seams the structural checker declares for Jolly's production source and verification layer",
  function (this: JollyWorld) {
    assert.ok(
      existsSync(join(REPO_ROOT, "src", "index.ts")),
      "the production source (src/) must exist to check",
    );
    assert.ok(
      existsSync(join(REPO_ROOT, "features", "support")) &&
        existsSync(join(REPO_ROOT, "features", "step_definitions")),
      "the verification layer (features/support, features/step_definitions) must exist to check",
    );
    const declared = DECLARED_CREATION_SEAMS;
    assert.ok(
      declared.length > 0,
      "the structural checker declares no creation seam to judge against",
    );
    for (const seam of declared) {
      if (seam.scope !== "verification") continue;
      assert.ok(
        existsSync(join(REPO_ROOT, seam.file!)),
        `the declared ${seam.resource} seam ${seam.file} must exist`,
      );
    }
    this.notes.declaredSeams = declared;
  },
);

When(
  "every real creation spawn is located and attributed to an enclosing seam",
  function (this: JollyWorld) {
    this.notes.creationSeamFindings = findCreationSeamFindings();
  },
);

Then(
  "each spawn should sit in the single seam declared for the resource it creates",
  function (this: JollyWorld) {
    const declared = this.notes.declaredSeams as DeclaredCreationSeam[];
    const findings = this.notes.creationSeamFindings as CreationSeamFinding[];
    assert.equal(
      findings.length,
      0,
      `real creation spawns outside the single seam declared for their resource ` +
        `(${declared.length} seams declared):\n${findings
          .map((finding) => `  - ${finding.message}`)
          .join("\n")}`,
    );
  },
);

Then(
  "a spawn that falls outside its declared seam should redden the check, naming the spawn, its site, and the seam it belongs in",
  function () {
    // Planted red, judged by the same code path the real assertion uses: one
    // resource whose located spawns straddle two enclosing seams.
    const home: SeamLocation = {
      file: "src/index.ts",
      line: 100,
      seamKey: "src/index.ts:90",
      seamLabel: "deployStorefront (src/index.ts:90)",
    };
    const stray: SeamLocation = {
      file: "src/index.ts",
      line: 400,
      seamKey: "src/index.ts:380",
      seamLabel: "runStartCommand (src/index.ts:380)",
    };
    const findings = judgeProductionSeam("Vercel deployment", [home, stray]);
    assert.equal(
      findings.length,
      1,
      `a spawn outside its declared seam must redden the check, once: ${JSON.stringify(findings)}`,
    );
    const [finding] = findings;
    assert.equal(finding!.site, "src/index.ts:400", "the finding must name the spawn's site");
    assert.equal(
      finding!.resource,
      "Vercel deployment",
      "the finding must name the spawn it reports",
    );
    assert.equal(
      finding!.seam,
      home.seamLabel,
      "the finding must name the seam the spawn belongs in",
    );
    // Plant removed: the same judge over spawns sharing one seam stays green.
    assert.deepEqual(
      judgeProductionSeam("Vercel deployment", [home, { ...stray, seamKey: home.seamKey, seamLabel: home.seamLabel }]),
      [],
      "spawns sharing one enclosing seam must leave the check green",
    );
  },
);
