@eval
Feature: Agent skill affordance evaluation
  As the maintainer of the Jolly skill
  I want to check that a baseline agent, given only the documented skill and CLI,
  can actually discover and drive Jolly
  So that the skill's usability is measured, not just assumed by real use

  Rule: Affordance, not outcome
    - A live LLM agent varies run to run, so this eval asserts that the skill
      gave the agent the AFFORDANCES to use Jolly: it found and invoked Jolly's
      documented commands and reached the documented local project state. It does
      not assert that the agent produced a perfect, deployed store.
    - The skill's editorial quality stays a real-use concern outside normal
      deterministic testing; this tier tests the agent's ability to ACT on it.

  Rule: Excluded from the default profile, required at the full-tier boundary
    - The eval is tagged `@eval` and excluded from the default BDD profile, so the
      fast inner loop never invokes a model.
    - At the full-tier boundary, an ordered `@eval` watch or the harbour full
      regression, the eval is a required green/red gate: it runs, and it MUST
      pass. A persistent red is a real defect in the skill's affordance, never a
      tolerated flake and never skipped.

  Rule: Driven by a baseline agent, fail loudly when its inputs are absent
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
    - Credentials are fitted, never gated on. When the runner or
      `HARNESS_OPENROUTER_API_KEY` is absent, the run FAILS and names the missing
      input as a fitting-out blocker. A tier that skips itself when its credential
      is absent reports green while proving nothing, so absence must be loud.

  Rule: Live agent, golden-captured services
    - The agent side is LIVE end to end: a real baseline agent on the fixed
      baseline model, the real installed skill, the real published-shape Jolly
      CLI, and a real fetch of the entry point. What this tier measures — the
      affordance — is exercised for real on every run.
    - The expensive service effects Jolly's commands would produce — the Saleor
      Cloud environment creation, the configurator deploy, the storefront clone
      and install, the managed skill installs `jolly init` drives through `npx
      skills add`, and the Vercel deploy — are served from golden captures:
      recorded mechanically from the licensed `@pipeline` sandbox runs of the
      same commands, committed with the verification support, and re-verified
      against the live services at harbour. This is the layered golden-capture
      ground feature 026 admits: the eval measures the affordance a layer above
      those effects, the effects themselves stay covered for real in the
      `@sandbox` tier, and every canned response is a recorded capture, never
      hand-authored. Each capture site is marked and justified inline, naming
      its source run.
    - An expensive external command the captures do not cover fails loudly and
      names what is missing, rather than falling through to the real network.
      A silent fall-through spends real install latency inside the agent's own
      budget, so the tier measures network weather instead of the affordance,
      and the run reads as an affordance failure when nothing about the
      affordance failed.
    - The workspace still seeds only what authentication documents expect — the
      runtime `JOLLY_SALEOR_CLOUD_TOKEN`, but NOT the store endpoint
      (`NEXT_PUBLIC_SALEOR_API_URL`) or `SALEOR_TOKEN` — so the agent exercises
      the full documented path from a fresh start, with the effects served from
      the captures. No hand-authored fake stands anywhere: no dummy credentials,
      no `.invalid` endpoints, no invented CLI output.
    - The task is the REAL entry point, not a hand-held script: the agent is
      given exactly the string the homepage copy box hands a customer's agent —
      "Read https://jolly.cool/setup and follow the instructions to set up
      Jolly" — and nothing more (the `HARNESS_EVAL_SETUP_LOCAL` knob may point it
      at the local source of that same page for pre-deploy iteration). The eval
      thus measures the affordance from the true starting point.
    - The captures are recorded against the run-shared persistent resources —
      the shared store and the shared deployment, which outlive runs, are never
      torn down, and self-heal — so every recorded endpoint stays live: a
      readiness probe against a captured URL answers for real, and the surfaced
      URLs are recorded, real, and still serving.
    - The run creates no cloud resource, so it needs no Vercel session, no
      capacity reclamation, and no cloud teardown. The eval's cost is the
      agent's own turns.
    - The agent reaches `https://jolly.cool/setup` (or the local source) over the
      network and may install skills from github; these fetches are expected, and
      the eval also smoke-tests that the entry point is reachable.
    - Every URL the run surfaces is the recorded real URL from the capture's
      source run, observed from Jolly's own output; the harness invents none.
    - The per-run workspace and the throwaway `$HOME` are removed in teardown.

  Rule: Affordance efficiency — what succeeding COST is the measure

    - Succeeding is a floor, not the measure. HOW MUCH the agent had to spend to
      succeed is what says whether Jolly's setup instructions and CLI output are any
      good. An agent that finishes in a few turns was guided; an agent that grinds
      through many was flailing against output that failed to tell it what it needed.
      A run that barely scrapes through after thirty confused turns passes the
      affordance scenario above identically to one that glides through in eight, so
      that scenario alone cannot see the difference. This one can.
    - Every model invocation the agent makes is recorded with the tokens it consumed
      and the Jolly command that invocation ran. The tokens come from the agent's own
      recorded usage, never an estimate and never a count Jolly computes for itself.
      The command comes from the CLI trace shim this feature already installs.
    - Together those records are the affordance map: a turn-by-turn account of where
      the agent spent its budget. A total says a run got more expensive. The map says
      WHICH turn, and against WHICH piece of Jolly's output, the agent started to
      flail. That is the finding worth having, because it names the copy to fix.
    - Flailing has an observable shape. Reaching for `--help` to recover from a Jolly
      command that reported an error is a turn Jolly's own envelope should have saved,
      because feature 020 requires that envelope to carry the nextSteps and remediation
      the recovery needs. Re-running `jolly start` to resume a pending human gate is
      NOT flailing: that is the documented resume contract.
    - Budgets are generous ceilings that catch flailing, not tight ones that catch
      noise. A live agent varies run to run, so a ceiling is set to red on an agent
      that has lost the thread, never on ordinary variance.

  Scenario: The run records what every agent turn cost and which Jolly command it ran
    Given the baseline agent has completed the setup task
    When the run's affordance map is read
    Then it should carry one entry for every model invocation the agent made
    And each entry should carry the prompt tokens and completion tokens that invocation consumed, taken from the agent's own recorded usage
    And each entry should name the Jolly command that invocation ran, taken from the CLI trace, or record that it ran none
    And a run whose agent recorded no usage should redden rather than report a cost of zero

  Scenario: A baseline agent sets up a project within its turn and token budget
    Given a turn budget of 20 model invocations and a token budget of 400000 tokens for the baseline agent
    When the agent completes the setup task
    Then the model invocations it made should be within the turn budget
    And the tokens it consumed, prompt and completion summed across every invocation, should be within the token budget
    And a run that exceeds either budget should redden, naming the turn at which it crossed the ceiling

  Scenario: Jolly's error output carries the recovery, so the agent never falls back to reading help
    Given the baseline agent has completed the setup task
    When the Jolly commands it invoked are read from the CLI trace in turn order
    Then no `--help` invocation should follow a Jolly command that reported an error
    And a `--help` invocation following an error should be reported as a wasted turn, naming the command whose envelope failed to carry its nextSteps and remediation

  Rule: Assert affordances and real live artifacts, never fabricated outcomes
    - Affordance is observed two ways: (1) the agent actually INVOKED Jolly's
      documented CLI commands, captured by a PATH shim that logs argv and then
      execs the real binary; and (2) the documented local artifacts Jolly
      produces exist on disk (per feature 007: the installed Jolly skill, a
      merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`).
    - Jolly's diagnostics must have run and emitted the standard feature 020
      output envelope.
    - With the token seeded the agent authenticates and proceeds through the
      stages, their expensive effects served from the golden captures, so the
      eval observes the full documented flow. It asserts the result WHERE the
      flow reached it and honest gating where it did not — it never asserts an
      outcome the agent did not actually achieve.
    - For each stage the run completes, the eval surfaces the endpoint Jolly
      reported in its output envelope: the Saleor dashboard URL and the deployed
      storefront URL, each the recorded real URL from the capture's source run.
      These are observed from Jolly's own output, never invented — a gated
      deploy yields no storefront URL and the run reports its absence rather
      than inventing one.
    - The eval must NOT fabricate or assume outcomes (no working-store claim the
      run did not produce) and must NOT assert artifacts Jolly does not produce
      (there is no `jolly.config.ts`). The run creates no cloud resource.

  Scenario: A baseline agent follows the published /setup entry point to set up a project
    Given the actual published-shape Jolly CLI and the actual shipped Jolly skill
    And feature 007 defines the local artifacts `jolly init` produces
    And a fresh per-run temporary workspace with the Jolly skill and CLI available
    And the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated
    And the workspace seeds only the authentication credential `JOLLY_SALEOR_CLOUD_TOKEN`, never a store endpoint or `SALEOR_TOKEN`
    And the expensive service effects Jolly's commands produce are served from the golden captures recorded by the licensed @pipeline sandbox runs
    And Jolly's CLI invocations in the workspace are traced
    When a baseline agent is given the task:
      """
      Read https://jolly.cool/setup and follow the instructions to set up Jolly
      """
    Then the agent should have invoked Jolly's documented CLI commands, including `jolly start`
    And the workspace should contain the local artifacts `jolly init` produces (the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)
    And Jolly's diagnostics should have run and emitted the standard output envelope
    And when the store stage completed, the run must surface the Saleor Dashboard URL Jolly emitted — the recorded real `.saleor.cloud/dashboard/` URL from the capture's source run, observed from Jolly's output, never invented — and likewise the deployed storefront URL when the deploy stage completed
    And the run should report only outcomes it actually achieved, stopping honestly at any remaining human gate without fabricating success
    And the run should have created no cloud resource, with the per-run workspace and the throwaway `$HOME` removed in teardown
