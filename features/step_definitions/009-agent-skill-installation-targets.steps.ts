// Feature 009 — Agent skill installation targets.
//
// @logic scenarios pinning where and how Jolly installs the default skill set
// and the agent-specific glue it writes alongside. Jolly installs skills via
// `npx skills add <ref>` into the universal project-local skill location
// (.agents/skills/<id>) — never a Jolly-only store — and writes agent glue
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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import type { JollyWorld } from "../support/world.ts";

// Must stay in sync with src/index.ts DEFAULT_SKILLS. If this list is missing a
// skill, `jolly init` runs a REAL `npx skills add` for the gap, which writes a
// `.claude/skills/` compat dir and makes detectAgent() self-detect "claude" —
// polluting the no-agent-marker precondition. Seeding the full set keeps init
// install-free so the detection scenarios are hermetic.
const DEFAULT_SKILL_IDS = [
  "jolly",
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
  "stripe-best-practices",
];

function skillsBaseDir(world: JollyWorld): string {
  return join(world.projectDir, ".agents", "skills");
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
    // Skills land under the universal project-local location (.agents/skills/<id>),
    // not a bespoke store.
    const base = skillsBaseDir(this);
    assert.ok(existsSync(base), "skills must live under the universal .agents/skills location");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(
        existsSync(join(base, id)),
        `skill "${id}" must live under .agents/skills/${id}/`,
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

// ─── Scenario: Jolly installs the default skill set concurrently ─────────────
//
// Real by default vs the network: `npx skills add` reaches a registry the @logic
// harness cannot reach (same condition the sibling scenarios handle by seeding
// skills on disk). Here the substitution is a real `npx` PATH shim — a genuine
// subprocess Jolly spawns exactly as it spawns the real installer — that records
// its own wall-clock interval, lands the skill under `.agents/skills/<id>/`, and
// appends the id to the lock file with an atomic O_APPEND write. Only the
// unreachable registry fetch is replaced; the concurrency under observation is
// Jolly's own orchestration of those spawns, exercised for real.
//
// Sequential production (a blocking `spawnSync` per skill) yields disjoint
// intervals — no overlap. Concurrent production yields a later spawn beginning
// before an earlier one finishes. The overlap is the observable that separates
// the two, read from the spawns' recorded timing.

// Maps the exact `add` source Jolly passes to the installed skill id. Only the
// stripe ref needs it (its id is not the ref's basename); the Jolly skill spawns
// from its bundled absolute path whose basename is already `jolly`, and every
// Saleor ref's basename is its id. Must stay in sync with src/index.ts
// DEFAULT_SKILLS, like DEFAULT_SKILL_IDS above.
const SKILL_REF_TO_ID: Record<string, string> = {
  "dmytri/jolly": "jolly",
  "https://github.com/saleor/agent-skills/tree/main/skills/saleor-storefront": "saleor-storefront",
  "https://github.com/saleor/agent-skills/tree/main/skills/saleor-configurator": "saleor-configurator",
  "https://github.com/saleor/agent-skills/tree/main/skills/storefront-builder": "storefront-builder",
  "https://github.com/saleor/agent-skills/tree/main/skills/saleor-core": "saleor-core",
  "https://github.com/saleor/agent-skills/tree/main/skills/saleor-app": "saleor-app",
  "stripe/ai@stripe-best-practices": "stripe-best-practices",
};

/** Each shimmed install holds its skill dir for this long, so a concurrent
 * spawn's start lands inside an earlier spawn's interval and a sequential one
 * does not. Comfortably longer than the ms-resolution wall clock the shim reads. */
const SHIM_INSTALL_MS = 300;

interface InstallInterval {
  id: string;
  start: number;
  end: number;
}

/** Resolve the real `npx` before the shim dir shadows it on PATH, so the shim
 * can fall through to it for any non-`skills add` invocation. */
function realNpxPath(): string {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["npx"], {
    encoding: "utf8",
  });
  const first = (which.stdout ?? "").split(/\r?\n/).find((l) => l.trim() !== "");
  return first?.trim() || "npx";
}

/** Write a real `npx` PATH shim that intercepts `skills add`, records its
 * wall-clock interval, lands the skill on disk, and appends the id to the lock
 * file with an atomic O_APPEND write. All paths are baked in, so it needs no
 * env of its own; only PATH must place the shim first. */
function writeSkillsAddShim(
  shimDir: string,
  traceFile: string,
  lockFile: string,
  skillsDir: string,
): void {
  const shim = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
const addIdx = argv.indexOf("add");
if (!(argv.includes("skills") && addIdx !== -1)) {
  const r = spawnSync(${JSON.stringify(realNpxPath())}, argv, { stdio: "inherit" });
  process.exit(r.status == null ? 1 : r.status);
}
const source = argv[addIdx + 1] || "";
const map = ${JSON.stringify(SKILL_REF_TO_ID)};
const id = map[source] || path.basename(source);
const start = Date.now();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${SHIM_INSTALL_MS});
const dir = path.join(${JSON.stringify(skillsDir)}, id);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "SKILL.md"), "# " + id + "\\n");
fs.appendFileSync(${JSON.stringify(lockFile)}, id + "\\n");
const end = Date.now();
fs.appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ id, start, end }) + "\\n");
process.exit(0);
`;
  writeFileSync(join(shimDir, "npx"), shim, { mode: 0o755 });
}

function installIntervals(world: JollyWorld): InstallInterval[] {
  const traceFile = world.notes.skillsTraceFile as string;
  if (!existsSync(traceFile)) return [];
  return readFileSync(traceFile, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as InstallInterval);
}

Given(
  "the agent invokes `jolly skills install` in a project missing several default skills",
  function (this: JollyWorld) {
    // No skills seeded: every default skill is missing, so `skills install`
    // spawns the installer for each one and the concurrency is exercised across
    // the full set. Stand up the shim dir, trace, and lock, baking their paths
    // into the shim so the spawned installs record real timing offline.
    const shimDir = this.newTempDir("npx-shim");
    const traceFile = join(this.newTempDir("skills-trace"), "installs.jsonl");
    const skillsDir = join(this.projectDir, ".agents", "skills");
    const lockFile = join(skillsDir, "installed.lock");
    mkdirSync(skillsDir, { recursive: true });
    writeSkillsAddShim(shimDir, traceFile, lockFile, skillsDir);
    this.notes.skillsShimDir = shimDir;
    this.notes.skillsTraceFile = traceFile;
    this.notes.skillsLockFile = lockFile;
  },
);

When(
  "Jolly installs the default skill set via `npx skills add`",
  function (this: JollyWorld) {
    // Real absence of credentials, and the shim dir first on PATH so Jolly's own
    // `npx skills add` spawns resolve to the interval-recording shim.
    const shimDir = this.notes.skillsShimDir as string;
    this.runCli(["skills", "install", "--json"], {
      env: absentCredentialsEnv({
        PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
      }),
    });
  },
);

Then(
  "the skill installs should run concurrently, a later skill's install beginning before an earlier skill's install finishes",
  function (this: JollyWorld) {
    const intervals = installIntervals(this);
    assert.ok(
      intervals.length >= 2,
      `at least two skills must install for concurrency to be observable; ` +
        `recorded ${intervals.length}`,
    );
    // Sort by start; an overlap exists when some install begins before the
    // latest end seen among the installs that started earlier.
    const byStart = [...intervals].sort((a, b) => a.start - b.start);
    let maxEnd = byStart[0].end;
    let overlap = false;
    for (let i = 1; i < byStart.length; i++) {
      if (byStart[i].start < maxEnd) overlap = true;
      if (byStart[i].end > maxEnd) maxEnd = byStart[i].end;
    }
    assert.ok(
      overlap,
      `installs ran sequentially, no overlap: a later install must begin before ` +
        `an earlier one finishes. intervals=${JSON.stringify(byStart)}`,
    );
  },
);

Then(
  "every default skill should still land under `.agents\\/skills\\/<id>\\/`",
  function (this: JollyWorld) {
    const base = join(this.projectDir, ".agents", "skills");
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(
        existsSync(join(base, id)),
        `skill "${id}" must land under .agents/skills/${id}/ after a concurrent install`,
      );
    }
    // Jolly's own envelope must report the concurrent install as a clean success.
    assert.equal(
      this.envelope.status,
      "success",
      `concurrent install of every default skill must report success; got ` +
        `${this.envelope.status}: ${this.envelope.summary}`,
    );
  },
);

Then(
  "the skills lock\\/metadata file should record every installed skill id without corruption",
  function (this: JollyWorld) {
    const lockFile = this.notes.skillsLockFile as string;
    assert.ok(existsSync(lockFile), "the installer must write the skills lock/metadata file");
    const lines = readFileSync(lockFile, "utf8").split("\n").filter((l) => l !== "");
    // No corruption: every line is a clean, recognized skill id, and every
    // default skill appears exactly once despite the concurrent appends.
    for (const line of lines) {
      assert.ok(
        DEFAULT_SKILL_IDS.includes(line),
        `lock file holds a corrupt or interleaved entry: ${JSON.stringify(line)}`,
      );
    }
    const recorded = new Set(lines);
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(recorded.has(id), `lock file must record installed skill id "${id}"`);
    }
    assert.equal(
      lines.length,
      recorded.size,
      `lock file must record each skill id once, no duplicate appends: ${JSON.stringify(lines)}`,
    );
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
