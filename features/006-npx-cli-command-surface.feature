Feature: Npx-first Jolly CLI command surface
  As a customer's AI agent
  I want Jolly to be executable through `npx` with clear subcommands
  So that I can run setup workflows without requiring a prior global install

  Scenario: Agent starts the guided setup flow
    Given the customer wants the end-to-end guided Saleor storefront setup
    When the agent invokes the primary guided command
    Then `jolly start` should be available as optional convenience orchestration for the full end-to-end flow
    And the agent may instead invoke individual composable subcommands for each stage
    And the output should follow Jolly's hybrid human-readable plus machine-readable format

  Rule: CLI distribution principles
    - Jolly should make full use of subcommands rather than overloading one command.
    - `init`, `create`, `start`, `skills`, `deploy`, `doctor`, `upgrade`, `login`, `logout`, and `auth status` are expected command concepts.
    - All CLI commands should support `--json`.
    - All CLI commands should support `--quiet`.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - Side-effecting remote/action commands should support `--dry-run` for preview/no-side-effects mode.
    - Production package name should be `@saleor/jolly`.
    - Testing package name should be `@dk/jolly`.
