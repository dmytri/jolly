Feature: Jolly iteration phase support
  As a customer with a working Saleor storefront
  I want Jolly to support my agent as I customize and maintain my commerce experience
  So that I can iterate on my store without needing to re-run setup or lose what Jolly configured

  Background:
    Given `jolly init` has completed
    And a deployed storefront URL in .env

  @sandbox
  Scenario: Agent has live store access from day one
    Given jolly init has completed
    When the agent runs a products query through mcp-graphql
    Then jolly init should have written an mcp-graphql config pointing to the customer's Saleor GraphQL endpoint
    And the config should send the `Authorization: Bearer ${SALEOR_TOKEN}` header
    And the `.mcp.json` saleor-graphql entry should target the customer's Saleor GraphQL endpoint with the `${SALEOR_TOKEN}` Bearer header
    And because the MCP server captures `SALEOR_TOKEN` at spawn, recovery from a `401` is to refresh the token and reload the MCP server

  @logic
  Scenario: Agent runs ongoing health checks
    Given the storefront has been deployed
    When the agent runs `jolly doctor --json`
    Then `jolly doctor` should make no local or remote changes
    And jolly doctor should detect configuration drift, missing env vars, and connectivity problems
    And it should report actionable next steps for any issues found
    And it should support --json for structured output the agent can parse

  @logic
  Scenario: Agent upgrades Jolly-managed assets
    Given skills or agent guidance may become outdated over time
    When the agent runs `jolly upgrade --json`
    Then the envelope should report the updated skills and guidance
    And Jolly should report what changed and what the agent should review
    And Jolly should not automatically apply Paper storefront migrations in v1
    And it should generate an upgrade plan for Paper changes and present it to the agent

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
