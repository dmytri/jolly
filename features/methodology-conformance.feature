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
    And the match should compare the plank's whole text, stripping no leading Gherkin keyword from either side
    And a plank carrying a leading "Given", "When", or "Then" should redden the check, naming the plank and its seam
    And a plank matching no current step-definition pattern should redden the check
    And a `@planks-provisional(...)` annotation naming a current `@captain` scenario should conform, one naming a promoted or absent scenario should redden the check

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

  @logic @invariant
  Scenario: The architecture document's structural claims match the tree
    Given the architecture document "ARCHITECTURE.md"
    When the architecture-conformance check reads its structural claims
    Then the counts it states for feature files, step-definition files, and unit-test files should match the tree
    And every module it lists under "src/lib/" should exist, and every module in "src/lib/" should be listed
    And every verification technology it names should be referenced in the tree
    And a drifted count, a missing or unlisted module, or a named technology with no reference should redden the check

  @logic @invariant
  Scenario: The dependency record and the package manifest agree
    Given the dependency entries recorded in "RIGGING.md" and the dependency lists in "package.json"
    When the dependency-record check joins them
    Then every dependency recorded in "RIGGING.md" should be installed in "package.json"
    And every "package.json" dependency should be referenced by the tree
    And a recorded-but-uninstalled or installed-but-unreferenced dependency should redden the check

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
