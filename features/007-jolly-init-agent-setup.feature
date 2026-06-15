Feature: Jolly init for local agent setup
  As a customer's AI agent
  I want `jolly init` to prepare local agent guidance and skills
  So that `jolly start` (or a future re-initialization) can rely on skills being present

  Background:
    Given skill installation is fully automated — `jolly start` installs the Jolly skill and all Saleor agent skills automatically via `npx skills add`
    And the agent never runs `jolly init` or `jolly skills install` as an explicit separate step
    And `jolly init` remains available as a standalone command for repo re-initialization and maintenance

  @logic
  Scenario: Agent initializes Jolly guidance locally
    Given the agent can run Jolly via `npx`
    When the agent invokes `jolly init`
    Then Jolly should install or check the full default skill set via `npx skills add`
    And the default skill set should include the Jolly skill plus `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`
    And the Jolly skill should be the end-to-end playbook for supervising `jolly start` as it spawns the official CLIs
    And it should include Paper's embedded `saleor-paper-storefront` skill (Git-installed with the cloned storefront) when a storefront exists
    And Jolly should report each skill as actually verified on disk, not unconditionally claim success
    And Jolly should write agent-specific glue files or instructions for supported environments
    And the glue files should actually exist on disk under standard project-local skill locations
    And the envelope `data` should list the installed skill ids
    And Jolly should not create remote Saleor Cloud or Vercel resources
    And Jolly should not store secrets

  @logic
  Scenario: Agent init is safe to rerun and detects existing state
    Given `jolly init` has already been run in a temp project directory
    When the agent invokes `jolly init` in the same directory again
    Then Jolly should detect the existing skills and guidance from the first run
    And it should report the existing state in the output envelope rather than erroring
    And it should update outdated managed guidance when the managed version differs
    And user-authored lines in AGENTS.md outside the Jolly marker should remain unchanged
    And it should merge, not replace, any existing .mcp.json, adding the Jolly MCP server entry to the existing servers object rather than writing a fresh object
    And it should merge, not replace, any existing AGENTS.md or agent glue file, inserting or updating the Jolly section without removing user-authored content
    And the envelope `data` should summarize the changes made

  @logic
  Scenario: Agent init is safe to rerun in a clean directory
    Given `jolly init` has not been run before
    When the agent invokes `jolly init` in a temp project directory
    Then Jolly should install the full default skill set
    And the output envelope should report a status of success
    And the summary should indicate what was installed

  @sandbox
  Scenario: Skills install non-interactively with no agent runtime present
    # Reproduces a fresh customer machine: the real installer runs with no interactive
    # terminal and no agent runtime detected. Needs no Saleor credentials.
    Given `jolly init` runs with no interactive terminal and no agent runtime detected
    When it installs the default skill set
    Then each default skill should be installed under `.agents/skills/<id>/` and verified on disk
    And the install should require no interactive prompt and no specific agent to be present
    And Jolly should report success only when every skill actually landed on disk

  @sandbox
  Scenario: The Jolly skill installs from the bundled copy with no network
    # The Jolly skill ships inside @dk/jolly; installing it must not depend on
    # the network or on the skill being pushed to GitHub (Rule "Jolly skill
    # source"). Reproduced by blocking outbound network during the install: the
    # bundled copy still lands; a network-only ref would fail to clone. Needs no
    # Saleor credentials.
    Given `jolly init` runs with outbound network blocked
    When it installs the default skill set with no network
    Then the Jolly skill should be installed under `.agents/skills/jolly/` from the bundled copy
    And the installed Jolly skill content should match the bundled copy

  @sandbox
  Scenario: A failed skill install surfaces the error and exits non-zero
    Given a default skill whose clone or install step fails
    When `jolly init` installs the default skill set
    Then Jolly should surface that step's stderr
    And `jolly init` should exit non-zero
    And it must not report that skill as installed or verified on disk

  Rule: Skill installation is non-interactive and agent-agnostic
    - `jolly init`/`start` install skills with no interactive prompts and no dependence on a TTY,
      a human, or any particular agent runtime being present or selected: the install behaves the
      same whether zero, one, or many agents are installed, and always writes the universal
      `.agents/skills/<id>/` location.
    - The skill installer is invoked with its OWN non-interactive flag so it never opens an
      agent/skill picker. Spawned non-interactively a picker installs nothing while still exiting
      0 — a silent failure — so on-disk verification (below) is authoritative: a skill that did not
      land reads as fail, never pass.

  Rule: Init boundaries
    - `jolly init` is automatically invoked by `jolly start` as part of the setup flow. The agent never runs it as an explicit step.
    - `jolly init` is available standalone for repo re-initialization and maintenance.
    - `jolly init` may call or share logic with `jolly skills install`.
    - Skills are installed via `npx skills add <ref>` (the Jolly skill and the Saleor agent-skills), falling back to a Git-based install only for a skill not available that way (such as Paper's embedded skill).
    - `jolly init` should not perform Saleor Cloud authentication, registration, configuration deployment, storefront creation, or Vercel deployment.
    - `jolly init` should not store secrets.
    - Jolly must never silently overwrite an existing .mcp.json or AGENTS.md. Merge, never replace.
    - Skill installation output must reflect what was actually verified on disk, not pre-computed names. If a clone or install step fails, surface stderr and exit non-zero.
    - The standard project-local skill location is `.agents/skills/<id>/` — the universal directory `npx skills add` (with no `--agent`) writes to, read by all supported agents. Jolly's on-disk verification must check there; a real install must not read as "not installed" because the check looked only under one agent's `.claude/skills/`.
    - Exact per-agent instruction file targets remain open.

  Rule: Jolly skill source
    - The Jolly skill ships bundled inside the published `@dk/jolly` package (`assets/skills/` is
      listed in the package `files`); `jolly init`/`start` install it from that bundled copy,
      resolved relative to Jolly's own module path — so installing the Jolly skill needs no
      network and does not depend on the skill being pushed to GitHub.
    - The canonical remote equivalent, for a direct or manual install, is the explicit subpath
      ref `npx skills add https://github.com/dmytri/jolly/tree/main/assets/skills/jolly`. The
      bare `npx skills add dmytri/jolly` also resolves (the repo exposes exactly one skill), but
      the explicit ref is preferred for determinism.
    - The Saleor agent-skills are installed from their own `npx skills add` refs. The Jolly skill
      stays under `assets/` (Shipshape rule) and is not moved to a top-level `skills/` directory.
