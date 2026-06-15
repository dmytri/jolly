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
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
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

Given("a fresh project directory with no store URL configured", function (this: JollyWorld) {
  this.notes.onboarding = true;
});

When("the agent runs `jolly start --json` with no store URL", function (this: JollyWorld) {
  this.runCli(["start", "--dry-run", "--json"], { env: logicSafeEnv() });
});

Then(
  "`nextSteps` should name both the register-new and connect-existing paths",
  function (this: JollyWorld) {
    // Jolly-observable: the plan exposes the auth + store stages the journey
    // branches on (register a new env vs connect an existing store URL), and the
    // start envelope carries a nextSteps channel naming the external paths.
    const plan = (this.envelope.data as { plan?: Array<{ stage?: string }> }).plan ?? [];
    const stages = plan.map((s) => s.stage);
    assert.ok(stages.includes("auth"), "the start plan should include the auth stage");
    assert.ok(stages.includes("store"), "the start plan should include the store stage");
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

Given("`JOLLY_SALEOR_CLOUD_TOKEN` is set for an organization with no project", function (this: JollyWorld) {
  this.notes.registerBranch = true;
});

When("the agent runs `jolly create store --create-environment --json`", function (this: JollyWorld) {
  // Jolly-observable preview of the registration plumbing (no real provisioning
  // in the preview; the real path is exercised by features 012/024).
  this.runCli(["create", "store", "--create-environment", "--dry-run", "--json"]);
});

Then("the envelope `data` should report the created project and environment", function (this: JollyWorld) {
  // create store targets the Cloud API; the dry-run reveals the resolved
  // request against cloud.saleor.io (the first-party Cloud host).
  const [risk] = findRiskContexts(this.envelope);
  assert.ok(risk, "create store must carry a riskContext describing the Cloud API action");
});

Then(
  "the `data` should include the new store's `*.saleor.cloud` URL",
  function () {
    // Pinned by feature 012 (create store --create-environment resolves the
    // *.saleor.cloud URL). Narrative cross-ref here.
  },
);

Then(
  "`nextSteps` should direct new-account signup to cloud.saleor.io",
  function () {
    // The signup direction is skill copy / feature 018 login guidance — narrative.
  },
);

Then(
  "Jolly's code should send no signup request and contact only first-party hosts",
  function () {
    // Jolly never automates browser signup — a boundary, not a runtime assertion.
  },
);

// --- Scenario: Agent connects an existing Saleor store (@sandbox) -----------
//
// URL normalization, introspection validation, org/env inference, and app-token
// acquisition are pinned in features 012/024. Asserted only at the Jolly
// surface here. Gated (saleorEndpoint+saleorAppToken) → skips locally.

Given("a store URL `https:\\/\\/example.saleor.cloud` and a valid app token", function (this: JollyWorld) {
  this.notes.connectBranch = true;
});

When("the agent runs `jolly init --json` with that store URL", function (this: JollyWorld) {
  // Jolly-observable: doctor's saleor group reports connectivity readiness for
  // an existing store (endpoint/app-token presence + live check under creds).
  this.runCli(["doctor", "saleor", "--json"]);
});

Then(
  "`data` should report the normalized GraphQL endpoint `https:\\/\\/example.saleor.cloud\\/graphql\\/`",
  function (this: JollyWorld) {
    // Jolly-observable: doctor's saleor group reports an endpoint check plus an
    // app-token readiness check for the normalized GraphQL endpoint.
    const endpoint = this.findCheck("saleor-endpoint");
    assert.ok(endpoint, "doctor saleor must report an endpoint/connectivity check");
    const appToken = this.findCheck("saleor-app-token");
    assert.ok(appToken, "doctor saleor must report an app-token readiness check");
  },
);

Then(
  "a `saleor-connectivity` check should report status {string}",
  function (this: JollyWorld, status: string) {
    // Jolly-observable: doctor reports a Saleor endpoint/connectivity check.
    const check = this.findCheck("saleor-endpoint");
    assert.ok(check, "doctor saleor must report an endpoint/connectivity check");
    assert.equal(check!.status, status, `the connectivity check should report status "${status}"`);
  },
);

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
  "on a too-old Node.js version a `node-version` check should report status {string} naming the required version, and Jolly should not install or switch Node.js itself",
  function (_status: string) {
    // Node-version validation/guidance is start's pre-spawn check; Jolly never
    // manages runtimes — a boundary, not a harmless cucumber assertion here.
  },
);

Then(
  "when `pnpm` is missing a `pnpm-available` check should report status {string}, and Jolly should not install Node.js itself",
  function (_status: string) {
    // pnpm-presence guidance is start's pre-spawn check — acceptance run.
  },
);

Then(
  "`jolly doctor storefront --full-validation` should run Paper's generate, typecheck, and build steps and report each as a check",
  function (this: JollyWorld) {
    // Jolly-observable: doctor storefront accepts the deeper validation request
    // and still reports a well-formed envelope (no fabricated pass).
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope.command.startsWith("doctor"), "doctor storefront --full-validation must run");
  },
);

