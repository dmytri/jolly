Feature: Agent skill installation targets
  As a customer's AI agent
  I want Jolly to install skills in standard locations while adding environment-specific guidance
  So that skills are discoverable by supported agents without fragmenting version management

  Background:
    Given Jolly supports generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev first
    And Jolly manages skill installation and updates through `jolly skills install` and `jolly skills update`

  Scenario: Jolly installs skills in standard project-local locations where possible
    Given the agent invokes `jolly skills install`
    When Jolly installs the default Saleor skill set
    Then it should prefer standard project-local skill locations supported by the underlying skills tooling
    And it should avoid inventing a separate Jolly-only skill store unless required
    And it should record or report installed versions using standard skills lock/metadata files where possible

  Scenario: Jolly adds agent-specific glue
    Given the skills have been installed or checked
    When the current or target agent environment needs additional setup
    Then Jolly should write or update agent-specific glue files or instructions
    And the glue should point the agent to the installed skills
    And the glue should avoid duplicating large skill contents when references are sufficient
    And Jolly should avoid overwriting unrelated user-authored instructions without approval

  Rule: Installation strategy
    - Use standard project-local skills where possible.
    - Add agent-specific glue/instructions for Zed, Claude Code, Cursor, OpenCode, Pi.dev, and generic agents.
    - Keep version management centralized through Jolly CLI commands.
    - Do not store secrets in skill directories or agent guidance.

  Rule: Open questions
    - What exact file paths should be used for each supported agent environment?
    - How should Jolly detect the current agent environment?
    - Skill versions and updates should be reported from standard skills lock/metadata files where possible.
