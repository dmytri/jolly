// Steps for features/007-jolly-init-agent-setup.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

const DEFAULT_SKILLS = [
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
];

// --- Agent initializes Jolly guidance locally (@logic) ------------------------

Given("the agent can run Jolly via `npx`", function (this: JollyWorld) {
  const result = this.runCli(["--help"]);
  assert.equal(result.exitCode, 0, "the Jolly CLI is not invocable");
});

When("the agent invokes `jolly init`", { timeout: 180_000 }, function (this: JollyWorld) {
  this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
});

Then(
  "Jolly should install or check the full default Saleor skill set",
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error", this.lastRun!.stdout);
    assert.match(
      JSON.stringify(this.envelope.data),
      /skill/i,
      "init does not report skill installation/check results",
    );
  },
);

Then(
  "the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope);
    for (const skill of DEFAULT_SKILLS) {
      assert.ok(text.includes(skill), `default skill set is missing ${skill}`);
    }
  },
);

Then(
  "it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    // Fabricate a Paper storefront carrying its embedded skill, then re-init.
    const skillDir = join(
      this.projectDir,
      "storefront",
      "skills",
      "saleor-paper-storefront",
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# saleor-paper-storefront\n");
    writeFileSync(
      join(this.projectDir, "storefront", "paper-version.json"),
      JSON.stringify({ version: "0.0.0-test" }),
    );
    const result = this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
    assert.match(
      JSON.stringify(result.envelope),
      /saleor-paper-storefront/,
      "init does not include Paper's embedded skill when a storefront exists",
    );
  },
);

Then(
  "Jolly should use standard project-local skill installation locations where possible",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data),
      /skills/i,
      "init does not report a project-local skills location",
    );
    assert.doesNotMatch(
      JSON.stringify(this.envelope.data),
      /[/\\]home[/\\]|~\/\.jolly/,
      "skills are installed outside the project",
    );
  },
);

Then(
  "Jolly should write or update agent-specific glue files or instructions for supported environments",
  function (this: JollyWorld) {
    const data = JSON.stringify(this.envelope);
    assert.match(
      data,
      /AGENTS\.md|CLAUDE\.md|\.cursor|\.zed|opencode|instructions/i,
      "init reports no agent-specific glue files",
    );
  },
);

Then("Jolly should explain what was installed or updated", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.trim().length > 0, "init has no summary");
  assert.match(
    JSON.stringify(this.envelope.data),
    /install|updat|check|unchanged|exist/i,
    "init does not explain what changed",
  );
});

Then(
  "Jolly should not create remote Saleor Cloud or Vercel resources",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope),
      /created (a )?(saleor|store|environment|vercel|deployment|project)\b/i,
      "init claims to have created remote resources",
    );
  },
);

Then("Jolly should not store secrets", function (this: JollyWorld) {
  const envPath = join(this.projectDir, ".env");
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, "utf8");
    assert.doesNotMatch(
      env,
      /TOKEN|SECRET|KEY/,
      "init wrote secret-bearing variables to .env",
    );
  }
});

// --- Agent init is safe to rerun (@logic) -------------------------------------

Given("`jolly init` has already been run", { timeout: 180_000 }, function (this: JollyWorld) {
  const result = this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
  assert.notEqual(result.envelope?.status, "error", result.stdout);
  // A user-authored instruction file that the rerun must not clobber.
  writeFileSync(
    join(this.projectDir, "my-instructions.md"),
    "user-authored content — do not touch\n",
  );
});

When(
  "the agent invokes `jolly init` again",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
  },
);

Then("Jolly should detect existing skills and guidance", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /exist|already|unchanged|up.to.date|current/i,
    "the rerun does not report detection of existing skills/guidance",
  );
});

Then(
  "it should update outdated managed guidance when appropriate",
  function (this: JollyWorld) {
    // Nothing is outdated immediately after a fresh init; the rerun must
    // simply classify managed assets rather than blindly rewrite them.
    assert.match(
      JSON.stringify(this.envelope.data),
      /updat|unchanged|current|skip/i,
      "the rerun does not classify managed guidance state",
    );
  },
);

Then(
  "it should avoid overwriting unrelated user-authored instructions without approval",
  function (this: JollyWorld) {
    assert.equal(
      readFileSync(join(this.projectDir, "my-instructions.md"), "utf8"),
      "user-authored content — do not touch\n",
      "the rerun modified an unrelated user-authored instruction file",
    );
  },
);

Then("it should produce a concise summary of changes", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.trim().length > 0, "the rerun has no summary");
});
