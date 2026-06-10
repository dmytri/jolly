Feature: Agent-decided approval model
  As a customer using their own AI agent
  I want my agent to decide when approvals are needed
  So that Jolly can adapt to different agent environments, customer preferences, and risk levels without hardcoding one approval policy

  Background:
    Given Jolly is operated primarily by the customer's own agent
    And Jolly may create, modify, deploy, or inspect remote resources

  Scenario: Agent decides whether approval is needed
    Given a Jolly workflow is about to perform a potentially impactful action
    When the action could create, modify, deploy, delete, or expose remote resources
    Then Jolly should provide enough structured context for the customer's agent to assess risk
    And the customer's agent should decide whether to ask for human approval
    And the decision should respect the customer's instructions and the current agent environment's policies

  Scenario: Agent explains approval decisions
    Given the customer's agent decides to request or skip explicit approval
    When it communicates the next action
    Then it should explain the action in concise terms
    And it should explain the relevant risk or reason for proceeding
    And it should identify any irreversible, destructive, billing, payment, credential, or deployment impact

  Scenario: Jolly supports stricter environments
    Given an agent environment enforces explicit approvals for certain operations
    When Jolly is used in that environment
    Then Jolly should remain compatible with those stricter approval requirements
    And it should not assume that agent-decided approval means no approval

  Rule: Approval principles
    - Approval granularity is decided by the customer's agent, not hardcoded by Jolly.
    - CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows, without overriding external approval policies.
    - Jolly should make actions reviewable and provide structured risk context.
    - Remote/action commands should support `--dry-run` so agents can preview side effects before execution.
    - The agent should respect customer instructions and environment policy.
    - Agent-decided approval must not be interpreted as permission to hide risky actions.
    - High-risk categories include destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes.
