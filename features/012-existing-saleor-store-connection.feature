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

  @logic
  Scenario: Jolly create store writes the Saleor URL to .env
    Given the agent has a Saleor GraphQL endpoint URL "https://test-shop.saleor.cloud/graphql/"
    When the agent runs `jolly create store --url https://test-shop.saleor.cloud/graphql/`
    Then Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL
    And .env should contain NEXT_PUBLIC_SALEOR_API_URL=https://test-shop.saleor.cloud/graphql/
    And .gitignore should contain .env
    And Jolly should load the updated .env values for the current command flow
    And Jolly should not print the URL in a way that exposes the store path

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

  @logic
  Scenario: Jolly create store --dry-run does not write to .env
    Given the agent has no existing .env file
    When the agent runs `jolly create store --url https://shop.saleor.cloud/graphql/ --dry-run --json`
    Then the output should include a risk context with action "create store"
    And .env should not be created
    And the output should include the normalized URL in the data object

  @logic
  Scenario: Jolly create store builds a Cloud API environment creation request
    Given the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    And the agent has selected or created a Saleor Cloud organization
    When Jolly prepares to create a new Saleor Cloud environment from the Cloud API
    Then it should POST to /platform/api/organizations/{organization}/environments/
    And the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials
    And the default region should be "us-east-1"
    And the default database template should be "sample"
    And the environment creation should return a task_id for async job polling
    And Jolly should poll GET /platform/api/service/task-status/{task_id} until status is "SUCCEEDED"
    And once complete, it should set NEXT_PUBLIC_SALEOR_API_URL from the resulting domain

  @logic
  Scenario: Jolly create store handles domain name collision
    Given Jolly submits an environment creation with a domain that already exists
    When the Cloud API responds with HTTP 400 and "environment with this domain label already exists"
    Then Jolly should suggest an alternative domain label
    And it should allow the agent to provide a new domain
    And it should retry the request with the corrected domain

  @logic
  Scenario: Jolly create store creates a project when none exists
    Given the agent has not created or selected a Saleor Cloud project
    When Jolly needs a project for environment creation
    Then it should create a project via POST /platform/api/organizations/{organization}/projects/
    And the project body should include name, plan="dev", and region
    And it should proceed to create the environment in the new project

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
