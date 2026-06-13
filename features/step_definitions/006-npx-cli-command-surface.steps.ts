// Feature 006 — Npx-first Jolly CLI command surface.
//
// @logic scenario "Npx execution does not require Bun": exercise the package
// AS PUBLISHED — `npm pack` the tarball, install it into a throwaway
// `node_modules`, and run the INSTALLED `jolly` bin on a PATH that holds only a
// `node` symlink (Bun unresolvable). Require the standard envelope on stdout
// with exit 0. Running `bin/jolly` from the source tree (where `src/` is not
// under `node_modules`) is a false pass that hid the npx breakage of
// 0.1.11/0.2.0 (feature 006 Rule; correction 2026-06-13: the package must ship
// pre-built JS, since Node disables type stripping under `node_modules`).
//
// @logic scenario "Agent starts the guided setup flow": `jolly start`
// bootstraps and emits the ordered playbook in Jolly's hybrid (human +
// machine-readable) format.
//
// Safety (the "012 incident"): the installed-bin run builds its environment
// from scratch (no .env leakage) and forces dummy credentials for all groups
// plus an unroutable `.invalid` Cloud API base, so a side-effecting path can
// never reach a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { findEnvelope } from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";

/**
 * Scan PATH for a genuine Node.js >= 23 binary, skipping Bun (and Bun shims
 * named `node`, which `bun --bun` injects at the front of PATH). Returns the
 * absolute path of the first match, or null if only Bun is resolvable.
 */
function findGenuineNode(): string | null {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, "node");
    if (!existsSync(candidate)) continue;
    const ident = spawnSync(
      candidate,
      [
        "-e",
        "process.stdout.write(JSON.stringify({bun:process.versions.bun??null,node:process.versions.node}))",
      ],
      { encoding: "utf8" },
    );
    if (ident.status !== 0) continue;
    let versions: { bun: string | null; node: string | null };
    try {
      versions = JSON.parse(ident.stdout || "{}");
    } catch {
      continue;
    }
    if (versions.bun === null && Number(String(versions.node).split(".")[0]) >= 23) {
      return candidate;
    }
  }
  return null;
}

// --- Scenario: Npx execution does not require Bun --------------------------

Given(
  "a machine with Node.js available but no Bun on the PATH",
  function (this: JollyWorld) {
    // Build a clean PATH holding ONLY a `node` symlink — no `bun` resolvable.
    //
    // The `node` must be a GENUINE Node binary, not `process.execPath`: under
    // the `bun x --bun` test harness `process.execPath` is Bun, and `--bun`
    // even injects a Bun shim named `node` at the front of PATH. A Bun
    // masquerading as `node` strips `.ts` happily — which silently masked the
    // npx breakage this scenario exists to catch. So scan every PATH entry for
    // a `node` that reports NO `process.versions.bun` at the required major
    // version, skipping Bun shims.
    const realNode = findGenuineNode();
    assert.ok(
      realNode,
      "this scenario requires a genuine Node.js >= 23 binary on PATH (only Bun was found)",
    );

    const binDir = this.newTempDir("node-only-bin");
    symlinkSync(realNode!, join(binDir, "node"));
    this.notes.nodeOnlyPath = binDir;

    // Assert Bun is not resolvable on this PATH (uses `command -v bun`).
    const probe = spawnSync("sh", ["-c", "command -v bun"], {
      env: { PATH: binDir },
      encoding: "utf8",
    });
    assert.notEqual(
      probe.status,
      0,
      "Bun must not be resolvable on the node-only PATH for this scenario",
    );
  },
);

