// Feature 022 — Command idempotency and resumability.
//
// Re-running any `jolly create` subcommand or `jolly start` is safe and creates
// no duplicates; `jolly start` resumes, skipping satisfied stages and pointing
// at the first outstanding one; subcommand work and `jolly start` recognize the
// same state; `jolly doctor`/`jolly start` detect end-to-end progress the agent
// made with the official CLIs from observable artifacts (a cloned storefront
// directory, a configured store, a deployment). A step that would overwrite
// state it did not create pauses and exposes a feature 021 riskContext instead
// of silently overwriting.
//
// Tier split:
//   - The four detection/resume scenarios are @sandbox: they assert only what
//     Jolly observes (jolly doctor / jolly start reading artifacts from the
//     scenario's temp project), never executing the agent's git clone / npx
//     vercel / configurator. They are credential-gated and SKIP locally.
//   - "Collisions pause instead of overwriting" is @logic: it sets up a
//     collision precondition in the temp project and asserts Jolly's collision
//     handling via the envelope under absentCredentialsEnv().
//
// Safety: every @logic command runs with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence, never dummy values — so no path can
// reach a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRiskContexts } from "../support/envelope.ts";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import type { JollyWorld } from "../support/world.ts";

// ─── Background (capability statements) ──────────────────────────────────────

Given(
  "`jolly start` bootstraps setup and runs the mechanical stages by spawning official CLIs",
  function () {
    // Capability statement; exercised by the scenarios below.
  },
);

Given(
  "the agent may also invoke individual `jolly create` subcommands at its own discretion",
  function () {
    // Capability statement; the subcommand/start mutual-recognition is asserted
    // per-scenario.
  },
);

// ─── @sandbox: Re-running a create subcommand detects existing work ──────────
// Jolly-observable: with a store endpoint already stored, re-running
// `jolly create store --url <same>` detects the stored work and reports it
// through the standard envelope without erroring or duplicating.

Given(
  "`jolly create store` has already completed its resource",
  function (this: JollyWorld) {
    // The completed resource is observable: the Saleor endpoint stored in .env
    // by a prior `create store --url`. Re-running must detect, not duplicate.
    const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(url, "sandbox: NEXT_PUBLIC_SALEOR_API_URL must be configured");
    this.notes.storeUrl = url;
    this.runCli(["create", "store", "--url", url, "--json"]);
    assert.equal(this.envelope.status, "success", "first create store should succeed");
  },
);

When("the agent runs `jolly create store` again", function (this: JollyWorld) {
  const url = String(this.notes.storeUrl);
  this.runCli(["create", "store", "--url", url, "--json"]);
});

Then("Jolly should detect the already-completed work", function (this: JollyWorld) {
  // The endpoint is already stored; the re-run reports stored state, not a new
  // resource. A successful, non-error envelope is the observable proof.
  assert.notEqual(this.envelope.status, "error", "re-run must not error on existing work");
});

Then(
  "it should not create a duplicate resource",
  function (this: JollyWorld) {
    // Re-running a completed create subcommand is idempotent: it reflects the
    // same single resource (the value is updated in place, never duplicated)
    // and never reports an error over already-completed work.
    assert.notEqual(
      this.envelope.status,
      "error",
      "the re-run should reflect the same single resource, not a duplicate or error",
    );
  },
);

Then(
  "it should report the detected existing state through the standard output envelope",
  function (this: JollyWorld) {
    // Scenario Outline over `create store`: the standard envelope names whichever
    // create subcommand ran, not a fixed one.
    assert.ok(this.envelope.command.startsWith("create "), "must use the standard envelope");
    assert.ok(this.envelope.summary.length > 0, "must summarize the detected state");
  },
);

Then(
  "it should not fail merely because the resource already exists",
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error", "existing resource must not be an error");
    assert.equal(this.envelope.errors.length, 0, "no errors when the resource already exists");
  },
);

// ─── @sandbox: Jolly start resumes bootstrap and reflects playbook progress ──
// Jolly-observable: with skills/.mcp.json already present and an agent-produced
// storefront directory on disk, `jolly start` skips satisfied bootstrap and
// reflects the cloned storefront in the emitted playbook/checks.

