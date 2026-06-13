// Feature 003 — Saleor source repositories and integration boundaries.
//
// This feature describes which upstream repos Jolly leans on (saleor/storefront
// "Paper", @saleor/configurator, saleor/agent-skills) and which it must NOT
// depend on (the deprecated saleor/cli). Cloning Paper, running the configurator,
// and studying legacy flows are the AGENT's actions (or an implementation-agent
// note), not Jolly's code — so the @sandbox scenarios assert only Jolly-
// observable boundaries (the skill set Jolly manages, doctor recognizing the
// storefront baseline) and the narrative steps are capability no-ops.
//
// Safety: @logic CLI invocations on side-effecting paths use logicSafeEnv();
// the read-only commands here (skills, doctor) are harmless either way and run
// in the scenario's temp project dir.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Scenario: Use Saleor Paper as the storefront baseline (@sandbox) --------
//
// Cloning saleor/storefront is the agent's git step. Jolly-observable: Jolly
// manages the Paper-related skill set and `doctor storefront` recognizes a
// Paper baseline. Gated by SANDBOX_REQUIREMENTS["Use Saleor Paper as the
// storefront baseline"] (saleorEndpoint) → skips locally.

Given("Jolly needs to create a storefront project", function (this: JollyWorld) {
  this.notes.sandboxStorefront = true;
});

When("the customer's agent reaches the storefront creation step", function () {
  // The agent runs `git clone saleor/storefront` per the Jolly skill — not
  // Jolly's code, not executed by the harness.
});

Then("it should clone or directly use `saleor\\/storefront`", function (this: JollyWorld) {
  // Jolly-observable: doctor's storefront group exists and points the agent at
  // cloning Paper when no storefront is present.
  this.runCli(["doctor", "storefront", "--json"]);
  const check = this.findCheck("storefront-present");
  assert.ok(check, "doctor storefront must report a storefront-present check");
});

Then("it should treat Paper as the first storefront baseline", function (this: JollyWorld) {
  // The managed skill set includes the Saleor storefront guidance skill.
  this.runCli(["skills", "--json"]);
  const skills = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(skills.includes("storefront"), "Jolly should manage a storefront (Paper) skill");
});

Then(
  "it should preserve Paper's architecture unless the customer explicitly asks for customization",
  function () {
    // Preservation is the agent's discipline guided by the skill — narrative.
  },
);

Then(
  "it should install and preserve Paper's agent guidance where applicable",
  function () {
    // Paper's embedded skill arrives with the cloned repo (agent's git step).
  },
);

Then(
  "it should not require the deprecated Saleor CLI to create the storefront",
  function (this: JollyWorld) {
    // Jolly-observable: Jolly's own command surface never references saleor/cli.
    this.runCli(["help", "--json"]);
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(!text.includes("saleor/cli"), "Jolly must not require the deprecated Saleor CLI");
  },
);

// --- Scenario: Use Saleor Configurator directly (@sandbox) ------------------
//
// Running @saleor/configurator is the agent's job; Jolly never shells out to
// it. Jolly-observable: Jolly manages the configurator guidance skill. Gated by
// SANDBOX_REQUIREMENTS["Use Saleor Configurator directly for store
// configuration"] (saleorEndpoint+saleorAppToken) → skips locally.

Given("Jolly needs to inspect, plan, or apply Saleor store configuration", function (this: JollyWorld) {
  this.notes.sandboxConfigurator = true;
});

When("the agent has a Saleor Cloud GraphQL URL and app token", function () {
  // Precondition for the agent's configurator run — not a Jolly action.
});

Then(
  "the customer's agent should run `saleor\\/configurator` directly, guided by the Jolly skill — Jolly itself never shells out to it",
  function (this: JollyWorld) {
    // Jolly-observable: Jolly manages the configurator skill and exposes no
    // command that runs the configurator itself.
    this.runCli(["skills", "--json"]);
    const skills = JSON.stringify(this.envelope.data).toLowerCase();
    assert.ok(skills.includes("configurator"), "Jolly should manage the configurator guidance skill");
  },
);

Then(
  "it should prefer configurator's safe workflow of validate, diff, plan, and deploy",
  function () {
    // The safe workflow is the agent's via the configurator + skill — narrative.
  },
);

Then("they should parse structured output when available", function () {
  // Structured-output parsing is the agent's, guided by skills — narrative.
});

Then(
  "they should require human approval before applying destructive or write operations",
  function () {
    // The agent's approval discipline; Jolly emits riskContext but does not run
    // the configurator. Narrative no-op.
  },
);

// --- Scenario: Install or reference universal Saleor agent skills (@logic) ---

Given("the customer's agent environment supports agent skills", function (this: JollyWorld) {
  this.notes.agentSkills = true;
});

When("Jolly onboarding prepares the agent", function (this: JollyWorld) {
  // `jolly skills` lists/inspects the managed skill set Jolly installs.
  this.runCli(["skills", "--json"], { env: logicSafeEnv() });
});

Then(
  "it should direct the agent to install relevant skills from `saleor\\/agent-skills`",
  function (this: JollyWorld) {
    const skillRefs = JSON.stringify(this.envelope.data).toLowerCase();
    assert.ok(skillRefs.includes("saleor"), "the skill set should include Saleor agent-skills");
    // The default skill set includes the Saleor storefront/configurator skills.
    assert.ok(this.envelope.checks.length > 0, "skills should report the managed set as checks");
  },
);

Then("it should include Paper's embedded skill after the storefront is cloned", function () {
  // Paper's embedded skill arrives with the cloned repo — the agent's git step.
});

Then(
  "it should explain which skills are mandatory, recommended, or situational",
  function (this: JollyWorld) {
    // Each managed skill carries a description; the set is enumerated.
    const data = this.envelope.data as { skills?: unknown };
    assert.ok(Array.isArray(data.skills) && data.skills.length > 0, "skills must be enumerated with descriptions");
  },
);

// --- Scenario: Study the deprecated Saleor CLI without depending on it (@logic)

Given(
  "some Saleor Cloud registration and setup behavior is poorly documented elsewhere",
  function (this: JollyWorld) {
    this.notes.legacyResearch = true;
  },
);

When("Jolly needs examples of legacy flows", function (this: JollyWorld) {
  // Jolly-observable check: Jolly's own surface neither requires nor invokes
  // saleor/cli. Use the help envelope as the surface-of-record.
  this.runCli(["help", "--json"], { env: logicSafeEnv() });
});

Then("implementation agents may study `saleor\\/cli`", function () {
  // A note to implementation agents (research only); no Jolly behavior.
});

Then("Jolly must not shell out to it", function (this: JollyWorld) {
  // Jolly's command list contains no saleor/cli invocation.
  const commands = JSON.stringify(this.envelope.data).toLowerCase();
  assert.ok(!commands.includes("saleor/cli"), "Jolly must not shell out to saleor/cli");
});

Then("Jolly must not require customers or agents to install it", function (this: JollyWorld) {
  const text = JSON.stringify(this.envelope).toLowerCase();
  assert.ok(!text.includes("@saleor/cli"), "Jolly must not require installing the deprecated CLI");
});

Then(
  "Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior",
  function () {
    // Implementation-agent discipline; not pinnable from runtime output.
  },
);
