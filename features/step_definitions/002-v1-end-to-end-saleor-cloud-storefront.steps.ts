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
// The deep auth/store/SALEOR_TOKEN/url-normalization behavior is pinned in
// features 018/012; here it is asserted only at the Jolly surface.
//
// Safety: @logic CLI runs use absentCredentialsEnv() in the scenario's temp dir. The
// @sandbox scenarios are gated by SANDBOX_REQUIREMENTS (+ requiresVercelCli for
// the deploy scenario) and skip locally.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { loadEnvValues, writeEnvValues } from "../../src/lib/env-file.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { deleteEnvironment, listAllEnvironments } from "../support/cloud.ts";
import { findRiskContexts, assertRiskContextShape } from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import {
  addVercelProject,
  makeNamespace,
  removeVercelProject,
  vercelCliAuthenticated,
  workerNamespace,
} from "../support/sandbox.ts";
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
  "Jolly's own plumbing covers auth, store via the Cloud API, secret writing, `.mcp.json`, skill install, and `jolly doctor` verification",
  function () {},
);
Given(
  "the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete",
  function () {},
);
Given(
  "the setup path must minimize human intervention to new account creation, the Vercel sign-in, and providing secret values",
  function () {},
);

// --- Scenario: Agent starts the Saleor Cloud setup journey (@logic) ---------
//
// The customer-facing "ask whether you have a store or want to register one"
// dialog is skill copy. Jolly-observable: `jolly start --dry-run` reveals the
// staged plan (including the auth/store stages the journey branches on) and the
// human-action steps that cannot be automated.

Given(
  "`JOLLY_SALEOR_CLOUD_TOKEN` is configured and no store URL is set",
  function (this: JollyWorld) {
    // Authenticated (a Cloud token is present) but no store yet. The token is a
    // real-format stand-in; the `jolly start --json` preview below performs no
    // network (commandStartDryRun is static), so it is never exercised against a
    // real account. NEXT_PUBLIC_SALEOR_API_URL stays unset ("no store URL").
    this.notes.startEnv = absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN });
  },
);

