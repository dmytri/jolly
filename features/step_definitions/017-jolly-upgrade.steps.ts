// Feature 017 — Jolly upgrade.
//
// @logic scenarios pinning the REAL `jolly upgrade` / `jolly skills update`
// behavior:
//   - `jolly upgrade` re-verifies the Jolly-managed skills on disk (each present
//     skill is a passing check, an absent one is skipped) and detects a cloned
//     Paper storefront via paper-version.json, reporting its baseline VERSION as
//     plan-only (data.paperAutoApply is false; data.paperBaselineVersion carries
//     the value read from the marker). It does NOT fetch or apply updates and
//     does NOT auto-apply Paper migrations in v1.
//   - `jolly skills update` is a no-op re-verify of the installed skill set on
//     disk (only `jolly skills install` installs).
//   - Neither command touches AGENTS.md, so user-authored content outside the
//     Jolly marker is preserved.
//
// Safety: every command runs with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence, never dummy values — so no path can
// reach a real account; all on-disk effects land in the scenario's temp project
// directory.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
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

function seedSkillsOnDisk(world: JollyWorld): void {
  for (const id of DEFAULT_SKILL_IDS) {
    const dir = join(world.projectDir, ".claude", "skills", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${id}\n`);
  }
}

// ─── Background ──────────────────────────────────────────────────────────────

Given("a project that has run `jolly init`", function () {
  // Background precondition (capability statement). Each scenario seeds the
  // concrete on-disk state it needs (skills, paper-version.json) in its Given.
});

// ─── Given: post-init/installed skill state ──────────────────────────────────

Given(
  "a project has previously run `jolly init` or `jolly skills install`",
  function (this: JollyWorld) {
    // Pre-seed the standard skill locations so the re-verify sees managed skills
    // present on disk (offline-deterministic).
    seedSkillsOnDisk(this);
    // A project that has run `jolly init` carries an AGENTS.md with the
    // Jolly-managed marker section plus the customer's own lines outside it.
    // Seed that post-init state so the shared "user-authored lines … remain
    // unchanged" assertion exercises that upgrade leaves it untouched.
    writeFileSync(
      join(this.projectDir, "AGENTS.md"),
      "# User Agents\n\nUser-authored content that must survive.\n\n" +
        "<!-- jolly:begin -->\nManaged by Jolly.\n<!-- jolly:end -->\n",
    );
  },
);

// ─── When ────────────────────────────────────────────────────────────────────

When("the agent invokes `jolly upgrade`", function (this: JollyWorld) {
  this.runCli(["upgrade", "--json"], { env: absentCredentialsEnv() });
});

When("the agent invokes `jolly skills update`", function (this: JollyWorld) {
  this.runCli(["skills", "update", "--json"], { env: absentCredentialsEnv() });
});

// ─── Then: managed-skill re-verify (upgrade + skills update) ─────────────────

Then(
  "the envelope `data.skillsChecked` should list the Jolly-managed skill IDs",
  function (this: JollyWorld) {
    const data = this.envelope.data as { skillsChecked?: unknown };
    assert.ok(
      Array.isArray(data.skillsChecked),
      "upgrade must report the Jolly-managed skills it re-verified",
    );
    const checked = data.skillsChecked as string[];
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(checked.includes(id), `data.skillsChecked must include "${id}"`);
    }
  },
);

Then(
  "every managed skill present on disk should be reported as a passing check",
  function (this: JollyWorld) {
    // The skills were seeded on disk in the Given, so each per-skill check must
    // verify as passing (re-verify only — nothing is fetched or installed).
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `must report a per-skill check for "${id}"`);
      assert.equal(
        check!.status,
        "pass",
        `skill "${id}" was seeded on disk and must re-verify as passing`,
      );
    }
  },
);

Then(
  "the envelope `data.skills` should list the Jolly-managed skill IDs",
  function (this: JollyWorld) {
    const data = this.envelope.data as { skills?: unknown };
    assert.ok(
      Array.isArray(data.skills),
      "skills update must list the managed skill IDs it re-verified",
    );
    const skills = data.skills as string[];
    for (const id of DEFAULT_SKILL_IDS) {
      assert.ok(skills.includes(id), `data.skills must include "${id}"`);
    }
  },
);

// "user-authored lines in AGENTS.md outside the Jolly marker should remain
// unchanged" is defined in 007-jolly-init-agent-setup.steps.ts (shared); not
// duplicated here.

// ─── Then: Paper baseline (plan-only) ────────────────────────────────────────

Given("a cloned Paper storefront exists", function (this: JollyWorld) {
  // Paper's presence is detected via paper-version.json (the CLI's marker).
  seedSkillsOnDisk(this);
  writeFileSync(
    join(this.projectDir, "paper-version.json"),
    JSON.stringify({ version: "1.0.0" }, null, 2) + "\n",
  );
});

Then(
  "the envelope `data` should report the detected Paper baseline version",
  function (this: JollyWorld) {
    const data = this.envelope.data as {
      paperBaselineDetected?: unknown;
      paperBaselineVersion?: unknown;
    };
    assert.equal(
      data.paperBaselineDetected,
      true,
      "upgrade must detect the cloned Paper baseline (paper-version.json present)",
    );
    assert.equal(
      data.paperBaselineVersion,
      "1.0.0",
      "upgrade must surface the Paper baseline version read from paper-version.json",
    );
    const check = this.findCheck("paper-baseline");
    assert.ok(check, "upgrade must report a paper-baseline check");
  },
);

Then(
  "it should read `paper-version.json` to determine the baseline",
  function (this: JollyWorld) {
    // With Paper present, the paper-baseline check surfaces the detected version
    // (not skipped away); its description carries the baseline read from disk.
    const check = this.findCheck("paper-baseline");
    assert.ok(check, "missing paper-baseline check");
    assert.notEqual(
      check!.status,
      "skipped",
      "with Paper present, the paper-baseline check must not be skipped",
    );
    assert.ok(
      String(check!.description).includes("1.0.0"),
      "the paper-baseline check must report the baseline version read from paper-version.json",
    );
  },
);

Then(
  "it should not modify any file in the storefront directory",
  function (this: JollyWorld) {
    const data = this.envelope.data as { paperAutoApply?: unknown };
    assert.equal(
      data.paperAutoApply,
      false,
      "upgrade must not rewrite the customized storefront",
    );
  },
);

Then(
  "it should not apply Paper migrations automatically in v1",
  function (this: JollyWorld) {
    const data = this.envelope.data as { paperAutoApply?: unknown };
    assert.equal(data.paperAutoApply, false, "Paper migrations must not be auto-applied in v1");
  },
);
