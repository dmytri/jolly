Feature: Stripe checkout setup for the Jolly starter storefront
  As a customer setting up a Saleor storefront through Jolly
  I want Stripe configured as the first payment provider
  So that the deployed storefront can support an operational checkout path

  Background:
    Given Jolly uses Saleor Cloud as the commerce backend
    And Jolly uses Saleor's published Dashboard and public APIs rather than replacing payment configuration UI
    And Jolly uses Saleor Paper as the storefront baseline
    And Stripe is the v1 payment provider target

  Scenario: Agent explains Stripe requirements
    Given the customer reaches payment setup
    When the agent introduces the Stripe step
    Then it should explain that Stripe is required for the v1 operational checkout path
    And it should ask whether the customer already has a Stripe account
    And it should branch between existing Stripe account setup and new Stripe account registration guidance
    And it should distinguish between Stripe test mode and live mode
    And it should identify which steps require human action in Stripe or Saleor Dashboard

  Scenario: Agent configures Saleor for Stripe where possible
    Given the customer has Saleor Cloud access
    And the customer has or can create Stripe credentials
    When Jolly proceeds with payment setup
    Then it should use Saleor-supported Stripe payment setup paths where available
    And it should not implement a custom payment backend inside Jolly
    And it should write Stripe secrets to `.env` as environment variables when local storage is needed
    And it should ensure `.env` is ignored by Git before writing secrets
    And it should load updated `.env` values for the current command flow where possible
    And it should not create a Jolly-managed secret store
    And the customer's agent should decide whether customer approval is needed before creating or modifying payment-related remote configuration

  Scenario: Agent verifies checkout readiness
    Given Stripe setup has been completed or guided
    When the storefront is deployed
    Then the agent should verify that checkout can progress to the payment step
    And it should report whether Stripe is in test mode or live mode
    And it should identify any remaining manual Stripe, Saleor Dashboard, webhook, or Vercel environment-variable steps

  Rule: Payment boundaries
    - Stripe is the first payment provider target.
    - Jolly should orchestrate Saleor-supported Stripe setup rather than building payment processing itself.
    - Jolly should treat payment credentials as secrets.
    - Jolly v1 should use environment variables only for secrets.
    - Local secret values should be written to `.env`, with `.env` ignored by Git.
    - Jolly should default to Stripe test mode for first-run validation.
    - Stripe live mode should require an explicit customer choice and additional readiness checks.
    - Payment setup likely requires human approval and may require browser-based Stripe or Saleor Dashboard steps.

  Rule: Open questions
    - What should the exact existing-Stripe and new-Stripe branch steps be?
    - Should Jolly automate Stripe account connection if possible or guide the human through Dashboard setup?
    - What exact Saleor Cloud Stripe app/plugin path should be used at implementation time?
    - What webhook configuration is required for a deployed Paper storefront on Vercel?
