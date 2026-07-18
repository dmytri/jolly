// Feature 030 — concurrent invocation isolation (@logic).
//
// Reclamation is run-scoped by AGE: a jolly-cannon-fodder-namespaced leftover
// is stale once it is older than the full-regression wall-clock budget in
// RIGGING.md, since no live invocation can be older than the whole
// regression's ceiling; a younger namespaced resource belongs to a live
// sibling invocation and is left alone.
//
// The first scenario pins the SELECTION rule on the one real Cloud selection
// seam (leftoverTestEnvironments), through the same shared When feature 026's
// recognition scenario drives, over explicitly aged fixtures. The second pins
// the OBSERVABLE local effect: a REAL second invocation — the standalone
// reclaim entrypoint `npm run reclaim` runs (features/support/reclaim-cli.ts)
// under its own run id — sweeps the real tmpdir while this cucumber invocation
// (the first) still runs, and must remove only the aged leftover. The blank
// Cloud token keeps the second invocation off the real Cloud (dotenv fills
// only ABSENT values, so blank survives); the local sweep is token-free by
// design, which is exactly what lets this scenario observe it hermetically.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudEnvironment } from "../support/cloud.ts";
import { fullRegressionBudgetMs } from "../support/wake.ts";
import { REPO_ROOT } from "../support/repo-root.ts";
import type { JollyWorld } from "../support/world.ts";
import { stageEnvironmentFixture } from "./026-live-by-design-verification.steps.ts";

/** A sibling invocation's run identity: cannon-fodder-namespaced, but NOT this
 * run's namespace, so nothing protects it except the age gate under test. */
function siblingRunSuffix(world: JollyWorld, label: string): string {
  return `sibling-${label}-${world.runId}`;
}

Given(
  "a `jolly-cannon-fodder`-namespaced Saleor environment created moments ago by a live sibling invocation",
  function (this: JollyWorld) {
    const name = `jolly-cannon-fodder-${siblingRunSuffix(this, "fresh")}-w0`;
    const fresh: CloudEnvironment = {
      org: "acme",
      key: "sibling-fresh",
      name,
      domainLabel: name,
      created: new Date().toISOString(),
    };
    this.notes.freshSiblingEnvironment = fresh;
    stageEnvironmentFixture(this, fresh);
  },
);

Given(
  "a `jolly-cannon-fodder`-namespaced Saleor environment older than the full-regression wall-clock budget in {string}",
  function (this: JollyWorld, riggingFile: string) {
    const staleAfterMs = fullRegressionBudgetMs(riggingFile);
    const name = `jolly-cannon-fodder-${siblingRunSuffix(this, "stale")}-w0`;
    const stale: CloudEnvironment = {
      org: "acme",
      key: "stale-leftover",
      name,
      domainLabel: name,
      created: new Date(Date.now() - staleAfterMs - 60_000).toISOString(),
    };
    this.notes.staleLeftoverEnvironment = stale;
    stageEnvironmentFixture(this, stale);
  },
);

Then("the environment older than the budget should be selected", function (this: JollyWorld) {
  const stale = this.notes.staleLeftoverEnvironment as CloudEnvironment;
  const selected = this.notes.selectedForReclamation as CloudEnvironment[];
  assert.ok(
    selected.some((env) => env.key === stale.key),
    `an environment created ${String(stale.created)} is older than the ` +
      `full-regression budget, so no live invocation can own it; it must be ` +
      `selected for reclamation or it squats an org slot forever`,
  );
});

Then(
  "the sibling invocation's fresh environment should be left alone",
  function (this: JollyWorld) {
    const fresh = this.notes.freshSiblingEnvironment as CloudEnvironment;
    const selected = this.notes.selectedForReclamation as CloudEnvironment[];
    assert.ok(
      !selected.some((env) => env.key === fresh.key),
      `an environment created ${String(fresh.created)} is younger than the ` +
        `full-regression budget, so it belongs to a live sibling invocation; ` +
        `selecting it would reclaim a concurrent run's live store out from under it`,
    );
  },
);

