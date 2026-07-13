Feature: Methodology conformance

  Shipshape methodology rules that must surface as failing verification when
  violated. These two derived checks make the perturbation-quiescence and
  watchbill-shape rules executable, so a green suite that still violates one
  fails here instead of passing silently.

  @logic @invariant
  Scenario: A green tree carries no standing perturbation token
    Given the implementation directories "src/" and "bin/"
    When the perturbation-quiescence check scans them for the "PERTURBATION" token
    Then it should report no match
    And planting the "PERTURBATION" token in a "src/" file should redden the check

  @logic @invariant
  Scenario: The watchbill-shape check accepts a well-formed watchbill and rejects a malformed one
    Given a well-formed "watchbill.json" fixture with ordered watches "watch1" and "watch2", each holding only a "scenarios" array of "<spec>.feature:<Scenario Name>" references or a tier tag
    When the watchbill-shape check validates the fixture
    Then it should report the fixture well-formed
    And a fixture whose watch carries prose, metadata, or a key other than "scenarios" should redden the check

  @logic @invariant
  Scenario: Every plank sits in a docblock on the declaration it describes
    Given the implementation directories "src/" and "bin/"
    When the plank-form check reads every "@planks" token in them
    Then each should sit in a docblock attached to a declaration and carry a "Given", "When", or "Then" step
    And a "@planks" token attached to a type alias rather than the seam beneath it should redden the check
    And a "@planks" token in a line comment or inside a function body should redden the check

  @logic @invariant
  Scenario: Every plank names a step that still exists in a feature
    Given the "@planks" step texts in the implementation directories
    When they are joined against the step text of every feature file, with "And" and "But" normalized to the keyword they inherit
    Then every plank's step should be found in a feature
    And a plank naming a deleted or renamed step should redden the check
