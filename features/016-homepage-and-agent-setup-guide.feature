Feature: Jolly homepage and agent setup guide
  As a customer who wants a Saleor storefront
  I want the Jolly homepage to give me a copyable agent prompt and clear setup guidance
  So that my own AI agent can start the Jolly flow without me reading a long manual first

  @logic
  Scenario: Customer sees the homepage hero
    Given the customer visits the Jolly homepage
    When the homepage loads
    Then it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront
    And the homepage tagline should read "Ahoy, agent. Go build a store."
    And it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor
    And the tagline should be concise, pirate-flavored, and tell the agent or human what to do next
    And it should make clear that the primary path starts by copying instructions into the customer's agent
    And it should set the expectation that setup takes minutes with minimal manual steps

  @logic
  Scenario: Customer copies the one-line agent prompt
    Given the customer is on the homepage
    When they view the primary copy box
    Then the copy box should say "copy this to your agent to get started"
    And the copy box should contain a single line of copyable text for the agent
    And the single line should be "Read https://jolly.cool/setup and follow the instructions to set up Jolly"
    And the setup guide at the linked URL should carry the full workflow and MCP server context

  @logic
  Scenario: Agent follows the SKILL.md-style setup guide
    Given the customer pasted the copied prompt into an agent
    When the agent opens or reads the setup guide
    Then the guide should be a single SKILL.md-style markdown file that the agent reads as instructions
    And it should tell the agent to invoke the Jolly CLI as the primary action
    And it should direct the agent to run `npx @saleor/jolly start` to begin the end-to-end setup
    And it should explain that the Jolly CLI automatically installs all Saleor agent skills (no separate optional install step)
    And it should mention the Saleor MCP server (mcp.saleor.app) for read-only live store data access after setup
    And it should list supported agent targets: generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev
    And it should show testing invocation examples using `npx @dk/jolly`
    And it should not list separate `jolly init` or `jolly skills install` as explicit agent steps — the CLI handles skill installation automatically

  @logic
  Scenario: Homepage explains the v1 journey
    Given the customer wants to understand what Jolly will do
    When they read the homepage
    Then the 4-item flow section below the hero should be the primary explanation
    And the flow should make clear that the agent drives everything — connect/create Saleor, deploy Paper, configure Stripe
    And the flow should set the expectation that only un-automatable steps (account creation, secret keys) need the human

  @logic
  Scenario: Homepage explains boundaries
    Given the customer is evaluating Jolly
    When they read the homepage
    Then it should not dwell on scope or boundaries in its own section — let the product speak for itself
    And boundaries and scope details belong in the setup guide at the linked URL, not on the homepage

  Rule: Homepage asset ownership
    - Approved homepage copy, visual style, and product/brand context live in `assets/homepage/` as durable Captain-authored source material.
    - `assets/homepage/copy.md` is the source of truth for all homepage text (tagline, copy-box prompt, flow cards, footer, agent labels, etc.).
    - `assets/homepage/style.md` is the source of truth for visual style (color palette, typography, effects, layout, component shapes).
    - `assets/homepage/context.md` is the source of truth for product/brand context (value proposition, target audience, supported environments).
    - `assets/homepage/setup.md` is the source of truth for the agent setup guide content (provenance, contacted hosts, prerequisites, human-required moments, version pinning, quick start, per-step verification, troubleshooting, boundaries).
    - `homepage/index.html` is implementation output that consumes `assets/homepage/*`. It is not the source of truth for approved content.
    - `homepage/setup.md` is implementation output that consumes `assets/homepage/setup.md`. It is not the source of truth for approved setup-guide content.
    - Quartermaster and Crew Mate may read `assets/**` but must not edit or delete it.

  Rule: Homepage visual and content design
    - Overall style: dark theme with neon/hacker aesthetic (cyberpunk-inspired like swamp.club) fused with heavy pirate/swashbuckling personality. The page should feel like a pirate radio station run by hackers.
    - Brand elements: Jolly Roger skull-and-crossbones as the primary logo/icon or mark; "XO" as a shorthand brand mark; pirate emoji (🏴‍☠️, ⚓, 🦜, 💀, 🔱) used as decorative/enumeration elements; gold/amber accent color alongside the neon green; CRT scan lines, treasure-map textures, and grid overlays welcome.
    - Hero: tagline ("Ahoy, agent. Go build a store.") in a bold, distinctive display font (e.g. Orbitron or similar) with a glow or glitch effect, and the prominent one-line copy box below it.
    - One-line agent prompt: "Read https://jolly.cool/setup and follow the instructions to set up Jolly" — inside a bordered code-style box with a copy button. Use a monospace/terminal font.
    - Below the hero: a concise, visually-driven summary of the v1 flow — exactly 4 short items with pirate emoji bullets and one line each. No wall of text.
      - ⚓ Agent connects or creates your Saleor store
      - 🔱 Agent deploys a Paper storefront to Vercel
      - 🏴‍☠️ Agent configures Stripe test checkout
      - 🦜 Working store in minutes — only account creation and secret keys need you
    - Supported agents: shown as small text badges/pills at the bottom of the hero area (generic, Zed, Claude Code, Cursor, OpenCode, Pi.dev). Lightweight — doesn't distract from the copy box.
    - The page should feel fun, memorable, and distinctive — like the homepage of an outlaw tool for agents, not a generic SaaS product.

  Rule: Setup guide (SKILL.md) content
    - The setup guide is a single SKILL.md-style markdown file, designed for agents to read as instructions (like moltbook.com/skill.md).
    - Its content derives from `assets/homepage/setup.md`; the derived guide must preserve that asset's sections (provenance, contacted hosts, prerequisites, human-required moments, quick start with dry-run-first, per-step verification, skills table, troubleshooting, idempotency, supported agents, boundaries).
    - It must tell the agent to invoke the Jolly CLI via `npx @saleor/jolly start` — the CLI handles everything, including automatically installing all Saleor agent skills.
    - Command examples in the guide pin an exact version (`npx @saleor/jolly@X.Y.Z start`) and tell the agent not to use `@latest` in automation; the version-pinned form satisfies any step that checks for the start command.
    - There is no separate optional skill-install step for the agent. All skills are installed by Jolly automatically.
    - The guide should mention the Saleor MCP server (mcp.saleor.app) for live store data access after setup.
    - The guide should list supported agent environments.
    - The guide should include a testing variant using `npx @dk/jolly start`.
    - The guide should not list separate `jolly init` or `jolly skills install` steps for the agent to follow — the `start` command orchestrates everything.
    - The canonical setup-guide URL is a placeholder until decided.

  Rule: Copy-box prompt requirements
    - The copy box must contain exactly one line of copyable text to paste into an agent.
    - The one line must be: "Read https://jolly.cool/setup and follow the instructions to set up Jolly".
    - The canonical URL is a placeholder; a removeable `canonical-url` or similar marker should let the team swap it before production launch.
    - Full workflow context, MCP server details, and agent guidance belong in the setup guide at the linked URL, not in the copy box.
    - A clickable copy button (📋 or similar icon) must appear next to the one-line prompt. Clicking it copies the prompt text to the clipboard. Must work in all evergreen browsers (Chrome, Firefox, Safari, Edge) without requiring Flash or a polyfill — use the standard `navigator.clipboard.writeText()` API.

  Rule: Open questions
    - Canonical homepage/setup-guide URL is deferred; specs should use a placeholder until decided.
    - Homepage implementation shape is left to the implementation agent: static page, small app, or generated docs page are acceptable if they satisfy the required single-page landing and setup-guide behavior.
    - The HIPP byte-for-byte reproducible-build verification flow is unresolved; `assets/homepage/setup.md` carries `[TODO: HIPP ...]` markers until the Captain specifies it. Derived guides omit the unresolved sections rather than inventing content for them.
