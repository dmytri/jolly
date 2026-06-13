Feature: Jolly create subcommands
  As a customer's AI agent
  I want `jolly create` to expose focused resource-specific subcommands
  So that I can create Saleor, storefront, and deployment resources intentionally instead of overloading one command

  Background:
    Given Jolly is executable via `npx`
    And `jolly start` is available as optional convenience orchestration for the full end-to-end flow

  @logic
  Scenario: Agent discovers create subcommands
    Given the agent needs to create a specific resource
    When it inspects `jolly create --help`
    Then it should see focused subcommands
    And each subcommand should have a clear resource boundary
    And the help output should be understandable to both agents and humans

  @logic
  Scenario: Agent composes create subcommands or uses start as convenience
    Given the customer wants the full end-to-end setup
    When the agent decides how to proceed
    Then the agent may invoke `jolly start` as a convenience wrapper for the full flow
    And the agent may invoke individual `jolly create` subcommands at its own discretion
    And each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur

  @logic
  Scenario: Jolly create storefront never reports a clone it did not perform
    Given the agent runs Jolly in a fresh project directory with no storefront present
    When the agent runs `jolly create storefront --json`
    Then if the envelope reports the storefront was cloned or prepared, the target directory must exist on disk containing the Paper template
    And if Jolly cannot perform the clone, the envelope status should be "error" with a stable error code
    And no check should report "pass" for a clone that did not happen

  @logic
  Scenario: Jolly create deployment never reports a deployment it did not perform
    Given the agent runs `jolly create deployment --json` without a deployable storefront or Vercel credentials
    Then the envelope status should be "error"
    And it should carry a stable error code identifying the unmet precondition or unimplemented capability
    And the output must not state that a Vercel deployment was configured or created
    And no check should report "pass" for a deployment that did not occur
    And the `jolly deploy` alias must behave identically

  @logic
  Scenario: Jolly create recipe never reports a recipe it did not write
    Given the agent runs `jolly create recipe --json` with no cloned storefront repository present
    Then the envelope status should be "error"
    And it should carry a stable error code
    And the output must not report a prepared recipe at a path that does not exist
    And no check should report "pass" for recipe preparation that did not happen

  Rule: No fabricated create results
    - This Rule applies feature 020's "No fabricated success" contract to every `jolly create` subcommand.
    - A create subcommand reports success and `pass` checks only for resources it actually created, or work it actually performed and confirmed, during the run.
    - When the real operation is not yet implemented, or its preconditions are unmet, the subcommand errors honestly with a stable `errors[].code`; it must never report a created, cloned, configured, or deployed resource it did not produce.
    - Storing without verifying is reported as exactly "stored, not verified" (per feature 020); it is never reported as created/configured.
    - `--dry-run` previews show the real intended request (host, path, resolved identifiers) and never claim the work was done.

  Rule: Create command boundaries
    - `jolly create` should be a grouped command with subcommands.
    - `jolly start` is optional convenience orchestration for the full end-to-end path; agents may prefer composing individual subcommands.
    - Create subcommands should be safe, explicit, and scriptable.
    - Remote resource creation approval should be decided by the customer's agent based on risk, context, and customer/environment policies.
    - Each create subcommand should expose structured risk context per feature 021 so the agent can make that decision.
    - Create subcommands and `jolly start` should be idempotent and resumable per feature 022.

  Rule: V1 create subcommands
    - `jolly create store` for Saleor Cloud store/project/environment setup.
    - `jolly create storefront` for cloning/configuring Saleor Paper; it should propose `storefront` as the default target directory, handle name collisions safely, and allow confirmation or change before cloning.
    - `jolly create recipe` for preparing or applying the Jolly Configurator starter recipe.
    - `jolly create app-token` for acquiring a Saleor app token from a Saleor instance via GraphQL.
    - `jolly create deployment` for Vercel deployment setup.
    - `jolly deploy` as a friendly top-level alias for deployment setup.

  Rule: Open questions
    - Whether `jolly create app-token` should request all available permissions or allow the agent to specify a subset is deferred.
    - Exact behavior differences, if any, between `jolly create deployment` and `jolly deploy` remain open.
