Feature: Module boundary conformance
  As the maintainer of Jolly's codebase
  I want its module-layering invariants enforced by a tool, not only by convention
  So that a future import across the wrong boundary fails verification instead of silently shipping

  @logic @property
  Scenario: Jolly's module graph discharges against the boundary scantling
    Given Jolly's source tree and the boundary scantling at ".dependency-cruiser.mjs"
    When dependency-cruiser validates the module graph against it
    Then no boundary violation is found

  Rule: Boundary scantling
    - The scantling encodes two invariants already held by the real import graph: src/lib never imports src/index.ts (leaf utilities never depend on the orchestration entrypoint), and src/ never imports features/support or features/step_definitions (production never depends on verification code, so test/harness code can never leak into the shipped dist/index.js bundle).
    - This is a testable conformance invariant about Jolly's module structure, not a product behavior — the same discriminator as feature 026's verification-layer invariants: testability decides admissibility, not whether the subject is the product or its structure.
