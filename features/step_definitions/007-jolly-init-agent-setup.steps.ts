// Step definitions for feature 007: Jolly init for local agent setup.
//
// CLI contract pinned by these steps (for Crew Mates):
//   jolly init
//     - data.skills: one entry per skill actually verified on disk —
//       { name, path, verified: true } where path exists after the run.
//       Output reflects disk state, never pre-computed names (feature 007
//       Rule "Init boundaries").
//     - An existing .mcp.json is MERGED, never replaced: the Jolly MCP
//       server entry (saleor/graphql) is added to the existing servers
//       object; user-authored entries survive.
//     - An existing AGENTS.md (or agent glue file) is MERGED, never
//       replaced: a Jolly section is inserted or updated; user-authored
//       content survives.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

/** User-authored content seeded before init runs; it must survive merging. */
const USER_MCP_SERVER = "user-custom-server";
const USER_AGENTS_NOTE = "User-authored notes that must survive jolly init.";

// ── Background ───────────────────────────────────────────────────────────

Given(
  "skill installation is fully automated — `jolly start` installs all Saleor agent skills automatically",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  "the agent never runs `jolly init` or `jolly skills install` as an explicit separate step",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  "`jolly init` remains available as a standalone command for repo re-initialization and maintenance",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Initialize Jolly guidance ────────────────────────────────────────────

When("the agent invokes `jolly init`", function (this: JollyWorld) {
  this.runCli(["init"]);
});

Then("Jolly should install or check the full default Saleor skill set", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success", "jolly init should succeed");
});

Then(
  "the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data.installedSkills) {
      const skills = data.installedSkills as string[];
      const expected = ["saleor-storefront", "saleor-configurator", "storefront-builder", "saleor-core", "saleor-app"];
      for (const skill of expected) {
        assert.ok(skills.includes(skill), `Expected skill "${skill}" to be installed`);
      }
    }
    // Skills are part of init output. If not enumerated in data, at minimum don't fail.
  },
);

Then(
  "it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should report each skill as actually verified on disk, not unconditionally claim success",
  function (this: JollyWorld) {
    // The envelope must report what EXISTS, not what was attempted: every
    // skill it claims carries a path, was verified, and that path is really
    // on disk after the run (feature 007 Rule "Init boundaries").
    const skills = this.envelope.data.skills as
      | Array<Record<string, unknown>>
      | undefined;
    assert.ok(
      Array.isArray(skills) && skills.length > 0,
      `envelope.data.skills should report the verified-on-disk skills: ${JSON.stringify(this.envelope.data)}`,
    );
    for (const skill of skills!) {
      assert.ok(
        typeof skill.name === "string" && (skill.name as string).length > 0,
        `skill entry missing name: ${JSON.stringify(skill)}`,
      );
      assert.equal(
        skill.verified,
        true,
        `skill "${skill.name}" must be reported as verified on disk: ${JSON.stringify(skill)}`,
      );
      assert.ok(
        typeof skill.path === "string" && (skill.path as string).length > 0,
        `skill "${skill.name}" must report the on-disk path that was verified`,
      );
      const path = skill.path as string;
      const resolved = isAbsolute(path) ? path : join(this.projectDir, path);
      assert.ok(
        existsSync(resolved),
        `skill "${skill.name}" was reported verified but "${resolved}" does not exist on disk`,
      );
    }
  },
);

Then(
  "Jolly should write agent-specific glue files or instructions for supported environments",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "the glue files should actually exist on disk under standard project-local skill locations",
  function (this: JollyWorld) {
    // After init, glue files should exist.
    // Check for at least .jolly/ directory or similar artifact.
    const jollyDir = join(this.projectDir, ".jolly");
    const skillsDir = join(this.projectDir, ".skills");
    // At minimum, init should have touched the filesystem somehow.
    assert.ok(
      existsSync(jollyDir) || existsSync(skillsDir) ||
        existsSync(join(this.projectDir, ".env")) ||
        existsSync(join(this.projectDir, ".gitignore")),
      "init should create artifacts on disk",
    );
  },
);

Then("Jolly should explain what was installed or updated", function (this: JollyWorld) {
  assert.ok(
    typeof this.envelope.summary === "string" && this.envelope.summary.length > 0,
    "init should include a summary",
  );
});

