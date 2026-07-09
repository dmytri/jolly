Feature: Module boundary conformance
  As the maintainer of Jolly's codebase
  I want its module-layering invariants enforced by a tool, not only by convention
  So that a future import across the wrong boundary fails verification instead of silently shipping

  @logic @property
  Scenario: Jolly's module graph holds its layering boundaries
    Given Jolly's source tree
    When its import graph is checked against the module-layering boundaries
    Then no boundary violation is found

  Rule: Module-layering boundaries
    - Two invariants already held by the real import graph: src/lib never imports src/index.ts (leaf utilities never depend on the orchestration entrypoint), and src/ never imports features/support or features/step_definitions (production never depends on verification code, so test/harness code can never leak into the shipped dist/index.js bundle).
    - A ts-morph checker in the verification layer discharges these by resolving each import to its source file, so the boundary holds by real module resolution rather than by matching specifier strings. The same checker enforces the single-creation-seam invariant, so one owned tool covers both the import-boundary facet and the call-pattern facet.
    - This is a testable conformance invariant about Jolly's module structure, not a product behavior — the same discriminator as feature 026's verification-layer invariants: testability decides admissibility, not whether the subject is the product or its structure.
