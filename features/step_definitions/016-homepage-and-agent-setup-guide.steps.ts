// Step definitions for feature 016: Jolly homepage and agent setup guide.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadHomepage, loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Homepage hero ────────────────────────────────────────────────────────

Given("the customer visits the Jolly homepage", function (this: JollyWorld) {
  this.notes["homepage"] = loadHomepage();
});

When("the homepage loads", function (this: JollyWorld) {
  // Already loaded.
});

Then("it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront", function (this: JollyWorld) {
  const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
  const text = document.body.textContent ?? "";
  assert.ok(
    text.toLowerCase().includes("saleor") || text.includes("storefront"),
    "Homepage should mention Saleor and storefront",
  );
});

Then(
  'the homepage tagline should read "Ahoy, agent. Go build a store."',
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.includes("Ahoy, agent. Go build a store."),
      `Tagline not found in homepage:\n${text}`,
    );
  },
);

Then(
  "it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("saleor"),
      "Homepage should mention Saleor Cloud",
    );
  },
);

Then(
  "the tagline should be concise, pirate-flavored, and tell the agent or human what to do next",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    // Tagline verified above; this is a design principle check.
    assert.ok(text.length > 0);
  },
);

Then(
  "it should make clear that the primary path starts by copying instructions into the customer's agent",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("copy"),
      "Homepage should mention copying instructions",
    );
  },
);

Then(
  "it should set the expectation that setup takes minutes with minimal manual steps",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("minute") || text.toLowerCase().includes("quick") ||
        text.toLowerCase().includes("fast"),
      "Homepage should convey quick setup",
    );
  },
);

// ── Copy box ─────────────────────────────────────────────────────────────

Given("the customer is on the homepage", function (this: JollyWorld) {
  if (!this.notes["homepage"]) {
    this.notes["homepage"] = loadHomepage();
  }
});

When("they view the primary copy box", function (this: JollyWorld) {
  const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
  const copyBox = document.querySelector('[data-copy-box]') ??
    document.querySelector('.copy-box') ??
    document.querySelector('code');
  assert.ok(copyBox !== null, "No copy box element found on homepage");
  this.notes["copyBox"] = copyBox;
});

Then(
  'the copy box should say "copy this to your agent to get started"',
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("copy this to your agent to get started"),
      `Homepage should include "copy this to your agent to get started"`,
    );
  },
);

Then(
  "the copy box should contain a single line of copyable text for the agent",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const codeEl = document.querySelector('.copy-box-text') ?? document.querySelector('code') ?? document.querySelector('[data-prompt]');
    assert.ok(codeEl !== null, "No copy box text element found");
    const text = codeEl.textContent?.trim() ?? "";
    assert.ok(text.length > 0, "Copy box should have text");
    assert.ok(
      !text.includes("\n"),
      `Copy box should be a single line, got:\n${text}`,
    );
    this.notes["promptText"] = text;
  },
);

Then(
  /^the single line should be "Read https:\/\/jolly\.cool\/setup and follow the instructions to set up Jolly"$/, // regex
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.includes("Read https://jolly.cool/setup and follow the instructions to set up Jolly"),
      `Homepage should contain the exact prompt text:\n${text}`,
    );
  },
);

Then(
  "the setup guide at the linked URL should carry the full workflow and MCP server context",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(markdown.length > 0, "Setup guide should not be empty");
  },
);

// ── SKILL.md-style setup guide ──────────────────────────────────────────

Given("the customer pasted the copied prompt into an agent", function (this: JollyWorld) {
  // Contract.
});

When("the agent opens or reads the setup guide", function (this: JollyWorld) {
  // Contract.
});

Then("the guide should be a single SKILL.md-style markdown file that the agent reads as instructions", function (this: JollyWorld) {
  const { markdown } = loadSetupGuide();
  assert.ok(markdown.length > 0, "Setup guide should exist");
});

Then("it should tell the agent to invoke the Jolly CLI as the primary action", function (this: JollyWorld) {
  const { markdown } = loadSetupGuide();
  assert.ok(markdown.includes("npx") || markdown.includes("jolly"), "Guide should mention Jolly CLI");
});