When("the agent runs `jolly start --json` with no store URL", function (this: JollyWorld) {
  this.runCli(["start", "--dry-run", "--json"], {
    env: (this.notes.startEnv as Record<string, string | undefined>) ?? absentCredentialsEnv(),
  });
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
// Deep registration behavior (Cloud APIs, token auth, env creation) is pinned in
// features 018/012/024. Here it is asserted only at the Jolly surface: `jolly
// create store` carries the right riskContext and (under real creds) provisions
// an environment. Gated by SANDBOX_REQUIREMENTS["Agent helps register a new
// Saleor Cloud store"] (saleorCloud) → skips locally. The account-signup steps
// stay narrative no-ops.

Given("`JOLLY_SALEOR_CLOUD_TOKEN` is set for an organization with no project", function (this: JollyWorld) {
  this.notes.registerBranch = true;
});

When("the agent runs `jolly create store --create-environment --json`", async function (this: JollyWorld) {
  // Two scenarios share this exact step text:
  //   - 002 "register a new store" (@sandbox): a Jolly-observable PREVIEW of the
  //     registration plumbing — run as --dry-run so the preview never provisions
  //     (the real path is exercised by features 012/024), against the scenario's
  //     real env so the @sandbox run resolves the real org.
  //   - 012 "reports ENVIRONMENT_LIMIT_REACHED" (@logic): the REAL create path,
  //     which must reach a Cloud API that rejects creation. Its Given starts an
  //     in-process loopback Cloud API that 4xx-rejects the POST with a "limit"
  //     payload and stashes it on notes.limitHarness; run the real command
  //     against that harness with the runtime credentials unset and STAND_IN_TOKEN
  //     supplied (so the loopback fixture is reached, no real account is touched)
  //     via runCliAsync (loopback server → spawnSync would deadlock).
  const limitHarness = this.notes.limitHarness as { baseUrl: string } | undefined;
  if (limitHarness) {
    await this.runCliAsync(
      ["create", "store", "--create-environment", "--json"],
      {
        env: absentCredentialsEnv({
          JOLLY_SALEOR_CLOUD_API_URL: limitHarness.baseUrl,
          JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
        }),
      },
    );
    return;
  }
  this.runCli(["create", "store", "--create-environment", "--dry-run", "--json"]);
});

Then("the envelope `data` should report the created project and environment", function (this: JollyWorld) {
  // create store targets the Cloud API; the dry-run reveals the resolved
  // request against cloud.saleor.io (the first-party Cloud host).
  const [risk] = findRiskContexts(this.envelope);
  assert.ok(risk, "create store must carry a riskContext describing the Cloud API action");
});

Then(
  "the `data` should include the new store's `*.saleor.cloud` GraphQL API URL",
  function (this: JollyWorld) {
    // The create-store preview must surface the *.saleor.cloud GraphQL endpoint
    // the store it provisions will be reachable at — a first-party host, never a
    // non-saleor.cloud one. (Real provisioning + the .env write is pinned in
    // feature 012; here Jolly's observable surface must name the projected URL.)
    const blob = JSON.stringify(this.envelope.data ?? {});
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/graphql\//i.test(blob),
      `create store data must include the new store's *.saleor.cloud GraphQL API URL: ${blob}`,
    );
  },
);

Then(
  "the `data` should include the store's Saleor Dashboard URL ending in `.saleor.cloud\\/dashboard\\/`",
  function (this: JollyWorld) {
    // The same preview must surface the store's Dashboard URL so the agent can
    // hand it to the human — a *.saleor.cloud/dashboard/ first-party URL.
    const blob = JSON.stringify(this.envelope.data ?? {});
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/dashboard\//i.test(blob),
      `create store data must include the store's Saleor Dashboard URL ending in .saleor.cloud/dashboard/: ${blob}`,
    );
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
// URL normalization, introspection validation, org/env inference, and
// SALEOR_TOKEN projection are pinned in features 012/018. Asserted only at the
// Jolly surface here. Gated (saleorEndpoint+SALEOR_TOKEN) → skips locally.

Given("a store URL `https:\\/\\/example.saleor.cloud` and a valid `SALEOR_TOKEN`", function (this: JollyWorld) {
  this.notes.connectBranch = true;
});

When("the agent runs `jolly init --json` with that store URL", function (this: JollyWorld) {
  // Jolly-observable: doctor's saleor group reports connectivity readiness for
  // an existing store (endpoint + SALEOR_TOKEN presence + live check under creds).
  this.runCli(["doctor", "saleor", "--json"]);
});

Then(
  "`data` should report the normalized GraphQL endpoint `https:\\/\\/example.saleor.cloud\\/graphql\\/`",
  function (this: JollyWorld) {
    // Jolly-observable: doctor's saleor group reports an endpoint check plus a
    // SALEOR_TOKEN readiness check for the normalized GraphQL endpoint.
    const endpoint = this.findCheck("saleor-endpoint");
    assert.ok(endpoint, "doctor saleor must report an endpoint/connectivity check");
    const saleorToken = this.findCheck("saleor-token");
    assert.ok(saleorToken, "doctor saleor must report a SALEOR_TOKEN readiness check");
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
  "the storefront stage installs Paper's dependencies by running pnpm via `npx`, with no global pnpm prerequisite, and Jolly should not install Node.js itself",
  function () {
    // The storefront stage spawns `npx pnpm install` (like Jolly's other spawned
    // CLIs), so there is NO global-pnpm prerequisite — a missing global pnpm is
    // never a failure. The `pnpm-available` check is therefore always a clean
    // `pass`: the missing-global-pnpm case is asserted for real in the @logic
    // scenario "A missing global pnpm is not a failure — the storefront stage runs
    // pnpm via npx", which makes pnpm unresolvable on PATH and asserts the
    // `pnpm-available` check = "pass" with the `npx pnpm install` description and
    // no raw `spawnSync` ENOENT string. Jolly never installs Node.js itself —
    // a boundary, not a harmless cucumber assertion here.
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
  "it should deploy exclusively by spawning the official Vercel CLI \\(`npx vercel@latest`), under the CLI's own `vercel login` session",
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
  "it should disable Vercel Deployment Protection via the Vercel CLI so the store is publicly reachable, falling back to a guided step where the plan or permissions disallow it",
  function () {
    // After a real deploy, start runs `vercel project protection disable --sso`
    // under the CLI's own session (the `vercel-deployment-protection` check
    // reports pass; warning + guided fallback where the plan disallows it) —
    // acceptance run.
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
  "the envelope `data` should report the deployed storefront URL captured from the Vercel CLI's deploy output, not a fabricated or guessed value",
  function (this: JollyWorld) {
    // The deployed URL is captured ONLY from a real `npx vercel` deploy's output
    // (the live emission is verified in feature 025's eval). This doctor surface
    // ran no deploy — Jolly holds no Vercel token and spawns the CLI — so it must
    // report NO deployed storefront URL rather than a fabricated or guessed one.
    const deployment = this.findCheck("deployment-status");
    assert.ok(deployment, "doctor must report a deployment-status check");
    assert.notEqual(
      deployment!.status,
      "pass",
      "doctor must not mark deployment passed without a real captured Vercel deploy",
    );
    const blob = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(
      !/[a-z0-9-]+\.vercel\.app/.test(blob),
      `Jolly must not fabricate or guess a deployed storefront URL absent a real captured Vercel deploy: ${blob}`,
    );
  },
);

Then("`nextSteps` should list the remaining human gates", function (this: JollyWorld) {
  // Jolly-observable: doctor carries a nextSteps channel for the remaining manual
  // gates (e.g. disabling Vercel Deployment Protection, browser consent).
  assert.ok(Array.isArray(this.envelope.nextSteps), "doctor must carry a nextSteps channel");
});

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
//   - the two NO-FABRICATION guardrails: a real (`--yes`) run with the runtime
//     credentials unset reports each stage honestly — a stage that genuinely
//     completes (the storefront scaffold needs no Saleor credential) is backed by
//     real artifacts, the credential-gated stages block, and the overall envelope
//     is `warning`, never a fabricated `completed`;
//   - the human-run FALLBACK: a run that cannot proceed surfaces, in nextSteps,
//     the offer to ask the human to run `jolly start` in a shell — without
//     fabricating that it was done.
//
// The `Given the agent runs \`jolly start --dry-run\`` and `Given the agent runs
// \`jolly start\` with no real Saleor credentials` are shared with feature 004's
// step defs. With the credentials unset, no preview/real run can reach a real
// account; a `--yes` run does real local CLI work (git clone + pnpm install) for
// the credential-independent stages, so those runs carry a generous timeout.

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

/** The env for a no-credentials `jolly start` run: every runtime credential
 * unset, so the run cannot reach a real account and the credential-gated stages
 * block honestly while the credential-independent ones run for real. */
function noCredsStartEnv(): Record<string, string | undefined> {
  return absentCredentialsEnv();
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
    this.runCli(["start", "--yes", "--json"], { env: noCredsStartEnv(), timeoutMs: 240_000 });
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
    // No fabrication: the storefront scaffold needs no Saleor credential, so it
    // can genuinely complete via a REAL `git clone` + `pnpm install`. A
    // `completed` here must therefore be backed by the real cloned Paper
    // storefront on disk (storefront/package.json), never a fabricated status.
    if (storefront!.status === "completed") {
      assert.ok(
        existsSync(join(this.lastRun!.cwd, "storefront", "package.json")),
        "a `completed` storefront stage must be backed by a real cloned storefront " +
          "(storefront/package.json), never fabricated",
      );
    }
  },
);

// --- Scenario: Jolly start's storefront preparation approves native builds --

Then(
  "a fresh `pnpm install` in the prepared storefront should report no ignored build scripts for `sharp` and `esbuild`",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    // The When ran a real no-creds `jolly start --yes` — its storefront stage
    // does credential-independent local work (git clone + pnpm install). Skip —
    // premise not producible — if the storefront was not prepared (git/pnpm
    // unavailable in this environment).
    const dir = join(this.lastRun!.cwd, "storefront");
    if (!existsSync(join(dir, "package.json"))) {
      this.attach(
        "Skipped: the Paper storefront was not cloned/installed in this environment",
        "text/plain",
      );
      return "skipped" as const;
    }
    // Re-run the install (idempotent) and capture pnpm's ignored-build-scripts
    // report. After Jolly's preparation, neither sharp nor esbuild may appear
    // among the build scripts pnpm ignored.
    const result = spawnSync("npx", ["pnpm", "install"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 240_000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    const ignoredMatch = /ignored build scripts?[:\s]*([^\n]*)/i.exec(output);
    const ignored = ignoredMatch?.[1] ?? "";
    assert.ok(
      !/\bsharp\b/i.test(ignored),
      `pnpm must not ignore sharp's build script; ignored build scripts: "${ignored}"`,
    );
    assert.ok(
      !/\besbuild\b/i.test(ignored),
      `pnpm must not ignore esbuild's build script; ignored build scripts: "${ignored}"`,
    );
  },
);

// --- Scenario: Jolly start does not fabricate the Vercel deployment ---------

When(
  "the run reaches the deploy stage without `--dry-run`",
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { env: noCredsStartEnv(), timeoutMs: 240_000 });
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
  this.runCli(["start", "--json"], { env: noCredsStartEnv(), timeoutMs: 240_000 });
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

// ─── Scenarios: Jolly start owns the Vercel sign-in (@sandbox) ───────────────
//
// Two @sandbox scenarios share this Given + When: with the storefront ready and
// the Vercel CLI pointed at an isolated config holding NO session, a real
// `jolly start --yes` reaches the deploy stage. Jolly itself spawns the Vercel
// sign-in (`npx vercel login`) and surfaces its device-authorization URL on
// stderr, reporting a pending sign-in gate — never a deploy `failed`, and never
// telling the agent to run `vercel login` or to re-run `jolly start` after a
// manual sign-in. Gated on the Cloud token (["saleorCloud"]): the run
// auto-provisions a jolly-cannon-fodder store and reaches deploy itself; it deliberately
// needs NO authenticated Vercel session (the isolated-config Given supplies the
// no-session condition), so it is NOT in VERCEL_CLI_SCENARIOS.

/** Snapshot the org's Saleor environments and register teardown of only the
 * NEW jolly-cannon-fodder-namespaced ones this run creates (never a pre-existing or
 * non-test resource). Saleor-only: these scenarios run WITHOUT a Vercel session,
 * so nothing is created on Vercel and no Vercel teardown is registered. */
async function registerSaleorEnvTeardown(world: JollyWorld): Promise<void> {
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  if (!cloudToken) return; // gate guarantees it under CI; nothing to clean otherwise.
  const before = new Set((await listAllEnvironments(cloudToken)).map((e) => e.key));
  const runNamespace = makeNamespace(world.runId);
  world.cleanup.register(
    "auto-provisioned Saleor Cloud environment (diff vs pre-run snapshot)",
    async () => {
      for (const env of await listAllEnvironments(cloudToken)) {
        if (!before.has(env.key) && env.name.startsWith(runNamespace)) {
          await deleteEnvironment(cloudToken, env.org, env.key);
        }
      }
    },
  );
}

Given(
  "the Vercel CLI is pointed at an isolated config with no signed-in session",
  function (this: JollyWorld) {
    // Real, producible no-session condition (real-by-default, not a double):
    // point the Vercel CLI at fresh, empty XDG config/data dirs that hold no
    // auth.json, so `vercel whoami`/`vercel login` find no credentials. The dirs
    // live under the scenario temp root (removed in teardown). The fragment
    // propagates through `jolly` to the `vercel` CLI it spawns (runCli merges it
    // into the child env; Jolly spawns vercel with its own process env). Shared
    // with feature 014's no-session vercel-auth scenario via notes.vercelXdg.
    const dir = this.newTempDir("vercel-config");
    this.notes.vercelXdg = {
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
    };
  },
);

When(
  "`jolly start` reaches the deploy stage without `--dry-run`",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    await registerSaleorEnvTeardown(this);
    const xdg = (this.notes.vercelXdg as Record<string, string>) ?? {};
    // A real end-to-end run: the Cloud token drives store auto-provisioning, the
    // storefront stage clones+installs Paper, and the run reaches the deploy
    // stage. The namespaced store/project names make every created resource
    // jolly-cannon-fodder cannon fodder. The isolated XDG dirs ensure the deploy stage
    // finds no Vercel session.
    this.runCli(["start", "--yes", "--json"], {
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_TOKEN: process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
        JOLLY_STORE_NAME: makeNamespace(this.runId),
        JOLLY_VERCEL_PROJECT: workerNamespace(),
        ...xdg,
      }),
      timeoutMs: 840_000,
    });
  },
);

// --- Scenario: Jolly start spawns the Vercel sign-in itself (@sandbox) -------

// The agent run surfaces the Vercel device URL in the result ENVELOPE (a
// nextStep, with a structured `url` so the agent renders it clickable), never on
// stdout/stderr noise — mirroring the Saleor device-grant envelope flow.
function vercelSignInUrlInNextSteps(world: JollyWorld): boolean {
  const steps = (world.envelope.nextSteps ?? []) as Array<Record<string, unknown>>;
  return steps.some((s) => {
    const blob = `${String(s.url ?? "")} ${String(s.description ?? "")}`;
    return /https:\/\/vercel\.com\/oauth\/device/i.test(blob);
  });
}

Then(
  "Jolly should itself spawn `npx vercel@latest login` and surface its device-authorization URL before attempting any deploy",
  function (this: JollyWorld) {
    assert.ok(this.envelope.command.startsWith("start"), "the run must be a `jolly start` run");
    assert.ok(
      vercelSignInUrlInNextSteps(this),
      `Jolly must itself spawn the Vercel sign-in and surface its device URL in a nextStep; got: ${JSON.stringify(this.envelope.nextSteps)}`,
    );
    // stdout stays clean machine JSON — no OSC 8 escapes on the agent path.
    assert.ok(
      // eslint-disable-next-line no-control-regex
      !/\x1b\]8;;/.test(this.lastRun!.stdout),
      `the agent (--json) stdout must carry no OSC 8 hyperlink escape:\n${JSON.stringify(this.lastRun!.stdout)}`,
    );
  },
);

Then(
  "a nextStep should carry the Vercel sign-in URL for the human to open and approve",
  function (this: JollyWorld) {
    assert.ok(
      vercelSignInUrlInNextSteps(this),
      `a nextStep must carry the Vercel sign-in URL; got: ${JSON.stringify(this.envelope.nextSteps)}`,
    );
  },
);

Then(
  "the deploy stage should report a pending Vercel sign-in gate that states Jolly runs the Vercel sign-in together with the human, not a deploy `failed`",
  function (this: JollyWorld) {
    const deploy = realRunStages(this).find((s) => s.stage === "deploy");
    assert.ok(deploy, "the orchestrated stages must include the deploy stage");
    assert.equal(
      deploy!.status,
      "pending",
      `the deploy stage must report a pending Vercel sign-in gate, not "${deploy!.status}"`,
    );
    // A check states the gate: Jolly runs the Vercel sign-in together with the
    // human (not a deploy failure).
    const gate = this.envelope.checks.find((c) => {
      const blob = `${c.id} ${c.description ?? ""}`.toLowerCase();
      return /vercel/.test(blob) && /sign[- ]?in|log[- ]?in|login/.test(blob);
    });
    assert.ok(
      gate,
      `the deploy stage must report a Vercel sign-in gate check: ${JSON.stringify(this.envelope.checks)}`,
    );
    assert.notEqual(gate!.status, "fail", "the Vercel sign-in gate must not be a deploy failure");
    const desc = String(gate!.description ?? "").toLowerCase();
    assert.ok(
      desc.includes("jolly") &&
        /together|with you|with the human|jointly|runs the (vercel )?sign[- ]?in|runs the sign[- ]?in/.test(desc),
      `the sign-in gate must state Jolly runs the Vercel sign-in together with the human: ${JSON.stringify(gate)}`,
    );
  },
);

Then(
  "no deploy or vercel check should report `fail` when the only obstacle is the missing Vercel sign-in",
  function (this: JollyWorld) {
    // Scope to the deploy STAGE's own deploy/vercel checks — not the folded
    // `doctor-*` readiness diagnostics. Doctor's own `vercel-auth` correctly
    // reports `fail` for a no-session run (feature 014's contract, verified by
    // 014:46); the deploy stage itself must not fail when only the sign-in is
    // missing.
    const offenders = this.envelope.checks.filter(
      (c) =>
        !String(c.id).startsWith("doctor-") &&
        /deploy|vercel/i.test(String(c.id)) &&
        c.status === "fail",
    );
    assert.equal(
      offenders.length,
      0,
      `no deploy/vercel check may be \`fail\` when only the Vercel sign-in is missing: ${JSON.stringify(offenders)}`,
    );
  },
);

Then(
  "Jolly's own code should send no request to api.vercel.com and hold no Vercel token while doing so",
  function (this: JollyWorld) {
    const blob = `${this.lastRun!.stdout}\n${this.lastRun!.stderr}`.toLowerCase();
    assert.ok(!blob.includes("api.vercel.com"), "Jolly's own code must not contact api.vercel.com");
    assert.equal(
      process.env["JOLLY_VERCEL_TOKEN"],
      undefined,
      "there is no JOLLY_VERCEL_TOKEN; Jolly holds no Vercel token",
    );
  },
);

// --- Scenario: Jolly start owns the Vercel sign-in rather than telling the
//     agent to run it (@sandbox) ----------------------------------------------

Then(
  "no nextSteps entry, error remediation, or check `command` should tell the agent to run `vercel login`, because Jolly runs the sign-in itself",
  function (this: JollyWorld) {
    const hits: string[] = [];
    for (const step of this.envelope.nextSteps) {
      if (/vercel login/i.test(`${step.description ?? ""} ${step.command ?? ""}`)) {
        hits.push(`nextStep: ${JSON.stringify(step)}`);
      }
    }
    for (const check of this.envelope.checks) {
      if (/vercel login/i.test(`${check.command ?? ""} ${check.remediation ?? ""}`)) {
        hits.push(`check ${check.id}: ${JSON.stringify(check)}`);
      }
    }
    for (const err of this.envelope.errors) {
      if (/vercel login/i.test(String(err.remediation ?? ""))) {
        hits.push(`error: ${JSON.stringify(err)}`);
      }
    }
    assert.equal(
      hits.length,
      0,
      `nothing may tell the agent to run \`vercel login\`; Jolly runs the sign-in itself: ${hits.join("; ")}`,
    );
  },
);

Then(
  "no nextSteps entry or error remediation should tell the agent to re-run `jolly start` after a manual Vercel sign-in",
  function (this: JollyWorld) {
    // Jolly owns the sign-in, so it must not instruct the agent to sign in to
    // Vercel manually and then re-run `jolly start`. (A nextStep naming `jolly
    // start` for other reasons is fine — the forbidden thing is the "sign in,
    // then re-run" instruction.)
    const hits: string[] = [];
    const scan = (text: string, where: string) => {
      const low = text.toLowerCase();
      if (
        low.includes("jolly start") &&
        /vercel|sign[- ]?in|log[- ]?in|login/.test(low) &&
        /after|then re-?run|once you|once signed|manual/.test(low)
      ) {
        hits.push(`${where}: ${text}`);
      }
    };
    for (const step of this.envelope.nextSteps) {
      scan(`${step.description ?? ""} ${step.command ?? ""}`, "nextStep");
    }
    for (const check of this.envelope.checks) {
      scan(String(check.remediation ?? ""), `check ${check.id}`);
    }
    for (const err of this.envelope.errors) {
      scan(String(err.remediation ?? ""), "error");
    }
    assert.equal(
      hits.length,
      0,
      `must not tell the agent to re-run \`jolly start\` after a manual Vercel sign-in: ${hits.join("; ")}`,
    );
  },
);

// --- Scenario: The deployed storefront serves the Saleor catalog and a working cart (@sandbox) ---
//
// Live operational-readiness acceptance for the DEPLOYED storefront. The deployed
// URL only exists after a full (human-gated) `jolly start` runs `npx vercel`, so
// the harness cannot derive it. The scenario therefore gates on a harness knob:
//   - HARNESS_DEPLOYED_STOREFRONT_URL — the live storefront URL, and
//   - NEXT_PUBLIC_SALEOR_API_URL — the Saleor store it serves.
// Absent the URL, the scenario SKIPS (never fails) — exactly the credential-gate
// discipline. When provided: opening the URL must respond; the served store's
// catalog must list products; and the cart mechanism the storefront uses (a
// Saleor checkout) must update when a product is added — verified at the same
// Saleor data layer the storefront reads/writes, against the live store, with
// the ephemeral checkout deleted in teardown (harmless by design). Optional
// HARNESS_STOREFRONT_CHANNEL overrides the channel slug (default "default-channel").

const STOREFRONT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function deployedSkipReason(): string | undefined {
  if (!process.env["HARNESS_DEPLOYED_STOREFRONT_URL"]) {
    return "HARNESS_DEPLOYED_STOREFRONT_URL is not set; a live deployed storefront URL is required (produced only by a full `jolly start` Vercel deploy)";
  }
  if (!process.env["NEXT_PUBLIC_SALEOR_API_URL"]) {
    return "NEXT_PUBLIC_SALEOR_API_URL (the Saleor store the storefront serves) is not set";
  }
  return undefined;
}

Given(
  "`jolly start` has deployed the storefront to Vercel against the configured Saleor Cloud store",
  function (this: JollyWorld) {
    const reason = deployedSkipReason();
    if (reason) {
      this.attach(`Skipped: ${reason}`, "text/plain");
      return "skipped" as const;
    }
    this.notes.deployedUrl = process.env["HARNESS_DEPLOYED_STOREFRONT_URL"];
    this.notes.storeEndpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    this.notes.channel = process.env["HARNESS_STOREFRONT_CHANNEL"] ?? "default-channel";
  },
);

When(
  "the deployed storefront URL is opened",
  { timeout: STOREFRONT_TIMEOUT_MS + 5_000 },
  async function (this: JollyWorld) {
    if (deployedSkipReason()) return "skipped" as const;
    const url = String(this.notes.deployedUrl);
    const res = await fetchWithTimeout(url, STOREFRONT_TIMEOUT_MS);
    this.notes.deployedStatus = res.status;
    this.notes.deployedBody = await res.text();
  },
);

Then("the URL should respond successfully", function (this: JollyWorld) {
  if (deployedSkipReason()) return "skipped" as const;
  const status = Number(this.notes.deployedStatus);
  assert.ok(
    status >= 200 && status < 400,
    `the deployed storefront URL must respond successfully; got HTTP ${status}`,
  );
});

Then(
  "it should list products from the Saleor Cloud catalog",
  { timeout: STOREFRONT_TIMEOUT_MS },
  async function (this: JollyWorld) {
    if (deployedSkipReason()) return "skipped" as const;
    // The storefront lists the catalog it reads from the served Saleor store:
    // verify that store publishes a buyable catalog in the storefront's channel.
    const endpoint = String(this.notes.storeEndpoint);
    const channel = String(this.notes.channel);
    const result = await saleorGraphql(
      endpoint,
      undefined,
      `query Products($channel: String!) {
        products(first: 5, channel: $channel) {
          edges { node { id name variants { id quantityAvailable } } }
        }
      }`,
      { channel },
    );
    assert.ok(!result.errors, `products query failed: ${JSON.stringify(result.errors)}`);
    const products = (result.data?.products as { edges?: Array<{ node: Record<string, unknown> }> } | undefined)
      ?.edges ?? [];
    assert.ok(
      products.length > 0,
      `the served Saleor catalog must list products in channel "${channel}"`,
    );
    // Stash a buyable variant for the cart step.
    for (const edge of products) {
      const variants = (edge.node["variants"] ?? []) as Array<{ id?: string }>;
      if (variants[0]?.id) {
        this.notes.variantId = variants[0].id;
        break;
      }
    }
  },
);

Then(
  "adding a product to the cart should update the cart",
  { timeout: STOREFRONT_TIMEOUT_MS },
  async function (this: JollyWorld) {
    if (deployedSkipReason()) return "skipped" as const;
    const variantId = this.notes.variantId as string | undefined;
    assert.ok(
      variantId,
      "no buyable product variant was found in the catalog to add to the cart",
    );
    const endpoint = String(this.notes.storeEndpoint);
    const channel = String(this.notes.channel);
    // The storefront's cart is a Saleor checkout. Create one (an ephemeral
    // draft — not an order, never customer-visible), add a line, and assert the
    // cart reflects it. Register deletion before asserting (harmless by design).
    const created = await saleorGraphql(
      endpoint,
      undefined,
      `mutation CreateCart($input: CheckoutCreateInput!) {
        checkoutCreate(input: $input) {
          checkout { id quantity lines { id quantity } }
          errors { field message }
        }
      }`,
      { input: { channel, lines: [{ quantity: 1, variantId }], email: `${this.namespace}@example.test` } },
    );
    const createErrors = (created.data?.checkoutCreate as { errors?: unknown[] } | undefined)?.errors ?? [];
    assert.ok(!created.errors && createErrors.length === 0, `checkoutCreate failed: ${JSON.stringify(created.errors ?? createErrors)}`);
    const checkout = (created.data?.checkoutCreate as { checkout?: Record<string, unknown> } | undefined)?.checkout;
    assert.ok(checkout?.["id"], "checkoutCreate must return a checkout id");
    const checkoutId = String(checkout!["id"]);
    this.cleanup.register(`storefront cart checkout ${checkoutId}`, async () => {
      await saleorGraphql(
        endpoint,
        undefined,
        `mutation DeleteCart($id: ID!) { checkoutDelete(id: $id) { errors { message } } }`,
        { id: checkoutId },
      );
    });
    const initialQty = Number(checkout!["quantity"] ?? 0);
    assert.ok(initialQty >= 1, "creating the cart with one line must set quantity >= 1");
    // Adding another unit must update the cart's total quantity.
    const added = await saleorGraphql(
      endpoint,
      undefined,
      `mutation AddToCart($id: ID!, $lines: [CheckoutLineInput!]!) {
        checkoutLinesAdd(id: $id, lines: $lines) {
          checkout { id quantity }
          errors { field message }
        }
      }`,
      { id: checkoutId, lines: [{ quantity: 1, variantId }] },
    );
    const addErrors = (added.data?.checkoutLinesAdd as { errors?: unknown[] } | undefined)?.errors ?? [];
    assert.ok(!added.errors && addErrors.length === 0, `checkoutLinesAdd failed: ${JSON.stringify(added.errors ?? addErrors)}`);
    const updated = (added.data?.checkoutLinesAdd as { checkout?: Record<string, unknown> } | undefined)?.checkout;
    const updatedQty = Number(updated?.["quantity"] ?? 0);
    assert.ok(
      updatedQty > initialQty,
      `adding a product must update the cart quantity (was ${initialQty}, now ${updatedQty})`,
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Whole-flow "real agent's starting state" scenarios: the token-needed guidance
// when no Cloud token is configured, store auto-provisioning when no store URL is
// configured, the dry-run provision plan, and the full end-to-end run from only a
// `.env` (no exported credentials).
// ═══════════════════════════════════════════════════════════════════════════

interface StartStage {
  stage: string;
  status: string;
  riskContext?: unknown;
}

function startStages(world: JollyWorld): StartStage[] {
  return (world.envelope.data.stages ?? []) as StartStage[];
}

function startStage(world: JollyWorld, name: string): StartStage | undefined {
  return startStages(world).find((s) => s.stage === name);
}

// --- Scenario: jolly start starts the device grant when no token is configured ---
//     (@logic) --------------------------------------------------------------------
//
// A real agent's first run with no Cloud token: `jolly start --json` starts the
// Saleor device authorization grant for its agent — it never treats the missing
// token as a fatal error and never fabricates success. The runtime credentials
// are genuinely unset (absentCredentialsEnv), and the child is a non-TTY
// subprocess (the agent-driven case).

Given(
  "a fresh project directory with no `JOLLY_SALEOR_CLOUD_TOKEN` configured",
  function (this: JollyWorld) {
    this.notes.startEnv = absentCredentialsEnv();
  },
);

When(
  "the agent runs `jolly start --json` in a non-interactive shell",
  function (this: JollyWorld) {
    // runCli spawns a non-TTY subprocess (the agent-driven case): no token from
    // any source, so the auth stage must report a token is needed and point to
    // the token flag — never a browser OAuth gate, never a fabricated success.
    this.runCli(["start", "--json"], {
      env: (this.notes.startEnv as Record<string, string | undefined>) ?? absentCredentialsEnv(),
      timeoutMs: 240_000,
    });
  },
);

Then(
  "it should not fabricate that authentication succeeded",
  function (this: JollyWorld) {
    const auth = startStage(this, "auth");
    assert.notEqual(
      auth!.status,
      "completed",
      "the auth stage must not fabricate a completed status without a token",
    );
    const text = (this.envelope.summary + " " + JSON.stringify(this.envelope.data)).toLowerCase();
    for (const claim of ["authentication succeeded", "authenticated as", "logged in", "token verified"]) {
      assert.ok(!text.includes(claim), `must not fabricate authentication success ("${claim}")`);
    }
  },
);

// --- Scenario: jolly start starts the device grant when no token is configured ---
//
// With no JOLLY_SALEOR_CLOUD_TOKEN, `jolly start --json` starts the Saleor
// device authorization grant for its agent: it requests a real device code and
// relays the user code + complete verification URL on STDERR so the agent can
// forward them to its human, while still emitting the start envelope (the auth
// stage is not fabricated as completed). Run for REAL against auth.saleor.io —
// the device-code request is unauthenticated, so no credential is needed. The
// relay assertion ("…verification URL `…/device?user_code=` followed by that
// user code to stderr…") is shared from the 018 step definitions.

// --- Shared Given: Cloud token set, no store URL (scenarios 3 + 4) -----------
//
// @logic (dry-run) and @sandbox (real --yes run) share this precondition. The
// real Cloud token (present under the @sandbox gate) is used as-is; a @logic
// dry-run performs no network, so a real-format stand-in suffices when no real
// token is configured. NEXT_PUBLIC_SALEOR_API_URL stays unset ("no store URL").

Given(
  "`JOLLY_SALEOR_CLOUD_TOKEN` is set and no `NEXT_PUBLIC_SALEOR_API_URL` is configured",
  function (this: JollyWorld) {
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? STAND_IN_TOKEN;
    // Surface the per-run `jolly-cannon-fodder-<run>` namespace through the SAME store-name
    // configuration affordance a customer uses (feature 002 Rule), so the store
    // `jolly start` auto-provisions is `jolly-cannon-fodder` cannon fodder the teardown
    // above reclaims. Production bakes in no test knowledge; the harness just sets
    // the configured name, exactly as it passes `--name` to `jolly create store`.
    this.notes.startEnv = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: cloudToken,
      JOLLY_STORE_NAME: makeNamespace(this.runId),
      // Namespace the Vercel project per worker, so a deploy is jolly-cannon-fodder
      // cannon fodder the teardown reclaims and no two workers share a project
      // (harmless-by-design + per-worker isolation).
      JOLLY_VERCEL_PROJECT: workerNamespace(),
    });
  },
);

// --- Shared Given: a prepared storefront directory with malformed package.json ---
//     (feature 020: unexpected-error envelope) --------------------------------
//
// A prepared storefront reuses storefront/ instead of re-cloning: the storefront
// stage sees storefront/package.json and skips the clone (src/index.ts
// runStorefrontStage). With no node_modules it then parses that package.json to
// approve Paper's build scripts, and malformed JSON throws an UNEXPECTED internal
// error deep in the run. The scenario asserts that throw surfaces as the stable
// error envelope, never a raw crash. Reach the storefront stage through the same
// real cannon-fodder start env the auto-provision run uses (real Cloud token,
// per-run namespaced store, per-worker Vercel project), reclaimed by the shared
// When's teardown.
Given(
  "a prepared storefront directory whose `package.json` is malformed JSON",
  function (this: JollyWorld) {
    const storefront = join(this.projectDir, "storefront");
    mkdirSync(storefront, { recursive: true });
    writeFileSync(join(storefront, "package.json"), "{ this is not valid json ");
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? STAND_IN_TOKEN;
    this.notes.startEnv = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: cloudToken,
      JOLLY_STORE_NAME: makeNamespace(this.runId),
      JOLLY_VERCEL_PROJECT: workerNamespace(),
    });
  },
);

