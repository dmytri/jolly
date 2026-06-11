// Steps for features/009-agent-skill-installation-targets.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

// --- Jolly installs skills in standard project-local locations (@logic) ---------

Given("the agent invokes `jolly skills install`", function (this: JollyWorld) {
  // Context only — this command is part of the Jolly CLI surface.
  const help = this.runCli(["skills", "--help"]).stdout;
  assert.match(help, /\binstall\b/, "'jolly skills install' is not a recognized command");
});

When("Jolly installs the default Saleor skill set", function (this: JollyWorld) {
  this.runCli(["skills", "install", "--json"]);
});

Then(
  "it should prefer standard project-local skill locations supported by the underlying skills tooling",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(project.local|standard|default|location)/i,
      "skill installation does not prefer standard project-local locations",
    );
  },
);

Then(
  "it should avoid inventing a separate Jolly-only skill store unless required",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.doesNotMatch(
      text,
      /Jolly-only skill.store|jolly.only.store|separate.*Jolly.*skill/i,
      "skill installation created a separate Jolly-only skill store",
    );
  },
);

Then(
  "it should record or report installed versions using standard skills lock\\/metadata files where possible",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /(version|lock|metadata)/i,
      "skill installation does not record or report versions",
    );
  },
);

// --- Jolly adds agent-specific glue (@logic) ------------------------------------

Given("the skills have been installed or checked", function (this: JollyWorld) {
  // Context only — skills are present.
});

When(
  "the current or target agent environment needs additional setup",
  function (this: JollyWorld) {
    this.runCli(["skills", "install", "--json"]);
  },
);

Then(
  "Jolly should write or update agent-specific glue files or instructions",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(glue|instruction|agent)/i,
      "Jolly does not write agent-specific glue files",
    );
  },
);

Then(
  "the glue should point the agent to the installed skills",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(skill|location|path|include|reference)/i,
      "glue does not point to installed skills",
    );
  },
);

Then(
  "the glue should avoid duplicating large skill contents when references are sufficient",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    assert.match(
      text,
      /(reference|include|import)/i,
      "glue does not reference skills instead of duplicating",
    );
  },
);

Then(
  "Jolly should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /(user|author|approval|override|preserve)/i,
      "no user-authored instruction protection mentioned",
    );
  },
);
