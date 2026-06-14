Feature: Structured agent risk context
  As a customer's AI agent
  I want Jolly to describe the risk of each impactful action in a structured way
  So that I can decide whether to ask for human approval without Jolly hardcoding an approval policy

  Background:
    Given approval granularity is decided by the customer's agent, not hardcoded by Jolly
    And side-effecting commands support `--dry-run`

  @logic
  Scenario: Jolly exposes risk context before an impactful action
    Given a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource
    When Jolly prepares to perform the action
    Then it should expose a structured `riskContext` for the agent to assess
    And the `riskContext` should include the `action` being performed
    And it should include the `target` resource and its scope
    And it should include a `riskLevel` of low, medium, or high
    And it should include the applicable risk `categories`
    And it should include whether the action is `reversible`
    And it should include the expected `sideEffects`
    And it should include whether a dry run is available via `dryRunAvailable`
    And the customer's agent should decide whether to ask for human approval based on this context

  @sandbox
  Scenario: Risk context is consistent across preview and execution
    Given a command supports `--dry-run`
    When the agent previews the action with `--dry-run`
    Then the `riskContext` shown in preview should match the `riskContext` for real execution
    And the real execution output must include a `riskContext` identical to the dry-run preview
    And no remote side effects should occur during the dry run

  @logic
  Scenario: Risk context travels in the standard envelope
    Given a command produces output with `--json`
    When the output describes an impactful action
    Then the `riskContext` should be carried inside the output envelope `data` and/or `checks`
    And it should not use a separate ad hoc format outside the feature 020 envelope

  @logic
  Scenario: High-risk categories are surfaced explicitly
    Given an action falls into a high-risk category
    When Jolly builds its `riskContext`
    Then the relevant categories should be listed explicitly
    And destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category

  @logic
  Scenario: Jolly start pauses for agent approval before each high-risk stage
    Given the agent runs `jolly start` without a pre-authorization flag
    When `jolly start` reaches a high-risk stage (`create store`, `@saleor/configurator deploy`, or the `npx vercel` deploy)
    Then it should emit that stage's `riskContext` in the feature 020 envelope before performing the action
    And it should pause for the agent to approve and not self-approve or perform the action
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

  Rule: `jolly start` pauses for approval at each high-risk stage
    - Under "Agent-supervised orchestration" (feature 002), `jolly start` runs the high-risk
      stages itself (`create store`, `@saleor/configurator deploy`, the `npx vercel` deploy).
      Before EACH such stage it emits that stage's `riskContext` in the envelope and PAUSES for the
      agent to approve, then resumes; it never self-approves.
    - An agent pre-authorization flag (e.g. `--yes`) lets the agent approve the run up front and
      have `start` proceed through the high-risk stages without per-stage pauses, when the agent's
      policy allows. The `riskContext` is still emitted for each (for the record), identical to its
      `--dry-run` form.
    - This is distinct from the human-interaction gates `start` waits at (OAuth/`vercel login`
      passthrough, account creation, the Dashboard Stripe app): those are completed by the human,
      not approval decisions, and are not governed by this rule.

  Rule: Open questions
    - Whether `riskLevel` is derived deterministically from `categories` or set per action is deferred to CLI design.
    - Additional optional fields (for example estimated cost or affected record counts) are deferred to CLI design.
