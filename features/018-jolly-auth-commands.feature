Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  Rule: Interactive authentication is the Saleor device authorization grant

    The only interactive Saleor sign-in is the OAuth 2.0 device authorization grant against the
    `saleor-cloud` Keycloak realm (public client `jolly`, no client secret). It serves humans and
    agents alike: a human authorizes at the terminal-shown URL; an agent relays the same user code
    and URL to its human. A raw token is supplied ONLY non-interactively through the
    `JOLLY_SALEOR_CLOUD_TOKEN` environment variable (`.env` or CI). There is no `--token`,
    `--token-file`, or `--token-stdin` flag and no interactive token paste — a secret never reaches
    Jolly through `argv`, a file argument, or standard input.

    @logic
    Scenario: Interactive jolly login starts the Saleor device authorization grant
      Given an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN set
      When the user runs `jolly login`
      Then Jolly should request a device code from `https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/auth/device` with `client_id=jolly`
      And it should display the returned user code and the verification URL `https://auth.saleor.io/realms/saleor-cloud/device` through Bombshell's interactive prompt UI
      And it should poll `https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/token` while waiting for the user to authorize
      And it should not print any token value

    @logic
    Scenario: Non-interactive jolly login never starts the device grant
      Given a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set
      When the agent runs `jolly login --json`
      Then the envelope status should be "error" with a stable `code`
      And it should direct the user to set JOLLY_SALEOR_CLOUD_TOKEN or run `jolly login` interactively to sign in
      And it should not request a device code and should not block waiting for input
      And it should not write any value to .env

  Rule: The Cloud platform API scheme is chosen by which stored token is used

    Jolly keeps the two Cloud credentials in separate variables so a device sign-in never clobbers a
    configured staff token. A device-grant access token (a Keycloak JWT) is stored in
    `JOLLY_SALEOR_ACCESS_TOKEN` and sent as `Authorization: Bearer <jwt>`, refreshed from
    `JOLLY_SALEOR_REFRESH_TOKEN` when it expires. A staff token from `https://cloud.saleor.io/tokens`
    is stored in `JOLLY_SALEOR_CLOUD_TOKEN` and sent as `Authorization: Token <token>`. The
    interactive device grant writes only the access and refresh variables and never overwrites
    `JOLLY_SALEOR_CLOUD_TOKEN`. When both are stored, the device-grant access token is used.

    @sandbox
    Scenario: jolly login verifies and stores the env/.env staff token as Token
      Given JOLLY_SALEOR_CLOUD_TOKEN is a valid staff token from https://cloud.saleor.io/tokens
      When the agent runs `jolly login` in a non-interactive shell
      Then it should verify the token with an authenticated `Authorization: Token` read of `https://cloud.saleor.io/platform/api/organizations/`
      And it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN
      And it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION
      And it should report the authenticated organization context using values from the real response
      And Jolly should not print the token value

    @logic
    Scenario: jolly login rejects an invalid env/.env staff token
      Given JOLLY_SALEOR_CLOUD_TOKEN is set to an invalid or expired value
      When the agent runs `jolly login` in a non-interactive shell
      Then the verification request should really be sent and really be rejected
      And Jolly should report an error naming the HTTP rejection status
      And it should not write any value to .env
      And the output should contain no success, verified, or authenticated language

    @logic
    Scenario: jolly login with an empty env/.env token fails honestly
      Given JOLLY_SALEOR_CLOUD_TOKEN is set to the empty value
      When the agent runs `jolly login --json` in a non-interactive shell
      Then the envelope status should be "error" with a stable `code` naming the empty token
      And it should not write any value to .env

  Rule: A long run refreshes the short-lived access token

    The device-grant access token is short-lived (about five minutes), far shorter than a full
    `jolly start`. Jolly stores the refresh token and, when a Cloud API call needs a token whose
    access token has expired, mints a fresh access token through the refresh grant
    (`grant_type=refresh_token`, `client_id=jolly`) rather than failing or re-prompting.

    @sandbox @exceptional-double
    Scenario: An expired access token is refreshed from the stored refresh token
      # @exceptional-double: the authorized grant is seeded from the harness's stored refresh
      # token (a human authorize cannot be produced on demand); the refresh-grant call and the
      # platform-API read it enables are real.
      Given an expired device-grant access token in JOLLY_SALEOR_ACCESS_TOKEN and its refresh token in JOLLY_SALEOR_REFRESH_TOKEN
      When the agent runs `jolly doctor saleor --json`
      Then it should mint a fresh access token through the refresh grant at `https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/token`
      And the Cloud platform API read should succeed with the refreshed `Authorization: Bearer` token
      And it should store the refreshed access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
      And it should not re-prompt the user to authorize again

  Rule: Auth command set and principles
    - V1 includes `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate
      control plane.
    - Interactive `jolly login` authenticates through the Saleor device authorization grant (Rule
      "Interactive authentication is the Saleor device authorization grant"); non-interactive supply
      is the `JOLLY_SALEOR_CLOUD_TOKEN` environment variable only.
    - Jolly does not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets are written to `.env` as environment variables in v1.
    - Successful login also stores the authenticated organization name in `.env` as
      JOLLY_SALEOR_ORGANIZATION. It is non-secret account context, not a credential; it may appear in
      output, and `jolly auth status` reads it back so it can report account context without a network
      call. When it is absent, account context is reported as unknown — never an error. The stored
      value is always the organization name returned by the Cloud API — never a placeholder or
      invented label.

    @logic
    Scenario: Agent logs out
      Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token
      When the agent invokes `jolly logout`
      Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN from .env
      And any non-JOLLY_ variable in .env should remain unchanged
      And it should load the updated `.env` values for the current command flow
      And the envelope status should be "success"

    @logic
    Scenario: Jolly logout removes every Jolly-managed auth value from .env
      Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_ACCESS_TOKEN=some-access and JOLLY_SALEOR_REFRESH_TOKEN=some-refresh and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me
      When the agent runs `jolly logout`
      Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_ACCESS_TOKEN, JOLLY_SALEOR_REFRESH_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env
      And THIRD_PARTY_KEY should remain in .env unchanged
      And subsequent `jolly auth status` should report not authenticated

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
      Given an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN set
      When the user runs `jolly login --dry-run --json`
      Then the output should include a risk context with action "login"
      And it should not request a device code and should not write to .env
      And the output should include a nextSteps array with at least one step

  Rule: The .env Jolly writes is private and shell-safe
    - Every .env Jolly creates or updates (the Cloud token, refresh token, app token, organization
      name, Stripe keys, storefront variables) is written with owner-only permissions (mode 600); a
      file holding credentials is never group- or world-readable.
    - Values are written so the file stays a valid POSIX shell env file: a value containing
      whitespace, an apostrophe, or another shell-significant character is quoted so
      `set -a; . ./.env` sources it without error and round-trips the original value. An apostrophe in
      the organization name (e.g. "Dmytri's Organization") is the common case.
    - This is a cross-cutting invariant of the shared .env writer, not one command's behaviour; it
      holds wherever Jolly writes .env.

    @logic @property @exceptional-double
    Scenario: The .env Jolly writes is private to its owner
      # @exceptional-double: the invariant is about the local .env WRITE, not the network verify; a
      # reachable Cloud API would need a real valid token (a @sandbox concern), so the write is
      # exercised via the stored-not-verified path against an unreachable Cloud API.
      Given the Cloud API is unreachable
      And JOLLY_SALEOR_CLOUD_TOKEN is set to "jolly-perms-test-token-001"
      When the agent runs `jolly login`
      Then the .env file Jolly wrote should be readable and writable only by its owner (mode 600)
      And Jolly should not print any token value

    @logic @property @exceptional-double
    Scenario: The .env Jolly writes survives POSIX shell sourcing
      # @exceptional-double: as above, the local .env write is exercised via the stored-not-verified
      # path against an unreachable Cloud API; the token value carries a space and an apostrophe to
      # exercise shell-quoting of the value the writer emits.
      Given the Cloud API is unreachable
      And JOLLY_SALEOR_CLOUD_TOKEN is set to "jolly token's value 002"
      When the agent runs `jolly login`
      Then sourcing the written .env in a POSIX shell should exit zero
      And the value read back for JOLLY_SALEOR_CLOUD_TOKEN should equal "jolly token's value 002"

  Rule: Token verification is a real request or it is not verification
    - Verification means an authenticated read-only GET of the Cloud API organizations endpoint
      (`https://cloud.saleor.io/platform/api/organizations/`) whose response was actually received and
      checked, with the scheme chosen by which variable holds the token (a device-grant access token
      in `JOLLY_SALEOR_ACCESS_TOKEN` as `Authorization: Bearer <jwt>`, a staff token in
      `JOLLY_SALEOR_CLOUD_TOKEN` as `Authorization: Token <token>`). A 2xx response with a parseable
      organization list is verified; a 401/403 is an invalid token (error, nothing written); any other
      failure (network unreachable, 5xx, timeout) means verification did not happen.
    - When verification did not happen but a token was stored, every surface (summary, checks, data)
      must say "stored, not verified"; the envelope status is "warning" and the verification check
      status is "unknown" — never "pass".
    - `JOLLY_SALEOR_CLOUD_API_URL` optionally overrides the Cloud API base URL (default
      `https://cloud.saleor.io/platform/api`) for proxy or self-routing setups; all Cloud API requests
      honor it. Pointing it elsewhere is the customer's explicit choice.
    - Cloud API requests target the first-party host cloud.saleor.io; the device grant and refresh
      target the first-party host auth.saleor.io (feature 020 allowlist).
