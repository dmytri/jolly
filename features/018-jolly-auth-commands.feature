Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  Scenario: Agent logs in to Saleor Cloud
    Given the agent needs Saleor Cloud authentication
    When it invokes `jolly login`
    Then Jolly should support browser OAuth authentication when available
    And Jolly should support a headless token flow when browser OAuth is unavailable or undesirable
    And Jolly should explain any required human browser or token steps
    And Jolly should write acquired token values to `.env`
    And Jolly should ensure `.env` is ignored by Git before writing secrets
    And Jolly should load the updated `.env` values for the current command flow where possible
    And it should avoid printing secret token values

  Scenario: Agent logs out
    Given Jolly has Saleor Cloud authentication state available
    When the agent invokes `jolly logout`
    Then Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable
    And it should not remove unrelated environment variables or third-party credentials without explicit intent
    And it should load the updated `.env` values for the current command flow where possible
    And it should report the result clearly

  Scenario: Agent checks auth status
    Given the agent needs to know whether Saleor Cloud auth is available
    When it invokes `jolly auth status`
    Then Jolly should report whether Saleor Cloud authentication is configured
    And it should report the authenticated account or organization context where safe
    And it should avoid exposing secret token values
    And it should support `--json`, `--quiet`, and other global output flags

  Rule: Auth command principles
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` should support browser OAuth and headless token flows.
    - Jolly should not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets should be written to `.env` as environment variables in v1.

  Rule: Open questions
    - Where should Jolly store non-secret auth state, if any?
    - Jolly workflow credentials should use `JOLLY_*` environment variable names, while Paper-required storefront variables should be written separately using Paper-compatible names.
