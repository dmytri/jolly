Feature: Structured agent risk context
  As a customer's AI agent
  I want Jolly to describe the risk of each impactful action in a structured way
  So that I can decide whether to ask for human approval without Jolly hardcoding an approval policy

  Background:
    Given approval granularity is decided by the customer's agent, not hardcoded by Jolly
    And side-effecting commands support `--dry-run`

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

  Scenario: Risk context is consistent across preview and execution
    Given a command supports `--dry-run`
    When the agent previews the action with `--dry-run`
    Then the `riskContext` shown in preview should match the `riskContext` for real execution
    And no remote side effects should occur during the dry run

  Scenario: Risk context travels in the standard envelope
    Given a command produces output with `--json`
    When the output describes an impactful action
    Then the `riskContext` should be carried inside the output envelope `data` and/or `checks`
    And it should not use a separate ad hoc format outside the feature 020 envelope

  Scenario: High-risk categories are surfaced explicitly
    Given an action falls into a high-risk category
    When Jolly builds its `riskContext`
    Then the relevant categories should be listed explicitly
    And destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category

  Rule: Risk context principles
    - Jolly describes risk; it never hardcodes the approval decision (consistent with feature 010).
    - `riskContext` fields are `action`, `target`, `riskLevel`, `categories`, `reversible`, `sideEffects`, and `dryRunAvailable`.
    - `riskLevel` is one of low, medium, or high.
    - `categories` are drawn from the feature 010 high-risk list: destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes.
    - The same `riskContext` should be produced for `--dry-run` preview and for real execution.
    - `riskContext` should be carried inside the feature 020 output envelope, not a separate format.
    - Risk context must never include secret values; reference credentials by name only.

  Rule: Open questions
    - Whether `riskLevel` is derived deterministically from `categories` or set per action is deferred to CLI design.
    - Additional optional fields (for example estimated cost or affected record counts) are deferred to CLI design.
