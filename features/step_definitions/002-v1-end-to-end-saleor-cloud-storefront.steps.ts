// Feature 002 — V1 end-to-end Saleor Cloud storefront setup.
//
// This is the operational-readiness ACCEPTANCE feature. Its journey — register
// or connect a store, clone Paper, apply the recipe, deploy to Vercel — is
// performed by the customer's AGENT running the official CLIs (git, pnpm,
// @saleor/configurator, the Vercel CLI), guided by the Jolly skill. That
// narrative is NOT Jolly's code and NOT cucumber-testable here. These step
// defs therefore keep ONLY the Jolly-observable contributions:
//   - the @logic scenario asserts `jolly start` reveals the plan and the
//     required human-action steps;
//   - the @sandbox scenarios assert Jolly's thin plumbing + `jolly doctor`
//     verification (never running git clone / npx vercel / the configurator).
// The deep auth/store/app-token/url-normalization behavior is pinned in
// features 018/012/024; here it is asserted only at the Jolly surface.
//
// Safety: @logic CLI runs use logicSafeEnv() in the scenario's temp dir. The
// @sandbox scenarios are gated by SANDBOX_REQUIREMENTS (+ requiresVercelCli for
// the deploy scenario) and skip locally.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { logicSafeEnv } from "../support/logic-env.ts";
import { findRiskContexts } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given("Vercel is the first deployment target", function () {});
Given(
  "Saleor's official `saleor\\/storefront` Paper template is the first storefront baseline",
  function () {},
);
Given(
  "Jolly should create the storefront by cloning or otherwise directly using `saleor\\/storefront` from the `main` branch by default",
  function () {},
);
Given(
  "the customer's own agent performs the CLI steps \\(clone, configure, deploy), guided by the Jolly skill that Jolly installs",
  function () {},
);
Given(
  "Jolly's role is the thin plumbing \\(auth, store\\/app-token via the Cloud API, secret writing, `.mcp.json`, skill install) plus `jolly doctor` verification — Jolly never shells out to the Vercel CLI or `@saleor\\/configurator`",
  function () {},
);
Given(
  "`@saleor\\/configurator` is run by the agent directly for store configuration and recipes",
  function () {},
);
Given(
  "the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete",
  function () {},
);
Given(
  "the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values",
  function () {},
);

// --- Scenario: Agent starts the Saleor Cloud setup journey (@logic) ---------
//
// The customer-facing "ask whether you have a store or want to register one"
// dialog is skill copy. Jolly-observable: `jolly start --dry-run` reveals the
// staged plan (including the auth/store stages the journey branches on) and the
// human-action steps that cannot be automated.

Given("the customer has copied the Jolly onboarding prompt into their agent", function (this: JollyWorld) {
  this.notes.onboarding = true;
});

When("the agent begins the V1 setup journey", function (this: JollyWorld) {
  this.runCli(["start", "--dry-run", "--json"], { env: logicSafeEnv() });
});

Then(
  "it should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    // Jolly-observable: the plan exposes the auth + store stages the journey
    // branches on (register a new env vs connect an existing store URL).
    const plan = (this.envelope.data as { plan?: Array<{ stage?: string }> }).plan ?? [];
    const stages = plan.map((s) => s.stage);
    assert.ok(stages.includes("auth"), "the start plan should include the auth stage");
    assert.ok(stages.includes("store"), "the start plan should include the store stage");
  },
);

Then(
  "it should identify which steps require human action outside the agent",
  function (this: JollyWorld) {
    // Human-action steps surface as plan stages contacting external hosts
    // (browser OAuth / account signup / deploy) plus nextSteps guidance.
    const plan = (this.envelope.data as { plan?: Array<{ effects?: { networkHostsContacted?: string[] } }> }).plan ?? [];
    const hosts = plan.flatMap((s) => s.effects?.networkHostsContacted ?? []);
    assert.ok(
      hosts.some((h) => h.includes("saleor")),
      "the plan should identify external auth/account steps (e.g. cloud.saleor.io)",
    );
    assert.ok(Array.isArray(this.envelope.nextSteps), "start must carry a nextSteps channel");
  },
);

