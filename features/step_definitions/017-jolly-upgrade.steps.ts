// Steps for features/017-jolly-upgrade.feature (all @logic).
// Paper-baseline scenarios use a local fixture storefront carrying Paper's own
// markers (paper-version.json, migrations/) per the feature 003 research notes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope } from "../support/cli.ts";
import { writePaperFixture } from "./014-jolly-doctor-diagnostics.steps.ts";
import type { JollyWorld } from "../support/world.ts";

const UPGRADE_TIMEOUT = { timeout: 600_000 };
const USER_MARKER = "## User-authored guidance, not Jolly-managed (017 marker)\n";

function fingerprintDir(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(path).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

Given(lit("Jolly manages skill installation and agent guidance"), function () {
  // Premise.
});

Given(lit("Paper includes its own migrations and `paper-version.json`"), function () {
  // Premise (feature 003 research notes).
});

// --- Scenario: Agent upgrades Jolly-managed skills and guidance --------------

Given(
  lit("a project has previously run `jolly init` or `jolly skills install`"),
  UPGRADE_TIMEOUT,
  async function (this: JollyWorld) {
    writeFileSync(join(this.projectDir, "AGENTS.md"), USER_MARKER);
    const run = await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
    assert.notEqual(requireEnvelope(run).status, "error", "jolly init must succeed before upgrade");
  },
);

When(lit("the agent invokes `jolly upgrade`"), UPGRADE_TIMEOUT, async function (this: JollyWorld) {
  await this.jolly(["upgrade", "--json", "--yes"], { timeoutMs: 540_000 });
});

Then(lit("Jolly should check for updates to Jolly-managed skills"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "error", `upgrade failed: ${envelope.summary}`);
  assert.ok(/skill/i.test(JSON.stringify(envelope.data)), "upgrade must report on Jolly-managed skills");
});

Then(lit("it should check for updates to Jolly-managed agent guidance"), function (this: JollyWorld) {
  assert.ok(
    /guidance|instruction|glue/i.test(JSON.stringify(requireEnvelope(this.lastRun!).data)),
    "upgrade must report on Jolly-managed agent guidance",
  );
});

Then(lit("it should summarize available changes before applying them when appropriate"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(envelope.summary.trim().length > 0, "upgrade must summarize available changes");
});

Then(
  lit("it should avoid overwriting unrelated user-authored instructions without approval or an explicit strategy"),
  function (this: JollyWorld) {
    const content = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(content.includes(USER_MARKER.trim()), "user-authored AGENTS.md content was overwritten by upgrade");
  },
);

// --- Scenario: Upgrade includes skill update behavior ------------------------

Given(lit("Jolly has a dedicated `jolly skills update` command"), async function (this: JollyWorld) {
  const help = await this.jolly(["skills", "--help"]);
  assert.ok(/\bupdate\b/.test(help.stdout), "`jolly skills --help` must list the update subcommand");
  // The scenario needs an initialized project for upgrade to act on.
  const init = await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(init).status, "error");
});

Then(lit("`jolly upgrade` may call or orchestrate `jolly skills update`"), function (this: JollyWorld) {
  // Permission plus reporting obligation: the upgrade envelope must cover the
  // skill-update dimension (asserted concretely in the next step).
  assert.ok(/skill/i.test(JSON.stringify(requireEnvelope(this.lastRun!))), "upgrade must cover skills");
});

Then(
  lit("it should report which skills were updated, unchanged, skipped, or failed"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(requireEnvelope(this.lastRun!).data);
    assert.ok(
      /updated|unchanged|skipped|failed|current|up.to.date/i.test(serialized),
      "upgrade must report per-skill disposition (updated/unchanged/skipped/failed)",
    );
  },
);

// --- Scenario: Upgrade considers Paper baseline updates ----------------------

Given(lit("a cloned Paper storefront exists"), function (this: JollyWorld) {
  const dir = writePaperFixture(this.projectDir);
  this.vars.set("storefrontDir", dir);
  this.vars.set("storefrontFingerprint", fingerprintDir(dir));
});

Then(lit("Jolly should detect the Paper baseline where possible"), function (this: JollyWorld) {
  assert.ok(
    /paper/i.test(JSON.stringify(requireEnvelope(this.lastRun!).data)),
    "upgrade must detect and report the Paper baseline",
  );
});

Then(lit("it should detect Paper's embedded migration guidance where available"), function (this: JollyWorld) {
  assert.ok(
    /migration/i.test(JSON.stringify(requireEnvelope(this.lastRun!))),
    "upgrade must detect Paper's migration guidance",
  );
});

Then(lit("it should not blindly rewrite the customer's customized storefront"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  assert.equal(
    fingerprintDir(dir),
    this.vars.get("storefrontFingerprint"),
    "upgrade modified storefront files it must not touch",
  );
});

Then(lit("it should generate an upgrade plan from Paper's migration guidance"), function (this: JollyWorld) {
  assert.ok(
    /plan/i.test(JSON.stringify(requireEnvelope(this.lastRun!))),
    "upgrade must produce a Paper upgrade plan",
  );
});

Then(lit("it should not apply Paper migrations automatically in v1"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  assert.equal(
    fingerprintDir(dir),
    this.vars.get("storefrontFingerprint"),
    "Paper migrations were applied automatically",
  );
});
