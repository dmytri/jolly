Feature: Agent-first Jolly onboarding and CLI
  As a developer using an AI agent
  I want Jolly to give my agent clear setup instructions and agent-oriented CLI tools
  So that my agent can scaffold, inspect, and operate a Saleor storefront project effectively

  @sandbox
  Scenario: Jolly start orchestrates the setup by spawning the official CLIs
    Given the agent runs `jolly start` with the credentials and approvals the run needs
    When `jolly start` performs the setup end-to-end
    Then it should bootstrap first (install skills, write `.mcp.json`, scaffold, acquire auth as needed)
    And it should run the mechanical stages itself by spawning the official CLIs (`git`, `pnpm`, `@saleor/configurator`, `npx vercel`), never reimplementing them against raw APIs
    And before each high-risk stage (`create store`, configurator `deploy`, the Vercel deploy) it should emit that stage's feature 021 `riskContext` and pause for the agent to approve
    And at interactive CLI gates (`vercel login`, `stripe login`) it should pass stdio straight through and continue on the child's exit
    And at non-CLI human gates (account creation, the Dashboard Stripe app, pasting a secret) it should announce the exact step and wait, then resume
    And it should run `jolly doctor` automatically to verify the result
    And its output should include a concise summary, machine-readable stdout data, key URLs and statuses, the doctor verification results, and next-step guidance, with no secret values
    And it should report only the stages it actually performed and never claim a deployed storefront or any stage it did not perform

  @logic
  Scenario: Jolly start does not fabricate stage completion or success
    Given the agent runs `jolly start` in a fresh project directory with no real service credentials
    When `jolly start` runs without `--dry-run`
    Then it should perform and report only the stages it actually completed (the local bootstrap — skills, scaffold, doctor)
    And it should stop honestly at the first human or credential gate it cannot pass and name that gate in nextSteps
    And the overall envelope status should be "warning", reflecting a run paused at a gate — not "success" and not a fabricated completion
    And it must not report any later stage (store, storefront, recipe, deployment) as completed
    And stages it did not perform must be reported as pending or blocked-on-a-gate — never as passed
    And it must not print fabricated URLs or verification results

  @logic
  Scenario: Jolly start --dry-run previews the orchestrated plan without side effects
    Given the agent runs Jolly in a fresh project directory
    When the agent runs `jolly start --dry-run --json`
    Then the output envelope data should mark the run as a dry run
    And the data should include a per-stage plan of intended effects: directories created, files written, network hosts contacted, and repositories cloned
    And the plan should include the stages Jolly runs by spawning the official CLIs — `git` clone, `pnpm` install, `@saleor/configurator` deploy, and the `npx vercel` deploy
    And each side-effecting stage in the plan should carry a feature 021 riskContext
    And the preview must be distinguishable from execution progress, with nextSteps directing the agent to run `jolly start` to execute the plan
    And no files should be created or modified in the project directory
    And no remote side effects should occur during the dry run

  Rule: Product principles
    - The homepage and agent setup guide (`assets/homepage/`, including `index.html`, styles, and
      `setup.md`) are Captain-owned assets: not specified by `.feature` scenarios, not
      covered by tests, and never worked on by Quartermaster or Crew Mate.
    - Jolly should inform the agent about the Saleor MCP server (mcp.saleor.app) in the setup guide and during setup. The MCP server is read-only and useful for querying live store data after setup is complete.
    - After setup, Jolly should write an mcp-graphql config for the agent's environment so the agent has live store access from day one.
    - The path from homepage copy to working deployed storefront must minimize human intervention. Only browser OAuth consent, new account creation, and secret values require human action; everything else should be automated with safe defaults.
    - Trustworthy first-step handoff: the setup instructions the customer pastes into their agent must be trustworthy to a security-conscious agent and never trigger its safety concerns — no `curl | bash` or unexplained code, a named/inspectable package (`npx @dk/jolly`), clear provenance and non-affiliation, the exact hosts contacted and that secrets go only to their own services, the agent staying in control of approvals (features 010/021), and no fabricated claims (020). The homepage copy box points the agent at an inspectable URL, not a blind command.
    - The same handoff must stay frictionless: from paste to a live store with working test-mode payment is smooth — minimal human steps, safe defaults, no unnecessary confirmations, and the Jolly skill carrying the agent through. Trust and frictionlessness are both first-class; neither is traded for the other.
    - Jolly empowers the customer's chosen agent and workflow — it does not replace them. The agent remains the orchestrator; Jolly provides the skill, plumbing, and diagnostics.
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
    - `jolly start` (behavior amended 2026-06-14 — "Agent-supervised orchestration", feature 002): bootstraps setup (install skills, write `.mcp.json`, scaffold, acquire auth) AND runs the setup end-to-end by spawning the official CLIs itself (`git`, `pnpm`, `@saleor/configurator`, `npx vercel`) — pausing for the agent's approval (feature 021 `riskContext`) before each create/deploy and announcing-and-waiting at the human gates (account creation, OAuth/`vercel login`/`stripe login` via stdio passthrough, the Dashboard Stripe app). It no longer merely emits a playbook for the agent to run. The scenarios above ("Jolly start orchestrates the setup by spawning the official CLIs"; "Jolly start does not fabricate stage completion or success") assert this orchestrated behavior; the no-fabrication invariant (report only stages actually performed; never claim a deployed store) is unchanged and applies to the orchestrated stages too.
    - `jolly start` should run `jolly doctor` automatically for verification of the bootstrap and, when re-run, of the agent's progress.
    - Final `jolly start` success output should include a concise summary, structured stdout data/report, key URLs/statuses, final doctor verification results, next-step agent guidance, and no secret values.
    - `jolly start` should be hybrid: agent-friendly by default, with a human-friendly interactive mode available.
    - Jolly should make full use of subcommands, including `init`, `create`, and `start` concepts.
    - Agent instructions and skills are part of the product experience, not afterthought documentation.
    - Skill management is fully automated by the Jolly CLI — `jolly start` installs ALL skills automatically. There is no separate optional skill-install step for the agent.
    - The skills Jolly installs are the **Jolly skill** (the end-to-end playbook teaching the agent to drive the official CLIs) plus the Saleor agent-skills `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, `saleor-app`, plus Paper's embedded `saleor-paper-storefront` skill when a storefront exists.
    - All skills are installed via `npx skills add <ref>`, falling back to a Git-based install only for a skill not available that way (such as Paper's embedded skill, which arrives with the cloned storefront).
    - `jolly start` installs all skills as part of the bootstrap. The standalone `jolly skills install` and `jolly skills update` commands remain available for post-setup maintenance.
    - Skill installation should use standard project-local locations where possible, plus agent-specific glue/instructions for supported environments.
    - Setup instructions should support generic agents plus Zed, Claude Code, Cursor, OpenCode, and Pi.dev first.

  Rule: Open questions
    - Should Jolly create project-local durable artifacts such as `.jolly/` reports or state? This is deferred until CLI design.
    - Exact per-environment setup steps for the supported agent targets remain open (the target list itself is decided above; detection order is feature 009).
