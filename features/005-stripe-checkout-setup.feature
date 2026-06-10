Feature: Stripe checkout setup for the Jolly starter storefront
  As a customer setting up a Saleor storefront through Jolly
  I want Stripe test mode configured with minimal manual steps
  So that the deployed storefront has a working checkout path immediately

  Background:
    Given Jolly uses Saleor Cloud as the commerce backend
    And Jolly uses Saleor Paper as the storefront baseline
    And Stripe is the v1 payment provider target
    And v1 uses Stripe test mode only

  Scenario: Agent collects Stripe test mode credentials
    Given the setup flow reaches payment configuration
    When the agent handles Stripe setup
    Then the agent should tell the customer to open the Stripe Dashboard at stripe.com and go to test mode
    And the agent should ask the customer to paste the publishable key and secret key
    And no other Stripe configuration should be required from the customer at this point
    And Jolly should write the keys to .env after ensuring .env is ignored by Git
    And Jolly should load the updated .env values for the current command flow where possible
    And Jolly should not print the secret key value

  Scenario: Jolly configures Saleor for Stripe
    Given Stripe credentials are available in .env
    When Jolly proceeds with Stripe configuration
    Then it should use Saleor-supported Stripe payment setup paths where available
    And it should not implement a custom payment backend inside Jolly
    And the customer's agent should decide whether approval is needed before modifying remote payment configuration
    And Jolly remote/action commands involved in payment setup should support --dry-run

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
    - Jolly does not build payment processing; it configures Saleor's existing Stripe integration.
    - Stripe live mode is explicitly out of v1 scope.
    - Payment credentials are secrets and must not be printed.

  Rule: Open questions
    - What exact Saleor Cloud Stripe app/plugin path should be used at implementation time?
    - What webhook configuration is required for a deployed Paper storefront on Vercel?
    - Should Jolly automate webhook endpoint registration with Stripe where possible?
