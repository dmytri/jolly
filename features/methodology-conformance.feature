Feature: Methodology conformance

  Shipshape methodology rules that must surface as failing verification when
  violated. These are the two required derived methodology checks: perturbation
  quiescence and watchbill shape. Both are @captain skeletons awaiting Captain
  review; QM makes their steps executable after promotion.

  @logic @captain @invariant
  Scenario: A green tree carries no standing perturbation token
    Given the implementation directories "src/" and "bin/"
    When the perturbation-quiescence check scans them for the "PERTURBATION" token
    Then it should report no match
    And planting the "PERTURBATION" token in a "src/" file should redden the check

  @logic @captain @invariant
  Scenario: The watchbill holds only ordered watch objects of scenario references
    Given a "watchbill.json" at the project root with watches "watch1" and "watch2"
    When the watchbill-shape check validates it
    Then each key should be a watch named "watch1", "watch2", and onward in order
    And each watch should contain only a "scenarios" array of "<spec>.feature:<Scenario Name>" references or a tier tag
    And a watch carrying any prose, metadata, or extra key should redden the check
