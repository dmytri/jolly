Feature: Jolly create subcommands
  As a customer's AI agent
  I want `jolly create` to expose focused resource-specific subcommands
  So that I can create Saleor, storefront, and deployment resources intentionally instead of overloading one command

  Background:
    Given Jolly is executable via `npx`
    And `jolly start` orchestrates the full end-to-end guided flow

  Scenario: Agent discovers create subcommands
    Given the agent needs to create a specific resource
    When it inspects `jolly create --help`
    Then it should see focused subcommands
    And each subcommand should have a clear resource boundary
    And the help output should be understandable to both agents and humans

  Scenario: Start orchestrates create subcommands
    Given the customer wants the full end-to-end setup
    When the agent invokes `jolly start`
    Then Jolly may orchestrate `jolly create` subcommands internally or recommend them as next actions
    And each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur

  Rule: Create command boundaries
    - `jolly create` should be a grouped command with subcommands.
    - `jolly start` should orchestrate the full end-to-end path.
    - Create subcommands should be safe, explicit, and scriptable.
    - Remote resource creation approval should be decided by the customer's agent based on risk, context, and customer/environment policies.

  Rule: V1 create subcommands
    - `jolly create store` for Saleor Cloud store/project/environment setup.
    - `jolly create storefront` for cloning/configuring Saleor Paper; it should propose `storefront` as the default target directory, handle name collisions safely, and allow confirmation or change before cloning.
    - `jolly create recipe` for preparing or applying the Jolly Configurator starter recipe.
    - `jolly create deployment` for Vercel deployment setup.
    - `jolly deploy` as a friendly top-level alias for deployment setup.

  Rule: Open questions
    - `jolly create store` is the v1 command name for Saleor Cloud store/project/environment setup.
    - Exact behavior differences, if any, between `jolly create deployment` and `jolly deploy` remain open.