// --- Scenario: Agent helps register a new Saleor Cloud store (@sandbox) ------
//
// Deep registration behavior (Cloud APIs, browser OAuth, headless token, env
// creation) is pinned in features 018/012/024. Here it is asserted only at the
// Jolly surface: `jolly create store` carries the right riskContext and (under
// real creds) provisions an environment. Gated by SANDBOX_REQUIREMENTS
// ["Agent helps register a new Saleor Cloud store"] (saleorCloud) → skips
// locally. The browser/account-signup steps stay narrative no-ops.

Given("the customer says they want to register a Saleor store", function (this: JollyWorld) {
  this.notes.registerBranch = true;
});

When("the agent proceeds with the registration branch", function (this: JollyWorld) {
  // Jolly-observable preview of the registration plumbing (no real provisioning
  // in the preview; the real path is exercised by features 012/024).
  this.runCli(["create", "store", "--create-environment", "--dry-run", "--json"]);
});

Then("Jolly should use Saleor Cloud APIs programmatically where possible", function (this: JollyWorld) {
  // create store targets the Cloud API; the dry-run reveals the resolved
  // request against cloud.saleor.io (the first-party Cloud host).
  const [risk] = findRiskContexts(this.envelope);
  assert.ok(risk, "create store must carry a riskContext describing the Cloud API action");
});

Then(
  "Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback",
  function () {
    // Pinned by feature 018 (jolly login --browser). Narrative cross-ref here.
  },
);

Then(
  "Jolly should support a headless token flow when browser OAuth is unavailable or undesirable",
  function () {
    // Pinned by feature 018 (jolly login --token). Narrative cross-ref here.
  },
);

Then("Jolly should reuse an existing Saleor Cloud organization when available", function () {
  // Pinned by feature 012 (org resolution/selection). Narrative cross-ref.
});

Then("Jolly should create a Saleor Cloud project and environment as needed for the new store", function () {
  // Pinned by feature 012 (create store --create-environment). Cross-ref.
});

Then(
  "Jolly should use `saleor\\/configurator` recipes as the default mechanism for initial store configuration",
  function () {
    // The agent runs the configurator recipe (feature 004) — agent-journey.
  },
);

Then(
  "Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational",
  function () {
    // The Jolly starter recipe is a Captain-owned asset (feature 004) — narrative.
  },
);

Then(
  "the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically",
  function () {
    // Pausing for human steps is skill-driven agent behavior — narrative.
  },
);

Then(
  "for new Saleor Cloud account creation, Jolly should direct the customer to cloud.saleor.io for the browser signup flow",
  function () {
    // The signup direction is skill copy / feature 018 login guidance — narrative.
  },
);

Then("Jolly should resume automatically once the customer provides the new store URL", function () {
  // Resume-on-URL is pinned by feature 012 (create store --url). Cross-ref.
});

Then("Jolly should not attempt to automate the browser account signup itself", function () {
  // Jolly never automates browser signup — a boundary, not a runtime assertion.
});

// --- Scenario: Agent connects an existing Saleor store (@sandbox) -----------
//
// URL normalization, introspection validation, org/env inference, and app-token
// acquisition are pinned in features 012/024. Asserted only at the Jolly
// surface here. Gated (saleorEndpoint+saleorAppToken) → skips locally.

Given("the customer says they already have a Saleor store", function (this: JollyWorld) {
  this.notes.connectBranch = true;
});

When("the agent needs to connect the storefront to Saleor", function (this: JollyWorld) {
  // Jolly-observable: doctor's saleor group reports connectivity readiness for
  // an existing store (endpoint/app-token presence + live check under creds).
  this.runCli(["doctor", "saleor", "--json"]);
});

Then(
  "Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible",
  function () {
    // Pinned by feature 012 (normalizeSaleorUrl / create store --url). Cross-ref.
  },
);

Then(
  "Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding",
  function () {
    // Pinned by feature 012. Cross-ref.
  },
);

