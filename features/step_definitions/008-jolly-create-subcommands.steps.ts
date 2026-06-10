// Steps for features/008-jolly-create-subcommands.feature (@logic).
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope } from "../support/cli.ts";
import { findRiskContexts, riskContextProblems } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// V1 create subcommands pinned by the feature's rule block.
const CREATE_SUBCOMMANDS = ["store", "storefront", "recipe", "deployment"];

Given(
  lit("`jolly start` is available as optional convenience orchestration for the full end-to-end flow"),
  function () {
    // Premise (asserted concretely by the steps below and feature 006).
  },
);

Given(lit("the agent needs to create a specific resource"), function () {
  // Premise.
});

When(lit("it inspects `jolly create --help`"), async function (this: JollyWorld) {
  const run = await this.jolly(["create", "--help"]);
  assert.equal(run.exitCode, 0, `\`jolly create --help\` failed:\n${run.stderr.slice(0, 1000)}`);
  this.vars.set("createHelp", run.stdout);
});

Then(lit("it should see focused subcommands"), function (this: JollyWorld) {
  const help = this.vars.get("createHelp") as string;
  const missing = CREATE_SUBCOMMANDS.filter((sub) => !new RegExp(`\\b${sub}\\b`).test(help));
  assert.deepEqual(missing, [], `create --help is missing v1 subcommands: ${missing.join(", ")}`);
});

Then(lit("each subcommand should have a clear resource boundary"), function (this: JollyWorld) {
  // Each v1 subcommand is named for exactly one resource and is documented on
  // its own line with a description.
  const help = this.vars.get("createHelp") as string;
  for (const sub of CREATE_SUBCOMMANDS) {
    const line = help.split("\n").find((l) => new RegExp(`^\\s*${sub}\\b`).test(l));
    assert.ok(line, `no help line for create subcommand ${sub}`);
    assert.ok(
      line.replace(new RegExp(`^\\s*${sub}\\b`), "").trim().length > 0,
      `create subcommand ${sub} has no description`,
    );
  }
});

Then(lit("the help output should be understandable to both agents and humans"), function (this: JollyWorld) {
  const help = this.vars.get("createHelp") as string;
  assert.ok(/usage/i.test(help), "help must include a usage section");
  assert.ok(help.trim().length > 100, "help must carry real descriptions, not bare command names");
});

Given(lit("the customer wants the full end-to-end setup"), function () {
  // Premise.
});

When(lit("the agent decides how to proceed"), async function (this: JollyWorld) {
  const run = await this.jolly(["--help"]);
  assert.equal(run.exitCode, 0);
  this.vars.set("rootHelp", run.stdout);
});

Then(
  lit("the agent may invoke `jolly start` as a convenience wrapper for the full flow"),
  function (this: JollyWorld) {
    assert.ok(/\bstart\b/.test(this.vars.get("rootHelp") as string), "root help must list start");
  },
);

Then(
  lit("the agent may invoke individual `jolly create` subcommands at its own discretion"),
  async function (this: JollyWorld) {
    const run = await this.jolly(["create", "--help"]);
    assert.equal(run.exitCode, 0);
    for (const sub of CREATE_SUBCOMMANDS) {
      assert.ok(new RegExp(`\\b${sub}\\b`).test(run.stdout), `create --help missing ${sub}`);
    }
  },
);

Then(
  lit(
    "each resource creation step should expose enough information for the customer's agent to decide whether review or approval is needed before remote side effects occur",
  ),
  async function (this: JollyWorld) {
    // Before side effects = preview mode; every create subcommand must expose
    // a valid riskContext (feature 021) in its --dry-run envelope.
    for (const sub of CREATE_SUBCOMMANDS) {
      const run = await this.jolly(["create", sub, "--dry-run", "--json", "--yes"]);
      const envelope = requireEnvelope(run);
      const contexts = findRiskContexts(envelope);
      assert.ok(contexts.length > 0, `jolly create ${sub} --dry-run exposes no riskContext`);
      for (const context of contexts) {
        assert.deepEqual(riskContextProblems(context), [], `jolly create ${sub}: ${JSON.stringify(context)}`);
      }
    }
  },
);
