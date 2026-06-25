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
    - Discovery prompts the human only for what is genuinely a human decision: the Saleor
      sign-in through the device authorization grant when no token is configured (feature 018,
      never a pasted secret), the Saleor organization to use when the grant resolves more than
      one (with exactly one, Jolly uses it without asking, per feature 012), the environment name
      when none is configured, and the storefront project directory — each decision pre-filled
      with a sane default.
    - Every human gate is gathered UP FRONT, before any mechanical stage runs: the Saleor
      device-grant sign-in, the Vercel sign-in (`npx vercel login`), the organization, environment,
      and directory choices, and the single proceed confirmation. Once the human proceeds, the
      mechanical chain runs UNATTENDED to the end, so the human need not watch the whole setup.
      The one irreducible step Jolly cannot perform — pasting the Stripe keys and mapping the `us`
      channel in the Saleor Dashboard — necessarily trails at the end, because the installed Stripe
      app it configures only exists after the store stages run (feature 005).
    - Because the interactive layer serves a human, it surfaces its resolved decisions in the
      terminal output, not in a machine envelope: it names the organization it will target, lists
      the mechanical setup stages it will run, and on a decline reports that setup stopped with
      nothing created. The machine-readable plan and resolved configuration remain available only
      on the `--json` path (feature 020).
    - Before the unattended stages run, a single proceed confirmation is shown — the human analogue
      of feature 021's per-stage riskContext approval. It names what it will create (the store,
      storefront, and deployment); the default is to proceed, so Enter advances; declining stops
      honestly and never fabricates later-stage success.
    - The interactive layer shows live, in-place progress for the unattended stages — a Bombshell
      (`@clack/prompts`) display on stderr that shows each setup stage's status and updates in place
      rather than appending one log line per tick (feature 020). The machine path (`--json`, or no
      terminal) shows no progress at all.
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
  Scenario: Interactive start tells the human which steps are theirs
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should say Jolly will run the Vercel sign-in with the human up front, before the unattended stages
    And the interactive output should name the Saleor Dashboard Stripe key entry as the final human step

  @logic
  Scenario: --yes runs jolly start with no prompt even on an interactive terminal
    Given a fresh empty project directory
    When `jolly start --dry-run --yes` runs in an interactive terminal and receives no input
    Then Jolly should complete without blocking for any prompt
    And no interactive prompt should be shown

  @logic
  Scenario: Declining the proceed confirmation stops honestly
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user declines the proceed confirmation
    Then the proceed confirmation should name the store, storefront, and deployment it would create
    And the interactive output should state that setup stopped and nothing was created
    And the interactive output should not report the store, storefront, recipe, or deployment stages as completed
    And Jolly must not print a fabricated store URL or verification result

  @logic
  Scenario: Setup-stage progress updates in place, showing each stage's status
    Given a fresh empty project directory
    When `jolly start` runs in an interactive terminal
    Then the setup-stage progress on stderr should show each setup stage with its own status
    And the progress should update in place rather than appending one line per update
    And stdout should carry no progress or spinner text

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

  Rule: Interactive human-facing copy is rendered from the message catalog asset
    - The human-facing strings interactive `jolly start` prints — the up-front Vercel sign-in
      note, the trailing Stripe-step note, the proceed confirmation, and the decline message —
      are rendered from the bundled message catalog `assets/messages/cli.json` by message key,
      not hard-coded in `src/`. The wording is product content owned in the asset, so rewording
      is an asset edit rather than a code change. The catalog ships inside the published
      `@dk/jolly` package alongside `assets/skills/`, so `npx @dk/jolly` renders it self-contained.

  @logic
  Scenario: Interactive start renders its up-front gate notes from the message catalog
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the up-front Vercel sign-in note should be the catalog's "start.vercelSignin" message
    And the trailing Stripe-step note should be the catalog's "start.stripeFinal" message

  @logic
  Scenario: Interactive start renders the proceed confirmation and decline from the message catalog
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user declines the proceed confirmation
    Then the proceed confirmation should be the catalog's "start.proceed" message
    And the decline message should be the catalog's "start.declined" message

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

  Rule: Interactive start runs end-to-end in one session, gathering human input up front
    - On an interactive terminal, `jolly start` gathers every human gate up front and then runs
      the whole setup pipeline unattended in that one session. It never stops to hand the human an
      agent-style next command — for example "run jolly login" or "re-run jolly start" — to clear
      an input gate; each gate that needs a human is satisfied up front, and then the run
      continues. This is the human (interactive) path only; it does not change the agent path below.
    - When no Saleor Cloud token is configured, Jolly runs the Saleor device authorization grant
      inline (the same grant as `jolly login`, feature 018): it shows the user code and the
      `auth.saleor.io` verification URL carrying that code as its `user_code` query parameter (so
      opening the link pre-fills the code), waits for the human to authorize, and continues with the
      acquired credentials — rather than reporting a blocked authentication stage and exiting.
    - Before the unattended stages, when there is no Vercel session, Jolly runs `npx vercel login`
      inline in the same terminal so the human completes the sign-in there and lets the CLI's
      device grant complete; the Vercel session then exists for the unattended deploy stage.
    - The run ends at the one step Jolly cannot perform for the human: pasting the Stripe keys and
      mapping the `us` channel in the Saleor Dashboard. By then the storefront is deployed and live,
      so the closing output names that Dashboard step as the remaining task, never a re-run of
      `jolly start`.
    - A genuine stage failure — not a human gate — still stops honestly and reports the error;
      Jolly never fabricates success to keep going. The agent path (`--json`, `--yes`/`-y`, or no
      interactive terminal) shows no interactive prompts and never blocks on `@clack/prompts`
      discovery; Jolly still owns the Vercel sign-in there rather than handing the agent a
      `vercel login` next step (feature 002), and reports every other stage it cannot complete as
      honest checks and next steps for the agent to act on (feature 020).

  @logic
  Scenario: Interactive start signs in with the device grant inline, never a pasted token
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user starts interactive setup with no Cloud token configured
    Then the interactive output should show the device user code and the auth.saleor.io verification URL with that code appended as its `user_code` query parameter
    And the interactive output should not prompt the user to paste a token
