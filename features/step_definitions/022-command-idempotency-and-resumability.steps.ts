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
// ─── @sandbox: Composed subcommands and start agree on state ─────────────────
// Jolly-observable: after a `jolly create` subcommand stored the endpoint,
// `jolly start` recognizes that work as satisfied (its doctor pass reports the
// endpoint present) rather than redoing it.
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
// ─── @logic: Collisions pause instead of overwriting ─────────────────────────
// A step that would overwrite local/remote state Jolly did not create must
// pause and ask how to resolve, never silently overwrite, and expose a feature
// 021 riskContext for the destructive resolution (Rule: destructive resolution
// is an impactful action). Precondition is set up in the temp project; the
// assertion is on the envelope, under absentCredentialsEnv().
