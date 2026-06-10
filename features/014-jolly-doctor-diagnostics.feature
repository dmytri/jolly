Feature: Jolly doctor diagnostics
  As a customer's AI agent
  I want `jolly doctor` to diagnose setup and deployment problems
  So that I can recover from failed or partial Jolly workflows with actionable next steps

  Background:
    Given Jolly is agent-first and should produce structured, actionable output
    And Jolly uses Saleor Cloud, Saleor Configurator, Saleor Paper, Stripe, Vercel, and agent skills

  Scenario: Agent runs doctor during setup
    Given the agent is setting up a Jolly storefront
    When it invokes `jolly doctor`
    Then Jolly should check local Jolly CLI availability and version
    And it should check skill installation status
    And it should check supported agent guidance status where possible
    And it should summarize findings in concise human text plus machine-readable output

  Scenario: Doctor checks Saleor connectivity
    Given Jolly has or can infer a Saleor GraphQL endpoint
    When `jolly doctor` checks Saleor
    Then it should validate GraphQL connectivity
    And it should check whether required environment variables are present
    And it should check whether an app token is available when required
    And it should run or recommend Configurator introspection where appropriate
    And it should report missing permissions or authentication failures with next steps

  Scenario: Doctor checks storefront readiness
    Given a Paper storefront exists locally
    When `jolly doctor` checks the storefront
    Then it should verify required Paper environment variables
    And it should verify the local Node.js version against Paper's current requirements
    And it should provide guidance but not install or switch Node.js versions automatically
    And it should verify the expected package manager and commands where possible
    And it should identify whether the Jolly starter recipe exists in the cloned storefront repository
    And it should report whether product browsing, cart, and checkout readiness checks can be performed
    And it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests
    And `jolly doctor storefront --full-validation` should run full storefront validation checks where feasible

  Scenario: Doctor checks deployment and payment readiness
    Given the storefront may be deployed
    When `jolly doctor` checks remote readiness
    Then it should check Vercel deployment configuration where credentials or context allow
    And it should check whether required Vercel environment variables are configured
    And it should check whether Saleor trusted origins include the deployed storefront URL where possible
    And it should check Stripe test-mode setup status where possible
    And it should identify remaining manual steps clearly

  Scenario: Jolly start runs doctor automatically
    Given `jolly start` has completed setup steps
    When it performs final verification
    Then it should run `jolly doctor` automatically
    And it should include doctor results in the final `jolly start` output

  Scenario: Agent runs targeted doctor checks
    Given the agent needs to diagnose a specific area
    When it invokes a named `jolly doctor` check group
    Then Jolly should run only the relevant checks for that group
    And supported v1 groups should include skills, saleor, storefront, deployment, and stripe

  Rule: Doctor principles
    - `jolly doctor` is required for v1.
    - `jolly doctor` should run all checks by default.
    - `jolly doctor` should support named check groups for targeted diagnostics.
    - V1 should not add a separate `jolly status` command; status-style summaries should be handled by `jolly doctor`.
    - Doctor output should be concise for humans and structured for agents.
    - `jolly doctor --json` should produce machine-readable output.
    - `jolly doctor --quiet` should reduce nonessential output.
    - Doctor should avoid exposing secret values.
    - Doctor should distinguish between pass, warning, fail, skipped, and unknown checks.
    - Doctor should suggest concrete next commands or manual steps.
    - Doctor should be diagnostics-only in v1.
    - Doctor should not make local or remote changes in v1.
    - Doctor should provide enough structured guidance for the customer's agent to perform fixes through explicit Jolly commands or manual steps.

  Rule: Open questions
    - `jolly doctor` should support named check groups: skills, saleor, storefront, deployment, and stripe.
    - `--json` should be supported by every Jolly CLI command, including doctor.
    - `--quiet` should be supported by every Jolly CLI command, including doctor.
    - A future repair/fix mode is deferred; v1 doctor remains diagnostics-only.
