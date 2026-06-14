Feature: Jolly doctor diagnostics
  As a customer's AI agent
  I want `jolly doctor` to diagnose setup and deployment problems
  So that I can recover from failed or partial Jolly workflows with actionable next steps

  @logic
  Scenario: Agent runs doctor during setup
    Given the agent is setting up a Jolly storefront
    When it invokes `jolly doctor`
    Then Jolly should check local Jolly CLI availability and version
    And it should check skill installation status
    And it should check supported agent guidance status where possible
    And it should summarize findings in concise human text plus machine-readable output

  @sandbox
  Scenario: Doctor checks Saleor connectivity
    Given Jolly has or can infer a Saleor GraphQL endpoint
    When `jolly doctor` checks Saleor
    Then it should validate GraphQL connectivity
    And it should check whether required environment variables are present
    And it should check whether an app token is available when required
    And it should run or recommend Configurator introspection where appropriate
    And it should report missing permissions or authentication failures with next steps

  @sandbox
  Scenario: Doctor checks storefront readiness
    Given a Paper storefront exists locally
    When `jolly doctor` checks the storefront
    Then it should verify required Paper environment variables
    And it should verify the local Node.js version against Paper's current requirements
    And it should identify whether the Jolly starter recipe exists in the cloned storefront repository
    And it should report whether product browsing, cart, and checkout readiness checks can be performed
    And it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests
    And `jolly doctor storefront --full-validation` should run full storefront validation checks where feasible

  @sandbox
  Scenario: Doctor checks deployment and payment readiness
    Given the storefront may be deployed
    When `jolly doctor` checks remote readiness
    Then it should check Vercel deployment configuration where credentials or context allow
    And it should check whether required Vercel environment variables are configured
    And it should check whether Saleor trusted origins include the deployed storefront URL where possible
    And it should check Stripe test-mode setup status where possible

  @sandbox
  Scenario: Jolly start runs doctor automatically
    Given `jolly start` has completed setup steps
    When it performs final verification
    Then it should run `jolly doctor` automatically
    And it should include doctor results in the final `jolly start` output

  @logic
  Scenario: Doctor reports pass only for checks it actually performed
    Given a project directory with no Paper storefront present
    When the agent runs `jolly doctor storefront --json`
    Then it must not report "pass" for storefront checks it could not perform
    And checks for an absent storefront should be "fail", "skipped", or "unknown"
    And the summary must not claim storefront readiness that was not verified

  @logic
  Scenario: Agent runs targeted doctor checks
    Given the agent needs to diagnose a specific area
    When it invokes a named `jolly doctor` check group
    Then Jolly should run only the relevant checks for that group
    And supported v1 groups should include skills, init, saleor, storefront, deployment, and stripe

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
    - Doctor's checks should reflect end-to-end state produced by the agent's official-CLI steps (cloned storefront, configured store, deployment) — see feature 022 — so a re-run after agent work shows real progress, not just Jolly's own plumbing.
    - Doctor verifies the local bootstrap artifacts `jolly init` produces (feature 007) under an `init` group — the merged `.mcp.json` saleor-graphql entry (`mcp-config`) and the `AGENTS.md` `jolly:begin` marker section (`agents-md`) — so the agent can machine-check whether bootstrap is done instead of assuming it. A missing `.mcp.json`, or an `AGENTS.md` that exists but no longer carries the Jolly marker (e.g. an agent overwrote it), is `fail` with `jolly init` as the next step; both present is `pass`. `jolly init` re-merges idempotently to recover.
    - Doctor should be diagnostics-only in v1.
    - Doctor should not make local or remote changes in v1.
    - Per feature 020's "No fabricated success", doctor reports `pass` only for a check it actually performed and confirmed; checks it could not run are `skipped` or `unknown`, never `pass`.

