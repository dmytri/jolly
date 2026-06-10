Feature: Jolly Configurator starter recipe
  As a customer setting up a new Saleor Cloud store through Jolly
  I want a Jolly-specific Configurator recipe
  So that the Saleor store is configured to work with the Paper storefront immediately

  @sandbox
  Scenario: Agent prepares the starter recipe
    Given the customer has created or selected a Saleor Cloud environment
    When Jolly prepares the initial store configuration
    Then it should use a Jolly-specific starter recipe
    And the recipe should be optimized for Paper's required storefront features
    And the recipe should be written into the cloned storefront repository
    And the recipe should be reviewable before deployment
    And the recipe should be deployed through the safe Configurator workflow
    And the Saleor app token used for deployment should have all available permissions in v1

  @sandbox
  Scenario: Agent applies the starter recipe safely
    Given the Jolly starter recipe is ready
    When the agent applies it to Saleor Cloud
    Then it should validate the configuration
    And it should show a diff or deployment plan
    And Jolly remote/action commands involved in recipe deployment should support `--dry-run` preview behavior
    And the customer's agent should decide whether customer approval is needed before applying changes
    And it should fail safely if destructive or breaking operations are detected

  Rule: Starter recipe goals
    - Make a freshly created Saleor Cloud environment immediately useful with Paper.
    - Use a playful pirate-themed demo catalog: stuff that pirates would buy.
    - Do not require a custom pirate storefront theme in v1; Paper should remain mostly as-is.
    - Leave exact pirate-themed categories, products, variants, names, and prices to the implementation agent's creativity.
    - Include actual pirate-themed sample products by default.
    - Use US / USD / English as the v1 single market.
    - Defer additional markets/channels beyond v1.
    - Provide the channel, product model, navigation, sample catalog, shipping, Stripe-ready checkout assumptions, and other configuration required for a working end-to-end storefront.
    - Keep the recipe version-controlled and reviewable in the cloned storefront repository.

  Rule: Open questions
    - Exact pirate-themed catalog details are intentionally left to the implementation agent, as long as the result is useful for testing an operational Paper storefront.
    - Additional markets/channels are deferred beyond v1.
    - What Stripe account, test mode, webhook, and credential setup should Jolly automate or guide?
    - The Jolly starter recipe should live in the cloned storefront repository.
