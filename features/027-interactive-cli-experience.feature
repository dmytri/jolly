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
      device-grant sign-in, the Vercel sign-in (`npx vercel@latest login`), the organization, environment,
      and directory choices, and the single proceed confirmation. Once the human proceeds, the
      mechanical chain runs UNATTENDED to the end, so the human need not watch the whole setup.
      The one irreducible step Jolly cannot perform — pasting the Stripe keys and mapping the `us`
      channel in the Saleor Dashboard — necessarily trails at the end, because the installed Stripe
      app it configures only exists after the store stages run (feature 005).
    - Because the interactive layer serves a human, it surfaces its resolved decisions in the
      terminal output, not in a machine envelope: it names the organization it will target, lists
      the side-effecting setup stages it will create, and on a decline reports that setup stopped
      with nothing created. The plan it lists for the human names only the stages that create
      something the human is approving — the store, storefront, recipe, deployment, and Stripe
      stages — not the internal bootstrap stages (`init`, `auth`) that are plumbing, not human
      decisions, and have already run by the time the human sees the plan. Once the human proceeds,
      Jolly does not re-print a separate static plan list; the live per-stage progress display
      carries the run. The machine-readable plan and resolved configuration remain available only
      on the `--json` path (feature 020).
    - Before the unattended stages run, a single proceed confirmation is shown — the human analogue
      of feature 021's per-stage riskContext approval. It names what it will create (the store,
      storefront, and deployment); the default is to proceed, so Enter advances; declining stops
      honestly and never fabricates later-stage success.
    - The interactive layer shows live, in-place progress for the unattended stages — a Bombshell
      (`@clack/prompts`) display on stderr that names each setup stage and advances it through its
      own status (running, then done, failed, or skipped) as the stage actually runs, redrawing the
      same region in place rather than appending one log line per tick (feature 020). It is not a
      single undifferentiated spinner that sits on one fixed label for the whole run and only
      reveals what happened at the end: each stage's status is visible as it resolves. The machine
      path (`--json`, or no terminal) shows no progress at all.
    - The interactive layer and its Bombshell dependencies are bundled into the published
      `dist/index.js`, so `npx @dk/jolly` runs self-contained (feature 006's published-launcher
      scenario guards this).

  @logic
  Scenario: Interactive start previews the plan, and Enter accepts every default
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal with no flag beyond `--dry-run`
    When the user presses Enter at every prompt
    Then Jolly should present interactive setup prompts
    And the interactive output should list the side-effecting setup stages it will create, including the store, storefront, and deployment stages
    And the interactive output should not list the internal bootstrap stages `init` or `auth`, which are not human decisions
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
  Scenario: Interactive start reuses an already-configured store without re-prompting for the environment name
    Given a fresh empty project directory
    And a Saleor store is already configured in the project
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should not prompt for an environment name
    And the interactive output should say it is reusing the already-configured store

  @logic
  Scenario: Interactive start offers to reuse an existing store or create a new one when the org has environments
    Given a fresh empty project directory
    And the org already has the environments "road-panther-store" and "jolly-cool-store"
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive output should offer to create a new store or reuse an existing one
    And the interactive output should name "road-panther-store" as a store the human can reuse

  @logic
  Scenario: Interactive start renders its up-front gate notes from the message catalog
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the up-front Vercel sign-in note should be the `start.vercelSignin` message from `assets/messages/cli.json`
    And the trailing Stripe-step note should be the `start.stripeFinal` message from `assets/messages/cli.json`

  @logic
  Scenario: Interactive start renders its intro banner from the message catalog
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the interactive intro on stderr should be the `start.intro` message from `assets/messages/cli.json`

  @logic
  Scenario: Interactive start closes with a concise human summary, not the machine check list
    Given a fresh empty project directory
    And `jolly start --dry-run` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the human result on stdout should state in prose that the plan was previewed and nothing was created
    And the human result on stdout should carry no per-check `[status] check-id` enumeration line
    And the human result on stdout should carry no `next:` command line

  @sandbox
  Scenario: A completed interactive start closes by naming the live store and the remaining human step
    Given a Saleor Cloud token is configured
    And a project whose store, storefront, and deployment stages are already satisfied
    When `jolly start` runs to completion in an interactive terminal
    Then the closing summary on stdout should name the store's Saleor Dashboard URL
    And the closing summary on stdout should name the deployed storefront URL
    And the closing summary on stdout should name the Stripe Dashboard key entry as the human's remaining step
    And the closing summary on stdout should not enumerate per-check results as `[status] check-id` lines
    And the closing summary on stdout should not present the Saleor endpoint or SALEOR_TOKEN readiness check, which the store stage resolved, as a failure of the completed run

  @logic
  Scenario: Interactive start renders the proceed confirmation and decline from the message catalog
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user declines the proceed confirmation
    Then the proceed confirmation should be the `start.proceed` message from `assets/messages/cli.json`
    And the decline message should be the `start.declined` message from `assets/messages/cli.json`

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
  Scenario: A failed setup stage closes honestly, naming the stage, with no keep-building orientation
    Given a Saleor store is already configured in the project
    And a prepared storefront directory whose `package.json` is malformed JSON
    And `jolly start` runs in an interactive terminal
    When the user presses Enter at every prompt
    Then the closing summary on stdout should name the storefront stage as failed
    And the closing summary should not claim the run completed or name a live storefront URL
    And the closing summary should not carry the keep-building orientation naming `storefront/` and `recipe.yml`

  @logic
  Scenario: Setup-stage progress shows each stage as its own live status, not one fixed spinner
    Given a fresh empty project directory
    When `jolly start` runs in an interactive terminal
    Then the setup-stage progress on stderr should list every setup stage by name, each carrying its own status
    And it should update a stage's status in place as the run reaches that stage, so each stage's progress is visible during the run rather than only after it ends
    And the running stage's row should describe in plain language what that stage is doing
    And the progress should redraw the same region in place rather than appending one line per update
    And stdout should carry no progress or spinner text

  @logic
  Scenario: Interrupting the unattended stages leaves the terminal usable
    Given a fresh empty project directory
    And `jolly start` runs in an interactive terminal
    When the user presses Ctrl-C while a setup stage is running
    Then the terminal cursor should be visible again after Jolly exits
    And the setup-stage progress rows should stay readable, with Jolly's closing line below them rather than drawn over them

  @logic
  Scenario: Interrupting the unattended stages reports the interrupted stage honestly
    Given a fresh empty project directory
    And `jolly start` runs in an interactive terminal
    When the user presses Ctrl-C while a setup stage is running
    Then the interactive output should name the setup stage that was interrupted
    And the interactive output should state that setup was interrupted and did not complete
    And Jolly must not print a fabricated store URL or verification result
    And the exit code should be non-zero

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

  @logic
  Scenario: Bare `jolly completion` prints usage naming the supported shells
    When the agent runs `jolly completion`
    Then stdout should contain a usage line naming the shells bash, zsh, fish, and powershell
    And the exit code should be 0

  @logic @exceptional-double
  Scenario: Interactive start signs the human in to Saleor inline when no auth is configured
    Given an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN and no JOLLY_SALEOR_ACCESS_TOKEN set
    And the Saleor auth host approves the device grant on the first poll
    When `jolly start` runs in an interactive terminal
    Then the interactive output should show the device user code and the verification URL before any setup stage runs
    And it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN
    And the run should continue past the auth stage in the same session

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
      (`@clack/prompts`), and shell completion (`@bomb.sh/tab`). Jolly carries no redundant
      hand-rolled implementation of a capability one of these Bombshell packages provides: there is
      exactly one implementation per concern, and it is the Bombshell one. This is a cross-cutting
      conformance invariant, in the family of feature 026's "no forbidden double".
    - Bombshell provides no live multi-stage progress primitive: its `@clack/prompts` spinner is a
      single indeterminate line, not a pinned list of named stages updated in place. So — exactly as
      with the OSC 8 hyperlink, which Bombshell also has no primitive for — Jolly renders the
      multi-stage progress display itself on stderr rather than take a redundant dependency. This is
      a sanctioned carve-out, not a forbidden hand-rolled duplicate of a capability Bombshell
      provides.

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
    - Before the unattended stages, when there is no Vercel session, Jolly runs the Vercel CLI's own
      device login and WAITS for it, so the Vercel session exists for the unattended deploy stage.
      Jolly never hands the terminal to that CLI: the spawned login's output goes to a file, and the
      human is shown the device-authorization URL and a waiting indicator in Jolly's own TUI. Jolly
      then polls the login to completion — the human approves in their browser and the run carries on
      in the same session. This is the ONLY difference from the agent path, which captures the same
      URL but hands it back as a next step and resumes on a re-run instead of waiting.
    - A sign-in that does not complete is reported with the REASON it did not — the Vercel CLI could
      not be launched, it printed no device URL (its own error is surfaced from the captured output),
      the device code was declined or expired, or the human did not approve in time. A bare "sign-in
      didn't complete" that collapses those distinct failures into one message leaves the human with
      no way forward and is not honest reporting.
    - Jolly presents every sign-in by its URL, not by taking over the screen: the device-
      authorization URLs it surfaces — the Saleor `auth.saleor.io` verification URL and the Vercel
      sign-in URL — are rendered as clickable terminal hyperlinks (an OSC 8 escape wrapping the URL)
      when the terminal supports it, and as the plain URL otherwise. Bombshell has no clickable-URL
      primitive, so Jolly emits the OSC 8 sequence itself rather than taking a dependency. Jolly's
      own code never auto-opens a web browser for a sign-in; it shows the clickable URL and lets the
      human open it. The delegated Vercel CLI may still open a browser of its own (Jolly does not
      reimplement that CLI, feature 002); where the CLI offers a mode that surfaces the URL without
      opening a browser, Jolly prefers it.
    - The run ends at the one step Jolly cannot perform for the human: pasting the Stripe keys and
      mapping the `us` channel in the Saleor Dashboard. By then the storefront is deployed and live,
      so the closing output names that Dashboard step as the remaining task, never a re-run of
      `jolly start`.
    - The closing output on the human path is a concise prose summary, not the machine envelope: it
      presents the run's outcome and the remaining Stripe Dashboard step as readable sentences,
      surfacing the live store URLs (the Saleor Dashboard and deployed storefront URLs feature 002
      already carries in the envelope `data`) and any genuine outstanding gate or failure. It does
      NOT render the envelope's per-check `checks[]` results as a `[status] check-id` enumeration,
      nor the `nextSteps[]` as `next:` command lines, on the human result stream — those stay on the
      `--json` path (feature 020). A pre-flight bootstrap readiness check the run itself then
      resolves — no Saleor endpoint, SALEOR_TOKEN, or local storefront before the stages create them —
      is never presented as a failure of the completed run.
    - Every human-facing string the interactive layer renders — the intro banner, the per-stage
      progress descriptions, the prompt messages and select option labels, the note titles and note
      body sentences, the outro, and the close summary sentences and labels — is drawn from the
      `assets/messages/cli.json` catalog by key, never an inline string literal. The catalog values
      may carry `{name}` placeholders that the renderer fills with run values such as the
      organization, the store URL, the device sign-in link and code, and the live URLs. The
      human-readable words are catalog copy; values composed purely from run data — URLs, device
      codes, organization, store, and environment slugs, stage names, and per-stage risk-context
      action text — and the structural glue that joins them (separators, newlines, OSC 8 link
      wrapping) are not catalog copy and stay in code. Feature 006 guards that no interactive copy
      bypasses the catalog.
    - On a completed run, after the live URLs and the Stripe step — separated by a blank line — the
      close adds a minimal "keep building" orientation: the two artifacts setup leaves on disk
      (`storefront/` and `recipe.yml`), the CLI that drives each (`npx vercel`,
      `npx @saleor/configurator`), and reference links (the Paper and configurator repos and the
      Saleor docs). It is success-only and stays concise — never a wall of text — and is absent from
      an unfinished/failed close. The installed `jolly` skill carries the depth.
    - A genuine stage failure — not a human gate — still stops honestly and reports the error;
      Jolly never fabricates success to keep going. The agent path (`--json`, `--yes`/`-y`, or no
      interactive terminal) shows no interactive prompts and never blocks on `@clack/prompts`
      discovery; Jolly still owns the Vercel sign-in there rather than handing the agent a
      `vercel login` next step (feature 002), and reports every other stage it cannot complete as
      honest checks and next steps for the agent to act on (feature 020).

  @sandbox
  Scenario: Interactive start shows the Vercel sign-in link and waits for the human to approve it
    Given an already-configured store and an interactive terminal with no Vercel CLI session
    When `jolly start` reaches the Vercel sign-in gate
    Then the interactive output should show a Vercel device-authorization URL
    And the run should still be waiting for that sign-in to be approved, not continuing signed-out
    And the Vercel CLI's own output should never surface on the terminal

  @sandbox
  Scenario: A Vercel sign-in that never produces a link reports why, not a bare failure
    Given an already-configured store and an interactive terminal where the Vercel CLI cannot sign in
    When `jolly start` reaches the Vercel sign-in gate
    Then the interactive output should name the reason the Vercel sign-in did not complete
    And the interactive output should surface the captured Vercel CLI output for the human to read

  @logic
  Scenario: Interactive start signs in with the device grant inline, never a pasted token
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user starts interactive setup with no Cloud token configured
    Then the interactive output should show the device user code and the auth.saleor.io verification URL with that code appended as its `user_code` query parameter
    And the interactive output should not prompt the user to paste a token

  @logic
  Scenario: The Saleor sign-in URL is shown as a clickable terminal hyperlink
    Given a fresh project directory with no real service credentials
    And `jolly start` runs in an interactive terminal
    When the user starts interactive setup with no Cloud token configured
    Then the auth.saleor.io verification URL should be wrapped in an OSC 8 terminal hyperlink escape pointing at that URL

  @logic
  Scenario: The jolly login sign-in URL is shown as a clickable terminal hyperlink
    Given an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN set
    And the Saleor auth host approves the device grant on the first poll
    When the user runs `jolly login`
    Then the auth.saleor.io verification URL should be wrapped in an OSC 8 terminal hyperlink escape pointing at that URL

  @logic
  Scenario: The running stage's plain-language description comes from the message catalog
    Given a fresh empty project directory
    When `jolly start` runs in an interactive terminal
    Then the init stage's running description on stderr should be the `start.stage.init` message from `assets/messages/cli.json`
    And the auth stage's running description on stderr should be the `start.stage.auth` message from `assets/messages/cli.json`

  Rule: The setup-stage progress survives a terminal narrower than its widest row

    - The in-place redraw moves the cursor up one line per stage and erases one
      line per stage. A row wider than the terminal soft-wraps onto a second
      physical line, so the cursor-up count runs short and the erase leaves the
      wrap remnant on screen: the display duplicates and garbles rather than
      updating in place.
    - The stage descriptions live in "assets/messages/cli.json", so
      lengthening one there is enough to exceed a terminal's width with no code
      change. The width the display must survive is the terminal's, never a
      value assumed from the descriptions that happen to be shipped.

  @logic
  Scenario: The setup-stage progress redraws in place on a narrow terminal
    Given a fresh empty project directory
    And an interactive terminal 40 columns wide
    When `jolly start` runs in an interactive terminal
    And the run reaches the storefront stage
    Then each setup stage should appear exactly once in the progress region
    And no stage row should appear twice on screen
    And the progress should redraw the same region in place rather than appending one line per update

  @logic
  Scenario: A stage description too wide for the terminal is shortened rather than wrapped
    Given a fresh empty project directory
    And an interactive terminal 40 columns wide
    When `jolly start` runs in an interactive terminal
    And the run reaches the storefront stage
    Then the storefront stage's row should occupy exactly one terminal line
    And the row should still name the storefront stage

  Rule: The unattended stages run with the terminal in cooked mode

    - The prompts put the terminal in raw mode, which disables the driver's
      signal characters, so a Ctrl-C arriving after the last prompt would reach
      the process as a stray byte rather than as SIGINT. The stages that follow
      the prompts are unattended, and Ctrl-C is the only control the human has
      left over them.
    - This scenario pins the state the stages require, not the call that
      establishes it. Whether the prompt library restores cooked mode itself or
      the CLI restores it explicitly is an implementation choice; either
      satisfies this contract, and a rebuild is free to change it.

  @logic
  Scenario: Ctrl-C reaches the unattended stages as a signal rather than as input
    Given a fresh empty project directory
    And `jolly start` runs in an interactive terminal
    When the run reaches the first unattended setup stage
    Then the terminal should be in cooked mode, so the driver turns Ctrl-C into a signal
    And the run should carry no raw-mode terminal state left over from the prompts

  Rule: The interrupted close names the same stages the normal close names

    - Both closes answer one question, which setup stages did not finish, and
      both render the same catalog sentence. The normal close counts only
      side-effecting stages, deliberately, so a preflight stage that never ran
      is not reported as unfinished setup. The interrupt handler applies no
      such filter and counts every planned stage.
    - One question answered in one place. Where the side-effecting stage set
      is written more than once, the closes drift apart, and the interrupted
      close names preflight stages the normal close excludes.

  @logic
  Scenario: Interrupting the run names only the side-effecting stages that did not finish
    Given a fresh empty project directory
    And `jolly start` runs in an interactive terminal
    When the user presses Ctrl-C while a setup stage is running
    Then the interactive output should name the side-effecting stages that did not finish
    And it should not name a preflight stage among the unfinished stages
    And the stages it names should be the same set the normal close would name for that run
