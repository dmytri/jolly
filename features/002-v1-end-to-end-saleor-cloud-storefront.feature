Feature: V1 end-to-end Saleor Cloud storefront setup
  As a customer using their own AI agent
  I want Jolly to guide the agent through Saleor Cloud setup, storefront creation, and Vercel deployment
  So that I can get a fully operational Saleor-powered commerce experience online

  Background:
    Given Vercel is the first deployment target
    And Saleor's official `saleor/storefront` Paper template is the first storefront baseline
    And Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default
    And `jolly start` performs the mechanical CLI steps itself by spawning the official CLIs (`git` clone, `pnpm` install, `@saleor/configurator` deploy, `npx vercel` deploy), each under its own auth — never reimplementing them against raw APIs
    And the customer's agent supervises: it approves each high-risk stage's `riskContext`, provides credentials, and completes the human gates, and may run any stage as a composable command itself
    And Jolly's own plumbing covers auth, store/app-token via the Cloud API, secret writing, `.mcp.json`, skill install, and `jolly doctor` verification
    And the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete
    And the setup path must minimize human intervention to new account creation, the Vercel sign-in, and providing secret values

  @logic
  Scenario: Agent reaches the store choice once authenticated with no store configured
    Given `JOLLY_SALEOR_CLOUD_TOKEN` is configured and no store URL is set
    When the agent runs `jolly start --json` with no store URL
    Then `nextSteps` should name both the register-new and connect-existing paths

  @logic
  Scenario: jolly start starts the device grant when no token is configured
    Given a fresh project directory with no `JOLLY_SALEOR_CLOUD_TOKEN` configured
    When the agent runs `jolly start --json` in a non-interactive shell
    Then Jolly should request a device code from `https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/auth/device` with `client_id=jolly`
    And it should print the returned user code and the verification URL `https://auth.saleor.io/realms/saleor-cloud/device?user_code=` followed by that user code to stderr so the agent can relay them to its human
    And it should not fabricate that authentication succeeded

  @sandbox
  Scenario: Jolly registers a new Saleor Cloud store via the Cloud API
    Given `JOLLY_SALEOR_CLOUD_TOKEN` is set for an organization with no project
    When the agent runs `jolly create store --create-environment --json`
    Then the envelope `data` should report the created project and environment
    And the `data` should include the new store's `*.saleor.cloud` GraphQL API URL
    And the `data` should include the store's Saleor Dashboard URL ending in `.saleor.cloud/dashboard/`
    And `nextSteps` should direct new-account signup to cloud.saleor.io
    And Jolly's code should send no signup request and contact only first-party hosts

  @sandbox
  Scenario: jolly start auto-provisions a new store when none is configured
    Given `JOLLY_SALEOR_CLOUD_TOKEN` is set and no `NEXT_PUBLIC_SALEOR_API_URL` is configured
    When the agent runs `jolly start --yes --json`
    Then the `store` stage status should be "completed", not "pending"
    And the envelope `data` should include the new store's `*.saleor.cloud` GraphQL API URL and its Saleor Dashboard URL ending in `.saleor.cloud/dashboard/`
    And `jolly start` should write that `NEXT_PUBLIC_SALEOR_API_URL` and the acquired `JOLLY_SALEOR_APP_TOKEN` to `.env`
    And the `recipe` and `stock` stages should not report "blocked" for a missing Saleor endpoint

  @logic
  Scenario: jolly start --dry-run plans to provision a store when none is configured
    Given `JOLLY_SALEOR_CLOUD_TOKEN` is set and no `NEXT_PUBLIC_SALEOR_API_URL` is configured
    When the agent runs `jolly start --dry-run --json`
    Then the `store` stage preview should name the real Cloud API `organizations/{organization}/environments/` request it would send to provision a new store
    And it should not report the `store` stage as "pending" or claim a store already exists
    And it should not create, configure, or store anything

  @logic
  Scenario: jolly start --dry-run skips store provisioning when a store endpoint is already configured
    Given `JOLLY_SALEOR_CLOUD_TOKEN` is set and `NEXT_PUBLIC_SALEOR_API_URL` is configured to an existing store
    When the agent runs `jolly start --dry-run --json`
    Then the `store` stage preview should report the configured store as already satisfied and skip provisioning
    And it should not name a Cloud API request to create a new project or environment
    And it should not create, configure, or store anything

  @sandbox
  Scenario: Jolly connects an existing Saleor store and verifies connectivity
    Given a store URL `https://example.saleor.cloud` and a valid app token
    When the agent runs `jolly init --json` with that store URL
    Then `data` should report the normalized GraphQL endpoint `https://example.saleor.cloud/graphql/`
    And a `saleor-connectivity` check should report status "pass"

  @sandbox
  Scenario: Jolly start creates a deployable storefront from Saleor Paper
    Given Saleor connectivity has been verified
    When `jolly start` prepares the storefront project by spawning `git` and `pnpm`
    Then it should use `storefront` as the default storefront target directory and proceed automatically
    And it should only pause if the default directory already exists and ask how to resolve the collision
    And it should clone Saleor's official `saleor/storefront` Paper template from `main` by spawning `git`, remove the upstream `.git` history, and initialize a fresh repository
    And it should install Paper's dependencies by spawning `pnpm`
    And on a too-old Node.js version a `node-version` check should report status "fail" naming the required version, and Jolly should not install or switch Node.js itself
    And when `pnpm` is missing the stage should report a `pnpm-available` check with status "fail" and a remediation to install pnpm — a clean prerequisite check, never a raw `spawnSync` ENOENT error surfaced to the user — and Jolly should not install Node.js itself
    And `jolly doctor storefront --full-validation` should run Paper's generate, typecheck, and build steps and report each as a check
    And it should leave Paper's source and theme files unmodified after the clone and install

  @sandbox
  Scenario: Jolly start lets Paper's native dependencies run their build scripts so the Vercel build succeeds
    Given Jolly has cloned and installed the Paper storefront
    When `jolly start` prepares the storefront for the Vercel deploy
    Then `pnpm install` in the storefront should report no ignored build scripts for Paper's native dependencies `sharp` and `esbuild`
    And the `npx vercel --prod` production build should complete, not fail on unbuilt native modules

  @sandbox
  Scenario: Jolly start deploys to Vercel by spawning the official Vercel CLI
    Given the storefront is ready for deployment
    When `jolly start` deploys to Vercel
    Then it should emit the deploy stage's feature 021 `riskContext` and pause for the agent to approve before deploying
    And it should deploy exclusively by spawning the official Vercel CLI (`npx vercel`), under the CLI's own `vercel login` session
    And Jolly's own code should send no request to api.vercel.com and hold no Vercel token
    And it should not fall back to any other deployment mechanism such as a guided Git import flow
    And it should configure the required environment variables on the Vercel project through the Vercel CLI
    And it should disable Vercel Deployment Protection via the Vercel CLI so the store is publicly reachable, falling back to a guided step where the plan or permissions disallow it
    And it should register the deployed storefront URL as a Saleor trusted origin where a first-party Cloud API allows, otherwise surfacing it as a guided Dashboard step
    And `jolly doctor` should verify that the deployed storefront can reach Saleor Cloud
    And the envelope `data` should report the deployed storefront URL captured from the Vercel CLI's deploy output, not a fabricated or guessed value
    And `nextSteps` should list the remaining human gates

  @sandbox
  Scenario: Jolly start spawns the Vercel sign-in itself when there is no Vercel session
    Given the storefront is ready for deployment
    And the Vercel CLI is pointed at an isolated config with no signed-in session
    When `jolly start` reaches the deploy stage without `--dry-run`
    Then Jolly should itself spawn `npx vercel login` and surface its device-authorization URL on stderr before attempting any deploy
    And Jolly should render the surfaced Vercel sign-in URL as a clickable terminal hyperlink where the terminal supports it
    And the deploy stage should report a pending Vercel sign-in gate that states Jolly runs the Vercel sign-in together with the human, not a deploy `failed`
    And no deploy or vercel check should report `fail` when the only obstacle is the missing Vercel sign-in
    And Jolly's own code should send no request to api.vercel.com and hold no Vercel token while doing so

  @logic
  Scenario: A missing pnpm prerequisite is reported as a clean check, not a raw spawn error
    Given a Saleor Cloud token is configured
    And `pnpm` is not resolvable on PATH
    When the agent runs `jolly doctor --json`
    Then a `pnpm-available` check should report status "fail"
    And the check should carry a remediation that names installing pnpm
    And no check or error should contain a raw `spawnSync` ENOENT string

  @logic
  Scenario: Jolly start previews the storefront clone and install
    Given a fresh empty project directory
    When the agent runs `jolly start --dry-run --json`
    Then the plan should include a storefront step that spawns `git` to clone Saleor Paper and `pnpm` to install
    And the preview should name the default target directory `storefront` and the `saleor/storefront` Paper template from `main`
    And the storefront step should carry a riskContext for cloning and installing the storefront
    And the preview should not spawn git or pnpm or write the storefront

  @logic
  Scenario: Jolly start does not fabricate the storefront preparation
    Given the agent runs `jolly start` with no real Saleor credentials
    When the run reaches the storefront stage without `--dry-run`
    Then Jolly should report the storefront stage as completed, blocked, or pending, never fabricated
    And the overall envelope status should be "warning", not "success"

  @logic
  Scenario: Jolly start's storefront preparation approves Paper's native build scripts
    Given the agent runs `jolly start` with no real Saleor credentials
    When the run reaches the storefront stage without `--dry-run`
    Then a fresh `pnpm install` in the prepared storefront should report no ignored build scripts for `sharp` and `esbuild`

  @logic
  Scenario: Jolly start does not fabricate the Vercel deployment
    Given the agent runs `jolly start` with no real Saleor credentials
    When the run reaches the deploy stage without `--dry-run`
    Then Jolly should report the deploy stage as blocked or pending, never completed
    And the summary should not claim the storefront was deployed
    And the overall envelope status should be "warning", not "success"

  @logic
  Scenario: Jolly start points the human to run it in a shell when the agent cannot proceed
    Given the agent runs `jolly start` with no real Saleor credentials
    When the run stops at a gate the agent cannot complete
    Then the nextSteps should offer the human-run fallback of running `jolly start` in a shell
    And it should not fabricate that the human-run step was completed

  @sandbox
  Scenario: Jolly start owns the Vercel sign-in rather than telling the agent to run it
    Given the storefront is ready for deployment
    And the Vercel CLI is pointed at an isolated config with no signed-in session
    When `jolly start` reaches the deploy stage without `--dry-run`
    Then no nextSteps entry, error remediation, or check `command` should tell the agent to run `vercel login`, because Jolly runs the sign-in itself
    And no nextSteps entry or error remediation should tell the agent to re-run `jolly start` after a manual Vercel sign-in

  Rule: Storefront and Vercel deploy stages
    - `jolly start` performs the storefront and deploy stages itself by SPAWNING the official CLIs,
      completing the all-Jolly-executable chain `create store` → configurator deploy → stock-seed →
      storefront clone/install → vercel deploy.
    - Storefront stage: Jolly spawns `git` to clone `saleor/storefront` (Paper) from `main` into the
      default `storefront/` directory, removes the upstream `.git` history, initializes a fresh
      repository, and spawns `pnpm install`. Non-interactive (like the configurator deploy): Jolly
      reads the child exit codes and reports `completed` only when the clone + install actually
      succeeded; `blocked`/`failed` honestly otherwise — never a fabricated completion. Idempotent
      (feature 022): an already-cloned/installed `storefront/` is detected and the stage is skipped.
    - The storefront stage also approves the build scripts of Paper's native dependencies (e.g.
      `sharp`, `esbuild`, `unrs-resolver`) so they run under pnpm and the subsequent `npx vercel`
      production build does not fail on unbuilt native modules. pnpm 10+ ignores dependency build
      scripts unless they are approved (there is no `--allow-build` flag), so without this the
      Vercel build fails. This is build configuration, not a change to Paper's source or theme,
      so the "leave Paper's source and theme files unmodified" guarantee still holds.
    - Deploy stage: Jolly spawns `npx vercel` (and `npx vercel --prod`) under the Vercel CLI's OWN
      `vercel login` session to deploy `storefront/`, sets the required Vercel env vars through the
      CLI, disables Vercel Deployment Protection (on by default — SSO/"Vercel Authentication") via
      `vercel project protection disable --sso` so the store is publicly reachable (a guided fallback
      where the plan/permissions disallow it; still the CLI, never api.vercel.com), and
      updates Saleor trusted origins where APIs allow. The deployed Vercel project name comes from an
      OPTIONAL configured name (`JOLLY_VERCEL_PROJECT`, passed to the CLI as `--project`) when set, and
      the CLI-inferred default otherwise — the same affordance the test harness uses to make the
      project `jolly-test`-namespaced cannon fodder it tears down (mirrors the store name). The durable Vercel invariants hold: official
      CLI only (never a raw-API reimplementation), its own auth, no `JOLLY_VERCEL_TOKEN`, and no
      api.vercel.com in Jolly's own request code (see "Agent-supervised orchestration" and feature
      020 "First-party hosts only"). The Vercel CLI does NOT passively report a missing session: with
      no session the CLI's sign-in (`vercel whoami` / `vercel login`) emits a device-authorization URL
      and then waits for a human to complete it. Jolly owns the sign-in by spawning `npx vercel login`
      itself (never telling the agent to run it). On the interactive human path (feature 027) Jolly
      runs the sign-in UP FRONT, before the unattended stages, with the terminal passed through, and
      lets the Vercel CLI's device grant COMPLETE — exit 0 means the session exists and the deploy
      proceeds unattended. On the agent path (`--json`, `--yes`/`-y`, or no interactive terminal)
      Jolly cannot complete a human authorization, so it captures the device-authorization URL, routes
      it to stderr (never stdout) for the relaying agent, and reports the deploy stage as a `pending`
      human sign-in gate that states Jolly runs the Vercel sign-in together with the human — bounded,
      never blocking indefinitely on a human authorization the device flow cannot auto-complete in a
      non-interactive context. A missing session is therefore a pending sign-in gate, never a deploy
      `fail`, and NO envelope surface — `nextSteps`, error remediations, or check
      `command`/`remediation` fields — ever hands the agent `vercel login` or tells it to re-run
      `jolly start` after a manual sign-in. Reports `completed` only on a real exit-0 deploy, and a
      genuine deploy error with a session present is honest `blocked`/`failed`. Reaching this gate
      spawns the real Vercel CLI, so it is verified at `@sandbox`, not `@logic`.
    - Both stages are high-risk → approval: each emits the feature 021 `riskContext` and pauses for
      the agent to approve; `--yes` pre-approves. `--dry-run` previews each by naming the spawned
      command(s), target directory/template, and the Vercel invariants, performing no work and
      spawning nothing; the dry-run riskContext is deep-equal to the real-run stage's (021).

  Rule: Human-runnable `jolly start` is an offered entry mode
    - The full mechanical chain makes `jolly start` runnable end-to-end by a HUMAN in a plain
      shell — the natural way to clear the irreducibly-interactive gates (account creation, the
      Vercel sign-in `vercel login`) that a non-TTY agent cannot pass via stdio passthrough.
    - Agent-first stays primary; running `jolly start` directly in a terminal is a supported,
      offered entry mode, not merely a failure fallback. Its interactive experience is feature 027.
    - When the agent cannot or will not complete `jolly start` — it refuses, or a stage fails, or it
      reaches an interactive CLI gate it cannot complete in a non-TTY context — Jolly's feature 020
      output and the Jolly skill direct the agent to ask the human to run `jolly start` in a shell,
      then start their agent in that project to iterate (the skills `jolly init` installed are already
      on disk, so the agent resumes from a working/partly-built store).
    - Honesty-first: a blocked/failed `jolly start` surfaces the human-run fallback in its `nextSteps`;
      it never fabricates that the human-run step was performed. The agent-facing guidance lives in the
      shipped Jolly skill asset.

  Rule: jolly start orchestrates the setup by spawning the official CLIs
    - The "Jolly start creates a deployable storefront" and "Jolly start deploys to Vercel"
      scenarios above assert the orchestrated behavior; the Background and "Fast path principles"
      reflect Jolly spawning the CLIs. Each orchestrated stage also remains a composable command the
      agent can run itself (feature 008).
    - `jolly start` is a resumable end-to-end runner that performs the mechanical stages itself by
      SPAWNING the official CLIs: `git` clone of Paper (strip `.git`, fresh `git init`), `pnpm
      install`, `@saleor/configurator diff`/`deploy` of the starter recipe, and `npx vercel`
      deploy + env-var setup — alongside its own plumbing (`login`, `create store`/`app-token`,
      the Saleor Stripe-app install, `init`, `doctor`).
    - It spawns official, current CLIs only — never reimplementing them against raw APIs. Each
      spawned CLI uses its OWN auth (Vercel CLI session, the Saleor app token Jolly manages);
      there is still no `JOLLY_VERCEL_TOKEN` and api.vercel.com is not in Jolly's own
      allowlist. The deprecated `saleor/cli` stays banned.
    - Interactive CLI gates are stdio passthrough: when the spawned Vercel CLI needs the user
      (`vercel login`), Jolly runs it with the terminal passed straight through, the user
      interacts with that CLI directly, and Jolly continues on the child's exit — exit 0 → next
      stage; non-zero → stop honestly (no fabricated success).
    - Non-CLI human gates are announce-and-wait: account creation, the Saleor Dashboard Stripe-app
      configuration + channel mapping, and pasting a secret no CLI hands over are printed (in the
      feature 020 envelope) and Jolly waits for completion, then resumes. Vercel Deployment
      Protection, which is on by default and blocks public access, is likewise surfaced for the
      human/agent to disable (it is a project setting, not a deploy step).
    - The agent is the approval authority: before each high-risk action (`create store`,
      configurator `deploy`, the Vercel deploy) `start` emits the feature 021 `riskContext` and
      pauses for the agent to approve; an agent pre-authorization flag runs through when allowed.
    - Every orchestrated stage is also a composable command the agent can run independently;
      `start` chains them and is resumable (feature 022), skipping satisfied stages.

  Rule: Auto-provisioning a store, and how the store is named
    - When `jolly start` runs with a Saleor Cloud token configured but no
      `NEXT_PUBLIC_SALEOR_API_URL`, the store stage PROVISIONS a Saleor Cloud environment
      itself — the same Cloud API plumbing as `jolly create store --create-environment` —
      then writes the resulting `NEXT_PUBLIC_SALEOR_API_URL` and the acquired
      `JOLLY_SALEOR_APP_TOKEN` to `.env`, so the recipe/stock/deploy stages downstream have a
      reachable endpoint. The store stage is `completed` only when an environment was actually
      created (or an existing matching one reused — idempotent, feature 022); `blocked`/`failed`
      honestly otherwise, never a fabricated completion.
    - The provisioned store's name and domain label come from an OPTIONAL configured store name
      (the same name/domain-label override `jolly create store` accepts, surfaced to `jolly
      start` through project configuration) when one is set, and a sensible default otherwise.
      This is an ordinary configuration affordance — a customer can name their store; Jolly bakes
      no test knowledge into production. It is ALSO the single hook the test harness uses to make
      every store it provisions `jolly-test`-namespaced cannon fodder (AGENTS.md "harmless by
      design"): the harness sets that configured name to the per-run `jolly-test-<run>` value,
      exactly as it already passes `--name`/`--domain-label` to `jolly create store`.
    - The inverse holds for idempotency (feature 022): when `NEXT_PUBLIC_SALEOR_API_URL` is
      already configured — the customer connected an existing store, or a previous run
      provisioned one — the store stage detects that configured store as already satisfied and
      skips provisioning rather than creating a second environment. A re-run never provisions a
      duplicate store.

  Rule: Git provider for optional source control
    - GitHub is the default Git provider for optional source-control setup; other providers are deferred to v2.
    - Git setup is convenience, not the deployment mechanism — deployment is always the official Vercel CLI (`npx vercel`), spawned by `jolly start` (see "jolly start orchestrates the setup by spawning the official CLIs"). The durable Vercel invariants (official CLI only, its own `vercel login` session, no `JOLLY_VERCEL_TOKEN`, no `api.vercel.com` in Jolly's own code) live in that rule and feature 020's "First-party hosts only".

  @sandbox
  Scenario: The deployed storefront serves the Saleor catalog and a working cart
    Given `jolly start` has deployed the storefront to Vercel against the configured Saleor Cloud store
    When the deployed storefront URL is opened
    Then the URL should respond successfully
    And it should list products from the Saleor Cloud catalog
    And adding a product to the cart should update the cart

  Rule: V1 operational readiness
    - The deployed storefront URL must work.
    - Product browsing must work against Saleor Cloud data.
    - Cart must work.
    - Checkout must progress to the Stripe test payment step.
    - Stripe is the v1 payment provider target.
    - Auth, account dashboard, address book, order history, deeper caching, and webhook behavior may be verified opportunistically but are not the minimum v1 acceptance bar.
    - Saleor allowed/trusted origins should be updated automatically after deployment where APIs allow.

  Rule: Fast path principles
    - The end-to-end setup should require only the minimum human actions that cannot be automated.
    - Unavoidable human steps: new account creation (Saleor Cloud, Vercel, Stripe if needed), the Vercel sign-in, and providing secret values such as the Saleor Cloud token and the Stripe keys in the Dashboard.
    - All other steps should be automated: cloning, env configuration, Configurator recipe application, Vercel project setup, and trusted-origin updates.
    - Jolly should use safe defaults and skip confirmation steps that do not protect against irreversible actions.
    - Jolly should never ask for information it can infer, detect, or safely default.
    - When a human step is required, Jolly should tell the agent exactly what to ask the customer for, then resume automatically once the value is provided.
    - For new Saleor Cloud accounts: direct the customer to cloud.saleor.io, wait for the resulting store URL, then automate everything from that point.
    - For Stripe test mode: `jolly start` installs the Saleor Stripe app (`appInstall`) and installs the `stripe-best-practices` skill, then runs a guided gate for the Dashboard key entry and `us`-channel mapping that no public API can perform (feature 005).
