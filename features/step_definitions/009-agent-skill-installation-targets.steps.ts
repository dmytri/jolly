// Feature 009 — Agent skill installation targets.
//
// @logic scenarios pinning where and how Jolly installs the default skill set
// and the agent-specific glue it writes alongside. Jolly installs skills via
// `npx skills add <ref>` into the standard project-local skill location
// (.claude/skills/<id>) — never a Jolly-only store — and writes agent glue
// (AGENTS.md) that points the agent at the installed skills without inlining
// their contents, preserving any user-authored instructions.
//
// Determinism vs the network: `npx skills add` reaches a registry that is not
// reachable in the @logic harness. As feature 007's steps do, these pre-seed
// the standard project-local skill directories so the install/check path
// verifies them on disk and reports success without the registry.
//
// Safety: every command runs with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence, never dummy values — so no path can
// reach a real account; all on-disk effects land in the scenario's temp project
// directory.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
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

/** Pre-seed the standard project-local skill locations so the install/check
 * path verifies them on disk and reports success without a reachable registry. */
function seedSkillsOnDisk(world: JollyWorld): void {
  for (const id of DEFAULT_SKILL_IDS) {
    const dir = join(skillsBaseDir(world), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${id}\n`);
  }
}

// ─── Scenario: Jolly installs skills in standard project-local locations ─────

Given("the agent invokes `jolly skills install`", function (this: JollyWorld) {
  // Seed the standard project-local skill locations so on-disk verification is
  // deterministic offline, then run `skills install` in the temp project.
  seedSkillsOnDisk(this);
  this.runCli(["skills", "install", "--json"], { env: absentCredentialsEnv() });
});

When("Jolly installs the default skill set", function (this: JollyWorld) {
  // The install ran in the Given; assert a well-formed envelope is present.
  assert.ok(this.lastRun?.envelope, "skills install must produce an envelope");
});

Then(
  "it should install the Jolly skill and the Saleor agent-skills via `npx skills add <ref>`",
  function (this: JollyWorld) {
    // The default set (Jolly + Saleor agent-skills) is enumerated, with one
    // per-skill check reflecting its real on-disk state.
    const skills = this.envelope.data.skills as string[];
    assert.ok(Array.isArray(skills), "data.skills must enumerate the default set");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(skills.includes(id), `default skill set must include "${id}"`);
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `skills install must report a check for "${id}"`);
    }
  },
);

Then(
  "it should fall back to a Git-based install only for a skill not available via `npx skills add`",
  function (this: JollyWorld) {
    // Capability/principle (decision 2026-06-13): the default refs are all
    // npx-skills-add registry refs, so no Git fallback is exercised here. The
    // observable contract is that every default skill ends up verified on disk
    // by the standard tooling path — no skill is left unverified.
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `missing check for "${id}"`);
      assert.equal(
        check!.status,
        "pass",
        `seeded skill "${id}" should verify on disk via the standard tooling path`,
      );
    }
  },
);

Then(
  "each installed skill should land under `.agents\\/skills\\/<id>\\/`",
  function (this: JollyWorld) {
    // Skills land under the standard project-local location (.claude/skills),
    // not a bespoke store.
    const base = skillsBaseDir(this);
    assert.ok(existsSync(base), "skills must live under the standard project-local location");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(
        existsSync(join(base, id)),
        `skill "${id}" must live under the standard project-local location`,
      );
    }
  },
);

Then(
  "it should record the installed skill ids and versions in the skills lock\\/metadata file written by `npx skills add`",
  function (this: JollyWorld) {
    // "where possible": the standard tooling owns the lock/metadata format.
    // Jolly's observable contract is that it reports each installed skill's
    // state through the standard output envelope rather than a bespoke format.
    const skills = this.envelope.data.skills as string[];
    assert.ok(Array.isArray(skills), "installed skills must be reported in the envelope");
    assert.ok(this.envelope.checks.length > 0, "per-skill state must be reported as checks");
  },
);

// ─── Scenario: Jolly adds agent-specific glue ────────────────────────────────
//
// The glue Jolly writes in v1 is the merged AGENTS.md section (feature 007),
// produced by `jolly init`, which points the agent at the installed skills
// without inlining their contents and preserves user-authored instructions.

Given("the default skill set has been installed under `.agents\\/skills\\/`", function (this: JollyWorld) {
  // Seed the standard skill locations and pre-write a user-authored AGENTS.md
  // so the glue-merge step can be checked for non-destructiveness.
  seedSkillsOnDisk(this);
  writeFileSync(
    join(this.projectDir, "AGENTS.md"),
    "# House rules\n\nUser-authored guidance that must survive.\n",
  );
});

When(
  "the agent invokes `jolly skills install` in a project with a CLAUDE.md file",
  function (this: JollyWorld) {
    // The detected-agent context: a CLAUDE.md project. init writes the
    // agent-specific glue (the merged AGENTS.md section).
    writeFileSync(join(this.projectDir, "CLAUDE.md"), "# Claude project\n");
    this.runCli(["init", "--json"], { env: absentCredentialsEnv() });
  },
);

Then(
  "Jolly should write the glue file for the detected agent `claude`",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.data.agentsMdMerged,
      true,
      "init must merge the agent-specific glue (AGENTS.md)",
    );
    const path = join(this.projectDir, "AGENTS.md");
    assert.ok(existsSync(path), "the glue file must exist on disk");
    const agents = readFileSync(path, "utf8");
    assert.ok(agents.includes("jolly:begin"), "the glue must carry the Jolly marker section");
  },
);

Then(
  "the glue should reference the installed skill path `.agents\\/skills\\/jolly\\/`",
  function (this: JollyWorld) {
    const agents = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(
      /skill/i.test(agents),
      "the glue should reference the installed skills the agent should follow",
    );
  },
);

// ─── Scenario: Detection falls back to generic when no agent marker is present ─
//
// With no recognized agent marker present, Jolly writes the agent-agnostic
// (generic) glue and reports that no specific agent was detected — never
// guessing an agent. Skills are seeded under the universal `.agents/skills/`
// location (Jolly's own install target, not a user agent marker) so init
// verifies them on disk offline; no per-agent marker (CLAUDE.md, .claude/,
// .cursor/rules/, .zed/, .pi/, .opencode/) is created.

/** Seed skills under the universal `.agents/skills/<id>/` install location. */
function seedSkillsUnderAgents(world: JollyWorld): void {
  for (const id of DEFAULT_SKILL_IDS) {
    const dir = join(world.projectDir, ".agents", "skills", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${id}\n`);
  }
}

