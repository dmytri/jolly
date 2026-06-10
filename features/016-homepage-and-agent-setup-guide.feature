Feature: Jolly homepage and agent setup guide
  As a customer who wants a Saleor storefront
  I want the Jolly homepage to give me a copyable agent prompt and clear setup guidance
  So that my own AI agent can start the Jolly flow without me reading a long manual first

  @logic
  Scenario: Customer sees the homepage hero
    Given the customer visits the Jolly homepage
    When the homepage loads
    Then it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront
    And it should position Jolly as Saleor's Hydrogen for the agentic age
    And it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor
    And it should make clear that the primary path starts by copying instructions into the customer's agent
    And it should set the expectation that setup takes minutes with minimal manual steps

  @logic
  Scenario: Customer copies the agent setup prompt
    Given the customer is on the homepage
    When they view the primary copy box
    Then the copy box should say "copy this to your agent to get started"
    And it should provide a copyable prompt for the customer's agent
    And the prompt should include the Jolly homepage/setup-guide URL
    And the prompt should instruct the agent to read the setup guide
    And the prompt should instruct the agent to run Jolly via `npx`
    And the prompt should instruct the agent to use Jolly CLI skill management
    And the prompt should instruct the agent to run `jolly start`

  @logic
  Scenario: Agent follows the setup guide
    Given the customer pasted the copied prompt into an agent
    When the agent opens or reads the setup guide
    Then it should see generic agent instructions
    And it should see that Jolly exists to empower the agent, not replace it
    And it should see the Saleor MCP server URL (mcp.saleor.app) for read-only live store data access after setup
    And it should understand that Jolly handles setup automation while the MCP server enables the agent to query live store data post-setup
    And it should see supported agent targets: Zed, Claude Code, Cursor, OpenCode, and Pi.dev
    And it should see production invocation examples using `npx @saleor/jolly`
    And it should see testing invocation examples using `npx @dk/jolly`
    And it should see the recommended command sequence starting with `jolly init`, `jolly skills install`, and `jolly start`

  @logic
  Scenario: Homepage explains the v1 journey
    Given the customer wants to understand what Jolly will do
    When they read the homepage
    Then it should summarize the v1 flow
    And the flow should include checking whether the customer already has a Saleor store or wants to register one
    And the flow should include Saleor Cloud setup or connection
    And the flow should include Configurator-based store configuration
    And the flow should include cloning Saleor Paper
    And the flow should include Stripe test-mode checkout setup
    And the flow should include Vercel deployment
    And the flow should include automatic trusted-origin updates where possible
    And the flow should include final verification of deployed product browsing, cart, and checkout to Stripe test payment step
    And the flow should explain that after setup, the agent and Jolly help the customer iterate and customize their commerce experience

  @logic
  Scenario: Homepage explains boundaries
    Given the customer is evaluating Jolly
    When they read the homepage
    Then it should state that v1 supports Saleor Cloud only
    And it should state that Jolly does not replace Saleor Dashboard
    And it should state that Jolly uses the customer's own agent and workflow for post-setup iteration

  Rule: Homepage content sections
    - Hero: short Jolly promise and primary copy box.
    - How it works: copy prompt, initialize skills, run `jolly start`, verify deployment, then customize with the customer's own agent.
    - Supported agents: generic agents, Zed, Claude Code, Cursor, OpenCode, Pi.dev.
    - CLI quick start: `npx @saleor/jolly init`, `npx @saleor/jolly skills install`, `npx @saleor/jolly start`.
    - Testing quick start: `npx @dk/jolly ...` equivalents.
    - Jolly's role: empowers the agent as a capability layer; the customer's agent is the workflow orchestrator.
    - Speed promise: minimal human steps — only account creation, OAuth consent, and pasting secret keys.
    - Iteration phase: after setup, the agent and Jolly help the customer customize and maintain their store.
    - MCP server: the Saleor MCP server (mcp.saleor.app) provides read-only live store data access after setup; Jolly handles setup automation and diagnostics.
    - V1 scope: Saleor Cloud, Paper, Configurator recipe, Stripe test mode, Vercel.
    - Boundaries: not a Saleor backend, not Dashboard replacement, not old Saleor CLI, no telemetry.

  Rule: Copy-box prompt requirements
    - The prompt should be concise enough to paste into an agent.
    - The prompt should include the setup-guide URL.
    - The prompt should be minimal; full context, MCP server details, and workflow guidance belong in the setup guide at the linked URL.

  Rule: Open questions
    - Canonical homepage/setup-guide URL is deferred; specs should use a placeholder until decided.
    - Homepage implementation shape is left to the implementation agent: static page, small app, or generated docs page are acceptable if they satisfy the required single-page landing and setup-guide behavior.
