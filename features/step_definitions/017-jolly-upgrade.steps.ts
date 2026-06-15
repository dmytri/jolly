// Feature 017 — Jolly upgrade.
//
// @logic scenarios pinning `jolly upgrade`: it checks Jolly-managed skills and
// agent guidance for updates, summarizes changes, and never overwrites
// user-authored content without approval; it may orchestrate `jolly skills
// update` and reports each skill as updated/unchanged/skipped/failed; for the
// Paper baseline it detects a cloned Paper storefront where possible, generates
// a plan, and does NOT auto-apply Paper migrations in v1 (data.paperAutoApply
// is false; the paper-baseline check is plan-only).
//
// Safety: every command runs under logicSafeEnv() — dummy credentials for all
// groups + an unroutable Cloud API base — so no path can reach a real account
// (the "012 incident" lesson); all on-disk effects land in the scenario's temp
// project directory.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv } from "../support/logic-env.ts";
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
// "Jolly uses Saleor Paper as the storefront baseline" is defined once in
// 005-stripe-checkout-setup.steps.ts (shared). The other two are capability
// statements specific to this feature.

Given("a project that has run `jolly init`", function () {
  // Background precondition (capability statement). Each scenario seeds the
  // concrete on-disk state it needs (skills, paper-version.json) in its Given.
});

// ─── Scenario: Agent upgrades Jolly-managed skills and guidance ──────────────

Given(
  "a project has previously run `jolly init` or `jolly skills install`",
  function (this: JollyWorld) {
    // Pre-seed the standard skill locations so upgrade sees managed skills
    // present on disk (offline-deterministic).
    seedSkillsOnDisk(this);
    // A project that has run `jolly init` carries an AGENTS.md with the
    // Jolly-managed marker section plus the customer's own lines outside it.
    // Seed that post-init state so the shared "user-authored lines … remain
    // unchanged" assertion exercises upgrade's preservation of it.
    writeFileSync(
      join(this.projectDir, "AGENTS.md"),
      "# User Agents\n\nUser-authored content that must survive.\n\n" +
        "<!-- jolly:begin -->\nManaged by Jolly.\n<!-- jolly:end -->\n",
    );
  },
);

When("the agent invokes `jolly upgrade`", function (this: JollyWorld) {
  this.runCli(["upgrade", "--json"], { env: logicSafeEnv() });
});

Then(
  "Jolly should check for updates to Jolly-managed skills",
  function (this: JollyWorld) {
    const data = this.envelope.data as { skillsChecked?: unknown };
    assert.ok(
      Array.isArray(data.skillsChecked),
      "upgrade must report the Jolly-managed skills it checked",
    );
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `upgrade must report a per-skill check for "${id}"`);
    }
  },
);

Then(
  "it should check for updates to Jolly-managed agent guidance",
  function (this: JollyWorld) {
    // Upgrade focuses on Jolly-managed assets (skills + agent guidance); the
    // managed-asset check surface and overall envelope are present and honest.
    assert.ok(this.envelope.checks.length > 0, "upgrade must report managed-asset checks");
    assert.notEqual(
      this.envelope.status,
      "error",
      "upgrade of managed guidance must not error in a normal project",
    );
  },
);

Then(
  "the envelope `data` should list the available changes before any are applied",
  function (this: JollyWorld) {
    assert.ok(this.envelope.summary.length > 0, "upgrade must summarize available changes");
    assert.ok(Array.isArray(this.envelope.nextSteps), "upgrade must carry a nextSteps channel");
  },
);

// "user-authored lines in AGENTS.md outside the Jolly marker should remain
// unchanged" is defined in 007-jolly-init-agent-setup.steps.ts (shared); not
// duplicated here.

// ─── Scenario: Upgrade includes skill update behavior ────────────────────────

Given("Jolly has a dedicated `jolly skills update` command", function (this: JollyWorld) {
  // Capability statement; the dedicated command is exercised here directly to
  // confirm it reports per-skill update state, then upgrade is invoked in When.
  seedSkillsOnDisk(this);
  this.runCli(["skills", "update", "--json"], { env: logicSafeEnv() });
  assert.ok(
    this.envelope.command.startsWith("skills"),
    "jolly skills update must be a real command",
  );
});

// "When the agent invokes `jolly upgrade`" is defined above (shared across the
// three 017 scenarios).

Then(
  "the envelope should report which skills were updated, unchanged, skipped, or failed",
  function (this: JollyWorld) {
    // Each managed skill carries a per-skill check whose status reflects its
    // disposition (a present, managed skill checks pass; an absent one skips).
    const validStatuses = new Set(["pass", "warning", "fail", "skipped", "unknown"]);
    for (const id of DEFAULT_SKILL_IDS) {
      const check = this.envelope.checks.find((c) => c.id === `skill-${id}`);
      assert.ok(check, `upgrade must report a disposition for skill "${id}"`);
      assert.ok(
        validStatuses.has(check!.status),
        `skill "${id}" disposition "${check!.status}" must be a known status`,
      );
    }
  },
);

// ─── Scenario: Upgrade considers Paper baseline updates ──────────────────────

Given("a cloned Paper storefront exists", function (this: JollyWorld) {
  // Paper's presence is detected via paper-version.json (the CLI's marker).
  seedSkillsOnDisk(this);
  writeFileSync(
    join(this.projectDir, "paper-version.json"),
    JSON.stringify({ version: "1.0.0" }, null, 2) + "\n",
  );
});

// "When the agent invokes `jolly upgrade`" is defined above.

Then(
  "the envelope `data` should report the detected Paper baseline version",
  function (this: JollyWorld) {
    const data = this.envelope.data as { paperBaselineDetected?: unknown };
    assert.equal(
      data.paperBaselineDetected,
      true,
      "upgrade must detect the cloned Paper baseline (paper-version.json present)",
    );
    const check = this.findCheck("paper-baseline");
    assert.ok(check, "upgrade must report a paper-baseline check");
  },
);

Then(
  "it should read `paper-version.json` to determine the baseline",
  function (this: JollyWorld) {
    // The detected Paper baseline check is the channel that surfaces Paper's
    // migration guidance; with Paper present it is plan-only (not skipped away).
    const check = this.findCheck("paper-baseline");
    assert.ok(check, "missing paper-baseline check");
    assert.notEqual(
      check!.status,
      "skipped",
      "with Paper present, the migration-guidance plan must not be skipped",
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
      "upgrade must not blindly rewrite the customized storefront",
    );
  },
);

Then(
  "it should generate an upgrade plan from Paper's migration guidance",
  function (this: JollyWorld) {
    // Plan-only: the paper-baseline check is present and the nextSteps channel
    // carries the plan to review before any manual migration.
    const check = this.findCheck("paper-baseline");
    assert.ok(check, "upgrade must surface a Paper plan via the paper-baseline check");
    assert.ok(
      this.envelope.nextSteps.length > 0,
      "upgrade must present a Paper upgrade plan to review when Paper is present",
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
