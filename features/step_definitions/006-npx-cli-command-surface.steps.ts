// Steps for features/006-npx-cli-command-surface.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

Given(
  "the customer wants the end-to-end guided Saleor storefront setup",
  function (this: JollyWorld) {
    // Context only.
  },
);

When("the agent invokes the primary guided command", function (this: JollyWorld) {
  this.notes.help = this.runCli(["--help"]);
});

Then(
  "`jolly start` should be available as optional convenience orchestration for the full end-to-end flow",
  function (this: JollyWorld) {
    const help = this.notes.help as { stdout: string };
    assert.match(help.stdout, /\bstart\b/, "`jolly start` is not an available command");
  },
);

Then(
  "the agent may instead invoke individual composable subcommands for each stage",
  function (this: JollyWorld) {
    const help = this.notes.help as { stdout: string };
    for (const command of ["init", "create", "skills", "deploy", "doctor", "upgrade"]) {
      assert.match(
        help.stdout,
        new RegExp(`\\b${command}\\b`),
        `composable subcommand \`${command}\` is not surfaced`,
      );
    }
  },
);

Then(
  "the output should follow Jolly's hybrid human-readable plus machine-readable format",
  function (this: JollyWorld) {
    // Default mode: concise human text plus the machine-readable envelope.
    const result = this.runCli(["doctor"]);
    assert.ok(result.envelope, "default output carries no machine-readable envelope");
    const withoutEnvelope = result.stdout.replace(/\{[\s\S]*\}/, "").trim();
    assert.ok(
      withoutEnvelope.length > 0,
      "default output carries no human-readable text alongside the envelope",
    );
  },
);
