Feature: Stripe checkout setup for the Jolly starter storefront
  As a customer setting up a Saleor storefront through Jolly
  I want Stripe test mode configured with minimal manual steps
  So that the deployed storefront has a working checkout path immediately

  Background:
    Given Jolly uses Saleor Cloud as the commerce backend
    And Jolly uses Saleor Paper as the storefront baseline
    And Stripe is the v1 payment provider target
    And v1 uses Stripe test mode only

  @logic
  Scenario: Agent collects Stripe test mode credentials
    Given the setup flow reaches payment configuration
    When the agent handles Stripe setup
    Then the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode
    And the agent should ask the customer to paste the publishable key and secret key
    And no other Stripe configuration should be required from the customer at this point

  @logic
  Scenario: Jolly create stripe writes keys to .env
    Given the agent has collected the publishable key "pk_test_jolly_demo" and secret key "sk_test_jolly_demo"
    When the agent runs `jolly create stripe --publishable-key pk_test_jolly_demo --secret-key sk_test_jolly_demo`
    Then Jolly should write both keys to .env
    And .env should contain JOLLY_STRIPE_PUBLISHABLE_KEY=pk_test_jolly_demo
    And .env should contain JOLLY_STRIPE_SECRET_KEY=sk_test_jolly_demo
    And .gitignore should contain .env
    And Jolly should load the updated .env values for the current command flow where possible
    And Jolly should not print the secret key value
    And Jolly should not print the publishable key value

  @logic
  Scenario: Jolly create stripe --dry-run does not write to .env
    Given Jolly does not have Stripe credentials in .env
    When the agent runs `jolly create stripe --publishable-key pk_test_jolly --secret-key sk_test_jolly --dry-run --json`
    Then the output should include a risk context with riskLevel "medium" and categories including "payment setup" and "credential handling"
    And .env should not contain any Stripe key values
    And the output should not be written to .env

  @logic
  Scenario: Jolly create stripe imports keys from the Stripe CLI session when none are passed
    Given the Stripe CLI is logged in with test-mode keys
    And Jolly does not have Stripe credentials in .env
    When the agent runs `jolly create stripe --json`
    Then Jolly should import the test-mode keys by invoking the Stripe CLI read-only (`stripe config --list`)
    And .env should contain JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY matching the Stripe CLI session
    And Jolly should not print either key value
    And the output should report that the keys were imported from the Stripe CLI session

  @logic
  Scenario: Jolly doctor recognizes Stripe keys available from the Stripe CLI session
    Given the Stripe CLI is logged in with test-mode keys in its config
    And Jolly does not have Stripe credentials in .env
    When the agent runs `jolly doctor stripe --json`
    Then the stripe-keys check should be "warning", not "fail"
    And its next step should be to run `jolly create stripe` to import the keys

  @sandbox
  Scenario: Agent configures Saleor for Stripe
    Given Stripe credentials are available in .env
    When the agent configures Saleor's Stripe app, guided by the Jolly skill
    Then it should use the Saleor-supported Stripe app (Dashboard Extensions) mapped to the storefront channel
    And Jolly should not implement a custom payment backend
    And Jolly's only Stripe role is writing the test keys to `.env` (`jolly create stripe`); the Saleor-side Stripe app configuration is the agent's
    And the customer's agent should decide whether approval is needed before modifying remote payment configuration

  @sandbox
  Scenario: Agent verifies checkout readiness
    Given Stripe setup has been completed
    When the storefront is deployed
    Then jolly doctor should verify that checkout can progress to the Stripe test payment step
    And it should confirm Stripe is in test mode
    And it should identify any remaining manual Stripe, Saleor Dashboard, or webhook steps

  Rule: Stripe setup principles
    - v1 uses Stripe test mode only; live mode requires an explicit customer choice and is out of v1 scope.
    - The customer provides exactly 2 values: Stripe publishable key and secret key from the Stripe Dashboard.
    - Jolly writes both to .env and ensures .env is ignored by Git.
    - Jolly does not build payment processing; the agent configures Saleor's Stripe app, and
      Jolly only writes the two test keys to `.env`.
    - Stripe live mode is explicitly out of v1 scope.
    - Payment credentials are secrets and must not be printed.

  Rule: Stripe app path (resolved 2026-06-13)
    - The Saleor-supported path is the Stripe app, configured in the Saleor Dashboard →
      Extensions with the publishable key and a Stripe secret/restricted key, and mapped to the
      storefront's channel (the starter recipe's `us` channel). `@saleor/configurator` manages
      catalog and channels only; it does not configure payments.
    - The Stripe app registers and removes its own Stripe webhooks when a configuration is
      created or deleted — Jolly does not automate Stripe webhook endpoint registration.
    - Jolly's only Stripe role is writing the two test keys to `.env`; installing and configuring
      the Stripe app is the agent's step, guided by the Jolly skill. `jolly doctor` verifies that
      checkout can progress to the Stripe test payment step.

  Rule: Stripe keys via the official CLI OAuth, imported by Jolly (decision 2026-06-13; amended 2026-06-13)
    - The primary way the agent gets the two test keys is the official Stripe CLI's browser OAuth
      login (`npx @stripe/cli login`) — a one-time human consent. The Stripe CLI cannot create a
      Stripe account, so signup stays a human step; live mode (Dashboard keys) is out of v1 scope.
    - Jolly recognizes that login and imports the keys itself, so a completed `stripe login` is
      never mistaken for "no Stripe keys". Run with no `--publishable-key`/`--secret-key`,
      `jolly create stripe` invokes the Stripe CLI **read-only** (`stripe config --list`), reads
      the default profile's `test_mode_pub_key`/`test_mode_api_key`, and writes them to `.env`.
      The agent never reads or handles the secret value — it goes Stripe CLI → `.env`, never through
      the agent or a process argument. Jolly uses the Stripe CLI's own interface; it does not parse
      the Stripe CLI's config file directly. (The exact command/output format is re-checked against
      the current Stripe CLI at implementation time.)
    - This is a narrow, read-only exception to "the agent runs the tools, not Jolly": Jolly never
      runs the Stripe CLI's `login`/OAuth (the human/agent does), issues no mutating Stripe CLI
      command, makes no network call by importing (`config --list` is local), and owns no Stripe
      token beyond the user's own keys it places in `.env`. The Vercel CLI and `@saleor/configurator`
      get no such exception — they stay agent-run.
    - Explicit `--publishable-key`/`--secret-key` flags always override the import (durable Dashboard
      keys). With neither flags nor a logged-in Stripe CLI holding test-mode keys (CLI missing, not
      logged in, or keys expired), `jolly create stripe` errors honestly (`MISSING_STRIPE_KEYS`) with
      remediation naming both paths: run `npx @stripe/cli login`, or paste Dashboard keys.
    - `jolly doctor stripe`: when `.env` has no `JOLLY_STRIPE_*` but the Stripe CLI is logged in with
      test-mode keys, the `stripe-keys` check is a `warning` (not `fail`) whose next step is
      `jolly create stripe` to import them. Jolly must not report Stripe as simply missing when the
      OAuth was already done.
    - CLI-issued keys are test-mode and expire (~90 days; `test_mode_key_expires_at`). Jolly surfaces
      that expiry from the Stripe CLI output; the skill warns the agent and trusts it to replace them
      with durable Dashboard keys (re-run `jolly create stripe`, update the Saleor Stripe app) before
      expiry. v1 accepts this "fast to start, agent owns the 90-day follow-up" tradeoff.
    - Open validation (acceptance run): confirm Saleor's Stripe app accepts the CLI-issued
      `sk_test_` key and that its permissions suffice for checkout. Adopt-on-green.
