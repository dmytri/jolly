Feature: Single creation seam for external resources
  As the maintainer of Jolly's codebase and its verification suite
  I want every real creation of an expensive external resource to happen at one seam
  So that consumers reuse or route through it and no site re-implements creation and drifts

  @logic @property
  Scenario: Every CLI-spawned creation of an external resource lives at its single declared seam
    Given the creation seams the structural checker declares for Jolly's production source and verification layer
    When every real creation spawn is located and attributed to an enclosing seam
    Then each spawn should sit in the single seam declared for the resource it creates
    And a spawn that falls outside its declared seam should redden the check, naming the spawn, its site, and the seam it belongs in

  Rule: One creation seam per CLI-spawned resource

    - Each resource created by spawning an external CLI has one enclosing seam.
      In the verification layer: the real `create store --create-environment`
      invocation, with the ENVIRONMENT_LIMIT_REACHED reclaim-a-slot handling
      around it, lives only in features/support/env-factory.ts, and the real
      `vercel project add` spawn lives only in features/support/sandbox.ts. In
      production: the Vercel deployment (`vercel deploy --prod`), the
      starter-recipe deploy (`npx @saleor/configurator deploy`), and the Paper
      storefront clone (`git clone` of the storefront repository) each have a
      single enclosing seam.
    - The production seam is the enclosing function rather than the file,
      because all stages share src/index.ts, so a file check cannot tell them
      apart.
    - The shared-store creator, the disposable-leftover seeder, and each of
      the @creates-env creators call the one environment seam rather than
      re-implementing the create-and-wait-out-the-limit flow.
    - This is one structural fact about where creation may live, so one
      scenario discharges it for every resource. Restating it once per resource
      would spend a scenario per seam to re-assert the rule the checker already
      applies uniformly, and each new resource would add a scenario rather than
      a seam declaration.
    - Each is a CLI spawn of string literals, invisible to a module-graph tool,
      so the ts-morph checker locates the call pattern directly and reports any
      spawn that falls outside its seam. The same checker enforces the
      module-layering boundaries, so one owned tool covers both the
      import-boundary facet and this call-pattern facet.
    - A spawn that only drives a loopback fake or a `--dry-run` preview creates
      no real resource; it is a justified exception recorded at its own site,
      not a second seam.
    - This is a testable conformance invariant about structure, not a product
      behaviour, the same discriminator as feature 026: testability decides
      admissibility, not whether the subject is the product or the harness.
