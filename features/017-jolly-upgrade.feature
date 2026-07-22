Feature: Jolly upgrade
  As a customer's AI agent
  I want `jolly upgrade` to re-verify Jolly-managed skills and surface the Paper baseline
  So that the project stays aligned with Jolly's managed assets without overwriting my customizations

  Background:
    Given a project that has run `jolly init`

  @logic
  Scenario: Upgrade re-verifies Jolly-managed skills on disk
    Given a project has previously run `jolly init` or `jolly skills install`
    When the agent invokes `jolly upgrade`
    Then the envelope `data.skillsChecked` should list the Jolly-managed skill IDs
    And every managed skill present on disk should be reported as a passing check
    And user-authored lines in AGENTS.md outside the Jolly marker should remain unchanged

  @logic
  Scenario: Upgrade reports the Paper baseline version as plan-only
    Given a cloned Paper storefront exists
    When the agent invokes `jolly upgrade`
    Then the envelope `data` should report the detected Paper baseline version
    And it should read `paper-version.json` to determine the baseline
    And it should not modify any file in the storefront directory
    And it should not apply Paper migrations automatically in v1

  Rule: Upgrade principles
    - `jolly upgrade` is included in v1.
    - Upgrade re-verifies Jolly-managed skills on disk: each managed skill present is reported as a passing check, and an absent one is skipped. It does not fetch or apply skill updates.
    - `jolly skills update` re-verifies installed skills on disk without fetching updates; only `jolly skills install` installs.
    - Upgrade detects a cloned Paper storefront via `paper-version.json` and reports its baseline version as plan-only (`paperAutoApply` is false); Paper/storefront migrations are never auto-applied in v1.
    - Upgrade preserves user-authored AGENTS.md content outside the Jolly marker.
    - Upgrade output should be concise for humans and structured for agents.
    - Upgrade should not expose secrets.
