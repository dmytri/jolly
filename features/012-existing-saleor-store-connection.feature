Feature: Existing Saleor store connection
  As a customer who already has a Saleor store
  I want Jolly to connect to it with as little manual input as possible
  So that my agent can configure and deploy a Paper storefront without re-registering Saleor Cloud resources

  @logic
  Scenario Outline: Agent normalizes a pasted Saleor URL to the GraphQL endpoint
    Given a pasted Saleor URL <pasted>
    When the agent runs `jolly create store --url <pasted> --json`
    Then the envelope `data` should report the normalized endpoint `https://my-shop.saleor.cloud/graphql/`

    Examples:
      | pasted                                                      |
      | https://my-shop.saleor.cloud/dashboard/                     |
      | https://my-shop.saleor.cloud                                |
      | https://my-shop.saleor.cloud/graphql/                       |

  @logic
  Scenario Outline: A pasted URL outside the recognized Saleor forms asks for clarification
    Given a pasted Saleor URL <pasted>
    When the agent runs `jolly create store --url <pasted> --json`
    Then the envelope status should be "error" with the stable code `INVALID_SALEOR_URL`
    And the clarifying question Jolly returns should match the catalog's entry

    Examples:
      | pasted                                |
      | ftp://my-shop.saleor.cloud/graphql/   |
      | https://my-shop.saleor.cloud/checkout |

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
  Scenario: Jolly infers Saleor Cloud organization and environment
    Given the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    And a verified Saleor GraphQL endpoint whose host matches one Cloud environment domain
    When the agent runs `jolly create store --url` on the verified Saleor endpoint with `--json`
    Then the envelope `data` should report the resolved organization slug
    And the envelope `data` should report the resolved environment matching the GraphQL endpoint host

  @logic @property
  Scenario: The environment-creation request body is built by one seam, so the previewed request is the one that is sent
    Given Jolly's environment-creation code
    When the places that build the POST body for /platform/api/organizations/{organization}/environments/ are enumerated
    Then there should be exactly one, and both the `--dry-run` preview and the real request should report and send that one body
    And a second, independently constructed body for that request should redden the check, since a preview that is verified cannot vouch for a request that is not

  @logic
  Scenario: Jolly create store warns when the token has multiple organizations
    Given the Cloud token can access organizations "org-one" and "org-two"
    When the agent runs `jolly create store --create-environment` without `--organization`
    Then the output envelope status should be "warning"
    And the output should list the available organization slugs
    And the output should name the organization slug Jolly selected
    And the output should advise re-running with `--organization <slug>` if the selection is wrong

  @sandbox @creates-env
  Scenario: Jolly creates a Saleor Cloud environment
    Given the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    And no leftover jolly-cannon-fodder environment remains from a previous run
    When the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier
    Then Jolly should discover the organization from the Cloud API
    And it should reuse an existing project when one exists, otherwise create one via POST /platform/api/organizations/{organization}/projects/ with plan="dev"
    And the output envelope data should state whether the project was created or reused
    And it should create an environment via POST /platform/api/organizations/{organization}/environments/
    And the environment creation should return a task_id for async job polling
    And Jolly should poll GET /platform/api/service/task-status/{task_id} until status is "SUCCEEDED"
    And Jolly should extract the resulting domain from the task result
    And the envelope `data` should report the created store's `*.saleor.cloud` GraphQL API URL
    And the envelope `data` should report the created store's Saleor Dashboard URL ending in `.saleor.cloud/dashboard/`
    And it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain
    And it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session
    And the created environment's name and domain label should carry the run's jolly-cannon-fodder namespace
    And teardown should delete the created environment right after the scenario

  @logic @exceptional-double
  Scenario: Jolly create store reports ENVIRONMENT_LIMIT_REACHED when the sandbox limit is hit
    Given the Cloud API rejects environment creation because the organization's sandbox environment limit is reached
    When the agent runs `jolly create store --create-environment --json`
    Then the envelope status should be "error" with the stable code `ENVIRONMENT_LIMIT_REACHED`
    And the message should guide the customer to delete an unused environment or upgrade the plan

  @captain @sandbox
  Scenario: Jolly provisions a blank environment with no sample data
    Given the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN
    When the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier
    Then the environment-creation request should send `database_population` as null, the Saleor Cloud blank template
    And the created store should hold no sample products or sample configuration
    And teardown should delete the created environment right after the scenario

  Rule: Environment creation against in-use organizations
    - `jolly create store --create-environment` must work against organizations that already
      have projects and environments; it never requires an empty organization.
    - `jolly create store --create-environment` accepts optional `--name <name>` and
      `--domain-label <label>` overrides; when omitted, Jolly generates them. The test
      harness uses these overrides to namespace test environments.
    - `jolly create store --create-environment` accepts optional `--region <region>`;
      when omitted the default is `us-east-1`.
    - `jolly create store --create-environment` accepts optional
      `--organization <slug>` to select a specific organization when the Cloud token
      has access to multiple organizations. When omitted and the token has access to
      exactly one organization, Jolly uses it without prompting. When omitted and the
      token has access to multiple organizations, Jolly must emit a warning with the
      list of available organizations and the slug of the one it selected, so the agent
      can re-run with `--organization` if the wrong one was chosen.
    - Project handling is create-or-reuse: reuse an existing project when one exists,
      otherwise create one with plan "dev". The output envelope `data` must state which
      happened (created vs reused).
    - When the Cloud API rejects environment creation because the organization's sandbox
      environment limit is reached, Jolly must emit `status` "error" with the stable error
      code `ENVIRONMENT_LIMIT_REACHED` and a message guiding the customer to delete an
      unused environment or upgrade the plan.

  Rule: Created environments are provisioned blank
    - `jolly create store --create-environment` provisions the environment with NO sample data
      and NO sample configuration: `database_population` is sent as null — the Saleor Cloud
      "blank" template, which "contains no data and configuration settings" — never "sample".
    - Reason: the starter recipe (feature 004) is a complete declarative config that
      `@saleor/configurator deploy` reconciles the store to match, deleting any undeclared entity.
      Against Saleor's sample data that is many deletes; a blank environment keeps it to just
      Saleor's stock defaults, which the bootstrap deploy of the store `jolly start` provisions
      replaces as the intended initial setup. Pairs with feature 004 Rule "Recipe targets a clean
      environment".
    - v1 has no database-template override flag: provisioning is always blank. Re-introducing a
      `--database <sample|blank|snapshot>` pass-through is a post-MVP iteration only if a real
      need appears (blank-only for v1).

  Rule: Existing-store automation principles
    - Validate the GraphQL endpoint before using it.
    - Infer Saleor Cloud organization/environment from authenticated Cloud context where possible.
    - The Cloud API is at https://cloud.saleor.io/platform/api (optionally overridden by
      JOLLY_SALEOR_CLOUD_API_URL, feature 018). Authenticate with `Authorization: Token <token>`.
      api.saleor.cloud is a retired saleor/cli-era host and must not appear in code or output.
    - Dry-run previews of Cloud API requests show the real request: the cloud.saleor.io
      host, the organization actually resolved from the token, and no invented
      identifiers or random task ids (feature 020, "No fabricated success").
    - Organizations: GET /platform/api/organizations/ returns a list with slug and environments URL.
    - Projects: POST /platform/api/organizations/{slug}/projects/ with body { name, plan: "dev", region }.
    - Environments: POST /platform/api/organizations/{slug}/environments/ with body { name, project, domain_label, database_population: null, service: "saleor", region: "us-east-1" }. Returns a task_id. `database_population` is null (the Saleor Cloud "blank" template — no sample data or config), never "sample"; see the "Created environments are provisioned blank" rule.
    - Task status: GET /platform/api/service/task-status/{task_id} until status is "SUCCEEDED".
    - The environment task result contains the domain URL (https://{domain_label}.saleor.cloud/graphql/).
    - Require a usable store credential for full existing-store setup: Jolly projects SALEOR_TOKEN
      to .env from the authenticated session (alongside SALEOR_URL), so configurator and curl read it
      directly — no separate per-store app token is minted.
    - The deprecated CLI shows useful example flows for Saleor Cloud OAuth/headless token acquisition, local app selection/creation, and permission updates.
    - Use `saleor/configurator introspect` with SALEOR_TOKEN to discover channels, catalog structure, menus, and configuration.

  Rule: Open questions
    - Which pasted URL forms should Jolly normalize in v1?
    - The exact shape of the task status response and how to extract the domain URL from it needs verification against the live Cloud API at implementation time.
