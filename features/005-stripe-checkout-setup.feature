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

  @logic
  Scenario: Jolly start previews the Stripe app-install stage
    Given the agent runs `jolly start --dry-run`
    When Jolly plans the Stripe stage
    Then the plan should include a Stripe stage that runs after the Vercel deploy stage
    And the Stripe stage should carry a riskContext with categories including "payment setup" and "production configuration changes"
    And the preview should name the real Saleor GraphQL `appInstall` request, the Stripe app manifest URL, and that it authenticates with the Cloud staff token
    And the preview should state that entering the keys and mapping them to the `us` channel is a guided human gate, not something Jolly performs
    And the preview should not perform any mutation

  @logic
  Scenario: Jolly start does not fabricate Stripe stage completion
    Given the agent runs `jolly start` in a fresh project directory with no real service credentials
    When `jolly start` reaches the Stripe stage
    Then it must not report the Stripe app as installed unless the `appInstall` actually succeeded
    And it must report the keys-and-channel-mapping step as a pending human gate and name it in nextSteps
    And it must not claim that checkout is ready or that the Stripe keys were configured

  @sandbox
  Scenario: Jolly start installs the Stripe app and surfaces the keys and channel gate
    Given a Saleor Cloud environment with the starter recipe deployed and the Cloud token available
    When Jolly start reaches the Stripe stage
    Then it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest
    And re-running the stage should reuse the existing installation rather than installing a duplicate
    And it should announce the guided gate to paste the keys and map the configuration to the `us` channel, referencing the keys by name only
    And it should report the stage honestly — installed where it installed, and blocked on the human gate for the keys and channel mapping

  @logic
  Scenario: Jolly doctor does not fabricate checkout readiness
    Given Jolly cannot reach a real store in this run
    When the agent runs `jolly doctor stripe` with no reachable store
    Then a checkout-readiness check should be reported in the stripe group
    And that check must not be "pass" unless the Stripe payment gateway was actually offered for a `us` checkout
    And with no reachable store the checkout-readiness check should be "skipped", "unknown", or "fail", never "pass"
    And the summary must not claim checkout is ready when it was not verified

  @sandbox
  Scenario: Jolly doctor verifies the Stripe payment gateway is reachable for checkout
    Given a deployed store whose Stripe app is configured and mapped to the `us` channel
    When `jolly doctor` probes checkout payment readiness
    Then it should create a harmless, reverted test checkout in the `us` channel and inspect its available payment gateways
    And the checkout-readiness check should pass only when the Stripe gateway is offered for that checkout
    And it should report honestly when the Stripe gateway is not yet offered, naming the remaining keys-and-channel Dashboard step
    And the probe should use Stripe test mode only and capture no payment

  Rule: Stripe setup principles
    - v1 uses Stripe test mode only; live mode requires an explicit customer choice and is out of v1 scope.
    - The customer provides exactly 2 values: Stripe publishable key and secret key from the Stripe Dashboard.
    - Jolly writes both to .env and ensures .env is ignored by Git.
    - Jolly does not build payment processing; the agent configures Saleor's Stripe app, and
      Jolly only writes the two test keys to `.env`.
    - Stripe live mode is explicitly out of v1 scope.
    - Payment credentials are secrets and must not be printed.

  Rule: Stripe app path (resolved 2026-06-13; automation split clarified 2026-06-14)
    - The Saleor-supported path is the Stripe app, configured with a publishable key and a Stripe
      **restricted** key (with the app's required scopes), and mapped to the storefront's channel
      (the starter recipe's `us` channel).
    - What each API can and cannot do (verified 2026-06-14 against current Saleor docs + the
      configurator source — this is the authority for the automation split):
      - **`@saleor/configurator`: cannot.** It manages catalog/channels/settings only; its sole
        payment field is the channel's `defaultTransactionFlowStrategy` (the recipe already sets
        `CHARGE`). No app install, no payment/gateway config in its schema or source.
      - **Saleor Cloud platform API: cannot.** It manages orgs/projects/environments; it exposes
        no app/extension-install endpoint (the Dashboard "Extensions" one-click is sugar over the
        Saleor GraphQL `appInstall`).
      - **Saleor GraphQL API: installs the app, does not configure it (verified live 2026-06-14).**
        `appInstall(manifestUrl, appName, permissions: [HANDLE_PAYMENTS])` installs the Stripe app
        programmatically against the customer's `*.saleor.cloud` endpoint. **It requires
        `AUTHENTICATED_STAFF_USER` + `MANAGE_APPS` — an app token CANNOT call it** (returns
        `PermissionDenied`, "authenticated as a staff member"). Jolly already has staff auth: the
        **Cloud token (`JOLLY_SALEOR_CLOUD_TOKEN`) sent as `Authorization: Bearer` to the store
        GraphQL authenticates as the environment's staff superuser** (`me.isStaff: true`) — the same
        auth Jolly uses for `appCreate`/`appTokenCreate`. So `appInstall` MUST use the Cloud token,
        not `JOLLY_SALEOR_APP_TOKEN`. The current manifest URL is
        **`https://stripe-v2.saleor.app/api/manifest`** (the older `stripe.saleor.app` is the
        retired v1 — installing it silently fails). There is **no** public GraphQL mutation to set
        the app's keys or assign a configuration to a channel — post-install GraphQL is limited to
        `appActivate`/`appTokenCreate`. Key entry + channel-config mapping live in the Stripe app's
        own Dashboard form (no documented/stable public API).
    - Resulting division (this is the `jolly start` Stripe stage):
      1. **Install — Jolly automates** the Stripe app install via GraphQL `appInstall`, using the
         Cloud token as staff auth and manifest `https://stripe-v2.saleor.app/api/manifest`
         (re-verify the current URL at implementation time; idempotent — reuse an existing install).
         Verified working live 2026-06-14 (app `saleor.app.payment.stripe` installed on `jolly-store`).
      2. **Channel payment flow — configurator/recipe** already sets it on the `us` channel.
      3. **Keys + channel-config mapping — Jolly runs a guided walk-through** (the announce-and-wait
         human gate, made precise): it pauses and emits, in the feature 020 envelope, the exact
         deep link to the installed app's configuration page and step-by-step "paste this
         publishable key here, this restricted key there, assign the config to the `us` channel"
         instructions (keys referenced by name, never printed), then waits for the human to confirm.
      4. **Verify — Jolly probes** `paymentGatewayInitialize` / a checkout to confirm the Stripe
         test payment step is reachable before reporting the stage done (no fabrication).
    - The Stripe app registers and removes its own Stripe webhooks when a configuration is
      created or deleted — Jolly does not automate Stripe webhook endpoint registration.
    - If a stable public API for setting the app's keys/channel ever ships, step 3 can be
      automated too; until then it stays the guided human gate (do not build on the app's
      undocumented internal config endpoint).

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

  Rule: `jolly start` Stripe stage — Jolly installs the app, keys + channel map is a guided gate (decision 2026-06-14)
    - Mirroring the stock-seeding stage (feature 004), the Stripe app **install** is a
      genuinely-executing `jolly start` stage: it is Jolly's own Saleor GraphQL `appInstall` call —
      no spawned CLI, no interactive stdio — so `jolly start` performs it itself rather than handing
      it to the agent. It is the **second** stage to converge on the in-process orchestrator
      (stock-seeding was first; AGENTS.md "MVP sequencing").
    - When the run reaches the Stripe stage, Jolly calls `appInstall(manifestUrl, appName,
      permissions: [HANDLE_PAYMENTS])` against the customer's `*.saleor.cloud` GraphQL endpoint,
      authenticated with the **Cloud token** (`JOLLY_SALEOR_CLOUD_TOKEN`) as staff auth — an app
      token cannot (`PermissionDenied`). Manifest `https://stripe-v2.saleor.app/api/manifest`
      (re-verify the current URL at implementation time). First-party Saleor host, a credential Jolly
      already manages — no new host or credential (Network Boundaries unchanged).
    - The Stripe stage runs after the Vercel deploy stage and carries a feature 021 riskContext
      (categories: payment setup, production configuration changes; the install is reversible via app
      uninstall). It gates for the agent's approval like the other high-risk stages, and `jolly start
      --yes` pre-approves it.
    - It is idempotent and resumable (feature 022): a re-run detects the already-installed Stripe app
      and reuses it rather than installing a duplicate.
    - The keys + `us`-channel-configuration mapping have no stable public API and stay the
      announce-and-wait human gate: after the install, Jolly emits, in the feature 020 envelope, the
      deep link to the app's configuration page and the precise "paste the publishable key here, the
      restricted key there, assign the configuration to the `us` channel" steps (keys by name, never
      printed) and waits.
    - Honest reporting (integrity rule): Jolly reports the install `completed` only when `appInstall`
      actually succeeded, and reports the keys/channel step as blocked on the human gate until it is
      done — never a fabricated "Stripe configured" or "checkout ready". Final checkout readiness is
      confirmed by `jolly doctor` (and the optional `paymentGatewayInitialize`/checkout probe), not
      asserted by the install alone.

  Rule: Checkout-readiness verify probe — jolly doctor confirms the Stripe test payment step is reachable (decision 2026-06-14)
    - Installing the Stripe app (`jolly start`) and completing the keys + `us`-channel Dashboard gate
      are necessary but not self-verifying. The closing signal is whether a real checkout in the
      storefront's channel is actually offered the Stripe payment gateway — i.e. checkout can
      progress to the Stripe test payment step (the feature 002 acceptance bar). There is no public
      read for the app's channel-config mapping (see Rule "Stripe app path"), so gateway availability
      at checkout is the authoritative signal that the mapping was completed.
    - `jolly doctor` (the `stripe` group, included in the default run) performs this probe against the
      store's Saleor GraphQL endpoint: it creates a minimal test checkout in the recipe's `us` channel
      and inspects the available payment gateways (and/or `paymentGatewayInitialize`), reporting a
      checkout-readiness check.
    - Honest reporting (integrity rule): the checkout-readiness check is `pass` only when the Stripe
      gateway is actually offered for that checkout; it is `warning`/`fail` when the store is reachable
      but the Stripe gateway is not yet offered (the keys + `us`-channel Dashboard mapping is not done),
      naming that remaining human step; and `skipped`/`unknown` when the store or credentials are
      unavailable. It never reports a fabricated "checkout ready".
    - The probe is harmless by design (feature 023): the test checkout it creates is namespaced and
      deleted after the probe, it only reads gateway availability, it uses Stripe test mode only, and
      it never captures a payment. This is a narrow, reverted exception to doctor's read-only default,
      justified because gateway availability cannot be read without a checkout context.
    - This closes the Stripe stage's step-4 verify (Rule "Stripe app path") and the feature 002
      "checkout progresses to the Stripe test payment step" acceptance bar within Jolly's own
      first-party-host code — no Vercel or Stripe-CLI dependency.