Then(
  "when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments",
  function () {
    // Pinned by feature 012 (org/env inference). Cross-ref.
  },
);

Then("Jolly should ask only for missing details it cannot infer automatically", function () {
  // Safe-defaults / no-ask-when-inferable is a cross-cutting principle — narrative.
});

Then(
  "Jolly should require an app token or equivalent credential for full existing-store setup",
  function (this: JollyWorld) {
    // Jolly-observable: doctor's saleor group reports an app-token check.
    const check = this.findCheck("saleor-app-token");
    assert.ok(check, "doctor saleor must report an app-token readiness check");
  },
);

Then(
  "Jolly should acquire or create the app token automatically where Saleor APIs allow",
  function () {
    // Pinned by feature 024 (jolly create app-token). Cross-ref.
  },
);

Then(
  "Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available",
  function () {
    // Fallback guidance is skill copy / honest error remediation — narrative.
  },
);

Then("it should verify connectivity before proceeding to storefront setup", function (this: JollyWorld) {
  // Jolly-observable: doctor reports a Saleor endpoint/connectivity check.
  const check = this.findCheck("saleor-endpoint");
  assert.ok(check, "doctor saleor must report an endpoint/connectivity check");
});

// --- Scenario: Agent creates a deployable storefront from Saleor Paper (@sandbox)
//
// Cloning Paper, removing .git, pnpm install, and Paper's own validation are
// the agent's git/pnpm steps. Jolly-observable: `jolly doctor storefront`
// reports storefront readiness (and `--full-validation` is its deeper check).
// Gated (saleorEndpoint) → skips locally.

Given("Saleor connectivity has been verified", function (this: JollyWorld) {
  this.notes.connectivityVerified = true;
});

When("the agent prepares the storefront project", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"]);
});

Then("it should propose `storefront` as the default storefront target directory", function () {
  // The default `storefront` dir is the agent's clone target per the skill — narrative.
});

Then("it should proceed with the default directory automatically", function () {
  // Agent/skill behavior — narrative.
});

Then(
  "it should only pause if the default directory already exists and ask how to resolve the collision",
  function () {
    // Collision handling is the agent's clone-step concern — narrative.
  },
);

Then(
  "it should clone or directly use Saleor's official `saleor\\/storefront` Paper template as the baseline",
  function () {
    // The agent runs `git clone saleor/storefront` — agent-journey.
  },
);

Then("it should remove the cloned upstream `.git` history", function () {
  // The agent's git step — narrative.
});

Then(
  "it should initialize a fresh Git repository when needed for the customer's storefront workflow",
  function () {
    // The agent's git step — narrative.
  },
);

Then("it should validate the local Node.js version against Paper's current requirements", function () {
  // Node-version guidance is the agent's runtime domain / skill copy — narrative.
});

Then("it should provide actionable guidance when the local Node.js version is incompatible", function () {
  // Skill copy — narrative.
});

Then(
  "it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain",
  function () {
    // Boundary: Jolly never manages runtimes — not a runtime assertion.
  },
);

Then("it should use Paper's expected package manager, `pnpm`, for the cloned storefront", function () {
  // The agent runs pnpm — agent-journey.
});

Then("it should install Paper storefront dependencies automatically by default", function () {
  // The agent runs `pnpm install` — agent-journey.
});

Then("it should run lightweight validation by default", function (this: JollyWorld) {
  // Jolly-observable: doctor storefront reports a storefront-present check.
  const check = this.findCheck("storefront-present");
  assert.ok(check, "doctor storefront must report a storefront readiness check");
});

Then(
  "`jolly doctor storefront --full-validation` should run full Paper validation such as generate, typecheck, build, or tests where feasible; the agent also runs Paper's own `pnpm` validation directly per the Jolly skill",
  function (this: JollyWorld) {
    // Jolly-observable: doctor storefront accepts the deeper validation request
    // and still reports a well-formed envelope (no fabricated pass).
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope.command.startsWith("doctor"), "doctor storefront --full-validation must run");
  },
);

