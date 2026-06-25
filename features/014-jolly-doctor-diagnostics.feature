Feature: Jolly doctor diagnostics
  As a customer's AI agent
  I want `jolly doctor` to diagnose setup and deployment problems
  So that I can recover from failed or partial Jolly workflows with actionable next steps

  @logic
  Scenario: Agent runs doctor during setup
    Given a project directory with the Jolly CLI installed
    When it invokes `jolly doctor`
    Then Jolly should check local Jolly CLI availability and version
    And it should check skill installation status
    And the checks should include an "agents-md" guidance check
    And the envelope should contain a summary string and a checks array

  @sandbox
  Scenario: Doctor checks Saleor connectivity
    Given .env contains a Saleor GraphQL endpoint URL
    When `jolly doctor` checks Saleor
    Then it should validate GraphQL connectivity
    And it should check whether required environment variables are present
    And it should check whether an app token is available when required
    And the saleor check should name Configurator introspection as its next step
    And it should report missing permissions or authentication failures with next steps

  @sandbox
  Scenario: Doctor checks storefront readiness
    Given a Paper storefront directory exists locally
    When `jolly doctor` checks the storefront
    Then it should verify required Paper environment variables
    And it should verify the local Node.js version against Paper's current requirements
    And it should identify whether the Jolly starter recipe exists in the cloned storefront repository
    And the checks should include browsing, cart, and checkout-readiness checks each with a concrete status
    And the default storefront checks should not include the generate, typecheck, build, or test checks
    And `jolly doctor storefront --full-validation` should add the generate, typecheck, and build checks

  @sandbox
  Scenario: Doctor checks deployment and payment readiness
    Given a deployed storefront URL is configured in .env
    When `jolly doctor` checks remote readiness
    Then the checks should include a "deployment" check with a concrete status
    And it should check whether required Vercel environment variables are configured
    And the deployment check should report whether the deployed URL is in Saleor trusted origins
    And the checks should include a "stripe" check with a concrete status

  @sandbox
  Scenario: Doctor reads the Vercel CLI login state from the Vercel CLI itself
    Given the Vercel CLI is pointed at an isolated config with no signed-in session
    When the agent runs `jolly doctor deployment --json`
    Then a "vercel-auth" check should read the login state by running `vercel whoami`
    And with no Vercel CLI session the "vercel-auth" check should be "fail" or "unknown", never "pass"
    And its next step should be to run `jolly start`, which runs the Vercel sign-in itself, never to run `vercel login`

  @sandbox
  Scenario: Doctor confirms the Vercel CLI login state when a session exists
    Given the Vercel CLI is logged in on this runner
    When the agent runs `jolly doctor deployment --json`
    Then the "vercel-auth" check should read the session by running `vercel whoami`
    And the "vercel-auth" check should be "pass"

  @sandbox
  Scenario: Jolly start runs doctor automatically
    Given `jolly start` has completed setup steps
    When the agent runs `jolly start --json`
    Then it should run `jolly doctor` automatically
    And the final start envelope should include the doctor check results

  @logic
  Scenario: Doctor reports pass only for checks it actually performed
    Given a project directory with no Paper storefront present
    When the agent runs `jolly doctor storefront --json`
    Then it must not report "pass" for storefront checks it could not perform
    And checks for an absent storefront should be "fail", "skipped", or "unknown"
    And the summary must not claim storefront readiness that was not verified

  @logic
  Scenario Outline: Agent runs targeted doctor checks
    Given a project directory with the Jolly CLI installed
    When the agent runs `jolly doctor <group> --json`
    Then only the <group> checks should run

    Examples:
      | group      |
      | skills     |
      | init       |
      | saleor     |
      | storefront |
      | deployment |
      | stripe     |

  @logic
  Scenario: jolly doctor --quiet reports only the checks that need attention
    Given a project directory with the Jolly CLI installed
    When the agent runs `jolly doctor --quiet`
    Then stderr should list only the checks that did not pass
    And stdout should be empty
    And no JSON envelope should be printed
    And `jolly doctor --json` should still emit the full envelope with its checks array

  @logic
  Scenario: Doctor with no group runs all check groups
    Given the agent runs `jolly doctor --json` with no group argument
    When doctor completes
    Then it should run every supported check group, not just one
    And the envelope checks should include results from each group

  @logic
  Scenario: Doctor flags a missing or overwritten bootstrap so the agent need not assume
    Given a project directory whose `AGENTS.md` lacks Jolly's marker and which has no `.mcp.json`
    When the agent runs `jolly doctor init --json`
    Then the `agents-md` check should be "fail" because the Jolly marker section is absent
    And the `mcp-config` check should be "fail"
    And both should give `jolly init` as the next step

  @logic
  Scenario: Doctor confirms bootstrap is done once the init artifacts are present
    Given the artifacts `jolly init` produces are present in the project directory
    When the agent runs `jolly doctor init --json`
    Then the `mcp-config` and `agents-md` checks should be "pass"
    And doctor should thereby confirm bootstrap is complete

  @sandbox
  Scenario: Doctor validates the Saleor Cloud token, not just its presence
    Given .env contains a valid JOLLY_SALEOR_CLOUD_TOKEN from https://cloud.saleor.io/tokens
    When the agent runs `jolly doctor saleor --json`
    Then a "saleor-cloud-token" check should authenticate a read-only GET of the Cloud API organizations endpoint
    And the "saleor-cloud-token" check should be "pass" naming the authenticated organization slug from the real response
    And the check must not report "pass" from the token's presence alone

  @logic
  Scenario: Doctor reports a rejected Saleor Cloud token as warning, never pass
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN set to the cloud-shaped but invalid value "deadbeef-0000-0000-0000-000000000000.not-a-valid-cloud-token"
    When the agent runs `jolly doctor saleor --json`
    Then the "saleor-cloud-token" check should really send the authenticated organizations request and have it rejected
    And the "saleor-cloud-token" check should be "warning" or "fail", reporting the HTTP rejection status, never "pass"
    And its next step should direct the customer to create a new token at https://cloud.saleor.io/tokens

  @logic
  Scenario: Doctor warns when a per-store token is in the Cloud token slot
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN set to the per-store-app-token shape "abcdef0123456789abcdef0123" with no dot separator
    When the agent runs `jolly doctor saleor --json`
    Then the "saleor-cloud-token" check should be "warning"
    And the check message should state the value looks like a per-store app token rather than a Cloud staff token and name https://cloud.saleor.io/tokens

  @sandbox @exceptional-double
  Scenario: Doctor validates stored device-grant credentials with Bearer
    # @exceptional-double: a human authorize cannot be produced on demand in CI, so the stored
    # device-grant refresh token is seeded from the harness; the refresh grant and the Bearer
    # probe of the platform API it enables are real.
    Given .env contains a stored Saleor device-grant refresh token
    When the agent runs `jolly doctor saleor --json`
    Then the "saleor-cloud-token" check should mint a fresh access token and authenticate an `Authorization: Bearer` read of the Cloud API organizations endpoint
    And the "saleor-cloud-token" check should be "pass" naming the authenticated organization slug from the real response
    And the check must not report "pass" from the refresh token's presence alone

  @sandbox
  Scenario: Doctor names the authenticated Vercel account
    Given the Vercel CLI is logged in on this runner
    When the agent runs `jolly doctor deployment --json`
    Then the "vercel-auth" check should be "pass"
    And the "vercel-auth" check should name the logged-in Vercel account reported by `vercel whoami`

  Rule: Doctor principles
    - `jolly doctor` is required for v1.
    - `jolly doctor` should run all checks by default.
    - `jolly doctor` should support named check groups for targeted diagnostics.
    - V1 should not add a separate `jolly status` command; status-style summaries should be handled by `jolly doctor`.
    - `jolly doctor --json` should produce machine-readable output (the envelope).
    - `jolly doctor --quiet` should print only the checks that did not pass, to stderr, with no envelope (feature 020).
    - Doctor should distinguish between pass, warning, fail, skipped, and unknown checks.
    - Doctor should suggest concrete next commands or manual steps.
    - Doctor is the agent's recovery oracle during skill-driven setup: when a step fails or is incomplete, the relevant check should tell the agent what is wrong and the concrete next action (a command to run, a CLI to authenticate, a value to provide), so the agent can self-correct and resume via the Jolly skill.
    - Doctor is the single readiness oracle: its auth/readiness checks read login and credential state by delegating to the upstream tool's own CLI (the Vercel CLI's `vercel whoami`) — never by Jolly reimplementing that service's authentication — so "are we ready" has one source of truth that callers (including the test harness) consult instead of duplicating.
    - Doctor's checks should reflect end-to-end state produced by `jolly start` spawning the official CLIs, or by the agent running a stage itself (cloned storefront, configured store, deployment) — see feature 022 — so a re-run shows real progress, not just Jolly's own plumbing.
    - Doctor verifies the local bootstrap artifacts `jolly init` produces (feature 007) under an `init` group — the merged `.mcp.json` saleor-graphql entry (`mcp-config`) and the `AGENTS.md` `jolly:begin` marker section (`agents-md`) — so the agent can machine-check whether bootstrap is done instead of assuming it. A missing `.mcp.json`, or an `AGENTS.md` that exists but lacks the Jolly marker, is `fail` with `jolly init` as the next step; both present is `pass`. `jolly init` re-merges idempotently to recover.
    - Doctor should be diagnostics-only in v1.
    - Doctor should not make local or remote changes in v1.
    - Per feature 020's "No fabricated success", doctor reports `pass` only for a check it actually performed and confirmed; checks it could not run are `skipped` or `unknown`, never `pass`.

  Rule: Credential checks probe validity, not just presence
    - A credential present in `.env` is not a credential that works. Doctor's
      `saleor-cloud-token` check authenticates a read-only GET of the Cloud API
      organizations endpoint (`https://cloud.saleor.io/platform/api/organizations/`) with the
      scheme chosen by token shape — a Saleor device-grant access token (a Keycloak JWT) as
      `Authorization: Bearer <jwt>`, a staff token as `Authorization: Token <value>` — and
      reports the real result: `pass` naming the authenticated organization slug on a real 2xx
      with a parseable org list; `warning` or `fail` reporting the HTTP status on a real 401/403;
      `unknown` when the Cloud API is unreachable. A `[pass]` from presence alone is a fabricated
      pass — forbidden by feature 020.
    - When the stored Saleor credential is a device grant (a refresh token, feature 018), doctor
      mints a fresh access token through the refresh grant and probes with `Authorization: Bearer`
      — so the check reflects whether the device-grant session still works, not merely that a
      refresh token is present.
    - Before the network probe, doctor inspects the value's shape: a Keycloak JWT (a
      `eyJ`-prefixed, dot-segmented token) is a device-grant access token probed as `Bearer`; a
      Cloud staff token (minted at `https://cloud.saleor.io/tokens`) carries a single dot
      separator and is probed as `Token`; a per-store app token is a short separator-free string.
      A separator-free value in the `JOLLY_SALEOR_CLOUD_TOKEN` slot is a `warning` naming the
      likely mix-up — this is the common confusion because both Saleor token kinds look alike.
      This is a heuristic hint, not a substitute for the authenticated probe.
    - Identity is part of readiness. A passing `saleor-cloud-token` check names the
      authenticated organization slug, and a passing `vercel-auth` check names the Vercel
      account `vercel whoami` reported, so the agent and the human consent to a named target
      — not a "session confirmed" with no subject.