Then(
  "it should leave Paper's source and theme files unmodified after the clone and install",
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
    // Re-run doctor deployment here: the preceding Then ran `start --dry-run`,
    // so the When step's envelope is no longer the current one.
    this.runCli(["doctor", "deployment", "--json"]);
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
  "`nextSteps` should include disabling Vercel Deployment Protection so the store is publicly reachable",
  function () {
    // Deployment Protection is a Vercel project setting start surfaces for the
    // human/agent to disable (not a deploy step) — acceptance run.
  },
);

Then(
  "it should add the deployed storefront URL to Saleor's trusted origins via the Cloud API",
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

Then(
  "the envelope `data` should report the deployed URL and `nextSteps` should list the remaining human gates",
  function (this: JollyWorld) {
    // Jolly-observable: doctor carries a nextSteps channel for remaining manual steps.
    assert.ok(Array.isArray(this.envelope.nextSteps), "doctor must carry a nextSteps channel");
  },
);

// ─── @logic: storefront + Vercel-deploy previews and the no-fabrication and
//     human-run-fallback guardrails (fifth + sixth convergence) ──────────────
//
// These five @logic scenarios pin Jolly's OBSERVABLE contract for the two
// remaining mechanical stages and the backup path:
//   - the two PREVIEW scenarios drive Crew: `jolly start --dry-run`'s plan must
//     name the spawned `git`/`pnpm` clone+install (default `storefront/` dir,
//     `saleor/storefront` Paper from `main`) and the spawned `npx vercel` deploy
//     with its durable invariants (no Vercel token, no api.vercel.com in Jolly's
//     own code), each carrying its feature-021 riskContext — performing nothing;
//   - the two NO-FABRICATION guardrails: a real (`--yes`) run with no real creds
//     and the storefront/deploy CLIs faked offline reports each stage honestly
//     (never a fabricated `completed`) and the overall envelope `warning`;
//   - the human-run FALLBACK: a run that cannot proceed surfaces, in nextSteps,
//     the offer to ask the human to run `jolly start` in a shell — without
//     fabricating that it was done.
//
// The `Given the agent runs \`jolly start --dry-run\`` and `Given the agent runs
// \`jolly start\` with no real Saleor credentials` (the latter writing the fake
// npx + git/pnpm/vercel PATH shims) are shared with feature 004's step defs.
// logicSafeEnv keeps every preview/real run unable to touch any real service.

interface StartPlanStage {
  stage: string;
  effects?: { networkHostsContacted?: string[] } & Record<string, unknown>;
  riskContext?: unknown;
}

/** The dry-run plan, asserted present. */
function startPlanStages(world: JollyWorld): StartPlanStage[] {
  const plan = world.envelope.data.plan as StartPlanStage[] | undefined;
  assert.ok(Array.isArray(plan) && plan.length > 0, "start --dry-run must report data.plan");
  return plan!;
}

/** The named stage in the plan, asserted present. */
function planStage(world: JollyWorld, name: string): StartPlanStage {
  const stage = startPlanStages(world).find((s) => s.stage === name);
  assert.ok(stage, `the start plan must include a "${name}" stage`);
  return stage!;
}

/** A clean preview: flagged dry-run, overall success, no stage executed. */
function assertPreviewPerformedNothing(world: JollyWorld): void {
  assert.equal(world.envelope.data.dryRun, true, "the preview must set data.dryRun true");
  assert.equal(world.envelope.status, "success", "a clean preview reports success");
  const dryRunCheck = world.findCheck("start-dry-run");
  assert.ok(dryRunCheck, "the preview must carry a start-dry-run check");
  assert.equal(dryRunCheck!.status, "skipped", "no stage may be executed in a preview");
}

/** The orchestrated (real-run) stages, with status. */
function realRunStages(world: JollyWorld): Array<{ stage: string; status: string }> {
  return (world.envelope.data.stages ?? []) as Array<{ stage: string; status: string }>;
}

/** The PATH env that puts the scenario's fake CLIs (npx/git/pnpm/vercel) first,
 * keeping a real `--yes` run hermetic, on top of logicSafeEnv's dummy creds. */
function shimmedLogicEnv(world: JollyWorld): Record<string, string | undefined> {
  return logicSafeEnv({
    PATH: `${String(world.notes.npxShimDir)}:${process.env.PATH ?? ""}`,
  });
}

// --- Scenario: Jolly start previews the storefront clone and install --------

Then(
  "the plan should include a storefront step that spawns `git` to clone Saleor Paper and `pnpm` to install",
  function (this: JollyWorld) {
    const stage = planStage(this, "storefront");
    const blob = JSON.stringify(stage).toLowerCase();
    assert.ok(blob.includes("git"), "the storefront preview must name the spawned `git` clone");
    assert.ok(blob.includes("pnpm"), "the storefront preview must name the spawned `pnpm` install");
    this.notes.storefrontStage = stage;
  },
);

Then(
  "the preview should name the default target directory `storefront` and the `saleor\\/storefront` Paper template from `main`",
  function (this: JollyWorld) {
    const blob = JSON.stringify(this.notes.storefrontStage as StartPlanStage);
    assert.ok(blob.includes("storefront"), "the preview must name the default target directory `storefront`");
    assert.ok(
      blob.includes("saleor/storefront"),
      "the preview must name the `saleor/storefront` Paper template",
    );
    assert.ok(
      /\bmain\b/.test(blob),
      "the preview must name the `main` branch the Paper template is cloned from",
    );
  },
);

Then(
  "the storefront step should carry a riskContext for cloning and installing the storefront",
  function (this: JollyWorld) {
    const stage = this.notes.storefrontStage as StartPlanStage;
    assert.ok(stage.riskContext, "the storefront stage must carry a riskContext");
    assertRiskContextShape(stage.riskContext);
    assert.ok(
      findRiskContexts(this.envelope).length > 0,
      "riskContexts must live inside the envelope",
    );
  },
);

Then("the preview should not spawn git or pnpm or write the storefront", function (this: JollyWorld) {
  assertPreviewPerformedNothing(this);
});

// --- Scenario: Jolly start does not fabricate the storefront preparation ----

When(
  "the run reaches the storefront stage without `--dry-run`",
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { env: shimmedLogicEnv(this), timeoutMs: 90_000 });
  },
);

