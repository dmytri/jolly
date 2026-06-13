Feature: Agent-first Jolly onboarding and CLI
  As a developer using an AI agent
  I want Jolly to give my agent clear setup instructions and agent-oriented CLI tools
  So that my agent can scaffold, inspect, and operate a Saleor storefront project effectively

  @sandbox
  Scenario: Jolly start completes successfully
    Given `jolly start` has completed the end-to-end setup flow
    When Jolly prints the final success output
    Then it should include a concise human-readable summary
    And it should include machine-readable JSON or report data for the customer's agent on stdout
    And it should include key URLs and status values
    And it should include final verification results from an automatic `jolly doctor` run
    And it should include next-step guidance for customizing the storefront with the customer's own agent and workflow
    And it should avoid printing secret values

  @logic
  Scenario: Jolly start does not fabricate stage completion or success
    Given the agent runs `jolly start` in a fresh project directory with no real service credentials
    When `jolly start` runs without `--dry-run`
    Then it must not report any stage as completed that it did not actually perform
    And stages that were not performed must be reported as skipped, failed, or pending — never as passed
    And it must not report overall envelope status "success" for an end-to-end flow it did not complete
    And it must not print fabricated URLs or verification results

  @logic
  Scenario: Jolly start --dry-run previews the plan without side effects
    Given the agent runs Jolly in a fresh project directory
    When the agent runs `jolly start --dry-run --json`
    Then the output envelope data should mark the run as a dry run
    And the data should include a per-stage plan of intended effects: directories created, files written, network hosts contacted, and repositories cloned
    And each side-effecting stage in the plan should carry a feature 021 riskContext
    And the preview must be distinguishable from execution progress, with nextSteps directing the agent to run `jolly start` to execute the plan
    And no files should be created or modified in the project directory
    And no remote side effects should occur during the dry run

  Rule: Product principles
    - The homepage and agent setup guide (`homepage/`, including `index.html`, styles, and
      `setup.md`) are Captain-owned assets: not specified by `.feature` scenarios, not
      covered by tests, and never worked on by Quartermaster or Crew Mate.
    - Jolly should inform the agent about the Saleor MCP server (mcp.saleor.app) in the setup guide and during setup. The MCP server is read-only and useful for querying live store data after setup is complete.
    - After setup, Jolly should write an mcp-graphql config for the agent's environment so the agent has live store access from day one.
    - The path from homepage copy to working deployed storefront must minimize human intervention. Only browser OAuth consent, new account creation, and secret values require human action; everything else should be automated with safe defaults.
    - Jolly should never ask for information it can infer, detect, or safely default. Confirmation steps are only warranted for irreversible or destructive actions.
    - CLI output should favor deterministic, structured, actionable responses.
    - Default CLI output should combine concise human-readable text with machine-readable JSON blocks or artifacts.
    - All CLI commands should support `--json` for machine-readable output.
    - All CLI commands should support `--quiet` for reduced output.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - `jolly start --dry-run` is the setup guide's Step 0 ("preview the plan"): it prints
      exactly what `start` would do — directories created, files written, API hosts
      contacted, repos cloned — marks the envelope as a dry run, carries feature 021
      riskContexts for side-effecting stages, and changes nothing. Its output must be
      programmatically distinguishable from real execution progress.
    - `jolly start` should run `jolly doctor` automatically at the end for final verification.
    - Final `jolly start` success output should include a concise summary, structured stdout data/report, key URLs/statuses, final doctor verification results, next-step agent guidance, and no secret values.
    - `jolly start` should be hybrid: agent-friendly by default, with a human-friendly interactive mode available.
    - Jolly should make full use of subcommands, including `init`, `create`, and `start` concepts.
    - Agent instructions and skills are part of the product experience, not afterthought documentation.
    - Skill management is fully automated by the Jolly CLI — `jolly start` installs ALL Saleor agent skills automatically. There is no separate optional skill-install step for the agent.
    - The full default skill set is `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, `saleor-app`, plus Paper's embedded `saleor-paper-storefront` skill when a storefront exists.
    - `jolly start` installs all skills as part of the setup flow. The standalone `jolly skills install` and `jolly skills update` commands remain available for post-setup maintenance.
    - Skill installation should use standard project-local locations where possible, plus agent-specific glue/instructions for supported environments.
    - Setup instructions should support generic agents plus Zed, Claude Code, Cursor, OpenCode, and Pi.dev first.

  Rule: Open questions
    - Should Jolly create project-local durable artifacts such as `.jolly/` reports or state? This is deferred until CLI design.
    - Exact per-environment setup steps for the supported agent targets remain open (the target list itself is decided above; detection order is feature 009).
