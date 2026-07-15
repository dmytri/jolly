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
  Scenario: A feature file carries no bare comment
    Given the specs directory "features/"
    When the spec-comment check reads every feature file
    Then none should carry a bare "#" comment line
    And a feature file carrying a "#" comment line should redden the check

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
    And a plank matching no current step-definition pattern should redden the check

  @logic @invariant
  Scenario Outline: The command custody hook denies an internal-role search that reaches the Captain-only notes
    Given the Shipshape Bash custody hook configured for this project
    When it receives a "shipshape:qm" payload whose command is "<vector>"
    Then it should deny the command
    And it should name a safe search form in its recovery message

    Examples: vectors proven to reach the notes file
      | vector                         |
      | rg -l --glob '*.md' -e . .     |
      | rg -l --no-ignore -e . .       |
      | rg -l -e . *.md                |
      | grep -rl -e . .                |
      | grep -rl --include=*.md -e . . |

  @logic @invariant
  Scenario Outline: The command custody hook permits an internal-role search the exclusion artifact already covers
    Given the Shipshape Bash custody hook configured for this project
    When it receives a "shipshape:qm" payload whose command is "<vector>"
    Then it should permit the command

    Examples: vectors proven unable to reach the notes file
      | vector                |
      | rg -l -e . .          |
      | rg -l -t md -e . .    |
      | rg -l --hidden -e . . |
