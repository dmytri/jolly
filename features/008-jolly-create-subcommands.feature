Feature: Jolly create subcommands
  As a customer's AI agent
  I want `jolly create` to expose a few focused, plumbing-only resource subcommands
  So that I have focused plumbing commands for the resources Jolly owns, while `jolly start` orchestrates the official CLIs for everything else

  Background:
    Given Jolly is executable via `npx`
    And `jolly create` is a thin plumbing surface that never wraps the Vercel CLI or `@saleor/configurator`
    And `jolly start` orchestrates the official CLIs by spawning them under their own auth, guided by the Jolly skill

  @logic
  Scenario: Agent discovers create subcommands
    Given the agent needs to create a specific resource
    When it inspects `jolly create --help`
    Then it should see only the plumbing subcommand `store`
    And each subcommand should have a clear resource boundary
    And it should not list `deployment`, `deploy`, `recipe`, or `storefront` — that orchestration lives inside `jolly start`, which spawns the official CLIs

  @logic
  Scenario Outline: Jolly create subcommands never report a resource they did not produce
    Given `jolly create <subcommand>` is run with its preconditions unmet
    When the command runs with `--json`
    Then the envelope status should be "error" with a stable error code
    And the output must not report a created, configured, or stored resource it did not produce
    And no check should report "pass" for work that did not happen

    Examples:
      | subcommand |
      | store      |

  @logic
  Scenario Outline: An unverified value is reported as exactly "stored, not verified"
    Given `jolly create <subcommand>` stores a value it cannot verify in this run
    When it reports the result with `--json`
    Then the output should describe that value as exactly "stored, not verified"
    And it should not report the value as created, configured, or verified

    Examples:
      | subcommand |
      | store      |

  @logic
  Scenario Outline: create --dry-run shows the real request without performing it
    Given the agent runs `jolly create <subcommand> --dry-run`
    When the preview is produced
    Then it should name the real request it would send — host, path, and resolved identifiers
    And it should not claim the work was done
    And it should not create, configure, or store anything

    Examples:
      | subcommand |
      | store      |

  Rule: Credentials are read from .env, the way a real agent leaves them
    - `jolly login` and `jolly create store` write `JOLLY_*` credentials to the project `.env`; the agent does not export them into its shell. So every command reads its credentials from the `.env` FILE (the project config), never depending on a value being present in the process environment.

  @logic
  Scenario: jolly create store reads the Saleor Cloud token from .env, not the exported environment
    Given the real `JOLLY_SALEOR_CLOUD_TOKEN` is written to the project `.env` but is absent from the spawned process environment
    When the agent runs `jolly create store --create-environment --dry-run --json`
    Then the envelope status should be "success"
    And the preview should name the real Cloud API `organizations/{organization}/environments/` request it would send to provision the store
    And it should not create, configure, or store anything

  @logic @exceptional-double
  Scenario: jolly create store gives actionable recovery when the organization is at its environment limit
    # @exceptional-double: an organization already at its Saleor Cloud sandbox-environment
    # limit cannot be produced on demand against the real test org — the harness reclaims
    # capacity by deleting jolly-test environments — so this lone scenario points
    # create-store's Cloud API at an endpoint that returns the real
    # ENVIRONMENT_LIMIT_REACHED rejection. It never replaces the real create path; the
    # feature 004/012 @sandbox provisioning exercises a real `create store`.
    Given the Saleor Cloud environments endpoint returns ENVIRONMENT_LIMIT_REACHED
    When the agent runs `jolly create store --create-environment --json`
    Then the envelope status should be "error" with a stable error code
    And nextSteps should name freeing a sandbox environment and upgrading the plan as recovery options
    And it should not report a created or stored environment

  @logic
  Scenario: A completed create subcommand points back to jolly start to continue
    When the agent runs `jolly create store --url https://example.saleor.cloud --json`
    Then the envelope status should be "success"
    And nextSteps should include a step whose command is `jolly start`
    And that step should state that `jolly start` continues the end-to-end setup and recognizes the stored store rather than redoing it (feature 022)

  Rule: No fabricated create results
    - This Rule applies feature 020's "No fabricated success" contract to every `jolly create` subcommand.
    - A create subcommand reports success and `pass` checks only for resources it actually created, or work it actually performed and confirmed, during the run.
    - When the real operation is not yet implemented, or its preconditions are unmet, the subcommand errors honestly with a stable `errors[].code`; it must never report a created, configured, or stored resource it did not produce.
    - Storing without verifying is reported as exactly "stored, not verified" (per feature 020); it is never reported as created/configured.
    - `--dry-run` previews show the real intended request (host, path, resolved identifiers) and never claim the work was done.

  Rule: Surface — composable plumbing commands; `start` orchestrates the official CLIs
    - `jolly create` exposes only the deterministic-plumbing resources Jolly owns: `store` (Saleor Cloud store/project/environment via the Cloud API). There are no tool-wrapping subcommands for storefront creation, recipe apply, or deployment.
    - That orchestration lives inside `jolly start`, which SPAWNS the official CLIs itself — `git` clone of `saleor/storefront`, `pnpm install`, `@saleor/configurator diff`/`deploy`, and `npx vercel` deploy + env-var setup.
    - Jolly spawns official, current CLIs only — never reimplementing them against raw provider APIs. Each spawned CLI uses its own auth, so Jolly holds no Vercel token and makes no `api.vercel.com` request from its OWN code (the spawned Vercel CLI does; see feature 020's "First-party hosts only", which governs Jolly's own request code).
    - Interactive CLI steps run with stdio passed through (the user interacts with the CLI directly); `start` continues on the CLI's exit (0 → next; non-zero → stop honestly). Human-only gates (account creation, the Dashboard Stripe app, secret paste) are announced-and-waited-on.
    - The deprecated `saleor/cli` is never invoked.

  Rule: Create command boundaries
    - `jolly create` is a grouped command with the plumbing subcommand above.
    - Create subcommands are safe, explicit, and scriptable.
    - Remote resource creation approval is decided by the customer's agent based on risk, context, and customer/environment policies.
    - Each create subcommand exposes structured risk context per feature 021 so the agent can make that decision.
    - Create subcommands and `jolly start` are idempotent and resumable per feature 022.