When(
  "the agent runs `jolly start --dry-run --json` through the published launcher",
  { timeout: 240_000 },
  function (this: JollyWorld) {
    const binDir = String(this.notes.nodeOnlyPath);

    // The full (inherited) env for the build/install steps: npm and node must
    // be resolvable, and so must Bun if the package's build step (prepack)
    // needs it. Only the FINAL installed-bin run uses the node-only PATH.
    const fullEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) fullEnv[k] = v;
    }

    // 1. Pack the package exactly as `npm publish` would (runs prepack/prepare,
    //    so once a build step exists it runs here and ships its output). The
    //    tarball is whatever `files` declares — this is what `npx @dk/jolly`
    //    actually downloads and runs.
    const packDir = this.newTempDir("pack");
    const pack = spawnSync("npm", ["pack", "--pack-destination", packDir], {
      cwd: REPO_ROOT,
      env: fullEnv,
      encoding: "utf8",
      timeout: 180_000,
    });
    assert.equal(pack.status, 0, `npm pack must succeed; stderr:\n${pack.stderr}`);
    const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
    assert.ok(tarball, "npm pack must produce a .tgz tarball");

    // 2. Install the tarball into a throwaway prefix — its files now live UNDER
    //    `node_modules`, the real npx path that disables Node type stripping.
    //    `--offline --ignore-scripts`: the package has no runtime deps, so the
    //    install never touches the network.
    const installRoot = this.newTempDir("install");
    const install = spawnSync(
      "npm",
      [
        "install",
        join(packDir, tarball!),
        "--prefix",
        installRoot,
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--offline",
        "--ignore-scripts",
      ],
      { cwd: installRoot, env: fullEnv, encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(
      install.status,
      0,
      `npm install of the packed tarball must succeed; stderr:\n${install.stderr}`,
    );
    const installedBin = join(installRoot, "node_modules", ".bin", "jolly");
    assert.ok(
      existsSync(installedBin),
      "the installed package must expose a `jolly` bin",
    );

    // 3. Run the INSTALLED bin on the node-only PATH (Bun unresolvable, asserted
    //    in the Given) via its own `#!/usr/bin/env node` shebang. Env built from
    //    scratch + logic-safe dummy creds + unroutable Cloud API base, so a
    //    side-effecting path can never reach a real account ("012 incident").
    //    Keep the directory holding `env` on PATH so the shebang resolves,
    //    without adding any Bun-bearing dir.
    const envBin = spawnSync("sh", ["-c", "command -v env"], { encoding: "utf8" });
    const envDir = dirname((envBin.stdout ?? "/usr/bin/env").trim() || "/usr/bin/env");
    const safe = logicSafeEnv();
    const childEnv: Record<string, string> = {
      PATH: `${binDir}${delimiter}${envDir}`,
    };
    for (const [k, v] of Object.entries(safe)) if (v !== undefined) childEnv[k] = v;

    const result = spawnSync(installedBin, ["start", "--dry-run", "--json"], {
      cwd: this.projectDir,
      env: childEnv,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) {
      throw new Error(`failed to run the installed jolly bin: ${result.error.message}`);
    }
    this.notes.launcherStdout = result.stdout ?? "";
    this.notes.launcherStderr = result.stderr ?? "";
    this.notes.launcherExit = result.status;
  },
);

Then("the command should succeed using Node alone", function (this: JollyWorld) {
  assert.equal(
    this.notes.launcherExit,
    0,
    `launcher should exit 0 using Node alone; stderr:\n${this.notes.launcherStderr}`,
  );
});

Then(
  "stdout should carry the standard output envelope",
  function (this: JollyWorld) {
    const envelope = findEnvelope(String(this.notes.launcherStdout));
    assert.ok(envelope, "launcher stdout must carry the standard output envelope");
    assert.equal(envelope!.command, "start");
    assert.equal(typeof envelope!.summary, "string");
    assert.ok(Array.isArray(envelope!.nextSteps));
  },
);

// --- Scenario: Agent starts the guided setup flow --------------------------

Given(
  "the customer wants the end-to-end guided Saleor storefront setup",
  function () {
    // Framing; the guided command is invoked in the When.
  },
);

When("the agent invokes the primary guided command", function (this: JollyWorld) {
  // `jolly start` is the primary guided command. Run under logicSafeEnv so the
  // bootstrap cannot reach a real account; the temp project is isolated.
  this.runCli(["start", "--json"], { env: logicSafeEnv() });
});

Then(
  "`jolly start` should bootstrap setup \\(install the Jolly skill and Saleor skills, scaffold, run doctor) and emit the ordered playbook for the agent to execute",
  function (this: JollyWorld) {
    const data = this.envelope.data as {
      bootstrap?: { doctorRan?: unknown };
      playbook?: unknown;
    };
    // Bootstrap evidence: a bootstrap record (skills/scaffold/doctor) and an
    // ordered playbook (in data and/or nextSteps) for the agent to execute.
    assert.ok(data.bootstrap, "start must report a bootstrap record");
    assert.equal(data.bootstrap.doctorRan, true, "start must run doctor during bootstrap");
    const playbook = Array.isArray(data.playbook) ? data.playbook : [];
    assert.ok(playbook.length > 0, "start must emit an ordered playbook");
    assert.ok(this.envelope.nextSteps.length > 0, "start must emit nextSteps for the agent");
  },
);

Then(
  "the agent then drives the official CLIs \\(Vercel CLI, `@saleor\\/configurator`, `git`, `pnpm`) per the Jolly skill, calling Jolly's thin helpers for plumbing",
  function (this: JollyWorld) {
    // The playbook directs the agent to the official CLIs; Jolly itself never
    // shells out to them. Assert the playbook references the agent-run tooling.
    const data = this.envelope.data as { playbook?: unknown };
    const playbook = (Array.isArray(data.playbook) ? data.playbook : []).join(" ").toLowerCase();
    const stepText = this.envelope.nextSteps
      .map((s) => `${s.description ?? ""} ${s.command ?? ""}`)
      .join(" ")
      .toLowerCase();
    const haystack = `${playbook} ${stepText}`;
    assert.ok(/vercel/.test(haystack), "playbook should reference the Vercel CLI");
    assert.ok(/configurator/.test(haystack), "playbook should reference @saleor/configurator");
    assert.ok(/git/.test(haystack), "playbook should reference git");
  },
);

Then(
  "the output should follow Jolly's hybrid human-readable plus machine-readable format",
  function (this: JollyWorld) {
    // Default (non --json) mode carries both human text AND the envelope.
    this.runCli(["start"], { env: logicSafeEnv() });
    const run = this.lastRun!;
    assert.ok(run.envelope, "default-mode start must carry the machine-readable envelope");
    const envelopeJson = JSON.stringify(run.envelope);
    const human = run.stdout.replace(envelopeJson, "").trim();
    assert.ok(
      human.length > 0,
      "default-mode start must include human-readable text alongside the envelope",
    );
  },
);
