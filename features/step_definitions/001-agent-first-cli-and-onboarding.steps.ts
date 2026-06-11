// Steps for features/001-agent-first-cli-and-onboarding.feature.
// Homepage/copy-box scenarios assert the committed homepage via happy-dom;
// agent-behavior scenarios assert the committed setup guide instructs the
// agent accordingly; the @sandbox `jolly start` scenario drives the real CLI.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  copyBoxPrompt,
  findCopyBox,
  loadHomepage,
  loadSetupGuide,
  type HomepageDom,
} from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

function dom(world: JollyWorld): HomepageDom {
  if (!world.notes.homepage) world.notes.homepage = loadHomepage();
  return world.notes.homepage as HomepageDom;
}

function guide(world: JollyWorld): string {
  if (!world.notes.guide) world.notes.guide = loadSetupGuide();
  return world.notes.guide as string;
}

// --- Customer starts from the Jolly homepage --------------------------------

Given("a customer visits the Jolly homepage", function (this: JollyWorld) {
  dom(this);
});

When("they want to start using Jolly with their agent", function (this: JollyWorld) {
  // Context only: the customer is at the start of the onboarding path.
});

Then("they should see a prominent copy box", function (this: JollyWorld) {
  findCopyBox(dom(this));
});

// Shared with feature 016 ("Customer copies the agent setup prompt").
Then(
  'the copy box should say "copy this to your agent to get started"',
  function (this: JollyWorld) {
    const text = (findCopyBox(dom(this)).textContent ?? "").toLowerCase();
    assert.ok(
      text.includes("copy this to your agent to get started"),
      "copy box does not carry the required phrase",
    );
  },
);

Then(
  "the copied content should include a URL to Jolly's homepage",
  function (this: JollyWorld) {
    assert.match(
      copyBoxPrompt(dom(this)),
      /https?:\/\/\S+/,
      "copyable prompt contains no URL",
    );
  },
);

Then("the URL should lead the agent to setup instructions", function (this: JollyWorld) {
  const prompt = copyBoxPrompt(dom(this));
  assert.match(
    prompt,
    /setup[\s-]?guide|setup instructions/i,
    "copyable prompt does not point the URL at setup instructions",
  );
});

Then(
  /^the copied content should tell the agent to read the setup guide, run Jolly via `npx`, use the Jolly CLI to install\/manage required skills, and then run `jolly start`$/,
  function (this: JollyWorld) {
    const prompt = copyBoxPrompt(dom(this));
    assert.match(prompt, /read/i, "prompt does not tell the agent to read the guide");
    assert.match(prompt, /setup[\s-]?guide/i, "prompt does not mention the setup guide");
    assert.match(prompt, /npx/, "prompt does not mention npx");
    assert.match(prompt, /skill/i, "prompt does not mention skills");
    assert.match(prompt, /jolly start/, "prompt does not mention `jolly start`");
  },
);

// --- Agent receives the copied setup instructions ---------------------------

Given(
  "the customer pasted the copied setup prompt into their agent",
  function (this: JollyWorld) {
    guide(this);
  },
);

When("the agent follows the instructions", function (this: JollyWorld) {
  // Context only: the agent reads the committed setup guide.
});

Then("the agent should give a brief welcome", function (this: JollyWorld) {
  assert.match(guide(this), /welcome/i, "setup guide does not instruct a welcome");
});

Then(
  "the agent should explain Jolly in one or two concise sentences",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /one or two .*sentences/i,
      "setup guide does not bound the Jolly explanation to one or two sentences",
    );
  },
);

Then(
  "the agent should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(text, /already (has|have) a Saleor store/i);
    assert.match(text, /register a Saleor store/i);
  },
);

Then(
  "the agent should know how to invoke the Jolly CLI via `npx` without requiring a prior global install",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(text, /npx/);
    assert.match(text, /global install/i);
  },
);

Then(
  "the agent should use the Jolly CLI to install and manage Saleor\\/Jolly skills so Jolly can handle version updates over time",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(
      text,
      /jolly skills install|skills .*(via|through) the Jolly CLI/i,
      "setup guide does not route skill management through the Jolly CLI",
    );
    assert.match(text, /updat/i, "setup guide does not mention skill updates over time");
  },
);

Then(
  "the agent should understand that it is the primary interface for Jolly workflows",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /primary (interface|orchestrator)/i,
      "setup guide does not establish the agent as the primary interface",
    );
  },
);

// --- Agent branches based on Saleor store status -----------------------------

Given("the agent has welcomed the customer", function (this: JollyWorld) {
  guide(this);
});

When("the agent asks about Saleor store status", function (this: JollyWorld) {
  // Context only.
});

Then(
  'the customer should be able to choose "I already have a Saleor store"',
  function (this: JollyWorld) {
    assert.ok(
      guide(this).includes("I already have a Saleor store"),
      'setup guide does not offer the choice "I already have a Saleor store"',
    );
  },
);

Then(
  'the customer should be able to choose "I want to register a Saleor store"',
  function (this: JollyWorld) {
    assert.ok(
      guide(this).includes("I want to register a Saleor store"),
      'setup guide does not offer the choice "I want to register a Saleor store"',
    );
  },
);

Then(
  "the agent should not proceed to storefront creation until this branch is known",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /(do )?not proceed to storefront creation/i,
      "setup guide does not gate storefront creation on the store-status branch",
    );
  },
);

// --- Jolly start completes successfully (@sandbox) ---------------------------

Given(
  "`jolly start` has completed the end-to-end setup flow",
  { timeout: 1_800_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["start", "--yes", "--json"], {
      timeoutMs: 1_740_000,
    });
    assert.equal(
      this.envelope.status === "error",
      false,
      `\`jolly start\` did not complete: ${result.stdout}\n${result.stderr}`,
    );
  },
);

When("Jolly prints the final success output", function (this: JollyWorld) {
  assert.ok(this.lastRun, "no `jolly start` output captured");
});

Then("it should include a concise human-readable summary", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.trim().length > 0, "envelope.summary is empty");
});

Then(
  "it should include machine-readable JSON or report data for the customer's agent on stdout",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "stdout carries no machine-readable envelope");
  },
);

Then("it should include key URLs and status values", function (this: JollyWorld) {
  const env = this.envelope;
  assert.match(
    JSON.stringify(env.data),
    /https?:\/\//,
    "envelope.data carries no URLs",
  );
  assert.ok(env.status, "envelope carries no status");
});

Then(
  "it should include final verification results from an automatic `jolly doctor` run",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.length > 0,
      "`jolly start` output carries no doctor verification checks",
    );
  },
);

Then(
  "it should include next-step guidance for customizing the storefront with the customer's own agent and workflow",
  function (this: JollyWorld) {
    const steps = this.envelope.nextSteps;
    assert.ok(steps.length > 0, "envelope.nextSteps is empty");
    assert.match(
      JSON.stringify(steps),
      /custom|iterat|agent/i,
      "nextSteps carry no customization/iteration guidance",
    );
  },
);

Then("it should avoid printing secret values", function (this: JollyWorld) {
  const run = this.lastRun!;
  this.assertNoSecretsIn(run.stdout + run.stderr, "`jolly start` output");
});
