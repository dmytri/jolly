Feature: The recipe catalog identifiers come from the shipped recipe asset
  Jolly's recipe stage assigns collection membership and seeds stock after the
  configurator deploy, so the cloud-api module needs the recipe's warehouse slug,
  product slugs, and collection memberships. It reads them from the one shipped
  source, assets/skills/jolly/recipe.yml, at runtime, so the values never drift
  from the deployed recipe.

  Rule: The recipe asset is the single source of the recipe identifiers

    The cloud-api module holds no built-in copy of the warehouse slug, the
    product slugs, or the collection memberships. It derives them from
    assets/skills/jolly/recipe.yml when the recipe stage runs. Because the asset
    is a YAML file, the module parses the YAML to read these values; the recipe
    asset is the one source, so the parsed values are the values it uses. The
    recipe declares no per-variant stock because trackInventoryByDefault is false,
    so the quantity the stock stage seeds is Jolly's own seeding default rather
    than a value read from the asset.

    @logic
    Scenario: The recipe identifiers follow the recipe asset, not a built-in constant
      Given a recipe asset that declares the warehouse slug "test-anchorage", the product slugs "first-mate" and "second-mate", and a collection "crew-picks" containing "first-mate"
      When the cloud-api module derives the recipe identifiers from that asset
      Then the warehouse slug it uses should be "test-anchorage"
      And the product slugs it uses should be "first-mate" and "second-mate"
      And the "crew-picks" collection it assigns should contain "first-mate"
