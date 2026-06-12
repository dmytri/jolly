Feature: Npx-first Jolly CLI command surface
  As a customer's AI agent
  I want Jolly to be executable through `npx` with clear subcommands
  So that I can run setup workflows without requiring a prior global install

  @logic
  Scenario: Npx execution does not require Bun
    Given a machine with Node.js available but no Bun on the PATH
    When the agent runs `jolly start --dry-run --json` through the published launcher
    Then the command should succeed using Node alone
    And stdout should carry the standard output envelope

  @logic
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
    - The package name is `@dk/jolly`, everywhere (decision 2026-06-12). Jolly is a
      tool by Dmytri Kleiner that helps agents set up a store quickly using Saleor,
      Vercel and Stripe; it is not an official product of any of those. No other
      package name (including any `@saleor/...` scope) may be mentioned in code,
      output, or docs — not as runnable, not as "future/official"; docs describe
      only what exists and can be run.
    - The published Jolly CLI is a Node.js program (decision 2026-06-12): the
      launcher (`bin/jolly`) runs under Node.js >= 23 (native type stripping) and
      never invokes or requires Bun. Bun is the project's development/test
      environment only, never a customer-facing requirement.
    - The published package's `engines` field must declare the Node.js requirement
      and must not require Bun.
    - On a Node.js older than the minimum, the launcher should fail with a clear
      message naming the minimum Node version, not a raw syntax or module error.
