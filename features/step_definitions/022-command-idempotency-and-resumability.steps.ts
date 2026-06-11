// Steps for features/022-command-idempotency-and-resumability.feature
// (pinned contract).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliResult, JollyWorld } from "../support/world.ts";

const CLONE_TIMEOUT_MS = 900_000;

// --- Background -------------------------------------------------------------------

Given(
  "`jolly start` is optional convenience orchestration for the full end-to-end flow",
  function (this: JollyWorld) {
    // Pinned command-surface principle; context only.
  },
);

Given(
  "the agent may instead invoke individual `jolly create` subcommands at its own discretion",
  function (this: JollyWorld) {
    // Pinned command-surface principle; context only.
  },
);

// --- Re-running a create subcommand detects existing work (@sandbox) ----------------

Given(
  "a `jolly create` subcommand has already completed its resource",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    assert.equal(
      result.envelope?.status,
      "success",
      `the first run did not complete: ${result.stdout}`,
    );
  },
);

When(
  "the agent invokes the same subcommand again",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
  },
);

Then("Jolly should detect the already-completed work", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /already|exist|satisfied|skipped|detected/i,
    "the rerun does not report detection of completed work",
  );
});

Then(
  "it should not create a duplicate store, clone, recipe, or deployment",
  function (this: JollyWorld) {
    const clones = readdirSync(this.projectDir).filter((entry) =>
      /^storefront/.test(entry),
    );
    assert.deepEqual(
      clones,
      ["storefront"],
      `duplicate storefront artifacts were created: ${clones.join(", ")}`,
    );
  },
);

Then(
  "it should report the detected existing state through the standard output envelope",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data) + JSON.stringify(this.envelope.checks),
      /already|exist|satisfied|skipped/i,
      "existing state is not reported through the envelope",
    );
  },
);

Then(
  'it should not fail merely because the resource already exists',
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "error",
      "the rerun failed on already-existing work",
    );
  },
);

// --- Jolly start resumes from the first incomplete stage (@sandbox) -------------------

Given(
  "a previous `jolly start` run completed some stages but not others",
  { timeout: 1_800_000 },
  function (this: JollyWorld) {
    // Withhold the Stripe configuration so the payment stage cannot complete.
    this.notes.partialRun = this.runCli(["start", "--yes", "--json"], {
      env: {
        JOLLY_STRIPE_SECRET_KEY: undefined,
        JOLLY_STRIPE_PUBLISHABLE_KEY: undefined,
      },
      timeoutMs: 1_740_000,
    });
  },
);

When(
  "the agent runs `jolly start` again",
  { timeout: 1_800_000 },
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 1_740_000 });
  },
);

Then(
  "Jolly should detect which stages are already satisfied",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /satisfied|already|skipped|stage/i,
      "the resumed run does not report stage satisfaction",
    );
  },
);

Then("it should skip the satisfied stages", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /skip/i,
    "the resumed run reports no skipped stages",
  );
});

Then(
  "it should continue from the first incomplete stage",
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "error",
      "the resumed run did not continue past the satisfied stages",
    );
  },
);

Then(
  "it should report which stages were skipped versus performed in the output envelope",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.data) + JSON.stringify(this.envelope.checks);
    assert.match(text, /skip/i, "skipped stages are not reported");
    assert.match(
      text,
      /performed|completed|ran|done/i,
      "performed stages are not reported",
    );
  },
);

// --- Composed subcommands and start agree on state (@sandbox) --------------------------

Given(
  "the agent has already run individual `jolly create` subcommands",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    assert.equal(result.envelope?.status, "success", result.stdout);
    this.notes.storefrontListing = readdirSync(join(this.projectDir, "storefront")).sort();
  },
);

When(
  "the agent later runs `jolly start`",
  { timeout: 1_800_000 },
  function (this: JollyWorld) {
    this.runCli(["start", "--yes", "--json"], { timeoutMs: 1_740_000 });
  },
);

Then(
  "`jolly start` should treat the work done by those subcommands as already satisfied",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /satisfied|already|skip/i,
      "start does not recognize the subcommand's completed work",
    );
  },
);

Then("it should not redo or duplicate that work", function (this: JollyWorld) {
  const clones = readdirSync(this.projectDir).filter((entry) =>
    /^storefront/.test(entry),
  );
  assert.deepEqual(clones, ["storefront"], "start duplicated the storefront work");
  assert.deepEqual(
    readdirSync(join(this.projectDir, "storefront")).sort(),
    this.notes.storefrontListing,
    "start redid the storefront work",
  );
});

// --- Collisions pause instead of overwriting (@logic) -----------------------------------

Given(
  "a step would otherwise overwrite existing local or remote state it did not create",
  function (this: JollyWorld) {
    mkdirSync(join(this.projectDir, "storefront"));
    writeFileSync(
      join(this.projectDir, "storefront", "keep.txt"),
      "pre-existing state",
    );
  },
);

When("the conflict is detected", function (this: JollyWorld) {
  this.notes.collisionRun = this.runCli(["create", "storefront", "--yes", "--json"]);
});

Then(
  "Jolly should pause and ask how to resolve the collision",
  function (this: JollyWorld) {
    const run = this.notes.collisionRun as CliResult;
    assert.ok(run.envelope, "the collision produced no envelope");
    assert.notEqual(
      run.envelope!.status,
      "success",
      "Jolly proceeded through the collision without pausing",
    );
    assert.match(
      JSON.stringify(run.envelope),
      /exist|collision|conflict/i,
      "the collision is not surfaced to the agent",
    );
    assert.ok(
      run.envelope!.nextSteps.length > 0 || run.envelope!.errors.length > 0,
      "no resolution guidance is offered for the collision",
    );
  },
);

Then("it should not silently overwrite the existing state", function (this: JollyWorld) {
  assert.equal(
    readFileSync(join(this.projectDir, "storefront", "keep.txt"), "utf8"),
    "pre-existing state",
    "pre-existing state was overwritten",
  );
});

Then(
  "this should follow the same collision handling as the storefront target directory in feature 002",
  function (this: JollyWorld) {
    // Cross-reference; the behavior above is the feature 002 handling.
  },
);
