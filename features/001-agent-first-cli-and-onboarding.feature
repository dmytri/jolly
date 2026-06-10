Feature: Agent-first Jolly onboarding and CLI
  As a developer using an AI agent
  I want Jolly to give my agent clear setup instructions and agent-oriented CLI tools
  So that my agent can scaffold, inspect, and operate a Saleor storefront project effectively

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
    And the customer should be able to choose "I want to register a Saleor store"
    And the agent should not proceed to storefront creation until this branch is known

  Scenario: Jolly start completes successfully
    Given `jolly start` has completed the end-to-end setup flow
    When Jolly prints the final success output
    Then it should include a concise human-readable summary
    And it should include machine-readable JSON or report data for the customer's agent on stdout
    And it should include key URLs and status values
    And it should include final verification results from an automatic `jolly doctor` run
    And it should include next-step guidance for customizing the storefront with the customer's own agent and workflow
    And it should avoid printing secret values

  Rule: Product principles
    - Jolly should inform the agent about the Saleor MCP server (mcp.saleor.app) during `jolly init` and in the setup guide. The MCP server is read-only and useful for querying live store data after setup is complete.
    - `jolly init` should write an mcp-graphql config for the agent's environment so the agent has live store access from day one after setup.
    - The path from homepage copy to working deployed storefront must minimize human intervention. Only browser OAuth consent, new account creation, and secret values require human action; everything else should be automated with safe defaults.
    - Jolly should never ask for information it can infer, detect, or safely default. Confirmation steps are only warranted for irreversible or destructive actions.
    - CLI output should favor deterministic, structured, actionable responses.
    - Default CLI output should combine concise human-readable text with machine-readable JSON blocks or artifacts.
    - All CLI commands should support `--json` for machine-readable output.
    - All CLI commands should support `--quiet` for reduced output.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - `jolly start` should run `jolly doctor` automatically at the end for final verification.
    - Final `jolly start` success output should include a concise summary, structured stdout data/report, key URLs/statuses, final doctor verification results, next-step agent guidance, and no secret values.
    - `jolly start` should be hybrid: agent-friendly by default, with a human-friendly interactive mode available.
    - Jolly should make full use of subcommands, including `init`, `create`, and `start` concepts.
    - Agent instructions and skills are part of the product experience, not afterthought documentation.
    - Skill installation and updates should be mediated through the Jolly CLI rather than only manual `npx skills add` instructions.
    - Skill commands should include `jolly skills install` and `jolly skills update`; `jolly start` may call or check them automatically.
    - Skill installation should be hybrid: use standard project-local skills where possible, plus agent-specific glue/instructions for supported environments.
    - `jolly init` should initialize local agent setup by installing/checking skills and writing agent guidance, without remote Saleor/Vercel actions or secrets.
    - Setup instructions should support generic agents plus Zed, Claude Code, Cursor, OpenCode, and Pi.dev first.

  Rule: Open questions
    - Should Jolly create project-local durable artifacts such as `.jolly/` reports or state? This is deferred until CLI design.
    - `jolly skills install` should install the full Saleor skill set by default: `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, `saleor-app`, and Paper's embedded `saleor-paper-storefront` skill when a storefront exists.
    - Generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev should be supported first; exact per-environment setup steps remain open.
    - The CLI output envelope schema is defined in feature 020; remaining field-naming and schema-versioning details are deferred there.
