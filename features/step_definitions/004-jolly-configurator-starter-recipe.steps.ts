// Feature 004 — Jolly Configurator starter recipe.
//
// The starter recipe is a Jolly-shipped Configurator recipe, but APPLYING it
// to Saleor Cloud is the AGENT's action via @saleor/configurator's safe
// workflow (validate, diff/plan, deploy) — Jolly never shells out to the
// configurator. Both scenarios are @sandbox; they assert only Jolly-observable
// contributions (Jolly manages the configurator guidance skill; the riskContext
// for any Jolly remote/action command supports --dry-run; the agent owns the
// approval decision). The recipe-application narrative lives in the Jolly skill
// (a Captain-owned asset), not in these step defs.
//
// Gated by SANDBOX_REQUIREMENTS["Agent prepares the starter recipe"] /
// ["Agent applies the starter recipe safely"] (saleorEndpoint+saleorAppToken)
// → skip locally.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { logicSafeEnv } from "../support/logic-env.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Scenario: Agent prepares the starter recipe (@sandbox) -----------------

Given("the customer has created or selected a Saleor Cloud environment", function (this: JollyWorld) {
  this.notes.sandboxEnvReady = true;
});

When(
  "the agent prepares the initial store configuration, guided by the Jolly skill",
  function () {
    // Preparing/writing the recipe and running the configurator are the agent's
    // actions guided by the Jolly skill — not Jolly's code, not executed here.
  },
);

Then("it should use the Jolly-authored starter recipe that Jolly ships", function (this: JollyWorld) {
  // Jolly-observable: Jolly manages the configurator guidance skill that carries
  // the starter-recipe playbook. Jolly itself ships the recipe as a skill asset.
  this.runCli(["skills", "--json"]);
  const skills = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(skills.includes("configurator"), "Jolly should manage the configurator guidance skill");
});

Then(
  "the recipe should be optimized for Paper's required storefront features",
  function () {
    // Recipe content (pirate catalog, channel, etc.) is a Captain-owned asset,
    // not specified or tested here — narrative no-op.
  },
);

Then("the agent should write the recipe into the cloned storefront repository", function () {
  // The agent writes the recipe into the cloned repo — agent's file action.
});

Then("the recipe should be reviewable before deployment", function () {
  // Reviewability is a property of the version-controlled recipe file the agent
  // writes — narrative no-op.
});

Then(
  "the agent should deploy it through `@saleor\\/configurator`'s safe workflow — Jolly never shells out to the configurator itself",
  function (this: JollyWorld) {
    // Jolly-observable boundary: Jolly exposes no command that runs the
    // configurator. Confirm against the command surface.
    this.runCli(["help", "--json"]);
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(!text.includes("configurator deploy"), "Jolly must not run the configurator itself");
  },
);

Then(
  "the Saleor app token used for deployment should have all available permissions in v1",
  function () {
    // The app-token permission breadth is pinned by feature 024's step defs
    // (jolly create app-token requests all permissions). Narrative cross-ref.
  },
);

// --- Scenario: Agent applies the starter recipe safely (@sandbox) -----------

Given("the Jolly starter recipe is ready", function (this: JollyWorld) {
  this.notes.recipeReady = true;
});

When("the agent applies it to Saleor Cloud", function () {
  // The agent runs `@saleor/configurator deploy` — not Jolly's code.
});

Then("it should validate the configuration", function () {
  // configurator validate is the agent's step — narrative no-op.
});

Then("it should show a diff or deployment plan", function () {
  // configurator diff/--plan is the agent's step — narrative no-op.
});

Then(
  "Jolly remote\\/action commands involved in recipe deployment should support `--dry-run` preview behavior",
  function (this: JollyWorld) {
    // Jolly-observable: Jolly's own side-effecting commands carry a riskContext
    // with dryRunAvailable and honor --dry-run. `create store` is the relevant
    // remote/action command in the recipe-adjacent flow.
    this.runCli(["create", "store", "--url", "https://demo.saleor.cloud", "--dry-run", "--json"], {
      env: logicSafeEnv(),
    });
    assert.equal(this.envelope.data["dryRun"], true, "create store must support --dry-run preview");
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "the remote/action command must carry a riskContext");
    assertRiskContextShape(risk);
    assert.equal((risk as { dryRunAvailable: boolean }).dryRunAvailable, true);
  },
);

Then(
  "the customer's agent should decide whether customer approval is needed before applying changes",
  function (this: JollyWorld) {
    // Jolly emits the riskContext and never hardcodes the approval decision.
    const [risk] = findRiskContexts(this.envelope);
    assert.ok(risk, "the riskContext is the input the agent's approval decision uses");
    assertRiskContextShape(risk);
  },
);

Then(
  "it should fail safely if destructive or breaking operations are detected",
  function () {
    // Fail-safe on destructive/breaking ops is the configurator's behavior
    // (--fail-on-delete/--fail-on-breaking), invoked by the agent — narrative.
  },
);
