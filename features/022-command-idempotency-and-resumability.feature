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

  @sandbox
  Scenario: Jolly recognizes externally-produced work
    Given a cloned storefront, configured store, or deployment already exists — whether produced by `jolly start` or by the agent running a stage itself
    When the agent later runs `jolly doctor` or `jolly start`
    Then Jolly should detect that state from its observable artifacts (the storefront directory, the store configuration, the deployment) and treat it as satisfied
    And it should not ask the agent to redo it

  @sandbox @toolchain-element
  Scenario: Composed subcommands and start agree on state
    Given the agent has already run individual `jolly create` subcommands
    When the agent later runs `jolly start`
    Then `jolly start` should treat the work done by those subcommands as already satisfied
    And it should not redo or duplicate that work
    And it should report those stages as already satisfied rather than presenting them as pending approval

  @logic
  Scenario: jolly start does not re-gate a stage whose work is already done
    Given `NEXT_PUBLIC_SALEOR_API_URL` is already configured in the project `.env` from an earlier `jolly create store`
    When the agent runs `jolly start --dry-run --json`
    Then the `store` stage should present no approval riskContext, because no store would be created this run
    And the summary should name the store stage as already satisfied, not pending approval

  @logic
  Scenario: jolly start surfaces the already-configured store's Dashboard URL on resume
    Given `NEXT_PUBLIC_SALEOR_API_URL` is already configured in the project `.env` from an earlier `jolly create store`
    When the agent runs `jolly start --dry-run --json`
    Then the envelope `data` should surface the configured store's Saleor Dashboard URL ending in `.saleor.cloud/dashboard/`

  @logic
  Scenario: Collisions pause instead of overwriting
    Given a non-empty `storefront/` directory Jolly did not create
    When `jolly start` reaches the storefront clone stage
    Then Jolly should stop without overwriting and emit a collision `riskContext`
    And it should not silently overwrite the existing state
    And this should follow the same collision handling as the storefront target directory in feature 002

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