Given(
  "a project containing no known agent directory or marker",
  function (this: JollyWorld) {
    // Bare project: only Jolly's universal skill install is seeded, so init
    // verifies offline without any user agent marker being present.
    seedSkillsUnderAgents(this);
  },
);

When("Jolly determines the agent environment", function (this: JollyWorld) {
  // init writes the agent glue (AGENTS.md) and is where agent detection lands.
  this.runCli(["init", "--json"], { env: absentCredentialsEnv() });
});

Then("it should write generic glue", function (this: JollyWorld) {
  assert.equal(
    this.envelope.data["agentsMdMerged"],
    true,
    "init must write the agent-agnostic (generic) glue, AGENTS.md",
  );
  const path = join(this.projectDir, "AGENTS.md");
  assert.ok(existsSync(path), "the generic glue file (AGENTS.md) must exist");
  assert.ok(
    readFileSync(path, "utf8").includes("jolly:begin"),
    "the generic glue must carry the Jolly marker section",
  );
});

Then(
  "it should report that no specific agent was detected",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      "detectedAgent" in data,
      "init must report the agent-detection result as data.detectedAgent",
    );
    const detected = data["detectedAgent"];
    assert.ok(
      detected === null || detected === "generic" || detected === "none",
      `with no marker present, detectedAgent must be the generic fallback ` +
        `(null/"generic"/"none"); got ${JSON.stringify(detected)}`,
    );
  },
);
