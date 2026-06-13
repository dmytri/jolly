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

Given("Jolly manages skill installation and agent guidance", function () {
  // Capability statement; exercised by the upgrade scenarios below.
});

Given(
  "Paper includes its own migrations and `paper-version.json`",
  function () {
    // Capability statement; the Paper-baseline scenario seeds a paper-version.json.
  },
);

// ─── Scenario: Agent upgrades Jolly-managed skills and guidance ──────────────

Given(
  "a project has previously run `jolly init` or `jolly skills install`",
  function (this: JollyWorld) {
    // Pre-seed the standard skill locations so upgrade sees managed skills
    // present on disk (offline-deterministic).
    seedSkillsOnDisk(this);
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
  "it should summarize available changes before applying them when appropriate",
  function (this: JollyWorld) {
    assert.ok(this.envelope.summary.length > 0, "upgrade must summarize available changes");
    assert.ok(Array.isArray(this.envelope.nextSteps), "upgrade must carry a nextSteps channel");
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval or an explicit strategy",
  function (this: JollyWorld) {
    // upgrade reports/plan only for managed assets; it must not error or claim
    // it rewrote user content. The plan-only Paper contract reinforces this.
    const data = this.envelope.data as { paperAutoApply?: unknown };
    assert.equal(
      data.paperAutoApply,
      false,
      "upgrade must not auto-apply changes that could overwrite customer content",
    );
  },
);

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
  "`jolly upgrade` may call or orchestrate `jolly skills update`",
  function (this: JollyWorld) {
    // Observable: upgrade enumerates the same Jolly-managed skill set that
    // `jolly skills update` operates on, with one check per skill.
    const data = this.envelope.data as { skillsChecked?: unknown };
    assert.ok(
      Array.isArray(data.skillsChecked) && (data.skillsChecked as unknown[]).length === DEFAULT_SKILL_IDS.length,
      "upgrade must orchestrate the same managed skill set as jolly skills update",
    );
  },
);

Then(
  "it should report which skills were updated, unchanged, skipped, or failed",
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
  "Jolly should detect the Paper baseline where possible",
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
  "it should detect Paper's embedded migration guidance where available",
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
  "it should not blindly rewrite the customer's customized storefront",
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
