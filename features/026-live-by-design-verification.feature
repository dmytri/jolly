Feature: Live-by-design verification conformance
  As the maintainer of Jolly's verification suite
  I want the verification layer to exercise real services, never a forbidden test double
  So that a green suite proves real behavior and the no-fakes rule enforces itself instead of living only as prose

  @logic @property
  Scenario: Jolly's verification layer uses no forbidden test double
    Given Jolly's step definitions and test support code
    When the test doubles they use are enumerated
    Then there should be no forbidden double — no fake CLI standing in for a real one (Vercel, @saleor/configurator, the storefront CLI), no dummy or forced-safe credential, and no unroutable stand-in endpoint substituting for a real service
    And any test double that remains should belong to a scenario tagged @exceptional-double whose site names the unproducible condition it injects, or be a golden capture whose site names the licensed @pipeline sandbox run it was recorded from

  @logic @property
  Scenario: The eval seeds only authentication credentials, never a pre-provisioned store
    Given the eval harness's workspace `.env` seed
    When the credential variables it writes are enumerated
    Then the seed should include only the credentials the agent needs to authenticate — the Saleor Cloud token and any Cloud API override
    And it should omit the store endpoint `NEXT_PUBLIC_SALEOR_API_URL` and the `SALEOR_TOKEN`, so a baseline agent's `jolly start` exercises the documented store-creation path from a fresh start instead of reusing a pre-seeded one

  @logic
  Scenario: The shipped CLI does not fabricate a Cloud organization list for a customer
    Given a customer's environment, where the harness guard is not set
    When the agent runs `jolly create store --create-environment --dry-run --json --mock-organizations=acme-co,other-co`
    Then the envelope should not report "acme-co" or "other-co" among the organizations it resolved
    And the run should resolve organizations from the Cloud API alone

  @logic @property
  Scenario: No harness-only affordance in the shipped CLI is reachable without the harness guard
    Given Jolly's production source
    When the harness-only affordances it declares are enumerated
    Then each should fabricate a service response only when the harness guard is set
    And a harness-only affordance reachable from the shipped surface with no guard should redden the check

  @logic
  Scenario: Reclamation recognises a leaked environment by its domain label, not only by its name
    Given a leftover environment whose Cloud name is Jolly's product default "jolly-store" and whose domain label carries the `jolly-cannon-fodder` namespace
    When the environments a run may reclaim are selected
    Then the leaked environment should be selected for reclamation
    And an environment carrying the `jolly-cannon-fodder` namespace in neither its name nor its domain label should be left alone

  @sandbox @creates-env
  Scenario: The provisioner reclaims a leaked environment that carries the namespace only in its domain label
    Given a leftover Saleor environment standing in the org whose name is Jolly's product default "jolly-store" and whose domain label carries the `jolly-cannon-fodder` namespace
    When the @sandbox harness performs its pre-run capacity reclamation
    Then the leaked environment should no longer exist in the org
    And every environment lacking the `jolly-cannon-fodder` namespace in both its name and its domain label should still be present afterward

  @sandbox @creates-env
  Scenario: The @sandbox provisioner reclaims a leftover jolly-cannon-fodder environment instead of skipping the run
    Given a leftover `jolly-cannon-fodder`-namespaced Saleor environment standing in the org from a previous run that never finished starting and does not serve requests
    When the @sandbox harness provisions its shared environment for a run
    Then it should reclaim the leftover `jolly-cannon-fodder`-namespaced environment and provision the run's environment, not skip the run
    And every environment lacking the `jolly-cannon-fodder` prefix should still be present afterward

  @logic @property
  Scenario: The standalone reclaim entrypoint runs only when invoked directly, never as an import side effect
    Given cucumber's support-file glob, which imports every file under `features/support/`
    When `features/support/reclaim-cli.ts` is loaded because a cucumber invocation imports it, rather than run standalone via `npm run reclaim`
    Then it should perform no reclaim call and no console output as a result of merely being imported
    And a cucumber invocation's reclamation should happen exactly once, from the `BeforeAll` hook alone

  Rule: Live-by-design conformance
    - Binding test methodology lives in AGENTS.md ("Real services always — never mock or fake"); this feature makes its one testable invariant executable, so a suite that is green while still carrying a forbidden double fails here instead of passing silently.
    - A forbidden double is any stand-in for the normal path: a fake CLI replacing a real one, a dummy or forced-safe credential, or an unroutable endpoint replacing a real service.
    - The only admissible double is one tagged @exceptional-double: an exceptional condition the real test env cannot produce on demand — an organization already at its environment limit (`ENVIRONMENT_LIMIT_REACHED`), a deliberately unreachable service for a "stored, not verified" path, a device authorization grant approved by the human (the click at the verification URL cannot be produced on demand), faked by a local auth host the test points Jolly at through the `JOLLY_SALEOR_AUTH_URL` override, or a store endpoint inside its cold-start window (the fresh-provision wait is proven for real at the shared provisioning seam's first build and self-heal; re-provisioning per run to reproduce the window is the re-spend the licensed-spend rule forbids) — justified inline at its site. A failure reachable from real bad input (empty or garbage token, malformed or non-first-party URL, a genuinely absent store) is produced for real, never doubled.
    - A golden capture is the one further admissible stand-in, on the layered ground: a canned response recorded mechanically from a real run of the same command by a licensed @pipeline sandbox scenario, standing in for a service effect the subject under test only calls into, where that effect is covered for real in the @sandbox tier and the capture is re-verified against the live services at harbour (the eval's captured services, feature 025). A hand-authored canned response remains the forbidden fake; only a recorded capture stands, and each capture site names its source run inline.
    - This is a testable conformance invariant about Jolly's verification layer, not a product behavior. It is an admissible scenario because it is falsifiable (it is currently false), not aspiration: the discriminator for a scenario is testability, not whether its subject is the product or the harness.
    - A test-created environment is recognised by its Cloud NAME or its DOMAIN LABEL, and reclamation matches on either. A run that falls through to Jolly's product-default store name still carries the run's namespace in its domain label, so an environment matched on name alone is invisible to reclamation and squats an org slot until a human removes it.
    - The leak is producible for real, so it is proved for real: the environment is created through the same live path as any other, and no test double stands in for it. A double would prove only that the harness understood the fiction.
    - A harness-only affordance is reachable only from the harness. Any production code path that fabricates a service response — an injected organization list, an injected environment list — is a test double living in production, and the shipped CLI must not reach it. A double whose marker sits in the verification layer while its mechanism sits in production is invisible to a scan of the verification layer alone, so the scan covers production too.
    - When the invariant fails on a double in an untagged scenario, the fix is to make that scenario real if the condition is producible, or — if it is a genuine unproducible exception — to record it as an @exceptional-double via the Captain, never to widen this rule.

  Rule: The eval exercises the documented store-creation path from a fresh start
    - Feature 025 requires the eval workspace to be seeded with only the credentials a baseline agent needs to AUTHENTICATE, leaving the store endpoint and SALEOR_TOKEN unset so the agent's `jolly start` exercises the documented store-creation path from nothing, with the expensive effects served from the golden captures. This feature makes that one clause executable in the gating tier: `@eval` never gates CI, so a harness that silently seeds a pre-provisioned store would otherwise pass unnoticed — and a pre-seeded endpoint makes `jolly start` treat the store as pre-existing, skipping the store stage entirely, so the affordance under measurement collapses.
