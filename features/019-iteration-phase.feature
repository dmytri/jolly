Feature: Jolly iteration phase support
  As a customer with a working Saleor storefront
  I want Jolly to support my agent as I customize and maintain my commerce experience
  So that I can iterate on my store without needing to re-run setup or lose what Jolly configured

  Background:
    Given the customer has completed Jolly setup and has a working deployed storefront
    And the customer's agent is the primary interface for all ongoing commerce work
    And Jolly's role in the iteration phase is diagnostics, tooling config, and update management

  Scenario: Agent has live store access from day one
    Given jolly init has completed
    When the agent needs to query or modify the live Saleor store
    Then jolly init should have written an mcp-graphql config pointing to the customer's Saleor GraphQL endpoint
    And the config should use the stored app token
    And the agent should be able to query products, orders, channels, and store configuration through mcp-graphql
    And the agent should be able to make mutations through mcp-graphql where the app token permissions allow

  Scenario: Agent customizes the storefront codebase
    Given the storefront is running
    When the customer wants to change storefront appearance, content, or behaviour
    Then the agent should use the Paper skill installed by jolly init to understand the codebase
    And Jolly should not be required for routine storefront code changes
    And the agent should propose, review, and apply changes independently using its own tools

  Scenario: Agent runs ongoing health checks
    Given the storefront has been deployed
    When the customer or agent wants to verify everything is working correctly
    Then the agent should run jolly doctor at any time without side effects
    And jolly doctor should detect configuration drift, missing env vars, and connectivity problems
    And it should report actionable next steps for any issues found
    And it should support --json for structured output the agent can parse

  Scenario: Agent upgrades Jolly-managed assets
    Given skills or agent guidance may become outdated over time
    When the agent wants to keep the project current
    Then it should run jolly upgrade to update Jolly-managed skills and agent guidance
    And Jolly should report what changed and what the agent should review
    And Jolly should not automatically apply Paper storefront migrations in v1
    And it should generate an upgrade plan for Paper changes and present it to the agent

  Scenario: Agent adds or reconfigures integrations
    Given the customer wants to add a new integration or change configuration
    When the agent needs to update Saleor configuration
    Then it should be able to run jolly create recipe or invoke Configurator directly
    And it should use jolly doctor to verify the integration is working after changes
    And it should use jolly auth if credentials need to be refreshed

  Rule: Iteration phase principles
    - The customer's agent owns all post-setup customization; Jolly is a support layer, not a gatekeeper.
    - Jolly does not need to be involved in routine storefront code edits.
    - jolly init must write mcp-graphql config so the agent has live store access from the moment setup completes.
    - jolly doctor must be safe to run at any time without side effects.
    - The iteration phase is the primary long-term value loop: running store plus agent plus Jolly diagnostics plus skills.
    - All iteration-phase Jolly commands must support --json, --quiet, and --dry-run where applicable.
    - Jolly should make it easy for the agent to understand what has changed and what to do next.
    - Paper storefront migrations should be planned but not auto-applied in v1.

  Rule: Open questions
    - What mcp-graphql config format should jolly init write for each supported agent environment?
    - Should jolly doctor offer a --watch mode for continuous monitoring in v1 or defer to v2?
    - What is the right upgrade cadence signal — should jolly doctor warn when skills are outdated?
