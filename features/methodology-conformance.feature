Feature: Methodology conformance

  Shipshape methodology rules that must surface as failing verification when
  violated, so a green suite that still violates one fails here instead of
  passing silently. Each scenario earns its place by naming a fault class no
  other scenario and no tooling gate detects.

  @logic @invariant
  Scenario: A green tree carries no standing perturbation token
    Given the implementation directories "src/" and "bin/"
    When the perturbation-quiescence check scans them for the "PERTURBATION" token
    Then it should report no match
    And planting the "PERTURBATION" token in a "src/" file should redden the check

  @logic @invariant
  Scenario: A credentialed tier fails loudly when its credential is absent
    Given the `@eval` tier command configured in "RIGGING.md"
    When the tier is run with "HARNESS_OPENROUTER_API_KEY" absent from the environment
    Then the run should fail, naming "HARNESS_OPENROUTER_API_KEY" as the fitting-out blocker it needs
    And it should report no scenario as skipped
    And it should invoke no model

  @logic @invariant
  Scenario: Every plank names a current step-definition pattern
    Given the "@planks" step texts in the implementation directories
    When each is cross-referenced by exact string match against the step-definition patterns reported by "step-usage"
    Then every plank's step should match one current step-definition pattern
    And the match should compare the plank's whole text, stripping no leading Gherkin keyword from either side
    And a plank carrying a leading "Given", "When", or "Then" should redden the check, naming the plank and its seam
    And a plank matching no current step-definition pattern should redden the check
    And a `@planks-provisional(...)` annotation naming a current `@captain` scenario should conform, one naming a promoted or absent scenario should redden the check

  @logic @invariant
  Scenario: No dead verification-support artifact accumulates
    Given the step-definition patterns reported by "step-usage" and the exported symbols under "features/support/"
    When the dead-artifact check enumerates the patterns no scenario binds and the support exports no other file references
    Then every step-definition pattern should be bound by at least one current scenario
    And every exported "features/support/" symbol should be referenced by another file in the tree
    And an orphaned step-definition pattern that no scenario binds should redden the check, naming the pattern and its file
    And an unreferenced "features/support/" export should redden the check, naming the symbol and its file

  @logic @invariant
  Scenario: Every verification surface in the tree is run by a configured tier command
    Given the tier commands configured in "RIGGING.md" and the test surfaces in the tree
    When the verification surfaces are enumerated
    Then every test surface should be run by a configured tier command
    And a test surface no configured tier command reaches should redden the check

  Rule: A surface outside the tiers is retired, never accumulated

    - A helper broken in any way that matters breaks the scenarios that consume it,
      so a separate unit surface adds latency without adding detection. A surface no
      configured tier command reaches is retired, its load-bearing assertions
      absorbed into scenarios or scantlings. Wiring a new tier command for such a
      surface is a fitting-out decision, never the default.
