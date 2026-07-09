Feature: Composable stage commands
  As a customer's agent
  I want each stage `jolly start` performs to be its own composable command
  So that I can run, re-run, and verify any stage in isolation without the whole start pipeline

  Background:
    Given each side-effecting stage `jolly start` performs is also a first-class `jolly` command that runs that one stage against already-prepared preconditions, never the whole pipeline

  @sandbox @heavy
  Scenario: jolly deploy deploys the prepared storefront and makes the Vercel project turnkey
    Given a prepared storefront directory and a configured Saleor store
    When the agent runs `jolly deploy --yes --json`
    Then the `deploy` stage should report "completed" with the deployed `*.vercel.app` URL captured from the Vercel CLI's output
    And it should persist `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL` on the Vercel project through the Vercel CLI, so a plain `npx vercel deploy` re-deploy also builds them
    And it should write `NEXT_PUBLIC_DEFAULT_CHANNEL` to `.env`, so the local storefront and a re-deploy read the store channel with no key juggling
    And it should not provision a store, clone the storefront, or run any other stage

  @sandbox @heavy
  Scenario: jolly storefront prepares the Paper storefront alone
    Given a fresh project directory with no storefront prepared
    When the agent runs `jolly storefront --yes --json`
    Then the `storefront` stage should report "completed", backed by a real cloned Paper storefront with installed dependencies on disk
    And it should not provision a store, deploy, or run any other stage

  @sandbox @heavy
  Scenario: jolly recipe deploys the starter recipe alone
    Given the shared recipe store, whose starter recipe was deployed by a single `jolly recipe --yes --json` run against a freshly configured store
    Then that run should report the `recipe` stage "completed", having deployed the bundled starter recipe through `@saleor/configurator`
    And that run should not have provisioned a store, prepared the storefront, or deployed

  @sandbox @heavy
  Scenario: jolly stock seeds the recipe stock alone
    Given the shared recipe store, whose stock was seeded by a single `jolly stock --yes --json` run after its recipe was deployed
    Then that run should report the `stock` stage "completed", having seeded stock for the recipe variants through Saleor GraphQL
    And that run should not have deployed or run any other stage

  @sandbox @heavy
  Scenario: jolly stripe installs the Stripe app alone
    Given a configured Saleor store with a resolvable staff token
    When the agent runs `jolly stripe --yes --json`
    Then the `stripe` stage should report "completed" or "blocked" honestly, having attempted the Saleor app install for the Stripe payment app
    And it should not deploy or run any other stage

  @logic @exceptional-double
  Scenario: jolly start composes the stage seams in order
    Given the stage seams are replaced with recording spies
    When `jolly start --yes` runs its orchestration
    Then it should invoke the store, storefront, recipe, stock, deploy, and stripe seams in that order

  Rule: A stage command runs exactly one stage
    - Each command performs only its own stage against preconditions the caller has already met (a configured store, a prepared storefront, a deployed recipe), and never triggers another stage — so it is fast, independently runnable, and testable in isolation.
    - `jolly start` remains the orchestrator: it composes these same stage seams in order and behaves exactly as before. These commands add composability; they do not change `jolly start`.
