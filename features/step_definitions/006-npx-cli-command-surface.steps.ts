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
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { findEnvelope } from "../support/envelope.ts";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { acceptEveryPrompt, startPromptSequence } from "../support/start-prompts.ts";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";
import {
  findGlobalOutputFlagViolations,
  type Violation,
} from "../support/module-conformance.ts";
import {
  ALLOWED_BINARIES,
  ALLOWED_NPX_PACKAGES,
  enumerateSpawnSites,
  findSpawnViolations,
  type SpawnSite,
} from "../support/spawn-conformance.ts";
import { Node, Project, SyntaxKind, type ObjectLiteralExpression } from "ts-morph";

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
      "--prefer-offline",
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
// --- Scenario: Agent starts the guided setup flow --------------------------
When("the agent runs `jolly start --json`", function (this: JollyWorld) {
  // `jolly start` is the primary guided command. Run with the credentials unset
  // so the bootstrap cannot reach a real account; the temp project is isolated.
  this.runCli(["start", "--json"], { env: absentCredentialsEnv() });
});
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
  "it should list exactly the commands `help`, `login`, `logout`, `auth`, `init`, `start`, `create`, `storefront`, `recipe`, `stock`, `stripe`, `deploy`, `doctor`, `upgrade`, `skills`, and `completion`",
  function (this: JollyWorld) {
    const expected = [
      "help",
      "login",
      "logout",
      "auth",
      "init",
      "start",
      "create",
      "storefront",
      "recipe",
      "stock",
      "stripe",
      "deploy",
      "doctor",
      "upgrade",
      "skills",
      "completion",
    ];
    const data = this.envelope.data as { commands?: unknown };
    const listed = Array.isArray(data.commands) ? (data.commands as string[]) : [];
    assert.ok(listed.length > 0, "`jolly --help` must list its commands in the envelope");
    // The surface names top-level commands only; collapse any subcommand entry
    // (e.g. `create store`, `auth status`) to its top-level command.
    const topLevel = new Set(listed.map((c) => c.split(" ")[0]!));
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
  "`status` should appear as a subcommand of `auth`, never as a top-level command",
  function (this: JollyWorld) {
    // The surface names top-level commands, so `auth` is the entry and `status`
    // is its subcommand, never a top-level command of its own.
    this.runCli(["--help", "--json"], { env: absentCredentialsEnv() });
    const rootData = this.envelope.data as { commands?: unknown };
    const rootCommands = Array.isArray(rootData.commands)
      ? (rootData.commands as string[])
      : [];
    const topLevel = new Set(rootCommands.map((c) => c.split(" ")[0]!));
    assert.ok(topLevel.has("auth"), "`auth` must appear as a top-level command");
    assert.ok(
      !topLevel.has("status"),
      `\`status\` must never be a top-level command; got ${[...topLevel].join(", ")}`,
    );
    // status is auth's subcommand: read auth's machine-readable subcommand list.
    this.runCli(["auth", "--help", "--json"], { env: absentCredentialsEnv() });
    const authData = this.envelope.data as { subcommands?: Array<{ name?: string }> };
    const authSubs = (Array.isArray(authData.subcommands) ? authData.subcommands : [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === "string");
    assert.ok(
      authSubs.includes("status"),
      `\`jolly auth --help\` must list \`status\` as a subcommand; got ${authSubs.join(", ")}`,
    );
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
    // A scenario Given may overlay a specific credential value — e.g. feature
    // 020's junk JOLLY_SALEOR_CLOUD_TOKEN, real bad input verified for real
    // against the real endpoint. With no overlay, credentials stay genuinely
    // unset as before.
    this.runCli([...command.split(" "), flag], {
      env: absentCredentialsEnv(
        this.notes.credentialOverrides as Record<string, string | undefined> | undefined,
      ),
    });
  },
);
// --- @property: the global output flags live at the single parser seam ------
// Structural conformance in the family of module-boundary-conformance and
// single-creation-seam: one owned ts-morph checker
// (features/support/module-conformance.ts) proves the global output flags
// (`--json`, `--quiet`, `--yes`) are declared ONCE, in GLOBAL_BOOLEAN_FLAGS,
// and reach every command through the one @bomb.sh/args parser call in
// src/index.ts — never a per-command parser that omits or overrides them. The
// scenario names the source, runs the checker, and asserts no per-command
// divergence. Drop a flag from GLOBAL_BOOLEAN_FLAGS and the checker reds.
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

// ─── Catalog placeholder substitution (feature 006 @logic) ─────────────────
// The interactive layer renders human copy from the assets/messages/cli.json
// catalog by key, and the renderer substitutes `{name}` placeholders with run
// values. Exercise the REAL render seam: the production cliMessage(key, vars)
// renderer in src/lib/messages.ts. The catalog template for the key must carry
// the `{organization}` placeholder, so a passing render proves substitution
// happened — not a coincidental literal that already reads "acme-co".

const CLI_MESSAGES_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");

function readCatalog(): Record<string, string> {
  return JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<string, string>;
}

function catalogMessage(key: string): string {
  const message = readCatalog()[key];
  assert.ok(
    typeof message === "string" && message.length > 0,
    `the message catalog must define a non-empty "${key}"`,
  );
  return message;
}

const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");
// ─── @property: no interactive copy bypasses the message catalog ────────────
// Conformance scan, in the family of feature 026/027's source-property checks.
// Every human-facing string the interactive layer renders comes from the catalog
// by key via cliMessage(...), never an inline string literal at the render site
// (feature 027 Rule). We make this falsifiable by parsing the published CLI
// source (TypeScript AST) and, at every interactive render seam — the clack
// intro/prompts/notes/outro, the per-stage progress descriptions, and the
// start-close summary lines — flagging any human-prose literal not enclosed in a
// cliMessage(...) call. Structural glue (separators, newlines, OSC 8) carries no
// letters and is allowed; run-data values are expressions, not literals.

const INTERACTIVE_SRC = join(REPO_ROOT, "src", "index.ts");
const START_CLOSE_SRC = join(REPO_ROOT, "src", "lib", "start-close.ts");

// clack render functions aliased in src/index.ts. Positional seams take their
// human text as positional string args; object seams take { message, options }.
const CLACK_POSITIONAL = new Set(["clackIntro", "clackOutro", "clackNote"]);
const CLACK_OBJECT = new Set([
  "clackText",
  "clackConfirm",
  "clackSelect",
  "clackMultiselect",
  "clackPassword",
]);

interface SeamScan {
  violations: string[];
  cliMessageKeys: string[];
}

// Comparison/equality operand tokens: their operands are stage-slug or status
// DATA, not render copy, so a comparison subtree is skipped.
const COMPARISON_TOKENS = new Set<SyntaxKind>([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanEqualsToken,
]);

// A syntax-only scan via ts-morph, which vendors its own TypeScript: the
// `typescript` package's main entry exports only the version under TS 7, so
// the compiler API is not importable here (RIGGING.md "## Dependencies").
function scanInteractiveSeams(): SeamScan {
  const violations: string[] = [];
  const cliMessageKeys: string[] = [];
  // Any alphabetic run marks human-readable copy. Catalog keys live inside
  // cliMessage(...) calls, which the walker records and skips, so a flagged
  // literal is always render-site copy.
  const hasLetters = (s: string): boolean => /[A-Za-z]/.test(s);

  function flagLiteralsIn(root: Node, where: string): void {
    const visit = (n: Node): void => {
      // cliMessage(key, vars) is the sanctioned source: record the key, then
      // inspect only the vars (run-data) — never flag the key literal itself.
      if (Node.isCallExpression(n)) {
        const callee = n.getExpression();
        if (Node.isIdentifier(callee) && callee.getText() === "cliMessage") {
          const args = n.getArguments();
          const first = args[0];
          if (
            first &&
            (Node.isStringLiteral(first) ||
              Node.isNoSubstitutionTemplateLiteral(first))
          ) {
            cliMessageKeys.push(first.getLiteralValue());
          }
          for (const extra of args.slice(1)) visit(extra);
          return;
        }
      }
      if (
        Node.isBinaryExpression(n) &&
        COMPARISON_TOKENS.has(n.getOperatorToken().getKind())
      ) {
        return;
      }
      if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) {
        if (hasLetters(n.getLiteralValue())) {
          violations.push(`${where}: inline literal ${JSON.stringify(n.getLiteralValue())}`);
        }
        return;
      }
      if (Node.isTemplateExpression(n)) {
        const head = n.getHead().getLiteralText();
        if (hasLetters(head)) {
          violations.push(`${where}: inline template text ${JSON.stringify(head)}`);
        }
        for (const span of n.getTemplateSpans()) {
          const literal = span.getLiteral().getLiteralText();
          if (hasLetters(literal)) {
            violations.push(`${where}: inline template text ${JSON.stringify(literal)}`);
          }
          visit(span.getExpression());
        }
        return;
      }
      n.forEachChild(visit);
    };
    visit(root);
  }

  function propValue(obj: ObjectLiteralExpression, name: string): Node | undefined {
    for (const p of obj.getProperties()) {
      if (
        Node.isPropertyAssignment(p) &&
        p.getName().replace(/^["']|["']$/g, "") === name
      ) {
        return p.getInitializer();
      }
    }
    return undefined;
  }

  // A throwaway in-memory project: the scan is syntactic, so no tsconfig
  // program is built and the two sources are parsed from their on-disk text.
  const project = new Project({ useInMemoryFileSystem: true });

  // ── src/index.ts: clack render seams + STAGE_DESCRIPTIONS map ──────────────
  const indexSource = project.createSourceFile(
    "scan/index.ts",
    readFileSync(INTERACTIVE_SRC, "utf8"),
  );

  const walkIndex = (n: Node): void => {
    // STAGE_DESCRIPTIONS: every per-stage progress description value.
    if (Node.isVariableDeclaration(n) && n.getName() === "STAGE_DESCRIPTIONS") {
      const initializer = n.getInitializer();
      if (initializer) flagLiteralsIn(initializer, "STAGE_DESCRIPTIONS");
    }
    if (Node.isCallExpression(n)) {
      const callee = n.getExpression();
      const calleeTarget = Node.isPropertyAccessExpression(callee)
        ? callee.getExpression()
        : undefined;
      // clackLog.<method>(message, ...)
      if (
        calleeTarget &&
        Node.isIdentifier(calleeTarget) &&
        calleeTarget.getText() === "clackLog"
      ) {
        const first = n.getArguments()[0];
        if (first) flagLiteralsIn(first, "clackLog");
      } else if (Node.isIdentifier(callee) && CLACK_POSITIONAL.has(callee.getText())) {
        for (const arg of n.getArguments()) flagLiteralsIn(arg, callee.getText());
      } else if (Node.isIdentifier(callee) && CLACK_OBJECT.has(callee.getText())) {
        const optsArg = n.getArguments()[0];
        if (optsArg && Node.isObjectLiteralExpression(optsArg)) {
          const msg = propValue(optsArg, "message");
          if (msg) flagLiteralsIn(msg, callee.getText());
          for (const label of ["active", "inactive"]) {
            const v = propValue(optsArg, label);
            if (v) flagLiteralsIn(v, `${callee.getText()}.${label}`);
          }
          const options = propValue(optsArg, "options");
          if (options && Node.isArrayLiteralExpression(options)) {
            for (const el of options.getElements()) {
              if (Node.isObjectLiteralExpression(el)) {
                const lbl = propValue(el, "label");
                if (lbl) flagLiteralsIn(lbl, `${callee.getText()} option label`);
              }
            }
          }
        }
      }
    }
    n.forEachChild(walkIndex);
  };
  walkIndex(indexSource);

  // ── src/lib/start-close.ts: the human summary lines (array init + push) ────
  const closeSource = project.createSourceFile(
    "scan/start-close.ts",
    readFileSync(START_CLOSE_SRC, "utf8"),
  );
  const walkClose = (n: Node): void => {
    // `const lines = [ <summary line>, ... ]`
    if (Node.isVariableDeclaration(n) && n.getName() === "lines") {
      const initializer = n.getInitializer();
      if (initializer && Node.isArrayLiteralExpression(initializer)) {
        for (const el of initializer.getElements()) {
          flagLiteralsIn(el, "start-close summary line");
        }
      }
    }
    // `lines.push(<summary line>)`
    if (Node.isCallExpression(n)) {
      const callee = n.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === "push") {
        const target = callee.getExpression();
        if (Node.isIdentifier(target) && target.getText() === "lines") {
          for (const arg of n.getArguments()) {
            flagLiteralsIn(arg, "start-close summary line");
          }
        }
      }
    }
    n.forEachChild(walkClose);
  };
  walkClose(closeSource);

  return { violations, cliMessageKeys };
}

// @logic "Jolly quiets npm install-time warnings for the npx tools it spawns":
// main() defaults NPM_CONFIG_LOGLEVEL to "error" when the caller set none, so
// every `npx` Jolly spawns with `{ ...process.env }` inherits the quiet level
// and its warn-level notices (e.g. EBADENGINE) are suppressed; a value the
// caller already set is preserved. Observed on the REAL CLI process: a Node
// --import exit hook reads the effective process.env.NPM_CONFIG_LOGLEVEL main()
// leaves behind — the exact value spawned npx children receive — with no
// production change and no stand-in.
const LOGLEVEL_OBSERVER =
  "data:text/javascript," +
  encodeURIComponent(
    'process.on("exit",()=>{try{process.stderr.write("\\n__JOLLY_LOGLEVEL__="+String(process.env.NPM_CONFIG_LOGLEVEL)+"\\n")}catch{}})',
  );

function observeEffectiveLoglevel(preset?: string): string {
  const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env["NPM_CONFIG_LOGLEVEL"];
  delete env["npm_config_loglevel"];
  if (preset !== undefined) env["NPM_CONFIG_LOGLEVEL"] = preset;
  const run = spawnSync(runtime, ["--import", LOGLEVEL_OBSERVER, join(REPO_ROOT, "src", "index.ts"), "help"], {
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const match = /__JOLLY_LOGLEVEL__=(\S*)/.exec(run.stderr ?? "");
  assert.ok(
    match,
    `the CLI run did not report its effective NPM_CONFIG_LOGLEVEL.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
  return match[1]!;
}

// --- Scenario: the published manifest ships the launcher and the Node floor --
// @logic @contract: attests the shipped manifest's mechanical shape — the `bin`
// entry that makes `npx @dk/jolly` resolve the `jolly` launcher, and the
// `engines.node` floor the documentation promises.
// --- @property: Jolly's code spawns only the delegated official tools --------
// Structural conformance in the family of module-boundary-conformance and the
// first-party request guard: one owned ts-morph checker
// (features/support/spawn-conformance.ts) enumerates every child-process spawn
// site in the implementation directories and resolves the binary — and, for
// `npx`, the package — each can launch. The delegated set is exactly the
// feature 006 Rule's official tools; anything else, the deprecated `saleor`
// CLI included, reddens. The last step is the planted-red proof, kept
// permanent: an injected violating spawn site must redden the check.

function spawnSitesOf(world: JollyWorld): SpawnSite[] {
  return world.notes.spawnSites as SpawnSite[];
}

Given("Jolly's own child-process-spawning code", function () {
  // Framing: the checker's scope is fixed to the implementation directories
  // (src/, bin/) from RIGGING.md; the When enumerates them.
});

When(
  "the commands its spawn sites can launch are enumerated",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    const sites = enumerateSpawnSites();
    assert.ok(
      sites.length > 0,
      "the implementation must contain at least one spawn site (Jolly delegates to official CLIs)",
    );
    this.notes.spawnSites = sites;
  },
);

Then(
  "the binaries spawned should be exactly `git`, `pnpm`, and `npx`",
  function (this: JollyWorld) {
    const sites = spawnSitesOf(this);
    const binaries = [...new Set(sites.map((site) => site.binary))].sort();
    assert.deepEqual(
      binaries,
      [...ALLOWED_BINARIES].sort(),
      `the spawned binaries must be exactly ${ALLOWED_BINARIES.join(", ")}; ` +
        `sites: ${JSON.stringify(sites)}`,
    );
  },
);

Then(
  "the packages launched through `npx` should be exactly `@saleor\\/configurator`, `vercel`, `pnpm`, and `skills`",
  function (this: JollyWorld) {
    const sites = spawnSitesOf(this);
    const packages = [
      ...new Set(
        sites
          .filter((site) => site.binary === "npx")
          .map((site) => site.npxPackage ?? "<unresolved>"),
      ),
    ].sort();
    assert.deepEqual(
      packages,
      [...ALLOWED_NPX_PACKAGES].sort(),
      `the npx-launched packages must be exactly ${ALLOWED_NPX_PACKAGES.join(", ")}; ` +
        `sites: ${JSON.stringify(sites)}`,
    );
  },
);

Then(
  "no spawn site should launch the deprecated `saleor` CLI or any `@saleor\\/*` package other than `@saleor\\/configurator`",
  function (this: JollyWorld) {
    for (const site of spawnSitesOf(this)) {
      assert.notEqual(
        site.binary,
        "saleor",
        `${site.file}:${site.line} spawns the deprecated \`saleor\` CLI`,
      );
      const pkg = site.npxPackage ?? "";
      assert.ok(
        !pkg.startsWith("@saleor/") || pkg === "@saleor/configurator",
        `${site.file}:${site.line} launches \`${pkg}\`; the only permitted @saleor/* ` +
          `package is @saleor/configurator`,
      );
    }
  },
);

Then(
  "a spawn site launching a binary or package outside this set should redden the check",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    // Planted red, kept permanent: inject a virtual source (never on disk)
    // carrying a forbidden binary spawn and a forbidden npx launch of a
    // non-configurator @saleor/* package; the check must redden on both.
    const planted: { file: string; text: string } = {
      file: "src/__planted-spawn-violation__.ts",
      text: [
        'import { spawnSync } from "node:child_process";',
        "export function plantedSpawnViolation(): void {",
        '  spawnSync("curl", ["https://example.com"]);',
        '  spawnSync("npx", ["--yes", "@saleor/cli", "storefront", "deploy"]);',
        "}",
        "",
      ].join("\n"),
    };
    const reddened = findSpawnViolations([planted]);
    const plantedViolations = reddened.filter((violation) =>
      violation.file.includes("__planted-spawn-violation__"),
    );
    assert.ok(
      plantedViolations.some((violation) => violation.message.includes("`curl`")),
      `the planted \`curl\` spawn must redden the check; got: ${JSON.stringify(reddened)}`,
    );
    assert.ok(
      plantedViolations.some((violation) => violation.message.includes("`@saleor/cli`")),
      `the planted \`@saleor/cli\` npx launch must redden the check; got: ${JSON.stringify(reddened)}`,
    );
    // Plant removed (virtual injection is dropped by the checker): the real
    // tree must be green.
    const real = findSpawnViolations();
    assert.deepEqual(
      real,
      [],
      `with the plant removed, the real tree must hold no spawn violations; got: ${JSON.stringify(real)}`,
    );
  },
);
