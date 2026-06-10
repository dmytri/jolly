Feature: Jolly create subcommands
  As a customer's AI agent
  I want `jolly create` to expose focused resource-specific subcommands
  So that I can create Saleor, storefront, and deployment resources intentionally instead of overloading one command

  Background:
    Given Jolly is executable via `npx`
    And `jolly start` is available as optional convenience orchestration for the full end-to-end flow

  Scenario: Agent discovers create subcommands
    Given the agent needs to create a specific resource
    When it inspects `jolly create --help`
    Then it should see focused subcommands
    And each subcommand should have a clear resource boundary
    And the help output should be understandable to both agents and humans

  Scenario: Agent composes create subcommands or uses start as convenience
    Given the customer wants the full end-to-end setup
    When the agent decides how to proceed
    Then the agent may invoke `jolly start` as a convenience wrapper for the full flow
    Or the agent may invoke individual `jolly create` subcommands at its own discretion
    And each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur

  Rule: Create command boundaries
    - `jolly create` should be a grouped command with subcommands.
    - `jolly start` is optional convenience orchestration for the full end-to-end path; agents may prefer composing individual subcommands.
    - Create subcommands should be safe, explicit, and scriptable.
    - Remote resource creation approval should be decided by the customer's agent based on risk, context, and customer/environment policies.
    - Each create subcommand should expose structured risk context per feature 021 so the agent can make that decision.
    - Create subcommands and `jolly start` should be idempotent and resumable per feature 022.

  Rule: V1 create subcommands
    - `jolly create store` for Saleor Cloud store/project/environment setup.
    - `jolly create storefront` for cloning/configuring Saleor Paper; it should propose `storefront` as the default target directory, handle name collisions safely, and allow confirmation or change before cloning.
    - `jolly create recipe` for preparing or applying the Jolly Configurator starter recipe.
    - `jolly create deployment` for Vercel deployment setup.
    - `jolly deploy` as a friendly top-level alias for deployment setup.

  Rule: Open questions
    - `jolly create store` is the v1 command name for Saleor Cloud store/project/environment setup.
    - Exact behavior differences, if any, between `jolly create deployment` and `jolly deploy` remain open.
