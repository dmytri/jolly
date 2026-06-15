@meta
# Descriptive harness charter. The harness in features/support/ and tests/ already
# satisfies this; it is tagged @meta and excluded from the BDD worklist (cucumber.js).
Feature: Test architecture and sandbox-first strategy
  As the test harness maintainer
  I want a clear, sandbox-first test architecture
  So that I can write durable tests against real Saleor, Vercel, and Stripe behavior without inventing conventions

  Background:
    Given Jolly is a CLI exercised through `npx`
    And feature 020 defines the output envelope, 021 the risk context, and 022 idempotency and resumability

  Scenario: Logic tests run without any accounts
    Given a behavior is pure local logic such as output-envelope shaping, flag parsing, URL normalization, or risk-context construction
    When the test runs
    Then it should run with the project's `test` script (Node-native: `node --test`) without requiring any sandbox account or credentials
    And it should always run, including locally and in CI

  Scenario: Sandbox tests use real accounts through the runtime configuration
    Given a behavior depends on Saleor Cloud, Configurator, Vercel, or Stripe
    When the test exercises that behavior
    Then it should run against real accounts rather than mocks
    And it should read credentials from the same runtime `JOLLY_*` environment variables Jolly itself uses
    And there should be no parallel test-only credential namespace such as `JOLLY_TEST_*`
    And whether those credentials point at a dedicated test account or a real store is the customer's choice, invisible to Jolly and to the tests

  Scenario: Sandbox tests provision missing Saleor endpoints instead of skipping
    Given a sandbox scenario needs a Saleor endpoint or app token that is not configured
    And `JOLLY_SALEOR_CLOUD_TOKEN` is present
    When the sandbox test suite runs
    Then the harness should provision one shared Saleor Cloud environment for the run, carrying the per-run `jolly-test` namespace
    And it should derive `NEXT_PUBLIC_SALEOR_API_URL` and `JOLLY_SALEOR_APP_TOKEN` from that environment for the whole run
    And it should tear the provisioned environment down when the run ends, per feature 012's self-cleaning rules
    And the scenarios should run rather than skip

  Scenario: Sandbox tests skip cleanly only when credentials cannot be derived
    Given required credentials are absent and cannot be derived, such as a missing `JOLLY_SALEOR_CLOUD_TOKEN` or absent Vercel or Stripe credentials
    When the sandbox test suite runs
    Then those sandbox-tagged tests should be reported as skipped, not failed
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
    And it must never modify or delete any resource the test run did not itself create
    And it may read pre-existing resources only through read-only, non-mutating queries, and only where a spec requires verifying live access with the customer's configured credentials, as feature 019 does
    And every resource it creates must carry the unique per-run namespace and be left unpublished or inactive where the platform allows, so real shoppers never encounter it
    And it may change a shared store setting only when the change is additive and is reverted during teardown, such as adding and later removing a trusted origin
    And payment flows must use test card numbers only, so the worst case against live payment credentials is a declined card, never a real charge

  Scenario: Mocks are used only when a sandbox cannot produce the condition
    Given a behavior is a failure path or unavailable-capability branch that the sandbox cannot easily produce
    When testing that behavior
    Then a narrow test double may be used to inject the condition
    And mocks should not replace sandbox coverage of the normal path

  Rule: Test tiers
    - Logic tier: pure local behavior, no accounts, always runs via the `test` script (`node --test`); tagged `@logic`.
    - Sandbox tier: real Saleor Cloud, Configurator, Vercel, and Stripe accounts via the runtime `JOLLY_*` configuration — expected to be dedicated test accounts, by the customer's choice; tagged `@sandbox`.
    - Eval tier (feature 025): the opt-in skill-behavior affordance evaluation — a baseline agent driven over the real skill and CLI in a safe, bounded workspace. Tagged `@eval`; like `@meta` it is EXCLUDED from the default profile (`not @meta and not @eval`) and runs only via an explicit `eval` profile/command; skip-not-fail when its agent/model credential is absent. It never gates normal CI.
    - Eval transcript keeping (opt-in): because a baseline-agent run is non-deterministic, the eval supports persisting a run's evidence for after-the-fact understanding. When `HARNESS_EVAL_TRANSCRIPT_DIR` is set (default unset → the run's throwaway temp dir, kept nowhere), the harness writes, before teardown and under a per-run namespaced subdir, the agent's full stdout/stderr, the Jolly-invocation trace, the Stripe-CLI trace, and the final workspace `.env` — scrubbing `HARNESS_OPENROUTER_API_KEY` from the text. It is observability only: it never changes pass/fail and the agent still runs under forced-safe credentials. (pi runs in print mode, so "stdout" is its final summary, not step-by-step reasoning.)
    - Prefer the sandbox tier over mocks; use mocks only for conditions a sandbox cannot reasonably produce.

  Rule: Credentials and gating
    - Tests use the same runtime `JOLLY_*` environment variable names as Jolly itself, identical across dev, test, and production; there is no test-only credential namespace.
    - The vendor accounts behind those variables are expected to be dedicated test accounts, but that is the customer's choice to make and to set; Jolly and the tests do not know or check which kind they are.
    - When a needed Saleor endpoint or app token is not configured but `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness provisions a shared per-run environment (feature 012's namespacing and self-cleaning rules) and derives the missing values from it, rather than skipping.
    - `@sandbox` tests are skipped, not failed, with a clear reason only when the needed credentials are absent and cannot be derived: `JOLLY_SALEOR_CLOUD_TOKEN` itself, or third-party Vercel/Stripe credentials. Capacity-limit rejections such as feature 012's `ENVIRONMENT_LIMIT_REACHED` remain environmental skips.
    - Credentials are never printed and never committed; `.env` and credentials stay Git-ignored.
    - Harness-internal knobs (artifact path overrides, per-run id, runtime selection) are not Jolly settings: they use a `HARNESS_*` prefix and must not use `JOLLY_*` names.

  Rule: Harmless by design (production-safe tests)
    - The suite never name-checks, detects, or refuses a target; safety comes from how tests behave, not from guessing what the target is.
    - Tests never modify or delete resources the run did not create; reading pre-existing resources is allowed only via read-only, non-mutating queries where a spec requires verifying live access.
    - Each run namespaces created resources with a unique identifier; created store resources stay unpublished/inactive where the platform allows so they are never customer-visible.
    - Shared-setting changes are allowed only when additive and reverted in teardown (for example trusted-origin entries).
    - Payment flows use test card numbers only; against live payment credentials the worst case is a declined card, never a charge.
    - Tests clean up resources they create; teardown is idempotent and best-effort, and anything it could not remove is reported by its namespaced identifier.
    - Tests must be safe to re-run, leaning on Jolly's own idempotency (feature 022).

  Rule: Layout and traceability
    - Feature files live in `features/`.
    - Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
    - Shared hooks, world, sandbox setup/teardown, and credential gating live in `features/support/`.
    - Logic-tier unit tests live in `tests/` and run via `node --test` (using `node:test` + `node:assert`), separate from the Cucumber suite.
    - Package scripts are Node-native: `node --test` for units, Cucumber.js and `tsc` run under Node, and the published bundle built with esbuild. Node >= 23's native type stripping loads the TypeScript sources directly (project files, not under `node_modules`).
    - Each `.feature` maps to a step-definition file of the same slug; every required step has executable coverage.
    - The harness includes the Cucumber configuration and test scripts needed for executable coverage.

  Rule: Open questions
    - CI wiring for providing sandbox credentials is deferred to implementation.
