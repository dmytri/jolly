Feature: Saleor trusted origins after deployment
  As a customer deploying a Jolly storefront
  I want Jolly to update Saleor trusted origins automatically
  So that the deployed storefront can communicate with Saleor without extra Dashboard work

  Background:
    Given Vercel is the first deployment target
    And Jolly can learn from deprecated Saleor CLI source without depending on it

  Scenario: Jolly updates trusted origins after Vercel deployment
    Given the storefront has been deployed to Vercel
    And Jolly knows the deployed storefront URL
    And Jolly has Saleor Cloud authentication and environment context
    When Saleor APIs allow trusted-origin updates
    Then Jolly should add the deployed storefront origin to the Saleor environment's allowed or trusted origins
    And it should preserve existing allowed origins unless replacement is explicitly intended
    And it should verify the storefront can communicate with Saleor after the update

  Scenario: Jolly falls back when automatic update is unavailable
    Given the deployed storefront URL is known
    But Jolly cannot update trusted origins automatically
    When the workflow reaches trusted-origin setup
    Then Jolly should provide exact Saleor Dashboard steps for adding the deployed origin manually
    And it should explain why the automatic update was unavailable
    And it should verify the configuration after the customer completes the manual step if possible

  Rule: Trusted-origin principles
    - Automatically update Saleor allowed/trusted origins after deployment where APIs allow.
    - Preserve existing origins by default.
    - Treat the deprecated CLI `env origins` command as example material only.
    - Do not depend on the deprecated Saleor CLI.
    - The deployed Vercel URL is the first origin that must be supported.

  Rule: Open questions
    - What is the current Saleor Cloud API field/path for trusted origins at implementation time?
    - Should preview deployment URLs be added automatically, or only production deployment URLs?
