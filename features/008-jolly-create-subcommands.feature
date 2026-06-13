Feature: Jolly create subcommands
  As a customer's AI agent
  I want `jolly create` to expose a few focused, plumbing-only resource subcommands
  So that I can create the Saleor and secret resources Jolly owns, while I run the official CLIs myself for everything else

  Background:
    Given Jolly is executable via `npx`
    And Jolly is a thin CLI that does not wrap or shell out to the Vercel CLI or `@saleor/configurator`
    And the customer's own agent runs the official CLIs, guided by the Jolly skill

  @logic
  Scenario: Agent discovers create subcommands
    Given the agent needs to create a specific resource
    When it inspects `jolly create --help`
    Then it should see only the plumbing subcommands `store`, `app-token`, and `stripe`
    And each subcommand should have a clear resource boundary
    And the help output should be understandable to both agents and humans
    And it should not list `deployment`, `deploy`, `recipe`, or `storefront` — those are run by the agent via the official CLIs per the Jolly skill

  @logic
  Scenario: Jolly create subcommands never report a resource they did not produce
    Given the agent runs a `jolly create` subcommand whose preconditions are unmet or whose work cannot be performed
    When the command runs with `--json`
    Then the envelope status should be "error" with a stable error code
    And the output must not report a created, configured, or stored resource it did not produce
    And no check should report "pass" for work that did not happen

  Rule: No fabricated create results
    - This Rule applies feature 020's "No fabricated success" contract to every `jolly create` subcommand.
    - A create subcommand reports success and `pass` checks only for resources it actually created, or work it actually performed and confirmed, during the run.
    - When the real operation is not yet implemented, or its preconditions are unmet, the subcommand errors honestly with a stable `errors[].code`; it must never report a created, configured, or stored resource it did not produce.
    - Storing without verifying is reported as exactly "stored, not verified" (per feature 020); it is never reported as created/configured.
    - `--dry-run` previews show the real intended request (host, path, resolved identifiers) and never claim the work was done.

  Rule: Thin surface — the agent runs the official CLIs, Jolly does not (decision 2026-06-13)
    - `jolly create` exposes only the deterministic-plumbing resources Jolly owns: `store` (Saleor Cloud store/project/environment via the Cloud API), `app-token` (Saleor app token via GraphQL), and `stripe` (writes Stripe test keys to `.env`).
    - The former tool-wrapping subcommands are retired: storefront creation (`git` clone of `saleor/storefront`), recipe apply (`@saleor/configurator`), and Vercel deployment (`npx vercel`) are run by the customer's agent itself, guided by the Jolly skill.
    - Jolly never shells out to the Vercel CLI or `@saleor/configurator`, never reimplements them against raw provider APIs, holds no Vercel token, and makes no `api.vercel.com` request from its own code (see feature 020's amended "First-party hosts only").
    - The deprecated `saleor/cli` is never invoked.

  Rule: Create command boundaries
    - `jolly create` is a grouped command with the three plumbing subcommands above.
    - Create subcommands are safe, explicit, and scriptable.
    - Remote resource creation approval is decided by the customer's agent based on risk, context, and customer/environment policies.
    - Each create subcommand exposes structured risk context per feature 021 so the agent can make that decision.
    - Create subcommands and `jolly start` are idempotent and resumable per feature 022.

  Rule: Open questions
    - Whether `jolly create app-token` should request all available permissions or allow the agent to specify a subset is deferred.
