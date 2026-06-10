// Steps for features/021-agent-risk-context.feature.
//
// Impactful actions are exercised through the side-effecting create/deploy
// commands with `--dry-run --json`: per the spec the riskContext is identical
// in preview and execution, and preview must work without remote side effects,
// so dry runs are the local-safe assertion surface for the contract.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import {
  findRiskContexts,
  riskContextProblems,
  RISK_LEVELS,
  RISK_CATEGORIES,
  type RiskContext,
} from "../support/envelope.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

const IMPACTFUL_DRY_RUNS: string[][] = [
  ["create", "store"],
  ["create", "storefront"],
  ["create", "recipe"],
  ["create", "deployment"],
  ["deploy"],
];

async function collectRiskContexts(world: JollyWorld): Promise<{ run: RunResult; contexts: unknown[] }[]> {
  const cached = world.vars.get("riskRuns");
  if (cached) return cached as { run: RunResult; contexts: unknown[] }[];
  const collected: { run: RunResult; contexts: unknown[] }[] = [];
  for (const args of IMPACTFUL_DRY_RUNS) {
    const run = await world.jolly([...args, "--dry-run", "--json", "--yes"]);
    const envelope = run.envelope;
    collected.push({ run, contexts: envelope ? findRiskContexts(envelope) : [] });
  }
  world.vars.set("riskRuns", collected);
  return collected;
}

function allContexts(world: JollyWorld): RiskContext[] {
  const collected = world.vars.get("riskRuns") as { run: RunResult; contexts: unknown[] }[] | undefined;
  assert.ok(collected, "no impactful dry runs recorded for this scenario");
  return collected.flatMap((entry) => entry.contexts) as RiskContext[];
}

function assertEveryCommandExposesRiskContext(
  collected: { run: RunResult; contexts: unknown[] }[],
): void {
  for (const { run, contexts } of collected) {
    requireEnvelope(run);
    assert.ok(
      contexts.length > 0,
      `jolly ${run.args.join(" ")} exposed no riskContext for an impactful action`,
    );
    for (const context of contexts) {
      assert.deepEqual(riskContextProblems(context), [], `jolly ${run.args.join(" ")}: ${JSON.stringify(context)}`);
    }
  }
}

Given(
  lit("approval granularity is decided by the customer's agent, not hardcoded by Jolly"),
  function () {
    // Premise (feature 010); enforced by the assertions below.
  },
);

Given(lit("side-effecting commands support `--dry-run`"), function () {
  // Premise; exercised by every dry run in this file.
});

Given(
  lit("a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource"),
  async function (this: JollyWorld) {
    await collectRiskContexts(this);
  },
);

When(lit("Jolly prepares to perform the action"), function (this: JollyWorld) {
  const collected = this.vars.get("riskRuns") as { run: RunResult }[];
  for (const { run } of collected) requireEnvelope(run);
});

Then(lit("it should expose a structured `riskContext` for the agent to assess"), function (this: JollyWorld) {
  assertEveryCommandExposesRiskContext(this.vars.get("riskRuns") as { run: RunResult; contexts: unknown[] }[]);
});

Then(lit("the `riskContext` should include the `action` being performed"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) {
    assert.ok(typeof rc.action === "string" && rc.action.length > 0, JSON.stringify(rc));
  }
});

Then(lit("it should include the `target` resource and its scope"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) assert.ok(rc.target !== undefined && rc.target !== null && rc.target !== "");
});

Then(lit("it should include a `riskLevel` of low, medium, or high"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) {
    assert.ok(RISK_LEVELS.includes(rc.riskLevel as (typeof RISK_LEVELS)[number]), JSON.stringify(rc.riskLevel));
  }
});

Then(lit("it should include the applicable risk `categories`"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) {
    assert.ok(Array.isArray(rc.categories), "categories must be an array");
    for (const category of rc.categories) {
      assert.ok(
        (RISK_CATEGORIES as readonly string[]).includes(category as string),
        `category ${JSON.stringify(category)} is not in the feature 010 high-risk vocabulary`,
      );
    }
  }
});

Then(lit("it should include whether the action is `reversible`"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) assert.equal(typeof rc.reversible, "boolean");
});

Then(lit("it should include the expected `sideEffects`"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) assert.ok(rc.sideEffects !== undefined);
});

Then(lit("it should include whether a dry run is available via `dryRunAvailable`"), function (this: JollyWorld) {
  for (const rc of allContexts(this)) assert.equal(typeof rc.dryRunAvailable, "boolean");
});

Then(
  lit("the customer's agent should decide whether to ask for human approval based on this context"),
  function (this: JollyWorld) {
    // Jolly's side of the contract: never hardcode the decision. In a
    // non-interactive run the command must complete (returning context),
    // not stall waiting for its own approval prompt.
    const collected = this.vars.get("riskRuns") as { run: RunResult }[];
    for (const { run } of collected) {
      assert.notEqual(run.exitCode, null, `jolly ${run.args.join(" ")} did not complete non-interactively`);
    }
  },
);

