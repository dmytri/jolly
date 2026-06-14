Feature: V1 end-to-end Saleor Cloud storefront setup
  As a customer using their own AI agent
  I want Jolly to guide the agent through Saleor Cloud setup, storefront creation, and Vercel deployment
  So that I can get a fully operational Saleor-powered commerce experience online

  Background:
    Given Vercel is the first deployment target
    And Saleor's official `saleor/storefront` Paper template is the first storefront baseline
    And Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default
    And `jolly start` performs the mechanical CLI steps itself by spawning the official CLIs (`git` clone, `pnpm` install, `@saleor/configurator` deploy, `npx vercel` deploy), each under its own auth — never reimplementing them against raw APIs
    And the customer's agent supervises: it approves each high-risk stage's `riskContext`, provides credentials, and completes the human gates, and may run any stage as a composable command itself
    And Jolly's own plumbing covers auth, store/app-token via the Cloud API, secret writing, `.mcp.json`, skill install, and `jolly doctor` verification
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
  Scenario: Jolly start creates a deployable storefront from Saleor Paper
    Given Saleor connectivity has been verified
    When `jolly start` prepares the storefront project by spawning `git` and `pnpm`
    Then it should use `storefront` as the default storefront target directory and proceed automatically
    And it should only pause if the default directory already exists and ask how to resolve the collision
    And it should clone Saleor's official `saleor/storefront` Paper template from `main` by spawning `git`, remove the upstream `.git` history, and initialize a fresh repository
    And it should install Paper's dependencies by spawning `pnpm`
    And it should validate the local Node.js version against Paper's current requirements and give actionable guidance on a mismatch, without installing or switching Node.js itself
    And it should give actionable guidance if `pnpm` is missing, optionally installing it where the agent/customer allows
    And `jolly doctor storefront --full-validation` should run full Paper validation such as generate, typecheck, build, or tests where feasible
    And it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily

  @sandbox
  Scenario: Jolly start deploys to Vercel by spawning the official Vercel CLI
    Given the storefront is ready for deployment
    When `jolly start` deploys to Vercel
    Then it should emit the deploy stage's feature 021 `riskContext` and pause for the agent to approve before deploying
    And it should deploy exclusively by spawning the official Vercel CLI (`npx vercel`), under the CLI's own `vercel login` session
    And when the Vercel CLI is not authenticated, it should run `vercel login` with stdio passed through and continue on its exit
    And Jolly's own code should send no request to api.vercel.com and hold no Vercel token
    And it should not fall back to any other deployment mechanism such as a guided Git import flow
    And it should configure the required environment variables on the Vercel project through the Vercel CLI
    And it should surface Vercel Deployment Protection (on by default) for the human or agent to disable so the store is publicly reachable
    And it should update Saleor allowed/trusted origins for the deployed storefront URL where APIs allow
    And `jolly doctor` should verify that the deployed storefront can reach Saleor Cloud
    And it should report the deployed URL and any remaining manual steps

  Rule: Agent-supervised orchestration — `jolly start` runs the CLIs (decision 2026-06-14, SUPERSEDES the "agent runs the CLIs" framing of this feature)
    - For `jolly start`, this rule governs. The "Jolly start creates a deployable storefront" and
      "Jolly start deploys to Vercel" scenarios above assert the orchestrated behavior; the
      Background and "Fast path principles" reflect Jolly spawning the CLIs. Each orchestrated stage
      also remains a composable command the agent can run itself (feature 008).
    - `jolly start` is a resumable end-to-end runner that performs the mechanical stages itself by
      SPAWNING the official CLIs: `git` clone of Paper (strip `.git`, fresh `git init`), `pnpm
      install`, `@saleor/configurator diff`/`deploy` of the starter recipe, and `npx vercel`
      deploy + env-var setup — alongside its own plumbing (`login`, `create store`/`app-token`,
      the read-only `create stripe` import, `init`, `doctor`).
    - It spawns official, current CLIs only — never reimplementing them against raw APIs. Each
      spawned CLI uses its OWN auth (Vercel CLI session, the Saleor app token Jolly manages, the
      Stripe keys); there is still no `JOLLY_VERCEL_TOKEN` and api.vercel.com is not in Jolly's own
      allowlist. The deprecated `saleor/cli` stays banned.
    - Interactive CLI gates are stdio passthrough: when a spawned CLI needs the user (`vercel
      login`, `stripe login`), Jolly runs it with the terminal passed straight through, the user
      interacts with that CLI directly, and Jolly continues on the child's exit — exit 0 → next
      stage; non-zero → stop honestly (no fabricated success).
    - Non-CLI human gates are announce-and-wait: account creation, the Saleor Dashboard Stripe-app
      configuration + channel mapping, and pasting a secret no CLI hands over are printed (in the
      feature 020 envelope) and Jolly waits for completion, then resumes. Vercel Deployment
      Protection, which is on by default and blocks public access, is likewise surfaced for the
      human/agent to disable (it is a project setting, not a deploy step).
    - The agent is the approval authority: before each high-risk action (`create store`,
      configurator `deploy`, the Vercel deploy) `start` emits the feature 021 `riskContext` and
      pauses for the agent to approve; an agent pre-authorization flag runs through when allowed.
    - Every orchestrated stage is also a composable command the agent can run independently;
      `start` chains them and is resumable (feature 022), skipping satisfied stages.

  Rule: Git provider for optional source control (decision 2026-06-13)
    - GitHub is the default Git provider for optional source-control setup; other providers are deferred to v2.
    - Git setup is convenience, not the deployment mechanism — deployment is always the official Vercel CLI (`npx vercel`), now spawned by `jolly start` (see "Agent-supervised orchestration"). The durable Vercel invariants (official CLI only, its own `vercel login` session, no `JOLLY_VERCEL_TOKEN`, no `api.vercel.com` in Jolly's own code) live in that rule and feature 020's "First-party hosts only".

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
    - For Stripe test mode: `jolly start` installs the Saleor Stripe app (`appInstall`), imports test keys via the read-only Stripe CLI where a `stripe login` session exists (`jolly create stripe`), and runs a guided gate for the Dashboard key entry and `us`-channel mapping that no public API can perform (feature 005); pasting Dashboard keys stays the always-supported alternative.
