@eval
# Opt-in skill-behavior evaluation. NOT part of the default green/red worklist:
# it drives a live baseline agent over the Captain-owned Jolly skill, so it is
# non-deterministic, credentialed, and slow. Tagged @eval and EXCLUDED from the
# default profile (cucumber.js: `not @meta and not @eval`); it runs only via an
# explicit `eval` profile/command. Decision 2026-06-13: the skill-behavior eval,
# previously deferred ("validated by real use, not cucumber"), is pulled forward
# now — but as this separate opt-in tier, never as a gate on normal CI.
Feature: Agent skill affordance evaluation
  As the maintainer of the Jolly skill
  I want to check that a baseline agent, given only the documented skill and CLI,
  can actually discover and drive Jolly
  So that the skill's usability is measured, not just assumed by real use

  # Why "affordance", not "outcome": a live LLM agent varies run to run, so this
  # eval asserts that the skill gave the agent the AFFORDANCES to use Jolly —
  # that it found and invoked Jolly's documented commands and reached the
  # documented local project state — not that it produced a perfect, deployed
  # store. The skill's editorial quality stays a real-use concern (Captain-owned,
  # otherwise untested); this tier tests the agent's ability to ACT on it.

  Background:
    Given the actual published-shape Jolly CLI and the actual Captain-owned Jolly skill (no mocks)
    And feature 007 defines the local artifacts `jolly init` produces

  Rule: Opt-in, outside the default worklist
    - The eval is tagged `@eval` and excluded from the default BDD profile, the
      way `@meta` (feature 023) is; it never gates normal green/red CI.
    - It runs only through an explicit `eval` profile / command, on demand.

  Rule: Driven by a baseline agent, skip-not-fail when unavailable
    - The eval drives a BASELINE coding agent — the bundled `pi` agent
      (`@earendil-works/pi-coding-agent`, run as `npx pi --model <model>`) — over
      the documented skill and CLI in a clean workspace. The point is a generic
      agent with no Jolly-specific priming beyond the installed skill.
    - The agent runs under a FAKE, throwaway `$HOME` (a per-run temp directory),
      so `pi`'s own config, state, and credentials are isolated to the run, leave
      no trace in the real home, and the run is reproducible.
    - Harness-only `HARNESS_*` knobs (never `JOLLY_*`) configure it:
      `HARNESS_OPENROUTER_API_KEY` (the OpenRouter model API key, provided into
      the agent's env as whatever `pi`/OpenRouter reads) and `HARNESS_EVAL_MODEL`
      (the model, e.g. `deepseek/deepseek-v4-flash`).
    - When the runner or `HARNESS_OPENROUTER_API_KEY` is absent, the scenario is
      SKIPPED with a clear reason, never failed — exactly like `@sandbox`
      credential gating. Logic-tier tests are unaffected.

  Rule: Harmless by design — bounded, no real cloud
    - The agent runs in a unique per-run temporary workspace, with FORCED SAFE
      credentials: dummy `JOLLY_*` values and an unroutable `.invalid` Cloud API
      base (the "012 incident" discipline). So even if the agent invokes a
      create/deploy command, it cannot reach a real account, create a billable
      resource, or deploy.
    - The task is scoped to the no-irreversible-action subset that succeeds
      under safe credentials: install/locate the skills, `jolly init`, and
      validate readiness with `--dry-run` previews and `jolly doctor`. A
      live-store eval (real provisioning + deploy) is a future, explicitly
      credentialed `@eval` extension — not this scenario.
    - The per-run workspace and the fake `$HOME` (and anything created in them)
      are removed in teardown; the eval never touches resources outside them.

  Rule: Assert affordances and real artifacts, never fabricated outcomes
    - Affordance is observed two ways: (1) the agent actually INVOKED Jolly's
      documented CLI commands, captured by a PATH shim that logs argv and then
      execs the real binary; and (2) the documented local artifacts Jolly
      produces exist on disk (per feature 007: the installed Jolly skill, a
      merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`).
    - Jolly's diagnostics must have run and emitted the standard feature 020
      output envelope.
    - The eval must NOT assert a working deployed store, and must NOT assert
      artifacts Jolly does not produce (there is no `jolly.config.ts`).

  Scenario: A baseline agent uses the Jolly skill to set up a project
    Given a fresh per-run temporary workspace with the Jolly skill and CLI available
    And the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated
    And the agent is run with forced safe credentials so no real cloud resources can be created
    And Jolly's CLI invocations in the workspace are traced
    When a baseline agent is given the task:
      """
      Set up a Jolly storefront project in this directory using the documented
      Jolly skill and CLI. Initialize the project and validate readiness with
      Jolly's diagnostics. For anything that would create cloud resources or
      deploy, use Jolly's dry-run previews only — do not create real resources
      and do not deploy.
      """
    Then the agent should have invoked Jolly's documented CLI commands
    And the workspace should contain the local artifacts `jolly init` produces (the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)
    And Jolly's diagnostics should have run and emitted the standard output envelope
    And no real cloud resource should have been created and nothing should have been deployed
