Feature: Agent-decided approval model
  As a customer using their own AI agent
  I want my agent to decide when approvals are needed
  So that Jolly can adapt to different agent environments, customer preferences, and risk levels without hardcoding one approval policy

  @logic
  Scenario: Agent decides whether approval is needed
    Given a Jolly workflow is about to perform a potentially impactful action
    When the action could create, modify, deploy, delete, or expose remote resources
    Then Jolly should provide enough structured context for the customer's agent to assess risk
    And the customer's agent should decide whether to ask for human approval
    And the decision should respect the customer's instructions and the current agent environment's policies

  Rule: Approval principles
    - Approval granularity is decided by the customer's agent, not hardcoded by Jolly.
    - CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows, without overriding external approval policies.
    - Jolly should make actions reviewable and provide structured risk context.
    - Remote/action commands should support `--dry-run` so agents can preview side effects before execution.
    - High-risk categories include destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes.
    - The structured risk context Jolly provides is defined in feature 021 (`riskContext`), carried inside the feature 020 output envelope.
