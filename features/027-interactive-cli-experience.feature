Feature: Human-facing interactive CLI experience
  As a developer running Jolly by hand in a terminal
  I want jolly start to walk me through setup with clear prompts and sane defaults
  So that I can launch a store interactively without memorizing flags, while the agent path stays unchanged

  Background:
    Given Jolly is executable via `npx`

  Rule: Interactive start discovery is TTY-gated, additive, and never blocks the agent path
    - When stdin and stdout are an interactive terminal and neither `--json` nor `--yes`/`-y`
      is set, `jolly start` runs an interactive discovery — built on Bombshell
      (`@clack/prompts`) — that walks the human through only the setup decisions that cannot
      be safely inferred or defaulted.
    - The interactive layer is purely additive. With `--json`, with `--yes`/`-y`, or with no
      interactive terminal (the agent-driven subprocess), `jolly start` behaves exactly as the
      agent-first command does today: no prompt is shown, nothing blocks waiting for input, and
      `--json` stdout stays a single envelope (feature 020).
    - Every interactive prompt carries a sane default, and pressing Enter accepts it. Accepting
      every default reaches the same resolved configuration as the non-interactive `--yes` run.
      Jolly never asks for a value it can infer, detect, or safely default (feature 001).
    - Discovery prompts the human only for what is genuinely a human decision or secret: the
      Saleor Cloud token when none is configured (pasted with Bombshell masked entry, exactly as
      `jolly login`, never echoed), the Saleor organization to use when the token resolves more
      than one (with exactly one, Jolly uses it without asking, per feature 012), the environment
      name when none is configured, and the storefront project directory — each decision pre-filled
      with a sane default.
    - Because the interactive layer serves a human, it surfaces its resolved decisions in the
      terminal output, not in a machine envelope: it names the organization it will target, lists
      the mechanical setup stages it will run, and on a decline reports that setup stopped with no
      side-effecting stage run. The machine-readable plan and resolved configuration remain
      available only on the `--json` path (feature 020).
    - Each side-effecting create or deploy stage is confirmed before it runs — the human
      analogue of feature 021's per-stage riskContext approval. The default is to proceed, so
      Enter advances; declining stops honestly and never fabricates later-stage success.
    - The interactive layer shows in-place progress for the long mechanical stages — Bombshell
      spinners on stderr that update in place rather than spewing a line per tick (feature 020) —
      and tells the human about the human steps the run involves: it runs the Vercel sign-in with
      them inline when the deploy stage needs it, and the final Stripe key entry in the Saleor
      Dashboard is theirs to complete at the end. The machine path (`--json`, or no terminal) shows
      no progress at all.
    - The interactive layer and its Bombshell dependencies are bundled into the published
      `dist/index.js`, so `npx @dk/jolly` runs self-contained (feature 006's published-launcher
      scenario guards this).

  @logic
  Scenario: Interactive start previews the plan, and Enter accepts every default
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal with no flag beyond `--dry-run`
    When the user presses Enter at every prompt
    Then Jolly should present interactive setup prompts
    And the interactive output should list the mechanical setup stages, including the store, storefront, and deployment stages
    And no file should be created or modified in the project directory

  @logic
  Scenario: Interactive start prompts to choose the organization only when the token has more than one
    Given a fresh empty project directory
    And the Cloud token can access organizations "org-one" and "org-two"
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should present an organization choice naming "org-one" and "org-two"
    And accepting the default should name "org-one" as the target organization in the output

  @logic
  Scenario: Interactive start uses the only organization without asking when the token has exactly one
    Given a fresh empty project directory
    And the Cloud token can access organization "org-solo" only
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should name "org-solo" as the target organization
    And no organization choice should be shown, because the token resolves exactly one organization

  @logic
  Scenario: Interactive start tells the human about the human steps the run involves
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should say Jolly will run the Vercel sign-in with the human inline
    And the interactive output should name the Saleor Dashboard Stripe key entry as the final human step

  @logic
  Scenario: --yes runs jolly start with no prompt even on an interactive terminal
    Given a fresh empty project directory
    When `jolly start --dry-run --yes` runs in an interactive terminal and receives no input
    Then Jolly should complete without blocking for any prompt
    And no interactive prompt should be shown

  @logic
  Scenario: Declining the confirmation before a side-effecting stage stops honestly
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user declines the confirmation before the first side-effecting stage
    Then the interactive output should state that setup stopped before the first side-effecting stage ran
    And the interactive output should not report the store, storefront, recipe, or deployment stages as completed
    And Jolly must not print a fabricated store URL or verification result

  @logic @property
  Scenario: The interactive layer never pollutes machine output
    Given a fresh empty project directory
    When `jolly start --dry-run --json` runs in an interactive terminal
    Then stdout should contain a single JSON envelope and nothing else
    And no prompt or spinner text should appear on stdout

  @logic
  Scenario: An unsupported command fails clearly and names the supported surface
    When the agent runs `jolly frobnicate --json`
    Then the envelope status should be "error" with a stable `code`
    And the error should name the supported commands login, logout, auth status, init, start, doctor, upgrade, skills, create, and completion

  @logic
  Scenario: An unsupported flag fails clearly on the agent path, never silently ignored
    When the agent runs `jolly start --frobnicate --json`
    Then the envelope status should be "error" with a stable `code`
    And the error should name the unsupported flag `--frobnicate`

  @logic
  Scenario: Shell completion emits a script naming the command surface
    When the agent runs `jolly completion bash`
    Then stdout should contain a shell completion script for the `jolly` command
    And the script should reference the supported commands login, logout, init, start, doctor, upgrade, skills, and create

  @logic
  Scenario: Shell completion returns candidate completions at completion time
    When the agent runs `jolly complete -- lo`
    Then stdout should list the candidate completions `login` and `logout`

  Rule: Typed arguments and shell completion
    - Argument parsing for every `jolly` invocation — agent and human alike — runs through a
      single Bombshell (`@bomb.sh/args`) typed parser; Jolly keeps no second, hand-rolled
      parse path. Flags are typed, and an unsupported command or flag fails with a clear error
      naming the supported surface rather than being silently accepted. On the agent path
      (default, `--json`, `--yes`, non-TTY) the Bombshell parser yields the identical feature
      020 envelope and accepts the identical flag surface the agent uses today — so "the agent
      path is unchanged" means its observable behaviour is unchanged, reached through Bombshell,
      not that the agent keeps a different parser.
    - Shell completion is built on Bombshell (`@bomb.sh/tab`): `jolly completion <shell>`
      prints a completion script the user sources, and at completion time the shell invokes
      `jolly complete -- <words>` to receive candidate completions for the command surface.
    - `completion` is the single command exempt from the feature 020 `--json` envelope: its
      output is a shell script consumed by `source`, not a JSON envelope. It still supports
      `--help`.

  Rule: Bombshell is the single CLI plumbing — no redundant hand-rolled implementation
    - Bombshell is the single mechanism for every CLI concern it can serve: argument parsing
      (`@bomb.sh/args`), interactive prompts, confirmations, and masked secret entry
      (`@clack/prompts`), any progress spinner shown (`@clack/prompts`), and shell completion
      (`@bomb.sh/tab`). Jolly carries no redundant hand-rolled implementation of a capability one
      of these Bombshell packages provides: there is exactly one implementation per concern, and
      it is the Bombshell one. This is a cross-cutting conformance invariant, in the family of
      feature 026's "no forbidden double".

  @logic @property
  Scenario: Every Bombshell-capable CLI concern is served by Bombshell, with no redundant implementation
    Given Jolly's production source for the published CLI
    Then argument parsing is served by `@bomb.sh/args` as the only argument parser
    And every interactive prompt, confirmation, and masked secret entry is served by `@clack/prompts` as the only terminal-prompt mechanism
    And shell completion is served by `@bomb.sh/tab` as the only completion-script generator

  Rule: Interactive start runs end-to-end in one session, gathering human input inline
    - On an interactive terminal, once the human proceeds, `jolly start` runs the whole setup
      pipeline in that one session. It never stops to hand the human an agent-style next command —
      for example "run jolly login" or "re-run jolly start" — to clear an input gate; each gate
      that needs a human is satisfied inline, and then the run continues. This is the human
      (interactive) path only; it does not change the agent path below.
    - When no Saleor Cloud token is configured, Jolly prompts the human to paste it inline, using
      the same Bombshell masked entry as `jolly login`, and continues with the pasted token —
      rather than reporting a blocked authentication stage and exiting.
    - When the deploy stage needs a Vercel session, Jolly runs `vercel login` inline in the same
      terminal so the human completes the sign-in there, then continues the deploy.
    - The run ends at the one step Jolly cannot perform for the human: pasting the Stripe keys and
      mapping the `us` channel in the Saleor Dashboard. By then the storefront is deployed and live,
      so the closing output names that Dashboard step as the remaining task, never a re-run of
      `jolly start`.
    - A genuine stage failure — not a human gate — still stops honestly and reports the error;
      Jolly never fabricates success to keep going. The agent path (`--json`, `--yes`/`-y`, or no
      interactive terminal) is unchanged: it completes each stage it can and reports the rest as
      honest checks and next steps for the agent to act on (feature 020).

  @logic
  Scenario: Interactive start prompts to paste a missing Cloud token, in the same session
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user works through the prompts with no Cloud token configured
    Then Jolly should present a masked Cloud-token entry prompt in the same session
    And after the token is entered the run should continue into the setup stages rather than ending at the authentication step