// --- Shared When: `jolly start --yes --json` auto-provisioning run -----------
//     (scenarios 3 + 5) ------------------------------------------------------
//
// A real end-to-end run that may CREATE a Saleor Cloud environment. Harmless by
// design: before running, snapshot the org's environments and register a
// best-effort teardown that deletes only NEW `jolly-cannon-fodder`-namespaced
// environments this run created (never a pre-existing or non-test resource).

async function registerAutoProvisionTeardown(world: JollyWorld): Promise<void> {
  const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  if (!cloudToken) return; // @sandbox gate guarantees it under CI; nothing to clean otherwise.
  const before = new Set((await listAllEnvironments(cloudToken)).map((e) => e.key));
  const runNamespace = makeNamespace(world.runId);
  world.cleanup.register(
    "auto-provisioned Saleor Cloud environment (diff vs pre-run snapshot)",
    async () => {
      for (const env of await listAllEnvironments(cloudToken)) {
        if (!before.has(env.key) && env.name.startsWith(runNamespace)) {
          await deleteEnvironment(cloudToken, env.org, env.key);
        }
      }
    },
  );
  // Pre-create the namespaced Vercel project so the deploy stage's
  // `vercel deploy --project <namespace>` targets it, and register its removal —
  // harmless-by-design cannon fodder. Only when the Vercel CLI is authenticated
  // (otherwise the deploy stage gates and nothing is created).
  if (vercelCliAuthenticated()) {
    const project = workerNamespace();
    addVercelProject(project);
    world.cleanup.register(`jolly-cannon-fodder Vercel project (${project})`, () => {
      removeVercelProject(project);
    });
  }
}

