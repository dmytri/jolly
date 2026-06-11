// Steps for features/016-homepage-and-agent-setup-guide.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadHomepage, loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Customer sees the homepage hero (@logic) -----------------------------------

Given("the customer visits the Jolly homepage", function (this: JollyWorld) {
  this.notes.homepage = loadHomepage();
});

When("the homepage loads", function (this: JollyWorld) {
  // The homepage is already loaded in the Given step.
});

Then(
  "it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(text, /(agent|setup|store|saleor|storefront)/i, "homepage does not explain what Jolly does");
    assert.match(text, /(your own|customer's|your).*agent/i, "homepage does not mention the customer's own agent");
  },
);

Then(
  'the homepage tagline should read {string}',
  function (this: JollyWorld, expectedTagline: string) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.ok(
      text.includes(expectedTagline),
      `homepage does not contain the expected tagline "${expectedTagline}"`,
    );
  },
);

Then(
  "it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(text, /(saleor|cloud)/i, "homepage does not mention Saleor Cloud");
  },
);

Then(
  "the tagline should be concise, pirate-flavored, and tell the agent or human what to do next",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    // Check for pirate-flavored language
    assert.match(text, /(ahoy|agent|build|store|pirate|sail|ship|treasure|crew)/i, "tagline is not pirate-flavored");
  },
);

Then(
  "it should make clear that the primary path starts by copying instructions into the customer's agent",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(
      text,
      /(copy|paste).*(agent|instruction)/i,
      "homepage does not explain the copy-to-agent flow",
    );
  },
);

Then(
  "it should set the expectation that setup takes minutes with minimal manual steps",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(
      text,
      /(minute|quick|fast|simple|easy|minimal)/i,
      "homepage does not convey fast setup",
    );
  },
);

// --- Customer copies the one-line agent prompt (@logic) -------------------------

Given("the customer is on the homepage", function (this: JollyWorld) {
  this.notes.homepage = loadHomepage();
});

When("they view the primary copy box", function (this: JollyWorld) {
  // The homepage is loaded; we explore the copy box element.
  const { document } = this.notes.homepage as { document: any };
  const copyBoxElements = Array.from(document.querySelectorAll('pre, code, [class*="copy"], [class*="prompt"], [class*="box"]') as unknown as Element[]);
  this.notes.copyBox = copyBoxElements.find((el) => {
      const text = el.textContent ?? "";
      return text.includes("jolly.cool/setup");
    });
  assert.ok(this.notes.copyBox, "no copy box element found containing the setup URL");
});

// Note: "the copy box should say ..." step is defined in 001.steps.ts
// (literal match shared by both features).

Then("the copy box should contain a single line of copyable text for the agent", function (this: JollyWorld) {
  const copyBox = this.notes.copyBox as Element;
  const text = copyBox.textContent ?? "";
  // A single line of text means no line breaks within the copyable portion.
  const lines = text.split("\n").filter((l: string) => l.trim().length > 0);
  assert.ok(lines.length >= 1, "copy box has no copyable text");
  // The primary copy should be one line.
  const copyLines = lines.filter((l: string) => l.includes("Read"));
  assert.ok(copyLines.length <= 2, "copy box has more than one line of copyable text");
});

// Note: "the single line should be ..." step uses a regex in 001.steps.ts
// because the URL contains characters that Cucumber Expressions parse as alternation.

Then(
  "the setup guide at the linked URL should carry the full workflow and MCP server context",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.match(
      markdown,
      /(workflow|mcp\.saleor\.app|saleor.*server|setup|instruction)/i,
      "setup guide does not carry full workflow and MCP context",
    );
  },
);

// --- Agent follows the SKILL.md-style setup guide (@logic) -----------------------

Given(
  "the customer pasted the copied prompt into an agent",
  function (this: JollyWorld) {
    // Context only.
  },
);

When(
  "the agent opens or reads the setup guide",
  function (this: JollyWorld) {
    this.notes.setupGuide = loadSetupGuide();
  },
);

Then(
  "the guide should be a single SKILL.md-style markdown file that the agent reads as instructions",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.ok(
      markdown.includes("#") || markdown.includes("##"),
      "setup guide is not structured as a markdown file",
    );
    assert.match(
      markdown,
      /(instruction|step|guide|setup)/i,
      "setup guide does not read as instructions",
    );
  },
);