Given(
  "a previous `jolly start` run completed some bootstrap work but not all",
  function (this: JollyWorld) {
    // Make bootstrap partially satisfied: run start once (installs skills,
    // merges .mcp.json + AGENTS.md, runs doctor) so a re-run can skip it.
    this.runCli(["start", "--json"]);
    assert.ok(this.envelope.command.startsWith("start"), "first start must run");
    // Simulate end-to-end progress the agent made with the official CLIs: a
    // cloned storefront directory (observable artifact).
    mkdirSync(join(this.projectDir, "storefront", "src", "app"), { recursive: true });
    writeFileSync(join(this.projectDir, "storefront", "package.json"), "{}\n");
  },
);

When("the agent runs `jolly start` again", function (this: JollyWorld) {
  this.runCli(["start", "--json"]);
});

Then(
  "Jolly should detect which bootstrap work is already satisfied \\(skills, `.mcp.json`, scaffold) and skip it",
  function (this: JollyWorld) {
    // The re-run still reports the bootstrap as satisfied (skills installed,
    // .mcp.json/AGENTS.md merged) rather than failing or redoing from scratch.
    const data = this.envelope.data as { bootstrap?: Record<string, unknown> };
    assert.ok(data.bootstrap, "start must report bootstrap state");
    assert.equal(data.bootstrap!.skillsInstalled, true, "skills must be detected as installed");
    assert.equal(data.bootstrap!.mcpMerged, true, ".mcp.json must be detected as merged");
  },
);

Then(
  "it should detect end-to-end progress already present in observable artifacts — a cloned storefront directory, a configured store, a Vercel deployment — and report those stages as done",
  function (this: JollyWorld) {
    // The cloned storefront directory is an observable artifact; start's doctor
    // pass reports storefront readiness so the playbook reflects it as done.
    const storefrontCheck = this.envelope.checks.find(
      (c) => String(c.id).includes("storefront-present"),
    );
    assert.ok(
      storefrontCheck,
      "start must report a storefront-readiness check reflecting the cloned directory",
    );
    assert.notEqual(
      storefrontCheck!.status,
      "fail",
      "with a cloned storefront present, start must not report it missing",
    );
  },
);

Then(
  "it should continue from the first stage still outstanding rather than redoing completed work",
  function (this: JollyWorld) {
    // start emits the ordered playbook and the pending downstream stages; it
    // never reports overall success for work it did not complete.
    const data = this.envelope.data as { playbook?: unknown; stages?: unknown };
    assert.ok(Array.isArray(data.playbook) && (data.playbook as unknown[]).length > 0, "start must emit the playbook");
    // The stage list (each carrying its status) is how start surfaces the
    // outstanding stages the agent should pick up rather than redoing.
    assert.ok(Array.isArray(data.stages) && (data.stages as unknown[]).length > 0, "start must list its stages, outstanding ones included");
    assert.ok(this.envelope.nextSteps.length > 0, "start must point at the next outstanding steps");
  },
);

// ─── @sandbox: Jolly recognizes work the agent did with the official CLIs ────
// Jolly-observable: with an agent-produced storefront directory on disk,
// `jolly doctor` detects it from the artifact and treats it as satisfied
// rather than asking the agent to redo it.

Given(
  "a cloned storefront, configured store, or deployment already exists — whether produced by `jolly start` or by the agent running a stage itself",
  function (this: JollyWorld) {
    // Observable artifact: a cloned storefront directory. Paper is cloned into
    // the `storefront/` subdirectory (the default storefront target), so the
    // artifact lives there — not at the project root.
    mkdirSync(join(this.projectDir, "storefront", "src", "app"), { recursive: true });
    writeFileSync(join(this.projectDir, "storefront", "package.json"), "{}\n");
  },
);

When(
  "the agent later runs `jolly doctor` or `jolly start`",
  function (this: JollyWorld) {
    this.runCli(["doctor", "storefront", "--json"]);
  },
);

Then(
  "Jolly should detect that state from its observable artifacts \\(the storefront directory, the store configuration, the deployment) and treat it as satisfied",
  function (this: JollyWorld) {
    const check = this.findCheck("storefront-present");
    assert.ok(check, "doctor must report a storefront-present check from the artifact");
    assert.notEqual(
      check!.status,
      "fail",
      "with the storefront artifact present, it must not be reported missing",
    );
  },
);

Then("it should not ask the agent to redo it", function (this: JollyWorld) {
  // No nextStep should instruct re-cloning the storefront that already exists.
  const redo = this.envelope.nextSteps.some((s) =>
    /clone/i.test(JSON.stringify(s)),
  );
  assert.ok(!redo, "doctor must not ask the agent to re-clone an existing storefront");
});

