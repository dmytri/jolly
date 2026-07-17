Feature: Structured agent risk context
  As a customer's AI agent
  I want Jolly to describe the risk of each impactful action in a structured way
  So that I can decide whether to ask for human approval without Jolly hardcoding an approval policy

  Background:
    Given side-effecting commands support `--dry-run`

  @logic
  Scenario: jolly create store exposes a structured riskContext
    Given the agent runs `jolly create store --create-environment --dry-run --json`
    When the command completes
    Then the envelope should carry a `riskContext`
    And the `riskContext` should include the `action` being performed
    And it should include the `target` resource and its scope
    And it should include a `riskLevel` of low, medium, or high
    And it should include the applicable risk `categories`, listed explicitly
    And it should include whether the action is `reversible`
    And it should include the expected `sideEffects`
    And it should include whether a dry run is available via `dryRunAvailable`

  @sandbox
  Scenario: Risk context is consistent across preview and execution
    Given the agent previews `jolly create store --create-environment --dry-run --json`
    When it later runs `jolly create store --create-environment --json` for real
    Then the `riskContext` in the dry-run preview should match the `riskContext` in the real execution output
    And no remote side effects should occur during the dry run

  @logic
  Scenario: Risk context travels in the standard envelope
    Given the agent runs `jolly create store --create-environment --dry-run --json`
    When the command completes
    Then the envelope `data` and/or `checks` should carry the `riskContext`
    And the `riskContext` should not appear in a separate ad hoc format outside the feature 020 envelope

  @logic
  Scenario: Jolly start pauses for agent approval at the first high-risk stage
    Given the agent runs `jolly start` without a pre-authorization flag
    When `jolly start` reaches the first high-risk stage (`create store`, `@saleor/configurator deploy`, or the `npx vercel` deploy)
    Then it should emit that stage's `riskContext` in the feature 020 envelope before performing the action
    And Jolly should not perform the stage action until approval input is provided
    And the emitted `riskContext` should be identical to the one shown for that stage under `--dry-run`
    And running `jolly start --yes` should pre-approve and proceed through the high-risk stages without per-stage pauses, still emitting each `riskContext` for the record

  Rule: Risk context principles
    - Jolly describes risk; it never hardcodes the approval decision (consistent with feature 010).
    - `riskContext` fields are `action`, `target`, `riskLevel`, `categories`, `reversible`, `sideEffects`, and `dryRunAvailable`.
    - `riskLevel` is one of low, medium, or high.
    - `categories` are drawn from the feature 010 high-risk list: destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes.
    - Every command that supports `--dry-run` MUST emit a `riskContext` in its real execution output, identical to the one produced during `--dry-run` preview.
    - The `riskContext` for real execution should be carried inside the output envelope `data` or `checks`, not hidden or omitted. The agent uses it to verify the action matches what was previewed.
    - `riskContext` should be carried inside the feature 020 output envelope, not a separate format.
    - Risk context must never include secret values; reference credentials by name only.

  Rule: `jolly start` gates the high-risk stages behind agent approval
    - Under "Agent-supervised orchestration" (feature 002), `jolly start` runs the high-risk
      stages itself (`create store`, `@saleor/configurator deploy`, the `npx vercel` deploy).
      Without pre-authorization it PAUSES at the first such stage — emitting that stage's
      `riskContext` in the envelope with status `awaiting-approval` and performing no high-risk
      action — and holds the remaining high-risk stages `pending` behind that gate; it never
      self-approves.
    - An agent pre-authorization flag (`--yes`) approves the run up front and lets `start` proceed
      through the high-risk stages without pausing, when the agent's policy allows. Each stage's
      `riskContext` is still emitted (for the record), identical to its `--dry-run` form.
    - For finer-grained, per-stage approval the agent drives the individual stage commands itself;
      feature 010 leaves approval granularity to the agent, and Jolly does not hardcode it.
    - This is distinct from the human-interaction gates `start` waits at (OAuth/`vercel login`
      passthrough, account creation, the Dashboard Stripe app): those are completed by the human,
      not approval decisions, and are not governed by this rule.

  Rule: Open questions
    - Whether `riskLevel` is derived deterministically from `categories` or set per action is deferred to CLI design.
    - Additional optional fields (for example estimated cost or affected record counts) are deferred to CLI design.