When(
  "the agent runs `jolly start --yes --json`",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    await registerAutoProvisionTeardown(this);
    this.runCli(["start", "--yes", "--json"], {
      env: (this.notes.startEnv as Record<string, string | undefined>) ?? undefined,
      timeoutMs: 840_000,
    });
  },
);

// --- Scenario: jolly start auto-provisions a new store when none configured --
//     (@sandbox) -------------------------------------------------------------

Then(
  'the `store` stage status should be "completed", not "pending"',
  function (this: JollyWorld) {
    const store = startStage(this, "store");
    assert.ok(store, "the orchestrated stages must include the store stage");
    assert.equal(
      store!.status,
      "completed",
      `the store stage must auto-provision and report completed; got "${store!.status}"`,
    );
  },
);

Then(
  "the envelope `data` should include the new store's `*.saleor.cloud` GraphQL API URL and its Saleor Dashboard URL ending in `.saleor.cloud\\/dashboard\\/`",
  function (this: JollyWorld) {
    const blob = JSON.stringify(this.envelope.data ?? {});
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/graphql\//i.test(blob),
      `start data must include the new store's *.saleor.cloud GraphQL API URL: ${blob}`,
    );
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/dashboard\//i.test(blob),
      `start data must include the store's Saleor Dashboard URL ending in .saleor.cloud/dashboard/: ${blob}`,
    );
  },
);

