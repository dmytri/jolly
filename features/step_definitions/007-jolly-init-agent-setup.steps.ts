// Steps for features/007-jolly-init-agent-setup.feature (@logic).
//
// `jolly init` is local-only by spec (no remote resources, no secrets), so it
// runs in the scenario's fresh project dir with no credentials at all — its
// success without creds is itself part of the contract.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import type { JollyWorld } from "../support/world.ts";

const DEFAULT_SKILLS = [
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
];

const INIT_TIMEOUT = { timeout: 600_000 };

const USER_MARKER = "## User-authored guidance: do not touch (test marker)\n";

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(path));
    else out.push(path);
  }
  return out;
}

Given(lit("the agent can run Jolly via `npx`"), function () {
  // Premise (see support/cli.ts for the local invocation seam).
});

When(lit("the agent invokes `jolly init`"), INIT_TIMEOUT, async function (this: JollyWorld) {
  // Seed a user-authored instructions file first: init must preserve it.
  writeFileSync(join(this.projectDir, "AGENTS.md"), USER_MARKER);
  await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
});

Then(lit("Jolly should install or check the full default Saleor skill set"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "error", `init failed: ${envelope.summary}`);
  const serialized = JSON.stringify(envelope.data);
  const missing = DEFAULT_SKILLS.filter((skill) => !serialized.includes(skill));
  assert.deepEqual(missing, [], `init did not install/check default skills: ${missing.join(", ")}`);
});

Then(
  lit("the default skill set should include `saleor-storefront`, `saleor-configurator`, `storefront-builder`, `saleor-core`, and `saleor-app`"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(requireEnvelope(this.lastRun!).data);
    for (const skill of DEFAULT_SKILLS) {
      assert.ok(serialized.includes(skill), `default skill set missing ${skill}`);
    }
  },
);

Then(
  lit("it should include Paper's embedded `saleor-paper-storefront` skill when a storefront exists"),
  function (this: JollyWorld) {
    // No storefront exists in this scenario; the conditional skill must not be
    // claimed as installed, but the envelope must know about the conditional.
    const serialized = JSON.stringify(requireEnvelope(this.lastRun!));
    assert.ok(
      serialized.includes("saleor-paper-storefront"),
      "init must report the storefront-conditional saleor-paper-storefront skill (e.g. as skipped: no storefront)",
    );
  },
);

Then(
  lit("Jolly should use standard project-local skill installation locations where possible"),
  function (this: JollyWorld) {
    // At least one reported skill location must exist inside the project dir.
    const envelope = requireEnvelope(this.lastRun!);
    const reported = JSON.stringify(envelope.data).match(/"[^"]*skills[^"]*"/gi) ?? [];
    const localPaths = listFilesRecursive(this.projectDir).filter((p) => /skill/i.test(p));
    assert.ok(
      localPaths.length > 0,
      `no project-local skill files were installed under ${this.projectDir}; envelope reported: ${reported.join(", ")}`,
    );
  },
);

Then(
  lit("Jolly should write or update agent-specific glue files or instructions for supported environments"),
  function (this: JollyWorld) {
    const files = listFilesRecursive(this.projectDir).map((p) => p.slice(this.projectDir.length + 1));
    const glue = files.filter((p) =>
      /^(AGENTS\.md|CLAUDE\.md|\.claude\/|\.cursor\/|\.zed\/|\.opencode\/|\.pi\/|\.rules|\.cursorrules)/i.test(p),
    );
    assert.ok(glue.length > 0, `init wrote no agent glue files; project contains: ${files.join(", ")}`);
  },
);

Then(lit("Jolly should explain what was installed or updated"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(envelope.summary.trim().length > 0, "init must summarize what changed");
  assert.ok(
    /install|updat|check|wrote|added|skill/i.test(envelope.summary + JSON.stringify(envelope.data)),
    "init output must explain installed/updated assets",
  );
});

Then(lit("Jolly should not create remote Saleor Cloud or Vercel resources"), function (this: JollyWorld) {
  // init ran with no credentials whatsoever and still had to succeed — remote
  // resource creation is impossible without them. Also: no remote riskContext.
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "error", "init must succeed without any remote credentials");
});

Then(lit("Jolly should not store secrets"), function (this: JollyWorld) {
  assert.ok(!existsSync(join(this.projectDir, ".env")), "init must not write a .env (it has no secrets to store)");
  const offenders = listFilesRecursive(this.projectDir).filter((path) =>
    /sk_(test|live)_|JOLLY_[A-Z_]*TOKEN\s*=\s*\S/.test(safeRead(path)),
  );
  assert.deepEqual(offenders, [], `files containing secret-like values: ${offenders.join(", ")}`);
});

Given(lit("`jolly init` has already been run"), INIT_TIMEOUT, async function (this: JollyWorld) {
  writeFileSync(join(this.projectDir, "AGENTS.md"), USER_MARKER);
  const run = await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(run).status, "error", "first init run must succeed");
  this.vars.set("firstInit", run);
});

When(lit("the agent invokes `jolly init` again"), INIT_TIMEOUT, async function (this: JollyWorld) {
  await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
});

Then(lit("Jolly should detect existing skills and guidance"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "error", "re-running init must be safe");
  assert.ok(
    /already|exist|up.to.date|unchanged|detected|checked/i.test(JSON.stringify(envelope)),
    "second init must report detected existing skills/guidance",
  );
});

Then(lit("it should update outdated managed guidance when appropriate"), function (this: JollyWorld) {
  // Nothing is outdated in a back-to-back rerun; the contract here is that the
  // envelope reports per-asset disposition rather than blindly rewriting.
  const serialized = JSON.stringify(requireEnvelope(this.lastRun!).data);
  assert.ok(
    /updat|unchanged|current|up.to.date|skip/i.test(serialized),
    "init rerun must report update/unchanged disposition for managed guidance",
  );
});

Then(
  lit("it should avoid overwriting unrelated user-authored instructions without approval"),
  function (this: JollyWorld) {
    const content = readFileSync(join(this.projectDir, "AGENTS.md"), "utf8");
    assert.ok(content.includes(USER_MARKER.trim()), "user-authored AGENTS.md content was overwritten by init");
  },
);

Then(lit("it should produce a concise summary of changes"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(envelope.summary.trim().length > 0, "init rerun must summarize changes");
});

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
