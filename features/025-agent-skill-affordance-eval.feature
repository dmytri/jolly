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

  Rule: Opt-in, outside the default worklist
    - The eval is tagged `@eval` and excluded from the default BDD profile; it
      never gates normal green/red CI.
    - It runs only through an explicit `eval` profile / command, on demand.

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

  Rule: Live by design — real integrated test env, namespaced and disposable
    - The agent runs in a unique per-run temporary workspace seeded with only the
      REAL test-env credentials it needs to AUTHENTICATE — the runtime
      `JOLLY_SALEOR_CLOUD_TOKEN` — but NOT
      the store endpoint (`NEXT_PUBLIC_SALEOR_API_URL`) or `SALEOR_TOKEN`: those are
      left unset so `jolly start` provisions a fresh `jolly-cannon-fodder`-namespaced
      Saleor environment and derives them, exercising the real store-creation path
      rather than reusing a pre-seeded store. There are NO fakes: no dummy
      credentials, no `.invalid` endpoints, no fake configurator CLIs. The
      agent acts against the real services exactly as a customer's agent would.
    - The task is the REAL entry point, not a hand-held script: the agent is
      given exactly the string the homepage copy box hands a customer's agent —
      "Read https://jolly.cool/setup and follow the instructions to set up
      Jolly" — and nothing more (the `HARNESS_EVAL_SETUP_LOCAL` knob may point it
      at the local source of that same page for pre-deploy iteration). The eval
      thus measures the affordance from the true starting point.
    - Safety is harmless-by-design, NOT faking (see AGENTS.md): every resource
      the agent creates is `jolly-cannon-fodder`-namespaced and removed in best-effort
      teardown; Saleor Cloud environments are disposable cannon fodder. Because
      the org has a finite environment limit, the harness reclaims capacity
      BEFORE the agent provisions — deleting leftover `jolly-cannon-fodder`-namespaced
      environments from previous runs (the same reclamation the `@sandbox`
      provision path performs) so a leftover never starves the run at its store
      stage — and an environment-limit rejection encountered mid-run is likewise
      reclaimed by deleting `jolly-cannon-fodder`-namespaced environments, never by
      faking. Only `jolly-cannon-fodder`-namespaced resources are ever deleted.
    - Best-effort teardown of created cloud resources is the DEFAULT (harmless).
      An opt-in `HARNESS_EVAL_KEEP_STORE` knob (set → retain) skips that teardown
      so the run's created store — the `jolly-cannon-fodder`-namespaced Saleor environment
      and its Vercel deployment — is left standing and its reported URLs stay
      usable for inspection. Retained resources keep the `jolly-cannon-fodder` namespace,
      so the next run's leftover-reclamation removes them; the knob is operability
      only and never changes pass/fail. Unset → normal best-effort teardown.
    - Live Vercel deploy: a deploy needs a real `vercel login` session. When the
      runner has one, the eval makes that session available to the spawned Vercel
      CLI — the throwaway `$HOME` isolates the agent's own config and any creds it
      acquires, but the official CLI sessions the deploy depends on are provided —
      so the deploy actually runs and Jolly reports the real storefront URL the
      CLI returned. The `vercel login` session is fitted, so absent one the run
      FAILS and names it as a fitting-out blocker, exactly as an absent model key
      does. The run exercises every stage, and a stage it cannot reach is a
      blocker to report, never a step to gate away.
    - The agent reaches `https://jolly.cool/setup` (or the local source) over the
      network and may install skills from github; these fetches are expected, and
      the eval also smoke-tests that the entry point is reachable.
    - The per-run workspace and the throwaway `$HOME` are removed in teardown;
      the eval never touches resources outside its `jolly-cannon-fodder` namespace.

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

  @captain
  Scenario: A baseline agent sets up a project within its declared turn and token budget
    Given the turn budget and token budget declared for the baseline agent
    When the agent completes the setup task
    Then the model invocations it made should be within the declared turn budget
    And the tokens it consumed should be within the declared token budget
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
    - With the real Saleor token present the agent authenticates and can proceed
      through the live stages (create a `jolly-cannon-fodder`-namespaced store, deploy the
      recipe, seed stock), so the eval may observe real namespaced resources, not
      just local files. It asserts the live result WHERE the capability is present
      and honest gating where it is not — it never asserts an outcome the agent
      did not actually achieve.
    - For each live stage the run completes, the eval surfaces the real endpoint
      Jolly reported in its output envelope: the Saleor dashboard URL for the
      `jolly-cannon-fodder`-namespaced environment it created, and the deployed storefront
      URL when the Vercel deploy completed. These are observed from Jolly's own
      output, never fabricated — a gated deploy yields no storefront URL and the
      run reports its absence rather than inventing one.
    - The eval must NOT fabricate or assume outcomes (no working-store claim the
      run did not produce) and must NOT assert artifacts Jolly does not produce
      (there is no `jolly.config.ts`). Any cloud resource the agent created must
      be `jolly-cannon-fodder`-namespaced and cleaned up.

  Scenario: A baseline agent follows the published /setup entry point to set up a project
    Given the actual published-shape Jolly CLI and the actual shipped Jolly skill (no mocks)
    And feature 007 defines the local artifacts `jolly init` produces
    And a fresh per-run temporary workspace with the Jolly skill and CLI available
    And the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated
    And the agent is run with the real integrated test-env credentials, every resource it creates `jolly-cannon-fodder`-namespaced and removed in teardown
    And Jolly's CLI invocations in the workspace are traced
    When a baseline agent is given the task:
      """
      Read https://jolly.cool/setup and follow the instructions to set up Jolly
      """
    Then the agent should have invoked Jolly's documented CLI commands, including `jolly start`
    And the workspace should contain the local artifacts `jolly init` produces (the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)
    And Jolly's diagnostics should have run and emitted the standard output envelope
    And when the store stage completed, the run must surface the real Saleor Dashboard URL Jolly emitted for the `jolly-cannon-fodder`-namespaced environment it created — a real `.saleor.cloud/dashboard/` URL observed from Jolly's output, never fabricated — and likewise the deployed storefront URL when the Vercel deploy completed
    And the run should report only outcomes it actually achieved, stopping honestly at any remaining human gate without fabricating success
    And every cloud resource the agent created should be `jolly-cannon-fodder`-namespaced and, unless retention is explicitly requested via `HARNESS_EVAL_KEEP_STORE`, removed in best-effort teardown, with nothing outside that namespace touched