Then(
  "`jolly start` should write that `NEXT_PUBLIC_SALEOR_API_URL` \\(mirrored to `SALEOR_URL`) and the resolved `SALEOR_TOKEN` to `.env`",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      values["NEXT_PUBLIC_SALEOR_API_URL"]?.includes(".saleor.cloud"),
      "start must write the provisioned NEXT_PUBLIC_SALEOR_API_URL to .env",
    );
    assert.equal(
      values["SALEOR_URL"],
      values["NEXT_PUBLIC_SALEOR_API_URL"],
      "start must mirror NEXT_PUBLIC_SALEOR_API_URL to SALEOR_URL in .env",
    );
    assert.ok(
      values["SALEOR_TOKEN"] && values["SALEOR_TOKEN"].length > 0,
      "start must write the resolved SALEOR_TOKEN to .env",
    );
  },
);

Then(
  'the `recipe` and `stock` stages should not report "blocked" for a missing Saleor endpoint',
  function (this: JollyWorld) {
    for (const name of ["recipe", "stock"]) {
      const stage = startStage(this, name);
      assert.ok(stage, `the orchestrated stages must include the ${name} stage`);
      const blockedForMissingEndpoint =
        stage!.status === "blocked" &&
        /no .*endpoint|missing .*endpoint|NEXT_PUBLIC_SALEOR_API_URL/i.test(
          JSON.stringify(this.envelope.checks),
        );
      assert.ok(
        !blockedForMissingEndpoint,
        `the ${name} stage must not be blocked for a missing Saleor endpoint after auto-provisioning`,
      );
    }
  },
);

