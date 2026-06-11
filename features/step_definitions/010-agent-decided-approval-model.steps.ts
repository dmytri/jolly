// Steps for features/010-agent-decided-approval-model.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertRiskContextShape,
  findRiskContexts,
} from "../support/envelope.ts";
import { loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

Given(
  "a Jolly workflow is about to perform a potentially impactful action",
  function (this: JollyWorld) {
    // Context only; the action is previewed in the next step.
  },
);

When(
  "the action could create, modify, deploy, delete, or expose remote resources",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--dry-run", "--json"]);
  },
);

Then(
  "Jolly should provide enough structured context for the customer's agent to assess risk",
  function (this: JollyWorld) {
    const contexts = findRiskContexts(this.envelope);
    assert.ok(contexts.length > 0, "no structured riskContext is provided");
    for (const rc of contexts) assertRiskContextShape(rc);
  },
);

Then(
  "the customer's agent should decide whether to ask for human approval",
  function (this: JollyWorld) {
    // Jolly describes risk; it never hardcodes the approval decision.
    assert.doesNotMatch(
      JSON.stringify(this.envelope),
      /"(approvalRequired|requiresApproval|approved)"\s*:/,
      "Jolly hardcodes an approval decision instead of leaving it to the agent",
    );
  },
);

Then(
  "the decision should respect the customer's instructions and the current agent environment's policies",
  function (this: JollyWorld) {
    assert.match(
      loadSetupGuide(),
      /approval/i,
      "the setup guide does not direct the agent to apply its own approval policies",
    );
  },
);
