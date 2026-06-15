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
  Scenario: jolly doctor --quiet keeps the envelope and checks
    Given a project directory with the Jolly CLI installed
    When the agent runs `jolly doctor --quiet --json`
    Then the envelope and its checks array should still be present
    And only nonessential human-readable text should be reduced

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

  Rule: Doctor principles
    - `jolly doctor` is required for v1.
    - `jolly doctor` should run all checks by default.
    - `jolly doctor` should support named check groups for targeted diagnostics.
    - V1 should not add a separate `jolly status` command; status-style summaries should be handled by `jolly doctor`.
    - `jolly doctor --json` should produce machine-readable output.
    - `jolly doctor --quiet` should reduce nonessential output.
    - Doctor should distinguish between pass, warning, fail, skipped, and unknown checks.
    - Doctor should suggest concrete next commands or manual steps.
    - Doctor is the agent's recovery oracle during skill-driven setup: when a step fails or is incomplete, the relevant check should tell the agent what is wrong and the concrete next action (a command to run, a CLI to authenticate, a value to provide), so the agent can self-correct and resume via the Jolly skill.
    - Doctor's checks should reflect end-to-end state produced by `jolly start` spawning the official CLIs, or by the agent running a stage itself (cloned storefront, configured store, deployment) — see feature 022 — so a re-run shows real progress, not just Jolly's own plumbing.
    - Doctor verifies the local bootstrap artifacts `jolly init` produces (feature 007) under an `init` group — the merged `.mcp.json` saleor-graphql entry (`mcp-config`) and the `AGENTS.md` `jolly:begin` marker section (`agents-md`) — so the agent can machine-check whether bootstrap is done instead of assuming it. A missing `.mcp.json`, or an `AGENTS.md` that exists but lacks the Jolly marker, is `fail` with `jolly init` as the next step; both present is `pass`. `jolly init` re-merges idempotently to recover.
    - Doctor should be diagnostics-only in v1.
    - Doctor should not make local or remote changes in v1.
    - Per feature 020's "No fabricated success", doctor reports `pass` only for a check it actually performed and confirmed; checks it could not run are `skipped` or `unknown`, never `pass`.