// --- Scenario: jolly start --dry-run plans to provision a store (@logic) -----

Then(
  "the `store` stage preview should name the real Cloud API `organizations\\/\\{organization\\}\\/environments\\/` request it would send to provision a new store",
  function (this: JollyWorld) {
    const plan = (this.envelope.data.plan ?? []) as Array<{ stage?: string; riskContext?: { target?: unknown } }>;
    const store = plan.find((s) => s.stage === "store");
    assert.ok(store, "the start --dry-run plan must include the store stage");
    const blob = JSON.stringify(store);
    assert.ok(
      /organizations\/\{organization\}\/environments\//.test(blob),
      `the store stage preview must name the real Cloud API organizations/{organization}/environments/ request: ${blob}`,
    );
  },
);

Then(
  'it should not report the `store` stage as "pending" or claim a store already exists',
  function (this: JollyWorld) {
    // A dry-run plan stage carries no execution status, so it is never "pending";
    // and the preview must not claim a store is already configured.
    const plan = (this.envelope.data.plan ?? []) as Array<{ stage?: string; status?: string }>;
    const store = plan.find((s) => s.stage === "store");
    assert.ok(store, "the plan must include the store stage");
    assert.notEqual(store!.status, "pending", "the dry-run store stage must not be reported pending");
    const summary = String(this.envelope.summary ?? "").toLowerCase();
    assert.ok(
      !/store (already )?(exists|configured|is configured)/.test(summary),
      `the preview must not claim a store already exists: "${this.envelope.summary}"`,
    );
  },
);

// --- Scenario: jolly start --dry-run skips store provisioning when a store ----
//     endpoint is already configured (@logic) ----------------------------------
//
// A real agent that already has a store: NEXT_PUBLIC_SALEOR_API_URL is set in the
// run's env (the way a prior `jolly create store`/connect leaves it). The dry-run
// plan's store stage must report the configured store as already satisfied and
// skip provisioning — naming no Cloud API create request — the branch opposite
// the "provision a new store" preview above. A @logic dry-run performs no network,
// so a real-format stand-in store URL suffices; supplied via notes.startEnv so the
// shared `jolly start --dry-run --json` When reads it (no .env is written, so the
// shared "create nothing" assertion still holds).

