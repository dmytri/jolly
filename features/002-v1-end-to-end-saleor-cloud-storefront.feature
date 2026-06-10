Feature: V1 end-to-end Saleor Cloud storefront setup
  As a customer using their own AI agent
  I want Jolly to guide the agent through Saleor Cloud setup, storefront creation, and Vercel deployment
  So that I can get a fully operational Saleor-powered commerce experience online

  Background:
    Given Jolly operates through the customer's own agent
    And v1 supports Saleor Cloud only
    And Saleor backend capabilities are provided entirely by Saleor Cloud at saleor.io
    And Jolly does not add backend features to Saleor
    And Jolly does not replace Saleor Dashboard
    And Vercel is the first deployment target
    And Saleor's official `saleor/storefront` Paper template is the first storefront baseline
    And Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default
    And the storefront must not depend on Saleor's old CLI
    And Saleor's old CLI should be treated as deprecated but useful as undocumented registration/setup examples
    And `saleor/configurator` should be used directly by Jolly CLI and/or skills where appropriate
    And `saleor/agent-skills` and the agent instructions embedded in `saleor/storefront` should be used or drawn upon
    And the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete
    And Jolly focuses on local project scaffolding, deployment orchestration, skill management, diagnostics, and env/config automation
    And the customer's agent remains the primary orchestrator; Jolly provides capabilities and targeted automation
    And the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values
    And Jolly should proceed automatically with safe defaults wherever human input is not strictly required

  Scenario: Agent starts the Saleor Cloud setup journey
    Given the customer has copied the Jolly onboarding prompt into their agent
    When the agent begins the V1 setup journey
    Then it should give a brief welcome
    And it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront
    And it should ask whether the customer already has a Saleor store or wants to register one
    And it should identify which steps require human action outside the agent
    And it should avoid claiming that Jolly creates or owns the Saleor backend

  Scenario: Agent helps register a new Saleor Cloud store
    Given the customer says they want to register a Saleor store
    When the agent proceeds with the registration branch
    Then Jolly should use Saleor Cloud APIs programmatically where possible
    And Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback
    And Jolly should support a headless token flow when browser OAuth is unavailable or undesirable
    And Jolly should reuse an existing Saleor Cloud organization when available
    And Jolly should create a Saleor Cloud project and environment as needed for the new store
    And Jolly should use `saleor/configurator` recipes as the default mechanism for initial store configuration
    And Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational
    And Jolly may study the deprecated `saleor/cli` for examples of undocumented Saleor Cloud registration, authentication, project, and environment flows
    But Jolly must not require, invoke, shell out to, or install the deprecated Saleor CLI
    And the customer's agent should decide when human approval is needed before creating remote Saleor Cloud resources
    And the agent should explain the risk and rationale for any approval decision it makes
    And the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically
    And for new Saleor Cloud account creation, Jolly should direct the customer to saleor.io/cloud for the browser signup flow
    And Jolly should resume automatically once the customer provides the new store URL
    And Jolly should not attempt to automate the browser account signup itself

  Scenario: Agent connects an existing Saleor store as automatically as possible
    Given the customer says they already have a Saleor store
    When the agent needs to connect the storefront to Saleor
    Then Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible
    And Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding
    And when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments
    And Jolly should ask only for missing details it cannot infer automatically
    And Jolly should require an app token or equivalent credential for full existing-store setup
    And Jolly should acquire or create the app token automatically where Saleor APIs allow
    And Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available
    And it should explain where values come from in Saleor Cloud or Saleor Dashboard
    And it should treat secrets carefully through environment variables only
    And local secret values should be written to `.env` after ensuring `.env` is ignored by Git
    And Jolly should load updated `.env` values for the current command flow where possible
    And it should verify connectivity before proceeding to storefront setup

  Scenario: Agent creates a deployable storefront from Saleor Paper
    Given Saleor connectivity has been verified
    When the agent prepares the storefront project
    Then it should propose `storefront` as the default storefront target directory
    And it should handle directory name collisions safely
    And it should proceed with the default directory automatically
    And it should only pause if the default directory already exists and ask how to resolve the collision
    And it should clone or directly use Saleor's official `saleor/storefront` Paper template as the baseline
    And it should remove the cloned upstream `.git` history
    And it should initialize a fresh Git repository when needed for the customer's storefront workflow
    And it should validate the local Node.js version against Paper's current requirements
    And it should provide actionable guidance when the local Node.js version is incompatible
    And it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain
    And it should use Paper's expected package manager, `pnpm`, for the cloned storefront
    And it should install Paper storefront dependencies automatically by default
    And it should provide a way to skip dependency installation
    And it should run lightweight validation by default
    And it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible
    And it should provide actionable guidance if `pnpm` is missing
    And it should optionally install `pnpm` where possible when the agent/customer allows it
    And it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily
    And it should not use or require Saleor's old CLI for storefront creation
    And it should configure Jolly workflow credentials using `JOLLY_*` environment variables where appropriate
    And it should configure Paper-required storefront variables using Paper-compatible names such as `NEXT_PUBLIC_SALEOR_API_URL` and `SALEOR_APP_TOKEN`
    And it should account for channels, checkout, product pages, cart, authentication, customer profile features, and Stripe payment setup paths already supported by Paper and Saleor
    And it should produce tests/specs that define operational readiness for the configured storefront

  Scenario: Agent deploys to Vercel
    Given the storefront is ready for deployment
    When the agent guides Vercel deployment
    Then it should ask whether the customer already has a Vercel account
    And it should branch between existing Vercel account setup and new Vercel account registration guidance
    And it should identify required Vercel account/project steps
    And it should ask whether the customer wants Git repository setup when Git-based deployment is useful
    And GitHub should be the default Git provider
    And it should support GitHub repository creation/configuration where needed for Vercel
    And it should allow other Git providers such as Codeberg, Tangled, SourceHut, and Bitbucket when the customer prefers them
    And it should use Vercel CLI/API automation where possible
    And it should fall back to guided Vercel Git import flow when automation is unavailable or inappropriate
    And it should configure required environment variables in Vercel
    And it should use environment variables only for secrets in v1
    And local secret values should be written to `.env` after ensuring `.env` is ignored by Git
    And it should verify that the deployed storefront can reach Saleor Cloud
    And it should automatically update Saleor allowed/trusted origins for the deployed storefront URL where APIs allow
    And it should report the deployed URL and any remaining manual steps

  Rule: V1 operational readiness
    - The deployed storefront URL must work.
    - Product browsing must work against Saleor Cloud data.
    - Cart must work.
    - Checkout must progress to the Stripe test payment step.
    - Stripe is the v1 payment provider target.
    - Auth, account dashboard, address book, order history, deeper caching, and webhook behavior may be verified opportunistically but are not the minimum v1 acceptance bar.
    - Required Saleor Cloud setup steps and permissions must be clarified.
    - Required Vercel permissions and automation boundaries must be clarified.
    - Saleor allowed/trusted origins should be updated automatically after deployment where APIs allow.
    - Project-local Jolly artifacts such as `.jolly/` reports or state are deferred until CLI design; if added later, they must not contain secrets.
    - Local secrets should be stored as environment variables in `.env`, and `.env` must be ignored by Git.
    - Jolly workflow credentials should use `JOLLY_*` names; Paper/storefront runtime variables should use Paper-compatible names.

  Rule: Fast path principles
    - The end-to-end setup should require only the minimum human actions that cannot be automated.
    - Unavoidable human steps: new account creation (Saleor Cloud, Vercel, Stripe if needed), browser OAuth consent, and providing secret values such as Stripe API keys.
    - All other steps should be automated: cloning, env configuration, Configurator recipe application, Vercel project setup, and trusted-origin updates.
    - Jolly should use safe defaults and skip confirmation steps that do not protect against irreversible actions.
    - Jolly should never ask for information it can infer, detect, or safely default.
    - When a human step is required, Jolly should tell the agent exactly what to ask the customer for, then resume automatically once the value is provided.
    - For new Saleor Cloud accounts: direct the customer to saleor.io/cloud, wait for the resulting store URL, then automate everything from that point.
    - For Stripe test mode: the agent should ask for the Stripe publishable key and secret key from the Stripe Dashboard, write them to .env, and proceed without further manual steps.
