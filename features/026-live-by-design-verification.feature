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

  Rule: Live-by-design conformance
    - Binding test methodology lives in AGENTS.md ("Real services always — never mock or fake"); this feature makes its one testable invariant executable, so a suite that is green while still carrying a forbidden double fails here instead of passing silently.
    - A forbidden double is any stand-in for the normal path: a fake CLI replacing a real one, a dummy or forced-safe credential, or an unroutable endpoint replacing a real service.
    - The only admissible double is one tagged @exceptional-double: an exceptional condition the real test env cannot produce on demand — an organization already at its environment limit (`ENVIRONMENT_LIMIT_REACHED`), or a deliberately unreachable service for a "stored, not verified" path — justified inline at its site. A failure reachable from real bad input (empty or garbage token, malformed or non-first-party URL, a genuinely absent store) is produced for real, never doubled.
    - This is a testable conformance invariant about Jolly's verification layer, not a product behavior. It is an admissible scenario because it is falsifiable (it is currently false), not aspiration: the discriminator for a scenario is testability, not whether its subject is the product or the harness.
    - When the invariant fails on a double in an untagged scenario, the fix is to make that scenario real if the condition is producible, or — if it is a genuine unproducible exception — to record it as an @exceptional-double via the Captain, never to widen this rule.