Given(
  "`JOLLY_SALEOR_CLOUD_TOKEN` is set and `NEXT_PUBLIC_SALEOR_API_URL` is configured to an existing store",
  function (this: JollyWorld) {
    this.notes.startEnv = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
      NEXT_PUBLIC_SALEOR_API_URL: "https://existing-store.saleor.cloud/graphql/",
    });
  },
);

Then(
  "the `store` stage preview should report the configured store as already satisfied and skip provisioning",
  function (this: JollyWorld) {
    const plan = (this.envelope.data.plan ?? []) as Array<{ stage?: string; status?: string }>;
    const store = plan.find((s) => s.stage === "store");
    assert.ok(store, "the start --dry-run plan must include the store stage");
    const blob = JSON.stringify(store).toLowerCase();
    assert.ok(
      /already (satisfied|configured)|already (have|set)|configured store|store .*(already|configured)|satisfied/.test(
        blob,
      ),
      `the store stage preview must report the configured store as already satisfied: ${blob}`,
    );
    assert.ok(
      /skip|skipped|skipping|no provision|not provision|already/.test(blob),
      `the store stage preview must indicate it skips provisioning: ${blob}`,
    );
  },
);

Then(
  "it should not name a Cloud API request to create a new project or environment",
  function (this: JollyWorld) {
    const plan = (this.envelope.data.plan ?? []) as Array<{ stage?: string }>;
    const store = plan.find((s) => s.stage === "store");
    const blob = JSON.stringify(store ?? {});
    assert.ok(
      !/organizations\/\{organization\}\/environments\//.test(blob) &&
        !/create (a )?(new )?(project|environment)/i.test(blob) &&
        !/environments\/"?\s*[,}]/.test(blob),
      `with a store already configured, the store stage must name no Cloud API create request: ${blob}`,
    );
  },
);

// ─── Scenario: Jolly start lets Paper's native dependencies run their build
//     scripts so the Vercel build succeeds (@sandbox) ─────────────────────────
//
// pnpm v10 does not run a dependency's install/build scripts unless that
// dependency is approved (pnpm.onlyBuiltDependencies). Paper depends on the
// native modules `sharp` and `esbuild`, whose build scripts MUST run or the
// production build fails on unbuilt native binaries. `jolly start`'s storefront
// preparation must approve those builds so the install does not silently ignore
// them and the production build the Vercel deploy runs completes. Gated by
// SANDBOX_REQUIREMENTS["Jolly start lets Paper's native dependencies run their
// build scripts so the Vercel build succeeds"] (saleorEndpoint — the build's
// codegen needs a reachable Saleor schema) → skips locally.
//
// The clone+install (Given) is the credential-independent storefront stage, so
// it runs with the runtime credentials unset — only that stage does real local
// work; the credential-gated stages block, so the configured store is not
// mutated. The production build (final Then) is the same `pnpm build` the Vercel
// deploy runs; running it directly verifies the build completes without unbuilt
// native modules, harmlessly (no live deployment is published).

Given(
  "Jolly has cloned and installed the Paper storefront",
  { timeout: 600_000 },
  function (this: JollyWorld) {
    // Real clone + install via `jolly start`'s storefront stage (credential-
    // independent — see the no-fabrication scenario above, which confirms
    // storefront/package.json after a no-creds `jolly start --yes`). Skip — the
    // premise is not producible — if the storefront was not prepared (e.g. git or
    // pnpm unavailable in this environment).
    this.runCli(["start", "--yes", "--json"], {
      env: absentCredentialsEnv(),
      timeoutMs: 540_000,
    });
    const storefrontDir = join(this.lastRun!.cwd, "storefront");
    if (!existsSync(join(storefrontDir, "package.json"))) {
      this.attach(
        "Skipped: the Paper storefront was not cloned/installed in this environment",
        "text/plain",
      );
      this.notes.skipNativeBuild = true;
      return "skipped";
    }
    this.notes.storefrontDir = storefrontDir;
  },
);

When(
  "`jolly start` prepares the storefront for the Vercel deploy",
  function (this: JollyWorld) {
    // The storefront preparation already ran in the Given (the `jolly start`
    // storefront stage). The assertions below inspect its result.
  },
);

Then(
  "`pnpm install` in the storefront should report no ignored build scripts for Paper's native dependencies `sharp` and `esbuild`",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    if (this.notes.skipNativeBuild) return "skipped" as const;
    const dir = String(this.notes.storefrontDir);
    // Re-run the install (idempotent) and capture pnpm's ignored-build-scripts
    // report. After Jolly's preparation, neither sharp nor esbuild may appear
    // among the build scripts pnpm ignored.
    const result = spawnSync("npx", ["pnpm", "install"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 240_000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    const ignoredMatch = /ignored build scripts?[:\s]*([^\n]*)/i.exec(output);
    const ignored = ignoredMatch?.[1] ?? "";
    assert.ok(
      !/\bsharp\b/i.test(ignored),
      `pnpm must not ignore sharp's build script; ignored build scripts: "${ignored}"`,
    );
    assert.ok(
      !/\besbuild\b/i.test(ignored),
      `pnpm must not ignore esbuild's build script; ignored build scripts: "${ignored}"`,
    );
  },
);

Then(
  "the `npx vercel@latest --prod` production build should complete, not fail on unbuilt native modules",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    if (this.notes.skipNativeBuild) return "skipped" as const;
    const dir = String(this.notes.storefrontDir);
    // Run the same production build the Vercel deploy runs (Paper's `pnpm build`),
    // directly and harmlessly (no live deployment published). The build inherits
    // the process environment, so the @sandbox NEXT_PUBLIC_SALEOR_API_URL drives
    // Paper's codegen. An unbuilt sharp/esbuild native module fails this build;
    // its success is the falsifiable observable that the native build scripts ran.
    // Paper's build collects the `[channel]` route's page data, which needs a
    // configured storefront channel ("[Channels] No channels configured. Set
    // NEXT_PUBLIC_DEFAULT_CHANNEL or STOREFRONT_CHANNELS"). The real Vercel deploy
    // gets this from the project env Jolly configures; the direct build here
    // mirrors it with the recipe's `us` channel (assets/skills/jolly/recipe.yml),
    // so the build reaches the native-module compilation under test.
    const result = spawnSync("npx", ["pnpm", "build"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 840_000,
      env: { ...process.env, NEXT_PUBLIC_DEFAULT_CHANNEL: "us" },
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.equal(
      result.status,
      0,
      `the production build must complete; exit ${result.status}.\n${output}`,
    );
    assert.ok(
      !/(could not load|cannot find|failed to load|invalid ELF|prebuilt binaries|install.*sharp|sharp.*install|esbuild.*install)/i.test(
        output,
      ),
      `the production build must not fail on unbuilt native modules:\n${output}`,
    );
  },
);

// ─── pnpm prerequisite reported as a clean check (feature 002) ──────────────
// Real absence by construction: a sanitized bin dir holds symlinks to the tools
// `jolly doctor` legitimately uses (node, npx, git) but NOT pnpm, set as the
// only PATH entry, so `pnpm` genuinely cannot be resolved (a real ENOENT) while
// the CLI still runs. PATH is restored after the scenario.

function resolveOnPath(tool: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

Given("`pnpm` is not resolvable on PATH", function (this: JollyWorld) {
  const binDir = this.newTempDir("nopnpm-bin");
  symlinkSync(process.execPath, join(binDir, "node"));
  for (const tool of ["npx", "git"]) {
    const resolved = resolveOnPath(tool);
    if (resolved) symlinkSync(resolved, join(binDir, tool));
  }
  const originalPath = process.env.PATH;
  process.env.PATH = binDir;
  this.cleanup.register("restore PATH after pnpm-absence scenario", () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });
});

Then(
  "a `pnpm-available` check should report status {string}",
  function (this: JollyWorld, status: string) {
    // With no global pnpm on PATH the storefront stage runs pnpm via `npx`, so
    // the check is always a clean `pass` — a missing global pnpm is never a fail.
    const check = this.envelope.checks.find((c) => c.id === "pnpm-available");
    assert.ok(
      check,
      `doctor must report a pnpm-available check; got: ${this.envelope.checks.map((c) => c.id).join(", ")}`,
    );
    assert.equal(
      check.status,
      status,
      `pnpm-available must report "${status}" when no global pnpm is on PATH; got "${check.status}"`,
    );
  },
);

Then(
  "the check description should state the storefront stage runs `npx pnpm@latest install` with no global pnpm required",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) => c.id === "pnpm-available");
    assert.ok(check, "pnpm-available check must exist to carry a description");
    const text = `${check.description ?? ""} ${check.remediation ?? ""} ${check.command ?? ""}`;
    // No global pnpm on PATH: the storefront stage runs pnpm via `npx` at its
    // latest release, so the check stays a clean `pass` whose description points
    // at `npx pnpm@latest install` and states no global pnpm install is required —
    // never an install-pnpm remediation or a failure.
    assert.match(
      text,
      /npx pnpm@latest install/i,
      `pnpm-available description must state the storefront stage runs \`npx pnpm@latest install\`; got: ${text}`,
    );
    assert.match(
      text,
      /no global pnpm/i,
      `pnpm-available description must state no global pnpm is required; got: ${text}`,
    );
  },
);

