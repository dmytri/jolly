Feature: Jolly upgrade
  As a customer's AI agent
  I want `jolly upgrade` to update Jolly-managed assets safely
  So that the project can keep up with Jolly, skills, and upstream Saleor guidance over time

  Background:
    Given a project that has run `jolly init`

  @logic
  Scenario: Agent upgrades Jolly-managed skills and guidance
    Given a project has previously run `jolly init` or `jolly skills install`
    When the agent invokes `jolly upgrade`
    Then Jolly should check for updates to Jolly-managed skills
    And it should check for updates to Jolly-managed agent guidance
    And the envelope `data` should list the available changes before any are applied
    And user-authored lines in AGENTS.md outside the Jolly marker should remain unchanged

  @logic
  Scenario: Upgrade includes skill update behavior
    Given Jolly has a dedicated `jolly skills update` command
    When the agent invokes `jolly upgrade`
    Then the envelope should report which skills were updated, unchanged, skipped, or failed

  @logic
  Scenario: Upgrade considers Paper baseline updates
    Given a cloned Paper storefront exists
    When the agent invokes `jolly upgrade`
    Then the envelope `data` should report the detected Paper baseline version
    And it should read `paper-version.json` to determine the baseline
    And it should not modify any file in the storefront directory
    And it should generate an upgrade plan from Paper's migration guidance
    And it should not apply Paper migrations automatically in v1

  @logic
  Scenario: Upgrade auto-applies a safe Jolly-managed skill update
    Given a Jolly-managed skill has a newer version available
    And applying it does not overwrite user-authored content
    When the agent invokes `jolly upgrade`
    Then Jolly should apply the skill update automatically
    And it should report the skill as updated

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
