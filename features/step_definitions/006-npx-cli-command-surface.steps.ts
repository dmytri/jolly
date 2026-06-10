// Steps for features/006-npx-cli-command-surface.feature (@logic).
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, stripEnvelopeJson, hasHumanText } from "../support/cli.ts";
import { envelopeProblems } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// Expected command concepts pinned by the CLI distribution principles rule.
const EXPECTED_COMMANDS = [
  "init",
  "create",
  "start",
  "skills",
  "deploy",
  "doctor",
  "upgrade",
  "login",
  "logout",
  "auth",
];

Given(lit("the customer wants the end-to-end guided Saleor storefront setup"), function () {
  // Premise.
});

When(lit("the agent invokes the primary guided command"), async function (this: JollyWorld) {
  const help = await this.jolly(["--help"]);
  assert.equal(help.exitCode, 0, `\`jolly --help\` failed:\n${help.stderr.slice(0, 1000)}`);
  this.vars.set("helpText", help.stdout);
});

Then(
  lit("`jolly start` should be available as optional convenience orchestration for the full end-to-end flow"),
  function (this: JollyWorld) {
    const help = this.vars.get("helpText") as string;
    assert.ok(/\bstart\b/.test(help), "`jolly --help` must list the start command");
  },
);

Then(
  lit("the agent may instead invoke individual composable subcommands for each stage"),
  function (this: JollyWorld) {
    const help = this.vars.get("helpText") as string;
    const missing = EXPECTED_COMMANDS.filter((command) => !new RegExp(`\\b${command}\\b`).test(help));
    assert.deepEqual(missing, [], `\`jolly --help\` is missing expected commands: ${missing.join(", ")}`);
  },
);

Then(
  lit("the output should follow Jolly's hybrid human-readable plus machine-readable format"),
  async function (this: JollyWorld) {
    // Default mode of a real command: concise human text plus the envelope.
    const run = await this.jolly(["doctor"]);
    const envelope = requireEnvelope(run);
    assert.deepEqual(envelopeProblems(envelope), []);
    assert.ok(
      hasHumanText(stripEnvelopeJson(run.stdout)),
      "default output must include human-readable text alongside the envelope",
    );
  },
);