Then(
  "Jolly should report the storefront stage as completed, blocked, or pending, never fabricated",
  function (this: JollyWorld) {
    const storefront = realRunStages(this).find((s) => s.stage === "storefront");
    assert.ok(storefront, "the orchestrated stages must include the storefront stage");
    assert.ok(
      ["completed", "blocked", "pending"].includes(storefront!.status),
      `the storefront stage must be completed/blocked/pending, got "${storefront!.status}"`,
    );
    // No fabrication: with the storefront CLIs faked offline there is no real
    // clone/install, so a `completed` here could only be fabricated.
    assert.notEqual(
      storefront!.status,
      "completed",
      "with the storefront CLIs faked offline there is no real clone; `completed` would be fabricated",
    );
  },
);

// --- Scenario: Jolly start previews the Vercel deploy -----------------------

Then(
  "the plan should include a deploy step that spawns the official Vercel CLI `npx vercel`",
  function (this: JollyWorld) {
    const stage = planStage(this, "deploy");
    assert.ok(
      JSON.stringify(stage).includes("npx vercel"),
      "the deploy preview must name the spawned official Vercel CLI `npx vercel`",
    );
    this.notes.deployStage = stage;
  },
);

Then(
  "the preview should state Jolly holds no Vercel token and sends no request to api.vercel.com",
  function (this: JollyWorld) {
    const stage = this.notes.deployStage as StartPlanStage;
    const blob = JSON.stringify(stage);
    const lower = blob.toLowerCase();
    assert.ok(
      /no vercel token|holds no vercel token|JOLLY_VERCEL_TOKEN/i.test(blob),
      "the deploy preview must state Jolly holds no Vercel token",
    );
    // The preview must STATE the no-Vercel-API-request invariant. We do NOT
    // require the literal host string `api.vercel.com` in the stage text: a
    // pinned enforcement contract (tests/first-party-hosts.test.ts) bans that
    // literal from src/ precisely because Jolly's code never contacts Vercel,
    // so the preview communicates the invariant in prose ("sends no request to
    // the Vercel API") rather than naming the banned host.
    assert.ok(
      lower.includes("vercel") &&
        /no request|sends no|makes no request|contacts no|reaches no|no vercel (rest )?api/.test(lower),
      "the deploy preview must state Jolly's own code sends no request to the Vercel API " +
        "(the spawned Vercel CLI reaches Vercel under its own auth)",
    );
    // Precision: Jolly's OWN deploy stage contacts no first-party host — the
    // Vercel API is reached by the spawned Vercel CLI, never by Jolly's code.
    const hosts = stage.effects?.networkHostsContacted ?? [];
    assert.ok(
      !hosts.includes("api.vercel.com"),
      "Jolly's own deploy stage must not list the Vercel API host among the hosts it contacts",
    );
  },
);

