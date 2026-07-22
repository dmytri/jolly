Feature: The setup-stage vocabulary stays consistent across the sites that name stages

  Jolly names its setup stages in four independent places. `DEFAULT_STAGE_RUNNERS`
  in "src/index.ts" maps a stage name to the function that runs it,
  `STAGE_DESCRIPTIONS` maps the same names to the progress descriptions,
  `HIGH_RISK_STAGES` names the stages `jolly start` gates on, and `SIDE_EFFECTING`
  in "src/lib/start-close.ts" names the stages whose failure makes a close
  dishonest. A stage added, renamed, or split in one but not the others is
  silently mis-handled: an unlisted side-effecting stage lets a run close as live
  while that stage is blocked, and an unlisted description prints a bare stage
  name where the run should say what it is doing.

  Rule: The stage vocabulary is declared once

    - The anchor that reveals the identity is the stage name itself, which
      appears as a runner key, a description key, a gate member, and a
      side-effecting member across two modules. Nothing joins them, so each of
      the four lists is maintained by hand against the other three.
    - This is the command surface's problem one level down, and feature
      `command-surface-consistency` already settled the shape of the answer:
      one declared surface every site derives from, joined by the structural
      checker, so no scenario holds a pair of sites in agreement by hand.
    - The lists are not all the same set, and the declaration carries that.
      Every stage takes a description; only the stages `jolly start` runs
      itself take a runner; `init` and `auth` are progress rows rather than
      side-effecting work. So the declaration names each stage with the facets
      it carries, and the check asserts each site equals the stages declared
      for that facet, never that all four lists are equal.
    - A stage name is a plain string in a record key, a `const` array, and an
      `as const` tuple, so a module-graph tool cannot see the identity. The
      ts-morph checker that already discharges the module-layering boundaries
      and the single creation seam reads these declarations directly, so this
      adds a declaration rather than a second tool.
    - This is a testable conformance invariant about Jolly's structure, not a
      product behaviour, the same discriminator as feature
      `module-boundary-conformance`: testability decides admissibility, not
      whether the subject is the product or its structure.

  @logic @property
  Scenario: Every stage site derives from one declared stage surface
    Given the stage surface Jolly declares, naming each stage with the facets it carries
    When the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read
    Then each site's stage set should equal the stages declared for that site's facet
    And a stage present in one site and absent from another should redden the check, naming the stage and the site missing it
    And a stage named in a site but absent from the declared surface should redden the check, naming the stage and the site that names it
