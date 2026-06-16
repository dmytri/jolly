Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  @logic @exceptional-double
  Scenario: Jolly login stores a token honestly when verification is unreachable
    Given the Saleor Cloud API is unreachable
    And the agent has a Saleor Cloud token value "jolly-login-test-token-abc"
    When the agent runs `jolly login --token jolly-login-test-token-abc`
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc
    And .gitignore should contain .env
    And Jolly should load the updated .env values for the current command flow
    And the envelope status should be "warning"
    And the output should state the token was stored, not verified
    And no check may report the token as verified
    And no organization name should be written to .env
    And subsequent `jolly auth status` should report the token is configured
    And Jolly should not print the token value

  @logic
  Scenario: Jolly login prepares browser OAuth authorization material
    Given the agent has no existing Saleor Cloud authentication
    When the agent runs `jolly login --browser --dry-run`
    Then Jolly should generate a PKCE code challenge and verifier
    And it should construct a Keycloak authorization URL at auth.saleor.io
    And the authorization URL should include response_type=code, client_id="saleor-cli", code_challenge, code_challenge_method=S256, state, redirect_uri, and scope="email openid profile"
    And the redirect_uri should point to 127.0.0.1:5375/callback

  @logic
  Scenario: Jolly login previews the OAuth code exchange requests
    Given Jolly receives an authorization code on the localhost callback
    When it previews the code exchange with `--dry-run`
    Then the preview should show a POST of the code, code_verifier, client_id="saleor-cli", and redirect_uri to the auth.saleor.io token endpoint
    And the preview should show a POST of the resulting OIDC id_token to the Cloud API /platform/api/tokens endpoint
    And the preview must not claim any exchange, verification, or login succeeded
    And no token should be written to .env

  @sandbox
  Scenario: A failed OAuth code exchange is reported honestly
    Given the agent has no existing Saleor Cloud authentication
    And Keycloak will reject the authorization code Jolly receives on the callback
    When the agent runs `jolly login --browser` and the loopback callback delivers the rejectable code
    Then Jolly should really POST the code to the auth.saleor.io token endpoint and the request should really fail
    And Jolly should emit an error envelope naming the step that failed
    And it should not write any value to .env
    And the output should contain no success, verified, or authenticated language

  @sandbox
  Scenario: Jolly login verifies a headless token against the Cloud API
    Given the agent provides a valid token from https://cloud.saleor.io/tokens
    When Jolly validates the token
    Then it should verify the token with an authenticated read-only request to the Cloud API organizations endpoint
    And it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION
    And it should report the authenticated organization context using values from the real response

  @sandbox
  Scenario: Jolly login rejects an invalid token gracefully
    Given the agent provides an invalid or expired token
    When Jolly validates the token against the Cloud API
    Then the verification request should really be sent and really be rejected
    And Jolly should report a clear error message
    And it should not write any value to .env
    And the output should contain no success, verified, or authenticated language
    And the error message should direct the customer to create a new token at https://cloud.saleor.io/tokens

  @logic
  Scenario: Jolly login presents the authorization URL and offers to open a browser
    Given the agent has no existing Saleor Cloud authentication
    When the agent runs `jolly login --browser --dry-run`
    Then the output should present the Keycloak authorization URL for the user to click or copy and paste
    And the output should state that Jolly opens the URL in a browser when one is available and otherwise leaves the user to open it manually
    And the output should not present a missing browser as an error
    And no token value should appear in the output

  @logic
  Scenario: Jolly login --browser never treats a missing browser as an error
    Given the agent has no existing Saleor Cloud authentication
    When the agent runs `jolly login --browser` where no browser can be opened
    Then the output should present the Keycloak authorization URL for the user to click or copy and paste
    And the output should report the loopback OAuth callback endpoint http://127.0.0.1:5375/callback where Jolly listens for the consent redirect
    And it should not present a missing browser as an error
    And it should direct the user to open the URL in a browser or use `jolly login --token <value>`
    And no token value should appear in the output
    And it should not write any value to .env

  @logic
  Scenario: Agent logs out
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token
    When the agent invokes `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN from .env
    And any non-JOLLY_ variable in .env should remain unchanged
    And it should load the updated `.env` values for the current command flow
    And the envelope status should be "success"

  @logic
  Scenario: Agent checks auth status
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token
    When it invokes `jolly auth status`
    Then Jolly should report whether Saleor Cloud authentication is configured
    And when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context
    And when no organization is stored, it should report the account context as unknown rather than failing
    And the output should not contain the token value
    And it should support `--json` and `--quiet`

  @logic
  Scenario: Jolly login --dry-run does not write to .env
    Given the agent has no existing .env file
    When the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`
    Then the output should include a risk context with action "login"
    And .env should not be created
    And the output should include a nextSteps array with at least one step

  @logic
  Scenario: Jolly logout removes only Jolly-managed auth values from .env
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me
    When the agent runs `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env
    And THIRD_PARTY_KEY should remain in .env unchanged
    And subsequent `jolly auth status` should report not authenticated

  Rule: Auth command principles
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` should support browser OAuth and headless token flows.
    - `jolly login` (and `jolly login --browser`) generate the Keycloak authorization URL, print it for the user to click or copy and paste, and start the localhost OAuth callback server (PKCE, callback server, callback, exchange). When a native browser is available, Jolly also opens the URL in it as a convenience; when it is not, the user opens the printed URL in any browser. Either way the user completes consent and Jolly receives the callback, exchanges the code, and stores the token.
    - A missing browser is never an error: the printed authorization URL is the always-available path, the same affordance the Vercel and Stripe CLIs provide for their own logins. `jolly login --token <value>` remains the fully non-interactive path that always works regardless of browser availability.
    - Native browser detection attempts the platform-appropriate open command (`open`/`xdg-open`/`start`); a successful (zero-exit) launch means a browser is available. It only decides whether Jolly auto-opens the URL — it is never required for login to proceed.
    - The registered Keycloak client is `saleor-cli` (realm `saleor-cloud` on auth.saleor.io). Jolly may use this client or register its own in future versions.
    - Jolly should not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets should be written to `.env` as environment variables in v1.
    - Successful login flows also store the authenticated organization name in `.env` as
      JOLLY_SALEOR_ORGANIZATION. It is non-secret account context, not a credential; it may
      appear in output, and `jolly auth status` reads it back so it can report account
      context without a network call. When it is absent, account context is reported as
      unknown — never an error. The stored value is always the organization name returned
      by the Cloud API — never a placeholder or invented label.

  Rule: Token verification is a real request or it is not verification
    - Token verification means one thing: an authenticated read-only
      GET of the Cloud API organizations endpoint
      (`https://cloud.saleor.io/platform/api/organizations/`, `Authorization: Token <value>`)
      whose response was actually received and checked. A 2xx response with a parseable
      organization list is verified; a 401/403 is an invalid token (error, nothing written);
      any other failure (network unreachable, 5xx, timeout) means verification did not
      happen.
    - When verification did not happen but the token was stored, every surface (summary,
      checks, data) must say "stored, not verified"; the envelope status is "warning" and
      the verification check status is "unknown" — never "pass".
    - `JOLLY_SALEOR_CLOUD_API_URL` optionally overrides the Cloud API base URL (default
      `https://cloud.saleor.io/platform/api`) for proxy or self-routing setups; all Cloud
      API requests honor it. Pointing it elsewhere is the customer's explicit choice.
    - The hosts `id.saleor.online` and `api.saleor.cloud` are retired and must not appear
      in Jolly code, output, or specs; the real first-party hosts are auth.saleor.io
      (Keycloak, realm saleor-cloud) and cloud.saleor.io (Cloud API and token page).
    - The OAuth code exchange makes real requests (Keycloak token endpoint, then Cloud
      API /platform/api/tokens) and reports their real outcomes. No placeholder tokens,
      simulated responses, or fabricated "verified" checks — if a step is unimplemented,
      Jolly errors naming the unimplemented step.

  Rule: Login credentials are one-time inputs, never persisted
    - Saleor Cloud email and password are one-time login inputs the user enters directly
      into their own browser during the OAuth consent. Jolly never sees, prompts for, holds,
      or persists them — not in memory, not to `.env`, not to any file, not in command output.
    - There are no Jolly environment variables for email or password; the durable
      artifact of every login flow is the Saleor Cloud token, stored in `.env` as
      JOLLY_SALEOR_CLOUD_TOKEN.
    - There is no headless browser automation and no harness email/password input; CI and
      headless environments authenticate with `jolly login --token <value>`.

  Rule: Browser OAuth is URL-first, like other CLIs
    - `jolly login` always prints the Keycloak authorization URL so the user can click it or copy and paste it into any browser — the same affordance the Vercel and Stripe CLIs provide for their own logins.
    - When a native browser is available (the `open`/`xdg-open`/`start` command exits zero), Jolly also opens the URL in it as a convenience; when it is not, Jolly prints the URL and leaves the user to open it. A missing browser is never an error.
    - Completing the consent in the browser is a human step; Jolly never automates it and never handles the user's credentials. Automated verification covers the authorization URL Jolly presents and the requests it makes (the `--dry-run` and exchange scenarios); the human consent round-trip is exercised manually, not in CI.
    - There is no headless browser automation and no harness email/password knobs; CI and headless environments authenticate with `jolly login --token <value>`.
