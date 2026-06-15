Feature: Agent-decided approval model
  As a customer using their own AI agent
  I want my agent to decide when approvals are needed
  So that Jolly can adapt to different agent environments, customer preferences, and risk levels without hardcoding one approval policy

  @logic
  Scenario: Jolly surfaces risk context and does not self-approve
    When `jolly create store --create-environment --json` runs without `--yes`
    Then the envelope should carry a feature 021 `riskContext` for the action
    And Jolly should not perform the impactful action without approval
    And re-running the command with `--yes` should let it proceed, treating the flag as the approval

  Rule: Approval principles
    - Approval granularity is decided by the customer's agent, not hardcoded by Jolly.
    - CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows, without overriding external approval policies.
    - Jolly should make actions reviewable and provide structured risk context.
    - Remote/action commands should support `--dry-run` so agents can preview side effects before execution.
    - High-risk categories include destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes.
    - The structured risk context Jolly provides is defined in feature 021 (`riskContext`), carried inside the feature 020 output envelope.