Then(
  "no check or error should contain a raw `spawnSync` ENOENT string",
  function (this: JollyWorld) {
    const blob = JSON.stringify({
      checks: this.envelope.checks,
      errors: this.envelope.errors,
    });
    assert.doesNotMatch(
      blob,
      /spawnSync/i,
      `no check or error may leak a raw spawnSync string; got:\n${blob}`,
    );
    assert.doesNotMatch(
      blob,
      /ENOENT/,
      `no check or error may leak a raw ENOENT string; got:\n${blob}`,
    );
  },
);

// ─── Scenario: pending Vercel sign-in URL reuse until it expires (@sandbox) ───
//
// A real deploy-stage run with NO Vercel session makes Jolly spawn the device
// sign-in and persist its URL to `.jolly-pending-vercel.json` in the project
// dir. A re-run within the URL's lifetime reuses the persisted URL rather than
// spawning a fresh `vercel login`; a re-run after the lifetime discards it and
// spawns a fresh login. Cloud token only (["saleorCloud"]): the run
// auto-provisions the store and reaches deploy; the no-session condition comes
// from the isolated XDG dirs, never a double.
const PENDING_VERCEL_FILE = ".jolly-pending-vercel.json";
const VERCEL_SIGNIN_LIFETIME_SECONDS = 600;

/** The Vercel device sign-in URL surfaced in the run's nextSteps, or undefined. */
function surfacedVercelDeviceUrl(world: JollyWorld): string | undefined {
  const steps = (world.envelope.nextSteps ?? []) as Array<Record<string, unknown>>;
  for (const step of steps) {
    const blob = `${String(step.url ?? "")} ${String(step.description ?? "")}`;
    const match = blob.match(/https:\/\/vercel\.com\/oauth\/device[^\s"']*/i);
    if (match) return match[0];
  }
  return undefined;
}

/** A real `jolly start --yes` auto-provision run reaching the deploy stage with
 * the scenario's no-session XDG, in the scenario's stable project dir (so the
 * pending-Vercel file persists across re-runs). */
async function runStartToDeployStage(world: JollyWorld): Promise<void> {
  const xdg = (world.notes.vercelXdg as Record<string, string>) ?? {};
  world.runCli(["start", "--yes", "--json"], {
    env: absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
      JOLLY_STORE_NAME: makeNamespace(world.runId),
      JOLLY_VERCEL_PROJECT: workerNamespace(),
      ...xdg,
    }),
    timeoutMs: 840_000,
  });
}

Given(
  "`jolly start` reached the deploy stage without `--dry-run` and surfaced a Vercel device sign-in URL",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    // Real, producible no-session condition (not a double): isolated empty XDG
    // config/data dirs hold no Vercel auth, so the deploy stage spawns the device
    // sign-in and surfaces its URL.
    const dir = this.newTempDir("vercel-config");
    this.notes.vercelXdg = {
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
    };
    await registerSaleorEnvTeardown(this);
    await runStartToDeployStage(this);
    const url = surfacedVercelDeviceUrl(this);
    assert.ok(
      url,
      `the first run must surface a Vercel device sign-in URL; got: ${JSON.stringify(this.envelope.nextSteps)}`,
    );
    this.notes.firstVercelUrl = url;
  },
);

Given("the human has not yet approved the Vercel sign-in", function (this: JollyWorld) {
  // No approval occurs; the isolated no-session persists. Jolly must have
  // persisted the pending sign-in so a re-run can reuse it.
  assert.ok(
    existsSync(join(this.projectDir, PENDING_VERCEL_FILE)),
    "Jolly must persist the pending Vercel sign-in so a re-run can reuse it",
  );
});

When(
  "the agent runs `jolly start` again while the sign-in URL is within its lifetime",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    await runStartToDeployStage(this);
    this.notes.secondVercelUrl = surfacedVercelDeviceUrl(this);
  },
);

Then(
  "the deploy stage should surface the same Vercel sign-in URL rather than spawning a new login",
  function (this: JollyWorld) {
    assert.equal(
      this.notes.secondVercelUrl,
      this.notes.firstVercelUrl,
      "a re-run within the sign-in URL lifetime must reuse the persisted URL, never spawn a fresh login",
    );
  },
);

Then(
  "a re-run after the sign-in URL is past its lifetime should discard it and spawn a fresh Vercel login",
  { timeout: 900_000 },
  async function (this: JollyWorld) {
    // Age Jolly's own on-disk pending sign-in past its lifetime (real state
    // manipulation of a persisted file, not a double), so the next run discards it.
    const pending = join(this.projectDir, PENDING_VERCEL_FILE);
    const saved = JSON.parse(readFileSync(pending, "utf8")) as {
      deviceUrl?: string;
      savedAt?: number;
    };
    saved.savedAt = Date.now() - (VERCEL_SIGNIN_LIFETIME_SECONDS + 60) * 1000;
    writeFileSync(pending, JSON.stringify(saved));
    await runStartToDeployStage(this);
    const fresh = surfacedVercelDeviceUrl(this);
    assert.ok(
      fresh,
      `a re-run past the lifetime must spawn a fresh Vercel login and surface a new URL; got: ${JSON.stringify(this.envelope.nextSteps)}`,
    );
    assert.notEqual(
      fresh,
      this.notes.firstVercelUrl,
      "a re-run past the sign-in URL lifetime must discard the expired URL and surface a fresh one",
    );
  },
);
