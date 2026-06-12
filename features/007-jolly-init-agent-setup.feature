Feature: Jolly init for local agent setup
  As a customer's AI agent
  I want `jolly init` to prepare local agent guidance and skills
  So that `jolly start` (or a future re-initialization) can rely on skills being present

  Background:
    Given skill installation is fully automated — `jolly start` installs all Saleor agent skills automatically
    And the agent never runs `jolly init` or `jolly skills install` as an explicit separate step
    And `jolly init` remains available as a standalone command for repo re-initialization and maintenance

  @logic
  Scenario: Agent initializes Jolly guidance locally
    Given the agent can run Jolly via `npx`
    When the agent invokes `jolly init`
    Then Jolly should install or check the full default Saleor skill set
    And the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`
    And it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists
    And Jolly should report each skill as actually verified on disk, not unconditionally claim success
    And Jolly should write agent-specific glue files or instructions for supported environments
    And the glue files should actually exist on disk under standard project-local skill locations
    And Jolly should explain what was installed or updated
    And Jolly should not create remote Saleor Cloud or Vercel resources
    And Jolly should not store secrets

  @logic
  Scenario: Agent init is safe to rerun and detects existing state
    Given `jolly init` has already been run in a temp project directory
    When the agent invokes `jolly init` in the same directory again
    Then Jolly should detect the existing skills and guidance from the first run
    And it should report the existing state in the output envelope rather than erroring
    And it should update outdated managed guidance when appropriate
    And it should avoid overwriting unrelated user-authored instructions without approval
    And it should merge, not replace, any existing .mcp.json, adding the Jolly MCP server entry to the existing servers object rather than writing a fresh object
    And it should merge, not replace, any existing AGENTS.md or agent glue file, inserting or updating the Jolly section without removing user-authored content
    And it should produce a concise summary of changes

  @logic
  Scenario: Agent init is safe to rerun in a clean directory
    Given `jolly init` has not been run before
    When the agent invokes `jolly init` in a temp project directory
    Then Jolly should install the full default skill set
    And the output envelope should report a status of success
    And the summary should indicate what was installed

  Rule: Init boundaries
    - `jolly init` is automatically invoked by `jolly start` as part of the setup flow. The agent never runs it as an explicit step.
    - `jolly init` is available standalone for repo re-initialization and maintenance.
    - `jolly init` may call or share logic with `jolly skills install`.
    - `jolly init` should not perform Saleor Cloud authentication, registration, configuration deployment, storefront creation, or Vercel deployment.
    - `jolly init` should not store secrets.
    - Jolly must never silently overwrite an existing .mcp.json or AGENTS.md. Merge, never replace.
    - Skill installation output must reflect what was actually verified on disk, not pre-computed names. If a clone or install step fails, surface stderr and exit non-zero.
    - Exact per-agent instruction file targets remain open.
