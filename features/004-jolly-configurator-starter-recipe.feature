Feature: Jolly Configurator starter recipe
  As a customer setting up a new Saleor Cloud store through Jolly
  I want a Jolly-specific Configurator recipe
  So that the Saleor store is configured to work with the Paper storefront immediately

  @sandbox
  Scenario: Agent prepares the starter recipe
    Given the customer has created or selected a Saleor Cloud environment
    When the agent prepares the initial store configuration, guided by the Jolly skill
    Then it should use the Jolly-authored starter recipe that Jolly ships
    And the recipe should be optimized for Paper's required storefront features
    And the agent should write the recipe into the cloned storefront repository
    And the recipe should be reviewable before deployment
    And the agent should deploy it through `@saleor/configurator`'s safe workflow — Jolly never shells out to the configurator itself
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

  @logic
  Scenario: Jolly start previews seeding stock for the recipe catalog
    Given the agent runs `jolly start --dry-run`
    When Jolly plans the recipe stage
    Then the plan should include a stock-seeding step that runs after the `@saleor/configurator` deploy
    And the stock-seeding step should carry a riskContext for modifying catalog data
    And the preview should name the real Saleor GraphQL request, the recipe warehouse, and the default per-variant quantity
    And the preview should not perform any mutation

  @sandbox
  Scenario: Jolly start seeds stock so the recipe catalog is buyable
    Given a freshly created Saleor Cloud environment with the starter recipe deployed
    When Jolly start completes the recipe stage
    Then every recipe product variant should have stock in the recipe warehouse
    And a checkout in the `us` channel should not be blocked by INSUFFICIENT_STOCK
    And re-running the stage should update the quantities idempotently rather than creating duplicate stock

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

  Rule: Recipe artifact (resolved 2026-06-13)
    - The starter recipe ships with the Jolly skill as `assets/skills/jolly/recipe.yml`, a
      `@saleor/configurator` config: shop settings, the `us` channel, a `Pirate Goods` product
      type, categories, a warehouse, a default US shipping zone, published USD-priced pirate
      products, a featured collection, and a navigation menu.
    - The agent copies it into the cloned storefront (e.g. `saleor-config.yml`) and applies it
      with the configurator safe workflow — `diff` to preview, then `deploy` with
      `--fail-on-breaking` — passing the store URL and app token; Jolly never runs the configurator.
    - The recipe's `us` channel slug is the storefront's `NEXT_PUBLIC_DEFAULT_CHANNEL`.

  Rule: Recipe targets a clean environment (acceptance-run finding 2026-06-14)
    - The recipe is a complete *declarative* `@saleor/configurator` config: a `deploy` reconciles
      the store to match it, which means it deletes catalog entities the recipe does not declare.
    - It therefore assumes a freshly created, empty Saleor environment, where the apply is purely
      additive (creates only) and `--fail-on-breaking`/`--failOnDelete` passes cleanly.
    - On a store that already holds catalog data, the first apply is destructive — the safe guard
      correctly blocks it (observed live: applying the recipe over Saleor's sample data was 20
      creates + 120 deletes, `hasDestructiveOperations: true`). On such a store the agent must
      surface the destructive diff and get the customer's explicit approval before applying, and
      may only then deploy without the breaking guard. The skill carries this guidance.
    - To keep the happy path additive, `jolly create store --create-environment` provisions the
      environment WITHOUT Saleor's demo/sample data (`database_population: null` — the Cloud "blank"
      template) so the recipe is the store's first catalog config. Mechanism resolved 2026-06-14;
      see feature 012 Rule "Created environments are provisioned blank".

  Rule: Recipe products need seeded stock — configurator cannot (acceptance-run finding 2026-06-14)
    - `@saleor/configurator` cannot make products buyable: its product-variant schema (v3.23) is
      `name, sku, weight, digital, attributes, channelListings` only — no `stocks` and no
      `trackInventory` field — and it hardcodes `trackInventory: true` on variant create. The
      recipe's shop `trackInventoryByDefault: false` is applied to the shop but Saleor does not
      propagate it to configurator-created variants. Net: after a pure recipe deploy every variant
      has `trackInventory: true` with zero stock, so `quantityAvailable` is 0 and any `us` checkout
      fails with `INSUFFICIENT_STOCK` before reaching payment (observed live 2026-06-14).
    - Decision (customer, 2026-06-14): `jolly start`'s recipe stage **seeds real stock** after the
      `@saleor/configurator` deploy, because config-as-code cannot. For every recipe product
      variant it sets a default per-variant quantity (100 in v1) in the recipe's warehouse via
      Saleor GraphQL (`productVariantStocksCreate`, updating in place when a stock entry already
      exists) — leaving `trackInventory: true`, so the catalog shows finite stock that decrements
      with sales. Seeding stock, not flipping `trackInventory`, was the chosen approach.
    - This is Jolly plumbing against a first-party Saleor host using the app token Jolly already
      manages — no new host, no new credential (Network Boundaries unchanged). It emits a feature
      021 `riskContext` (catalog data modification) and is idempotent and resumable (feature 022):
      re-running updates the quantities rather than creating duplicate stock entries.
    - The default quantity is a v1 constant; a configurable quantity is a post-MVP iteration.
    - `jolly start` **performs** this seeding itself — it is Jolly's own Saleor GraphQL call, not a
      spawned CLI — and reports it **honestly** (decision 2026-06-14, MVP sequencing). When the run
      reaches the stock stage and the store holds the recipe's variants (the configurator deploy has
      happened), Jolly executes `productVariantStocksCreate` for each variant and reports the stage
      `completed` only when stock was actually seeded; if no recipe variants are present yet (recipe
      not deployed), the stage is reported `pending`/`blocked` honestly, never a fabricated
      `completed`. Because seeding is plain GraphQL with no interactive stdio, it is the **first
      genuinely-executing `jolly start` stage**: the CLI-spawning stages (git/pnpm/configurator/
      vercel) remain plan-and-gate and agent-driven via the Jolly skill until later iterations build
      them. The full in-process orchestrator of features 001/002 stays the goal; it is built
      incrementally, stock-seeding first.

