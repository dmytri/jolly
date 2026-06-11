// Steps for features/009-agent-skill-installation-targets.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

function glueFiles(world: JollyWorld): Array<{ path: string; content: string }> {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    ".cursorrules",
    join(".cursor", "rules"),
    join(".zed", "instructions.md"),
    join(".opencode", "instructions.md"),
  ];
  return candidates
    .map((relative) => join(world.projectDir, relative))
    .filter((path) => existsSync(path) && statSync(path).isFile())
    .map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

// --- Jolly installs skills in standard project-local locations (@logic) -------

Given(
  "the agent invokes `jolly skills install`",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    this.runCli(["skills", "install", "--yes", "--json"], { timeoutMs: 150_000 });
  },
);

When("Jolly installs the default Saleor skill set", function (this: JollyWorld) {
  assert.notEqual(this.envelope.status, "error", this.lastRun!.stdout);
});

Then(
  "it should prefer standard project-local skill locations supported by the underlying skills tooling",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data),
      /skills/i,
      "no project-local skills location is reported",
    );
  },
);

Then(
  "it should avoid inventing a separate Jolly-only skill store unless required",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope.data),
      /\.jolly[/\\]skills|jolly-skill-store/i,
      "a Jolly-only skill store was invented",
    );
  },
);

Then(
  /^it should record or report installed versions using standard skills lock\/metadata files where possible$/,
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /version|lock|metadata/i,
      "installed skill versions are not recorded or reported",
    );
  },
);

// --- Jolly adds agent-specific glue (@logic) -----------------------------------

Given(
  "the skills have been installed or checked",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["skills", "install", "--yes", "--json"], {
      timeoutMs: 150_000,
    });
    assert.notEqual(result.envelope?.status, "error", result.stdout);
    writeFileSync(
      join(this.projectDir, "my-instructions.md"),
      "user-authored content — do not touch\n",
    );
  },
);

When(
  "the current or target agent environment needs additional setup",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
  },
);

Then(
  "Jolly should write or update agent-specific glue files or instructions",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /AGENTS\.md|CLAUDE\.md|\.cursor|\.zed|opencode|instructions/i,
      "no agent-specific glue files are written or reported",
    );
  },
);

Then("the glue should point the agent to the installed skills", function (this: JollyWorld) {
  const glue = glueFiles(this);
  assert.ok(glue.length > 0, "no glue files exist in the project");
  assert.ok(
    glue.some(({ content }) => /skill/i.test(content)),
    "glue files do not point the agent to the installed skills",
  );
});

Then(
  "the glue should avoid duplicating large skill contents when references are sufficient",
  function (this: JollyWorld) {
    for (const { path, content } of glueFiles(this)) {
      assert.ok(
        content.length < 64_000,
        `glue file ${path} is ${content.length} bytes; it should reference skills, not embed them`,
      );
    }
  },
);

Then(
  "Jolly should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    assert.equal(
      readFileSync(join(this.projectDir, "my-instructions.md"), "utf8"),
      "user-authored content — do not touch\n",
      "an unrelated user-authored instruction file was modified",
    );
  },
);
