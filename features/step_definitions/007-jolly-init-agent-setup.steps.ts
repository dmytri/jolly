// Feature 007 — Jolly init for local agent setup.
//
// @logic scenarios pinning `jolly init`: it installs/checks the default skill
// set via `npx skills add`, verifies each skill ACTUALLY ON DISK (never an
// unconditional claim), merges (never replaces) `.mcp.json` and `AGENTS.md`,
// creates no remote resources, and stores no secrets. Safe to rerun: it
// detects existing state and reports it rather than erroring.
//
// Determinism vs the network: `npx skills add` reaches a registry that is not
// reachable in the @logic harness, so init would honestly fail (status error,
// SKILL_INSTALL_FAILED) with the skills unverified on disk. To pin the
// "verified-on-disk success" and merge behavior independent of network, these
// steps pre-seed the standard project-local skill directories
// (.claude/skills/<id>) so init verifies them on disk and skips `npx`. The
// honest-failure path is asserted separately by leaving them absent.
//
// Safety: every command runs under logicSafeEnv() — dummy credentials and an
// unroutable Cloud API base — so no path can reach a real account, and the
// merges happen in the scenario's temp project directory.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv, DUMMY_SECRETS } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

const DEFAULT_SKILL_IDS = [
  "jolly",
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
];

function skillsBaseDir(world: JollyWorld): string {
  return join(world.projectDir, ".claude", "skills");
}

/** Pre-seed the standard project-local skill locations so init verifies them
 * on disk and reports success deterministically (no registry needed). */
