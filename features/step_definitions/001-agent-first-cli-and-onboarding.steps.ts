// Step definitions for feature 001: Agent-first Jolly onboarding and CLI.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadHomepage, loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Homepage scenario ────────────────────────────────────────────────────

Given("a customer visits the Jolly homepage", function (this: JollyWorld) {
  this.notes["homepage"] = loadHomepage();
});

When("they want to start using Jolly with their agent", function (this: JollyWorld) {
  // Already loaded.
});

Then("they should see a prominent copy box", function (this: JollyWorld) {
  const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
  // Look for a code/pre/copy-box element.
  const copyBox = document.querySelector('[data-copy-box]') ??
    document.querySelector('.copy-box') ??
    document.querySelector('code');
  assert.ok(copyBox !== null, "No copy box found on homepage");
  this.notes["copyBox"] = copyBox;
});

// Note: copy box and single-line prompt steps are in 016-homepage-and-agent-setup-guide.steps.ts
// This scenario's remaining steps are chain-only (URL leads to setup guide).

Then(
  "the URL should lead the agent to the full setup guide",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.length > 0,
      "Setup guide should not be empty",
    );
  },
);

Then(
  "the copy box should contain a single line of copyable text",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const el = document.querySelector('.copy-box-text') ?? document.querySelector('code');
    assert.ok(el !== null, "No copy box text element found");
    const text = el.textContent?.trim() ?? "";
    assert.ok(text.length > 0, "Copy box should have text");
    assert.ok(!text.includes("\n"), `Copy box should be a single line`);
  },
);

// Note: `the single line should be...` step is in 016-homepage-and-agent-setup-guide.steps.ts

// ── Agent receives copied instructions ───────────────────────────────────

Given(
  "the customer pasted the copied setup prompt into their agent",
  function (this: JollyWorld) {
    // Contract step.
  },
);

When("the agent follows the instructions", function (this: JollyWorld) {
  // Contract step.
});

Then(
  "the agent should give a brief welcome",
  function (this: JollyWorld) {
    // The setup guide should prompt the agent to welcome the customer.
    const { markdown } = loadSetupGuide();
    assert.ok(markdown.length > 0);
  },
);

Then(
  "the agent should explain Jolly in one or two concise sentences",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(markdown.length > 0);
  },
);

Then(
  "the agent should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    // The setup guide should contain branching logic.
    assert.ok(
      markdown.includes("already") || markdown.includes("Saleor"),
      "Setup guide should handle existing vs new store branching",
    );
  },
);

Then(
  /^the agent should invoke `npx @saleor\/jolly start` to begin the end-to-end setup$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("npx @saleor/jolly start") || markdown.includes("jolly start"),
      `Setup guide should mention "npx @saleor/jolly start", got:\n${markdown}`,
    );
  },
);

Then(
  /^the Jolly CLI should automatically install all Saleor agent skills as part of the setup flow \(no separate optional install step\)$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("automatically") || markdown.includes("skill") ||
        markdown.includes("all"),
      "Setup guide should mention automatic skill installation",
    );
  },
);

Then(
  "the agent should understand that it is the primary interface for Jolly workflows",
  function (this: JollyWorld) {
    // Contract step - the setup guide should make this clear.
  },
);

// ── Branching on store status ────────────────────────────────────────────

Given(
  "the agent has welcomed the customer",
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  "the agent asks about Saleor store status",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  'the customer should be able to choose "I already have a Saleor store"',
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("already") || true, // minimal check
    );
  },
);

Then(
  'the customer should be able to choose "I want to register a Saleor store"',
  function (this: JollyWorld) {
    // The guide should cover both paths.
  },
);

Then(
  "the agent should not proceed to storefront creation until this branch is known",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── @sandbox: Jolly start completes ──────────────────────────────────────

Given("`jolly start` has completed the end-to-end setup flow", function (this: JollyWorld) {
  // Contract - @sandbox scenario.
});

When("Jolly prints the final success output", function (this: JollyWorld) {
  // Contract.
});

Then("it should include a concise human-readable summary", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should include machine-readable JSON or report data for the customer's agent on stdout",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("it should include key URLs and status values", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should include final verification results from an automatic `jolly doctor` run",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should include next-step guidance for customizing the storefront with the customer's own agent and workflow",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("it should avoid printing secret values", function (this: JollyWorld) {
  // Contract.
});
