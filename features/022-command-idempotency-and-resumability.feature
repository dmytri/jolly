Feature: Command idempotency and resumability
  As a customer's AI agent
  I want Jolly commands to be safe to re-run and to resume partial work
  So that I can retry after interruptions and compose subcommands in any order without creating duplicates

  Background:
    Given `jolly start` bootstraps setup and emits the playbook; the agent then runs the official CLIs per the Jolly skill
    And the agent may also invoke individual `jolly create` subcommands at its own discretion

  @sandbox
  Scenario: Re-running a create subcommand detects existing work
    Given a `jolly create` subcommand has already completed its resource
    When the agent invokes the same subcommand again
    Then Jolly should detect the already-completed work
    And it should not create a duplicate store, clone, recipe, or deployment
    And it should report the detected existing state through the standard output envelope
    And it should not fail merely because the resource already exists

  @sandbox
  Scenario: Jolly start resumes bootstrap and reflects playbook progress
    Given a previous `jolly start` run completed some bootstrap work but not all
    When the agent runs `jolly start` again
    Then Jolly should detect which bootstrap work is already satisfied (skills, `.mcp.json`, scaffold) and skip it
    And it should detect end-to-end progress the agent already made with the official CLIs — a cloned storefront directory, a configured store, a Vercel deployment — and report those steps as done in the emitted playbook
    And it should point the playbook at the first step still outstanding rather than redoing completed work

  @sandbox
  Scenario: Jolly recognizes work the agent did with the official CLIs
    Given the agent has already cloned the storefront, configured the store, or deployed using the official CLIs
    When the agent later runs `jolly doctor` or `jolly start`
    Then Jolly should detect that state from its observable artifacts (the storefront directory, the store configuration, the deployment) and treat it as satisfied
    And it should not ask the agent to redo it

  @sandbox
  Scenario: Composed subcommands and start agree on state
    Given the agent has already run individual `jolly create` subcommands
    When the agent later runs `jolly start`
    Then `jolly start` should treat the work done by those subcommands as already satisfied
    And it should not redo or duplicate that work

  @logic
  Scenario: Collisions pause instead of overwriting
    Given a step would otherwise overwrite existing local or remote state it did not create
    When the conflict is detected
    Then Jolly should pause and ask how to resolve the collision
    And it should not silently overwrite the existing state
    And this should follow the same collision handling as the storefront target directory in feature 002

  Rule: Idempotency principles
    - Re-running any `jolly create` subcommand or `jolly start` should be safe and should not create duplicates.
    - Commands should detect already-completed work and report detected state rather than erroring on "already exists".
    - `jolly start` should be resumable, skipping satisfied stages and continuing from the first incomplete one.
    - Work done by individual subcommands and by `jolly start` should be mutually recognized as the same state.
    - Completed work includes state the agent produced with the official CLIs (a cloned storefront directory, a configured store, a Vercel deployment); `jolly doctor` and `jolly start` detect it from observable artifacts so the playbook resumes without redoing it. Detection stays simple for v1 — observe the obvious artifacts; deeper detection iterates later.
    - This generalizes feature 007's "init is safe to rerun" and feature 002's storefront directory collision handling to all create and start stages.
    - Destructive resolution of a collision is an impactful action and should expose risk context per feature 021 for the agent to decide.

  Rule: Open questions
    - How Jolly detects completed remote work (for example via Saleor Cloud and Vercel APIs versus local markers) is deferred to CLI design.
    - Whether resumable state is tracked in local artifacts such as a deferred `.jolly/` directory is deferred until CLI design.
