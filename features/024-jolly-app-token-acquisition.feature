Feature: Jolly app token acquisition via Saleor GraphQL
  As a customer's AI agent
  I want Jolly to acquire an app token from a Saleor instance via GraphQL
  So that Configurator and other privileged operations can proceed
  without requiring manual token creation in the Dashboard

  Background:
    Given Jolly has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    And Jolly has a Saleor GraphQL instance URL

  @logic
  Scenario: Jolly create app-token ensures a dedicated Jolly Setup app
    Given the agent invokes `jolly create app-token`
    When Jolly resolves which app to mint a token for
    Then it should send the GetApps GraphQL query to the instance URL
    And the query should be authenticated with the Saleor Cloud bearer token
    And it should look for an app it owns by the dedicated name "Jolly Setup"
    And it should not mint a token for an unrelated pre-existing app

  @logic
  Scenario: Jolly create app-token creates the Jolly Setup app with full permissions when absent
    Given the instance has no "Jolly Setup" app yet
    When Jolly creates the dedicated app
    Then it should send the appCreate GraphQL mutation named "Jolly Setup"
    And the mutation should request all available permissions for the app in v1
    And it should extract the authToken returned directly by appCreate
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN

  @logic
  Scenario: Jolly create app-token reuses an existing Jolly Setup app idempotently
    Given the instance already has a "Jolly Setup" app from a previous run
    When Jolly acquires a token
    Then it should send the appTokenCreate mutation for that existing Jolly Setup app
    And it should not create a duplicate app
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN

  @logic
  Scenario: Jolly create app-token does not reuse an unrelated low-permission app
    Given the instance has a pre-existing app with only a few permissions and no "Jolly Setup" app
    When Jolly acquires a token
    Then it should create the dedicated "Jolly Setup" app with all available permissions
    And it should not mint a token for the unrelated pre-existing app
    And the resulting token's app should carry the permissions Configurator requires

  @logic
  Scenario: Jolly create app-token --dry-run shows risk context
    Given the agent wants to preview app token creation
    When the agent runs `jolly create app-token --dry-run`
    Then the output should include a risk context with action "create app-token"
    And the risk context should include categories "credential handling"
    And the risk context should include the target instance URL
    And no GraphQL mutations should be sent to the Saleor instance

  @sandbox
  Scenario: Jolly create app-token acquires a real, fully-permissioned token from Saleor
    Given a real Saleor instance, which may already have unrelated apps installed
    When the agent runs `jolly create app-token`
    Then Jolly should ensure a dedicated "Jolly Setup" app and create a token for it via GraphQL
    And the token's app should hold the management permissions Configurator requires
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN
    And subsequent `jolly auth status` should report the app token is configured
    And Jolly should not print the token value

  Rule: App token principles
    - App token acquisition uses the Saleor GraphQL API directly on the instance, not the Cloud API.
    - The token returned is a bearer token for the Saleor instance's GraphQL API.
    - Listing apps uses the standard GetApps GraphQL query; the dedicated app is created with the
      standard `appCreate` mutation and reused via `appTokenCreate`.
    - The app token is stored as JOLLY_SALEOR_APP_TOKEN in .env; Jolly never prints it.
    - Jolly should not depend on the deprecated Saleor CLI for app token creation.

  Rule: Dedicated Jolly Setup app, full permissions (resolved 2026-06-14)
    - Jolly acquires the workflow token from a dedicated app it owns, named "Jolly Setup", created
      with the full v1 permission set (all available `PermissionEnum` values). It never mints a
      token for an unrelated pre-existing app.
    - Reason (acceptance-run finding 2026-06-14): `appTokenCreate` cannot escalate an existing
      app's permissions — a token minted for, say, a 3-permission "SMTP" app is missing everything
      `@saleor/configurator` needs (MANAGE_PRODUCTS, MANAGE_CHANNELS, MANAGE_SETTINGS,
      MANAGE_SHIPPING, MANAGE_CHECKOUTS), so stage 6 fails Permission Denied. The earlier
      "select the first existing app, else create one" flow (inherited from the deprecated CLI)
      only produced a usable token on a pristine environment with zero apps.
    - Acquisition is idempotent (feature 022): if a "Jolly Setup" app already exists, Jolly reuses
      it (mints a fresh token via `appTokenCreate`) rather than creating a duplicate; only when it
      is absent does Jolly create it via `appCreate`.
    - "No apps installed" is therefore not an error condition — Jolly creates its own app. There is
      no `NO_APPS_AVAILABLE` outcome and no interactive app selection in the agent-driven flow.
    - v1 requests all available permissions; narrowing to the minimal Configurator/Paper set is a
      post-MVP refinement.
