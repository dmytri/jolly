Feature: Single creation seam for external resources
  As the maintainer of Jolly's verification suite
  I want every real creation of an expensive external resource to happen at one seam
  So that consumers reuse or route through it and no test re-implements creation and drifts

  @logic @property
  Scenario: Real Saleor environment creation lives at a single seam
    Given Jolly's verification layer
    When its real `create store --create-environment` invocations are located
    Then every one lives in the single env-creation seam "features/support/env-factory.ts"

  Rule: One env-creation seam
    - The real `create store --create-environment` invocation, and the ENVIRONMENT_LIMIT_REACHED reclaim-a-slot handling around it, lives only in features/support/env-factory.ts. The shared-store creator, the disposable-leftover seeder, and the @creates-env creators call that one seam rather than re-implementing the create-and-wait-out-the-limit flow.
    - A test that only drives the create CLI against a loopback fake creates no real resource; it is a justified exception recorded at its own site, not a second creation seam.
    - The invariant is enforced by the same ts-morph checker as the module-layering boundaries: a create-store invocation is a CLI spawn of string literals, which a module-graph tool cannot see, so the checker locates the call pattern directly.
    - This is a testable conformance invariant about the verification layer's structure, not a product behavior — the same discriminator as feature 026 and the module-boundary invariants: testability decides admissibility, not whether the subject is the product or the harness.
