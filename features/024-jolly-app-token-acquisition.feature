Feature: Jolly app token acquisition via Saleor GraphQL
  As a customer's AI agent
  I want Jolly to acquire app tokens from a Saleor instance via GraphQL
  So that Configurator and other privileged operations can proceed
  without requiring manual token creation in the Dashboard

  Background:
    Given Jolly has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    And Jolly has a Saleor GraphQL instance URL

  @logic
  Scenario: Jolly create app-token lists available apps via GraphQL
    Given the agent invokes `jolly create app-token`
    When Jolly queries the Saleor instance for available apps
    Then it should send the GetApps GraphQL query to the instance URL
    And the query should be authenticated with the Saleor Cloud bearer token
    And it should parse the response for a list of app names and IDs
    And if multiple apps are found, it should present them for selection

  @logic
  Scenario: Jolly create app-token constructs the correct GraphQL mutation
    Given the agent has selected a Saleor app by ID
    When Jolly creates a token for that app
    Then it should send the appTokenCreate GraphQL mutation with the selected app ID
    And the mutation should request all available permissions for the token in v1
    And it should extract the authToken from the mutation response
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN

  @logic
  Scenario: Jolly create app-token handles missing apps gracefully
    Given the Saleor instance has no apps installed
    When Jolly queries GetApps
    Then it should report that no apps are available
    And it should suggest creating a Saleor app via the Dashboard
    And it should return an empty error code "NO_APPS_AVAILABLE"

  @logic
  Scenario: Jolly create app-token --dry-run shows risk context
    Given the agent wants to preview app token creation
    When the agent runs `jolly create app-token --dry-run`
    Then the output should include a risk context with action "create app-token"
    And the risk context should include categories "credential handling"
    And the risk context should include the target instance URL
    And no GraphQL mutations should be sent to the Saleor instance

  @sandbox
  Scenario: Jolly create app-token acquires a real token from Saleor
    Given the Saleor instance has at least one app installed
    When the agent runs `jolly create app-token` with a selected app
    Then Jolly should successfully create a new app token via GraphQL
    And it should write the token to .env as JOLLY_SALEOR_APP_TOKEN
    And subsequent `jolly auth status` should report the app token is configured
    And Jolly should not print the token value

  Rule: App token principles
    - App token acquisition uses the Saleor GraphQL API directly on the instance, not the Cloud API.
    - The `appTokenCreate` mutation is a standard Saleor GraphQL mutation available on every instance.
    - The token returned is a bearer token for the Saleor instance's GraphQL API.
    - Jolly v1 should request all available permissions when creating the setup/configuration app token.
    - The app token is stored as JOLLY_SALEOR_APP_TOKEN in .env.
    - Listing apps uses the standard GetApps GraphQL query.
    - Jolly should not depend on the deprecated Saleor CLI for app token creation.

  Rule: Open questions
    - Whether Jolly should create a dedicated "Jolly Setup" app vs. selecting an existing app is deferred to CLI design.
    - What specific app permissions Jolly should request for optimal Configurator access remains open.
    - Whether app token creation should be part of `jolly create app-token` or folded into `jolly create store --with-app-token` is deferred.
