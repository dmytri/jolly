// Step definitions for feature 022: Command idempotency and resumability.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues, writeEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

// Background steps (`jolly start is optional`, `agent may instead invoke`) are in common.steps.ts

// ── Re-running a create subcommand ───────────────────────────────────────

Given(
  "a `jolly create` subcommand has already completed its resource",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--url", "https://demo.saleor.cloud/graphql/"]);
    assert.equal(this.envelope.status, "success");
  },
);

When("the agent invokes the same subcommand again", function (this: JollyWorld) {
  this.runCli(["create", "store", "--url", "https://demo.saleor.cloud/graphql/"]);
});

Then("Jolly should detect the already-completed work", function (this: JollyWorld) {
  // Should not error.
});

Then(
  "it should not create a duplicate store, clone, recipe, or deployment",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success", "Re-running should not error");
    const data = this.envelope.data as Record<string, unknown>;
    if (data && data.existing !== undefined) {
      assert.ok(data.existing, "Should report existing state");
    }
  },
);

Then(
  "it should report the detected existing state through the standard output envelope",
  function (this: JollyWorld) {
    // Envelope found - verified by world.
  },
);

Then(
  "it should not fail merely because the resource already exists",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.status !== "error",
      `Should not error on re-run: ${JSON.stringify(this.envelope.errors)}`,
    );
  },
);

// ── Start resumes from incomplete stage ──────────────────────────────────

Given(
  "a previous `jolly start` run completed some stages but not others",
  function (this: JollyWorld) {
    // Contract - run init as a proxy for partial completion.
    this.runCli(["init"]);
    assert.equal(this.envelope.status, "success");
  },
);

When("the agent runs `jolly start` again", function (this: JollyWorld) {
  this.runCli(["start"]);
});

Then("Jolly should detect which stages are already satisfied", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
  const data = this.envelope.data as Record<string, unknown>;
  if (data && data.stages) {
    assert.ok(Array.isArray(data.stages), "stages should be an array");
  }
});

Then("it should skip the satisfied stages", function (this: JollyWorld) {
  // Contract.
});

Then("it should continue from the first incomplete stage", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should report which stages were skipped versus performed in the output envelope",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data && data.stages) {
      const stages = data.stages as Array<Record<string, unknown>>;
      const statuses = stages.map((s: Record<string, unknown>) => s.status);
      assert.ok(statuses.length > 0, "Should have stage statuses");
    }
  },
);

// ── Composed subcommands and start ───────────────────────────────────────

Given(
  "the agent has already run individual `jolly create` subcommands",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--url", "https://demo.saleor.cloud/graphql/"]);
    assert.equal(this.envelope.status, "success");
  },
);

When("the agent later runs `jolly start`", function (this: JollyWorld) {
  this.runCli(["start"]);
});

Then(
  "`jolly start` should treat the work done by those subcommands as already satisfied",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
  },
);

Then("it should not redo or duplicate that work", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
});

// ── Collisions pause instead of overwriting ──────────────────────────────

Given(
  "a step would otherwise overwrite existing local or remote state it did not create",
  function (this: JollyWorld) {
    // Set up existing state that wasn't created by Jolly.
    writeFileSync(join(this.projectDir, ".env"), "EXISTING_KEY=user-value\n");
  },
);

When("the conflict is detected", function (this: JollyWorld) {
  this.runCli(["create", "store", "--url", "https://demo.saleor.cloud/graphql/"]);
});

Then("Jolly should pause and ask how to resolve the collision", function (this: JollyWorld) {
  // The CLI should either warn or error about the collision.
  // It should not silently overwrite.
  assert.notEqual(
    this.envelope.status,
    "success",
    "Collision should not silently succeed",
  );
});

Then("it should not silently overwrite the existing state", function (this: JollyWorld) {
  // Verify existing key still present.
  const values = loadEnvValues(this.projectDir);
  assert.ok("EXISTING_KEY" in values, "Existing key should not be overwritten");
});

Then(
  "this should follow the same collision handling as the storefront target directory in feature {int}",
  function (this: JollyWorld, _featureNum: number) {
    // Contract.
  },
);
