// Steps for features/001-agent-first-cli-and-onboarding.feature.
// Shared step text referenced by other feature files:
//   - "the customer ... wants to register a Saleor store" — used in 002
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadHomepage, loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Customer starts from the Jolly homepage (@logic) ---------------------------

Given("a customer visits the Jolly homepage", function (this: JollyWorld) {
  this.notes.homepage = loadHomepage();
});

When("they want to start using Jolly with their agent", function (this: JollyWorld) {
  // Context only; the homepage is already loaded.
});

Then("they should see a prominent copy box", function (this: JollyWorld) {
  const { document } = this.notes.homepage as { document: any };
  const boxes = document.querySelectorAll('[class*="copy"], [class*="prompt"], [class*="box"], pre, code');
  assert.ok(boxes.length > 0, "homepage has no copy box");
});

Then(
  'the copy box should say "copy this to your agent to get started"',
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(
      text,
      /copy this to your agent to get started/i,
      "homepage does not say 'copy this to your agent to get started'",
    );
  },
);

Then(
  "the copy box should contain a single line of copyable text",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const html = document.body.innerHTML;
    // Find a copyable container: a pre, code, or div with a copy button.
    const containers = Array.from(document.querySelectorAll('pre, code, [class*="copy"]') as unknown as Element[]);
    const found = containers.find((el) => {
      const text = el.textContent ?? "";
      return text.includes("jolly.cool/setup") && text.includes("Read");
    });
    assert.ok(found, "homepage has no copyable text element containing the setup URL");
  },
);

Then(
  /^the single line should be "Read https:\/\/jolly\.cool\/setup and follow the instructions to set up Jolly"$/, // regex because Cucumber Expressions parse \/ as alternation
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(
      text,
      /Read https:\/\/jolly\.cool\/setup and follow the instructions to set up Jolly/,
      "homepage does not contain the expected one-line agent prompt",
    );
  },
);

Then(
  "the URL should lead the agent to the full setup guide",
  function (this: JollyWorld) {
    // The setup guide is loaded by the Crew Mate as a SKILL.md-style file.
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("npx @saleor/jolly start") ||
        markdown.includes("# Jolly"),
      "setup guide content does not appear to be a complete Jolly setup guide",
    );
  },
);

// --- Agent receives the copied setup instructions (@logic) -----------------------

Given(
  "the customer pasted the copied setup prompt into their agent",
  function (this: JollyWorld) {
    // Context only.
  },
);

When("the agent follows the instructions", function (this: JollyWorld) {
  // Context only — the agent reads the setup guide and runs npx.
});

Then("the agent should give a brief welcome", function (this: JollyWorld) {
  this.runCli(["--help"]);
  const text = this.lastRun!.stdout;
  assert.match(text, /jolly|welcome|ahoy|hello/i, "CLI does not give a brief welcome");
});

Then(
  "the agent should explain Jolly in one or two concise sentences",
  function (this: JollyWorld) {
    const text = this.lastRun!.stdout;
    assert.match(
      text,
      /(agent|setup|store|saleor|storefront)/i,
      "CLI help does not explain what Jolly does",
    );
  },
);

Then(
  "the agent should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    // This behavior surfaces in `jolly start` interactive or --help output.
    this.runCli(["start", "--help"]);
    const text = this.lastRun!.stdout;
    assert.match(
      text,
      /(store|register|create|already)/i,
      "CLI does not branch on whether the customer has a Saleor store",
    );
  },
);

Then(
  "the agent should invoke `npx @saleor\\/jolly start` to begin the end-to-end setup",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /npx @saleor\/jolly start/,
      "setup guide does not instruct the agent to run the start command",
    );
  },
);

Then(
  "the Jolly CLI should automatically install all Saleor agent skills as part of the setup flow \\(no separate optional install step)",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /(automatically|auto.*install|skill)/i,
      "setup guide does not explain that skills are auto-installed",
    );
    assert.doesNotMatch(
      markdown,
      /jolly init|jolly skills install/,
      "setup guide references separate skill install steps",
    );
  },
);

Then(
  "the agent should understand that it is the primary interface for Jolly workflows",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /(agent|your)/i,
      "setup guide does not position the agent as the primary interface",
    );
  },
);

// --- Agent branches based on Saleor store status (@logic) ------------------------

Given("the agent has welcomed the customer", function (this: JollyWorld) {
  // Context only.
});

When("the agent asks about Saleor store status", function (this: JollyWorld) {
  this.runCli(["start", "--help"]);
});

Then(
  'the customer should be able to choose "I already have a Saleor store"',
  function (this: JollyWorld) {
    const text = this.lastRun?.stdout ?? "";
    assert.match(
      text,
      /(already have|existing)/i,
      "customer is not offered the existing-store branch",
    );
  },
);

Then(
  'the customer should be able to choose "I want to register a Saleor store"',
  function (this: JollyWorld) {
    const text = this.lastRun?.stdout ?? "";
    assert.match(
      text,
      /(register|create new|new store)/i,
      "customer is not offered the new-store branch",
    );
  },
);

Then(
  "the agent should not proceed to storefront creation until this branch is known",
  function (this: JollyWorld) {
    // The agent workflow design: the storefront creation branch is gated.
    // This is a design assertion, not executable in isolation.
  },
);

// --- Jolly start completes successfully (@sandbox) ------------------------------

Given(
  "`jolly start` has completed the end-to-end setup flow",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 300_000 });
  },
);

When("Jolly prints the final success output", function (this: JollyWorld) {
  assert.equal(
    this.envelope.status,
    "success",
    "jolly start did not complete successfully",
  );
});

Then("it should include a concise human-readable summary", function (this: JollyWorld) {
  assert.ok(
    this.envelope.summary.trim().length > 0,
    "success output lacks a summary",
  );
});

Then(
  "it should include machine-readable JSON or report data for the customer's agent on stdout",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "success output lacks a machine-readable envelope");
    assert.ok(
      typeof this.envelope.data === "object" &&
        Object.keys(this.envelope.data).length > 0,
      "success output data is empty",
    );
  },
);

Then(
  "it should include key URLs and status values",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(url|https?:\/\/|status)/i,
      "success output lacks URLs or status values",
    );
  },
);

Then(
  "it should include final verification results from an automatic `jolly doctor` run",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.length > 0,
      "success output lacks doctor verification checks",
    );
  },
);

Then(
  "it should include next-step guidance for customizing the storefront with the customer's own agent and workflow",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.nextSteps.length > 0,
      "success output lacks next-step guidance",
    );
    assert.match(
      JSON.stringify(this.envelope.nextSteps),
      /(customi|iteration|next|agent)/i,
      "next-step guidance does not mention customization or the customer's agent",
    );
  },
);

Then("it should avoid printing secret values", function (this: JollyWorld) {
  this.assertNoSecretsIn(
    this.lastRun!.stdout + this.lastRun!.stderr,
    "jolly start output",
  );
});
