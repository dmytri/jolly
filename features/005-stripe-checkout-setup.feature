Feature: Stripe checkout setup for the Jolly starter storefront
  As a customer setting up a Saleor storefront through Jolly
  I want Saleor's Stripe app installed and my agent equipped to configure it
  So that the deployed storefront can reach a working test-mode checkout

  Background:
    Given Jolly uses Saleor Cloud as the commerce backend
    And Jolly uses Saleor Paper as the storefront baseline
    And Stripe is the v1 payment provider target
    And v1 uses Stripe test mode only

  @logic
  Scenario: Jolly start previews the Stripe app-install stage
    Given a fresh empty project directory
    When the agent runs `jolly start --dry-run --json`
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
  Scenario: The Stripe stage installs the Stripe app and surfaces the keys and channel gate
    Given a configured Saleor Cloud store with a resolvable Cloud staff token
    When `jolly stripe` runs the Stripe app-install stage against that store
    Then it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest
    And re-running the stage should reuse the existing installation rather than installing a duplicate
    And it should announce the guided gate to paste the keys and map the configuration to the `us` channel, referencing the keys by name only
    And it should report the Stripe stage as completed (the app was installed) and name the keys-and-`us`-channel Dashboard mapping as the remaining human step in nextSteps, without claiming the keys are configured or checkout is ready

  @logic @exceptional-double
  Scenario: A transient Saleor rate-limit during the Stripe stage retries instead of reporting a false blocked
    Given the Stripe stage's Saleor GraphQL endpoint returns HTTP 429 once and then succeeds with the Stripe app already installed
    When the agent runs `jolly start --yes --json` and the Stripe stage runs against that endpoint
    Then the Stripe stage should be reported completed, having retried the rate-limited request
    And the Stripe stage should not be reported blocked on the transient rate-limit

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
    - v1 uses Stripe test mode only; live mode is a later, explicit customer choice.
    - Jolly's payment role is to install Saleor's Stripe app in the store and to install the
      `stripe-best-practices` skill for the customer's agent. Configuring the app — entering the
      test-mode publishable and restricted keys and mapping the configuration to the recipe's `us`
      channel — is a guided human Dashboard gate the agent drives with that skill.
    - The keys live in the Saleor Stripe app's own configuration; the Stripe app talks to Stripe and
      registers its own webhooks. Jolly installs the app via Saleor GraphQL and builds no payment
      processing of its own.
    - `jolly doctor` confirms readiness by probing whether a `us`-channel checkout is offered the
      Stripe gateway (Rule "Checkout-readiness verify probe").

  Rule: Stripe app path and the automation split
    - The Saleor-supported path is the Stripe app, configured with a publishable key and a Stripe
      **restricted** key (with the app's required scopes), and mapped to the storefront's channel
      (the starter recipe's `us` channel).
    - What each API can and cannot do (the authority for the automation split):
      - **`@saleor/configurator`: cannot.** It manages catalog/channels/settings only; its sole
        payment field is the channel's `defaultTransactionFlowStrategy` (the recipe already sets
        `CHARGE`). No app install, no payment/gateway config in its schema or source.
      - **Saleor Cloud platform API: cannot.** It manages orgs/projects/environments; it exposes
        no app/extension-install endpoint (the Dashboard "Extensions" one-click is sugar over the
        Saleor GraphQL `appInstall`).
      - **Saleor GraphQL API: installs the app, does not configure it.**
        `appInstall(manifestUrl, appName, permissions: [HANDLE_PAYMENTS])` installs the Stripe app
        programmatically against the customer's `*.saleor.cloud` endpoint. **It requires
        `AUTHENTICATED_STAFF_USER` + `MANAGE_APPS` — a plain app token CANNOT call it** (returns
        `PermissionDenied`, "authenticated as a staff member"). Jolly already has staff auth, and
        **either staff token works**: the device-grant session token (`JOLLY_SALEOR_ACCESS_TOKEN`, a
        staff-superuser Bearer JWT — the `SALEOR_TOKEN` projected for the agent) and the Cloud staff
        token (`JOLLY_SALEOR_CLOUD_TOKEN`) both, sent as `Authorization: Bearer` to the store GraphQL,
        authenticate as the environment's staff superuser (`me.isStaff: true`). So `appInstall` needs
        any staff Bearer token; the Stripe stage uses the Cloud staff token (`JOLLY_SALEOR_CLOUD_TOKEN`),
        the long-lived one always present in CI. The current manifest URL is
        **`https://stripe-v2.saleor.app/api/manifest`** (re-verify the current URL at implementation
        time). There is **no** public GraphQL mutation to set the app's keys or assign a
        configuration to a channel — post-install GraphQL is limited to `appActivate`/`appTokenCreate`.
        Key entry + channel-config mapping live in the Stripe app's own Dashboard form (no
        documented/stable public API).
    - Resulting division (this is the `jolly start` Stripe stage, which runs after the Vercel deploy
      stage):
      1. **Install — Jolly automates** the Stripe app install via GraphQL `appInstall`, using the
         Cloud token as staff auth and manifest `https://stripe-v2.saleor.app/api/manifest`. The
         install is Jolly's own Saleor GraphQL call — no spawned CLI, no interactive stdio — so
         `jolly start` performs it itself rather than handing it to the agent. First-party Saleor
         host, a credential Jolly already manages — no new host or credential (Network Boundaries
         unchanged). The stage carries a feature 021 riskContext (categories: payment setup,
         production configuration changes; the install is reversible via app uninstall), gates for
         the agent's approval like the other high-risk stages, and `jolly start --yes` pre-approves
         it. Idempotent and resumable (feature 022): a re-run detects the already-installed Stripe
         app and reuses it rather than installing a duplicate. Resilient to a momentary Saleor
         GraphQL rate-limit (HTTP 429) during the install's idempotency query — it is retried, never
         reported as a false blocked. Because a 429 cannot be produced on demand against real Saleor
         Cloud, that resilience is pinned by a single @exceptional-double (a Saleor GraphQL endpoint
         that returns 429 once then succeeds with the app already present) — never the normal path;
         the real install is the @sandbox scenario.
      2. **Channel payment flow — configurator/recipe** already sets it on the `us` channel.
      3. **Keys + channel-config mapping — the agent runs a guided walk-through** with the
         `stripe-best-practices` skill (the announce-and-wait human gate): after the install Jolly
         pauses and emits, in the feature 020 envelope, the exact deep link to the installed app's
         configuration page and step-by-step "paste the publishable key here, the restricted key
         there, assign the configuration to the `us` channel" instructions (keys referenced by name,
         never printed), then waits for the human to confirm. These have no stable public API; if one
         for setting the app's keys/channel ever ships, this step can be automated too.
      4. **Verify — `jolly doctor` probes** a checkout to confirm the Stripe test payment step is
         reachable (Rule "Checkout-readiness verify probe").
    - Honest reporting (integrity rule): Jolly reports the install `completed` only when `appInstall`
      actually succeeded, and surfaces the keys/channel mapping as a pending human-gate step in
      `nextSteps` until it is done — never a fabricated "Stripe configured" or "checkout ready". The
      keys/channel gate is a surfaced next step, NOT a run-status downgrade: once the app-install
      stage and the other side-effecting stages complete, `jolly start` reports `success` (a live
      store is the win — features 002/027), with the keys step named as the remaining human action.
      Final checkout readiness is confirmed by `jolly doctor`, not asserted by the install alone.
    - The Stripe app registers and removes its own Stripe webhooks when a configuration is
      created or deleted — Jolly does not automate Stripe webhook endpoint registration.

  Rule: Checkout-readiness verify probe
    - Installing the Stripe app (`jolly start`) and completing the keys + `us`-channel Dashboard gate
      are necessary but not self-verifying. The closing signal is whether a real checkout in the
      storefront's channel is actually offered the Stripe payment gateway — i.e. checkout can
      progress to the Stripe test payment step (the feature 002 acceptance bar). There is no public
      read for the app's channel-config mapping (see Rule "Stripe app path and the automation split"),
      so gateway availability at checkout is the authoritative signal that the mapping was completed.
    - `jolly doctor` (the `stripe` group, included in the default run) performs this probe against the
      store's Saleor GraphQL endpoint: it creates a minimal test checkout in the recipe's `us` channel
      and inspects the available payment gateways (and/or `paymentGatewayInitialize`), reporting a
      checkout-readiness check.
    - Honest reporting (integrity rule): the checkout-readiness check is `pass` only when the Stripe
      gateway is actually offered for that checkout; it is `warning`/`fail` when the store is reachable
      but the Stripe gateway is not yet offered (the keys + `us`-channel Dashboard mapping is not done),
      naming that remaining human step; and `skipped`/`unknown` when the store or credentials are
      unavailable. It never reports a fabricated "checkout ready".
    - The probe is harmless by design: the test checkout it creates is namespaced and
      deleted after the probe, it only reads gateway availability, it uses Stripe test mode only, and
      it never captures a payment. This is a narrow, reverted exception to doctor's read-only default,
      justified because gateway availability cannot be read without a checkout context.
    - This closes the Stripe stage's step-4 verify (Rule "Stripe app path and the automation split")
      and the feature 002 "checkout progresses to the Stripe test payment step" acceptance bar within
      Jolly's own first-party-host code.
