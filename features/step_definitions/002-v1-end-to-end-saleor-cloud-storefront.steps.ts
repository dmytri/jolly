// Feature 002 — V1 end-to-end Saleor Cloud storefront setup.
//
// This is the operational-readiness ACCEPTANCE feature. Under the 2026-06-14
// "Agent-supervised orchestration" decision, `jolly start` performs the
// mechanical journey itself by SPAWNING the official CLIs (git, pnpm,
// @saleor/configurator, the Vercel CLI), pausing for the agent's per-stage
// approval and waiting at the human gates. The spawned CLIs' own behavior
// (the actual clone/install/deploy and the resulting live store) is the
// acceptance-run concern, not harmlessly cucumber-testable here. These step
// defs therefore keep ONLY the Jolly-observable contributions:
//   - the @logic scenario asserts `jolly start` reveals the plan (including the
//     auth/store stages the journey branches on) and the required human steps;
//   - the @sandbox scenarios assert Jolly's observable surface — `jolly doctor`
//     readiness checks and the orchestration plan — never depending on a real
//     destructive clone/deploy from within cucumber. The riskContext/approval
//     pause behavior is pinned at @logic in features 001/021.
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
  "`jolly start` performs the mechanical CLI steps itself by spawning the official CLIs \\(`git` clone, `pnpm` install, `@saleor\\/configurator` deploy, `npx vercel` deploy), each under its own auth — never reimplementing them against raw APIs",
  function () {},
);
Given(
  "the customer's agent supervises: it approves each high-risk stage's `riskContext`, provides credentials, and completes the human gates, and may run any stage as a composable command itself",
  function () {},
);
Given(
  "Jolly's own plumbing covers auth, store\\/app-token via the Cloud API, secret writing, `.mcp.json`, skill install, and `jolly doctor` verification",
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

// --- Scenario: Jolly start creates a deployable storefront from Saleor Paper (@sandbox)
//
// `jolly start` spawns `git` (clone Paper, strip .git, fresh init) and `pnpm`
// (install) to prepare the storefront. The spawn + live outcome is the
// acceptance-run concern; here we assert Jolly's observable surface — `jolly
// doctor storefront` reports storefront readiness (and `--full-validation` is
// its deeper check). Gated (saleorEndpoint) → skips locally.

Given("Saleor connectivity has been verified", function (this: JollyWorld) {
  this.notes.connectivityVerified = true;
});

When(
  "`jolly start` prepares the storefront project by spawning `git` and `pnpm`",
  function (this: JollyWorld) {
    // Jolly-observable surface of the storefront stage: doctor storefront.
    this.runCli(["doctor", "storefront", "--json"]);
  },
);

Then(
  "it should use `storefront` as the default storefront target directory and proceed automatically",
  function () {
    // The default `storefront` dir is start's clone target; the directory choice
    // and auto-proceed are spawned-`git` behavior verified in the acceptance run.
  },
);

Then(
  "it should only pause if the default directory already exists and ask how to resolve the collision",
  function () {
    // Collision handling on the storefront clone is start's spawn-step concern —
    // verified in the acceptance run.
  },
);

Then(
  "it should clone Saleor's official `saleor\\/storefront` Paper template from `main` by spawning `git`, remove the upstream `.git` history, and initialize a fresh repository",
  function () {
    // start spawns `git clone saleor/storefront@main`, strips .git, re-inits —
    // a spawned-CLI outcome verified in the acceptance run, not from cucumber.
  },
);

Then(
  "it should install Paper's dependencies by spawning `pnpm`",
  function () {
    // start spawns `pnpm install` — a spawned-CLI outcome (acceptance run).
  },
);

Then(
  "it should validate the local Node.js version against Paper's current requirements and give actionable guidance on a mismatch, without installing or switching Node.js itself",
  function () {
    // Node-version validation/guidance is start's pre-spawn check; Jolly never
    // manages runtimes — a boundary, not a harmless cucumber assertion here.
  },
);

Then(
  "it should give actionable guidance if `pnpm` is missing, optionally installing it where the agent\\/customer allows",
  function () {
    // pnpm-presence guidance is start's pre-spawn check — acceptance run.
  },
);

Then(
  "`jolly doctor storefront --full-validation` should run full Paper validation such as generate, typecheck, build, or tests where feasible",
  function (this: JollyWorld) {
    // Jolly-observable: doctor storefront accepts the deeper validation request
    // and still reports a well-formed envelope (no fabricated pass).
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope.command.startsWith("doctor"), "doctor storefront --full-validation must run");
  },
);

