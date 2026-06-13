Feature: V1 end-to-end Saleor Cloud storefront setup
  As a customer using their own AI agent
  I want Jolly to guide the agent through Saleor Cloud setup, storefront creation, and Vercel deployment
  So that I can get a fully operational Saleor-powered commerce experience online

  Background:
    Given Vercel is the first deployment target
    And Saleor's official `saleor/storefront` Paper template is the first storefront baseline
    And Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default
    And the customer's own agent performs the CLI steps (clone, configure, deploy), guided by the Jolly skill that Jolly installs
    And Jolly's role is the thin plumbing (auth, store/app-token via the Cloud API, secret writing, `.mcp.json`, skill install) plus `jolly doctor` verification — Jolly never shells out to the Vercel CLI or `@saleor/configurator`
    And `@saleor/configurator` is run by the agent directly for store configuration and recipes
    And the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete
    And the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values

  @logic
  Scenario: Agent starts the Saleor Cloud setup journey
    Given the customer has copied the Jolly onboarding prompt into their agent
    When the agent begins the V1 setup journey
    Then it should ask whether the customer already has a Saleor store or wants to register one
    And it should identify which steps require human action outside the agent

  @sandbox
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
    And the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically
    And for new Saleor Cloud account creation, Jolly should direct the customer to cloud.saleor.io for the browser signup flow
    And Jolly should resume automatically once the customer provides the new store URL
    And Jolly should not attempt to automate the browser account signup itself

  @sandbox
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
    And it should verify connectivity before proceeding to storefront setup

  @sandbox
  Scenario: Agent creates a deployable storefront from Saleor Paper
    Given Saleor connectivity has been verified
    When the agent prepares the storefront project
    Then it should propose `storefront` as the default storefront target directory
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
    And it should run lightweight validation by default
    And it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible
    And it should provide actionable guidance if `pnpm` is missing
    And it should optionally install `pnpm` where possible when the agent/customer allows it
    And it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily

  @sandbox
  Scenario: Agent deploys to Vercel via the official Vercel CLI
    Given the storefront is ready for deployment
    When the agent deploys to Vercel following the Jolly skill
    Then the agent should deploy exclusively through the official Vercel CLI (`npx vercel`)
    And the agent should authenticate only via the Vercel CLI's own `vercel login` session
    And when the Vercel CLI is not authenticated, the Jolly skill should direct the human to run `npx vercel login` and resume afterward
    And Jolly's own code should send no request to api.vercel.com and hold no Vercel token
    And the agent should not fall back to any other deployment mechanism such as a guided Git import flow
    And the agent should configure required environment variables on the Vercel project through the Vercel CLI
    And `jolly doctor` should verify that the deployed storefront can reach Saleor Cloud
    And the agent should update Saleor allowed/trusted origins for the deployed storefront URL where APIs allow
    And the deployed URL and any remaining manual steps should be reported

  Rule: Deployment tooling (decision 2026-06-13)
    - Vercel deployment is performed by the customer's agent using the official Vercel CLI (`npx vercel`), guided by the Jolly skill; neither Jolly nor anyone reimplements Vercel deployment against api.vercel.com.
    - Jolly never shells out to the Vercel CLI and holds no Vercel credential. The only Vercel authentication is the Vercel CLI's own `vercel login` session; there is no `JOLLY_VERCEL_TOKEN`.
    - New Vercel account signup and login are the human browser steps; the Jolly skill directs the human to `npx vercel login` and the agent resumes afterward.
    - GitHub remains the default Git provider for optional source-control setup; other providers are deferred to v2. Git setup is convenience, not the deployment mechanism — deployment is always the Vercel CLI.
    - See feature 008 Rule "Thin surface — the agent runs the official CLIs, Jolly does not" and feature 020's amended "First-party hosts only".

  Rule: V1 operational readiness
    - The deployed storefront URL must work.
    - Product browsing must work against Saleor Cloud data.
    - Cart must work.
    - Checkout must progress to the Stripe test payment step.
    - Stripe is the v1 payment provider target.
    - Auth, account dashboard, address book, order history, deeper caching, and webhook behavior may be verified opportunistically but are not the minimum v1 acceptance bar.
    - Saleor allowed/trusted origins should be updated automatically after deployment where APIs allow.

  Rule: Fast path principles
    - The end-to-end setup should require only the minimum human actions that cannot be automated.
    - Unavoidable human steps: new account creation (Saleor Cloud, Vercel, Stripe if needed), browser OAuth consent, and providing secret values such as Stripe API keys.
    - All other steps should be automated: cloning, env configuration, Configurator recipe application, Vercel project setup, and trusted-origin updates.
    - Jolly should use safe defaults and skip confirmation steps that do not protect against irreversible actions.
    - Jolly should never ask for information it can infer, detect, or safely default.
    - When a human step is required, Jolly should tell the agent exactly what to ask the customer for, then resume automatically once the value is provided.
    - For new Saleor Cloud accounts: direct the customer to cloud.saleor.io, wait for the resulting store URL, then automate everything from that point.
    - For Stripe test mode: the agent should ask for the Stripe publishable key and secret key from the Stripe Dashboard, write them to .env, and proceed without further manual steps.
