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
// (.agents/skills/<id> — the universal dir `npx skills add` writes to, feature
// 007 Rule "Init boundaries") so init verifies them on disk and skips `npx`. The
// honest-failure path is asserted separately by leaving them absent.
//
// Safety: every command runs under logicSafeEnv() — dummy credentials and an
// unroutable Cloud API base — so no path can reach a real account, and the
// merges happen in the scenario's temp project directory.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv, DUMMY_SECRETS } from "../support/logic-env.ts";
import { REPO_ROOT } from "../support/world.ts";
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
  // The universal location `npx skills add` (no --agent) writes to and Jolly
  // verifies against (feature 007 Rule "Init boundaries", verified 2026-06-14).
  return join(world.projectDir, ".agents", "skills");
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

// ─── @sandbox: non-interactive, agent-agnostic skill install ────────────────
//
// Reproduces the 0.6.0 fresh-machine regression: on a customer machine with no
// agent runtime and no interactive terminal, the installer opened a picker that
// no-ops silently while exiting 0, so no skill landed. Unlike the @logic
// scenarios above — which pre-seed the skill dirs to test verification offline —
// this scenario drives the REAL `npx skills add` non-interactively and asserts
// every default skill genuinely lands under the universal `.agents/skills/<id>/`
// location, with success reported only when it did. It needs no Saleor
// credentials (registered with [] in SANDBOX_REQUIREMENTS), only `npx`/network.

const NO_AGENT_ENV_NOTE = "noAgentEnv";

