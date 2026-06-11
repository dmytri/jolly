// Steps for features/008-jolly-create-subcommands.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  assertRiskContextShape,
  findRiskContexts,
} from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

const CREATE_SUBCOMMANDS = ["store", "storefront", "recipe", "deployment"];

// --- Background (shared with feature 020) -------------------------------------

Given("Jolly is executable via `npx`", function (this: JollyWorld) {
  // Pinned distribution principle; the CLI seam invokes the local entry the
  // same way `npx @saleor/jolly` would.
});

Given(
  "`jolly start` is available as optional convenience orchestration for the full end-to-end flow",
  function (this: JollyWorld) {
    // Pinned command-surface principle; context only.
  },
);

// --- Agent discovers create subcommands (@logic) -------------------------------

Given("the agent needs to create a specific resource", function (this: JollyWorld) {
  // Context only.
});

When("it inspects `jolly create --help`", function (this: JollyWorld) {
  this.notes.createHelp = this.runCli(["create", "--help"]);
});

Then("it should see focused subcommands", function (this: JollyWorld) {
  const help = this.notes.createHelp as { stdout: string };
  for (const subcommand of CREATE_SUBCOMMANDS) {
    assert.match(
      help.stdout,
      new RegExp(`\\b${subcommand}\\b`),
      `\`jolly create ${subcommand}\` is not listed in create --help`,
    );
  }
});

Then("each subcommand should have a clear resource boundary", function (this: JollyWorld) {
  const help = (this.notes.createHelp as { stdout: string }).stdout;
  for (const subcommand of CREATE_SUBCOMMANDS) {
    const match = help
      .split("\n")
      .map((line) => new RegExp(`^\\s*${subcommand}\\b\\s*(.*)$`).exec(line))
      .find((m) => m !== null);
    assert.ok(match, `no help line for ${subcommand}`);
    assert.ok(
      match![1].trim().length > 0,
      `\`jolly create ${subcommand}\` has no description of its resource boundary`,
    );
  }
});

Then(
  "the help output should be understandable to both agents and humans",
  function (this: JollyWorld) {
    const result = this.notes.createHelp as { stdout: string; exitCode: number };
    assert.equal(result.exitCode, 0, "create --help failed");
    assert.ok(result.stdout.trim().length > 0, "create --help printed nothing");
  },
);

// --- Agent composes create subcommands or uses start as convenience (@logic) ---

Given("the customer wants the full end-to-end setup", function (this: JollyWorld) {
  // Context only.
});

When("the agent decides how to proceed", function (this: JollyWorld) {
  this.notes.help = this.runCli(["--help"]);
});

Then(
  "the agent may invoke `jolly start` as a convenience wrapper for the full flow",
  function (this: JollyWorld) {
    assert.match(
      (this.notes.help as { stdout: string }).stdout,
      /\bstart\b/,
      "`jolly start` is not available",
    );
  },
);

Then(
  "the agent may invoke individual `jolly create` subcommands at its own discretion",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "--help"]);
    for (const subcommand of CREATE_SUBCOMMANDS) {
      assert.match(result.stdout, new RegExp(`\\b${subcommand}\\b`));
    }
  },
);

Then(
  "each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur",
  function (this: JollyWorld) {
    // Preview every create subcommand: each must carry a structured
    // riskContext (feature 021) without performing side effects.
    for (const subcommand of CREATE_SUBCOMMANDS) {
      const result = this.runCli(["create", subcommand, "--dry-run", "--json"]);
      assert.ok(
        result.envelope,
        `\`jolly create ${subcommand} --dry-run\` emitted no envelope`,
      );
      const contexts = findRiskContexts(result.envelope);
      assert.ok(
        contexts.length > 0,
        `\`jolly create ${subcommand}\` exposes no riskContext`,
      );
      for (const rc of contexts) assertRiskContextShape(rc);
    }
  },
);
