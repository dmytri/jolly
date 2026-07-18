Feature: Concurrent invocation isolation
  As the maintainer of Jolly's verification suite
  I want concurrent cucumber invocations to leave each other's live resources alone
  So that tier legs can overlap safely and the full regression earns its wall-clock budget from concurrency rather than serial waiting

  Rule: Reclamation is run-scoped
    - The unconditional pre-run reclamation stays the safety net for crashed and
      interrupted runs, and gains an age gate: a namespaced leftover is stale once
      it is older than the full-regression wall-clock budget in "RIGGING.md", since
      no live invocation can be older than the whole regression's ceiling.
    - A younger namespaced resource belongs to a live sibling invocation and is
      left alone. The persistent shared store stays exempt by name, as before, and
      a resource lacking the `jolly-cannon-fodder` namespace is never touched.

  @logic
  Scenario: Reclamation selects a stale leftover and leaves a live sibling's environment alone
    Given a `jolly-cannon-fodder`-namespaced Saleor environment created moments ago by a live sibling invocation
    And a `jolly-cannon-fodder`-namespaced Saleor environment older than the full-regression wall-clock budget in "RIGGING.md"
    When the environments a run may reclaim are selected
    Then the environment older than the budget should be selected
    And the sibling invocation's fresh environment should be left alone

  @logic
  Scenario: Two concurrent cucumber invocations do not reclaim each other's live resources
    Given one cucumber invocation holding run-namespaced local scratch directories, freshly created and still in use
    And a run-namespaced local scratch leftover older than the full-regression wall-clock budget in "RIGGING.md"
    When a second cucumber invocation runs its pre-run reclamation while the first invocation still runs
    Then the first invocation's scratch directories should still exist
    And the stale leftover should be removed
