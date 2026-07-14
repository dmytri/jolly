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
  Scenario: Every scenario that runs records its wall-clock cost
    Given a completed tier run
    When the wake's per-scenario record is read
    Then every scenario that ran should carry its wall-clock duration
    And a scenario present in the run but absent from the record should redden the check

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
