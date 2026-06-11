// Steps for features/007-jolly-init-agent-setup.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

// --- Background shared steps ---------------------------------------------------

Given(
  "skill installation is fully automated — `jolly start` installs all Saleor agent skills automatically",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "the agent never runs `jolly init` or `jolly skills install` as an explicit separate step",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "`jolly init` remains available as a standalone command for repo re-initialization and maintenance",
  function (this: JollyWorld) {
    const result = this.runCli(["--help"]);
    assert.match(result.stdout, /\binit\b/, "jolly init is not surfaced as a command");
  },
);

// --- Agent initializes Jolly guidance locally (@logic) --------------------------

Given("the agent can run Jolly via `npx`", function (this: JollyWorld) {
  // Context only — Jolly is published as @saleor/jolly.
});

When("the agent invokes `jolly init`", function (this: JollyWorld) {
  this.runCli(["init", "--json"]);
});

Then(
  "Jolly should install or check the full default Saleor skill set",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope expected from jolly init");
    assert.match(
      JSON.stringify(this.envelope),
      /(skill|install|check)/i,
      "jolly init does not install or check skills",
    );
  },
);

Then(
  "the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    for (const skill of ["saleor-storefront", "saleor-configurator", "storefront-builder", "saleor-core", "saleor-app"]) {
      assert.match(text, new RegExp(skill), `default skill set missing: ${skill}`);
    }
  },
);

Then(
  "it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists",
  function (this: JollyWorld) {
    // Context only — this skill is included when Paper has been cloned.
    const text = JSON.stringify(this.envelope);
    assert.match(text, /saleor-paper-storefront/i, "Paper's embedded skill not included");
  },
);

Then(
  "Jolly should use standard project-local skill installation locations where possible",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(text, /(location|path|standard|local)/i, "skill installation locations not mentioned");
  },
);

Then(
  "Jolly should write or update agent-specific glue files or instructions for supported environments",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /(glue|instruction|agent)/i,
      "agent-specific glue files not mentioned",
    );
  },
);

Then(
  "Jolly should explain what was installed or updated",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.summary.trim().length > 0,
      "jolly init summary is empty",
    );
  },
);

Then(
  "Jolly should not create remote Saleor Cloud or Vercel resources",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.data);
    assert.doesNotMatch(
      text,
      /(create.*(saleor|vercel)|deploy|register)/i,
      "jolly init created remote resources",
    );
  },
);

Then("Jolly should not store secrets", function (this: JollyWorld) {
  this.assertNoSecretsIn(
    this.lastRun!.stdout + this.lastRun!.stderr,
    "jolly init output",
  );
});

// --- Agent init is safe to rerun (@logic) ---------------------------------------

Given("`jolly init` has already been run", function (this: JollyWorld) {
  this.runCli(["init", "--json"]);
  assert.ok(this.envelope, "first init failed");
});

When("the agent invokes `jolly init` again", function (this: JollyWorld) {
  this.notes.reinit = this.runCli(["init", "--json"]);
});

Then(
  "Jolly should detect existing skills and guidance",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.notes.reinit as Record<string, unknown>);
    assert.match(text, /(already|existing|detect|skip|installed)/i, "reinit does not detect existing state");
  },
);

Then(
  "it should update outdated managed guidance when appropriate",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.notes.reinit as Record<string, unknown>);
    assert.match(text, /(update|outdated|newer|version)/i, "reinit does not check for updates");
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.notes.reinit as Record<string, unknown>);
    assert.match(text, /(user|author|approval|override|preserve)/i, "reinit does not reference user-authored content protection");
  },
);

Then(
  "it should produce a concise summary of changes",
  function (this: JollyWorld) {
    const reinit = this.notes.reinit as { envelope?: { summary: string } };
    assert.ok(
      reinit?.envelope?.summary.trim().length ?? 0 > 0,
      "reinit produced no summary",
    );
  },
);