// ─── Second scenario: the real local sweep under a real second invocation ───

Given(
  "one cucumber invocation holding run-namespaced local scratch directories, freshly created and still in use",
  function (this: JollyWorld) {
    // This cucumber run IS the first invocation; its fresh scratch state is
    // staged under a sibling run namespace, so only the age gate protects it.
    const dirs = [0, 1].map((worker) =>
      join(tmpdir(), `jolly-cannon-fodder-${siblingRunSuffix(this, "live")}-w${worker}-scratch`),
    );
    // Teardown registered before creation; idempotent (force) either way.
    for (const dir of dirs) {
      this.cleanup.register(`sibling scratch directory ${dir}`, () => {
        rmSync(dir, { recursive: true, force: true });
      });
      mkdirSync(dir, { recursive: true });
    }
    this.notes.freshScratchDirs = dirs;
  },
);

Given(
  "a run-namespaced local scratch leftover older than the full-regression wall-clock budget in {string}",
  function (this: JollyWorld, riggingFile: string) {
    const staleAfterMs = fullRegressionBudgetMs(riggingFile);
    const dir = join(
      tmpdir(),
      `jolly-cannon-fodder-${siblingRunSuffix(this, "dead")}-w0-scratch`,
    );
    this.cleanup.register(`stale scratch leftover ${dir}`, () => {
      rmSync(dir, { recursive: true, force: true });
    });
    mkdirSync(dir, { recursive: true });
    // Age the leftover past the budget: mtime is the sweep's age observable
    // (a directory's mtime never predates its creation, so an mtime-old entry
    // is genuinely old, while a live run's fresh entry can never look stale).
    const agedSeconds = (Date.now() - staleAfterMs - 60_000) / 1000;
    utimesSync(dir, agedSeconds, agedSeconds);
    this.notes.staleScratchDir = dir;
  },
);

When(
  "a second cucumber invocation runs its pre-run reclamation while the first invocation still runs",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    // The REAL standalone entrypoint (`npm run reclaim` runs this file), under
    // its OWN run id — a genuine second invocation whose namespace protects
    // none of the fixtures above. This cucumber process is still running, so
    // "while the first invocation still runs" holds by construction.
    const spawned = spawnSync(
      process.env.HARNESS_CLI_RUNTIME ?? "node",
      [join(REPO_ROOT, "features", "support", "reclaim-cli.ts")],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 110_000,
        env: {
          ...process.env,
          JOLLY_SALEOR_CLOUD_TOKEN: "",
          HARNESS_RUN_ID: `second-${this.runId}`,
        },
      },
    );
    if (spawned.error) {
      throw new Error(
        `failed to run the second invocation's reclamation: ${spawned.error.message}`,
      );
    }
    const output = `${spawned.stdout ?? ""}\n${spawned.stderr ?? ""}`;
    assert.equal(
      spawned.status,
      0,
      `the second invocation's reclamation failed (exit ${spawned.status}):\n${output}`,
    );
    this.notes.secondInvocationOutput = output;
  },
);

Then(
  "the first invocation's scratch directories should still exist",
  function (this: JollyWorld) {
    const dirs = this.notes.freshScratchDirs as string[];
    for (const dir of dirs) {
      assert.ok(
        existsSync(dir),
        `the second invocation's reclamation removed ${dir}, a live sibling ` +
          `invocation's fresh scratch directory; reclamation must be run-scoped ` +
          `by age, never a blanket sweep of every other run's namespace`,
      );
    }
  },
);

Then("the stale leftover should be removed", function (this: JollyWorld) {
  const dir = this.notes.staleScratchDir as string;
  assert.ok(
    !existsSync(dir),
    `the stale leftover ${dir} is older than the full-regression budget, so no ` +
      `live invocation can own it; the second invocation's reclamation must remove it`,
  );
});
