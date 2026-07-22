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
    Scenario: Agent jolly login returns the verification URL in the envelope and persists the grant
      Given a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set
      And the Saleor auth host issues device codes
      When the agent runs `jolly login --json`
      Then the envelope status should be "warning"
      And a nextStep should carry the Saleor device verification URL for the human to open and approve
      And stdout should carry no OSC 8 hyperlink escape
      And stdout should carry no token value
      And it should persist the pending device authorization for the re-run

    @logic @exceptional-double
    Scenario: The agent re-runs after approval and the persisted grant completes the sign-in
      Given a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set
      And the Saleor auth host approves the device grant on the first poll
      And a pending device authorization was persisted by a prior run
      When the agent runs `jolly login --json`
      Then the envelope status should be "success"
      And it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
      And it should store the device-grant refresh token in .env as JOLLY_SALEOR_REFRESH_TOKEN
      And it should not write JOLLY_SALEOR_CLOUD_TOKEN to .env
      And the persisted pending device authorization should be cleared
      And stdout should carry no token value

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

  Rule: A long run refreshes the short-lived access token

    The device-grant access token is short-lived (about five minutes), far shorter than a full
    `jolly start`. Jolly stores the refresh token and, when a Cloud API call needs a token whose
    access token has expired, mints a fresh access token through the refresh grant
    (`grant_type=refresh_token`, `client_id=jolly`) rather than failing or re-prompting.

    @logic @exceptional-double
    Scenario: An expired access token is refreshed from the stored refresh token
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
    Scenario: Jolly logout removes every Jolly-managed auth value from .env
      Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_ACCESS_TOKEN=some-access and JOLLY_SALEOR_REFRESH_TOKEN=some-refresh and SALEOR_TOKEN=some-store-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me
      When the agent runs `jolly logout`
      Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_ACCESS_TOKEN, JOLLY_SALEOR_REFRESH_TOKEN, SALEOR_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env
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
    Scenario: jolly auth with an unknown subcommand fails clearly and names the only subcommand
      When the agent runs `jolly auth frobnicate --json`
      Then the envelope status should be "error" with the stable code `UNKNOWN_AUTH_SUBCOMMAND`
      And the error message should state that the only auth subcommand is status
      And the remediation should tell the caller to run `jolly auth status`

  Rule: The .env Jolly writes is private and shell-safe
    - Every .env Jolly creates or updates (the Cloud token, refresh token, the projected store
      SALEOR_TOKEN, organization name, storefront variables) is written with owner-only
      permissions (mode 600); a file holding credentials is never group- or world-readable.
    - The file carries values, not prose. Jolly wrote a managed commented header block until
      2026-07-22, when it was condemned and removed: no scenario asked for it, its affordance is
      already carried by "assets/skills/jolly" and the `/setup` page, and it put Jolly's internal
      token layer on the customer's disk.
    - Values are written so the file stays a valid POSIX shell env file: a value containing
      whitespace, an apostrophe, or another shell-significant character is quoted so
      `set -a; . ./.env` sources it without error and round-trips the original value. An apostrophe in
      the organization name (e.g. "Dmytri's Organization") is the common case.
    - This is a cross-cutting invariant of the shared .env writer, not one command's behaviour; it
      holds wherever Jolly writes .env.

    @logic @property @exceptional-double
    Scenario: The .env Jolly writes is private to its owner
      Given the Cloud API is unreachable
      And JOLLY_SALEOR_CLOUD_TOKEN is set to "jolly-perms-test-token-001"
      When the agent runs `jolly login`
      Then the .env file Jolly wrote should be readable and writable only by its owner (mode 600)
      And Jolly should not print any token value

    @logic @property @exceptional-double
    Scenario: The .env Jolly writes survives POSIX shell sourcing
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
