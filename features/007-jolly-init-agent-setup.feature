Feature: Jolly init for local agent setup
  As a customer's AI agent
  I want `jolly init` to prepare local agent guidance and skills
  So that the agent can reliably perform Jolly workflows before creating or modifying remote resources

  Scenario: Agent initializes Jolly guidance locally
    Given the agent can run Jolly via `npx`
    When the agent invokes `jolly init`
    Then Jolly should install or check the full default Saleor skill set
    And the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`
    And it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists
    And Jolly should use standard project-local skill installation locations where possible
    And Jolly should write or update agent-specific glue files or instructions for supported environments
    And Jolly should explain what was installed or updated
    And Jolly should not create remote Saleor Cloud or Vercel resources
    And Jolly should not store secrets

  Scenario: Agent init is safe to rerun
    Given `jolly init` has already been run
    When the agent invokes `jolly init` again
    Then Jolly should detect existing skills and guidance
    And it should update outdated managed guidance when appropriate
    And it should avoid overwriting unrelated user-authored instructions without approval
    And it should produce a concise summary of changes

  Rule: Init boundaries
    - `jolly init` is for local agent setup only.
    - `jolly init` may call or share logic with `jolly skills install`.
    - `jolly init` should not perform Saleor Cloud authentication, registration, configuration deployment, storefront creation, or Vercel deployment.
    - `jolly init` should not store secrets.
    - Exact per-agent instruction file targets remain open.
