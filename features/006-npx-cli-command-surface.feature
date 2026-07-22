Feature: Npx-first Jolly CLI command surface
  As a customer's AI agent
  I want Jolly to be executable through `npx` with clear subcommands
  So that I can run setup workflows without requiring a prior global install

  @logic
  Scenario: Npx execution runs on plain Node
    Given a machine with only Node.js available
    When the agent runs `jolly start --dry-run --json` through the published launcher
    Then the command should succeed using Node alone
    And stdout should carry the standard output envelope

  @logic
  Scenario: The CLI exposes exactly the supported command surface
    Given the published Jolly CLI
    When the agent inspects `jolly --help`
    Then it should list exactly the commands `help`, `login`, `logout`, `auth`, `init`, `start`, `create`, `storefront`, `recipe`, `stock`, `stripe`, `deploy`, `doctor`, `upgrade`, `skills`, and `completion`
    And `jolly create --help` should list only the subcommand `store`
    And `status` should appear as a subcommand of `auth`, never as a top-level command

  @logic
  Scenario: The launcher fails clearly on an unsupported Node version
    Given a Node.js runtime older than the minimum the launcher requires
    When the published `jolly` launcher runs
    Then it should exit with an error naming the minimum Node version
    And it should not surface a raw syntax or module-resolution error

  @logic @property
  Scenario Outline: Command output names only the @dk/jolly package
    Given the published Jolly CLI
    When the agent runs `<command>`
    Then the output should name the Jolly package as `@dk/jolly`
    And the only package it presents as the Jolly tool or an official product is `@dk/jolly`, with the official CLIs Jolly spawns (`@saleor/configurator`, `vercel`, `git`, `pnpm`) named only as the delegated tools the agent runs

    Examples:
      | command            |
      | jolly --help       |
      | jolly start --json |

  @logic
  Scenario Outline: Every subcommand prints usage on --help instead of aborting
    Given the published Jolly CLI
    When the agent runs `jolly <command> --help`
    Then the command should exit successfully
    And it should print a usage summary naming the command and its flags
    And it should not abort with "Command aborted"

    Examples:
      | command          |
      | login            |
      | logout           |
      | auth status      |
      | init             |
      | start            |
      | doctor           |
      | upgrade          |
      | create store     |

  @logic @property
  Scenario: Jolly's code spawns only the delegated official tools
    Given Jolly's own child-process-spawning code
    When the commands its spawn sites can launch are enumerated
    Then the binaries spawned should be exactly `git`, `pnpm`, and `npx`
    And the packages launched through `npx` should be exactly `@saleor/configurator`, `vercel`, `pnpm`, and `skills`
    And no spawn site should launch the deprecated `saleor` CLI or any `@saleor/*` package other than `@saleor/configurator`
    And a spawn site launching a binary or package outside this set should redden the check

  Rule: Thin command surface
    - Jolly is a thin CLI: it provides deterministic plumbing, installs the Jolly skill, and uses `jolly start` to orchestrate official CLIs without reimplementing them against raw provider APIs.
    - The full command surface is `help`, `login`, `logout`, `auth`, `init`, `start`, `create`, `storefront`, `recipe`, `stock`, `stripe`, `deploy`, `doctor`, `upgrade`, `skills`, and `completion`, with `create` subcommand `store` only and `status` a subcommand of `auth`.
    - `completion` is the human/shell-integration command (see feature 027): `jolly completion <shell>` prints a shell-completion script. It is the single command exempt from the feature 020 `--json` envelope, since its output is consumed by the shell via `source`; it still supports `--help`.
    - `storefront`, `recipe`, `stock`, `stripe`, and `deploy` are first-class top-level stage commands (see the stage commands): each runs one setup stage on its own, and `jolly start` orchestrates the same stages end to end. The official CLIs remain the delegated tools (see feature 008).
    - All skills (the Jolly skill and the Saleor agent-skills) are installed via `npx skills add <ref>`, falling back to a Git-based install only for a skill not available that way.
    - Every command and subcommand supports `--help`: it prints a usage summary naming the command and its flags and exits successfully, never aborting with "Command aborted". `--help` is how an agent learns a command's flags without guessing.
    - All CLI commands should support `--json`.
    - All CLI commands should support `--quiet`.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - Side-effecting remote/action commands should support `--dry-run` for preview/no-side-effects mode.
    - The package name is `@dk/jolly`, everywhere; it is the only name for the
      Jolly tool. Jolly is a tool by Dmytri Kleiner that helps agents set up a
      store quickly using Saleor, Vercel and Stripe; it is not an official product
      of any of those. Output and docs present only `@dk/jolly` as the Jolly tool
      or as an official product — no other package, including any `@saleor/...`
      scope, stands in for `@dk/jolly` or is named as runnable-as-Jolly or as
      "future/official". The official CLIs Jolly spawns — `npx @saleor/configurator`,
      `vercel`, `git`, `pnpm` — are named only as the delegated tools the agent
      runs, which is correct and expected, not a Jolly substitute. Docs describe
      only what exists and can be run.
    - The published Jolly CLI is a Node.js program: the launcher (`bin/jolly`) runs
      under Node.js >= 20.12.0 — the floor its dependencies require (`@clack/prompts`;
      the `@bomb.sh/*` packages declare none), no stricter. The published package runs
      compiled JavaScript (below), so it needs no newer runtime than its dependencies.
      The project's dev and CI runtime is separately Node.js >= 23 + npm, because dev
      runs `src/` as raw TypeScript via native type stripping.
    - The published package ships **pre-built JavaScript** compiled from `src/`,
      and the launcher loads that build — not raw TypeScript. Node's native type
      stripping is disabled for files under
      `node_modules`, so an npm-installed `npx @dk/jolly` cannot strip types and
      must run plain JavaScript. A build step produces the bundle before publish;
      the package's `files` ship the build output (not raw `.ts`).
    - The "Npx execution runs on plain Node" scenario must exercise the package
      **as actually installed** — `npm pack` the tarball, install it into a
      temporary `node_modules`, and run the installed `jolly` bin — because
      running the launcher from the source tree (where `src/` is not under
      `node_modules`) gives a false pass.
    - The published package ships the human-facing message catalog
      (`assets/messages/cli.json`) the interactive layer renders by key (feature
      027). The catalog is read at runtime, not bundled into `dist/index.js`, so
      the "as actually installed" guarantee covers it: the installed CLI resolves
      the catalog from its own package, not the source tree. The `--json` path
      never reads the catalog, so this guard exercises the installed CLI on its
      interactive path.
    - All human-facing copy the interactive layer renders is sourced from
      `assets/messages/cli.json` by key, never an inline string literal at the
      render site: the intro banner, the prompts and notes, the per-stage progress
      descriptions, and the close summary (feature 027). A catalog value may carry
      `{name}` placeholders the renderer fills with run values such as the
      organization, the store URL, and the live URLs. The "no interactive copy
      bypasses the catalog" property keeps the sweep complete: a new inline
      human-facing literal on the interactive path fails it.
    - The published package's `engines` field must declare the Node.js requirement.
    - On a Node.js older than the minimum, the launcher should fail with a clear
      message naming the minimum Node version, not a raw syntax or module error.
