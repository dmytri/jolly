Feature: Cloud API recipe constants stay aligned with the shipped recipe
  The cloud-api module hardcodes recipe identifiers that also live in the
  shipped asset assets/skills/jolly/recipe.yml: the warehouse slug, the product
  slugs, the collection memberships, and the default per-variant stock. The
  constants and the asset MUST stay in sync, or recipe assignment binds the
  wrong objects. Captain decides whether to source these values from the asset
  at runtime or keep them as a duplicate guarded by this conformance check.

  @captain
  Scenario: The recipe constants match the shipped recipe asset
    Given the asset assets/skills/jolly/recipe.yml declares a warehouse slug, product slugs, collection memberships, and a default per-variant stock
    When the cloud-api module assigns the starter recipe catalog after the configurator run
    Then the warehouse slug the cloud-api module uses should equal the warehouse slug in recipe.yml
    And the product slugs the cloud-api module reads back should equal the product slugs in recipe.yml
    And the collection memberships the cloud-api module assigns should equal the collections in recipe.yml
    And the default per-variant stock the cloud-api module seeds should equal the per-variant stock in recipe.yml
