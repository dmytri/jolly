Feature: Npx-first Jolly CLI command surface
  As a customer's AI agent
  I want Jolly to be executable through `npx` with clear subcommands
  So that I can run setup workflows without requiring a prior global install

  Background:
    Given Jolly is an agent-first CLI
    And human developer experience should remain decent

  Scenario: Agent invokes Jolly without global installation
    Given the customer has copied the Jolly setup prompt into their agent
    When the agent needs to run Jolly
    Then it should be able to execute Jolly via `npx`
    And the command should not require a prior global install
    And the command should work well in fresh project contexts

  Scenario: Agent uses npx subcommands
    Given the agent can execute Jolly through `npx`
    When it needs to perform a specific Jolly workflow
    Then Jolly should expose clear subcommands
    And the command surface should include `init`, `create`, and `start` concepts
    And the command names should be designed for agent readability and scriptability

  Scenario: Agent starts the guided setup flow
    Given the customer wants the end-to-end guided Saleor storefront setup
    When the agent invokes the primary guided command
    Then `jolly start` should remain the first top-level guided flow
    And the npx invocation should support that guided flow
    And the output should follow Jolly's hybrid human-readable plus machine-readable format

  Rule: CLI distribution principles
    - Jolly should be executable via `npx`.
    - Jolly should make full use of subcommands rather than overloading one command.
    - `init`, `create`, `start`, `skills`, `deploy`, `doctor`, `upgrade`, `login`, `logout`, and `auth status` are expected command concepts.
    - Commands should be agent-friendly, scriptable, and still understandable for humans.
    - All CLI commands should support `--json`.
    - All CLI commands should support `--quiet`.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - Side-effecting remote/action commands should support `--dry-run` for preview/no-side-effects mode.
    - Production package name should be `@saleor/jolly`.
    - Testing package name should be `@dk/jolly`.

  Rule: Open questions
    - Production npx invocation should use `npx @saleor/jolly ...`; testing invocation should use `npx @dk/jolly ...`.
    - `jolly init` should initialize local agent setup by installing/checking skills and writing agent guidance, without remote Saleor/Vercel actions or secrets.
    - `jolly create` should be a grouped command with subcommands for specific resources, while `jolly start` orchestrates the full end-to-end flow.
    - Skill management should use `jolly skills install` and `jolly skills update`; default install includes `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, `saleor-app`, and Paper's embedded skill when available.
