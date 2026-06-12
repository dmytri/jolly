Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  @logic
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
    Given Jolly receives an authorization code that Keycloak will reject
    When it exchanges the code with the Keycloak token endpoint
    Then the exchange request should really be sent and really fail
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

  @requires-browser
  Scenario: Agent completes the full browser OAuth login flow
    Given the runner can complete a browser OAuth flow natively or via Playwright with harness-supplied login input
    When the agent runs `jolly login --browser`
    Then Jolly should complete the browser OAuth flow
    And it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should not contain any email or password value
    And subsequent `jolly auth status` should report the token is configured
    And Jolly should not print the token value

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
    And when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context
    And when no organization is stored, it should report the account context as unknown rather than failing
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
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me
    When the agent runs `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env
    And THIRD_PARTY_KEY should remain in .env unchanged
    And subsequent `jolly auth status` should report not authenticated

  Rule: Auth command principles
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` should support browser OAuth and headless token flows.
    - `jolly login` (no flags) tries to open the Keycloak authorization URL in the user's native browser (using `open` on macOS, `xdg-open` on Linux, `start` on Windows). If the native browser opens successfully, it runs the standard browser OAuth flow (PKCE, callback server, callback, exchange).
    - If opening the native browser fails (headless environment, CI, VM with no display), Jolly checks for Playwright. If Playwright is installed with browser binaries, it automates the flow headlessly.
    - If both native browser and Playwright are unavailable, Jolly directs the user to create a token at cloud.saleor.io/tokens and pass it via `jolly login --token <value>`.
    - `jolly login --browser` forces the browser-based path: first tries native browser, then falls back to Playwright, then errors with guidance to use `--token`.
    - `jolly login --token <value>` is the headless/CI/VM fallback that always works regardless of browser availability.
    - Native browser detection: `child_process.execSync` of the platform-appropriate open command (`open`, `xdg-open`, `start`). If the process exits with code 0, the browser is available.
    - Playwright detection checks whether the `playwright` npm package can be imported AND the chromium browser binary exists at Playwright's expected path. Fast synchronous check, no browser launch.
    - Playwright is a headless fallback only — on a machine with a display, the native browser is always preferred.
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
    - Token verification means one thing (decision 2026-06-12): an authenticated read-only
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
    - The hosts `id.saleor.online` and `api.saleor.cloud` are retired remnants of the
      deprecated saleor/cli era (live probe 2026-06-12: id.saleor.online is a stub with
      404 /verify and /configure). They must not appear in Jolly code, output, or specs;
      the real first-party hosts are auth.saleor.io (Keycloak, realm saleor-cloud) and
      cloud.saleor.io (Cloud API and token page).
    - The OAuth code exchange makes real requests (Keycloak token endpoint, then Cloud
      API /platform/api/tokens) and reports their real outcomes. No placeholder tokens,
      simulated responses, or fabricated "verified" checks — if a step is unimplemented,
      Jolly errors naming the unimplemented step.

  Rule: Login credentials are one-time inputs, never persisted
    - Saleor Cloud email and password are one-time login inputs. Jolly holds them in
      memory only for the duration of the login flow and never persists them — not to
      `.env`, not to any file, not in command output.
    - There are no Jolly environment variables for email or password; the durable
      artifact of every login flow is the Saleor Cloud token, stored in `.env` as
      JOLLY_SALEOR_CLOUD_TOKEN.
    - In the native browser flow (Tier 1) the human types credentials into the real
      browser; Jolly never sees them.
    - When the Playwright fallback needs credentials to complete the Keycloak login
      form, Jolly prompts for email and password on stdin (hidden input on a TTY;
      reading piped input otherwise) at login time.
    - If the Playwright flow needs credentials and none are provided (EOF, empty
      input, or no interactive stdin), Jolly errors with guidance to use
      `jolly login --token <value>` instead. It never falls back to reading
      email/password from environment variables or files.

  Rule: Open questions
    - Jolly workflow credentials should use `JOLLY_*` environment variable names, while Paper-required storefront variables should be written separately using Paper-compatible names.

  Rule: Browser OAuth prerequisites
    - `@requires-browser` scenarios run in one of three tiers depending on environment capability.
    - Tier 1 (native browser): When a display is available and the native browser can be opened (a developer laptop), the test runs the full end-to-end flow: `jolly login --browser` → browser opens → user authenticates → callback → exchange → token in .env. This requires a human to complete the OAuth consent. The test harness detects native browser availability by trying `open`/`xdg-open`/`start`.
    - Tier 2 (Playwright headless): When no native browser is available but Playwright is installed with browser binaries, the test runs the full flow via Playwright automation. The harness supplies the Saleor Cloud email/password by piping them into Jolly's stdin prompt from the harness-only knobs HARNESS_SALEOR_EMAIL and HARNESS_SALEOR_PASSWORD (these are CI/test secrets, not Jolly settings — Jolly itself never reads credentials from the environment, and nothing writes them to `.env`).
    - Tier 2 also skips when Playwright is available but HARNESS_SALEOR_EMAIL/HARNESS_SALEOR_PASSWORD are absent, with a reason naming the missing harness knobs.
    - Tier 3 (skip): When neither native browser nor Playwright is available, the scenario skips with a message directing the user/agent to install Playwright or use `--token <value>`.
    - The `@requires-browser` tag is checked by the test harness before the `@sandbox` credential check. The harness first checks for native browser capability, then for Playwright, in that order.
