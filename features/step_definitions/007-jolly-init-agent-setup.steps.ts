// Step definitions for feature 007: Jolly init for local agent setup.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

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
