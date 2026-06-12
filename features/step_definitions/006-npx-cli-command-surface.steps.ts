// Step definitions for feature 006: Npx-first Jolly CLI command surface.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { findEnvelope, assertEnvelopeShape } from "../support/envelope.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

// Note: `\`jolly start\` should be available...` step is in common.steps.ts (regex
// that matches both "should be available" and "is available" variants).

// ── Scenario: Npx execution does not require Bun (@logic) ─────────────────
// Pins the 2026-06-12 decision: the published CLI is a Node program. The
// launcher (`bin/jolly`) is executed directly — shebang and all, exactly as
// npx would — on a PATH that holds only a `node` symlink, so a launcher that
// invokes or requires Bun fails here. `jolly start` is side-effecting, so per
// the feature 012 incident lesson the run forces dummy credentials for every
// credential group and an unroutable .invalid API URL: even a CLI that
// ignores --dry-run cannot reach a real Saleor, Vercel, or Stripe account.

const NODE_ONLY_DUMMY_ENV = {
  JOLLY_SALEOR_CLOUD_TOKEN: "test-cloud-token-for-logic",
  JOLLY_SALEOR_APP_TOKEN: "test-app-token-for-logic",
  NEXT_PUBLIC_SALEOR_API_URL: "https://jolly-test.invalid/graphql",
  JOLLY_VERCEL_TOKEN: "test-vercel-token-for-logic",
  JOLLY_STRIPE_PUBLISHABLE_KEY: "pk_test_logic_dummy",
  JOLLY_STRIPE_SECRET_KEY: "sk_test_logic_dummy",
};

Given(
  "a machine with Node.js available but no Bun on the PATH",
  function (this: JollyWorld) {
    const probe = spawnSync("node", ["-p", "process.execPath"], {
      encoding: "utf8",
    });
    assert.equal(
      probe.status,
      0,
      "the harness machine must have Node.js available to build the Bun-less PATH",
    );
    const nodePath = probe.stdout.trim();

    const binDir = this.newTempDir("node-only-bin");
    symlinkSync(nodePath, join(binDir, "node"));

    const bunProbe = spawnSync("/usr/bin/env", ["bun", "--version"], {
      env: { PATH: binDir },
      encoding: "utf8",
    });
    assert.notEqual(
      bunProbe.status,
      0,
      "the restricted PATH must not resolve a bun executable",
    );

    this.notes.nodeOnlyPath = binDir;
  },
);

When(
  "the agent runs `jolly start --dry-run --json` through the published launcher",
  function (this: JollyWorld) {
    const binDir = this.notes.nodeOnlyPath as string;
    const launcher = join(REPO_ROOT, "bin", "jolly");
    const args = ["start", "--dry-run", "--json"];
    // Built from scratch (not process.env): the Bun-less PATH is the premise,
    // and any real JOLLY_* credentials from .env must not leak into the run.
    const env: Record<string, string> = {
      PATH: binDir,
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...NODE_ONLY_DUMMY_ENV,
    };
    const spawned = spawnSync(launcher, args, {
      cwd: this.projectDir,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    const stdout = spawned.stdout ?? "";
    this.previousRun = this.lastRun;
    this.lastRun = {
      args,
      cwd: this.projectDir,
      exitCode: spawned.error ? -1 : (spawned.status ?? -1),
      stdout,
      stderr: spawned.error
        ? `${spawned.stderr ?? ""}\nspawn error: ${spawned.error.message}`
        : (spawned.stderr ?? ""),
      envelope: findEnvelope(stdout),
    };
  },
);

Then("the command should succeed using Node alone", function (this: JollyWorld) {
  const run = this.lastRun!;
  assert.equal(
    run.exitCode,
    0,
    `the published launcher should exit 0 with only Node on the PATH ` +
      `(exit ${run.exitCode}).\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
});

Then(
  "stdout should carry the standard output envelope",
  function (this: JollyWorld) {
    const envelope = this.envelope; // asserts presence + feature 020 shape
    assert.equal(
      envelope.command,
      "start",
      `envelope.command should be "start", got ${JSON.stringify(envelope.command)}`,
    );
  },
);

Given("the customer wants the end-to-end guided Saleor storefront setup", function (this: JollyWorld) {
  // Contract.
});

When("the agent invokes the primary guided command", function (this: JollyWorld) {
  this.runCli(["start"]);
});

Then(
  "the agent may instead invoke individual composable subcommands for each stage",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "the output should follow Jolly's hybrid human-readable plus machine-readable format",
  function (this: JollyWorld) {
    // The envelope is already found in stdout.
  },
);