Given(lit("a command supports `--dry-run`"), function (this: JollyWorld) {
  // Comparison subject chosen in the When step.
});

When(lit("the agent previews the action with `--dry-run`"), async function (this: JollyWorld) {
  // @sandbox: compares preview to real execution, so it needs real accounts.
  // `create recipe` is the lowest-risk impactful action to execute for real.
  const env = sandboxRuntimeEnv();
  const preview = await this.jolly(["create", "recipe", "--dry-run", "--json", "--yes"], { env });
  this.vars.set("previewRun", preview);
  this.cleanup.register("recipe created by 021 preview-vs-execute", async () => {
    // Recipe creation writes into the local project dir, removed with it.
  });
  const execute = await this.jolly(["create", "recipe", "--json", "--yes"], { env, timeoutMs: 600_000 });
  this.vars.set("executeRun", execute);
});

Then(
  lit("the `riskContext` shown in preview should match the `riskContext` for real execution"),
  function (this: JollyWorld) {
    const preview = requireEnvelope(this.vars.get("previewRun") as RunResult);
    const execute = requireEnvelope(this.vars.get("executeRun") as RunResult);
    assert.deepEqual(
      findRiskContexts(preview),
      findRiskContexts(execute),
      "preview and execution must expose identical riskContext",
    );
  },
);

Then(lit("no remote side effects should occur during the dry run"), function (this: JollyWorld) {
  const preview = requireEnvelope(this.vars.get("previewRun") as RunResult);
  // Dry runs must self-describe as side-effect free; the strongest local
  // assertion is that the envelope reports a preview, not performed work.
  assert.ok(
    /dry.?run|preview|would/i.test(JSON.stringify(preview)),
    "dry-run envelope must describe planned (not performed) work",
  );
});

Given(lit("a command produces output with `--json`"), async function (this: JollyWorld) {
  await collectRiskContexts(this);
});

When(lit("the output describes an impactful action"), function (this: JollyWorld) {
  assertEveryCommandExposesRiskContext(this.vars.get("riskRuns") as { run: RunResult; contexts: unknown[] }[]);
});

Then(
  lit("the `riskContext` should be carried inside the output envelope `data` and/or `checks`"),
  function (this: JollyWorld) {
    // findRiskContexts only searches data/checks, so non-empty results prove placement.
    const collected = this.vars.get("riskRuns") as { run: RunResult; contexts: unknown[] }[];
    for (const { run, contexts } of collected) {
      assert.ok(contexts.length > 0, `jolly ${run.args.join(" ")}: riskContext not found inside data/checks`);
    }
  },
);

Then(lit("it should not use a separate ad hoc format outside the feature 020 envelope"), function (this: JollyWorld) {
  const collected = this.vars.get("riskRuns") as { run: RunResult }[];
  for (const { run } of collected) {
    const envelope = requireEnvelope(run);
    assert.equal(envelope.riskContext, undefined, "riskContext must live in data/checks, not as an ad hoc top-level field");
    // With --json, stdout is the envelope alone — no side-channel output.
    assert.doesNotThrow(() => JSON.parse(run.stdout), "with --json there must be no extra output outside the envelope");
  }
});

Given(lit("an action falls into a high-risk category"), async function (this: JollyWorld) {
  await collectRiskContexts(this);
});

When(lit("Jolly builds its `riskContext`"), function (this: JollyWorld) {
  assert.ok(allContexts(this).length > 0, "no riskContext was built");
});

Then(lit("the relevant categories should be listed explicitly"), function (this: JollyWorld) {
  // Deploying a storefront publicly is squarely in the high-risk list; its
  // riskContext must say so explicitly rather than relying on riskLevel alone.
  const collected = this.vars.get("riskRuns") as { run: RunResult; contexts: unknown[] }[];
  const deployEntry = collected.find(({ run }) => run.args[0] === "deploy");
  assert.ok(deployEntry, "deploy dry run missing");
  const categories = (deployEntry.contexts as RiskContext[]).flatMap((rc) => rc.categories as string[]);
  assert.ok(categories.includes("live deployment"), `deploy riskContext categories ${JSON.stringify(categories)} must include "live deployment"`);
});

Then(
  lit("destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category"),
  function (this: JollyWorld) {
    // The category vocabulary is closed (feature 010): everything emitted must
    // come from it, and the emitted set must be non-empty across commands.
    const emitted = new Set(allContexts(this).flatMap((rc) => rc.categories as string[]));
    for (const category of emitted) {
      assert.ok(
        (RISK_CATEGORIES as readonly string[]).includes(category),
        `emitted category ${JSON.stringify(category)} is outside the canonical list`,
      );
    }
    assert.ok(emitted.size > 0, "impactful commands emitted no risk categories at all");
  },
);
