// Steps for features/010-agent-decided-approval-model.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertRiskContextShape,
  findRiskContexts,
} from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Agent decides whether approval is needed (@logic) --------------------------

Given(
  "a Jolly workflow is about to perform a potentially impactful action",
  function (this: JollyWorld) {
    // Context only.
  },
);

When(
  "the action could create, modify, deploy, delete, or expose remote resources",
  function (this: JollyWorld) {
    // Run a representative side-effecting command with --dry-run to preview
    // the risk context without actually creating resources.
    this.runCli(["create", "store", "--dry-run", "--json"]);
  },
);

Then(
  "Jolly should provide enough structured context for the customer's agent to assess risk",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope expected from --dry-run");
    const riskContexts = findRiskContexts(this.envelope);
    assert.ok(
      riskContexts.length > 0,
      "no risk context found in the envelope",
    );
    for (const rc of riskContexts) {
      assertRiskContextShape(rc);
    }
  },
);

Then(
  "the customer's agent should decide whether to ask for human approval",
  function (this: JollyWorld) {
    // The risk context's riskLevel and categories let the agent decide.
    // This is a design assertion — Jolly does not hardcode approval decisions.
    const riskContexts = findRiskContexts(this.envelope);
    for (const rc of riskContexts) {
      const r = rc as { riskLevel: string };
      assert.ok(
        ["low", "medium", "high"].includes(r.riskLevel),
        `unexpected riskLevel: ${r.riskLevel}`,
      );
    }
  },
);

Then(
  "the decision should respect the customer's instructions and the current agent environment's policies",
  function (this: JollyWorld) {
    // Design assertion — enforced by the agent, not by Jolly.
    // Jolly provides --yes/-y so agent environments that pre-approve
    // can skip Jolly-level prompts.
    const help = this.runCli(["--help"]).stdout;
    assert.match(help, /(-y|--yes)/, "CLI does not surface a --yes / -y flag");
  },
);
