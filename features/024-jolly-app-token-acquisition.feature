Feature: Jolly app token acquisition via Saleor GraphQL
  As a customer's AI agent
  I want Jolly to acquire an app token from a Saleor instance via GraphQL
  So that Configurator and other privileged operations can proceed
  without requiring manual token creation in the Dashboard

  Background:
    Given Jolly has an authenticated Saleor Cloud session — a device-grant credential (feature 018) or JOLLY_SALEOR_CLOUD_TOKEN
    And Jolly has a Saleor GraphQL instance URL

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
    And the token's app should be the dedicated "Jolly Setup" app, never an unrelated pre-existing app it found on the instance
    And the token's app should hold the management permissions Configurator requires
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN
    And re-running `jolly create app-token` should reuse the existing "Jolly Setup" app rather than creating a duplicate
    And subsequent `jolly auth status` should report the app token is configured
    And Jolly should not print the token value

  Rule: App token principles
    - App token acquisition uses the Saleor GraphQL API directly on the instance, not the Cloud API.
    - The token returned is a bearer token for the Saleor instance's GraphQL API.
    - Listing apps uses the standard GetApps GraphQL query; the dedicated app is created with the
      standard `appCreate` mutation and reused via `appTokenCreate`.
    - The app token is stored as JOLLY_SALEOR_APP_TOKEN in .env; Jolly never prints it.
    - Jolly should not depend on the deprecated Saleor CLI for app token creation.

  Rule: Dedicated Jolly Setup app, full permissions
    - Jolly acquires the workflow token from a dedicated app it owns, named "Jolly Setup", created
      with the full v1 permission set (all available `PermissionEnum` values). It never mints a
      token for an unrelated pre-existing app.
    - `appTokenCreate` cannot escalate an existing app's permissions — a token minted for, say, a
      3-permission "SMTP" app is missing everything `@saleor/configurator` needs (MANAGE_PRODUCTS,
      MANAGE_CHANNELS, MANAGE_SETTINGS, MANAGE_SHIPPING, MANAGE_CHECKOUTS), so the Configurator
      stage fails Permission Denied. Minting from the dedicated full-permission app ensures the
      token always carries what Configurator requires.
    - Acquisition is idempotent (feature 022): if a "Jolly Setup" app already exists, Jolly reuses
      it (mints a fresh token via `appTokenCreate`) rather than creating a duplicate; only when it
      is absent does Jolly create it via `appCreate`.
    - "No apps installed" is therefore not an error condition — Jolly creates its own app. There is
      no `NO_APPS_AVAILABLE` outcome and no interactive app selection in the agent-driven flow.
    - v1 requests all available permissions; narrowing to the minimal Configurator/Paper set is a
      post-MVP refinement.
