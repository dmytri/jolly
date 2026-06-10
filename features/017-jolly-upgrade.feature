Feature: Jolly upgrade
  As a customer's AI agent
  I want `jolly upgrade` to update Jolly-managed assets safely
  So that the project can keep up with Jolly, skills, and upstream Saleor guidance over time

  Background:
    Given Jolly manages skill installation and agent guidance
    And Jolly uses Saleor Paper as the storefront baseline
    And Paper includes its own migrations and `paper-version.json`

  @logic
  Scenario: Agent upgrades Jolly-managed skills and guidance
    Given a project has previously run `jolly init` or `jolly skills install`
    When the agent invokes `jolly upgrade`
    Then Jolly should check for updates to Jolly-managed skills
    And it should check for updates to Jolly-managed agent guidance
    And it should summarize available changes before applying them when appropriate
    And it should avoid overwriting unrelated user-authored instructions without approval or an explicit strategy

  @logic
  Scenario: Upgrade includes skill update behavior
    Given Jolly has a dedicated `jolly skills update` command
    When the agent invokes `jolly upgrade`
    Then `jolly upgrade` may call or orchestrate `jolly skills update`
    And it should report which skills were updated, unchanged, skipped, or failed

  @logic
  Scenario: Upgrade considers Paper baseline updates
    Given a cloned Paper storefront exists
    When the agent invokes `jolly upgrade`
    Then Jolly should detect the Paper baseline where possible
    And it should detect Paper's embedded migration guidance where available
    And it should not blindly rewrite the customer's customized storefront
    And it should generate an upgrade plan from Paper's migration guidance
    And it should not apply Paper migrations automatically in v1

  Rule: Upgrade principles
    - `jolly upgrade` is included in v1.
    - Upgrade should auto-apply Jolly-managed skill and guidance updates when safe.
    - Upgrade should default to plan-only for Paper/storefront changes.
    - Upgrade should focus on Jolly-managed assets first: skills, agent guidance, and setup instructions.
    - Paper/storefront upgrades should be conservative and respect customer customizations.
    - Upgrade output should be concise for humans and structured for agents.
    - Upgrade should not expose secrets.

  Rule: Open questions
    - Exact safety rules for auto-applying Jolly-managed updates remain open.
    - Version metadata for installed skills/guidance should use standard skills lock/metadata files where possible, avoiding a separate Jolly metadata store for now.
    - `jolly upgrade` should generate a Paper upgrade plan from Paper's migration guidance, but should not apply Paper migrations automatically in v1.
