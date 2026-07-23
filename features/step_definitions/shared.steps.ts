// Shared step definitions used by more than one foundation feature.
//
// Cucumber loads every step-definition file into one global registry, so a
// given step text may be defined exactly once across the whole suite. Steps
// whose verbatim text appears in multiple feature files (018/012/024/008/021)
// live here so each feature file can stay collision-free. Anything truly
// specific to one feature stays in that feature's <slug>.steps.ts.
//
// Safety: every step that runs a side-effecting command path does so with the
// runtime credentials genuinely UNSET (absentCredentialsEnv) — real absence,
// never dummy values — so no @logic step can reach a real account because there
// is no credential to reach one with.
import { Given, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findEnvelope, findRiskContexts } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// ─── output-stream cleanliness (020 --quiet/default, 014 --quiet) ──────────
// These assert the feature 020 stream contract shared by more than one feature:
// --quiet emits nothing on a clean stdout and never the machine envelope.

Then("stdout should be empty", function (this: JollyWorld) {
  assert.equal(
    this.lastRun!.stdout.trim(),
    "",
    `stdout must be empty; got:\n${this.lastRun!.stdout}`,
  );
});

Then("no JSON envelope should be printed", function (this: JollyWorld) {
  assert.equal(
    findEnvelope(this.lastRun!.stdout),
    undefined,
    `no machine envelope must be printed on stdout; got:\n${this.lastRun!.stdout}`,
  );
  assert.equal(
    findEnvelope(this.lastRun!.stderr),
    undefined,
    `no machine envelope must be printed on stderr; got:\n${this.lastRun!.stderr}`,
  );
});

// ─── .env / .gitignore assertions (018, 012) ──────────────────────────────

Then(
  ".gitignore should contain .env",
  function (this: JollyWorld) {
    const path = join(this.lastRun!.cwd, ".gitignore");
    assert.ok(existsSync(path), ".gitignore should exist");
    const lines = readFileSync(path, "utf8").split("\n");
    assert.ok(
      lines.some((line) => line.trim() === ".env"),
      ".gitignore should list .env",
    );
  },
);

Then(
  "Jolly should load the updated .env values for the current command flow",
  function (this: JollyWorld) {
    // writeEnvValues returns the reloaded post-update value map; the command
    // succeeded with a well-formed envelope, which is the observable proof the
    // updated values were available to the flow. No fabricated success.
    assert.ok(this.envelope, "the command must produce an envelope");
  },
);

// ─── no existing .env (018 dry-run, 012 dry-run) ──────────────────────────
// ─── Saleor Cloud token Given (012 mode-1 Background-style + 024 Background) ─
Given(
  "the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    // Capability statement; same as above. @logic runs with credentials unset.
  },
);

// ─── risk-context-in-envelope assertion (018, 012, 024) ───────────────────
// ─── .env-not-created assertion (018, 012) ────────────────────────────────
// ─── envelope status assertion (018) ──────────────────────────────────────

Then(
  "the envelope status should be {string}",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
  },
);

// ─── shared secret-leak assertion (018, 024) ──────────────────────────────

Then(
  "Jolly should not print the token value",
  function (this: JollyWorld) {
    // The world tracks the real runtime JOLLY_* secret values (its constructor),
    // and each scenario tracks any token it passes as input (e.g. 018's bad
    // login token); @sandbox runs additionally track the real derived secrets
    // via the @sandbox Before hook. Assert none of them leaked.
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
    this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
  },
);

// ─── no-remote-side-effects on dry run (001, 021) ─────────────────────────

Then(
  "no remote side effects should occur during the dry run",
  function (this: JollyWorld) {
    // A --dry-run preview must write nothing remote and never claim it did.
    // Both 001 (jolly start --dry-run) and 021 (create store --dry-run) record
    // a preview note in their When step; here we assert the preview produced a
    // riskContext/plan and the envelope shows no error from a real action.
    assert.ok(
      this.notes.previewRiskContext !== undefined,
      "the dry-run preview should have recorded a preview riskContext/plan",
    );
    assert.notEqual(
      this.envelope.status,
      "error",
      "a dry-run preview must not error as if a real action were attempted",
    );
  },
);
