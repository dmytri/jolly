Feature: Existing Saleor store connection
  As a customer who already has a Saleor store
  I want Jolly to connect to it with as little manual input as possible
  So that my agent can configure and deploy a Paper storefront without re-registering Saleor Cloud resources

  @logic
  Scenario: Agent accepts a pasted Saleor URL
    Given the customer says they already have a Saleor store
    When the agent asks for the store connection
    Then the customer may paste a Saleor Dashboard URL, storefront API URL, root Saleor Cloud URL, or GraphQL URL
    And Jolly should normalize the input to a Saleor GraphQL endpoint where possible
    And Jolly should ask a clarifying question only when the URL cannot be normalized safely

  @sandbox
  Scenario: Jolly validates the GraphQL endpoint
    Given Jolly has a candidate Saleor GraphQL endpoint
    When it validates the endpoint
    Then it should perform an introspection-style GraphQL request or equivalent lightweight validation
    And it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint
    And it should not proceed to storefront configuration until connectivity is verified

  @sandbox
  Scenario: Jolly infers Saleor Cloud organization and environment
    Given the customer has authenticated Jolly with Saleor Cloud
    And Jolly has a verified Saleor GraphQL endpoint
    When Jolly needs Saleor Cloud context
    Then it should query available organizations and environments where APIs allow
    And it should match the GraphQL endpoint host to a Saleor Cloud environment domain where possible
    And it should avoid asking the customer to manually select organization or environment when the match is unambiguous
    And it should ask the customer to choose only when multiple matches or no safe match exists

  @sandbox
  Scenario: Jolly acquires the required app token
    Given the endpoint has been verified
    When Jolly needs credentials for Configurator or privileged Saleor operations
    Then an app token or equivalent credential should be required before continuing the full existing-store setup
    And Jolly should detect whether the token is already available in environment variables
    And if missing, Jolly should acquire or create the token automatically where Saleor APIs allow
    And Jolly may follow the deprecated CLI's example flow of authenticating to Saleor Cloud, resolving the instance, selecting or creating a Saleor local app, and creating an app token via the Saleor GraphQL API
    And if automation is unavailable, it should guide the customer through the current Saleor Dashboard token creation path
    And it should avoid storing the token outside environment variables
    And it should use the token to run Configurator introspection

  Rule: Existing-store automation principles
    - Validate the GraphQL endpoint before using it.
    - Infer Saleor Cloud organization/environment from authenticated Cloud context where possible.
    - Require an app token or equivalent credential for full existing-store setup.
    - Acquire or create the app token automatically where Saleor APIs allow; otherwise guide the customer through Saleor Dashboard token creation.
    - The deprecated CLI shows useful example flows for Saleor Cloud OAuth/headless token acquisition, local app selection/creation, permission updates, and app token creation through Saleor GraphQL.
    - Use `saleor/configurator introspect` with the app token to discover channels, catalog structure, menus, and configuration.
    - After deployment, automatically update Saleor allowed/trusted origins for the deployed storefront URL where APIs allow.

  Rule: Open questions
    - Which pasted URL forms should Jolly normalize in v1?
    - What exact Saleor API or Dashboard automation path can create an app token at implementation time?
