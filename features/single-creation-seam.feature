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

  @logic @property
  Scenario: Real Vercel project creation lives at a single seam
    Given Jolly's verification layer
    When its real `vercel project add` invocations are located
    Then every one lives in the single Vercel-project seam "features/support/sandbox.ts"

  @logic @property
  Scenario: The production Vercel deployment happens at a single seam
    Given Jolly's production source
    When its real `vercel deploy --prod` invocations are located
    Then every one shares a single enclosing production seam

  @logic @property
  Scenario: The starter-recipe configurator deploy happens at a single seam
    Given Jolly's production source
    When its real `npx @saleor/configurator deploy` invocations are located
    Then every one shares a single enclosing production seam

  @logic @property
  Scenario: The Paper storefront clone happens at a single seam
    Given Jolly's production source
    When its real Paper storefront `git clone` invocations are located
    Then every one shares a single enclosing production seam

  Rule: One creation seam per CLI-spawned resource
    - Beyond the environment, the verification layer creates one real external resource with its own spawn: a namespaced Vercel project. Every real `vercel project add` spawn in the verification layer lives in features/support/sandbox.ts, so a scenario that needs a deploy target routes through that one helper rather than spawning its own.
    - In production, each resource a stage creates by spawning an external CLI happens at one seam: the Vercel deployment (`vercel deploy --prod`), the starter-recipe deploy (`npx @saleor/configurator deploy`), and the Paper storefront clone (`git clone` of the storefront repository) each have a single enclosing seam, so no second site re-implements the create and drifts. The seam is the enclosing function, because all stages share src/index.ts, so a file check cannot tell them apart.
    - Each is a CLI spawn of string literals, invisible to a module-graph tool, so the same ts-morph checker locates the call pattern directly and reports any spawn that falls outside its seam.
    - A spawn that only drives a loopback fake or a `--dry-run` preview creates no real resource; it is a justified exception recorded at its own site, not a second seam.
