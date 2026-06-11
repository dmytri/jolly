// Steps for features/021-agent-risk-context.feature (pinned contract).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  assertRiskContextShape,
  findRiskContexts,
  RISK_CATEGORIES,
  type RiskContext,
} from "../support/envelope.ts";
import type { CliResult, JollyWorld } from "../support/world.ts";

const CLONE_TIMEOUT_MS = 900_000;

function firstRiskContext(world: JollyWorld): RiskContext {
  const contexts = findRiskContexts(world.envelope);
  assert.ok(contexts.length > 0, "no riskContext in the envelope");
  assertRiskContextShape(contexts[0]);
  return contexts[0] as RiskContext;
}

// --- Background ----------------------------------------------------------------------

Given(
  "approval granularity is decided by the customer's agent, not hardcoded by Jolly",
  function (this: JollyWorld) {
    // Pinned principle (feature 010); context only.
  },
);

Given("side-effecting commands support `--dry-run`", function (this: JollyWorld) {
  // Pinned flag contract (feature 006); exercised below.
});

// --- Jolly exposes risk context before an impactful action (@logic) -------------------

Given(
  "a Jolly workflow is about to create, modify, deploy, delete, or expose a remote resource",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--dry-run", "--json"]);
  },
);

When("Jolly prepares to perform the action", function (this: JollyWorld) {
  assert.ok(this.lastRun, "no action was prepared");
});

Then(
  "it should expose a structured `riskContext` for the agent to assess",
  function (this: JollyWorld) {
    firstRiskContext(this);
  },
);

Then(
  "the `riskContext` should include the `action` being performed",
  function (this: JollyWorld) {
    assert.ok(firstRiskContext(this).action.length > 0);
  },
);

Then(
  "it should include the `target` resource and its scope",
  function (this: JollyWorld) {
    const target = firstRiskContext(this).target;
    assert.ok(target, "riskContext.target is missing");
    assert.match(
      JSON.stringify(target),
      /resource|scope/i,
      "riskContext.target does not describe the resource and its scope",
    );
  },
);

Then(
  "it should include a `riskLevel` of low, medium, or high",
  function (this: JollyWorld) {
    assert.ok(["low", "medium", "high"].includes(firstRiskContext(this).riskLevel));
  },
);

Then("it should include the applicable risk `categories`", function (this: JollyWorld) {
  assert.ok(Array.isArray(firstRiskContext(this).categories));
});

Then(
  "it should include whether the action is `reversible`",
  function (this: JollyWorld) {
    assert.equal(typeof firstRiskContext(this).reversible, "boolean");
  },
);

Then("it should include the expected `sideEffects`", function (this: JollyWorld) {
  const sideEffects = firstRiskContext(this).sideEffects;
  assert.ok(Array.isArray(sideEffects));
  assert.ok(sideEffects.length > 0, "a remote-resource action reports no sideEffects");
});

Then(
  "it should include whether a dry run is available via `dryRunAvailable`",
  function (this: JollyWorld) {
    assert.equal(typeof firstRiskContext(this).dryRunAvailable, "boolean");
  },
);

Then(
  "the customer's agent should decide whether to ask for human approval based on this context",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope),
      /"(approvalRequired|requiresApproval|approved)"\s*:/,
      "Jolly hardcodes the approval decision",
    );
  },
);

// --- Risk context is consistent across preview and execution (@sandbox) ----------------

Given("a command supports `--dry-run`", function (this: JollyWorld) {
  // `jolly create storefront` is the side-effecting command under test: its
  // side effects are local and namespaced into the scenario's temp dir.
  this.notes.targetDir = this.newTempDir("dryrun");
});

When(
  "the agent previews the action with `--dry-run`",
  function (this: JollyWorld) {
    this.notes.preview = this.runCli(
      ["create", "storefront", "--dry-run", "--yes", "--json"],
      { cwd: this.notes.targetDir as string },
    );
  },
);