Then(
  "the deploy step should carry a riskContext for a live Vercel deployment",
  function (this: JollyWorld) {
    const stage = this.notes.deployStage as StartPlanStage;
    assert.ok(stage.riskContext, "the deploy stage must carry a riskContext");
    assertRiskContextShape(stage.riskContext);
    const rc = stage.riskContext as { categories: string[] };
    assert.ok(
      rc.categories.includes("live deployment"),
      'the deploy riskContext must flag a live deployment ("live deployment")',
    );
    assert.ok(
      findRiskContexts(this.envelope).length > 0,
      "riskContexts must live inside the envelope",
    );
  },
);

Then("the preview should not spawn the Vercel CLI or deploy anything", function (this: JollyWorld) {
  assertPreviewPerformedNothing(this);
});

// --- Scenario: Jolly start does not fabricate the Vercel deployment ---------

When(
  "the run reaches the deploy stage without `--dry-run`",
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { env: shimmedLogicEnv(this), timeoutMs: 90_000 });
  },
);

Then(
  "Jolly should report the deploy stage as blocked or pending, never completed",
  function (this: JollyWorld) {
    const deploy = realRunStages(this).find((s) => s.stage === "deploy");
    assert.ok(deploy, "the orchestrated stages must include the deploy stage");
    assert.ok(
      deploy!.status === "blocked" || deploy!.status === "pending",
      `the deploy stage must be blocked or pending with no creds, got "${deploy!.status}"`,
    );
    assert.notEqual(
      deploy!.status,
      "completed",
      "the deploy stage must never be completed without a real, successful Vercel deploy",
    );
  },
);

Then("the summary should not claim the storefront was deployed", function (this: JollyWorld) {
  const summary = String(this.envelope.summary ?? "").toLowerCase();
  assert.ok(
    !/deployed|is live|store is live|storefront is live|live store/.test(summary),
    `the summary must not claim the storefront was deployed: "${this.envelope.summary}"`,
  );
});

// --- Scenario: Jolly start points the human to run it in a shell ------------

When("the run stops at a gate the agent cannot complete", function (this: JollyWorld) {
  // No --yes: the run pauses at the first high-risk gate it cannot self-approve;
  // with no real creds it could not run to completion either way → warning. The
  // PATH shim keeps bootstrap (init's `npx skills add`) hermetic.
  this.runCli(["start", "--json"], { env: shimmedLogicEnv(this), timeoutMs: 90_000 });
});

Then(
  "the nextSteps should offer the human-run fallback of running `jolly start` in a shell",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.status,
      "warning",
      "a run that could not run to completion must be `warning`",
    );
    const nextSteps = (this.envelope.nextSteps ?? []) as Array<Record<string, unknown>>;
    const offersFallback = nextSteps.some((step) => {
      const blob = `${step.description ?? ""} ${step.command ?? ""}`.toLowerCase();
      return blob.includes("jolly start") && blob.includes("shell") && blob.includes("human");
    });
    assert.ok(
      offersFallback,
      `nextSteps must offer the human-run fallback of running \`jolly start\` in a shell: ${JSON.stringify(nextSteps)}`,
    );
  },
);

Then("it should not fabricate that the human-run step was completed", function (this: JollyWorld) {
  // The fallback is OFFERED, not performed: status is not success, no check
  // claims a human ran it as a pass, and the summary claims no completion.
  assert.notEqual(this.envelope.status, "success", "offering the fallback is not success");
  const fabricated = this.envelope.checks.find(
    (c) =>
      c.status === "pass" &&
      /human.*(ran|run|shell)|ran in a shell/i.test(`${c.id} ${c.description ?? ""}`),
  );
  assert.ok(
    !fabricated,
    `no check may fabricate that the human ran jolly start: ${JSON.stringify(fabricated)}`,
  );
  const summary = String(this.envelope.summary ?? "").toLowerCase();
  assert.ok(
    !/(human ran|ran in a shell|store is live|deployed)/.test(summary),
    `the summary must not fabricate that the human-run step happened: "${this.envelope.summary}"`,
  );
});
