@eval
# Opt-in skill-behavior evaluation. NOT part of the default green/red worklist:
# it drives a live baseline agent over the shipped Jolly skill, so it is
# non-deterministic, credentialed, and slow. Tagged @eval and EXCLUDED from the
# default profile (cucumber.js: `not @meta and not @eval`); it runs only via an
# explicit `eval` profile/command. It is a separate opt-in tier, never a gate on
# normal CI.
Feature: Agent skill affordance evaluation
  As the maintainer of the Jolly skill
  I want to check that a baseline agent, given only the documented skill and CLI,
  can actually discover and drive Jolly
  So that the skill's usability is measured, not just assumed by real use

  # Why "affordance", not "outcome": a live LLM agent varies run to run, so this
  # eval asserts that the skill gave the agent the AFFORDANCES to use Jolly —
  # that it found and invoked Jolly's documented commands and reached the
  # documented local project state — not that it produced a perfect, deployed
  # store. The skill's editorial quality stays a real-use concern outside normal
  # deterministic testing; this tier tests the agent's ability to ACT on it.

  Background:
    Given the actual published-shape Jolly CLI and the actual shipped Jolly skill (no mocks)
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
    - The task is the REAL entry point, not a hand-held script: the agent is
      given exactly the string the homepage copy box hands a customer's agent —
      "Read https://jolly.cool/setup and follow the instructions to set up
      Jolly" — and nothing more. The eval thus measures the affordance from the
      true starting point (can a baseline agent, from that one pointer, discover
      and drive Jolly?), not from a pre-decomposed worklist.
    - Safety therefore does NOT come from a narrowed task. It comes entirely
      from the forced-safe credentials and harness fakes above: even if the
      agent attempts the full playbook (login, `create store`, deploy), the
      `.invalid` Cloud API base and dummy `JOLLY_*` make every real-account
      action fail honestly, and there is no Vercel auth to deploy with. A
      live-store eval (real provisioning + deploy) is a future, explicitly
      credentialed `@eval` extension — not this scenario.
    - The agent reaches `https://jolly.cool/setup` over the network (a public,
      static setup guide) and may install skills from github; these harmless
      fetches are expected. The eval consequently also smoke-tests that the real
      entry point is reachable.
    - The Stripe CLI on the workspace PATH is a harness fake that returns dummy
      `pk_test_`/`sk_test_` values (and contacts no network), standing in for a
      completed `stripe login`. So importing Stripe keys exercises the affordance
      without any real Stripe account or live key.
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
    - Stripe affordance: the fake Stripe CLI session is seeded, but this
      entry-point scenario does not assert Stripe keys land in `.env`. Following
      the real `/setup` under forced-safe credentials, the agent runs `jolly
      start`, which (per "Agent-supervised orchestration", feature 002) reaches
      the Stripe stage only after the Saleor login/store stages — and those stop
      at the human credential gate under the `.invalid` safe creds, so the run
      never reaches Stripe. The Stripe-import affordance (Jolly importing test
      keys via the read-only Stripe CLI, no fresh OAuth or paste) is covered by
      feature 005 (`@logic`/`@sandbox`).
    - The eval must NOT assert a working deployed store, and must NOT assert
      artifacts Jolly does not produce (there is no `jolly.config.ts`).

  Scenario: A baseline agent follows the published /setup entry point to set up a project
    Given a fresh per-run temporary workspace with the Jolly skill and CLI available
    And the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated
    And a Stripe CLI session is already present (a harness-fake Stripe CLI returning dummy test-mode keys), as if `npx @stripe/cli login` had been completed
    And the agent is run with forced safe credentials so no real cloud resources can be created
    And Jolly's CLI invocations in the workspace are traced
    When a baseline agent is given the task:
      """
      Read https://jolly.cool/setup and follow the instructions to set up Jolly
      """
    Then the agent should have invoked Jolly's documented CLI commands, including `jolly start`
    And the workspace should contain the local artifacts `jolly init` produces (the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)
    And Jolly's diagnostics should have run and emitted the standard output envelope
    And under the forced-safe credentials the run should stop honestly at a human/credential gate without fabricating success
    And no real cloud resource should have been created and nothing should have been deployed