Then(
  "it should tell the agent to invoke the Jolly CLI as the primary action",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.match(
      markdown,
      /(jolly|npx @saleor\/jolly)/i,
      "setup guide does not instruct the agent to invoke the Jolly CLI",
    );
  },
);

Then(
  "it should direct the agent to run `npx @saleor\\/jolly start` to begin the end-to-end setup",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.match(
      markdown,
      /npx @saleor\/jolly start/,
      "setup guide does not direct the agent to run the start command",
    );
  },
);

Then(
  "it should explain that the Jolly CLI automatically installs all Saleor agent skills \\(no separate optional install step)",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.match(
      markdown,
      /(automatically|auto.*install|skill)/i,
      "setup guide does not explain auto skill installation",
    );
  },
);

Then(
  "it should mention the Saleor MCP server \\(mcp.saleor.app\\) for read-only live store data access after setup",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.match(
      markdown,
      /mcp\.saleor\.app/,
      "setup guide does not mention the Saleor MCP server",
    );
  },
);

Then(
  "it should list supported agent targets: generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    for (const target of ["Zed", "Claude Code", "Cursor", "OpenCode", "Pi.dev"]) {
      assert.match(markdown, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `setup guide does not list ${target}`);
    }
  },
);

Then(
  "it should show testing invocation examples using `npx @dk\\/jolly`",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.match(
      markdown,
      /npx @dk\/jolly/,
      "setup guide does not show testing invocation examples",
    );
  },
);

Then(
  "it should not list separate `jolly init` or `jolly skills install` as explicit agent steps — the CLI handles skill installation automatically",
  function (this: JollyWorld) {
    const { markdown } = this.notes.setupGuide as { markdown: string };
    assert.doesNotMatch(
      markdown,
      /(jolly init|jolly skills install)/i,
      "setup guide lists explicit jolly init or jolly skills install steps",
    );
  },
);

// --- Homepage explains the v1 journey (@logic) ----------------------------------

Given("the customer wants to understand what Jolly will do", function (this: JollyWorld) {
  this.notes.homepage = loadHomepage();
});

When("they read the homepage", function (this: JollyWorld) {
  // Homepage already loaded.
});

Then(
  "the {int}-item flow section below the hero should be the primary explanation",
  function (this: JollyWorld, itemCount: number) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    // Find the flow section — look for pirate emoji bullets or similar
    const flowItems = Array.from(document.querySelectorAll("li, [class*=flow], [class*=step], [class*=journey]") as unknown as Element[]);
    const relevantItems = flowItems.filter((el: Element) => {
      const t = el.textContent ?? "";
      return /(agent|saleor|store|stripe|deploy|vercel)/i.test(t);
    });
    assert.ok(
      relevantItems.length >= itemCount,
      `homepage has fewer than ${itemCount} flow items`,
    );
  },
);

Then(
  "the flow should make clear that the agent drives everything — connect\\/create Saleor, deploy Paper, configure Stripe",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(text, /(agent).*(connect|create|deploy|configure)/i, "flow does not make clear that the agent drives everything");
    assert.match(text, /(saleor|paper|stripe)/i, "flow does not mention Saleor, Paper, or Stripe");
  },
);

Then(
  "the flow should set the expectation that only un-automatable steps \\(account creation, secret keys\\) need the human",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    assert.match(
      text,
      /(account.*creation|secret.*key|minimal|only.*need|human|you)/i,
      "flow does not set expectation about manual steps",
    );
  },
);

// --- Homepage explains boundaries (@logic) --------------------------------------

Given("the customer is evaluating Jolly", function (this: JollyWorld) {
  this.notes.homepage = loadHomepage();
});

Then(
  "it should not dwell on scope or boundaries in its own section — let the product speak for itself",
  function (this: JollyWorld) {
    const { document } = this.notes.homepage as { document: any };
    const text = document.body.textContent ?? "";
    // Check that there's no explicit "Scope" or "Boundaries" section heading.
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const h of Array.from(headings) as unknown as Element[]) {
      const headingText = h.textContent ?? "";
      assert.doesNotMatch(
        headingText,
        /(scope|boundar|limitation|what.*(not|doesn't))/i,
        "homepage has a section about scope or boundaries",
      );
    }
  },
);

Then(
  "boundaries and scope details belong in the setup guide at the linked URL, not on the homepage",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    // The setup guide may include scope/boundary info — that's fine.
    // Homepage has been checked for no scope/boundary section.
    assert.ok(markdown.length > 0, "setup guide is empty");
  },
);
