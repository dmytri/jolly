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

  @logic
  Scenario: Jolly login constructs the browser OAuth authorization request
    Given the agent has no existing Saleor Cloud authentication
    When the agent initiates a browser OAuth login
    Then Jolly should generate a PKCE code challenge and verifier
    And it should construct a Keycloak authorization URL at auth.saleor.io
    And the authorization URL should include response_type=code, client_id="saleor-cli", code_challenge, code_challenge_method=S256, state, redirect_uri, and scope="email openid profile"
    And the redirect_uri should point to a localhost HTTP server
    And it should start a local HTTP server on port 5375 to receive the callback

  @logic
  Scenario: Jolly login exchanges the OAuth code for a Saleor Cloud token
    Given Jolly receives an authorization code on the localhost callback
    When it exchanges the code with the Keycloak token endpoint
    Then it should POST the code, code_verifier, client_id="saleor-cli", and redirect_uri
    And it should call POST /platform/api/tokens on the Cloud API with the OIDC id_token
    And it should store the resulting Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And it should verify the stored token via the id.saleor.online/verify endpoint

  @logic
  Scenario: Jolly login validates a headless token against the verify endpoint
    Given the agent provides a token from https://cloud.saleor.io/tokens
    When Jolly validates the token
    Then it should POST the token to https://id.saleor.online/configure for verification
    And if valid, it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And it should report the authenticated account or organization context

  @logic
  Scenario: Jolly login rejects an invalid token gracefully
    Given the agent provides an invalid or expired token
    When Jolly validates the token
    Then it should report a clear error message
    And it should not write any value to .env
    And the error message should direct the customer to create a new token at https://cloud.saleor.io/tokens

  @sandbox @requires-browser
  Scenario: Agent completes the full browser OAuth login flow
    Given the customer has a Saleor Cloud account and a browser available
    When the agent invokes `jolly login` and the customer completes the browser flow
    Then Jolly should complete the OAuth PKCE flow
    And it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And subsequent `jolly auth status` should report the token is configured

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
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` should support browser OAuth and headless token flows.
    - `jolly login` with no flags runs browser OAuth with a localhost callback server (port 5375). When the user's browser can reach the VM's localhost, the full flow completes automatically.
    - `jolly login --token <value>` is the headless/CI/VM fallback: when a browser or localhost callback is unavailable, instruct the user to create a token at cloud.saleor.io/tokens and pass it via --token.
    - If browser OAuth is invoked but the browser cannot be opened or the callback server is unreachable from the user's browser, output a clear message directing the user to use --token <value> with a token from cloud.saleor.io/tokens.
    - The registered Keycloak client is `saleor-cli` (realm `saleor-cloud` on auth.saleor.io). Jolly may use this client or register its own in future versions.
    - Jolly should not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets should be written to `.env` as environment variables in v1.

  Rule: Open questions
    - Where should Jolly store non-secret auth state, if any?
    - Jolly workflow credentials should use `JOLLY_*` environment variable names, while Paper-required storefront variables should be written separately using Paper-compatible names.

  Rule: Browser OAuth prerequisites
    - The full browser OAuth login flow (`@requires-browser`) requires a real browser on the same host as Jolly, or at least one that can reach Jolly's localhost callback server.
    - CI and headless VM runners should skip the browser OAuth end-to-end scenario and fall back to the `--token <value>` headless flow.
    - The `@requires-browser` tag is a hint to the test harness that this scenario needs interactive browser capabilities beyond standard sandbox credentials.
