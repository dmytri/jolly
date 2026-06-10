Feature: Command idempotency and resumability
  As a customer's AI agent
  I want Jolly commands to be safe to re-run and to resume partial work
  So that I can retry after interruptions and compose subcommands in any order without creating duplicates

  Background:
    Given `jolly start` is optional convenience orchestration for the full end-to-end flow
    And the agent may instead invoke individual `jolly create` subcommands at its own discretion

  @sandbox
  Scenario: Re-running a create subcommand detects existing work
    Given a `jolly create` subcommand has already completed its resource
    When the agent invokes the same subcommand again
    Then Jolly should detect the already-completed work
    And it should not create a duplicate store, clone, recipe, or deployment
    And it should report the detected existing state through the standard output envelope
    And it should not fail merely because the resource already exists

  @sandbox
  Scenario: Jolly start resumes from the first incomplete stage
    Given a previous `jolly start` run completed some stages but not others
    When the agent runs `jolly start` again
    Then Jolly should detect which stages are already satisfied
    And it should skip the satisfied stages
    And it should continue from the first incomplete stage
    And it should report which stages were skipped versus performed in the output envelope

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
    - This generalizes feature 007's "init is safe to rerun" and feature 002's storefront directory collision handling to all create and start stages.
    - Destructive resolution of a collision is an impactful action and should expose risk context per feature 021 for the agent to decide.

  Rule: Open questions
    - How Jolly detects completed remote work (for example via Saleor Cloud and Vercel APIs versus local markers) is deferred to CLI design.
    - Whether resumable state is tracked in local artifacts such as a deferred `.jolly/` directory is deferred until CLI design.