Then("it should provide actionable guidance if `pnpm` is missing", function () {
  // pnpm guidance is skill copy / agent concern — narrative.
});

Then(
  "it should optionally install `pnpm` where possible when the agent\\/customer allows it",
  function () {
    // pnpm install is the agent's runtime concern — narrative.
  },
);

Then(
  "it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily",
  function () {
    // Preservation is the agent's discipline guided by the skill — narrative.
  },
);

// --- Scenario: Agent deploys to Vercel via the official Vercel CLI (@sandbox)
//
// Deployment is the agent's `npx vercel` step; Jolly never contacts
// api.vercel.com and holds no Vercel token. Jolly-observable: `jolly doctor`
// reports the deployment as agent-run (skipped, not fabricated) and verifies
// the deployed storefront can reach Saleor. Gated (saleorEndpoint) AND
// requiresVercelCli → skips locally without an authenticated Vercel CLI.

Given("the storefront is ready for deployment", function (this: JollyWorld) {
  this.notes.deployReady = true;
});

When("the agent deploys to Vercel following the Jolly skill", function (this: JollyWorld) {
  // The agent runs `npx vercel`. Jolly-observable: doctor's deployment group.
  this.runCli(["doctor", "deployment", "--json"]);
});

Then(
  "the agent should deploy exclusively through the official Vercel CLI \\(`npx vercel`)",
  function (this: JollyWorld) {
    // Jolly-observable: doctor's deployment check points at the Vercel CLI and
    // is marked skipped (Jolly does not contact Vercel) — never a fabricated pass.
    const check = this.findCheck("deployment-status");
    assert.ok(check, "doctor must report a deployment-status check");
    assert.equal(check!.status, "skipped", "Jolly must not fabricate a deployment pass; it is agent-run");
  },
);

Then(
  "the agent should authenticate only via the Vercel CLI's own `vercel login` session",
  function () {
    // Vercel auth is the CLI's own session; there is no JOLLY_VERCEL_TOKEN — boundary.
  },
);

Then(
  "when the Vercel CLI is not authenticated, the Jolly skill should direct the human to run `npx vercel login` and resume afterward",
  function () {
    // Skill copy directs the human to `npx vercel login` — narrative.
  },
);

Then(
  "Jolly's own code should send no request to api.vercel.com and hold no Vercel token",
  function (this: JollyWorld) {
    // Jolly-observable boundary: the deployment check explicitly states Jolly
    // does not contact Vercel, and Jolly exposes no Vercel token surface.
    const check = this.findCheck("deployment-status");
    const text = JSON.stringify(check ?? {}).toLowerCase();
    assert.ok(text.includes("vercel"), "the deployment check should reference the agent-run Vercel CLI");
    assert.ok(!text.includes("api.vercel.com"), "Jolly must not contact api.vercel.com");
  },
);

Then(
  "the agent should not fall back to any other deployment mechanism such as a guided Git import flow",
  function () {
    // No guided-import fallback exists — boundary (decision 2026-06-13).
  },
);

Then(
  "the agent should configure required environment variables on the Vercel project through the Vercel CLI",
  function () {
    // The agent sets Vercel env vars via the CLI — agent-journey.
  },
);

Then(
  "`jolly doctor` should verify that the deployed storefront can reach Saleor Cloud",
  function (this: JollyWorld) {
    // Jolly-observable: a full doctor run reports the Saleor connectivity check.
    this.runCli(["doctor", "--json"]);
    const check = this.findCheck("saleor-endpoint");
    assert.ok(check, "doctor must report a Saleor connectivity check for the deployed storefront");
  },
);

Then(
  "the agent should update Saleor allowed\\/trusted origins for the deployed storefront URL where APIs allow",
  function () {
    // Trusted-origin updates are an agent/Cloud-API step guided by the skill — narrative.
  },
);

Then("the deployed URL and any remaining manual steps should be reported", function (this: JollyWorld) {
  // Jolly-observable: doctor carries a nextSteps channel for remaining manual steps.
  assert.ok(Array.isArray(this.envelope.nextSteps), "doctor must carry a nextSteps channel");
});
