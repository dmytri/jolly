@eval
# Opt-in skill-behavior evaluation. NOT part of the default green/red worklist:
# it drives a live baseline agent over the shipped Jolly skill, so it is
# non-deterministic, credentialed, and slow. Tagged @eval and EXCLUDED from the
# default profile (cucumber.js: `not @eval`); it runs only via an
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
    - The eval is tagged `@eval` and excluded from the default BDD profile; it
      never gates normal green/red CI.
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

  Rule: Live by design — real integrated test env, namespaced and disposable
    - The agent runs in a unique per-run temporary workspace seeded with the
      REAL integrated test-env credentials (the runtime `JOLLY_*` Saleor Cloud /
      Stripe values and the real Saleor endpoint). There are NO fakes: no dummy
      credentials, no `.invalid` endpoints, no fake Stripe/configurator CLIs. The
      agent acts against the real services exactly as a customer's agent would.
    - The task is the REAL entry point, not a hand-held script: the agent is
      given exactly the string the homepage copy box hands a customer's agent —
      "Read https://jolly.cool/setup and follow the instructions to set up
      Jolly" — and nothing more (the `HARNESS_EVAL_SETUP_LOCAL` knob may point it
      at the local source of that same page for pre-deploy iteration). The eval
      thus measures the affordance from the true starting point.
    - Safety is harmless-by-design, NOT faking (see AGENTS.md): every resource
      the agent creates is `jolly-test`-namespaced and removed in best-effort
      teardown; Saleor Cloud environments are disposable cannon fodder, so an
      environment-limit rejection is reclaimed by deleting `jolly-test`-namespaced
      environments, never by faking, and only `jolly-test`-namespaced resources
      are ever deleted. Stripe runs in test mode with test cards (worst case: a
      declined transaction, never a real charge).
    - Best-effort teardown of created cloud resources is the DEFAULT (harmless).
      An opt-in `HARNESS_EVAL_KEEP_STORE` knob (set → retain) skips that teardown
      so the run's created store — the `jolly-test`-namespaced Saleor environment
      and its Vercel deployment — is left standing and its reported URLs stay
      usable for inspection. Retained resources keep the `jolly-test` namespace,
      so the next run's leftover-reclamation removes them; the knob is operability
      only and never changes pass/fail. Unset → normal best-effort teardown.
    - Capability gating, skip-not-fail: a live Vercel deploy needs a real
      `vercel login` session on the runner; absent it, the deploy step is gated
      (skipped, not failed). The run still exercises every stage its available
      credentials and capabilities allow.
    - The agent reaches `https://jolly.cool/setup` (or the local source) over the
      network and may install skills from github; these fetches are expected, and
      the eval also smoke-tests that the entry point is reachable.
    - The per-run workspace and the throwaway `$HOME` are removed in teardown;
      the eval never touches resources outside its `jolly-test` namespace.

  Rule: Assert affordances and real live artifacts, never fabricated outcomes
    - Affordance is observed two ways: (1) the agent actually INVOKED Jolly's
      documented CLI commands, captured by a PATH shim that logs argv and then
      execs the real binary; and (2) the documented local artifacts Jolly
      produces exist on disk (per feature 007: the installed Jolly skill, a
      merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`).
    - Jolly's diagnostics must have run and emitted the standard feature 020
      output envelope.
    - With the real Saleor token present the agent authenticates and can proceed
      through the live stages (create a `jolly-test`-namespaced store, deploy the
      recipe, seed stock), so the eval may observe real namespaced resources, not
      just local files. It asserts the live result WHERE the capability is present
      and honest gating where it is not — it never asserts an outcome the agent
      did not actually achieve. The Stripe-import affordance (Jolly importing real
      test-mode keys via the read-only Stripe CLI) is covered by feature 005.
    - For each live stage the run completes, the eval surfaces the real endpoint
      Jolly reported in its output envelope: the Saleor dashboard URL for the
      `jolly-test`-namespaced environment it created, and the deployed storefront
      URL when the Vercel deploy completed. These are observed from Jolly's own
      output, never fabricated — a gated deploy yields no storefront URL and the
      run reports its absence rather than inventing one.
    - The eval must NOT fabricate or assume outcomes (no working-store claim the
      run did not produce) and must NOT assert artifacts Jolly does not produce
      (there is no `jolly.config.ts`). Any cloud resource the agent created must
      be `jolly-test`-namespaced and cleaned up.

  Scenario: A baseline agent follows the published /setup entry point to set up a project
    Given a fresh per-run temporary workspace with the Jolly skill and CLI available
    And the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated
    And a real Stripe CLI test-mode session is available
    And the agent is run with the real integrated test-env credentials, every resource it creates `jolly-test`-namespaced and removed in teardown
    And Jolly's CLI invocations in the workspace are traced
    When a baseline agent is given the task:
      """
      Read https://jolly.cool/setup and follow the instructions to set up Jolly
      """
    Then the agent should have invoked Jolly's documented CLI commands, including `jolly start`
    And the workspace should contain the local artifacts `jolly init` produces (the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)
    And Jolly's diagnostics should have run and emitted the standard output envelope
    And for each live stage it completed it should report the real URL Jolly emitted — the Saleor dashboard URL for the `jolly-test`-namespaced environment it created, and the deployed storefront URL when the Vercel deploy completed
    And the run should report only outcomes it actually achieved, stopping honestly at any remaining human gate without fabricating success
    And every cloud resource the agent created should be `jolly-test`-namespaced and, unless retention is explicitly requested via `HARNESS_EVAL_KEEP_STORE`, removed in best-effort teardown, with nothing outside that namespace touched
