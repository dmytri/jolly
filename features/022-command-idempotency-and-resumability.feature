Feature: Command idempotency and resumability
  As a customer's AI agent
  I want Jolly commands to be safe to re-run and to resume partial work
  So that I can retry after interruptions and compose subcommands in any order without creating duplicates

  Background:
    Given `jolly start` bootstraps setup and runs the mechanical stages by spawning official CLIs
    And the agent may also invoke individual `jolly create` subcommands at its own discretion

  @sandbox
  Scenario Outline: Re-running a create subcommand detects existing work
    Given `<command>` has already completed its resource
    When the agent runs `<command>` again
    Then Jolly should detect the already-completed work
    And it should not create a duplicate resource
    And it should report the detected existing state through the standard output envelope
    And it should not fail merely because the resource already exists

    Examples:
      | command                 |
      | jolly create store      |

  @sandbox @toolchain-element
  Scenario: Jolly start resumes bootstrap and reflects stage progress
    Given a previous `jolly start` run completed some bootstrap work but not all
    When the agent runs `jolly start` again
    Then Jolly should detect which bootstrap work is already satisfied (skills, `.mcp.json`, scaffold) and skip it
    And it should detect end-to-end progress already present in observable artifacts — a cloned storefront directory, a configured store, a Vercel deployment — and report those stages as done
    And it should continue from the first stage still outstanding rather than redoing completed work

  Rule: Idempotency principles
    - Re-running any `jolly create` subcommand or `jolly start` should be safe and should not create duplicates.
    - Commands should detect already-completed work and report detected state rather than erroring on "already exists".
    - `jolly start` should be resumable, skipping satisfied stages and continuing from the first incomplete one.
    - A resumable stage presents a feature 021 approval riskContext only for work it would actually perform this run; an already-satisfied stage is announced as satisfied in the envelope, never re-presented as a pending approval gate. Re-gating completed work misreads as "redo this" and is what drives an agent to over-approve.
    - A completed stage or subcommand should point the agent back to `jolly start` to continue, stating that `start` recognizes the work and resumes rather than redoing it — so running a stage standalone and then `jolly start` composes without contradiction.
    - Work done by individual subcommands and by `jolly start` should be mutually recognized as the same state.
    - Completed work includes observable state from official CLIs (a cloned storefront directory, a configured store, a Vercel deployment); `jolly doctor` and `jolly start` detect it from artifacts so setup resumes without redoing it. Detection stays simple for v1 — observe the obvious artifacts; deeper detection iterates later.
    - This generalizes feature 007's "init is safe to rerun" and feature 002's storefront directory collision handling to all create and start stages.
    - Destructive resolution of a collision is an impactful action and should expose risk context per feature 021 for the agent to decide.

  Rule: Open questions
    - How Jolly detects completed remote work (for example via Saleor Cloud and Vercel APIs versus local markers) is deferred to CLI design.
    - Whether resumable state is tracked in local artifacts such as a deferred `.jolly/` directory is deferred until CLI design.
