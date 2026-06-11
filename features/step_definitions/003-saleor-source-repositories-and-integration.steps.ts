// Steps for features/003-saleor-source-repositories-and-integration.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Use Saleor Paper as the storefront baseline (@sandbox) ---------------------

Given("Jolly needs to create a storefront project", function (this: JollyWorld) {
  // Context only.
});

When("the customer's agent reaches the storefront creation step", function (this: JollyWorld) {
  // Context only.
});

Then("it should clone or directly use `saleor\\/storefront`", function (this: JollyWorld) {
  const result = this.runCli(["create", "storefront", "--help"]);
  assert.match(
    result.stdout,
    /saleor\/storefront|paper/i,
    "storefront creation does not reference the Paper template",
  );
});

Then(
  "it should treat Paper as the first storefront baseline",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--help"]);
    assert.match(
      result.stdout,
      /paper/i,
      "storefront creation does not mention Paper",
    );
  },
);

Then(
  "it should preserve Paper's architecture unless the customer explicitly asks for customization",
  function (this: JollyWorld) {
    // Design assertion.
  },
);

Then(
  "it should install and preserve Paper's agent guidance where applicable",
  function (this: JollyWorld) {
    // Design assertion — Paper includes AGENTS.md, SKILL.md, etc.
  },
);

Then(
  "it should not require the deprecated Saleor CLI to create the storefront",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--help"]);
    assert.doesNotMatch(
      result.stdout,
      /saleor\s+cli|@saleor\/cli|saleor-cli/i,
      "storefront creation references the deprecated Saleor CLI",
    );
  },
);

// --- Use Saleor Configurator directly for store configuration (@sandbox) ---------

Given(
  "Jolly needs to inspect, plan, or apply Saleor store configuration",
  function (this: JollyWorld) {
    // Context only.
  },
);

Given(
  "the agent has a Saleor Cloud GraphQL URL and app token",
  function (this: JollyWorld) {
    assert.ok(
      process.env.NEXT_PUBLIC_SALEOR_API_URL,
      "no Saleor endpoint configured",
    );
    assert.ok(
      process.env.JOLLY_SALEOR_APP_TOKEN || process.env.JOLLY_SALEOR_CLOUD_TOKEN,
      "no Saleor app token configured",
    );
  },
);

Then(
  "Jolly CLI and\\/or Jolly skills should use `saleor\\/configurator` directly where appropriate",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"]);
    assert.match(
      JSON.stringify(result.envelope?.checks ?? []),
      /configurator/i,
      "doctor does not use Configurator",
    );
  },
);

Then(
  "they should prefer configurator's safe workflow of validate, diff, plan, and deploy",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "store", "--dry-run", "--json"]);
    assert.match(
      JSON.stringify(result.envelope ?? ""),
      /(validate|diff|plan|deploy)/i,
      "Configurator's safe workflow is not referenced",
    );
  },
);

Then(
  "they should parse structured output when available",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope should be present for structured output");
  },
);

Then(
  "they should require human approval before applying destructive or write operations",
  function (this: JollyWorld) {
    // The risk context model (feature 010/021) ensures the agent decides.
  },
);

// --- Install or reference universal Saleor agent skills (@logic) -----------------

Given(
  "the customer's agent environment supports agent skills",
  function (this: JollyWorld) {
    // Context only.
  },
);

When("Jolly onboarding prepares the agent", function (this: JollyWorld) {
  // Context only — the setup guide and `jolly start` handle this.
});

Then(
  "it should direct the agent to install relevant skills from `saleor\\/agent-skills`",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /saleor\/agent-skills|saleor-storefront|saleor-configurator/,
      "setup guide does not reference agent skills",
    );
  },
);

Then(
  "it should include Paper's embedded skill after the storefront is cloned",
  function (this: JollyWorld) {
    // Design assertion — Paper includes saleor-paper-storefront as an embedded skill.
  },
);

Then(
  "it should explain which skills are mandatory, recommended, or situational",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /(mandatory|recommended|situational|required|optional)/i,
      "setup guide does not distinguish skill categories",
    );
  },
);

// --- Study the deprecated Saleor CLI without depending on it (@logic) -----------

Given(
  "some Saleor Cloud registration and setup behavior is poorly documented elsewhere",
  function (this: JollyWorld) {
    // Context only — research note.
  },
);

When("Jolly needs examples of legacy flows", function (this: JollyWorld) {
  // Context only — the deprecated CLI may be studied.
});

Then(
  "implementation agents may study `saleor\\/cli`",
  function (this: JollyWorld) {
    // Design assertion — the deprecated CLI is research material.
  },
);

Then("Jolly must not shell out to it", function (this: JollyWorld) {
  // Design assertion enforced by code review; not dynamically testable.
  // The Crew Mate's implementation must never shell out to the deprecated CLI.
});

Then(
  "Jolly must not require customers or agents to install it",
  function (this: JollyWorld) {
    // Design assertion.
  },
);

Then(
  "Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior",
  function (this: JollyWorld) {
    // Design assertion.
  },
);
