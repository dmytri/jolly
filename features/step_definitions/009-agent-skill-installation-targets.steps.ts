// Steps for features/009-agent-skill-installation-targets.feature (@logic).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope } from "../support/cli.ts";
import type { JollyWorld } from "../support/world.ts";

const INSTALL_TIMEOUT = { timeout: 600_000 };
const USER_MARKER = "## User-authored: hands off (009 test marker)\n";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function glueFiles(world: JollyWorld): string[] {
  return filesUnder(world.projectDir).filter((path) =>
    /(^|\/)(AGENTS\.md|CLAUDE\.md|\.claude\/|\.cursor\/|\.zed\/|\.opencode\/|\.pi\/|\.cursorrules|\.rules)/i.test(
      path.slice(world.projectDir.length),
    ),
  );
}

Given(lit("the agent invokes `jolly skills install`"), function () {
  // The install itself happens in the When step.
});

When(lit("Jolly installs the default Saleor skill set"), INSTALL_TIMEOUT, async function (this: JollyWorld) {
  writeFileSync(join(this.projectDir, "AGENTS.md"), USER_MARKER);
  const run = await this.jolly(["skills", "install", "--json", "--yes"], { timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(run).status, "error", `skills install failed: ${run.stdout.slice(0, 500)}`);
});

Then(
  lit("it should prefer standard project-local skill locations supported by the underlying skills tooling"),
  function (this: JollyWorld) {
    const skillFiles = filesUnder(this.projectDir).filter((p) => /skill/i.test(p));
    assert.ok(skillFiles.length > 0, "no project-local skill files were installed");
  },
);

Then(
  lit("it should avoid inventing a separate Jolly-only skill store unless required"),
  function (this: JollyWorld) {
    assert.ok(
      !existsSync(join(this.projectDir, ".jolly", "skills")),
      "skills must live in standard locations, not a Jolly-only .jolly/skills store",
    );
  },
);

Then(
  lit("it should record or report installed versions using standard skills lock/metadata files where possible"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.lastRun!);
    const serialized = JSON.stringify(envelope.data);
    assert.ok(/version|lock|metadata/i.test(serialized), "install must report installed versions");
  },
);

Given(lit("the skills have been installed or checked"), INSTALL_TIMEOUT, async function (this: JollyWorld) {
  writeFileSync(join(this.projectDir, "AGENTS.md"), USER_MARKER);
  const run = await this.jolly(["skills", "install", "--json", "--yes"], { timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(run).status, "error", "skills install must succeed first");
});

When(lit("the current or target agent environment needs additional setup"), function () {
  // Premise; glue assertions below inspect what install wrote.
});

Then(lit("Jolly should write or update agent-specific glue files or instructions"), function (this: JollyWorld) {
  assert.ok(glueFiles(this).length > 0, "no agent-specific glue files were written");
});

Then(lit("the glue should point the agent to the installed skills"), function (this: JollyWorld) {
  const combined = glueFiles(this)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.ok(/skill/i.test(combined), "glue files must reference the installed skills");
});

Then(
  lit("the glue should avoid duplicating large skill contents when references are sufficient"),
  function (this: JollyWorld) {
    const skillBytes = filesUnder(this.projectDir)
      .filter((p) => /skill/i.test(p) && !glueFiles(this).includes(p))
      .reduce((sum, p) => sum + statSync(p).size, 0);
    const glueBytes = glueFiles(this).reduce((sum, p) => sum + statSync(p).size, 0);
    assert.ok(skillBytes > 0, "no installed skill content found to compare against");
    assert.ok(
      glueBytes < skillBytes,
      `glue (${glueBytes}B) must reference skills, not duplicate them (${skillBytes}B installed)`,
    );
  },
);

Then(
  lit("Jolly should avoid overwriting unrelated user-authored instructions without approval"),
  function (this: JollyWorld) {
    const content = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(content.includes(USER_MARKER.trim()), "user-authored AGENTS.md content was overwritten");
  },
);
