Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  Rule: Interactive authentication is the Saleor device authorization grant

    The Saleor sign-in is the OAuth 2.0 device authorization grant against the `saleor-cloud`
    Keycloak realm (public client `jolly`, no client secret). It serves humans and agents alike, and
    is the path whenever no token is already configured: a human authorizes at the terminal-shown
    verification URL, which carries the returned user code as its `user_code` query parameter so
    opening it pre-fills the code instead of asking the human to type it; an agent-driven
    (non-interactive) run relays the same complete URL and user code to its human on stderr and
    waits for authorization. Jolly NEVER asks for, prompts for, or accepts a
    pasted token, and never errors merely because no token is configured — a missing token starts the
    grant, it does not block the run. A raw token is supplied ONLY as the `JOLLY_SALEOR_CLOUD_TOKEN`
    environment variable (`.env` or CI), used silently when present; there is no `--token`,
    `--token-file`, or `--token-stdin` flag and no interactive token paste — a secret never reaches
    Jolly through `argv`, a file argument, or standard input. All device-grant and refresh requests
    target the `saleor-cloud` realm base, which an optional `JOLLY_SALEOR_AUTH_URL` override may
    redirect (default the first-party realm) for proxy or self-routing — the same affordance as
    `JOLLY_SALEOR_CLOUD_API_URL` for the Cloud API.

    @logic
    Scenario: The bundled Jolly skill directs Saleor sign-in to the device authorization grant
      Given the bundled Jolly skill that ships beside the CLI
      When its Saleor Cloud authentication guidance is read
      Then it should name the Saleor device authorization grant as the sign-in
      And it should carry no cloud.saleor.io tokens-page link and no `jolly login` token-paste flag

    @logic @exceptional-double
    Scenario: Agent-driven jolly login signs in once the human approves the grant
      # @exceptional-double: the human approval cannot be produced on demand; the
      # local fake auth host (reached via JOLLY_SALEOR_AUTH_URL) approves on the
      # first poll, so Jolly's real relay, poll, and token-store code completes
      # without waiting on a human.
      Given a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set
      And the Saleor auth host approves the device grant on the first poll
      When the agent runs `jolly login --json`
      Then it should print the returned user code and the verification URL `https://auth.saleor.io/realms/saleor-cloud/device?user_code=` followed by that user code to stderr so the agent can relay them to its human
      And the relayed verification URL should appear on stderr as the plain URL, with no OSC 8 hyperlink escape
      And the envelope status should be "success"
      And it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
      And it should store the device-grant refresh token in .env as JOLLY_SALEOR_REFRESH_TOKEN
      And it should not write JOLLY_SALEOR_CLOUD_TOKEN to .env
      And stdout should carry no token value

    @logic @exceptional-double
    Scenario: A relayed device grant resumes on a re-run and completes the sign-in the human approved
      # @exceptional-double: the human approval cannot be produced on demand; the
      # local fake auth host approves the persisted pending code on the next poll,
      # so Jolly's real resume-poll-and-store path completes without waiting. This
      # pins that a re-run resumes the SAME relayed code rather than orphaning it
      # by requesting a new one (so a human who approves between runs is honoured).
      Given a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set
      And the Saleor auth host approves the device grant on the first poll
      And a pending device authorization was relayed and persisted in a prior run
      When the agent runs `jolly login --json`
      Then Jolly should resume the persisted pending device code without relaying a new one
      And the envelope status should be "success"
      And it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
      And the persisted pending device authorization should be cleared

    @logic @exceptional-double
    Scenario: Interactive jolly login signs in through the Saleor device authorization grant
      # @exceptional-double: the human approval cannot be produced on demand; the
      # local fake auth host (JOLLY_SALEOR_AUTH_URL) approves on the first poll, so
      # the interactive grant completes against a real PTY without a human.
      Given an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN set
      And the Saleor auth host approves the device grant on the first poll
      When the user runs `jolly login`
      Then it should display the returned user code and the verification URL `https://auth.saleor.io/realms/saleor-cloud/device?user_code=` followed by that user code through Bombshell's interactive prompt UI
      And it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
      And it should not print any token value

  Rule: The Cloud platform API scheme is chosen by which stored token is used

    Jolly keeps the two Cloud credentials in separate variables so a device sign-in never clobbers a
    configured staff token. A device-grant access token (a Keycloak JWT) is stored in
    `JOLLY_SALEOR_ACCESS_TOKEN` and sent as `Authorization: Bearer <jwt>`, refreshed from
    `JOLLY_SALEOR_REFRESH_TOKEN` when it expires. A staff token supplied via the environment for
    tests and CI is stored in `JOLLY_SALEOR_CLOUD_TOKEN` and sent as `Authorization: Token <token>`. The
    interactive device grant writes only the access and refresh variables and never overwrites
    `JOLLY_SALEOR_CLOUD_TOKEN`. When both are stored, the device-grant access token is used.

    @sandbox
    Scenario: jolly login verifies and stores the env/.env staff token as Token
      Given JOLLY_SALEOR_CLOUD_TOKEN is a valid staff token supplied via the environment
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
