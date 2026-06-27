Feature: Saleor source repositories and integration boundaries
  As a customer setting up a storefront through Jolly
  I want Jolly to use current Saleor repositories and avoid deprecated tooling
  So that my storefront setup is reliable and not coupled to legacy workflows

  Background:
    Given a fresh empty project directory

  @sandbox
  Scenario: Use Saleor Paper as the storefront baseline
    When the agent runs `jolly start --dry-run --json`
    Then the plan's storefront stage should name `saleor/storefront` as the baseline to clone
    And the plan should not name the deprecated `saleor` CLI as required to create the storefront

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

  @logic
  Scenario: Use Saleor Configurator through the official CLI
    When the agent runs `jolly start --dry-run --json`
    Then the plan's recipe stage should name the spawned command `npx @saleor/configurator deploy`

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
    - Automation flags include `--json`, `--quiet`, `--failOnDelete`, `--include`, `--exclude`, `--entity-type`, and `--entity`.
    - Current AGENTS guidance describes JSON envelope output with command, version, exitCode, result, logs, and errors.
    - Exit codes include 0 success, 2 authentication, 3 network, 4 validation, 5 partial failure, 6 deletion blocked, and 7 breaking blocked.
    - Reports may be saved under `.configurator/reports/<command>/`.
    - Configurator ships portable skills: `configurator-cli`, `configurator-schema`, `saleor-domain`, `product-modeling`, `configurator-recipes`, `data-importer`, `agent-output-parsing`, `configurator-workflow`, and `configurator-troubleshoot`.

  Rule: `saleor/agent-skills` research notes
    - Repository: https://github.com/saleor/agent-skills
    - Install command shape: `npx skills add saleor/agent-skills --skill <skill-name>`.
    - Current observed skills include `saleor-storefront`, `saleor-configurator`, `saleor-core`, `saleor-app`, and `storefront-builder`.
    - `saleor-storefront` covers framework-agnostic Storefront API patterns: data model, permissions, GraphQL patterns, checkout lifecycle, channels, purchasability, and variants.
    - `saleor-configurator` covers config.yml, entity identity, CLI workflow, deployment pipeline, diff behavior, and sync debugging.
    - `storefront-builder` is a stepwise framework-agnostic Saleor storefront playbook; it explicitly stops between steps and asks for user confirmation.
    - `saleor-core` covers backend internals such as discounts and stock availability; useful for advanced doctor/troubleshooting behavior.
    - `saleor-app` is relevant only if Jolly creates or configures Saleor apps, webhooks, or Dashboard iframe apps; it is not core to the first storefront-only path unless Paper's Saleor Cloud app setup becomes in scope.

  @logic
  Scenario: Jolly never depends on the deprecated Saleor CLI
    When the agent runs `jolly start --dry-run --json`
    Then no planned stage should spawn the `saleor` CLI binary
    And no planned stage should require the `saleor` CLI to be installed

  Rule: Deprecated `saleor/cli` research notes
    - Repository: https://github.com/saleor/cli
    - Published package historically exposed the `saleor` binary from `@saleor/cli`, `saleor-cli`, and `saleor` packages.
    - Treat this repo as deprecated source material only.
    - `register` currently points users to `https://cloud.saleor.io/signup` and may open it in the browser.
    - `login` uses browser OAuth/PKCE against `auth.saleor.io`; its headless mode accepted a pasted Cloud token.
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
    - Jolly targets Saleor Cloud only — never self-hosted Saleor. Jolly assumes a Saleor Cloud environment for store creation, configuration, and app-token acquisition. Self-hosted Saleor is permanently out of scope, not a roadmap item: Jolly orchestrates Cloud setup, it is not an infrastructure/provisioning tool.
    - `jolly start` delegates mechanical setup to official tools — `git` (cloning `saleor/storefront` from `main` unless the customer chooses another ref), `@saleor/configurator`, `pnpm`, and the Vercel CLI — while never reimplementing them against raw provider APIs.
    - All skills (the Jolly skill and the Saleor agent-skills) are installed via `npx skills add <ref>`, falling back to a Git-based install only for a skill not available that way (such as Paper's embedded skill, which arrives with the cloned storefront).
    - Use the deprecated `saleor/cli` only as research evidence for flows that are not otherwise documented; never invoke it.
    - Preserve upstream agent instructions and skills rather than duplicating all Saleor knowledge inside Jolly.