function seedSkillsOnDisk(world: JollyWorld): void {
  for (const id of DEFAULT_SKILL_IDS) {
    const dir = join(skillsBaseDir(world), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${id}\n`);
  }
}

function runInit(world: JollyWorld): void {
  world.runCli(["init", "--json"], { env: logicSafeEnv() });
}

// ─── Background ────────────────────────────────────────────────────────────

Given(
  "skill installation is fully automated — `jolly start` installs the Jolly skill and all Saleor agent skills automatically via `npx skills add`",
  function () {
    // Capability statement; exercised by the init/start scenarios.
  },
);

Given(
  "the agent never runs `jolly init` or `jolly skills install` as an explicit separate step",
  function () {
    // Capability statement; init remains available standalone (next Given).
  },
);

Given(
  "`jolly init` remains available as a standalone command for repo re-initialization and maintenance",
  function () {
    // Capability statement; the scenarios invoke `jolly init` directly.
  },
);

// ─── Scenario: Agent initializes Jolly guidance locally ─────────────────────

Given("the agent can run Jolly via `npx`", function () {
  // The world invokes the CLI directly through runCli; capability statement.
});

When("the agent invokes `jolly init`", function (this: JollyWorld) {
  // Seed the skill locations so on-disk verification is deterministic without
  // a reachable registry, then run init in the temp project directory.
  seedSkillsOnDisk(this);
  runInit(this);
});

Then(
  "Jolly should install or check the full default skill set via `npx skills add`",
  function (this: JollyWorld) {
    const env = this.envelope;
    // One check per default skill, each reflecting real on-disk state.
    for (const id of DEFAULT_SKILL_IDS) {
      const check = env.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `init must report a check for skill "${id}"`);
    }
  },
);

Then(
  "the default skill set should include the Jolly skill plus `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`",
  function (this: JollyWorld) {
    const skills = this.envelope.data.skills as string[];
    assert.ok(Array.isArray(skills), "data.skills must list the installed skills");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(skills.includes(id), `default skill set must include "${id}"`);
    }
  },
);

Then(
  "the Jolly skill should be the end-to-end playbook that teaches the agent to drive the official CLIs",
  function (this: JollyWorld) {
    const skills = this.envelope.data.skills as string[];
    assert.ok(skills.includes("jolly"), "the Jolly skill must be in the default set");
  },
);

Then(
  "it should include Paper's embedded `saleor-paper-storefront` skill \\(Git-installed with the cloned storefront) when a storefront exists",
  function (this: JollyWorld) {
    // No storefront exists in this fresh temp dir, so the embedded Paper skill
    // is correctly absent. Assert init did not falsely claim it.
    const skills = this.envelope.data.skills as string[];
    assert.ok(
      !skills.includes("saleor-paper-storefront"),
      "Paper's embedded skill must not be claimed when no storefront exists",
    );
  },
);

Then(
  "Jolly should report each skill as actually verified on disk, not unconditionally claim success",
  function (this: JollyWorld) {
    const base = skillsBaseDir(this);
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `missing check for skill "${id}"`);
      const onDisk = existsSync(join(base, id));
      if (check!.status === "pass") {
        assert.ok(onDisk, `skill "${id}" reported pass but is not present on disk`);
      } else {
        // A non-pass status is only honest if the skill is genuinely absent.
        assert.ok(
          !onDisk,
          `skill "${id}" reported "${check!.status}" but IS present on disk — ` +
            `status must reflect on-disk reality`,
        );
      }
    }
  },
);

Then(
  "Jolly should write agent-specific glue files or instructions for supported environments",
  function (this: JollyWorld) {
    // Init merges AGENTS.md guidance (the glue Jolly writes in v1).
    assert.equal(this.envelope.data.agentsMdMerged, true);
    const agentsMdCheck = this.envelope.checks.find((c) => c.id === "agents-md");
    assert.ok(agentsMdCheck, "init must report an agents-md check");
  },
);

Then(
  "the glue files should actually exist on disk under standard project-local skill locations",
  function (this: JollyWorld) {
    // The merged AGENTS.md and the project-local skill directories exist.
    assert.ok(existsSync(join(this.projectDir, "AGENTS.md")), "AGENTS.md must exist");
    assert.ok(
      existsSync(skillsBaseDir(this)),
      "the standard project-local skill directory must exist",
    );
    const agents = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(agents.includes("jolly:begin"), "AGENTS.md must carry the Jolly marker section");
  },
);

Then("Jolly should explain what was installed or updated", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "init must summarize what it did");
});

Then(
  "Jolly should not create remote Saleor Cloud or Vercel resources",
  function (this: JollyWorld) {
    // Init's only on-disk effects are skills, .mcp.json, AGENTS.md — no remote
    // resource keys appear in data, and no environment/deployment was created.
    const data = this.envelope.data;
    for (const key of ["organizationSlug", "environmentKey", "deploymentUrl"]) {
      assert.ok(!(key in data), `init must not report a remote resource (${key})`);
    }
  },
);

Then("Jolly should not store secrets", function (this: JollyWorld) {
  // No .env is written by init, and no secret value leaks into the output.
  assert.ok(
    !existsSync(join(this.projectDir, ".env")),
    "init must not write a .env (no secrets stored)",
  );
  for (const secret of DUMMY_SECRETS) this.trackSecret(secret);
  this.assertNoSecretsIn(this.lastRun!.stdout, "init stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "init stderr");
});

// ─── Scenario: Agent init is safe to rerun and detects existing state ───────

Given(
  "`jolly init` has already been run in a temp project directory",
  function (this: JollyWorld) {
    // First run: seed the skills, write a user-authored .mcp.json and
    // AGENTS.md, then run init once so the second run sees existing state.
    seedSkillsOnDisk(this);
    writeFileSync(
      join(this.projectDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { "user-server": { command: "user-tool" } } }, null, 2),
    );
    writeFileSync(
      join(this.projectDir, "AGENTS.md"),
      "# User Agents\n\nUser-authored content that must survive.\n",
    );
    runInit(this);
    assert.equal(this.envelope.status, "success", "first init run should succeed");
  },
);

When(
  "the agent invokes `jolly init` in the same directory again",
  function (this: JollyWorld) {
    runInit(this);
  },
);

Then(
  "Jolly should detect the existing skills and guidance from the first run",
  function (this: JollyWorld) {
    // The re-run still verifies the (already present) skills on disk as pass.
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `re-run must still report skill "${id}"`);
      assert.equal(check!.status, "pass", `existing skill "${id}" should verify as pass`);
    }
  },
);

Then(
  "it should report the existing state in the output envelope rather than erroring",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success", "re-run must not error on existing state");
    assert.equal(this.envelope.errors.length, 0, "re-run must report no errors");
  },
);

Then(
  "it should update outdated managed guidance when appropriate",
  function (this: JollyWorld) {
    // The Jolly-managed AGENTS.md marker section is (re)written each run.
    const agents = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(agents.includes("jolly:begin"), "managed AGENTS.md section must be present");
    assert.ok(agents.includes("jolly:end"), "managed AGENTS.md section must be bounded");
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    const agents = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(
      agents.includes("User-authored content that must survive."),
      "user-authored AGENTS.md content must be preserved",
    );
  },
);

Then(
  "it should merge, not replace, any existing .mcp.json, adding the Jolly MCP server entry to the existing servers object rather than writing a fresh object",
  function (this: JollyWorld) {
    const mcp = JSON.parse(readFileSync(join(this.projectDir, ".mcp.json"), "utf8"));
    const servers = mcp.mcpServers as Record<string, unknown>;
    assert.ok(servers["user-server"], "user-authored .mcp.json server must survive the merge");
    assert.ok(servers["saleor-graphql"], "the Jolly MCP server entry must be added");
  },
);

Then(
  "it should merge, not replace, any existing AGENTS.md or agent glue file, inserting or updating the Jolly section without removing user-authored content",
  function (this: JollyWorld) {
    const agents = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(agents.includes("# User Agents"), "user AGENTS.md heading must survive");
    assert.ok(agents.includes("jolly:begin"), "the Jolly section must be inserted");
  },
);

Then("it should produce a concise summary of changes", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "re-run must summarize the changes");
});

// ─── Scenario: Agent init is safe to rerun in a clean directory ─────────────

Given("`jolly init` has not been run before", function (this: JollyWorld) {
  // Clean temp directory: no skills, no .mcp.json, no AGENTS.md. Seed the
  // skill locations so on-disk verification is deterministic offline.
  seedSkillsOnDisk(this);
});

When(
  "the agent invokes `jolly init` in a temp project directory",
  function (this: JollyWorld) {
    runInit(this);
  },
);

Then("Jolly should install the full default skill set", function (this: JollyWorld) {
  const skills = this.envelope.data.skills as string[];
  for (const id of DEFAULT_SKILL_IDS) {
    assert.ok(skills.includes(id), `full default skill set must include "${id}"`);
  }
});

Then(
  "the output envelope should report a status of success",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
  },
);

Then("the summary should indicate what was installed", function (this: JollyWorld) {
  assert.match(
    this.envelope.summary,
    /skill/i,
    "the summary should mention the installed skills",
  );
});
