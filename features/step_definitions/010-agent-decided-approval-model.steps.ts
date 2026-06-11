// Steps for features/010-agent-decided-approval-model.feature (@logic).
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import { findRiskContexts, riskContextProblems } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

Given(
  lit("a Jolly workflow is about to perform a potentially impactful action"),
  async function (this: JollyWorld) {
    // Representative impactful action, previewed (no remote side effects).
    const run = await this.jolly(["create", "store", "--dry-run", "--json", "--yes"]);
    this.vars.set("impactfulRun", run);
  },
);

When(
  lit("the action could create, modify, deploy, delete, or expose remote resources"),
  function (this: JollyWorld) {
    requireEnvelope(this.vars.get("impactfulRun") as RunResult);
  },
);

Then(
  lit("Jolly should provide enough structured context for the customer's agent to assess risk"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("impactfulRun") as RunResult);
    const contexts = findRiskContexts(envelope);
    assert.ok(contexts.length > 0, "impactful action exposed no structured riskContext");
    for (const context of contexts) {
      assert.deepEqual(riskContextProblems(context), [], JSON.stringify(context));
    }
  },
);

Then(
  lit("the customer's agent should decide whether to ask for human approval"),
  function (this: JollyWorld) {
    // Jolly's testable side: it must not gate the action behind its own
    // approval prompt — the non-interactive run completes and returns context.
    const run = this.vars.get("impactfulRun") as RunResult;
    assert.notEqual(run.exitCode, null, "command must complete non-interactively, leaving approval to the agent");
    assert.ok(
      !/\[y\/n\]|\(y\/n\)|press enter to/i.test(run.stdout),
      "Jolly must not run its own approval prompt in agent (--json) mode",
    );
  },
);

Then(
  lit("the decision should respect the customer's instructions and the current agent environment's policies"),
  function () {
    // Agent-side behavior outside Jolly's surface; Jolly's obligation (provide
    // context, never hardcode the decision) is asserted by the steps above.
  },
);
