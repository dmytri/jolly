Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  @logic
  Scenario: Jolly login writes token values to .env
    Given the agent has a Saleor Cloud token value "jolly-login-test-token-abc"
    When the agent runs `jolly login --token jolly-login-test-token-abc`
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc
    And .gitignore should contain .env
    And Jolly should load the updated .env values for the current command flow
    And subsequent `jolly auth status` should report the token is configured
    And Jolly should not print the token value

  @sandbox
  Scenario: Agent logs in to Saleor Cloud with browser OAuth
    Given the agent needs Saleor Cloud authentication
    When it invokes `jolly login`
    Then Jolly should support browser OAuth authentication when available
    And Jolly should support a headless token flow when browser OAuth is unavailable or undesirable
    And Jolly should explain any required human browser or token steps

  @logic
  Scenario: Agent logs out
    Given Jolly has Saleor Cloud authentication state available
    When the agent invokes `jolly logout`
    Then Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable
    And it should not remove unrelated environment variables or third-party credentials without explicit intent
    And it should load the updated `.env` values for the current command flow where possible
    And it should report the result clearly

  @logic
  Scenario: Agent checks auth status
    Given the agent needs to know whether Saleor Cloud auth is available
    When it invokes `jolly auth status`
    Then Jolly should report whether Saleor Cloud authentication is configured
    And it should report the authenticated account or organization context where safe
    And it should avoid exposing secret token values
    And it should support `--json`, `--quiet`, and other global output flags

  @logic
  Scenario: Jolly login --dry-run does not write to .env
    Given the agent has no existing .env file
    When the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`
    Then the output should include a risk context with action "login"
    And .env should not be created
    And the output should include a nextSteps array with at least one step

  @logic
  Scenario: Jolly logout removes only Jolly-managed auth values from .env
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and THIRD_PARTY_KEY=keep-me
    When the agent runs `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN and JOLLY_SALEOR_APP_TOKEN from .env
    And THIRD_PARTY_KEY should remain in .env unchanged
    And subsequent `jolly auth status` should report not authenticated

  Rule: Auth command principles
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.`}]</parameterį     </invoke>  </tool_calls>  <block_info>Replying to edit call - the edit was successful</block_info>  <response>The edit was successful. Now let me also read the rest of the auth commands file to make sure everything is consistent, and add a dry-run scenario for login. </response>  <details>  <summary>Let me read the auth file again to understand the current state: </summary>  <tool_calls>  <invoke name=
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` should support browser OAuth and headless token flows.
    - Jolly should not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets should be written to `.env` as environment variables in v1.

  Rule: Open questions
    - Where should Jolly store non-secret auth state, if any?
    - Jolly workflow credentials should use `JOLLY_*` environment variable names, while Paper-required storefront variables should be written separately using Paper-compatible names.
