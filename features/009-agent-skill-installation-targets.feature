Feature: Agent skill installation targets
  As a customer's AI agent
  I want Jolly to install skills in standard locations while adding environment-specific guidance
  So that skills are discoverable by supported agents without fragmenting version management

  @logic
  Scenario: Jolly installs skills in the project-local .agents/skills location
    Given the agent invokes `jolly skills install`
    When Jolly installs the default skill set
    Then it should install the Jolly skill and the Saleor agent-skills via `npx skills add <ref>`
    And it should fall back to a Git-based install only for a skill not available via `npx skills add`
    And each installed skill should land under `.agents/skills/<id>/`
    And it should record the installed skill ids and versions in the skills lock/metadata file written by `npx skills add`

  @logic
  Scenario: Jolly installs the default skill set concurrently
    Given the agent invokes `jolly skills install` in a project missing several default skills
    When Jolly installs the default skill set via `npx skills add`
    Then the skill installs should run concurrently, a later skill's install beginning before an earlier skill's install finishes
    And every default skill should still land under `.agents/skills/<id>/`
    And the skills lock/metadata file should record every installed skill id without corruption

  @logic
  Scenario: Jolly adds agent-specific glue
    Given the default skill set has been installed under `.agents/skills/`
    When the agent invokes `jolly skills install` in a project with a CLAUDE.md file
    Then Jolly should write the glue file for the detected agent `claude`
    And the glue should reference the installed skill path `.agents/skills/jolly/`

  @logic
  Scenario: Detection falls back to generic when no agent marker is present
    Given a project containing no known agent directory or marker
    When Jolly determines the agent environment
    Then it should write generic glue
    And it should report that no specific agent was detected

  Rule: Installation strategy
    - Install skills via `npx skills add <ref>`; fall back to a Git-based install only for a skill not available that way.
    - The default set is the Jolly skill plus the Saleor agent-skills; the Jolly skill is the end-to-end playbook for supervising `jolly start` as it spawns the official CLIs.
    - Use standard project-local skills where possible.
    - Add agent-specific glue/instructions for Zed, Claude Code, Cursor, OpenCode, Pi.dev, and generic agents.
    - Keep version management centralized through Jolly CLI commands.
    - Do not store secrets in skill directories or agent guidance.

  Rule: Agent detection
    - Jolly detects the current agent environment and writes the correct glue files. The `claude` glue (written when a CLAUDE.md marker is present) and the generic fallback (when no agent marker is present) are pinned by the detection scenarios above.
