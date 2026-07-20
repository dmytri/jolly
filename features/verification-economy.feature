Feature: Verification economy

  Verification sits on the critical path of every change, so what it costs is paid
  by every future change. This feature makes that cost observable, so a scenario
  that gets slower is discovered rather than absorbed.

  Rule: Every scenario accounts for the time it spends

    - Each scenario's wall-clock duration is recorded into the wake for every tier
      run, so the cost of the suite is a measured number rather than an impression.
    - The record is per scenario, not per tier. A tier total hides the shape that
      matters: a tier whose mean is many times its median is not uniformly slow, it
      carries a few scenarios that dominate it, and those are the ones worth moving.
    - Cost is judged against the tier a scenario runs in. The default tier runs on
      every inner-loop change, so a slow scenario there is paid constantly; the same
      cost in an opt-in tier is paid at that tier's cadence.
    - A wait is ended by an observed signal. Where a scenario drives an interactive
      terminal, it feeds each input once its prompt is observed, rather than on a
      fixed delay guessed to be long enough. A guessed delay is paid in full on every
      run, and it is paid again as flake when it guesses short.

  @logic @invariant
  Scenario: A tier run through its configured command writes that tier's wall-clock record
    Given the tier commands configured in "RIGGING.md"
    When a tier is run through its command as configured
    Then that tier's wake record should carry every scenario the run started, each with its wall-clock duration
    And a configured tier command that writes no wake record should redden the check

  @logic @invariant
  Scenario: An interactive scenario waits for the prompt it is answering, never a guessed delay
    Given the verification support that drives an interactive terminal
    When the waits it performs before sending each input are enumerated
    Then each should be ended by the prompt it observed in the terminal output
    And a wait ended by a fixed delay guessed to outlast the prompt should redden the check

  @logic @invariant
  Scenario: An interactive scenario reads the output it asserts on, never whatever a timer happened to catch
    Given the verification support that drives an interactive terminal
    When the reads it performs before asserting on the terminal output are enumerated
    Then each should be ended by the output it asserts on, appearing in the terminal
    And a read ended by a fixed timeout, returning whatever the terminal had produced by then, should redden the check

  Rule: Ambient state is provisioned once and shared

    - State that no scenario asserts is setup cost: it is built once per run behind
      a lock, marker, or module-level memo, or reused where already present, never
      rebuilt per scenario. The shared-store provisioning in
      "features/support/provision.ts" is the house idiom.
    - The breach is invisible on a green run: every scenario passes while one of
      them quietly pays the same provisioning cost again on every execution. Only a
      check over the support code itself can redden on it.

  @logic @invariant
  Scenario: Ambient setup cost is paid once per run, never per scenario
    Given the verification support and step-definition files
    When the sites that provision ambient state no scenario asserts, such as pre-warming an external CLI into the npx cache, are enumerated
    Then each should run behind a once-per-run guard such as a lock, marker file, or module-level memo
    And a site that re-provisions per scenario without a guard should redden the check

  Rule: Expensive spend is licensed, recorded, and joined

    - A full toolchain pipeline — the spawned `git` clone, `pnpm` install,
      `@saleor/configurator` deploy, and `npx vercel` deploy — and a Saleor Cloud
      environment creation are the expensive spends. The licence is a tag: a
      scenario tagged @pipeline is entitled to run the full toolchain chain
      itself, and a scenario tagged @creates-env is entitled to create its own
      environment. The licensed set is declared in the specs, enumerable from
      tags alone, never inferred from prose.
    - One creation test per creation seam, and one means one: at most a single
      scenario in the whole corpus holds the licence for a given expensive spend
      class. A second scenario never re-runs a creation, not with different
      parameters and not inside a different sequence. A behaviour that needs a
      created resource asserts against the shared provisioning's resource, and a
      wrapper around already-proven stages is tested against their satisfied
      state rather than by running them again.
    - A scenario whose assertion cannot exist without its own creation declares
      that with @spend-is-the-assertion beside the licence tag, and is exempt
      from the one-holder count. The exemption is for a precondition the shared
      resource cannot hold, never for convenience: the recipe deploy's
      destructive-diff guard needs a store holding data the recipe would delete,
      which the shared store never holds and cannot be seeded with. Declaring it
      keeps the exception enumerable from tags alone, so the true licensed set
      stays readable without reading prose.
    - A scenario tagged @creates-env may additionally drive a single toolchain
      element against the environment it created, where that element exercised
      differently is the scenario's assertion. The element licence never
      extends to the chain.
    - Every other scenario asserts against ambient state provisioned once and
      shared: the shared store and the one shared pipeline's artifacts. Shared
      provisioning is itself a recorded spend, licensed once per resource class
      per run.
    - A scenario tagged @toolchain-element is licensed for the toolchain elements
      that are its own specified assertion, driven against its own namespaced
      resources: the storefront preparation whose clone and install are the
      behaviour under test, the deploy whose Vercel run is the behaviour under
      test. The element licence mirrors the @creates-env single-element clause
      and never extends to the chain or to environment creation.
    - A spend aimed at a declared unroutable stand-in by an @exceptional-double
      scenario is the double's own failure path, not a real toolchain spend: the
      shim records it, and the check classifies it to the double rather than the
      licence set.
    - The check judges every profile leg of the tier's last sweep, so the order
      the legs ran in can never leave one leg's spends unjudged.
    - The spend is recorded at run time by the interception shims already on the
      PATH — the feature 025 idiom: log argv, then exec the real binary — and
      each ledger entry is attributed to the running scenario. The ledger lives
      in the wake.

  @logic @invariant
  Scenario: Every recorded toolchain spend belongs to the shared provisioning or a licensed scenario
    Given the spend ledger the sandbox tier's last sweep recorded into the wake, every profile leg of it
    When each ledger entry is joined to the tags of the scenario it is attributed to
    Then every spend of the full toolchain chain should belong to the run's shared provisioning or to the scenario tagged @pipeline
    And every environment-creation spend should belong to the run's shared provisioning or to a scenario tagged @creates-env
    And a single toolchain element driven by a scenario tagged @creates-env against its own environment should be licensed, never the chain
    And a toolchain element driven by a scenario tagged @toolchain-element against its own namespaced resources, where that element is the scenario's own assertion, should be licensed, never the chain
    And a spend aimed at a declared unroutable stand-in by a scenario carrying @exceptional-double should be classified to that scenario's double, never as a real toolchain spend
    And a spend attributed to an unlicensed scenario should redden the check, naming the scenario and the spend it made

  @logic @invariant
  Scenario: At most one scenario in the corpus holds the licence for an expensive spend class
    Given Jolly's feature files
    When the scenarios carrying a spend licence tag are grouped by the spend class that tag licenses
    Then no spend class should carry more than one licensed scenario that does not declare @spend-is-the-assertion
    And a spend class carrying a second undeclared licensed scenario should redden the check, naming the class and every scenario holding its licence
    And a scenario carrying @spend-is-the-assertion without a spend licence tag should redden the check, since the declaration exempts a licence it does not hold

  @logic @invariant
  Scenario: Shared provisioning happens at most once per resource class in a run
    Given the spend ledger the sandbox tier's last run recorded into the wake
    When the entries attributed to the run's shared provisioning are grouped by resource class
    Then no resource class should appear more than once
    And a resource class provisioned twice in one run should redden the check, naming the class

  @logic @invariant
  Scenario: A sandbox run that recorded no spend ledger reddens rather than passing silently
    Given the tier commands configured in "RIGGING.md"
    When the sandbox tier has run through its command as configured
    Then the wake should carry a spend ledger for that run
    And a sandbox run that produced no ledger should redden the check, so a broken recorder cannot disarm it

  Rule: The wake records the pressure a run ran under

    - Overlapped tier legs contend for this machine's memory as well as its clock,
      so the weather record carries pressure alongside duration: the run's worker
      count, its peak resident set size, and any out-of-memory kill events, written
      into the same per-tier stream the wall clock already uses, never a new
      artifact.
    - The concurrency prior is read from the record. A worker count that crashed
      under pressure is backed off from before the next run, rather than the crash
      being rediscovered at full price.
    - An out-of-memory kill is a harness defect finding, red and named. A silent
      rerun spends the latency the overlap exists to remove and hides the defect
      the record exists to surface.

  @logic @invariant
  Scenario: A tier run through its configured command records the memory pressure it ran under
    Given the tier commands configured in "RIGGING.md"
    When a tier is run through its command as configured
    Then that tier's wake record should carry the run's worker count, its peak resident set size, and any out-of-memory kill events alongside its wall-clock record
    And a configured tier command that records no memory pressure should redden the check

  @logic @invariant
  Scenario: A tier's worker count backs off from recorded pressure instead of rediscovering the crash
    Given a tier's weather record carrying a pressure signal such as an out-of-memory kill or a peak resident set size at the run's configured memory ceiling
    When the tier's next run derives its worker count from the record
    Then the derived worker count should be lower than the record's green worker count
    And a record carrying no pressure signal should restore the derived worker count toward the profile's configured parallelism
    And a derived worker count held below the configured parallelism by a record carrying no pressure signal should redden the check

  @logic @invariant
  Scenario: A recorded out-of-memory kill reds the check rather than hiding in a rerun
    Given the pressure record each tier's last run wrote into the wake
    When the recorded pressure events are examined
    Then no tier's record should carry an out-of-memory kill
    And a record carrying one should redden the check, naming the tier and the event

  Rule: The wake is read run-scoped

    - Overlapped tier legs write the wake concurrently, so a reader that consumes
      "the last run's record" must select a completed run's record, never a live
      sibling's partial one. A partial ledger misattributes spends, and a partial
      weather record understates a wall clock, so the green either produces proves
      nothing.
    - The law covers every wake reader: the spend-ledger join, the budget-fit
      check, and the pressure and worker-count priors.

  @logic @invariant
  Scenario: A wake reader selects a completed run's record, never a live sibling's partial one
    Given a wake carrying a completed sandbox run's record and a live sibling invocation's partial record
    When the records the wake's readers select are enumerated
    Then each reader should select the completed run's record and leave the live sibling's partial record unread
    And a reader that consumes a live sibling's partial record should redden the check

  Rule: The suite fits its budgets

    - The budgets live in "RIGGING.md" under its Tiers section: a plain budget
      for the full regression and a tier-suffixed budget per tier, in seconds. A
      budget is a ceiling, not advice: a suite that outgrows its budget
      interrupts the voyage as a red, rather than waiting for the next harbour
      economy audit.
    - The check needs no new instrumentation: every tier command already writes
      its wall clock into the weather record in the wake.
    - The check judges a completed window. A lane still running has written no
      completion into its record, so a check running inside the window it
      judges silently omits every unfinished lane, its own included, and
      reports green over the lanes that happen to have finished. Omission is
      indistinguishable from fitting the budget, so the absent lane must redden
      rather than be skipped.

  @logic @invariant
  Scenario: Each tier's recorded wall clock fits its budget from the rigging
    Given the tier budgets configured in "RIGGING.md"
    And the wall-clock record each tier's last run wrote into the wake
    When each tier's recorded wall clock is compared to that tier's budget
    Then no tier's recorded wall clock should exceed its budget
    And the laned window's wall clock, from the lanes' shared launch to the last lane's exit, should fit the plain regression budget
    And a tier over its budget should redden the check, naming the tier, its budget, and the recorded time

  @logic @invariant
  Scenario: A budget judged over an incomplete window reddens instead of reporting green
    Given the tier budgets configured in "RIGGING.md"
    And a wall-clock record in which one tier's lane has not recorded its completion
    When each tier's recorded wall clock is compared to that tier's budget
    Then the check should redden, naming the tier whose lane is incomplete
    And it should distinguish an incomplete lane from a lane that fits its budget
    And no tier should be reported as fitting its budget on a record carrying no completion

  @logic @invariant
  Scenario: A step that runs pinned at its declared read ceiling reds the check
    Given the per-step durations the latest tier runs wrote into the wake
    And the read ceilings declared in the verification support
    When each step's measured duration is joined against its declared ceiling
    Then no step's measured duration should reach its declared ceiling
    And planting a read whose signal never matches should redden the check before the plant is removed

  Rule: Every tier that can spend records a ledger

    - A ledger written for one tier alone leaves every other tier's spends
      unrecorded by construction, so no entry exists to join against a licensed
      set. The default tier is the one paid on every inner-loop run, so an
      unrecorded spend there is the most expensive kind.

  @logic @invariant
  Scenario: A tier that spawns an expensive command writes a ledger entry for it
    Given the tiers configured in "RIGGING.md"
    And the spend ledger each tier's last run wrote into the wake
    When each tier's recorded spends are joined against its licensed scenario set
    Then every tier that spawned an expensive command should have written a ledger
    And no spend should be attributed to a scenario outside the licensed set
    And a tier that spawned an expensive command and wrote no ledger should redden the check

  Rule: A run reclaims the processes it spawned

    - Reclamation covers cloud resources and scratch directories, age-gated and
      namespace-scoped. A spawned operating-system process falls outside it, so
      a detached child that outlives its run is reclaimed by nothing.
    - A detached child blocking with no terminal attached costs its run
      nothing it can observe, so the tier reports green and the leak is
      invisible. The harness already tracks the run's process set to attribute
      out-of-memory kills; reclamation is a second reader of that set.

  @sandbox @invariant
  Scenario: A tier run leaves none of its spawned processes running
    Given the process set a tier run recorded as its own
    When the tier run exits
    Then no process the run spawned should still be running
    And a process the run left behind should redden the check, naming the command and its process id

  Rule: The recorded dependencies match the package manifest

    - "RIGGING.md" records dependencies under its Dependencies section and
      "package.json" declares them. Absent a join, a dependency installed but
      unrecorded, or recorded but uninstalled, is invisible to every role that
      reads either file alone.

  @logic @invariant
  Scenario: Every declared dependency is recorded in the rigging
    Given the dependencies declared in "package.json"
    And the dependencies recorded under the Dependencies section of "RIGGING.md"
    When the two sets are joined by dependency name
    Then every declared dependency should be recorded in the rigging
    And every recorded dependency should be declared in the manifest
    And a dependency present in one and absent from the other should redden the check, naming it and the side it is missing from