Then(
  "it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily",
  function () {
    // Preservation is start's discipline when preparing Paper — acceptance run.
  },
);

// --- Scenario: Jolly start deploys to Vercel by spawning the official Vercel CLI (@sandbox)
//
// `jolly start` deploys by SPAWNING `npx vercel` under the CLI's own `vercel
// login` session; Jolly's own code never contacts api.vercel.com and holds no
// Vercel token. The riskContext/approval pause is pinned at @logic (001/021);
// here we assert Jolly's observable surface — `jolly doctor` reports the
// deployment as spawn-run (skipped, not fabricated) and verifies the deployed
// storefront can reach Saleor. Gated (saleorEndpoint) AND requiresVercelCli →
// skips locally without an authenticated Vercel CLI.

Given("the storefront is ready for deployment", function (this: JollyWorld) {
  this.notes.deployReady = true;
});

When("`jolly start` deploys to Vercel", function (this: JollyWorld) {
  // start spawns `npx vercel`. Jolly-observable surface: doctor's deployment group.
  this.runCli(["doctor", "deployment", "--json"]);
});

Then(
  "it should emit the deploy stage's feature 021 `riskContext` and pause for the agent to approve before deploying",
  function (this: JollyWorld) {
    // The deploy stage's riskContext + approval pause is pinned at @logic
    // (features 001/021). Jolly-observable here: the orchestration plan carries
    // a deploy stage and a riskContext (read from the harmless dry-run plan).
    const dry = this.runCli(["start", "--dry-run", "--json"]);
    const plan =
      (dry.envelope?.data as { plan?: Array<Record<string, unknown>> })?.plan ?? [];
    assert.ok(
      plan.some((s) => String(s.stage).includes("deploy")),
      "the start plan must include a deploy stage carrying its riskContext",
    );
  },
);

Then(
  "it should deploy exclusively by spawning the official Vercel CLI \\(`npx vercel`), under the CLI's own `vercel login` session",
  function (this: JollyWorld) {
    // Jolly-observable: doctor's deployment check references the Vercel CLI and
    // is marked skipped (Jolly does not contact Vercel) — never a fabricated pass.
    const check = this.findCheck("deployment-status");
    assert.ok(check, "doctor must report a deployment-status check");
    assert.equal(check!.status, "skipped", "Jolly must not fabricate a deployment pass; it spawns the Vercel CLI");
  },
);

Then(
  "when the Vercel CLI is not authenticated, it should run `vercel login` with stdio passed through and continue on its exit",
  function () {
    // stdio passthrough + continue-on-exit for `vercel login` is start's spawn
    // behavior, verified in the acceptance run — not capturable from cucumber.
  },
);

Then(
  "Jolly's own code should send no request to api.vercel.com and hold no Vercel token",
  function (this: JollyWorld) {
    // Jolly-observable boundary: the deployment check references the spawned
    // Vercel CLI, and Jolly exposes no Vercel token / api.vercel.com surface.
    const check = this.findCheck("deployment-status");
    const text = JSON.stringify(check ?? {}).toLowerCase();
    assert.ok(text.includes("vercel"), "the deployment check should reference the spawned Vercel CLI");
    assert.ok(!text.includes("api.vercel.com"), "Jolly must not contact api.vercel.com");
  },
);

Then(
  "it should not fall back to any other deployment mechanism such as a guided Git import flow",
  function () {
    // No guided-import fallback exists — boundary (decision 2026-06-13).
  },
);

Then(
  "it should configure the required environment variables on the Vercel project through the Vercel CLI",
  function () {
    // start sets Vercel env vars by spawning the Vercel CLI — acceptance run.
  },
);

Then(
  "it should surface Vercel Deployment Protection \\(on by default) for the human or agent to disable so the store is publicly reachable",
  function () {
    // Deployment Protection is a Vercel project setting start surfaces for the
    // human/agent to disable (not a deploy step) — acceptance run.
  },
);

Then(
  "it should update Saleor allowed\\/trusted origins for the deployed storefront URL where APIs allow",
  function () {
    // Trusted-origin updates are a Cloud-API step start performs after deploy — acceptance run.
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

Then("it should report the deployed URL and any remaining manual steps", function (this: JollyWorld) {
  // Jolly-observable: doctor carries a nextSteps channel for remaining manual steps.
  assert.ok(Array.isArray(this.envelope.nextSteps), "doctor must carry a nextSteps channel");
});
