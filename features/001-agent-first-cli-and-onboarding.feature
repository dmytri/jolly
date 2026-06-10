Feature: Agent-first Jolly onboarding and CLI
  As a developer using an AI agent
  I want Jolly to give my agent clear setup instructions and agent-oriented CLI tools
  So that my agent can scaffold, inspect, and operate a Saleor storefront project effectively

  Background:
    Given Jolly is positioned as "Saleor's Hydrogen for the agentic age"
    And Jolly helps the customer's own agent set up a fully operational end-to-end commerce experience on Saleor Cloud
    And Jolly depends on Saleor Cloud, Saleor's published Dashboard, and Saleor's public APIs rather than adding Saleor backend functionality
    And AI agents and agent skills are the primary users of the CLI
    And human developer experience should be decent but secondary
    And Jolly may reference Saleor's old CLI for undocumented registration/setup examples only
    And the old Saleor CLI should be treated as deprecated
    And Jolly must not depend on the Saleor CLI
    And Jolly should directly use or integrate with `saleor/configurator` where appropriate
    And Jolly should use or draw upon `saleor/agent-skills` and `saleor/storefront` agent instructions

  Scenario: Customer starts from the Jolly homepage
    Given a customer visits the Jolly homepage
    When they want to start using Jolly with their agent
    Then they should see a prominent copy box
    And the copy box should say "copy this to your agent to get started"
    And the copied content should include a URL to Jolly's homepage
    And the URL should lead the agent to setup instructions
    And the copied content should tell the agent to read the setup guide, run Jolly via `npx`, use the Jolly CLI to install/manage required skills, and then run `jolly start`

  Scenario: Agent receives the copied setup instructions
    Given the customer pasted the copied setup prompt into their agent
    When the agent follows the instructions
    Then the agent should give a brief welcome
    And the agent should explain Jolly in one or two concise sentences
    And the agent should ask whether the customer already has a Saleor store or wants to register one
    And the agent should know how to invoke the Jolly CLI via `npx` without requiring a prior global install
    And the agent should use the Jolly CLI to install and manage Saleor/Jolly skills so Jolly can handle version updates over time
    And the agent should understand that it is the primary interface for Jolly workflows

  Scenario: Agent branches based on Saleor store status
    Given the agent has welcomed the customer
    When the agent asks about Saleor store status
    Then the customer should be able to choose "I already have a Saleor store"
    Or the customer should be able to choose "I want to register a Saleor store"
    And the agent should not proceed to storefront creation until this branch is known

  Scenario: Agent uses the Jolly CLI
    Given the agent has access to the Jolly CLI
    When the agent invokes `jolly start`
    Then the command should begin the guided end-to-end setup flow
    And the command should support a hybrid interaction model
    And the default behavior should be agent-friendly and structured enough for an agent to orchestrate
    And a human-friendly interactive mode should be available
    And failures should include actionable next steps
    And commands should avoid interactive-only flows unless explicitly requested
    And human-readable output should still be understandable for developers

  Scenario: Jolly start completes successfully
    Given `jolly start` has completed the end-to-end setup flow
    When Jolly prints the final success output
    Then it should include a concise human-readable summary
    And it should include machine-readable JSON or report data for the customer's agent on stdout
    And persistent report files should remain deferred with the broader project-local artifacts decision
    And it should include key URLs and status values
    And it should include final verification results from an automatic `jolly doctor` run
    And it should include next-step guidance for customizing the storefront with the customer's own agent and workflow
    And it should avoid printing secret values

  Scenario: Jolly learns from Saleor CLI without depending on it
    Given Saleor has an existing CLI
    When designing Jolly CLI behavior
    Then Saleor CLI examples may be consulted for patterns and domain expectations
    But Jolly should not import, wrap, shell out to, or require the Saleor CLI as a runtime dependency

  Rule: Product principles
    - Agent-first, human-usable.
    - Setup should be copy/paste friendly.
    - CLI output should favor deterministic, structured, actionable responses.
    - Default CLI output should combine concise human-readable text with machine-readable JSON blocks or artifacts.
    - All CLI commands should support `--json` for machine-readable output.
    - All CLI commands should support `--quiet` for reduced output.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - `jolly start` should run `jolly doctor` automatically at the end for final verification.
    - Final `jolly start` success output should include a concise summary, structured stdout data/report, key URLs/statuses, final doctor verification results, next-step agent guidance, and no secret values.
    - Persistent report files remain deferred with the broader `.jolly/` or project-local artifacts decision.
    - Jolly should be executable via `npx` without requiring a prior global install.
    - `jolly start` should be hybrid: agent-friendly by default, with a human-friendly interactive mode available.
    - Jolly should make full use of subcommands, including `init`, `create`, and `start` concepts.
    - Agent instructions and skills are part of the product experience, not afterthought documentation.
    - Skill installation and updates should be mediated through the Jolly CLI rather than only manual `npx skills add` instructions.
    - Skill commands should include `jolly skills install` and `jolly skills update`; `jolly start` may call or check them automatically.
    - Skill installation should be hybrid: use standard project-local skills where possible, plus agent-specific glue/instructions for supported environments.
    - `jolly init` should initialize local agent setup by installing/checking skills and writing agent guidance, without remote Saleor/Vercel actions or secrets.
    - Setup instructions should support generic agents plus Zed, Claude Code, Cursor, OpenCode, and Pi.dev first.
    - Jolly should feel like a modern Saleor storefront accelerator rather than a generic CLI wrapper.
    - Jolly should leverage Saleor's official `saleor/storefront` Paper template as a baseline where appropriate instead of inventing a separate storefront foundation.

  Rule: Open questions
    - `jolly start` is the first top-level guided command for the end-to-end setup flow.
    - Jolly should expose an npx-first command surface with subcommands such as `init`, `create`, and `start`; production invocation should use `npx @saleor/jolly ...` and testing invocation should use `npx @dk/jolly ...`.
    - Should Jolly create project-local durable artifacts such as `.jolly/` reports or state? This is deferred until CLI design.
    - Homepage v1 should be a single-page landing plus agent setup guide: hero, copy box, quick explanation, supported agents, and CLI install/start instructions.
    - `jolly skills install` should install the full Saleor skill set by default: `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, `saleor-app`, and Paper's embedded `saleor-paper-storefront` skill when a storefront exists.
    - Generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev should be supported first; exact per-environment setup steps remain open.
    - Exact JSON block/artifact schema for CLI output is still open.
    - What parts of swamp.club are inspirational beyond the currently observed patterns?

  Rule: Swamp.club-inspired patterns to evaluate
    - Agent-operated framework positioning: Swamp describes itself as automation designed to be operated by AI agents.
    - Copyable install/onboarding command on the homepage.
    - Clear building blocks that agents can reason about, such as models, workflows, data, vaults, extensions, and reports.
    - Repo initialization that helps an agent discover framework conventions.
    - Agent-created durable artifacts rather than one-off chat instructions.
    - Reviewable workflow/config files before execution.
    - Structured outputs in Markdown plus JSON.
    - Doctor/troubleshooting commands with text and JSON output shapes.
    - Local-first/open-source positioning.
    - Human approval gates for risky workflows.
