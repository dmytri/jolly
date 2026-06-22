Feature: Live-by-design verification conformance
  As the maintainer of Jolly's verification suite
  I want the verification layer to exercise real services, never a forbidden test double
  So that a green suite proves real behavior and the no-fakes rule enforces itself instead of living only as prose

  @logic @property
  Scenario: Jolly's verification layer uses no forbidden test double
    Given Jolly's step definitions and test support code
    When the test doubles they use are enumerated
    Then there should be no forbidden double — no fake CLI standing in for a real one (Stripe, Vercel, @saleor/configurator, the storefront CLI), no dummy or forced-safe credential, and no unroutable stand-in endpoint substituting for a real service
    And any test double that remains should belong to a scenario tagged @exceptional-double whose site names the unproducible condition it injects

  @logic @property
  Scenario: The eval seeds only authentication credentials, never a pre-provisioned store
    Given the eval harness's workspace `.env` seed
    When the credential variables it writes are enumerated
    Then the seed should include only the credentials the agent needs to authenticate — the Saleor Cloud token and any Cloud API override
    And it should omit the store endpoint `NEXT_PUBLIC_SALEOR_API_URL` and the `JOLLY_SALEOR_APP_TOKEN`, so a baseline agent's `jolly start` provisions a fresh `jolly-test` store on the real creation path instead of reusing a pre-seeded one

  @sandbox
  Scenario: The eval reclaims a leftover jolly-test environment before a run provisions
    Given a leftover `jolly-test`-namespaced Saleor environment standing in the org from a previous run
    When the eval performs its pre-run capacity reclamation
    Then the leftover `jolly-test`-namespaced environment should no longer exist in the org
    And every environment lacking the `jolly-test` prefix should still be present afterward

  @sandbox
  Scenario: The @sandbox provisioner reclaims a leftover jolly-test environment instead of skipping the run
    Given a leftover `jolly-test`-namespaced Saleor environment standing in the org from a previous run
    When the @sandbox harness provisions its shared environment for a run
    Then it should reclaim the leftover `jolly-test`-namespaced environment and provision the run's environment, not skip the run
    And every environment lacking the `jolly-test` prefix should still be present afterward

  Rule: Live-by-design conformance
    - Binding test methodology lives in AGENTS.md ("Real services always — never mock or fake"); this feature makes its one testable invariant executable, so a suite that is green while still carrying a forbidden double fails here instead of passing silently.
    - A forbidden double is any stand-in for the normal path: a fake CLI replacing a real one, a dummy or forced-safe credential, or an unroutable endpoint replacing a real service.
    - The only admissible double is one tagged @exceptional-double: an exceptional condition the real test env cannot produce on demand — an organization already at its environment limit (`ENVIRONMENT_LIMIT_REACHED`), or a deliberately unreachable service for a "stored, not verified" path — justified inline at its site. A failure reachable from real bad input (empty or garbage token, malformed or non-first-party URL, a genuinely absent store) is produced for real, never doubled.
    - This is a testable conformance invariant about Jolly's verification layer, not a product behavior. It is an admissible scenario because it is falsifiable (it is currently false), not aspiration: the discriminator for a scenario is testability, not whether its subject is the product or the harness.
    - When the invariant fails on a double in an untagged scenario, the fix is to make that scenario real if the condition is producible, or — if it is a genuine unproducible exception — to record it as an @exceptional-double via the Captain, never to widen this rule.

  Rule: The eval exercises the real store-creation path
    - Feature 025 requires the eval workspace to be seeded with only the credentials a baseline agent needs to AUTHENTICATE, leaving the store endpoint and app token unset so `jolly start` provisions a fresh `jolly-test` store. This feature makes that one clause executable in the gating tier: `@eval` never gates CI, so a harness that silently seeds a pre-provisioned store would otherwise pass unnoticed — and a pre-seeded endpoint makes `jolly start` treat the store as pre-existing, so the configurator's `--failOnDelete` guard blocks the starter recipe and the live stages can never complete.
    - Feature 025 also requires the harness to reclaim capacity BEFORE the agent provisions — deleting leftover `jolly-test`-namespaced environments from previous runs (the same reclamation the `@sandbox` provision path performs) so a finite org environment limit never starves the run at its store stage. This feature gates that clause behaviorally: `@eval` never runs in CI, so an eval carrying only teardown and no pre-run reclamation would silently let leftovers fill the org and the live store stage would fail unobserved. A pure selection check would pass against never-called reclamation code, so the conformance is the observable effect — a real leftover is gone afterward — and only `jolly-test`-namespaced environments are ever deleted.