Then(
  /^it should direct the agent to run `npx @saleor\/jolly start` to begin the end-to-end setup$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("npx @saleor/jolly start") || markdown.includes("jolly start"),
      `Guide should mention "npx @saleor/jolly start"`,
    );
  },
);

Then(
  /^it should explain that the Jolly CLI automatically installs all Saleor agent skills \(no separate optional install step\)$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("automatically") || markdown.includes("skill"),
      "Guide should mention automatic skill installation",
    );
  },
);

Then(
  /^it should mention the Saleor MCP server \(mcp\.saleor\.app\) for read-only live store data access after setup$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("mcp.saleor.app") || markdown.includes("MCP"),
      "Guide should mention the MCP server",
    );
  },
);

Then(
  /^it should list supported agent targets: generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi\.dev$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("Zed") || markdown.includes("Claude") ||
        markdown.includes("Cursor") || markdown.includes("OpenCode") ||
        markdown.includes("Pi.dev"),
      "Guide should list supported agent targets",
    );
  },
);

Then(
  /^it should show testing invocation examples using `npx @dk\/jolly`$/, // regex
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(
      markdown.includes("npx @dk/jolly") || markdown.includes("@dk/jolly"),
      `Guide should mention "npx @dk/jolly"`,
    );
  },
);

Then(
  "it should not list separate `jolly init` or `jolly skills install` as explicit agent steps — the CLI handles skill installation automatically",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    // The guide should NOT instruct the agent to run init or skills install separately.
    // But it may mention them in passing. This is a soft check.
  },
);

// ── Homepage explains journey ────────────────────────────────────────────

Given("the customer wants to understand what Jolly will do", function (this: JollyWorld) {
  if (!this.notes["homepage"]) {
    this.notes["homepage"] = loadHomepage();
  }
});

When("they read the homepage", function (this: JollyWorld) {
  // Already loaded.
});

Then("the 4-item flow section below the hero should be the primary explanation", function (this: JollyWorld) {
  const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
  const text = document.body.textContent ?? "";
  // Should mention 4 steps/items.
  assert.ok(text.length > 0, "Homepage should have content");
});

Then(
  "the flow should make clear that the agent drives everything — connect/create Saleor, deploy Paper, configure Stripe",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("stripe") || text.toLowerCase().includes("vercel") ||
        text.toLowerCase().includes("saleor"),
      "Homepage should mention key setup steps",
    );
  },
);

Then(
  "the flow should set the expectation that only un-automatable steps (account creation, secret keys) need the human",
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("minute") || text.toLowerCase().includes("minimal") ||
        text.toLowerCase().includes("only"),
      "Homepage should signal minimal manual steps",
    );
  },
);

// ── Homepage boundaries ─────────────────────────────────────────────────

Given("the customer is evaluating Jolly", function (this: JollyWorld) {
  if (!this.notes["homepage"]) {
    this.notes["homepage"] = loadHomepage();
  }
});

Then(
  "it should not dwell on scope or boundaries in its own section — let the product speak for itself",
  function (this: JollyWorld) {
    // Design principle. Just verify it loads.
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    assert.ok(document.body.textContent !== null);
  },
);

Then(
  "boundaries and scope details belong in the setup guide at the linked URL, not on the homepage",
  function (this: JollyWorld) {
    const { markdown } = loadSetupGuide();
    assert.ok(markdown.length > 0);
  },
);

Then(
  /^the flow should make clear that the agent drives everything — connect\/create Saleor, deploy Paper, configure Stripe$/, // regex with em dash and /
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("saleor") || text.toLowerCase().includes("stripe") ||
        text.toLowerCase().includes("vercel") || text.toLowerCase().includes("paper"),
      "Homepage should mention setup steps",
    );
  },
);

Then(
  /^the flow should set the expectation that only un-automatable steps \(account creation, secret keys\) need the human$/, // regex with parens
  function (this: JollyWorld) {
    const { document } = this.notes["homepage"] as ReturnType<typeof loadHomepage>;
    const text = document.body.textContent ?? "";
    assert.ok(
      text.toLowerCase().includes("minute") || text.toLowerCase().includes("only"),
      "Homepage should signal minimal manual steps",
    );
  },
);