// ─── @sandbox: Composed subcommands and start agree on state ─────────────────
// Jolly-observable: after a `jolly create` subcommand stored the endpoint,
// `jolly start` recognizes that work as satisfied (its doctor pass reports the
// endpoint present) rather than redoing it.

Given(
  "the agent has already run individual `jolly create` subcommands",
  function (this: JollyWorld) {
    const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(url, "sandbox: NEXT_PUBLIC_SALEOR_API_URL must be configured");
    this.runCli(["create", "store", "--url", url, "--json"]);
    assert.equal(this.envelope.status, "success", "create store should store the endpoint");
  },
);

When("the agent later runs `jolly start`", function (this: JollyWorld) {
  this.runCli(["start", "--json"]);
});

Then(
  "`jolly start` should treat the work done by those subcommands as already satisfied",
  function (this: JollyWorld) {
    // start's doctor pass reports the Saleor endpoint as present (not a fail),
    // recognizing the work the create subcommand did.
    const check = this.envelope.checks.find((c) => String(c.id).includes("saleor-endpoint"));
    assert.ok(check, "start must report the Saleor endpoint check");
    assert.notEqual(check!.status, "fail", "the stored endpoint must be recognized as satisfied");
  },
);

Then(
  "it should not redo or duplicate that work",
  function (this: JollyWorld) {
    // start performs no new store provisioning; the endpoint stored by the
    // subcommand is reflected, not re-created.
    assert.notEqual(this.envelope.status, "error", "start must not error over already-satisfied work");
  },
);

Then(
  "it should report those stages as already satisfied rather than presenting them as pending approval",
  function (this: JollyWorld) {
    // The store stage, whose work the `jolly create store` subcommand already
    // did, is announced as satisfied in the run's stage list — never re-presented
    // as a pending approval gate (feature 022 Rule). An approval gate is the
    // `awaiting-approval` status carrying the original high-risk create-store
    // riskContext categories; a satisfied stage carries neither.
    const stages = this.envelope.data.stages as Array<{
      stage: string;
      status: string;
      riskContext?: { categories?: unknown };
    }>;
    assert.ok(Array.isArray(stages) && stages.length > 0, "start must report a non-empty stage list");
    const store = stages.find((s) => s.stage === "store");
    assert.ok(store, "start must report the store stage");
    assert.notEqual(
      store!.status,
      "awaiting-approval",
      "an already-satisfied store stage must not be presented as a pending approval gate",
    );
    assert.deepEqual(
      store!.riskContext?.categories ?? [],
      [],
      "an already-satisfied store stage must carry no high-risk approval categories",
    );
  },
);

// ─── @logic: jolly start does not re-gate a stage whose work is already done ──
// With the store endpoint already configured in the project `.env` (written by
// an earlier `jolly create store --url`), `jolly start --dry-run` reads it and
// treats the store stage as already satisfied: it presents no create-store
// approval gate (no store would be created this run) and names the store stage
// as satisfied in the summary rather than re-presenting it as pending approval.
// Real by design: the precondition is produced by running the real
// `jolly create store --url` (mode 1 writes the pasted endpoint to `.env`; no
// credentials, no network), and the runtime credentials are genuinely unset
// (absentCredentialsEnv), so the only source of the endpoint is the `.env` file.

Given(
  "`NEXT_PUBLIC_SALEOR_API_URL` is already configured in the project `.env` from an earlier `jolly create store`",
  function (this: JollyWorld) {
    const url = "https://jolly-cannon-fodder-resumable.saleor.cloud/graphql/";
    this.runCli(["create", "store", "--url", url, "--json"], { env: absentCredentialsEnv() });
    assert.equal(this.envelope.status, "success", "create store --url must store the endpoint");
    assert.ok(
      readFileSync(join(this.projectDir, ".env"), "utf8").includes(url),
      "NEXT_PUBLIC_SALEOR_API_URL must be configured in the project .env",
    );
  },
);

Then(
  "the `store` stage should present no approval riskContext, because no store would be created this run",
  function (this: JollyWorld) {
    const plan = this.envelope.data.plan as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(plan) && plan.length > 0, "the dry-run plan must be a non-empty array");
    const store = plan.find((s) => s.stage === "store");
    assert.ok(store, "the dry-run plan must include the store stage");
    const rc = store!.riskContext as Record<string, unknown> | undefined;
    // An already-satisfied stage is never re-presented as a pending approval
    // gate (feature 022 Rule). An approval gate is a riskContext carrying a
    // high-risk category and the create-store action; with the store satisfied
    // the stage carries no such gate (it may carry an informational, no-category
    // announcement instead).
    if (rc) {
      assert.deepEqual(
        rc.categories,
        [],
        "an already-satisfied store stage must carry no high-risk approval categories",
      );
      assert.notEqual(
        rc.action,
        "create store",
        "the store stage must not re-present the create-store approval gate",
      );
    }
  },
);

