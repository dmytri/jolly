Feature: Test architecture and sandbox-first strategy
  As the Quartermaster building executable coverage
  I want a clear, sandbox-first test architecture
  So that I can write durable tests against real Saleor, Vercel, and Stripe behavior without inventing conventions

  Background:
    Given Jolly is a CLI exercised through `npx`
    And feature 020 defines the output envelope, 021 the risk context, and 022 idempotency and resumability

  Scenario: Logic tests run without any accounts
    Given a behavior is pure local logic such as output-envelope shaping, flag parsing, URL normalization, or risk-context construction
    When the test runs
    Then it should run with `bun test` without requiring any sandbox account or credentials
    And it should always run, including locally and in CI

  Scenario: Sandbox tests use real test accounts
    Given a behavior depends on Saleor Cloud, Configurator, Vercel, or Stripe
    When the test exercises that behavior
    Then it should run against real dedicated test/sandbox accounts rather than mocks
    And it should read credentials from `JOLLY_TEST_*` environment variables
    And Stripe behavior should use Stripe test mode

  Scenario: Sandbox tests skip cleanly when credentials are absent
    Given the required `JOLLY_TEST_*` credentials are not present
    When the sandbox test suite runs
    Then sandbox-tagged tests should be reported as skipped, not failed
    And logic-tier tests should still run and pass
    And the skip reason should state which credentials are missing

  Scenario: Sandbox tests isolate and clean up real resources
    Given a sandbox test creates real resources such as a Saleor environment, a storefront clone, or a Vercel project
    When the test runs
    Then it should namespace created resources with a unique per-run identifier so repeated and parallel runs do not collide
    And it should remove the resources it created during teardown
    And teardown should be idempotent and best-effort, reporting any resources it could not remove
    And tests should be safe to re-run, consistent with feature 022

  Scenario: Sandbox tests refuse to touch non-sandbox accounts
    Given sandbox credentials are configured
    When the suite is about to create or modify remote resources
    Then it should verify it is targeting the dedicated test/sandbox account before proceeding
    And it should refuse to run against a customer or production account

  Scenario: Mocks are used only when a sandbox cannot produce the condition
    Given a behavior is a failure path or unavailable-capability branch that the sandbox cannot easily produce
    When testing that behavior
    Then a narrow test double may be used to inject the condition
    And mocks should not replace sandbox coverage of the normal path

  Rule: Test tiers
    - Logic tier: pure local behavior, no accounts, always runs via `bun test`; tagged `@logic`.
    - Sandbox tier: real test/sandbox accounts for Saleor Cloud, Configurator, Vercel, and Stripe test mode; tagged `@sandbox`.
    - Prefer the sandbox tier over mocks; use mocks only for conditions a sandbox cannot reasonably produce.

  Rule: Credentials and gating
    - Test/sandbox credentials use `JOLLY_TEST_*` environment variable names, distinct from runtime `JOLLY_*` names.
    - When required `JOLLY_TEST_*` credentials are absent, `@sandbox` tests are skipped, not failed, with a clear reason.
    - Credentials are never printed and never committed; `.env` and test credentials stay Git-ignored.

  Rule: Isolation and cleanup
    - Each run namespaces created resources with a unique identifier.
    - Tests clean up resources they create; teardown is idempotent and best-effort.
    - Tests must be safe to re-run, leaning on Jolly's own idempotency (feature 022).
    - Sandbox suites must confirm they target a dedicated test account and refuse customer/production accounts.

  Rule: Layout and traceability
    - Feature files live in `features/`.
    - Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
    - Shared hooks, world, sandbox setup/teardown, and credential gating live in `features/support/`.
    - Each `.feature` maps to a step-definition file of the same slug; every required step has executable coverage.
    - The QM owns creating and maintaining this harness, including the Cucumber configuration and test scripts.

  Rule: Open questions
    - The exact full set of `JOLLY_TEST_*` credential names is finalized as commands are implemented; the convention above is sufficient to write gated tests now.
    - CI wiring for providing sandbox credentials is deferred to implementation.
