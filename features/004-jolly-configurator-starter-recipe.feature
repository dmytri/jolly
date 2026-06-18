Feature: Jolly Configurator starter recipe
  As a customer setting up a new Saleor Cloud store through Jolly
  I want a Jolly-specific Configurator recipe
  So that the Saleor store is configured to work with the Paper storefront immediately

  @sandbox
  Scenario: Jolly prepares the starter recipe
    Given the customer has created or selected a Saleor Cloud environment
    When the agent runs `jolly start --dry-run --json`
    Then the plan should name the bundled starter recipe Jolly ships (`recipe.yml`)
    And the plan should write the recipe to a file at a named path before deployment
    And the plan should deploy it by spawning `npx @saleor/configurator deploy`
    And the plan should name the Saleor app token used for deployment as having all available permissions in v1

  @sandbox
  Scenario: Jolly blocks a recipe re-deploy over a pre-existing store's destructive diff
    Given a Saleor Cloud environment that already holds catalog data
    When the agent runs `jolly start --yes` to apply the starter recipe to Saleor Cloud
    Then the recipe stage should pass `--failOnDelete` to `npx @saleor/configurator deploy`
    And the configurator should exit 6 for deletions
    And Jolly should report the recipe stage as "blocked", not "completed"

  @logic
  Scenario: Jolly start previews seeding stock for the recipe catalog
    Given a project with the recipe stage not yet applied
    When the agent runs `jolly start --dry-run --json`
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

  @logic @exceptional-double
  Scenario: A transient Saleor rate-limit during the stock stage retries instead of reporting a false blocked
    # @exceptional-double: an HTTP 429 rate-limit cannot be produced on demand
    # against the real Saleor Cloud env, so this lone scenario points the stock
    # stage at a Saleor GraphQL endpoint that returns 429 once and then succeeds
    # with the recipe catalog in stock. It is the only double here and never the
    # normal path — the real seeding is the @sandbox scenario above; this pins
    # the resilience the idempotent re-run depends on so a momentary rate-limit
    # never degrades an otherwise-successful stock stage to a false blocked. The
    # same transient-429 retry contract holds for every backend Saleor request
    # (Rule "Backend Saleor requests retry a transient rate-limit").
    Given the stock stage's Saleor GraphQL endpoint returns HTTP 429 once and then succeeds with the recipe catalog in stock
    When the agent runs `jolly start --yes --json` and the stock stage runs against that endpoint
    Then the stock stage should be reported completed, having retried the rate-limited request
    And the stock stage should not be reported blocked on the transient rate-limit

  @logic
  Scenario: Jolly start previews the configurator deploy of the starter recipe
    Given a project with the recipe stage not yet applied
    When the agent runs `jolly start --dry-run --json`
    Then the plan should include a configurator-deploy step that runs before the stock-seeding step
    And the preview should name the spawned command `npx @saleor/configurator deploy`, Jolly's bundled starter recipe, and the store URL and app token by name only
    And the preview should name the safe flag `--failOnDelete` used to guard a re-deploy over a pre-existing store
    And the configurator-deploy step should carry a riskContext for deploying store configuration
    And the riskContext should mark a dry run available via the configurator `--plan` preview
    And the preview should not spawn the configurator or perform any deployment

  @logic
  Scenario: Jolly start does not fabricate the recipe deployment
    Given the agent runs `jolly start` with no real Saleor credentials
    When the run reaches the configurator-deploy stage without `--dry-run`
    Then Jolly should report the configurator-deploy stage as blocked or pending, never completed
    And the summary should not claim the starter recipe was deployed
    And the overall envelope status should be "warning", not "success"
    And Jolly should not print a fabricated deployment result

  @sandbox
  Scenario: Jolly start deploys the starter recipe with @saleor/configurator
    Given a freshly created blank Saleor Cloud environment
    When Jolly start runs the configurator-deploy stage with approval
    Then Jolly should spawn `npx @saleor/configurator deploy` of its bundled starter recipe against the store, never reimplementing it against raw APIs
    And the bootstrap deploy should record a successful configurator deployment report and the recipe's catalog entities should exist in the store
    And the stage should be reported completed only when the configurator's deployment report records success
    And re-running the stage should reconcile to a no-op diff rather than creating duplicate entities

  @sandbox
  Scenario: Jolly start deploys the recipe over the stock defaults of a store created by a prior create-store command
    Given a blank Saleor Cloud environment created by a prior `jolly create store --create-environment` and recorded in `.env`
    When the agent runs `jolly start --yes` and the run reaches the configurator-deploy stage
    Then the recipe stage should be reported "completed", not "blocked"
    And the recipe's `us` channel should exist and be active in the store

  @sandbox
  Scenario: Jolly start confirms the recipe's featured collection exists before reporting the recipe stage completed
    Given a freshly created blank Saleor Cloud environment
    When Jolly start runs the configurator-deploy stage with approval
    Then the recipe's `featured-products` collection should exist in the store holding its declared products
    And the recipe stage should be reported "completed" only after Jolly reads the store back and confirms the recipe's declared catalog entities exist there, not from the configurator's summary counts alone

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

  Rule: Recipe artifact
    - The starter recipe ships with the Jolly skill as `assets/skills/jolly/recipe.yml`, a
      `@saleor/configurator` config: shop settings, the `us` channel, a `Pirate Goods` product
      type, categories, a warehouse, a default US shipping zone, published USD-priced pirate
      products, a featured collection, and a navigation menu.
    - `jolly start` applies the bundled recipe with the configurator safe workflow — `diff`/plan to preview, then `deploy` with safe flags — passing the store URL and app token through the official CLI.
    - The recipe's `us` channel slug is the storefront's `NEXT_PUBLIC_DEFAULT_CHANNEL`.

  Rule: Recipe targets a clean environment
    - The recipe is a complete *declarative* `@saleor/configurator` config: a `deploy` reconciles
      the store to it — creating the recipe's entities, updating existing ones, and removing
      deletable entities the recipe does not declare. Saleor protects some stock defaults a "blank"
      Cloud environment ships with — notably the default channel — from deletion, so they may remain;
      the recipe ADDS its own active `us` channel rather than relying on the default channel's removal.
    - On the bootstrap path — a blank store Jolly provisioned, whether `jolly start` auto-provisioned
      it this run or a prior `jolly create store --create-environment` provisioned it and recorded it
      in `.env` — Jolly owns the store and the recipe is its intended end state, so the deploy proceeds
      WITHOUT `--failOnDelete`: removing the deletable Saleor stock defaults to match the recipe is the
      expected initial setup, not a destructive accident. The bootstrap path is decided by the store's
      state, not by which command provisioned it: when the only entities the deploy would delete are
      Saleor's stock defaults, the apply proceeds; how Jolly determines this is deferred to CLI design.
    - On a store that already holds customer catalog data (a re-deploy / pre-existing store), the apply
      would delete real data — the `--failOnDelete` guard correctly blocks it (exit 6). On such a store
      the agent must surface the destructive diff and get the customer's explicit approval before
      applying. The skill carries this guidance.
    - `jolly create store --create-environment` provisions the environment WITHOUT Saleor's
      demo/sample data (`database_population: null` — the Cloud "blank" template) so the recipe is
      the store's first catalog config; see feature 012 Rule "Created environments are provisioned
      blank".

  Rule: Recipe products need seeded stock — configurator cannot
    - `@saleor/configurator` cannot make products buyable: its product-variant schema (v3.23) is
      `name, sku, weight, digital, attributes, channelListings` only — no `stocks` and no
      `trackInventory` field — and it hardcodes `trackInventory: true` on variant create. The
      recipe's shop `trackInventoryByDefault: false` is applied to the shop but Saleor does not
      propagate it to configurator-created variants. Net: after a pure recipe deploy every variant
      has `trackInventory: true` with zero stock, so `quantityAvailable` is 0 and any `us` checkout
      fails with `INSUFFICIENT_STOCK` before reaching payment.
    - `jolly start`'s recipe stage **seeds real stock** after the `@saleor/configurator` deploy,
      because config-as-code cannot. For every recipe product variant it sets a default per-variant
      quantity (100 in v1) in the recipe's warehouse via Saleor GraphQL (`productVariantStocksCreate`,
      updating in place when a stock entry already exists) — leaving `trackInventory: true`, so the
      catalog shows finite stock that decrements with sales. Seeding stock, not flipping
      `trackInventory`, is the approach.
    - This is Jolly plumbing against a first-party Saleor host using the app token Jolly already
      manages — no new host, no new credential (Network Boundaries unchanged). It emits a feature
      021 `riskContext` (catalog data modification) and is idempotent and resumable (feature 022):
      re-running updates the quantities rather than creating duplicate stock entries.
    - The default quantity is a v1 constant; a configurable quantity is a post-MVP iteration.
    - `jolly start` **performs** this seeding itself — it is Jolly's own Saleor GraphQL call, not a
      spawned CLI — and reports it **honestly**. When the run reaches the stock stage and the store
      holds the recipe's variants (the configurator deploy has happened), Jolly executes
      `productVariantStocksCreate` for each variant and reports the stage `completed` only when stock
      was actually seeded; if no recipe variants are present yet (recipe not deployed), the stage is
      reported `pending`/`blocked` honestly, never a fabricated `completed`.

  Rule: Backend Saleor requests retry a transient rate-limit
    - Honesty cuts both ways: a stage is `blocked`/`fail` only when its work genuinely could not be
      done — a momentary HTTP 429 rate-limit that succeeds on retry must NOT degrade an
      otherwise-successful stage to a false `blocked`. The executable contract is the per-stage
      `@exceptional-double` retry scenarios (stock here; the Stripe app-install stage in feature 005);
      they hold for every backend Saleor GraphQL request Jolly's own code sends, so resilience belongs
      at the shared request layer rather than one caller.
    - Design intent (non-binding rationale; the scenarios above pin the observable contract): the
      retry is BOUNDED (it gives up and reports `blocked`/`fail` honestly when the 429 PERSISTS past
      the budget, never retrying forever) and SHOULD honor a `Retry-After` response header when the
      server supplies one. Precise `Retry-After` honoring is a refinement deferred past the v1 launch
      bar — the launch-protecting contract is "a single transient 429 is retried, not reported as a
      false blocked"; a brittle timing assertion is intentionally not specified.

  Rule: Configurator deploy
    - `jolly start` performs the recipe deploy itself by SPAWNING `npx @saleor/configurator deploy`.
      Jolly spawns the official, current CLI and never reimplements it against raw APIs.
    - It deploys Jolly's own bundled starter recipe (`assets/skills/jolly/recipe.yml`, resolved
      relative to Jolly's module path — the same bundled-asset mechanism `init` uses to install the
      skill). The agent's reviewable in-repo copy (Rule "Recipe artifact") is for ongoing iteration.
    - The deploy flags are `--url <store GraphQL>`, `--token <app token Jolly manages>`,
      `--config <recipe>`, `--quiet`, `--plan` (preview without changes), and — only when re-deploying
      over a pre-existing store — `--failOnDelete` (exit code 6); env `SALEOR_URL`/`SALEOR_TOKEN`. The
      configurator binary exposes only `--failOnDelete` (its docs mention a `--fail-on-breaking`
      guard the binary does not implement), so Jolly relies on `--failOnDelete` alone.
      `@saleor/configurator` auto-activates non-interactive mode in a non-TTY subprocess, so Jolly
      spawns it as a non-interactive batch command and reads its EXIT CODE — no stdio passthrough
      (unlike the interactive `vercel login`/`stripe login` gates).
    - On the bootstrap path — a store whose only deletable entities are Saleor's stock defaults,
      whether `jolly start` auto-provisioned it this run or a prior `jolly create store
      --create-environment` provisioned it and recorded it in `.env` — the deploy omits
      `--failOnDelete`: removing the deletable Saleor stock defaults to match the recipe is the
      intended initial setup, and the apply succeeds (exit 0, or the spurious exit-5 "partial" the
      honest-reporting rule below handles). On a re-deploy over a store that already holds customer catalog
      data Jolly passes `--failOnDelete` so a destructive apply is BLOCKED (exit 6), not silently
      destructive. The bootstrap path is decided by the store's state, not by which command
      provisioned it (Rule "Recipe targets a clean environment"); how Jolly determines this is
      deferred to CLI design.
    - High-risk → approval: the stage emits the feature 021 `riskContext` (deploy store configuration)
      and pauses for the agent to approve; `--yes` pre-approves. `--dry-run` previews the stage by
      naming the spawned command, the bundled recipe, the store URL + app token (by name only), and
      the `--failOnDelete` guard, with `dryRunAvailable` mapping to the configurator `--plan` preview —
      performing no deployment and spawning nothing.
    - Honest reporting (integrity rule): the stage is reported `completed` when the configurator
      exited 0 OR its deployment report records `status: success` — the exit code alone is unreliable
      for the bootstrap apply, which yields a spurious exit 5 ("partial") because Saleor protects some
      stock defaults from deletion, even though the report records success and zero errors. On exit 6
      (deletions over a pre-existing store) it is `blocked` with the destructive diff surfaced and an
      explicit-approval requirement to deploy; any other non-zero exit without a successful report, or
      a configurator that cannot be spawned, is reported `blocked`/`failed` honestly with the
      configurator's real error — never a fabricated `completed` or "recipe deployed".
    - Completion is confirmed against the STORE, not the configurator's optimistic summary counts:
      the configurator counts a create in its summary even when the operation failed at the API
      (e.g. a `JSONString` rejection on a collection's `description`), so `completed` is reported
      only after Jolly reads the store back and confirms the recipe's declared catalog entities — in
      particular the `featured-products` collection — actually exist. A declared entity that the
      configurator reported created but that is absent from the store is reported `blocked`/`failed`
      naming what is missing, never `completed`.
    - Idempotent and resumable (feature 022): re-deploying the same declarative recipe reconciles the
      store to the same state (a no-op diff once deployed), creating no duplicates; `jolly start` may
      skip the stage when the store already matches the recipe.
    - It runs BEFORE the stock-seeding stage (Rule "Recipe products need seeded stock"): the deploy
      makes the recipe catalog exist, the seed makes it buyable, so `create store` → configurator
      deploy → stock-seed is an all-Jolly-executable chain.