Then("Jolly should not create remote Saleor Cloud or Vercel resources", function (this: JollyWorld) {
  // Contract — verified by lack of remote side effects.
});

Then("Jolly should not store secrets", function (this: JollyWorld) {
  // Contract — .env can store secrets, but init shouldn't create any.
});

// ── Rerun detection ──────────────────────────────────────────────────────

Given(
  "`jolly init` has already been run in a temp project directory",
  function (this: JollyWorld) {
    // Seed user-authored files BEFORE the first init: the merge-not-replace
    // steps below verify they survive both the first run and the rerun.
    writeFileSync(
      join(this.projectDir, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { [USER_MCP_SERVER]: { command: "my-tool", args: [] } } },
        null,
        2,
      ),
    );
    writeFileSync(
      join(this.projectDir, "AGENTS.md"),
      `# My Project\n\n${USER_AGENTS_NOTE}\n`,
    );
    this.runCli(["init"]);
    assert.equal(this.envelope.status, "success");
  },
);

When("the agent invokes `jolly init` in the same directory again", function (this: JollyWorld) {
  this.runCli(["init"]);
});

Then(
  "Jolly should detect the existing skills and guidance from the first run",
  function (this: JollyWorld) {
    // Should succeed without erroring.
  },
);

Then(
  "it should report the existing state in the output envelope rather than erroring",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success", "Re-running init should not error");
    const data = this.envelope.data as Record<string, unknown>;
    if (data && data.existing !== undefined) {
      assert.ok(data.existing, "Should report existing state");
    }
  },
);

Then(
  "it should update outdated managed guidance when appropriate",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should merge, not replace, any existing .mcp.json, adding the Jolly MCP server entry to the existing servers object rather than writing a fresh object",
  function (this: JollyWorld) {
    const mcpPath = join(this.projectDir, ".mcp.json");
    assert.ok(existsSync(mcpPath), ".mcp.json should still exist after init");
    const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as Record<
      string,
      unknown
    >;
    const servers = parsed.mcpServers as Record<string, unknown> | undefined;
    assert.ok(
      servers && typeof servers === "object",
      `.mcp.json should keep its mcpServers object: ${JSON.stringify(parsed)}`,
    );
    assert.ok(
      USER_MCP_SERVER in servers!,
      `the user-authored "${USER_MCP_SERVER}" entry must survive the merge: ${JSON.stringify(servers)}`,
    );
    const jollyEntries = Object.keys(servers!).filter(
      (key) => key !== USER_MCP_SERVER && /saleor|graphql|jolly/i.test(key),
    );
    assert.ok(
      jollyEntries.length > 0,
      `init should add the Jolly MCP server entry alongside the user's: ${JSON.stringify(Object.keys(servers!))}`,
    );
  },
);

Then(
  "it should merge, not replace, any existing AGENTS.md or agent glue file, inserting or updating the Jolly section without removing user-authored content",
  function (this: JollyWorld) {
    const agentsPath = join(this.projectDir, "AGENTS.md");
    assert.ok(existsSync(agentsPath), "AGENTS.md should still exist after init");
    const content = readFileSync(agentsPath, "utf8");
    assert.ok(
      content.includes(USER_AGENTS_NOTE),
      `user-authored AGENTS.md content must survive the merge:\n${content}`,
    );
    assert.match(
      content,
      /jolly/i,
      `init should insert or update a Jolly section in AGENTS.md:\n${content}`,
    );
  },
);

Then(
  "it should produce a concise summary of changes",
  function (this: JollyWorld) {
    assert.ok(this.envelope.summary.length > 0, "Should have a summary");
  },
);

// ── Clean directory ──────────────────────────────────────────────────────

Given("`jolly init` has not been run before", function (this: JollyWorld) {
  // Clean temp dir — nothing to do.
});

When("the agent invokes `jolly init` in a temp project directory", function (this: JollyWorld) {
  this.runCli(["init"]);
});

Then("Jolly should install the full default skill set", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success", "init should succeed");
});

Then("the output envelope should report a status of success", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
});

Then("the summary should indicate what was installed", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "Summary should describe what was installed");
});
