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
    - The same record carries the pressure the run ran under, the worker count, the
      peak resident set size, and any out-of-memory kill events, written into the
      per-tier stream the wall clock already uses rather than a second artifact.
    - Cost is judged against the tier a scenario runs in. The default tier runs on
      every inner-loop change, so a slow scenario there is paid constantly; the same
      cost in an opt-in tier is paid at that tier's cadence.
    - A wait is ended by an observed signal. Where a scenario drives an interactive
      terminal, it feeds each input once its prompt is observed, rather than on a
      fixed delay guessed to be long enough. A guessed delay is paid in full on every
      run, and it is paid again as flake when it guesses short.

  @logic @invariant
  Scenario: A tier run through its configured command writes that tier's wake record
    Given the tier commands configured in "RIGGING.md"
    When a tier is run through its command as configured
    Then that tier's wake record should carry every scenario the run started, each with its wall-clock duration
    And it should carry the run's worker count, its peak resident set size, and any out-of-memory kill events
    And a configured tier command that writes no wake record should redden the check

  @logic @invariant
  Scenario: An interactive scenario ends every wait and read on an observed signal
    Given the verification support that drives an interactive terminal
    When the waits it performs before sending each input and the reads it performs before asserting are enumerated
    Then each wait should be ended by the prompt it observed in the terminal output
    And each read should be ended by the output it asserts on, appearing in the terminal
    And a wait or read ended by a fixed delay or timeout should redden the check

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

  @sandbox @invariant
  Scenario: The shared prepared-storefront fixture rebuilds a template evicted mid-run
    Given the storefront-template fixture has memoized its shared template for the run
    When the memoized template source is removed and a scenario then requests the prepared storefront
    Then the fixture should re-materialize the template and stage the prepared storefront
    And a fixture that copies from an unverified source without re-materializing should redden the check

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
    - The join covers every tier that can spend, not the sandbox tier alone. A
      ledger written for one tier leaves every other tier's spends unrecorded by
      construction, so no entry exists to join against a licensed set, and the
      default tier is the one paid on every inner-loop run.
    - The check judges every profile leg of the tier's last sweep, so the order
      the legs ran in can never leave one leg's spends unjudged.
    - The spend is recorded at run time by the interception shims already on the
      PATH — the feature 025 idiom: log argv, then exec the real binary — and
      each ledger entry is attributed to the running scenario. The ledger lives
      in the wake.

  @logic @invariant
  Scenario: Every recorded toolchain spend belongs to the shared provisioning or a licensed scenario
    Given the spend ledger each tier's last run recorded into the wake, every profile leg of it
    When each ledger entry is joined to the tags of the scenario it is attributed to
    Then every spend of the full toolchain chain should belong to the run's shared provisioning or to the scenario tagged @pipeline
    And every environment-creation spend should belong to the run's shared provisioning or to a scenario tagged @creates-env
    And a single toolchain element driven by a scenario tagged @creates-env against its own environment should be licensed, never the chain
    And a toolchain element driven by a scenario tagged @toolchain-element against its own namespaced resources, where that element is the scenario's own assertion, should be licensed, never the chain
    And a spend aimed at a declared unroutable stand-in by a scenario carrying @exceptional-double should be classified to that scenario's double, never as a real toolchain spend
    And a spend attributed to an unlicensed scenario should redden the check, naming the scenario and the spend it made
    And a tier that spawned an expensive command and wrote no ledger should redden the check

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

  Rule: An out-of-memory kill is a finding, never a rerun

    - An out-of-memory kill is a harness defect finding, red and named. A silent
      rerun spends the latency again and hides the defect the record exists to
      surface.

  @logic @invariant
  Scenario: A recorded out-of-memory kill reds the check rather than hiding in a rerun
    Given the pressure record each tier's last run wrote into the wake
    When the recorded pressure events are examined
    Then no tier's record should carry an out-of-memory kill
    And a record carrying one should redden the check, naming the tier and the event

  Rule: The suite fits its budgets

    - The budgets live in "RIGGING.md" under its Tiers section: a tier-suffixed
      budget per tier, in seconds. A budget is a ceiling, not advice: a suite
      that outgrows its budget interrupts the voyage as a red, rather than
      waiting for the next harbour economy audit.
    - The check needs no new instrumentation: every tier command already writes
      its wall clock into the weather record in the wake.

  @logic @invariant
  Scenario: Each tier's recorded wall clock fits its budget from the rigging
    Given the tier budgets configured in "RIGGING.md"
    And the wall-clock record each tier's last run wrote into the wake
    When each tier's recorded wall clock is compared to that tier's budget
    Then no tier's recorded wall clock should exceed its budget
    And a tier over its budget should redden the check, naming the tier, its budget, and the recorded time

  @logic @invariant
  Scenario: A step that runs pinned at its declared read ceiling reds the check
    Given the per-step durations the latest tier runs wrote into the wake
    And the read ceilings declared in the verification support
    When each step's measured duration is joined against its declared ceiling
    Then no step's measured duration should reach its declared ceiling
    And planting a read whose signal never matches should redden the check before the plant is removed

  Rule: The eval tier spends nothing live

    - The eval tier's expensive service effects are served from golden captures
      recorded by the licensed @pipeline sandbox runs, so the tier creates no
      cloud resource and its cost is the agent's turns alone.
    - A capture is only as good as the endpoint it records. A recorded endpoint
      that has stopped serving makes the capture serve a dead domain, and the
      agent's own readiness polling then drains its budget, so the failure
      presents as an agent timeout rather than as the stale capture it is.

  @logic @invariant
  Scenario: Every endpoint the eval captures record still serves
    Given the golden captures committed for the eval tier
    When each recorded store endpoint is probed for readiness
    Then every recorded endpoint should answer as serving
    And a recorded endpoint that no longer serves should redden the check, naming the endpoint and the run that recorded it

  @logic @invariant
  Scenario: The eval tier serves every expensive external command from its captures
    Given the spend ledger the eval tier's last run wrote into the wake
    When each recorded spend is classified as served from a golden capture or run live
    Then no managed skill install should have run live
    And no configurator deploy should have run live
    And no storefront dependency install should have run live
    And a live expensive spend in an eval run should redden the check, naming the command and the scenario that made it

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