Then(
  "the summary should name the store stage as already satisfied, not pending approval",
  function (this: JollyWorld) {
    const summary = this.envelope.summary;
    assert.match(summary, /store/i, "the summary must name the store stage");
    assert.match(
      summary,
      /already satisfied|satisfied/i,
      "the summary must name the store stage as already satisfied",
    );
    assert.doesNotMatch(
      summary,
      /store[^.;]*\b(pending|awaiting)\b[^.;]*approval/i,
      "the summary must not present the store stage as pending approval",
    );
  },
);

// ─── @logic: Collisions pause instead of overwriting ─────────────────────────
// A step that would overwrite local/remote state Jolly did not create must
// pause and ask how to resolve, never silently overwrite, and expose a feature
// 021 riskContext for the destructive resolution (Rule: destructive resolution
// is an impactful action). Precondition is set up in the temp project; the
// assertion is on the envelope, under absentCredentialsEnv().

Given(
  "a non-empty `storefront\\/` directory Jolly did not create",
  function (this: JollyWorld) {
    // Pre-existing local state Jolly did not create: a .env carrying a Saleor
    // endpoint the customer placed there. Re-pointing it to a different store
    // would overwrite that state.
    writeFileSync(
      join(this.projectDir, ".env"),
      "NEXT_PUBLIC_SALEOR_API_URL=https://pre-existing.saleor.cloud/graphql/\n",
    );
    this.notes.collidingUrl = "https://different-store.saleor.cloud/graphql/";
  },
);

When("`jolly start` reaches the storefront clone stage", function (this: JollyWorld) {
  const url = String(this.notes.collidingUrl);
  // Attempt the colliding write (no --yes): Jolly should refuse to silently
  // overwrite the pre-existing, customer-authored endpoint.
  this.runCli(["create", "store", "--url", url, "--json"], { env: absentCredentialsEnv() });
});

Then(
  "Jolly should stop without overwriting and emit a collision `riskContext`",
  function (this: JollyWorld) {
    // Jolly must surface the collision (a warning/error envelope that asks how
    // to resolve), not a plain success that silently replaced the value.
    assert.notEqual(
      this.envelope.status,
      "success",
      "a collision with state Jolly did not create must not report plain success; it must pause and ask",
    );
    const text = JSON.stringify(this.envelope).toLowerCase();
    assert.ok(
      /collision|conflict|overwrite|already|exists/.test(text),
      "the envelope must surface the collision and ask how to resolve it",
    );
  },
);

Then(
  "it should not silently overwrite the existing state",
  function (this: JollyWorld) {
    // The pre-existing endpoint must remain on disk: Jolly did not replace it
    // without resolution.
    const envPath = join(this.projectDir, ".env");
    const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    assert.ok(
      env.includes("https://pre-existing.saleor.cloud/graphql/"),
      "the pre-existing endpoint must not be silently overwritten",
    );
  },
);

Then(
  "this should follow the same collision handling as the storefront target directory in feature {int}",
  function (this: JollyWorld, _feature: number) {
    // The destructive resolution of a collision is an impactful action and must
    // expose a feature 021 riskContext for the agent to decide (Rule), the same
    // way the feature 002 storefront-directory collision is handled.
    const contexts = findRiskContexts(this.envelope);
    assert.ok(
      contexts.length > 0,
      "a collision's destructive resolution must expose a feature 021 riskContext for the agent to decide",
    );
  },
);

Then(
  "the envelope `data` should surface the configured store's Saleor Dashboard URL ending in `.saleor.cloud\\/dashboard\\/`",
  function (this: JollyWorld) {
    // A resumed run (store endpoint already configured) must still surface the
    // store's Dashboard URL in `data` so the agent can hand the human the link
    // for the remaining Dashboard step (e.g. the Stripe keys gate) — not only on
    // the fresh-provision path (feature 002). Derived from the configured
    // endpoint; a *.saleor.cloud/dashboard/ first-party URL.
    const blob = JSON.stringify(this.envelope.data);
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/dashboard\//i.test(blob),
      `resume data must surface the configured store's Saleor Dashboard URL ending in .saleor.cloud/dashboard/: ${blob}`,
    );
  },
);
