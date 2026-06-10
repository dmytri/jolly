Feature: Saleor source repositories and integration boundaries
  As a customer setting up a storefront through Jolly
  I want Jolly to use current Saleor repositories and avoid deprecated tooling
  So that my storefront setup is reliable and not coupled to legacy workflows

  Background:
    Given Jolly is an agent-first product for setting up Saleor Cloud storefronts
    And Jolly must not implement Saleor backend capabilities
    And Jolly must not replace Saleor Dashboard
    And Jolly must not depend on the deprecated Saleor CLI
    And implementation agents should re-check upstream repositories at implementation time because they may change

  Scenario: Use Saleor Paper as the storefront baseline
    Given Jolly needs to create a storefront project
    When the customer's agent reaches the storefront creation step
    Then it should clone or directly use `saleor/storefront`
    And it should treat Paper as the first storefront baseline
    And it should preserve Paper's architecture unless the customer explicitly asks for customization
    And it should install and preserve Paper's agent guidance where applicable
    And it should not require the deprecated Saleor CLI to create the storefront

  Rule: `saleor/storefront` research notes
    - Repository: https://github.com/saleor/storefront
    - Product name: Paper.
    - Positioning: minimal, production-ready Saleor storefront template built for agents and humans.
    - Stack: Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind CSS, GraphQL Codegen, Saleor GraphQL API.
    - Package manager: pnpm.
    - Runtime expectation: Node 24.x according to current `package.json`.
    - Important commands: `pnpm dev`, `pnpm build`, `pnpm run generate`, `pnpm run generate:checkout`, `pnpm test`, `pnpm run typecheck`.
    - Required environment variables include `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL`.
    - Optional environment variables include `NEXT_PUBLIC_STOREFRONT_URL`, `REVALIDATE_SECRET`, `SALEOR_WEBHOOK_SECRET`, `SALEOR_APP_TOKEN`, `STOREFRONT_CHANNELS`, and `STOREFRONT_DISCOVER_CHANNELS`.
    - Important embedded agent files include root `AGENTS.md`, `skills/saleor-paper-storefront/SKILL.md`, `skills/saleor-paper-storefront/AGENTS.md`, rule files, migrations, and `paper-version.json`.
    - Paper's project skill depends on `saleor/agent-skills#saleor-storefront`.
    - Paper includes checkout, cart, product pages, product listings, navigation, SEO, caching, customer profile, authentication, and API resilience features.
    - Paper's Saleor Cloud Paper app can provide cache invalidation webhooks and Dashboard preview affordances; Jolly should not assume this is installed without checking.

  Scenario: Use Saleor Configurator directly for store configuration
    Given Jolly needs to inspect, plan, or apply Saleor store configuration
    When the agent has a Saleor Cloud GraphQL URL and app token
    Then Jolly CLI and/or Jolly skills should use `saleor/configurator` directly where appropriate
    And they should prefer configurator's safe workflow of validate, diff, plan, and deploy
    And they should parse structured output when available
    And they should require human approval before applying destructive or write operations

  Rule: `saleor/configurator` research notes
    - Repository: https://github.com/saleor/configurator
    - Package: `@saleor/configurator`.
    - Purpose: Commerce as Code for Saleor; define store configuration in YAML and sync it to a Saleor instance.
    - Supported Saleor version line is declared by `package.json#saleor.schemaVersion`; current observed value is `3.23`.
    - Runtime expectation: Node >=20.
    - Important commands: `start`, `introspect`, `diff`, `deploy`, `recipe list`, `recipe show`, `recipe apply`, and `recipe export`.
    - Credential inputs: Saleor GraphQL URL and app token, commonly via `SALEOR_URL` and `SALEOR_TOKEN`, or `--url` and `--token` flags.
    - App-token acquisition is currently documented as a Saleor Dashboard flow: Extensions -> Installed -> Add Extension -> Provide details manually -> assign permissions -> create token.
    - Configurator can introspect remote state into `config.yml`, show diffs, preview deploys with `deploy --plan`, and deploy configuration.
    - Configurator recipes should be Jolly's default mechanism for initial Saleor store configuration.
    - Automation flags include `--json`, `--quiet`, `--fail-on-delete`, `--fail-on-breaking`, `--include`, `--exclude`, `--entity-type`, and `--entity`.
    - Current AGENTS guidance describes JSON envelope output with command, version, exitCode, result, logs, and errors.
    - Exit codes include 0 success, 2 authentication, 3 network, 4 validation, 5 partial failure, 6 deletion blocked, and 7 breaking blocked.
    - Reports may be saved under `.configurator/reports/<command>/`.
    - Configurator ships portable skills: `configurator-cli`, `configurator-schema`, `saleor-domain`, `product-modeling`, `configurator-recipes`, `data-importer`, `agent-output-parsing`, `configurator-workflow`, and `configurator-troubleshoot`.

  Scenario: Install or reference universal Saleor agent skills
    Given the customer's agent environment supports agent skills
    When Jolly onboarding prepares the agent
    Then it should direct the agent to install relevant skills from `saleor/agent-skills`
    And it should include Paper's embedded skill after the storefront is cloned
    And it should explain which skills are mandatory, recommended, or situational

  Rule: `saleor/agent-skills` research notes
    - Repository: https://github.com/saleor/agent-skills
    - Install command shape: `npx skills add saleor/agent-skills --skill <skill-name>`.
    - Current observed skills include `saleor-storefront`, `saleor-configurator`, `saleor-core`, `saleor-app`, and `storefront-builder`.
    - `saleor-storefront` covers framework-agnostic Storefront API patterns: data model, permissions, GraphQL patterns, checkout lifecycle, channels, purchasability, and variants.
    - `saleor-configurator` covers config.yml, entity identity, CLI workflow, deployment pipeline, diff behavior, and sync debugging.
    - `storefront-builder` is a stepwise framework-agnostic Saleor storefront playbook; it explicitly stops between steps and asks for user confirmation.
    - `saleor-core` covers backend internals such as discounts and stock availability; useful for advanced doctor/troubleshooting behavior.
    - `saleor-app` is relevant only if Jolly creates or configures Saleor apps, webhooks, or Dashboard iframe apps; it is not core to the first storefront-only path unless Paper's Saleor Cloud app setup becomes in scope.

  Scenario: Study the deprecated Saleor CLI without depending on it
    Given some Saleor Cloud registration and setup behavior is poorly documented elsewhere
    When Jolly needs examples of legacy flows
    Then implementation agents may study `saleor/cli`
    But Jolly must not shell out to it
    And Jolly must not require customers or agents to install it
    And Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior

  Rule: Deprecated `saleor/cli` research notes
    - Repository: https://github.com/saleor/cli
    - Published package historically exposed the `saleor` binary from `@saleor/cli`, `saleor-cli`, and `saleor` packages.
    - Treat this repo as deprecated source material only.
    - `register` currently points users to `https://cloud.saleor.io/signup` and may open it in the browser.
    - `login` uses browser OAuth/PKCE against `auth.saleor.io`; headless login accepts a token from `https://cloud.saleor.io/tokens`.
    - Legacy Cloud API default URL observed in source: `https://cloud.saleor.io/platform/api`.
    - Legacy Cloud auth domain observed in source: `auth.saleor.io`.
    - Legacy config file observed in source: `~/.config/saleor.json`; Jolly should not rely on it.
    - Existing-instance examples validate a provided URL by sending a GraphQL introspection-style request to confirm it is a valid endpoint.
    - Existing-instance examples infer Saleor Cloud organization/environment by listing organizations and environments, then matching the instance host to an environment domain.
    - Cloud auth examples use browser OAuth/PKCE or headless token configuration to acquire a Saleor Cloud token.
    - App token examples select or create a Saleor local app, manage permissions, and call Saleor GraphQL `appTokenCreate` to produce an app token.
    - Jolly v1 should request all available permissions for its setup/configuration app token.
    - Trusted-origin examples patch `allowed_client_origins` for the Saleor Cloud environment.
    - Environment creation examples use organization, project, region, Saleor version, database template, domain label, and optional Basic Auth restriction.
    - Default region observed in source: `us-east-1`.
    - Demo storefront creation creates/selects a project, creates a sample database environment, then clones the storefront.
    - Legacy storefront create default template is `saleor/storefront`; default branch observed in deprecated source is `canary`, but Jolly should not inherit that default.
    - Legacy storefront create copied `.env.example` to `.env` and set `NEXT_PUBLIC_SALEOR_API_URL` from the chosen instance.
    - Legacy storefront deployment command is removed; Jolly should not model deployment on it.
    - Legacy Vercel login used a Saleor CLI Vercel integration OAuth flow; Jolly should validate modern Vercel setup separately.

  Rule: Jolly integration principles
    - Prefer official current repositories over deprecated tooling.
    - Default to cloning `saleor/storefront` from `main` unless the customer explicitly chooses another ref.
    - Use the deprecated CLI only as research evidence for flows that are not otherwise documented.
    - For the new-store registration branch, Jolly should use Saleor Cloud APIs programmatically where possible while consulting deprecated CLI source only as an example of the relevant API flow.
    - For the existing-store branch, Jolly should automate URL normalization, GraphQL validation, Saleor Cloud organization/environment inference, app token acquisition, and trusted-origin updates where possible, using deprecated CLI source only as example material.
    - Jolly should support both browser OAuth authentication and a headless token flow for Saleor Cloud access.
    - Make human-required browser/account steps explicit instead of pretending they can be fully automated.
    - Let the customer's agent decide approval granularity for actions that create, modify, deploy, or delete remote resources, while explaining risk and respecting customer/environment policies.
    - Prefer structured artifacts and parseable command output for agent reliability.
    - Preserve upstream agent instructions and skills rather than duplicating all Saleor knowledge inside Jolly.
