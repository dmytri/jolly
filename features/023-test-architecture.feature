@meta
# Descriptive harness charter. The harness in features/support/ and tests/ already
# satisfies this; it is tagged @meta and excluded from the BDD worklist (cucumber.js).
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
    Then it should run with `npm test` without requiring any sandbox account or credentials
    And it should always run, including locally and in CI

  Scenario: Sandbox tests use real accounts through the runtime configuration
    Given a behavior depends on Saleor Cloud, Configurator, Vercel, or Stripe
    When the test exercises that behavior
    Then it should run against real accounts rather than mocks
    And it should read credentials from the same runtime `JOLLY_*` environment variables Jolly itself uses
    And there should be no parallel test-only credential namespace such as `JOLLY_TEST_*`
    And whether those credentials point at a dedicated test account or a real store is the customer's choice, invisible to Jolly and to the tests

  Scenario: Sandbox tests skip cleanly when credentials are absent
    Given the required `JOLLY_*` credentials are not present
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

  Scenario: Sandbox tests are harmless by design, even against a production store
    Given sandbox credentials are configured
    When the suite creates or modifies remote resources
    Then it should not attempt to detect or refuse production targets; the customer is trusted to choose the accounts
    And it must never read, modify, or delete any resource the test run did not itself create
    And every resource it creates must carry the unique per-run namespace and be left unpublished or inactive where the platform allows, so real shoppers never encounter it
    And it may change a shared store setting only when the change is additive and is reverted during teardown, such as adding and later removing a trusted origin
    And payment flows must use test card numbers only, so the worst case against live payment credentials is a declined card, never a real charge

  Scenario: Mocks are used only when a sandbox cannot produce the condition
    Given a behavior is a failure path or unavailable-capability branch that the sandbox cannot easily produce
    When testing that behavior
    Then a narrow test double may be used to inject the condition
    And mocks should not replace sandbox coverage of the normal path

  Rule: Test tiers
    - Logic tier: pure local behavior, no accounts, always runs via `npm test`; tagged `@logic`.
    - Sandbox tier: real Saleor Cloud, Configurator, Vercel, and Stripe accounts via the runtime `JOLLY_*` configuration — expected to be dedicated test accounts, by the customer's choice; tagged `@sandbox`.
    - Prefer the sandbox tier over mocks; use mocks only for conditions a sandbox cannot reasonably produce.

  Rule: Credentials and gating
    - Tests use the same runtime `JOLLY_*` environment variable names as Jolly itself, identical across dev, test, and production; there is no test-only credential namespace.
    - The vendor accounts behind those variables are expected to be dedicated test accounts, but that is the customer's choice to make and to set; Jolly and the tests do not know or check which kind they are.
    - When required `JOLLY_*` credentials are absent, `@sandbox` tests are skipped, not failed, with a clear reason.
    - Credentials are never printed and never committed; `.env` and credentials stay Git-ignored.
    - Harness-internal knobs (artifact path overrides, per-run id, runtime selection) are not Jolly settings: they use a `HARNESS_*` prefix and must not use `JOLLY_*` names.

  Rule: Harmless by design (production-safe tests)
    - The suite never name-checks, detects, or refuses a target; safety comes from how tests behave, not from guessing what the target is.
    - Tests never read, modify, or delete resources the run did not create.
    - Each run namespaces created resources with a unique identifier; created store resources stay unpublished/inactive where the platform allows so they are never customer-visible.
    - Shared-setting changes are allowed only when additive and reverted in teardown (for example trusted-origin entries).
    - Payment flows use test card numbers only; against live payment credentials the worst case is a declined card, never a charge.
    - Tests clean up resources they create; teardown is idempotent and best-effort, and anything it could not remove is reported by its namespaced identifier.
    - Tests must be safe to re-run, leaning on Jolly's own idempotency (feature 022).

  Rule: Layout and traceability
    - Feature files live in `features/`.
    - Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
    - Shared hooks, world, sandbox setup/teardown, and credential gating live in `features/support/`.
    - Logic-tier unit tests live in `tests/` and run via `npm test` (node --test), separate from the Cucumber suite.
    - Each `.feature` maps to a step-definition file of the same slug; every required step has executable coverage.
    - The QM owns creating and maintaining this harness, including the Cucumber configuration and test scripts.

  Rule: Open questions
    - CI wiring for providing sandbox credentials is deferred to implementation.
