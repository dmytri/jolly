Feature: Npx-first Jolly CLI command surface
  As a customer's AI agent
  I want Jolly to be executable through `npx` with clear subcommands
  So that I can run setup workflows without requiring a prior global install

  @logic
  Scenario: Npx execution does not require Bun
    Given a machine with Node.js available but no Bun on the PATH
    When the agent runs `jolly start --dry-run --json` through the published launcher
    Then the command should succeed using Node alone
    And stdout should carry the standard output envelope

  @logic
  Scenario: Agent starts the guided setup flow
    Given the customer wants the end-to-end guided Saleor storefront setup
    When the agent invokes the primary guided command
    Then `jolly start` should bootstrap setup (install the Jolly skill and Saleor skills, scaffold, run doctor) and emit the ordered playbook for the agent to execute
    And the agent then drives the official CLIs (Vercel CLI, `@saleor/configurator`, `git`, `pnpm`) per the Jolly skill, calling Jolly's thin helpers for plumbing
    And the output should follow Jolly's hybrid human-readable plus machine-readable format

  Rule: Thin command surface (decision 2026-06-13)
    - Jolly is a thin CLI: it provides deterministic plumbing and installs the Jolly skill; it never shells out to the Vercel CLI or `@saleor/configurator`, and never wraps a CLI the agent should run.
    - The full command surface is `login`, `logout`, `auth status`, `init`, `start`, `doctor`, `upgrade`, `skills`, and `create` with subcommands `store`, `app-token`, and `stripe` only.
    - The tool-wrapping subcommands `create deployment`, `deploy`, `create recipe`, and `create storefront` are retired (decision 2026-06-13): the customer's agent runs the Vercel CLI, `@saleor/configurator`, and `git` itself, guided by the Jolly skill (see feature 008).
    - All skills (the Jolly skill and the Saleor agent-skills) are installed via `npx skills add <ref>`, falling back to a Git-based install only for a skill not available that way.
    - All CLI commands should support `--json`.
    - All CLI commands should support `--quiet`.
    - All CLI commands should support `--yes` / `-y` to skip Jolly prompts where the agent environment allows.
    - Side-effecting remote/action commands should support `--dry-run` for preview/no-side-effects mode.
    - The package name is `@dk/jolly`, everywhere (decision 2026-06-12). Jolly is a
      tool by Dmytri Kleiner that helps agents set up a store quickly using Saleor,
      Vercel and Stripe; it is not an official product of any of those. No other
      package name (including any `@saleor/...` scope) may be mentioned in code,
      output, or docs — not as runnable, not as "future/official"; docs describe
      only what exists and can be run.
    - The published Jolly CLI is a Node.js program (decision 2026-06-12): the
      launcher (`bin/jolly`) runs under Node.js >= 23 and never invokes or
      requires Bun. Bun is the project's development/test environment only, never
      a customer-facing requirement.
    - The published package ships **pre-built JavaScript** compiled from `src/`,
      and the launcher loads that build — not raw TypeScript (correction
      2026-06-13). Node's native type stripping is disabled for files under
      `node_modules`, so an npm-installed `npx @dk/jolly` cannot strip types and
      must run plain JavaScript. A build step produces the bundle before publish;
      the package's `files` ship the build output (not raw `.ts`).
    - The "Npx execution does not require Bun" scenario must exercise the package
      **as actually installed** — `npm pack` the tarball, install it into a
      temporary `node_modules`, and run the installed `jolly` bin — because
      running the launcher from the source tree (where `src/` is not under
      `node_modules`) gives a false pass and hid exactly this failure
      (lesson 2026-06-13: `0.1.11`/`0.2.0` published broken for `npx`).
    - The published package's `engines` field must declare the Node.js requirement
      and must not require Bun.
    - On a Node.js older than the minimum, the launcher should fail with a clear
      message naming the minimum Node version, not a raw syntax or module error.