function describeRun(world: JollyWorld): string {
  const run = world.lastRun;
  if (!run) return "(init did not run)";
  return `exit ${run.exitCode}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
}

Given(
  "`jolly init` runs with no interactive terminal and no agent runtime detected",
  function (this: JollyWorld) {
    // Reproduce a fresh customer machine. Two independent isolations:
    //  1. No agent runtime — point HOME (and the XDG/Windows equivalents) at an
    //     EMPTY temp dir so the skills installer detects zero agents. The dev/CI
    //     home carries agent config (e.g. ~/.claude) that would otherwise mask
    //     the no-agent picker no-op this scenario exists to catch. The project
    //     dir is a fresh temp dir, so no project-local agent dir exists either.
    //  2. No interactive terminal — runCli spawns the child with a non-TTY
    //     stdin (no `input`), so the install is already non-interactive.
    // A minimal package.json marks the temp dir as a project so the install is
    // unambiguously project-scoped (writes `.agents/skills/` here, where Jolly
    // verifies). The npm cache stays pointed at the real one so `npx skills add`
    // is not forced to cold-download under the fresh HOME.
    writeFileSync(
      join(this.projectDir, "package.json"),
      JSON.stringify({ name: "jolly-fresh-machine-fixture", private: true }, null, 2),
    );
    const cleanHome = this.newTempDir("clean-home");
    const realHome = process.env.HOME ?? process.env.USERPROFILE ?? "";
    this.notes[NO_AGENT_ENV_NOTE] = {
      HOME: cleanHome,
      USERPROFILE: cleanHome,
      XDG_CONFIG_HOME: join(cleanHome, ".config"),
      XDG_DATA_HOME: join(cleanHome, ".local", "share"),
      npm_config_cache: realHome ? join(realHome, ".npm") : undefined,
    };
  },
);

When(
  "it installs the default skill set",
  { timeout: 600_000 },
  function (this: JollyWorld) {
    const env = this.notes[NO_AGENT_ENV_NOTE] as Record<string, string | undefined>;
    // Real installs over the network: generous CLI timeout under the long step
    // budget (init runs `npx skills add` per skill).
    this.runCli(["init", "--json"], { env, timeoutMs: 540_000 });
  },
);

Then(
  // RegExp, not a Cucumber Expression: the literal slashes in `.agents/skills/`
  // would otherwise be parsed as Cucumber-Expression alternation.
  /^each default skill should be installed under `\.agents\/skills\/<id>\/` and verified on disk$/,
  function (this: JollyWorld) {
    const base = join(this.projectDir, ".agents", "skills");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(
        existsSync(join(base, id)),
        `skill "${id}" must be installed under .agents/skills/${id}/.\n${describeRun(this)}`,
      );
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `init must report a check for skill "${id}"`);
      assert.equal(
        check!.status,
        "pass",
        `skill "${id}" must verify as pass on disk`,
      );
    }
  },
);

Then(
  "the install should require no interactive prompt and no specific agent to be present",
  function (this: JollyWorld) {
    // The run completed (real exit code, not a hang waiting on a prompt)...
    assert.ok(this.lastRun, "init must have run");
    assert.notEqual(
      this.lastRun!.exitCode,
      -1,
      `init must complete non-interactively, not hang on a prompt.\n${describeRun(this)}`,
    );
    // ...and despite no agent runtime existing, every skill landed in the
    // UNIVERSAL location — proving the install is agent-agnostic and did not
    // depend on any agent/skill picker selection.
    const universalBase = join(this.projectDir, ".agents", "skills");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(
        existsSync(join(universalBase, id)),
        `skill "${id}" must land in the universal .agents/skills/ location ` +
          `regardless of which (if any) agent is present.\n${describeRun(this)}`,
      );
    }
  },
);

Then(
  "Jolly should report success only when every skill actually landed on disk",
  function (this: JollyWorld) {
    const base = join(this.projectDir, ".agents", "skills");
    const allOnDisk = DEFAULT_SKILL_IDS.every((id) => existsSync(join(base, id)));
    // Honesty coupling, both directions: success iff every skill is on disk.
    if (this.envelope.status === "success") {
      assert.ok(
        allOnDisk,
        `init reported success but not every skill is on disk.\n${describeRun(this)}`,
      );
    }
    if (allOnDisk) {
      assert.equal(
        this.envelope.status,
        "success",
        `every skill landed on disk, so init must report success.\n${describeRun(this)}`,
      );
    }
    // Per-skill: a pass check is honest only if the skill is genuinely present.
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `missing check for skill "${id}"`);
      if (check!.status === "pass") {
        assert.ok(
          existsSync(join(base, id)),
          `skill "${id}" reported pass but is not on disk`,
        );
      }
    }
  },
);

// ─── @sandbox: the Jolly skill installs from the bundled copy (no network) ───
//
// Rule "Jolly skill source": the Jolly skill ships inside @dk/jolly and installs
// from that bundled copy — no network, no dependence on the repo being pushed.
// Proven by blocking outbound network during init: the bundled Jolly skill still
// lands (installed from a local path), whereas a network-only ref fails to clone.
// The Saleor skills (remote refs) are expected to fail under the block; this
// scenario asserts only the Jolly skill.

const NET_BLOCKED_ENV_NOTE = "netBlockedEnv";
const BUNDLED_JOLLY_SKILL = join(REPO_ROOT, "assets", "skills", "jolly");

Given(
  "`jolly init` runs with outbound network blocked",
  function (this: JollyWorld) {
    writeFileSync(
      join(this.projectDir, "package.json"),
      JSON.stringify({ name: "jolly-no-network-fixture", private: true }, null, 2),
    );
    // Pre-warm the `skills` CLI into the npm cache WITHOUT the block, so the
    // upcoming network-blocked init can still launch `npx skills` (only the
    // skill SOURCE fetch should be exercised against the block, not npx's own
    // package resolution).
    spawnSync("npx", ["--yes", "skills", "--version"], {
      encoding: "utf8",
      timeout: 120_000,
      stdio: "ignore",
    });
    // Block every outbound connection by routing all proxy protocols at an
    // unroutable local port; a git clone or HTTPS fetch then fails fast.
    // `npm_config_offline` keeps `npx` from spending ~70s probing the registry
    // through the dead proxy before falling back to the (pre-warmed) cache, so
    // each remote-ref clone fails in well under a second and the bundled
    // local-path install of the Jolly skill still succeeds.
    const deadProxy = "http://127.0.0.1:9";
    this.notes[NET_BLOCKED_ENV_NOTE] = {
      HTTP_PROXY: deadProxy,
      HTTPS_PROXY: deadProxy,
      http_proxy: deadProxy,
      https_proxy: deadProxy,
      npm_config_offline: "true",
    };
  },
);

When(
  "it installs the default skill set with no network",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    const env = this.notes[NET_BLOCKED_ENV_NOTE] as Record<string, string | undefined>;
    this.runCli(["init", "--json"], { env, timeoutMs: 240_000 });
  },
);

Then(
  // RegExp: the literal slashes would otherwise parse as Cucumber-Expression
  // alternation.
  /^the Jolly skill should be installed under `\.agents\/skills\/jolly\/` from the bundled copy$/,
  function (this: JollyWorld) {
    // With the network blocked, the only way the Jolly skill can be on disk is
    // installation from the bundled local copy.
    const installed = join(this.projectDir, ".agents", "skills", "jolly");
    assert.ok(
      existsSync(installed),
      `the Jolly skill must install from the bundled copy with no network.\n${describeRun(this)}`,
    );
    const check = this.envelope.checks.find((c) => c.id === "skill-jolly");
    assert.ok(check, "init must report a check for the Jolly skill");
    assert.equal(
      check!.status,
      "pass",
      `the Jolly skill must verify as pass (installed from the bundle).\n${describeRun(this)}`,
    );
  },
);

Then(
  "the installed Jolly skill content should match the bundled copy",
  function (this: JollyWorld) {
    // Provenance check: the installed SKILL.md carries the bundled skill's
    // distinctive description line, confirming it is the bundled copy.
    const installedSkill = join(
      this.projectDir,
      ".agents",
      "skills",
      "jolly",
      "SKILL.md",
    );
    assert.ok(existsSync(installedSkill), "installed Jolly SKILL.md must exist");
    const installed = readFileSync(installedSkill, "utf8");
    const bundled = readFileSync(join(BUNDLED_JOLLY_SKILL, "SKILL.md"), "utf8");
    const marker = bundled
      .split("\n")
      .find((line) => line.startsWith("description:"));
    assert.ok(marker, "bundled Jolly SKILL.md must have a description line");
    assert.ok(
      installed.includes(marker!.trim()),
      "the installed Jolly skill must be the bundled copy (description line must match)",
    );
  },
);
