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
// Safety: the installed-bin run builds its environment from scratch (no .env
// leakage) with the runtime credentials genuinely unset (real absence), so a
// side-effecting path cannot reach a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { findEnvelope } from "../support/envelope.ts";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";

/**
 * Scan PATH for a genuine Node.js >= 20 binary, skipping Bun (and Bun shims
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
    if (versions.bun === null && Number(String(versions.node).split(".")[0]) >= 20) {
      return candidate;
    }
  }
  return null;
}

// Pack the package exactly as `npm publish` would (runs prepack/prepare, so the
// build step ships its output), install the tarball into a throwaway prefix so
// its files live UNDER `node_modules` — the real npx path that disables Node
// type stripping — and return the installed `jolly` bin. This is the
// "as actually installed" guarantee: the bin, its `dist` build, and its shipped
// assets are exactly what `npx @dk/jolly` downloads and runs, not the source
// tree. `--offline --ignore-scripts`: the package has no runtime deps, so the
// install never touches the network.
function packAndInstallJolly(world: JollyWorld): {
  installedBin: string;
  fullEnv: Record<string, string>;
} {
  // The full (inherited) env for the build/install steps: npm and node must be
  // resolvable, and so must Bun if the package's build step needs it.
  const fullEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) fullEnv[k] = v;
  }

  const packDir = world.newTempDir("pack");
  const pack = spawnSync("npm", ["pack", "--pack-destination", packDir], {
    cwd: REPO_ROOT,
    env: fullEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
  assert.equal(pack.status, 0, `npm pack must succeed; stderr:\n${pack.stderr}`);
  const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
  assert.ok(tarball, "npm pack must produce a .tgz tarball");

  const installRoot = world.newTempDir("install");
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
  return { installedBin, fullEnv };
}

// --- Scenario: Npx execution does not require Bun --------------------------

Given(
  "a machine with only Node.js available",
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
      "this scenario requires a genuine Node.js >= 20 binary on PATH (only Bun was found)",
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

    // Pack + install the package as published; only the FINAL installed-bin run
    // below uses the node-only PATH.
    const { installedBin } = packAndInstallJolly(this);

    // Run the INSTALLED bin on the node-only PATH (Bun unresolvable, asserted
    // in the Given) via its own `#!/usr/bin/env node` shebang. Env built from
    // scratch with the runtime credentials genuinely unset (real absence), so a
    // side-effecting path cannot reach a real account. Keep the directory
    // holding `env` on PATH so the shebang resolves, without adding any
    // Bun-bearing dir.
    const envBin = spawnSync("sh", ["-c", "command -v env"], { encoding: "utf8" });
    const envDir = dirname((envBin.stdout ?? "/usr/bin/env").trim() || "/usr/bin/env");
    const safe = absentCredentialsEnv();
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

// --- Scenario: published package renders interactive copy from its catalog --
// The "as actually installed" guard on the INTERACTIVE path. The human-facing
// message catalog (`assets/messages/cli.json`) is read at runtime from the
// installed package, never bundled into `dist/index.js` (feature 006 Rule), so
// running the source tree would hide a packaging gap. Pack + install the
// package, then run the installed `jolly start --dry-run` bin under a real PTY
// (a genuine interactive terminal) pressing Enter at every prompt. The Then
// asserts the trailing Stripe-step note the human sees IS the catalog's
// `start.stripeFinal` message — proving the installed CLI resolved the catalog
// from its own package. Credentials genuinely unset so the dry-run walk-through
// reaches no real account; skip when no PTY is available.

When(
  "the installed `jolly start --dry-run` runs through the published launcher in an interactive terminal, accepting every default",
  { timeout: 240_000 },
  function (this: JollyWorld) {
    if (!ptyAvailable()) return "skipped";
    const { installedBin } = packAndInstallJolly(this);

    // Build the child env from scratch with the runtime credentials genuinely
    // unset (real absence); keep TERM so the prompt renderer draws its UI.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...absentCredentialsEnv() })) {
      if (v !== undefined) env[k] = v;
    }
    if (!env.TERM) env.TERM = "xterm-256color";

    // Run the installed bin itself (its `#!/usr/bin/env node` shebang) — the
    // published launcher — under the PTY. Press Enter at every prompt: a
    // generous run of carriage returns; extra Enters past child exit drop
    // harmlessly.
    const run = runUnderPty({
      runtime: installedBin,
      argv: ["start", "--dry-run"],
      cwd: this.projectDir,
      env,
      inputs: ["\r", "\r", "\r", "\r", "\r", "\r"],
      inputDelayMs: 600,
      timeoutMs: 150_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: ["start", "--dry-run"],
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
      envelope: findEnvelope(run.output),
    };
  },
);

// --- Scenario: Agent starts the guided setup flow --------------------------

Given(
  "the customer wants the end-to-end guided Saleor storefront setup",
  function () {
    // Framing; the guided command is invoked in the When.
  },
);

When("the agent runs `jolly start --json`", function (this: JollyWorld) {
  // `jolly start` is the primary guided command. Run with the credentials unset
  // so the bootstrap cannot reach a real account; the temp project is isolated.
  this.runCli(["start", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "`jolly start` should bootstrap setup \\(install the Jolly skill and Saleor skills, scaffold, run doctor) and run the ordered mechanical setup stages",
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
  "it should spawn the official CLIs \\(Vercel CLI, `@saleor\\/configurator`, `git`, `pnpm`) under their own auth while using Jolly's thin helpers for plumbing",
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
  "with `--json` the output should be the machine-readable envelope on stdout \\(feature 020)",
  function (this: JollyWorld) {
    // The When ran `jolly start --json`: with --json the output is the machine
    // envelope on stdout (feature 020's agent opt-in to machine output).
    const run = this.lastRun!;
    assert.ok(
      run.envelope,
      "`jolly start --json` must carry the machine-readable envelope on stdout",
    );
  },
);

// --- Scenario Outline: every subcommand prints usage on --help -------------
// `--help` is how an agent learns a command's flags without guessing. Every
// command and subcommand must print a usage summary naming itself and its
// flags, exit 0, and never abort with "Command aborted" or fall into the
// command's normal flow (a broken `login --help` starts the OAuth listener and
// hangs). Run with credentials genuinely unset so no --help path can reach a
// real account, and cap the wait so a broken (flow-entering) path fails fast.

Given("the published Jolly CLI", function () {
  // Framing; the command is invoked in the When via the standard CLI entry.
});

When(
  /^the agent runs `jolly (.+) --help`$/,
  { timeout: 30_000 },
  function (this: JollyWorld, command: string) {
    this.notes.helpCommand = command;
    this.runCli([...command.split(" "), "--help"], {
      env: absentCredentialsEnv(),
      timeoutMs: 15_000,
    });
  },
);

Then("the command should exit successfully", function (this: JollyWorld) {
  assert.equal(
    this.lastRun!.exitCode,
    0,
    `\`jolly ${this.notes.helpCommand} --help\` must exit 0; got ${this.lastRun!.exitCode}; stderr:\n${this.lastRun!.stderr}`,
  );
});

Then(
  "it should print a usage summary naming the command and its flags",
  function (this: JollyWorld) {
    const command = String(this.notes.helpCommand);
    const text = (this.lastRun!.stdout + " " + this.lastRun!.stderr).toLowerCase();
    // Names the command (its last word — the leaf subcommand) and the usage.
    const leaf = command.split(" ").pop()!.toLowerCase();
    assert.ok(text.includes("usage"), `--help output must include a usage summary; got: ${text}`);
    assert.ok(
      text.includes(leaf),
      `--help output must name the command "${leaf}"; got: ${text}`,
    );
    // Names at least one flag (an option printed as --something).
    assert.ok(
      /--[a-z]/.test(text),
      `--help output must name the command's flags; got: ${text}`,
    );
  },
);

Then(
  "it should not abort with {string}",
  function (this: JollyWorld, abortText: string) {
    const text = this.lastRun!.stdout + " " + this.lastRun!.stderr;
    assert.ok(
      !text.includes(abortText),
      `\`jolly ${this.notes.helpCommand} --help\` must not abort with "${abortText}"; got: ${text}`,
    );
  },
);

// --- Scenario: The CLI exposes exactly the supported command surface -------
// `jolly --help` publishes the command surface in its envelope `data.commands`;
// `jolly create --help` publishes create's subcommands in `data.subcommands`.
// Run with credentials genuinely unset so no help path can reach a real account.

When("the agent inspects `jolly --help`", function (this: JollyWorld) {
  // The command surface is the machine-readable `data.commands`; an agent reads
  // it via --json (feature 020 — default --help is human usage with no envelope).
  this.runCli(["--help", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "it should list exactly the commands `login`, `logout`, `auth status`, `init`, `start`, `doctor`, `upgrade`, `skills`, `create`, and `completion`",
  function (this: JollyWorld) {
    const expected = [
      "login",
      "logout",
      "auth status",
      "init",
      "start",
      "doctor",
      "upgrade",
      "skills",
      "create",
      "completion",
    ];
    const data = this.envelope.data as { commands?: unknown };
    const listed = Array.isArray(data.commands) ? (data.commands as string[]) : [];
    assert.ok(listed.length > 0, "`jolly --help` must list its commands in the envelope");
    // Collapse create's subcommands (e.g. `create store`) to the top-level `create`.
    const topLevel = new Set(listed.map((c) => (c.startsWith("create ") ? "create" : c)));
    assert.deepEqual(
      [...topLevel].sort(),
      [...expected].sort(),
      `command surface must be exactly ${expected.join(", ")}; got ${[...topLevel].join(", ")}`,
    );
  },
);

Then(
  "`jolly create --help` should list only the subcommand `store`",
  function (this: JollyWorld) {
    // Subcommand surface is the machine-readable `data.subcommands`; read it via
    // --json (feature 020 — default --help is human usage with no envelope).
    this.runCli(["create", "--help", "--json"], { env: absentCredentialsEnv() });
    const data = this.envelope.data as { subcommands?: Array<{ name?: string }> };
    const names = (Array.isArray(data.subcommands) ? data.subcommands : [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === "string");
    assert.deepEqual(
      [...names].sort(),
      ["store"],
      `\`jolly create --help\` must list only store; got ${names.join(", ")}`,
    );
  },
);

Then(
  "no `deployment`, `deploy`, `recipe`, or `storefront` subcommand should appear anywhere in the surface",
  function (this: JollyWorld) {
    const forbidden = ["deployment", "deploy", "recipe", "storefront"];
    // Command/subcommand surfaces are the machine-readable envelope (feature 020):
    // an agent enumerates them via --json; default --help is human usage only.
    this.runCli(["--help", "--json"], { env: absentCredentialsEnv() });
    const rootData = this.envelope.data as { commands?: unknown };
    const rootCommands = Array.isArray(rootData.commands)
      ? (rootData.commands as string[])
      : [];
    this.runCli(["create", "--help", "--json"], { env: absentCredentialsEnv() });
    const createData = this.envelope.data as { subcommands?: Array<{ name?: string }> };
    const createSubs = (Array.isArray(createData.subcommands) ? createData.subcommands : [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === "string");
    const surface = [...rootCommands, ...createSubs].map((c) => c.toLowerCase());
    for (const term of forbidden) {
      assert.ok(
        !surface.some((c) => c === term || c.split(" ").includes(term)),
        `no \`${term}\` subcommand may appear in the command surface; got ${surface.join(", ")}`,
      );
    }
  },
);

// --- Scenario Outline: Every command accepts the global output flags -------
// `--json`/`--quiet`/`--yes` are global flags every command parses. The tight
// command alternation matches ONLY `jolly <command> <flag>` exactly, never the
// many existing parametric run-steps (e.g. `jolly login --token ... --json`).
// The lookahead skips `start|doctor|upgrade --json`, which already have
// dedicated When steps (features 006/020/019); those rows reuse them, every
// other row runs here. Credentials unset so no flag path can reach a real
// account.

When(
  /^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$/,
  function (this: JollyWorld, command: string, flag: string) {
    this.runCli([...command.split(" "), flag], { env: absentCredentialsEnv() });
  },
);

Then("the flag should be accepted, not rejected as unknown", function (this: JollyWorld) {
  const run = this.lastRun!;
  const text = (run.stdout + " " + run.stderr).toLowerCase();
  assert.ok(
    !/unknown option|unknown argument|unrecognized option|unknown command/.test(text),
    `global flag must be accepted, not rejected as unknown; got exit ${run.exitCode}:\n${run.stdout}\n${run.stderr}`,
  );
  // A rejected flag aborts with an "unknown option" error (ruled out above).
  // Under the feature 020 contract only --json emits the machine envelope
  // (--quiet is silent/stderr, --yes is human), so envelope presence proves the
  // flag parsed for --json; the next scenario step re-checks --json emission.
  if (run.args.includes("--json")) {
    assert.ok(
      run.envelope,
      `--json must run the command to its envelope, proving the flag parsed; got exit ${run.exitCode}`,
    );
  }
});

Then(
  /^`jolly (.+) --json` should emit the output envelope on stdout per feature 020$/,
  function (this: JollyWorld, command: string) {
    this.runCli([...command.split(" "), "--json"], { env: absentCredentialsEnv() });
    const envelope = this.envelope; // validated against the feature 020 shape
    assert.ok(
      typeof envelope.command === "string" && envelope.command.length > 0,
      "the --json envelope must name the command",
    );
  },
);

// --- Scenario: The launcher fails clearly on an unsupported Node version ----
// bin/jolly's guard reads process.versions.node. A Node older than the minimum
// cannot be produced on demand here (only the current Node exists), so drive the
// REAL guard by overriding the runtime's reported version through a --require
// preload. This exercises bin/jolly's actual version check — not a stand-in for
// it: no fake CLI, no credential, no endpoint (see feature 026's no-double rule).

Given(
  "a Node.js runtime older than the minimum the launcher requires",
  function (this: JollyWorld) {
    const preload = join(this.newTempDir("old-node"), "old-node.cjs");
    writeFileSync(
      preload,
      `Object.defineProperty(process.versions, "node", { value: "18.20.0", configurable: true, writable: true });\n`,
    );
    this.notes.oldNodePreload = preload;
  },
);

When("the published `jolly` launcher runs", function (this: JollyWorld) {
  const launcher = join(REPO_ROOT, "bin", "jolly");
  // The guard exits before dist/index.js loads, so no setup stage runs; the
  // inherited env only needs `node` resolvable on PATH.
  const result = spawnSync(
    "node",
    ["--require", String(this.notes.oldNodePreload), launcher, "start", "--json"],
    { cwd: this.projectDir, encoding: "utf8", timeout: 30_000 },
  );
  if (result.error) {
    throw new Error(`failed to run the jolly launcher: ${result.error.message}`);
  }
  this.notes.launcherExit = result.status;
  this.notes.launcherStdout = result.stdout ?? "";
  this.notes.launcherStderr = result.stderr ?? "";
});

Then(
  "it should exit with an error naming the minimum Node version",
  function (this: JollyWorld) {
    assert.notEqual(
      this.notes.launcherExit,
      0,
      "the launcher must exit non-zero on a too-old Node",
    );
    const text = String(this.notes.launcherStdout) + String(this.notes.launcherStderr);
    assert.ok(
      /20\.12\.0/.test(text),
      `the error must name the minimum Node version (>= 20.12.0); got:\n${text}`,
    );
  },
);

Then(
  "it should not surface a raw syntax or module-resolution error",
  function (this: JollyWorld) {
    const text = String(this.notes.launcherStdout) + String(this.notes.launcherStderr);
    assert.ok(
      !/SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|ReferenceError|Unexpected token/.test(
        text,
      ),
      `the launcher must fail with a clear version message, not a raw syntax/module error; got:\n${text}`,
    );
  },
);

// --- Scenario Outline: Command output names only the @dk/jolly package ------
// @property invariant: a command's output names the Jolly package as `@dk/jolly`
// and never presents another package as the Jolly tool or an official product.
// The official CLIs Jolly delegates to (`@saleor/configurator`, `vercel`, `git`,
// `pnpm`) MAY appear, but only as the delegated tools the agent runs — so the
// only SCOPED npm package the output may name is `@dk/jolly` or the delegated
// `@saleor/configurator`; any other `@scope/name` is a substitute presented as
// Jolly/official, the violation this guards. The `jolly start --json` example
// reuses the When at the top of this file; `jolly --help` runs here. Credentials
// unset so no path reaches a real account.

When("the agent runs `jolly --help`", function (this: JollyWorld) {
  // Read the package naming from the machine envelope (feature 020): default
  // --help is human usage and carries no envelope; --json carries `tool`.
  this.runCli(["--help", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the output should name the Jolly package as `@dk\\/jolly`",
  function (this: JollyWorld) {
    const out = this.lastRun!.stdout + this.lastRun!.stderr;
    assert.ok(
      out.includes("@dk/jolly"),
      `output must name the Jolly package as @dk/jolly; got:\n${out}`,
    );
  },
);

Then(
  "the only package it presents as the Jolly tool or an official product is `@dk\\/jolly`, with the official CLIs Jolly spawns \\(`@saleor\\/configurator`, `vercel`, `git`, `pnpm`) named only as the delegated tools the agent runs",
  function (this: JollyWorld) {
    const out = this.lastRun!.stdout + this.lastRun!.stderr;
    const allowed = new Set(["@dk/jolly", "@saleor/configurator"]);
    const scoped = out.match(/@[a-z0-9-]+\/[a-z0-9-]+/g) ?? [];
    const offenders = [...new Set(scoped)].filter((p) => !allowed.has(p));
    assert.deepEqual(
      offenders,
      [],
      `output may present only @dk/jolly (and the delegated @saleor/configurator); ` +
        `found substitute package(s): ${offenders.join(", ")}\noutput:\n${out}`,
    );
    assert.ok(
      out.includes("@dk/jolly"),
      `@dk/jolly must be the package presented as the Jolly tool; got:\n${out}`,
    );
  },
);
