// Steps for features/017-jolly-upgrade.feature.
// "Given Jolly uses Saleor Paper as the storefront baseline" is defined in the
// feature 005 step file (shared step text).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

/** A minimal fake Paper storefront with migration guidance, for plan-only checks. */
function fabricatePaperStorefront(world: JollyWorld): string {
  const dir = join(world.projectDir, "storefront");
  mkdirSync(join(dir, "migrations"), { recursive: true });
  writeFileSync(
    join(dir, "paper-version.json"),
    JSON.stringify({ version: "0.0.1-test" }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "paper-storefront-fixture", private: true }),
  );
  writeFileSync(
    join(dir, "migrations", "0001-example.md"),
    "# Example Paper migration guidance\n",
  );
  writeFileSync(join(dir, "customized.ts"), "// customer customization\n");
  return dir;
}

/** Stable snapshot of a directory tree's file contents. */
function snapshot(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".git") walk(path);
      } else {
        parts.push(`${path}:${readFileSync(path, "utf8")}`);
      }
    }
  };
  walk(dir);
  return parts.join("\n---\n");
}

// --- Background -------------------------------------------------------------------

Given(
  "Jolly manages skill installation and agent guidance",
  function (this: JollyWorld) {
    // Pinned product boundary; context only.
  },
);

Given(
  "Paper includes its own migrations and `paper-version.json`",
  function (this: JollyWorld) {
    // Upstream research note; context only.
  },
);

// --- Agent upgrades Jolly-managed skills and guidance (@logic) ----------------------

Given(
  "a project has previously run `jolly init` or `jolly skills install`",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
    assert.notEqual(result.envelope?.status, "error", result.stdout);
    writeFileSync(
      join(this.projectDir, "my-instructions.md"),
      "user-authored content — do not touch\n",
    );
  },
);

When(
  "the agent invokes `jolly upgrade`",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    this.runCli(["upgrade", "--yes", "--json"], { timeoutMs: 150_000 });
  },
);

Then(
  "Jolly should check for updates to Jolly-managed skills",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /skill/i,
      "upgrade does not report a Jolly-managed skill update check",
    );
  },
);

Then(
  "it should check for updates to Jolly-managed agent guidance",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /guidance|instruction/i,
      "upgrade does not report an agent-guidance update check",
    );
  },
);

Then(
  "it should summarize available changes before applying them when appropriate",
  function (this: JollyWorld) {
    assert.ok(this.envelope.summary.trim().length > 0, "upgrade has no summary");
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval or an explicit strategy",
  function (this: JollyWorld) {
    assert.equal(
      readFileSync(join(this.projectDir, "my-instructions.md"), "utf8"),
      "user-authored content — do not touch\n",
      "upgrade modified an unrelated user-authored instruction file",
    );
  },
);

// --- Upgrade includes skill update behavior (@logic) ---------------------------------

Given(
  "Jolly has a dedicated `jolly skills update` command",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["skills", "update", "--yes", "--json"], {
      timeoutMs: 150_000,
    });
    assert.ok(result.envelope, "`jolly skills update` emitted no envelope");
    assert.doesNotMatch(
      JSON.stringify(result.envelope.errors),
      /unknown (command|subcommand)/i,
      "`jolly skills update` is not a dedicated command",
    );
  },
);

Then(
  "`jolly upgrade` may call or orchestrate `jolly skills update`",
  function (this: JollyWorld) {
    // Permission, not an obligation; the reporting step below is the
    // observable contract.
  },
);

Then(
  "it should report which skills were updated, unchanged, skipped, or failed",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data),
      /updated|unchanged|skipped|failed|current|up.to.date/i,
      "upgrade does not classify per-skill outcomes",
    );
  },
);

// --- Upgrade considers Paper baseline updates (@logic) --------------------------------

Given("a cloned Paper storefront exists", function (this: JollyWorld) {
  const dir = fabricatePaperStorefront(this);
  this.notes.storefrontSnapshot = snapshot(dir);
});

Then("Jolly should detect the Paper baseline where possible", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /paper/i,
    "upgrade does not detect the Paper baseline",
  );
});

Then(
  "it should detect Paper's embedded migration guidance where available",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /migration/i,
      "upgrade does not detect Paper's migration guidance",
    );
  },
);

Then(
  "it should not blindly rewrite the customer's customized storefront",
  function (this: JollyWorld) {
    assert.equal(
      snapshot(join(this.projectDir, "storefront")),
      this.notes.storefrontSnapshot,
      "upgrade modified the customer's storefront files",
    );
  },
);

Then(
  "it should generate an upgrade plan from Paper's migration guidance",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /plan/i,
      "upgrade does not generate a Paper upgrade plan",
    );
  },
);

Then(
  "it should not apply Paper migrations automatically in v1",
  function (this: JollyWorld) {
    assert.equal(
      snapshot(join(this.projectDir, "storefront")),
      this.notes.storefrontSnapshot,
      "upgrade applied Paper migrations automatically",
    );
  },
);