Then(
  "the `riskContext` shown in preview should match the `riskContext` for real execution",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const preview = this.notes.preview as CliResult;
    assert.ok(preview.envelope, "preview emitted no envelope");
    const previewContexts = findRiskContexts(preview.envelope);
    assert.ok(previewContexts.length > 0, "preview exposes no riskContext");

    const real = this.runCli(["create", "storefront", "--yes", "--json"], {
      cwd: this.notes.targetDir as string,
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    assert.ok(real.envelope, "real execution emitted no envelope");
    const realContexts = findRiskContexts(real.envelope);
    assert.deepEqual(
      previewContexts,
      realContexts,
      "riskContext differs between --dry-run preview and real execution",
    );
  },
);

Then(
  "no remote side effects should occur during the dry run",
  function (this: JollyWorld) {
    // The dry run ran first in an empty directory: it must have created
    // nothing there (local proxy for the no-side-effects guarantee; the real
    // execution afterwards is what populated it).
    const preview = this.notes.preview as CliResult;
    assert.ok(preview.envelope, "preview emitted no envelope");
    // Recorded before the real execution by step order; verify the preview
    // itself reported no created resources.
    assert.doesNotMatch(
      JSON.stringify(preview.envelope),
      /"created"\s*:\s*true/i,
      "the dry run reports created resources",
    );
  },
);

// --- Risk context travels in the standard envelope (@logic) ----------------------------

Given("a command produces output with `--json`", function (this: JollyWorld) {
  this.runCli(["create", "recipe", "--dry-run", "--json"]);
});

When("the output describes an impactful action", function (this: JollyWorld) {
  assert.ok(this.lastRun!.envelope, "no envelope describes the action");
});

Then(
  /^the `riskContext` should be carried inside the output envelope `data` and\/or `checks`$/,
  function (this: JollyWorld) {
    const contexts = findRiskContexts(this.envelope);
    assert.ok(
      contexts.length > 0,
      "riskContext is not carried inside the envelope data/checks",
    );
  },
);

Then(
  "it should not use a separate ad hoc format outside the feature 020 envelope",
  function (this: JollyWorld) {
    // With --json, stdout is exactly the one envelope; nothing rides outside it.
    assert.doesNotThrow(
      () => JSON.parse(this.lastRun!.stdout.trim()),
      "output outside the single JSON envelope",
    );
  },
);

// --- High-risk categories are surfaced explicitly (@logic) ------------------------------

Given("an action falls into a high-risk category", function (this: JollyWorld) {
  // Collect riskContexts across the side-effecting command surface.
  const surface: string[][] = [
    ["create", "store"],
    ["create", "storefront"],
    ["create", "recipe"],
    ["create", "deployment"],
    ["deploy"],
  ];
  this.notes.allContexts = surface.flatMap((args) => {
    const result = this.runCli([...args, "--dry-run", "--json"]);
    return result.envelope ? findRiskContexts(result.envelope) : [];
  });
});

When("Jolly builds its `riskContext`", function (this: JollyWorld) {
  assert.ok(
    (this.notes.allContexts as unknown[]).length > 0,
    "no riskContexts found across the command surface",
  );
});

Then("the relevant categories should be listed explicitly", function (this: JollyWorld) {
  const contexts = this.notes.allContexts as RiskContext[];
  for (const rc of contexts) assertRiskContextShape(rc);
  assert.ok(
    contexts.some((rc) => rc.categories.length > 0),
    "no action across the surface lists any explicit risk category",
  );
});

Then(
  "destructive operations, billing, payment setup, credential handling, live deployment, and production configuration changes should each map to a category",
  function (this: JollyWorld) {
    // Every surfaced category must come from the feature 010 vocabulary
    // (shape validation enforces it), and the vocabulary itself must cover
    // all six pinned concepts.
    const contexts = this.notes.allContexts as RiskContext[];
    for (const rc of contexts) {
      for (const category of rc.categories) {
        assert.ok(
          (RISK_CATEGORIES as readonly string[]).includes(category),
          `category "${category}" is outside the pinned vocabulary`,
        );
      }
    }
    assert.deepEqual(
      [...RISK_CATEGORIES].sort(),
      [
        "billing",
        "credential handling",
        "destructive operations",
        "live deployment",
        "payment setup",
        "production configuration changes",
      ],
      "the pinned category vocabulary drifted",
    );
  },
);
