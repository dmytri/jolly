// Feature 006 — Npx-first Jolly CLI command surface.
//
// @logic scenario "Npx execution does not require Bun": run the published
// launcher `bin/jolly` directly (shebang and all, exactly as npx would) on a
// PATH that holds only a `node` symlink — after asserting Bun is not
// resolvable on it — and require the standard envelope back on stdout with
// exit 0. This proves the Node launcher never needs Bun (decision 2026-06-12).
//
// @logic scenario "Agent starts the guided setup flow": `jolly start`
// bootstraps and emits the ordered playbook in Jolly's hybrid (human +
// machine-readable) format.
//
// Safety (the "012 incident"): the launcher run builds its environment from
// scratch (no .env leakage) and forces dummy credentials for all groups plus
// an unroutable `.invalid` Cloud API base, so a side-effecting path can never
// reach a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { findEnvelope } from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Scenario: Npx execution does not require Bun --------------------------

Given(
  "a machine with Node.js available but no Bun on the PATH",
  function (this: JollyWorld) {
    // Build a clean PATH holding ONLY a `node` symlink — no `bun` resolvable.
    const binDir = this.newTempDir("node-only-bin");
    const nodePath = process.execPath; // the running Node binary
    symlinkSync(nodePath, join(binDir, "node"));
    this.notes.nodeOnlyPath = binDir;

    // Assert Bun is not resolvable on this PATH (uses `command -v bun`).
    const probe = spawnSync("sh", ["-c", "command -v bun"], {
      env: { PATH: binDir },
      encoding: "utf8",
    });
    assert.notEqual(
      probe.status,
      0,
      "Bun must not be resolvable on the node-only PATH for this scenario",
    );
  },
);

When(
  "the agent runs `jolly start --dry-run --json` through the published launcher",
  function (this: JollyWorld) {
    const binDir = String(this.notes.nodeOnlyPath);
    const launcher = join(REPO_ROOT, "bin", "jolly");
    assert.ok(existsSync(launcher), "bin/jolly launcher must exist");

    // Run the launcher exactly as a shell would: via its own shebang
    // (`#!/usr/bin/env node`). `env` resolves `node` from our node-only PATH.
    // Build the child env from scratch (no inherited .env), forcing logic-safe
    // dummy creds + unroutable Cloud API base.
    const safe = logicSafeEnv();
    const childEnv: Record<string, string> = { PATH: binDir };
    for (const [k, v] of Object.entries(safe)) if (v !== undefined) childEnv[k] = v;
    // `env` itself must be locatable; keep the directory holding `/usr/bin/env`
    // on PATH so the shebang resolves, without adding any bun-bearing dir.
    const envBin = spawnSync("sh", ["-c", "command -v env"], { encoding: "utf8" });
    const envDir = dirname((envBin.stdout ?? "/usr/bin/env").trim() || "/usr/bin/env");
    childEnv.PATH = `${binDir}${delimiter}${envDir}`;

    const result = spawnSync(launcher, ["start", "--dry-run", "--json"], {
      cwd: this.projectDir,
      env: childEnv,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) {
      throw new Error(`failed to run bin/jolly launcher: ${result.error.message}`);
    }
    this.notes.launcherStdout = result.stdout ?? "";
    this.notes.launcherStderr = result.stderr ?? "";
    this.notes.launcherExit = result.status;
  },
);

Then("the command should succeed using Node alone", function (this: JollyWorld) {
  assert.equal(
    this.notes.launcherExit,
    0,
    `launcher should exit 0 using Node alone; stderr:\n${this.notes.launcherStderr}`,
  );
});

Then(
  "stdout should carry the standard output envelope",
  function (this: JollyWorld) {
    const envelope = findEnvelope(String(this.notes.launcherStdout));
    assert.ok(envelope, "launcher stdout must carry the standard output envelope");
    assert.equal(envelope!.command, "start");
    assert.equal(typeof envelope!.summary, "string");
    assert.ok(Array.isArray(envelope!.nextSteps));
  },
);

// --- Scenario: Agent starts the guided setup flow --------------------------

Given(
  "the customer wants the end-to-end guided Saleor storefront setup",
  function () {
    // Framing; the guided command is invoked in the When.
  },
);

When("the agent invokes the primary guided command", function (this: JollyWorld) {
  // `jolly start` is the primary guided command. Run under logicSafeEnv so the
  // bootstrap cannot reach a real account; the temp project is isolated.
  this.runCli(["start", "--json"], { env: logicSafeEnv() });
});

Then(
  "`jolly start` should bootstrap setup \\(install the Jolly skill and Saleor skills, scaffold, run doctor) and emit the ordered playbook for the agent to execute",
  function (this: JollyWorld) {
    const data = this.envelope.data as {
      bootstrap?: { doctorRan?: unknown };
      playbook?: unknown;
    };
    // Bootstrap evidence: a bootstrap record (skills/scaffold/doctor) and an
    // ordered playbook (in data and/or nextSteps) for the agent to execute.
    assert.ok(data.bootstrap, "start must report a bootstrap record");
    assert.equal(data.bootstrap.doctorRan, true, "start must run doctor during bootstrap");
    const playbook = Array.isArray(data.playbook) ? data.playbook : [];
    assert.ok(playbook.length > 0, "start must emit an ordered playbook");
    assert.ok(this.envelope.nextSteps.length > 0, "start must emit nextSteps for the agent");
  },
);

Then(
  "the agent then drives the official CLIs \\(Vercel CLI, `@saleor\\/configurator`, `git`, `pnpm`) per the Jolly skill, calling Jolly's thin helpers for plumbing",
  function (this: JollyWorld) {
    // The playbook directs the agent to the official CLIs; Jolly itself never
    // shells out to them. Assert the playbook references the agent-run tooling.
    const data = this.envelope.data as { playbook?: unknown };
    const playbook = (Array.isArray(data.playbook) ? data.playbook : []).join(" ").toLowerCase();
    const stepText = this.envelope.nextSteps
      .map((s) => `${s.description ?? ""} ${s.command ?? ""}`)
      .join(" ")
      .toLowerCase();
    const haystack = `${playbook} ${stepText}`;
    assert.ok(/vercel/.test(haystack), "playbook should reference the Vercel CLI");
    assert.ok(/configurator/.test(haystack), "playbook should reference @saleor/configurator");
    assert.ok(/git/.test(haystack), "playbook should reference git");
  },
);

Then(
  "the output should follow Jolly's hybrid human-readable plus machine-readable format",
  function (this: JollyWorld) {
    // Default (non --json) mode carries both human text AND the envelope.
    this.runCli(["start"], { env: logicSafeEnv() });
    const run = this.lastRun!;
    assert.ok(run.envelope, "default-mode start must carry the machine-readable envelope");
    const envelopeJson = JSON.stringify(run.envelope);
    const human = run.stdout.replace(envelopeJson, "").trim();
    assert.ok(
      human.length > 0,
      "default-mode start must include human-readable text alongside the envelope",
    );
  },
);
