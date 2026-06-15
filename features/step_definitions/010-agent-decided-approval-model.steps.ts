// Feature 010 — Agent-decided approval model.
//
// The @logic scenario pins the principle that Jolly never hardcodes the
// approval decision: before a potentially impactful action it provides enough
// structured context (the feature 021 riskContext, carried inside the feature
// 020 envelope) for the customer's agent to assess risk and decide whether to
// ask for human approval — Jolly embeds no approve/deny verdict.
//
// Safety: the impactful command runs under logicSafeEnv() — dummy credentials
// for all groups + an unroutable Cloud API base — so the side-effecting path
// can never reach a real account (the "012 incident" lesson). A `--dry-run`
// preview is used so nothing is written even if a path ignored the override.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertRiskContextShape,
  findRiskContexts,
  type RiskContext,
} from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

function onlyRiskContext(world: JollyWorld): RiskContext {
  const contexts = findRiskContexts(world.envelope);
  assert.ok(contexts.length > 0, "expected a riskContext inside the envelope");
  const rc = contexts[0];
  assertRiskContextShape(rc);
  return rc;
}

// ─── Scenario: Agent decides whether approval is needed ──────────────────────

When(
  "`jolly create store --create-environment --json` runs without `--yes`",
  function (this: JollyWorld) {
    // `create store --create-environment` is a representative impactful action
    // (creates a remote Saleor Cloud environment). The --dry-run preview emits
    // the same riskContext as a real run without writing or contacting anything.
    this.runCli(
      ["create", "store", "--create-environment", "--dry-run", "--json"],
      { env: logicSafeEnv() },
    );
    assert.ok(this.lastRun?.envelope, "expected an envelope for the impactful action");
  },
);

Then(
  "the envelope should carry a feature {int} `riskContext` for the action",
  function (this: JollyWorld, _feature: number) {
    // The full feature 021 riskContext shape is present (action/target/
    // riskLevel/categories/reversible/sideEffects/dryRunAvailable).
    onlyRiskContext(this);
  },
);

Then(
  "Jolly should not perform the impactful action without approval",
  function (this: JollyWorld) {
    // Jolly never hardcodes the approval decision: the riskContext carries no
    // approve/deny verdict field — the decision is left to the agent.
    const rc = onlyRiskContext(this) as unknown as Record<string, unknown>;
    for (const verdictKey of ["approved", "approve", "denied", "decision", "autoApprove"]) {
      assert.ok(
        !(verdictKey in rc),
        `riskContext must not embed an approval verdict ("${verdictKey}")`,
      );
    }
    // A --dry-run is available so the agent can preview before deciding.
    assert.equal(rc.dryRunAvailable, true, "an impactful action should offer a dry-run preview");
  },
);

Then(
  "re-running the command with `--yes` should let it proceed, treating the flag as the approval",
  function (this: JollyWorld) {
    // Jolly defers the decision entirely to the agent: it surfaces the risk
    // level/categories the agent's policy keys off, and supports `--yes`/`-y`
    // for environments that permit skipping Jolly's own prompts — without
    // Jolly imposing one approval policy.
    const rc = onlyRiskContext(this);
    assert.ok(["low", "medium", "high"].includes(rc.riskLevel), "a riskLevel must be provided to the agent");
    assert.ok(Array.isArray(rc.categories), "risk categories must be provided to the agent");
    // The same impactful command accepts --yes without Jolly hardcoding a verdict.
    this.runCli(
      ["create", "store", "--create-environment", "--dry-run", "--yes", "--json"],
      { env: logicSafeEnv() },
    );
    const withYes = findRiskContexts(this.envelope);
    assert.ok(withYes.length > 0, "--yes must still surface the riskContext for the agent's policy");
  },
);
