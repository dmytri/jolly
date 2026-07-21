// Feature 027 — Human-facing interactive CLI experience.
//
// Two kinds of target. The AGENT-PATH (non-interactive) ones — the
// unsupported-command / unsupported-flag error surface, the `completion` and
// `complete` commands, and the @logic @property source-conformance scenario that
// pins Bombshell as the single CLI plumbing — run through the standard CLI seam
// (world.runCli) with credentials genuinely unset, so no path can reach a real
// account.
//
// The TTY-driven interactive ones — the `jolly start` walk-through, org
// selection, gate announcements, decline-stops-honestly, machine-output
// cleanliness — run against a real kernel PTY (support/pty.ts) so the CLI
// genuinely sees an interactive terminal and renders its Bombshell prompts.
// clack re-renders incrementally, so the falsifiable observables are the run's
// envelope (data.plan, data.resolved), the surviving single-write gate
// announcements, and the presence/absence of clack prompt glyphs.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { renderTerminal } from "../support/terminal-screen.ts";
import { acceptEveryPrompt, startPromptSequence } from "../support/start-prompts.ts";
import { findEnvelope } from "../support/envelope.ts";
import { listOrganizations } from "../support/cloud.ts";
import {
  ensureSharedDeployment,
  linkStorefrontToSharedProject,
  type SharedDeployment,
} from "../support/deployed-storefront.ts";
import { materializePreparedStorefront } from "../support/storefront-fixture.ts";
import { REPO_ROOT, type CliResult, type JollyWorld } from "../support/world.ts";
import { writeEnvValues } from "../../src/lib/env-file.ts";
import { cliMessage } from "../../src/lib/messages.ts";
import { interactiveCloseSummary } from "../../src/lib/start-close.ts";

const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

// Bombshell (@clack/prompts) renders its prompts with these box-drawing and
// symbol glyphs. clack re-renders incrementally, so the prompt TEXT does not
// linearize in the raw PTY byte stream, but these glyphs survive — they are the
// reliable signal that an interactive prompt UI was shown (vs. the plain agent
// path, which prints none).
const CLACK_GLYPH = /[│┌└◆◇◻◼●○◐◓◑◒▪]/u;

// Strip ANSI escape sequences (SGR colour, cursor moves, erase, mode toggles)
// so the human terminal text can be asserted as plain content. clack's
// incremental re-renders use cursor control; the single-write lines
// (clackLog/clackNote/clackOutro) survive as readable text once the escapes are
// removed — they are the falsifiable human observables the interactive layer
// surfaces (feature 027: resolved decisions in the terminal, not an envelope).
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

// The interactive output names the resolved organization on a single
// surviving line (e.g. `Using your only organization "org-solo".`), distinct
// from the multi-line clack choice render. Match the org named together with a
// resolution verb on one line, so a bare unchosen option never satisfies it.
function namesTargetOrganization(out: string, org: string): boolean {
  return new RegExp(
    `\\b(using|target(?:ing)?|selected|will use)\\b[^\\n]*\\b${org}\\b`,
    "i",
  ).test(out);
}

// The side-effecting stages declining must never report as completed
// (feature 027). A completed stage renders as a passed check whose id starts
// with the stage name (e.g. `store-provisioned`); bootstrap `init-`/`doctor-`
// checks are readiness, not the stage itself, and are excluded by prefix.
const SIDE_EFFECTING_STAGES = ["store", "storefront", "recipe", "deploy"];

function interactiveChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  // Merge the credential-absence overlay over the real process environment (so
  // PATH/HOME/etc. reach the child); `undefined` entries delete the variable.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ...process.env,
    ...absentCredentialsEnv(),
    ...overrides,
  })) {
    if (v !== undefined) env[k] = v;
  }
  if (!env.TERM) env.TERM = "xterm-256color";
  return env;
}

// Run `jolly <argv>` under a real PTY (an interactive terminal) feeding the
// scripted keystrokes, and record the result as the world's last run so the
// standard envelope/output assertions apply. Returns false when no PTY is
// available.
//
// Each answer is fed when the prompt it answers is OBSERVED in the terminal
// output, never on a guessed delay (feature verification-economy): the run's
// prompt sequence is derived from its argv and project directory, and `answers`
// maps that sequence to the keystrokes this scenario sends.
function runInteractive(
  world: JollyWorld,
  argv: string[],
  answers: (sequence: string[]) => string[],
  overrides: Record<string, string | undefined> = {},
): boolean {
  if (!ptyAvailable()) return false;
  const sequence = startPromptSequence({ argv, cwd: world.projectDir });
  const inputs = answers(sequence);
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, ...argv],
    cwd: world.projectDir,
    env: interactiveChildEnv(overrides),
    inputs,
    waitFor: sequence.slice(0, inputs.length),
    // The walk-through runs to completion and the CLI exits; the read ends there.
    readUntil: "exit",
    timeoutMs: 150_000,
  });
  world.previousRun = world.lastRun;
  world.lastRun = {
    args: argv,
    cwd: world.projectDir,
    exitCode: run.exitCode,
    stdout: run.output,
    stderr: "",
    envelope: findEnvelope(run.output),
  };
  return true;
}

// Press Enter at every prompt: one carriage return per prompt the run renders,
// each fed when that prompt is observed.

// ─── Unsupported command: fail clearly, name the supported surface ─────────

When("the agent runs `jolly frobnicate --json`", function (this: JollyWorld) {
  this.runCli(["frobnicate", "--json"], { env: absentCredentialsEnv() });
});

// Every supported command, exactly as the scenario names them. The surface is
// top-level commands, so `auth` is the entry and `status` is its subcommand.
const SUPPORTED_COMMANDS = [
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

Then(
  "the error should name the supported commands help, login, logout, auth, init, start, create, storefront, recipe, stock, stripe, deploy, doctor, upgrade, skills, and completion",
  function (this: JollyWorld) {
    const text = (
      this.envelope.summary +
      " " +
      JSON.stringify(this.envelope.errors)
    ).toLowerCase();
    for (const command of SUPPORTED_COMMANDS) {
      assert.ok(
        text.includes(command.toLowerCase()),
        `the unknown-command error must name the supported command "${command}"; got: ${text}`,
      );
    }
  },
);

// ─── Unsupported flag: fail clearly on the agent path, never ignored ────────

When("the agent runs `jolly start --frobnicate --json`", function (this: JollyWorld) {
  this.runCli(["start", "--frobnicate", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the error should name the unsupported flag `--frobnicate`",
  function (this: JollyWorld) {
    const text =
      this.envelope.summary + " " + JSON.stringify(this.envelope.errors);
    assert.ok(
      text.includes("--frobnicate"),
      `the unsupported-flag error must name \`--frobnicate\`; got: ${text}`,
    );
  },
);

// ─── Shell completion: the completion script and completion-time candidates ─
// `completion` is the single command exempt from the feature 020 `--json`
// envelope (feature 006 / 027 Rule): its stdout is a shell script consumed by
// `source`, and `complete` returns bare candidate words. Both are read from
// stdout directly, not as an envelope.

When("the agent runs `jolly completion bash`", function (this: JollyWorld) {
  this.runCli(["completion", "bash"], { env: absentCredentialsEnv() });
});

Then(
  "stdout should contain a shell completion script for the `jolly` command",
  function (this: JollyWorld) {
    const stdout = this.lastRun!.stdout;
    assert.equal(
      this.lastRun!.exitCode,
      0,
      `\`jolly completion bash\` must exit 0; stderr:\n${this.lastRun!.stderr}`,
    );
    assert.ok(
      stdout.includes("jolly"),
      `the completion script must reference the \`jolly\` command; got: ${stdout}`,
    );
    // A shell completion script registers a completion function for the command
    // (bash uses `complete`); require that registration so this is a real script,
    // not arbitrary text.
    assert.ok(
      /complete\b/.test(stdout),
      `the completion script must register completion for \`jolly\`; got: ${stdout}`,
    );
  },
);

Then(
  "the script should reference the supported commands help, login, logout, auth, init, start, create, storefront, recipe, stock, stripe, deploy, doctor, upgrade, skills, and completion",
  function (this: JollyWorld) {
    // The Bombshell (@bomb.sh/tab) completion script names the command surface
    // the way feature 027's Rule mandates: not by embedding a static list, but by
    // delegating to `jolly complete -- <words>` at completion time, which returns
    // the supported commands. Verify the script wires that delegation, then
    // exercise it (the empty-word completion the script issues for the bare
    // `jolly` command) and assert it offers each supported command.
    const script = this.lastRun!.stdout;
    assert.ok(
      /jolly complete --/.test(script),
      `the completion script must delegate to \`jolly complete --\`; got: ${script}`,
    );
    this.runCli(["complete", "--", ""], { env: absentCredentialsEnv() });
    const offered = this.lastRun!.stdout;
    for (const command of SUPPORTED_COMMANDS) {
      assert.ok(
        new RegExp(`(^|\\s)${command}(\\s|$)`, "m").test(offered),
        `the completion surface must offer the command "${command}"; got: ${offered}`,
      );
    }
  },
);

When("the agent runs `jolly complete -- lo`", function (this: JollyWorld) {
  this.runCli(["complete", "--", "lo"], { env: absentCredentialsEnv() });
});

Then(
  "stdout should list the candidate completions `login` and `logout`",
  function (this: JollyWorld) {
    const candidates = this.lastRun!.stdout
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const expected of ["login", "logout"]) {
      assert.ok(
        candidates.includes(expected),
        `completing \`lo\` must offer "${expected}"; got candidates: ${candidates.join(", ")}`,
      );
    }
  },
);

// ─── @property: Bombshell is the single CLI plumbing ───────────────────────
// Conformance invariant, in the family of feature 026's "no forbidden double":
// every CLI concern Bombshell can serve IS served by the Bombshell package for
// it, with no redundant alternative. We make this falsifiable by inspecting the
// published CLI's production source (`src/`) and asserting, per concern, that the
// canonical Bombshell package is imported AND no competing package for the same
// concern is. A second, hand-rolled or third-party parser/prompt/completion
// mechanism therefore fails HERE rather than passing review.

const SRC_DIR = join(REPO_ROOT, "src");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The package name an import specifier resolves to, or null for relative/builtin. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0]!;
}

/** Every external package imported anywhere in the published CLI source. */
function importedPackages(files: string[]): Set<string> {
  const specifierRe =
    /(?:from\s*|import\s*|require\(\s*|import\(\s*)["']([^"']+)["']/g;
  const packages = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(specifierRe)) {
      const pkg = packageOf(match[1]!);
      if (pkg) packages.add(pkg);
    }
  }
  return packages;
}

function assertSoleProvider(
  packages: Set<string>,
  concern: string,
  canonical: string,
  competitors: string[],
): void {
  assert.ok(
    packages.has(canonical),
    `${concern} must be served by \`${canonical}\`; the published CLI source imports ` +
      `no such package (imported: ${[...packages].sort().join(", ") || "none"})`,
  );
  const others = competitors.filter((c) => packages.has(c));
  assert.deepEqual(
    others,
    [],
    `${concern} must be served by \`${canonical}\` as the ONLY provider; the source also ` +
      `imports competing package(s): ${others.join(", ")}`,
  );
}

Given("Jolly's production source for the published CLI", function (this: JollyWorld) {
  const files = listTsFiles(SRC_DIR);
  assert.ok(files.length > 0, "the published CLI must have production source to inspect");
  this.notes.srcImports = importedPackages(files);
  this.notes.srcFiles = files.map((f) => relative(REPO_ROOT, f));
});

// Registered as RegExp: in a Cucumber expression `/` is the alternative
// operator, which would split the package specifiers (`@bomb.sh/args` etc.).
Then(
  /^argument parsing is served by `@bomb\.sh\/args` as the only argument parser$/,
  function (this: JollyWorld) {
    assertSoleProvider(
      this.notes.srcImports as Set<string>,
      "argument parsing",
      "@bomb.sh/args",
      ["commander", "yargs", "yargs-parser", "minimist", "meow", "cac", "sade", "mri", "arg", "@oclif/core"],
    );
  },
);

Then(
  /^every interactive prompt, confirmation, and masked secret entry is served by `@clack\/prompts` as the only terminal-prompt mechanism$/,
  function (this: JollyWorld) {
    assertSoleProvider(
      this.notes.srcImports as Set<string>,
      "interactive prompts, confirmations, and masked secret entry",
      "@clack/prompts",
      ["inquirer", "@inquirer/prompts", "enquirer", "prompts", "readline-sync", "prompt"],
    );
  },
);

Then(
  /^shell completion is served by `@bomb\.sh\/tab` as the only completion-script generator$/,
  function (this: JollyWorld) {
    assertSoleProvider(
      this.notes.srcImports as Set<string>,
      "shell completion",
      "@bomb.sh/tab",
      ["tabtab", "omelette", "@bombsh/tab"],
    );
  },
);

// ─── Interactive `jolly start` walk-through (TTY-driven) ───────────────────
// Driven against a real kernel PTY (support/pty.ts): the CLI genuinely sees an
// interactive terminal, renders its Bombshell prompts, and reads the scripted
// keystrokes. clack re-renders incrementally, so prompt TEXT does not linearize
// in the byte stream; the falsifiable observables are the run's envelope
// (data.plan, data.resolved), the surviving single-write gate announcements, and
// the presence/absence of clack glyphs.

Given(
  "the Cloud token can access organization {string} only",
  function (this: JollyWorld, org: string) {
    this.notes.mockOrgs = org;
  },
);

Given(
  "a fresh project directory with no real service credentials",
  function (this: JollyWorld) {
    // A fresh temp project dir; the interactive run uses absentCredentialsEnv so
    // no real service credential is present.
    void this.projectDir;
  },
);

Given("`jolly start --dry-run` runs in an interactive terminal", function (this: JollyWorld) {
  this.notes.startArgv = ["start", "--dry-run"];
});

Given(
  "`jolly start --dry-run` runs in an interactive terminal with no flag beyond `--dry-run`",
  function (this: JollyWorld) {
    this.notes.startArgv = ["start", "--dry-run"];
    this.notes.noMock = true;
  },
);

Given("`jolly start` runs in an interactive terminal", function (this: JollyWorld) {
  this.notes.startArgv = ["start"];
});

// A re-run resuming the remaining stages: the store endpoint is already in .env,
// so the store is reused and the environment-name prompt is skipped (feature 027
// "the environment name when none is configured"). The org is mocked so the
// dry-run preview resolves it without a network call.
Given("a Saleor store is already configured in the project", function (this: JollyWorld) {
  writeFileSync(
    join(this.projectDir, ".env"),
    "NEXT_PUBLIC_SALEOR_API_URL=https://configured-store.saleor.cloud/graphql/\n",
  );
  this.notes.mockOrgs = "org-solo";
  // A real (non-dry-run) start probes this configured endpoint's readiness
  // before reporting the store stage. The endpoint does not exist, so the
  // probe can never succeed and the blocked outcome is independent of the
  // budget's duration — squeeze the production 600s budget to ~1s so the run
  // reaches the later stages inside the PTY ceiling (mirrors feature 002's
  // cold-store squeeze). Dry-run previews read no stage env, so the dry-run
  // scenarios sharing this Given are unaffected.
  this.notes.startEnvExtra = {
    JOLLY_READINESS_BUDGET_MS: "1000",
    JOLLY_READINESS_POLL_MS: "100",
  };
});

Then(
  "the interactive output should not prompt for an environment name",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.doesNotMatch(
      out,
      /Environment name/,
      `with a store already configured, the env-name prompt must be skipped; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should say it is reusing the already-configured store",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /reusing your already-configured store/i,
      `the run must announce it is reusing the configured store; got:\n${out}`,
    );
  },
);

// The org already holds environments, so the interactive flow offers a
// reuse-or-create store picker (feature 027). The list is injected
// deterministically via --mock-environments (a single org keeps the org prompt
// silent).
Given(
  "the org already has the environments {string} and {string}",
  function (this: JollyWorld, a: string, b: string) {
    this.notes.mockOrgs = "org-solo";
    this.notes.mockEnvs = `${a},${b}`;
  },
);

Then(
  "the interactive output should offer to create a new store or reuse an existing one",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(out, /create a new store/i, `must offer "create a new store"; got:\n${out}`);
    assert.match(out, /reuse/i, `must offer to reuse an existing store; got:\n${out}`);
  },
);

Then(
  "the interactive output should name {string} as a store the human can reuse",
  function (this: JollyWorld, name: string) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.ok(
      out.includes(name),
      `the picker must list "${name}" as a reuse option; got:\n${out}`,
    );
  },
);

function startArgvWithMock(world: JollyWorld): string[] {
  let argv = (world.notes.startArgv as string[]) ?? ["start"];
  if (!world.notes.noMock && world.notes.mockOrgs) {
    // @exceptional-double: a Cloud token resolving more than one organization
    // cannot be produced on demand from the single-org test account; the
    // interactive multi-org selection prompt is driven by an injected org list.
    argv = [...argv, `--mock-organizations=${String(world.notes.mockOrgs)}`];
  }
  if (world.notes.mockEnvs !== undefined) {
    // Deterministic existing-environment list drives the reuse-or-create store
    // picker without depending on the test account's live environments.
    argv = [...argv, `--mock-environments=${String(world.notes.mockEnvs)}`];
  } else if (!world.notes.noMock) {
    // Default the env picker to an empty list in @logic so it never makes a real
    // listEnvironments network call — that latency desyncs PTY-scripted input.
    argv = [...argv, "--mock-environments="];
  }
  return argv;
}

When(
  "the user presses Enter at every prompt",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // A scenario's Givens may provision the run's child env: notes.startEnv is
    // the shared start-env channel (e.g. feature 002's malformed-storefront
    // Given, which supplies the Cloud token that satisfies the interactive
    // auth gate so the run reaches its setup stages), and notes.startEnvExtra
    // carries scenario-state tuning such as the dead-endpoint readiness
    // squeeze. Scenarios that set neither run exactly as before.
    const overrides = {
      ...((this.notes.startEnv as Record<string, string | undefined> | undefined) ?? {}),
      ...((this.notes.startEnvExtra as Record<string, string | undefined> | undefined) ?? {}),
    };
    assert.ok(
      runInteractive(this, startArgvWithMock(this), acceptEveryPrompt, overrides),
      "the interactive run must start",
    );
  },
);

When(
  "the user declines the proceed confirmation",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // A real-format stand-in staff token satisfies start's auth gate (interactive
    // start signs in through the device grant only when no auth is configured),
    // so the run reaches the proceed confirmation without a real sign-in.
    // `--mock-organizations` (the CLI's deterministic org affordance, feature
    // 027) resolves the organization without a network call, so the prompt timing
    // stays deterministic under load and the scripted Enter, Enter, decline align;
    // a single org means no organization choice prompt. Accept the env-name and
    // project-directory defaults with Enter, then decline the proceed confirmation
    // with `n`.
    this.notes.mockOrgs = "org-solo";
    assert.ok(
      runInteractive(
        this,
        startArgvWithMock(this),
        // Accept every pre-filled default, then decline the proceed confirmation.
        (sequence) => [...acceptEveryPrompt(sequence).slice(0, -1), "n"],
        { JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN },
      ),
      "the interactive run must start",
    );
  },
);

Then(
  "the proceed confirmation should name the store, storefront, and deployment it would create",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    for (const [label, re] of [
      ["store", /\bstore\b/i],
      ["storefront", /\bstorefront\b/i],
      ["deployment", /\bdeploy/i],
    ] as const) {
      assert.match(
        out,
        re,
        `the proceed confirmation must name the "${label}" it would create; got:\n${out}`,
      );
    }
  },
);

Then(
  "the interactive output should state that setup stopped and nothing was created",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /\b(stopped|cancelled|canceled|did not proceed)\b/i,
      `the interactive output must state that setup stopped; got:\n${out}`,
    );
    assert.match(
      out,
      /nothing (?:was )?created|created nothing|no[^\n]*\b(store|storefront|deployment|resources?|changes?)\b[^\n]*created/i,
      `the interactive output must state that nothing was created; got:\n${out}`,
    );
  },
);

When(
  "`jolly start --dry-run --yes` runs in an interactive terminal and receives no input",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    assert.ok(runInteractive(this, ["start", "--dry-run", "--yes"], () => []), "the interactive run must start");
  },
);

When(
  "`jolly start --dry-run --json` runs in an interactive terminal",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    assert.ok(runInteractive(this, ["start", "--dry-run", "--json"], () => []), "the interactive run must start");
  },
);

Then("Jolly should present interactive setup prompts", function (this: JollyWorld) {
  assert.ok(
    CLACK_GLYPH.test(this.lastRun!.stdout),
    `interactive start must render Bombshell prompts; got: ${this.lastRun!.stdout}`,
  );
});

Then(
  "no file should be created or modified in the project directory",
  function (this: JollyWorld) {
    const entries = readdirSync(this.projectDir);
    assert.deepEqual(
      entries,
      [],
      `the dry-run preview must not create or modify any file; found: ${entries.join(", ")}`,
    );
  },
);

Then("Jolly should announce the Vercel sign-in gate", function (this: JollyWorld) {
  const text = this.lastRun!.stdout.toLowerCase();
  assert.ok(
    /vercel/.test(text) && /(sign|login|gate)/.test(text),
    `interactive start must announce the Vercel sign-in gate; got: ${this.lastRun!.stdout}`,
  );
});

Then("Jolly should announce the Dashboard Stripe app gate", function (this: JollyWorld) {
  const text = this.lastRun!.stdout.toLowerCase();
  assert.ok(
    /stripe/.test(text) && /(dashboard|gate)/.test(text),
    `interactive start must announce the Dashboard Stripe app gate; got: ${this.lastRun!.stdout}`,
  );
});

// Feature 027 Rule "Interactive start runs end-to-end in one session": the
// preview tells the human about the human steps the run involves — the Vercel
// sign-in is run with them inline (not handed off as a separate command), and
// the Stripe key entry in the Saleor Dashboard is the one closing step left to
// them. These assert the surviving human text names each, with the inline /
// final-step framing the spec mandates.

Then(
  "the interactive output should say Jolly will run the Vercel sign-in with the human inline",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /vercel[^\n]*\b(sign[ -]?in|log[ -]?in|login)\b/i,
      `the interactive output must name the Vercel sign-in step; got:\n${out}`,
    );
    assert.match(
      out,
      /\b(inline|with you|together|in this (?:terminal|session)|same (?:terminal|session)|here)\b/i,
      `the interactive output must say the Vercel sign-in is run with the human inline; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should say Jolly will run the Vercel sign-in with the human up front, before the unattended stages",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /vercel[^\n]*\b(sign[ -]?in|log[ -]?in|login)\b/i,
      `the interactive output must name the Vercel sign-in step; got:\n${out}`,
    );
    assert.match(
      out,
      /\bup front\b|before the (?:unattended|mechanical|setup) stages?/i,
      `the interactive output must say the Vercel sign-in runs up front, before the unattended stages; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should name the Saleor Dashboard Stripe key entry as the final human step",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /stripe[^\n]*\b(key|keys)\b[^\n]*dashboard|dashboard[^\n]*stripe[^\n]*\b(key|keys)\b/i,
      `the interactive output must name the Saleor Dashboard Stripe key entry; got:\n${out}`,
    );
    assert.match(
      out,
      /\b(final|last|remaining|closing|end)\b/i,
      `the interactive output must frame the Stripe key entry as the final human step; got:\n${out}`,
    );
  },
);

Then("Jolly should complete without blocking for any prompt", function (this: JollyWorld) {
  // --yes (no --json) runs the human default path: it must complete (exit 0) and
  // produce output rather than hang on a prompt. Feature 020: default mode is
  // human-only and carries no envelope, so completion is proven by exit + output.
  assert.equal(
    this.lastRun!.exitCode,
    0,
    `--yes must complete without blocking; exit ${this.lastRun!.exitCode}`,
  );
  assert.ok(
    this.lastRun!.stdout.trim().length > 0,
    "the --yes run must produce human output, proving it ran without blocking",
  );
});

Then("no interactive prompt should be shown", function (this: JollyWorld) {
  assert.ok(
    !CLACK_GLYPH.test(this.lastRun!.stdout),
    `--yes on a TTY must show no interactive prompt; got: ${this.lastRun!.stdout}`,
  );
});

Then("no prompt or spinner text should appear on stdout", function (this: JollyWorld) {
  assert.ok(
    !CLACK_GLYPH.test(this.lastRun!.stdout),
    `--json must keep stdout free of prompt/spinner text; got: ${this.lastRun!.stdout}`,
  );
});

// ─── Human-output observables (feature 027: resolved decisions in the ──────
// terminal, not the machine envelope). In the interactive default path there
// is no JSON envelope (feature 020), so these read the surviving human text.

Then(
  "the interactive output should list the mechanical setup stages, including the store, storefront, and deployment stages",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    for (const stage of ["store", "storefront", "deploy"]) {
      assert.match(
        out,
        new RegExp(`${stage}:`, "i"),
        `the interactive output must list the "${stage}" setup stage; got:\n${out}`,
      );
    }
  },
);

Then(
  "the interactive output should present an organization choice naming {string} and {string}",
  function (this: JollyWorld, a: string, b: string) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /choose[^\n]*organization/i,
      `the interactive output must present an organization choice; got:\n${out}`,
    );
    for (const org of [a, b]) {
      assert.ok(
        out.includes(org),
        `the organization choice must name "${org}"; got:\n${out}`,
      );
    }
  },
);

Then(
  "accepting the default should name {string} as the target organization in the output",
  function (this: JollyWorld, org: string) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.ok(
      namesTargetOrganization(out, org),
      `accepting the default must name "${org}" as the target organization; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should name {string} as the target organization",
  function (this: JollyWorld, org: string) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.ok(
      namesTargetOrganization(out, org),
      `the interactive output must name "${org}" as the target organization; got:\n${out}`,
    );
  },
);

Then(
  "no organization choice should be shown, because the token resolves exactly one organization",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.doesNotMatch(
      out,
      /choose[^\n]*organization/i,
      `no organization choice may be shown when the token resolves exactly one; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should not report the store, storefront, recipe, or deployment stages as completed",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const passIds = [...out.matchAll(/\[pass\]\s+([a-z0-9-]+)/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    for (const id of passIds) {
      for (const stage of SIDE_EFFECTING_STAGES) {
        assert.ok(
          !id.startsWith(stage),
          `declining must not report the "${stage}" stage as completed; found passed check "${id}"`,
        );
      }
    }
    // Nor any result artifact a completed stage would emit.
    assert.doesNotMatch(
      out,
      /[a-z0-9-]+\.saleor\.cloud/i,
      `declining must not surface a provisioned store domain; got:\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /\.vercel\.app/i,
      `declining must not surface a deployment URL; got:\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /\bdeployed\b/i,
      `declining must not claim a deployment happened; got:\n${out}`,
    );
  },
);

Then(
  "Jolly must not print a fabricated store URL or verification result",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.doesNotMatch(
      out,
      /[a-z0-9-]+\.saleor\.cloud/i,
      `declining must not print a fabricated store URL; got:\n${out}`,
    );
    // Match fabricated-SUCCESS phrasings only — a positive claim that the store/
    // setup/checkout was verified or is ready. A bare `verified` is too broad: it
    // false-matches honest NEGATIVE messages that are the opposite of fabrication
    // ("could not be verified on disk", "purchasability was not verified"), so the
    // subject (store|setup|checkout|environment) must immediately precede it.
    assert.doesNotMatch(
      out,
      /\b((?:store|setup|checkout|environment)\s+(?:is\s+)?verified|verification (?:passed|succeeded|complete)|store is ready|environment[^\n]*ready)\b/i,
      `declining must not print a fabricated verification result; got:\n${out}`,
    );
  },
);

// ─── Inline device-grant sign-in (feature 027 Rule "runs end-to-end in one ──
// session" + feature 018). No auth configured: interactive start signs in
// through the Saleor device authorization grant inline — the same grant as
// `jolly login`, never a pasted secret. Driven against the real kernel PTY with
// credentials genuinely absent; the device-code request is unauthenticated (no
// credential needed) and the human never authorizes, so the PTY deadline stops
// the still-polling run and the captured output holds the displayed code + URL.

const DEVICE_USER_CODE_RE = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/;
const DEVICE_VERIFICATION_URL =
  "https://auth.saleor.io/realms/saleor-cloud/device";

When(
  "the user starts interactive setup with no Cloud token configured",
  { timeout: 30_000 },
  function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    // No token: the run shows the device code and its verification URL, then polls
    // for an approval that never comes — it never exits. The read ends on the very
    // output the scenarios assert on: the auth.saleor.io verification URL.
    const run = runUnderPty({
      runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
      argv: [CLI_ENTRY, "start"],
      cwd: this.projectDir,
      env: interactiveChildEnv(),
      inputs: [],
      readUntil: [DEVICE_VERIFICATION_URL],
      timeoutMs: 15_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: ["start"],
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
      envelope: undefined,
    };
  },
);

Then(
  "the interactive output should show the device user code and the auth.saleor.io verification URL with that code appended as its `user_code` query parameter",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const code = out.match(DEVICE_USER_CODE_RE);
    assert.ok(code, `interactive start must show the device user code; got:\n${out}`);
    // The verification URL carries the user code as its `user_code` query
    // parameter so opening it pre-fills the code (feature 018 device-grant Rule).
    assert.ok(
      out.includes(`${DEVICE_VERIFICATION_URL}?user_code=${code![0]}`),
      `interactive start must show ${DEVICE_VERIFICATION_URL}?user_code=${code?.[0]}; got:\n${out}`,
    );
  },
);

Then(
  "the interactive output should not prompt the user to paste a token",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout).toLowerCase();
    assert.doesNotMatch(
      out,
      /paste[^\n]*token/,
      `interactive start must sign in via the device grant, never a paste prompt; got:\n${out}`,
    );
  },
);

// ─── Message catalog binding (feature 027: human copy is a catalog asset) ──
// The interactive notes and the proceed/decline copy are not hard-coded in
// `src/`; they are rendered from `assets/messages/cli.json` by key. These
// scenarios pin that contract: the text the human sees must BE the catalog
// message for the named key. clack renders notes inside a box and wraps at the
// 80-column PTY width, prefixing wrapped lines with `│`; normalize that framing
// away (strip ANSI, drop the box/symbol glyphs, collapse whitespace) so the
// assertion compares the catalog copy itself, not clack's line-wrapping.
const CLI_MESSAGES_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");

function catalogMessage(key: string): string {
  const catalog = JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<
    string,
    string
  >;
  const message = catalog[key];
  assert.ok(
    typeof message === "string" && message.length > 0,
    `the message catalog must define a non-empty "${key}"`,
  );
  return message;
}

function normalizeCatalogText(text: string): string {
  return stripAnsi(text)
    .replace(/[│┌└├─◆◇◻◼●○◐◓◑◒▪]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Then(
  // The per-stage "running description on stderr" sentences are carried by their
  // own step below (they need a separated-stream run to observe stderr), so this
  // generic stdout binding excludes them to keep the match unambiguous.
  /^the (?!.*running description on stderr).+ should be the `([\w.]+)` message from `assets\/messages\/cli\.json`$/,
  function (this: JollyWorld, key: string) {
    const expected = catalogMessage(key);
    const out = normalizeCatalogText(this.lastRun!.stdout);
    assert.ok(
      out.includes(normalizeCatalogText(expected)),
      `the interactive output must render the "${key}" catalog message verbatim ` +
        `("${expected}"); got:\n${out}`,
    );
  },
);

// The CURRENTLY-RUNNING stage's plain-language description renders on stderr,
// in the live progress region, sourced from the catalog by key (feature 027).
// Drive `jolly start` with stdout/stderr on separate PTYs so the per-stage
// running description on stderr is observable; the run happens once and is reused
// across the init/auth Then steps.
Then(
  /^the (init|auth) stage's running description on stderr should be the `([\w.]+)` message from `assets\/messages\/cli\.json`$/,
  { timeout: 160_000 },
  function (this: JollyWorld, stage: string, key: string) {
    if (this.notes.stageRunStderr === undefined) {
      assert.ok(runStartStagesSeparated(this), "the separated-stages interactive run must start");
      this.notes.stageRunStderr = stripAnsi(this.lastRun!.stderr);
    }
    const stderr = String(this.notes.stageRunStderr);
    const expected = normalizeCatalogText(catalogMessage(key));
    assert.ok(
      normalizeCatalogText(stderr).includes(expected),
      `the ${stage} stage's running description on stderr must render the "${key}" catalog ` +
        `message ("${expected}"); got:\n${stderr}`,
    );
    return undefined;
  },
);

// ─── Setup-stage live progress (feature 027) ───────────────────────────────
//
// The setup stages must render as a live STATUS LIST on stderr — every stage
// named, each carrying its OWN status that updates in place as the run reaches
// it — not one fixed spinner. To observe the stream split (progress on stderr,
// a clean stdout), `jolly start` runs under separate stdout/stderr PTYs
// (support/pty.ts separateStreams). A real-format stand-in Cloud token satisfies
// start's auth gate without a real sign-in; the stages attempt and fail fast
// under the otherwise-absent real credentials while their per-stage status still
// renders. Enter advances each pre-filled prompt and the proceed gate, so the
// run reaches the stages.

// The user-visible setup stages the progress region must name and status. The
// single fixed spinner ("Running setup stages") names none of these.
const SETUP_STAGE_NAMES = ["store", "storefront", "recipe", "deploy"] as const;

// In-place redraw: a carriage return or cursor-up / erase-line control. A
// line-per-update implementation carries none of these.
const STAGE_IN_PLACE = /\r|\x1b\[[0-9]*[AK]/;

// A per-stage status marker: a completion/spinner glyph or a status word that
// reports a stage's progress. clack's PROMPT-state glyphs (◆◇●○ — active /
// submitted / radio) are deliberately EXCLUDED: they decorate the plan-preview
// and confirm prompts, not a stage's status, so they must not let plan-preview
// text masquerade as a live per-stage status.
const STAGE_STATUS_MARKER =
  /[✓✔✗✘☑☒○◌·▸▶]|[⠀-⣿]|\b(done|running|pending|failed|skipped|complete|completed|installing|cloning|provisioning|deploying|waiting|queued|active|in progress)\b/i;

// Run `jolly start` interactively with stdout and stderr on separate PTYs, so
// the per-stage status region on stderr is observable apart from the clean
// stdout. Records the captured streams as the world's last run. Returns false
// when no PTY is available (caller skips).
function runStartStagesSeparated(world: JollyWorld): boolean {
  if (!ptyAvailable()) return false;
  const argv = (world.notes.startArgv as string[]) ?? ["start"];
  const sequence = startPromptSequence({ argv, cwd: world.projectDir });
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, ...argv],
    cwd: world.projectDir,
    env: interactiveChildEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }),
    inputs: acceptEveryPrompt(sequence),
    waitFor: sequence,
    readUntil: "exit",
    timeoutMs: 150_000,
    separateStreams: true,
  });
  world.previousRun = world.lastRun;
  world.lastRun = {
    args: argv,
    cwd: world.projectDir,
    exitCode: run.exitCode,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    envelope: findEnvelope(run.stdout ?? run.output),
  };
  return true;
}

Then(
  "the setup-stage progress on stderr should list every setup stage by name, each carrying its own status",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // The shared When records only the argv; perform the separated-stream run
    // here so stderr is captured distinctly from the clean stdout.
    assert.ok(runStartStagesSeparated(this), "the separated-stages interactive run must start");
    const stderr = this.lastRun!.stderr;
    assert.ok(
      stderr.trim().length > 0,
      `interactive start must write setup-stage progress to stderr; it was empty. stdout was:\n${this.lastRun!.stdout}`,
    );
    // Each setup stage carries its OWN status: a status list renders every stage
    // on its own row, the stage name and that stage's status TOGETHER on one
    // line (e.g. `✓ store` / `⠙ storefront installing`). Split on every line
    // break (carriage-return redraws included) and require, for each stage, a
    // line that names it AND carries a status marker. The one-fixed-spinner
    // anti-pattern fails this: its only status line is "Running setup stages"
    // (a status word, no stage name), while the plan-preview rows name a stage
    // but carry no status — neither line satisfies the co-occurrence.
    const lines = stripAnsi(stderr).split(/[\r\n]+/);
    for (const stage of SETUP_STAGE_NAMES) {
      const nameOnLine = new RegExp(`\\b${stage}\\b`, "i");
      const row = lines.find(
        (line) => nameOnLine.test(line) && STAGE_STATUS_MARKER.test(line),
      );
      assert.ok(
        row !== undefined,
        `the "${stage}" stage must appear as its own status row (stage name + status on one line), not folded into one fixed spinner; stderr lines:\n${lines.join("\n")}`,
      );
    }
    return undefined;
  },
);

// The CURRENTLY-RUNNING stage names what it is doing in plain language (not a
// bare stage name) so the slow stages don't read as a mysterious wait.
Then(
  "the running stage's row should describe in plain language what that stage is doing",
  function (this: JollyWorld) {
    assert.ok(ptyAvailable() && this.lastRun?.stderr, "the PTY run must produce stderr");
    const stderr = stripAnsi(this.lastRun.stderr);
    assert.match(
      stderr,
      /creating your Saleor store|cloning the storefront|deploying the starter catalog|seeding product stock|deploying to Vercel|installing the Stripe app|signing in to Saleor Cloud|setting up skills/i,
      `the running stage must describe its action in plain language; got:\n${stderr}`,
    );
    return undefined;
  },
);

Then(
  "it should update a stage's status in place as the run reaches that stage, so each stage's progress is visible during the run rather than only after it ends",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stderr,
      STAGE_IN_PLACE,
      `each stage's status must update live in place (carriage-return / cursor control) as the run reaches it; got:\n${JSON.stringify(this.lastRun!.stderr)}`,
    );
  },
);

Then(
  "the progress should redraw the same region in place rather than appending one line per update",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stderr,
      STAGE_IN_PLACE,
      `progress must redraw the same region in place (carriage-return / cursor control), not append one line per update; got:\n${JSON.stringify(this.lastRun!.stderr)}`,
    );
  },
);

// ─── Concise human close (feature 027): the interactive run ends with a prose
// summary, not the machine check enumeration or the agent `next:` playbook.

Then(
  "the human result on stdout should state in prose that the plan was previewed and nothing was created",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /previewed/i,
      `the human close must state in prose that the plan was previewed; got:\n${out}`,
    );
    assert.match(
      out,
      /nothing was created|no files were (?:written|created)|no changes were made|created nothing/i,
      `the human close must state in prose that nothing was created; got:\n${out}`,
    );
  },
);

Then(
  "the human result on stdout should carry no per-check `[status] check-id` enumeration line",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const checkLine = out
      .split(/\r?\n/)
      .find((line) => /^\s*-\s+\S*\s*\[[a-z]+\]\s+[a-z0-9][a-z0-9-]*\b/i.test(line));
    assert.equal(
      checkLine,
      undefined,
      `the human close must carry no per-check [status] check-id line; found:\n${checkLine}`,
    );
  },
);

Then(
  "the human result on stdout should carry no `next:` command line",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const nextLine = out.split(/\r?\n/).find((line) => /^\s*next:/i.test(line));
    assert.equal(
      nextLine,
      undefined,
      `the human close must carry no next: command line; found:\n${nextLine}`,
    );
  },
);

// ─── Plan preview lists the human-relevant side-effecting stages only (feature
// 027): the internal bootstrap stages (init, auth) are not human decisions.

Then(
  "the interactive output should list the side-effecting setup stages it will create, including the store, storefront, and deployment stages",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    for (const stage of ["store", "storefront", "deploy"]) {
      assert.match(
        out,
        new RegExp(`\\b${stage}:`, "i"),
        `the plan preview must list the "${stage}" side-effecting stage; got:\n${out}`,
      );
    }
  },
);

Then(
  "the interactive output should not list the internal bootstrap stages `init` or `auth`, which are not human decisions",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const bootstrapRow = out
      .split(/\r?\n/)
      .find((line) => /^[│\s]*(init|auth):/i.test(line));
    assert.equal(
      bootstrapRow,
      undefined,
      `the plan preview must not list the internal bootstrap stages init/auth; found row:\n${bootstrapRow}`,
    );
  },
);

// ─── Clickable sign-in URL (feature 027): the verification URL is wrapped in an
// OSC 8 terminal hyperlink so the human can click it. The OSC 8 escape survives
// stripAnsi (which removes only CSI sequences), so the RAW output is inspected.

Then(
  "the auth.saleor.io verification URL should be wrapped in an OSC 8 terminal hyperlink escape pointing at that URL",
  function (this: JollyWorld) {
    const raw = this.lastRun!.stdout; // OSC 8 escapes are the observable — keep raw
    const code = stripAnsi(raw).match(DEVICE_USER_CODE_RE);
    assert.ok(code, `interactive start must show the device user code; got:\n${stripAnsi(raw)}`);
    const url = `${DEVICE_VERIFICATION_URL}?user_code=${code![0]}`;
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // OSC 8 hyperlink open: ESC ] 8 ; <params> ; <URI> ST  (ST = BEL or ESC \).
    const osc8 = new RegExp(`\\x1b\\]8;[^;]*;${escaped}(?:\\x07|\\x1b\\\\)`);
    assert.match(
      raw,
      osc8,
      `the verification URL must be wrapped in an OSC 8 hyperlink pointing at ${url}; got:\n${JSON.stringify(raw)}`,
    );
  },
);

// ─── Completed interactive run: the human close names the live store and the ──
// remaining human step (feature 027 @sandbox). A REAL interactive `jolly start`
// driven to completion over a project whose store, storefront, and deployment
// stages are already satisfied — the wrapper around already-proven stages is
// tested against their satisfied state, not by running them again (feature
// verification-economy's licence Rule). The satisfied state is what a completed
// earlier run leaves, assembled from the run's shared fixtures: the shared
// store's creds in .env, a real prepared Paper tree in storefront/, and the
// run-shared live deployment on the long-lived shared Vercel project
// (support/deployed-storefront.ts). Driven against separate stdout/stderr PTYs
// so the human RESULT summary emit() prints to stdout (the "closing summary")
// is observable apart from the per-stage progress on stderr (feature 020/027
// stream split).

// The real process environment (real JOLLY_* credentials), with overrides — the
// completing run must reach the real accounts, so absentCredentialsEnv is NOT
// applied here. `undefined` overrides delete the variable.
function realChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...overrides })) {
    if (v !== undefined) env[k] = v;
  }
  if (!env.TERM) env.TERM = "xterm-256color";
  return env;
}

// The satisfied starting state is what a COMPLETED earlier run leaves in a
// project, assembled from the run's shared fixtures rather than by running the
// chain again: the shared store's creds (store stage satisfied), a real
// materialized Paper tree with production's framework pin (storefront stage
// satisfied), and the run-shared live deployment with the project link
// production writes after a completed deploy (deployment stage satisfied).
Given(
  "a project whose store, storefront, and deployment stages are already satisfied",
  { timeout: 1_500_000 },
  async function (this: JollyWorld) {
    const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    const token = process.env["SALEOR_TOKEN"];
    assert.ok(
      endpoint && token,
      "the @sandbox Before hook must have provisioned the shared store " +
        "(NEXT_PUBLIC_SALEOR_API_URL + SALEOR_TOKEN in process.env)",
    );
    // Store stage satisfied: a configured endpoint short-circuits runStoreStage
    // to reuse, and the channel is the value a completed deploy writes back
    // (src/index.ts runDeployStage).
    writeEnvValues(this.projectDir, {
      NEXT_PUBLIC_SALEOR_API_URL: endpoint!,
      SALEOR_URL: endpoint!,
      SALEOR_TOKEN: token!,
      NEXT_PUBLIC_DEFAULT_CHANNEL: "us",
    });
    // Storefront stage satisfied: a real prepared Paper tree (the shared
    // template), plus the vercel.json framework pin production writes before
    // its deploy.
    await materializePreparedStorefront(join(this.projectDir, "storefront"));
    writeFileSync(
      join(this.projectDir, "storefront", "vercel.json"),
      JSON.stringify({ framework: "nextjs" }, null, 2) + "\n",
    );
    // Deployment stage satisfied: the run's ONE shared live deployment, and the
    // storefront linked to its project exactly as production links after a
    // completed deploy.
    const deployment = await ensureSharedDeployment();
    linkStorefrontToSharedProject(join(this.projectDir, "storefront"), deployment.project);
    this.notes.satisfiedDeployment = deployment;
  },
);

When(
  "`jolly start` runs to completion in an interactive terminal",
  { timeout: 1_560_000 },
  async function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(cloudToken, "the Saleor Cloud token must be present");
    const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    const storeToken = process.env["SALEOR_TOKEN"];
    assert.ok(endpoint, "the provisioned store endpoint must be present");
    assert.ok(storeToken, "the provisioned SALEOR_TOKEN must be present");

    // The satisfied-stages Given assembled the project: shared store in .env,
    // prepared storefront on disk, and the run-shared live deployment. The run
    // targets that SAME long-lived shared Vercel project, so the deploy stage
    // operates on the deployment the Given declared satisfied; the shared
    // project persists by design and no removal is registered.
    const deployment = this.notes.satisfiedDeployment as SharedDeployment | undefined;
    assert.ok(
      deployment,
      "the satisfied-stages Given must have provisioned the shared deployment",
    );

    // Pin the organization deterministically (a real feature 012 affordance) so a
    // multi-org token never inserts an org-choice prompt that would misalign the
    // scripted keystrokes; with --organization set the org prompt is skipped.
    const orgs = await listOrganizations(cloudToken);
    const organization = orgs[0];
    assert.ok(organization, "the Cloud token must resolve at least one organization");

    // Inputs, in prompt order (Cloud token configured → no device sign-in;
    // --organization pinned → no org choice; store configured in .env → no
    // create/reuse choice and no environment name): accept the storefront
    // directory and the proceed gate, each with Enter. Each keystroke is gated on
    // its prompt marker (waitFor) so the real run's network gaps before each
    // prompt cannot make a fixed cadence send — and lose — an Enter before the
    // prompt renders.
    const run = runUnderPty({
      runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
      argv: [CLI_ENTRY, "start", "--organization", organization],
      cwd: this.projectDir,
      env: realChildEnv({
        NEXT_PUBLIC_SALEOR_API_URL: endpoint,
        SALEOR_TOKEN: storeToken,
        JOLLY_VERCEL_PROJECT: deployment.project,
      }),
      inputs: ["\r", "\r"],
      waitFor: ["Storefront project directory", "Build your store now?"],
      // The real run completes every stage and exits; the read ends there.
      readUntil: "exit",
      timeoutMs: 1_500_000,
      separateStreams: true,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: ["start", "--organization", organization],
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      envelope: findEnvelope(run.stdout ?? run.output),
    };
  },
);

// The store's Saleor Dashboard URL ends in `.saleor.cloud/dashboard/` (feature
// 002). The completed run's human close on stdout must name it, so the human
// knows where their live store lives.
const SALEOR_DASHBOARD_URL = /https:\/\/[a-z0-9.-]+\.saleor\.cloud\/dashboard\//i;

Then(
  "the closing summary on stdout should name the store's Saleor Dashboard URL",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      SALEOR_DASHBOARD_URL,
      `the closing summary must name the live store's Saleor Dashboard URL (…​.saleor.cloud/dashboard/); got:\n${out}`,
    );
  },
);

Then(
  "the closing summary on stdout should name the deployed storefront URL",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /https:\/\/[a-z0-9.-]+\.vercel\.app/i,
      `the closing summary must name the deployed storefront URL (…​.vercel.app); got:\n${out}`,
    );
  },
);

Then(
  "the closing summary on stdout should name the Stripe Dashboard key entry as the human's remaining step",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /stripe[^\n]*\b(key|keys)\b[^\n]*dashboard|dashboard[^\n]*stripe[^\n]*\b(key|keys)\b/i,
      `the closing summary must name the Saleor Dashboard Stripe key entry; got:\n${out}`,
    );
    assert.match(
      out,
      /\b(remaining|final|last|closing|left|next step)\b/i,
      `the closing summary must frame the Stripe key entry as the human's remaining step; got:\n${out}`,
    );
  },
);

// The human close is a concise prose summary, not the machine check enumeration
// (feature 027): renderHuman prints a per-check line as `  - [status] check-id…`.
const PER_CHECK_LINE = /^\s*-\s+\S*\s*\[[a-z]+\]\s+[a-z0-9][a-z0-9-]*\b/i;

Then(
  "the closing summary on stdout should not enumerate per-check results as `[status] check-id` lines",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const checkLine = out.split(/\r?\n/).find((line) => PER_CHECK_LINE.test(line));
    assert.equal(
      checkLine,
      undefined,
      `the closing summary must carry no per-check [status] check-id enumeration line; found:\n${checkLine}`,
    );
  },
);

Then(
  "the closing summary on stdout should not present the Saleor endpoint or SALEOR_TOKEN readiness check, which the store stage resolved, as a failure of the completed run",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    // The store stage provisioned the endpoint and projected SALEOR_TOKEN, so the
    // endpoint/SALEOR_TOKEN readiness is satisfied. No close line may present that
    // readiness as a failure (a stale doctor-style fail re-surfaced after the
    // store stage already resolved it).
    const readiness = /\b(saleor-endpoint|saleor-token|SALEOR_TOKEN)\b/i;
    const failure = /\[fail\]|\berror\[|\bfailed\b|\bnot configured\b|\bmissing\b|\bunreachable\b/i;
    const offending = out
      .split(/\r?\n/)
      .find((line) => readiness.test(line) && failure.test(line));
    assert.equal(
      offending,
      undefined,
      `the closing summary must not present the Saleor endpoint/SALEOR_TOKEN readiness (resolved by the store stage) as a failure; found:\n${offending}`,
    );
  },
);

// ── The honest FAILED close (feature 027 "A failed setup stage closes honestly") ─
// A genuine stage failure closes through the start.close.notFinished catalog
// line, naming the stage(s) that did not finish — never the live-store close,
// never a fabricated URL, and never the success-only keep-building orientation.

Then(
  "the closing summary on stdout should name the storefront stage as failed",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const closeLine = out
      .split(/\r?\n/)
      .find((line) => /Setup did not finish/i.test(line));
    assert.ok(
      closeLine,
      `the close must state setup did not finish (start.close.notFinished); got:\n${out}`,
    );
    assert.match(
      closeLine!,
      /\bstorefront\b/i,
      `the close must name the storefront stage among the stages that did not complete; got:\n${closeLine}`,
    );
  },
);

Then(
  "the closing summary should not claim the run completed or name a live storefront URL",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.doesNotMatch(
      out,
      /Your store is live/i,
      `a failed run must not render the live close (start.close.live); got:\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /https:\/\/[a-z0-9.-]+\.vercel\.app/i,
      `a failed run must not name a live storefront URL; got:\n${out}`,
    );
  },
);

Then(
  "the closing summary should not carry the keep-building orientation naming `storefront\\/` and `recipe.yml`",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    // The keep-building orientation is success-only (feature 027 Rule): its
    // header and its two artifact lines must be absent from a failed close.
    for (const [label, re] of [
      ["start.close.keepBuilding header", /Keep building:/i],
      ["start.close.keepStorefront line", /your storefront, live on Vercel/i],
      ["start.close.keepRecipe line", /your catalog & store config as code/i],
    ] as const) {
      assert.doesNotMatch(
        out,
        re,
        `a failed close must carry no keep-building orientation (${label}); got:\n${out}`,
      );
    }
  },
);

// ── The Vercel sign-in gate (feature 027 Rule "Interactive start runs end-to-end
// in one session") ─────────────────────────────────────────────────────────────
//
// This gate shipped BROKEN THREE TIMES because nothing drove it. The old code
// handed the terminal to `vercel login` (stdio: "inherit"); the Vercel CLI opens a
// readline on process.stdin for its device flow, which under an interactive
// `jolly start` never renders — so the human was shown NOTHING, nothing waited for
// their click, and the run continued signed-out. These scenarios drive the REAL
// interactive path against the REAL Vercel CLI (support/pty.ts, a real kernel PTY)
// so that regression cannot recur.
//
// Signed-out is produced HONESTLY, not faked: fresh XDG dirs hold no Vercel
// credentials, so the real CLI genuinely has no session. No mock, no stub.

// A Vercel CLI with nowhere to store credentials = a genuinely signed-out CLI.
function signedOutVercelEnv(world: JollyWorld): Record<string, string | undefined> {
  const home = world.newTempDir("vercel-signed-out");
  return {
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
  };
}

// Reach the gate the way a returning human does: a store already in .env, so the
// run takes the "reuse your configured store" route straight to the confirm and
// then the sign-in gate — which sits BEFORE any side-effecting stage.
function seedConfiguredStore(world: JollyWorld): void {
  const endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL;
  assert.ok(endpoint, "sandbox: NEXT_PUBLIC_SALEOR_API_URL must be configured");
  writeEnvValues(world.projectDir, { NEXT_PUBLIC_SALEOR_API_URL: endpoint });
}

// The waiting indicator's copy, as the catalog owns it. clack re-renders the
// spinner incrementally, so a stable inner phrase is used both to end the read
// and to assert on it.
function vercelWaitingPhrase(): string {
  return cliMessage("start.vercelSigninWaiting").replace(/[…\.]+$/, "").slice(0, 40);
}

Given(
  "an already-configured store and an interactive terminal with no Vercel CLI session",
  function (this: JollyWorld) {
    seedConfiguredStore(this);
    this.notes.vercelGateEnv = signedOutVercelEnv(this);
    // The run PARKS at the sign-in: it never exits on its own. The read ends on
    // the output this scenario asserts on — the device URL and the waiting
    // indicator — and `stillRunning` then proves the run is parked there rather
    // than having carried on signed-out.
    this.notes.vercelGateReadUntil = [
      "https://vercel.com/oauth/device",
      vercelWaitingPhrase(),
    ];
  },
);

Given(
  "an already-configured store and an interactive terminal where the Vercel CLI cannot sign in",
  function (this: JollyWorld) {
    seedConfiguredStore(this);
    // A REAL failure from real bad input, not a fake: the Vercel CLI's device
    // request is pointed through an unroutable proxy, so it genuinely cannot reach
    // vercel.com and prints its own error instead of a sign-in link — exactly the
    // shape of the wedged environment that cost three releases to diagnose.
    this.notes.vercelGateEnv = {
      ...signedOutVercelEnv(this),
      HTTPS_PROXY: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1",
      https_proxy: "http://127.0.0.1:1",
      http_proxy: "http://127.0.0.1:1",
      NO_PROXY: "",
      no_proxy: "",
    };
    // The failing sign-in reports why and points at the captured CLI output; the
    // read ends on that reported output, the very thing this scenario asserts on.
    this.notes.vercelGateReadUntil = ["Full output:"];
  },
);

When("`jolly start` reaches the Vercel sign-in gate", function (this: JollyWorld) {
  assert.ok(ptyAvailable(), "the PTY driver must be available");
  // Enter accepts the storefront directory, Enter accepts "Build your store now?".
  // The gate sits immediately after that confirm, and the run parks there. The
  // read ends on the output this scenario asserts on, declared by its Given.
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, "start"],
    cwd: this.projectDir,
    env: interactiveChildEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: process.env.JOLLY_SALEOR_CLOUD_TOKEN,
      NEXT_PUBLIC_SALEOR_API_URL: process.env.NEXT_PUBLIC_SALEOR_API_URL,
      ...(this.notes.vercelGateEnv as Record<string, string | undefined>),
    }),
    inputs: ["\r", "\r"],
    waitFor: ["Storefront project directory", "Build your store now"],
    readUntil: this.notes.vercelGateReadUntil as string[],
    perChunkTimeoutMs: 120_000,
    timeoutMs: 150_000,
  });
  this.notes.vercelGateStillRunning = run.stillRunning;
  this.lastRun = {
    args: ["start"],
    cwd: this.projectDir,
    exitCode: run.exitCode,
    stdout: run.output,
    stderr: run.stderr ?? "",
  };
});

Then(
  "the interactive output should show a Vercel device-authorization URL",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /https:\/\/vercel\.com\/oauth\/device\?[^\s]+/,
      `the human must be shown a Vercel device-authorization URL to approve; output was:\n${out.slice(-1500)}`,
    );
  },
);

Then(
  "the run should still be waiting for that sign-in to be approved, not continuing signed-out",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    // The regression: the run announced the sign-in did not complete and carried on
    // to the stages having shown the human nothing to approve.
    assert.doesNotMatch(
      out,
      /sign-in didn't complete/i,
      `the run must WAIT for the sign-in, not give up and continue signed-out; output was:\n${out.slice(-1500)}`,
    );
    // The catalog owns the copy (feature 027); assert on its text, not a literal.
    const phrase = vercelWaitingPhrase();
    assert.ok(
      out.includes(phrase),
      `the run must show that it is waiting for the human to approve the sign-in (expected ${JSON.stringify(phrase)}); output was:\n${out.slice(-1500)}`,
    );
    // Still parked at the gate when the read ended on that output: the run is
    // waiting for the approval, not carrying on without it.
    assert.equal(
      this.notes.vercelGateStillRunning,
      true,
      "the run must still be waiting at the sign-in gate, not have carried on past it",
    );
  },
);

Then(
  "the Vercel CLI's own output should never surface on the terminal",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    // Jolly's TUI speaks to the human; the spawned CLI writes to a file. Its own
    // banner and prompts must never reach the terminal.
    for (const leak of [/Vercel CLI \d+\.\d+/i, /Waiting for authentication/i]) {
      assert.doesNotMatch(
        out,
        leak,
        `the Vercel CLI's raw output must never surface — Jolly's own TUI only; found ${leak} in:\n${out.slice(-1500)}`,
      );
    }
  },
);

Then(
  "the interactive output should name the reason the Vercel sign-in did not complete",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /never printed a sign-in link|could not launch the Vercel CLI|was declined|device code expired|never approved/i,
      `a failed sign-in must name WHY, never a bare "didn't complete"; output was:\n${out.slice(-2000)}`,
    );
  },
);

Then(
  "the interactive output should surface the captured Vercel CLI output for the human to read",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    assert.match(
      out,
      /Full output: \S+/i,
      `the human must be pointed at the Vercel CLI's captured output; output was:\n${out.slice(-2000)}`,
    );
  },
);

// ─── Bare `jolly completion` prints usage (feature 027) ────────────────────
// `completion` with no shell argument is a human asking how to use it: the
// command prints its usage line naming the supported shells and exits 0,
// rather than erroring or emitting an envelope.

When("the agent runs `jolly completion`", function (this: JollyWorld) {
  this.runCli(["completion"], { env: absentCredentialsEnv() });
});

Then(
  "stdout should contain a usage line naming the shells bash, zsh, fish, and powershell",
  function (this: JollyWorld) {
    const stdout = this.lastRun!.stdout;
    const usage = stdout
      .split("\n")
      .find(
        (line) =>
          /usage/i.test(line) &&
          ["bash", "zsh", "fish", "powershell"].every((shell) =>
            line.includes(shell),
          ),
      );
    assert.ok(
      usage,
      `stdout must carry one usage line naming bash, zsh, fish, and powershell; got:\n${stdout}`,
    );
  },
);

Then("the exit code should be {int}", function (this: JollyWorld, code: number) {
  assert.equal(
    this.lastRun!.exitCode,
    code,
    `expected exit code ${code}; stderr:\n${this.lastRun!.stderr}`,
  );
});

// ─── Inline device-grant sign-in that CONTINUES in-session (feature 027) ───
// No auth configured at all (neither the staff token nor a device-grant access
// token): interactive `jolly start` signs the human in through the Saleor
// device authorization grant inline, stores the granted token, and the SAME
// session continues past the auth stage into the setup flow. The shared
// @exceptional-double Given points the grant at the local fake auth host,
// which approves on the first poll, so the real request, display, poll,
// store, and continue path runs without the human click that cannot be
// produced on demand.

/** Drive the inline sign-in `jolly start` once; later Thens read the result. */
function runInlineSignInStart(world: JollyWorld): void {
  if (world.notes.inlineStartRan) return;
  assert.ok(ptyAvailable(), "the PTY driver must be available");
  const sequence = startPromptSequence({ argv: ["start"], cwd: world.projectDir });
  const inputs = acceptEveryPrompt(sequence);
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, "start"],
    cwd: world.projectDir,
    // Both Cloud credentials genuinely unset (the Given's framing): the
    // device-grant tokens too, so the inline grant is the only path.
    env: interactiveChildEnv({
      JOLLY_SALEOR_ACCESS_TOKEN: undefined,
      JOLLY_SALEOR_REFRESH_TOKEN: undefined,
    }),
    inputs,
    waitFor: sequence,
    readUntil: "exit",
    timeoutMs: 120_000,
  });
  world.previousRun = world.lastRun;
  world.lastRun = {
    args: ["start"],
    cwd: world.projectDir,
    exitCode: run.exitCode,
    stdout: run.output,
    stderr: "",
    envelope: findEnvelope(run.output),
  };
  world.notes.inlineStartRan = true;
  world.notes.inlineStartSequence = sequence;
}

Given(
  "an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN and no JOLLY_SALEOR_ACCESS_TOKEN set",
  function (this: JollyWorld) {
    // Framing for the run: interactiveChildEnv unsets the staff token, and the
    // inline-sign-in driver additionally unsets the device-grant tokens.
    this.notes.inlineSignInStart = true;
  },
);

Then(
  "the interactive output should show the device user code and the verification URL before any setup stage runs",
  { timeout: 130_000 },
  function (this: JollyWorld) {
    runInlineSignInStart(this);
    const out = stripAnsi(this.lastRun!.stdout);
    const code = out.match(DEVICE_USER_CODE_RE);
    assert.ok(code, `interactive start must show the device user code; got:\n${out}`);
    const urlIndex = out.indexOf(DEVICE_VERIFICATION_URL);
    assert.ok(
      urlIndex >= 0,
      `interactive start must show the verification URL ${DEVICE_VERIFICATION_URL}; got:\n${out}`,
    );
    // Setup stages run only after the proceed gate (the prompt sequence's last
    // marker), so code + URL shown before that gate are shown before any setup
    // stage runs.
    const sequence = (this.notes.inlineStartSequence as string[]) ?? [];
    const proceedMarker = sequence[sequence.length - 1] ?? "";
    const gateIndex = proceedMarker ? out.indexOf(proceedMarker) : -1;
    const boundary = gateIndex === -1 ? out.length : gateIndex;
    assert.ok(
      out.indexOf(code![0]) < boundary && urlIndex < boundary,
      `the device user code and verification URL must appear before any setup stage runs ` +
        `(before the "${proceedMarker}" gate); got:\n${out}`,
    );
  },
);

// ─── The unattended stages run with the terminal in cooked mode (027) ──────
// The prompts take the terminal into raw mode, which clears ISIG and so disables
// the driver's signal characters. Once the last prompt is answered the stages are
// unattended and Ctrl-C is the only control the human has left, so the terminal
// must be back in cooked mode by then. That is a property of the tty's own
// termios flags, not of anything the CLI prints, so it is read from the terminal
// (support/pty.ts `sampleTermiosAt`) while the run is parked at the first
// unattended stage. The Rule pins the STATE, not the call that establishes it:
// whether the prompt library restores it or the CLI does is a free choice.

/** The first stage that runs unattended, once the prompts are answered. */
const FIRST_UNATTENDED_STAGE_KEY = "start.stage.init";
const FIRST_UNATTENDED_STAGE_MARKER = "setting up skills";

function sampledTermios(world: JollyWorld): {
  isig: boolean;
  icanon: boolean;
  echo: boolean;
} {
  const sample = world.notes.termiosAtFirstStage as
    | { isig: boolean; icanon: boolean; echo: boolean }
    | undefined;
  assert.ok(
    sample,
    "the terminal's mode was not sampled: the run never reached the first " +
      "unattended stage, so this scenario proves nothing",
  );
  return sample;
}

When(
  "the run reaches the first unattended setup stage",
  { timeout: 170_000 },
  function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    assert.ok(
      catalogMessage(FIRST_UNATTENDED_STAGE_KEY).includes(
        FIRST_UNATTENDED_STAGE_MARKER,
      ),
      `the marker "${FIRST_UNATTENDED_STAGE_MARKER}" is no longer part of the ` +
        `"${FIRST_UNATTENDED_STAGE_KEY}" catalog message — update it so the ` +
        `terminal is still sampled at the first unattended stage`,
    );
    const argv = (this.notes.startArgv as string[]) ?? ["start"];
    const sequence = startPromptSequence({ argv, cwd: this.projectDir });
    const run = runUnderPty({
      runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
      argv: [CLI_ENTRY, ...argv],
      cwd: this.projectDir,
      env: interactiveChildEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }),
      inputs: acceptEveryPrompt(sequence),
      waitFor: [...sequence, FIRST_UNATTENDED_STAGE_MARKER],
      readUntil: [FIRST_UNATTENDED_STAGE_MARKER],
      sampleTermiosAt: [FIRST_UNATTENDED_STAGE_MARKER],
      perChunkTimeoutMs: 90_000,
      timeoutMs: 150_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: argv,
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
      envelope: findEnvelope(run.output),
    };
    this.notes.termiosAtFirstStage = run.termios;
  },
);

Then(
  "the terminal should be in cooked mode, so the driver turns Ctrl-C into a signal",
  function (this: JollyWorld) {
    const mode = sampledTermios(this);
    assert.equal(
      mode.isig,
      true,
      "ISIG is clear on the terminal at the first unattended stage, so the line " +
        "discipline generates no SIGINT: a Ctrl-C from the human would reach the " +
        "run as a stray byte, and the stages that follow the prompts would be " +
        "uninterruptible",
    );
  },
);

Then(
  "the run should carry no raw-mode terminal state left over from the prompts",
  function (this: JollyWorld) {
    const mode = sampledTermios(this);
    assert.deepEqual(
      { icanon: mode.icanon, echo: mode.echo },
      { icanon: true, echo: true },
      "the prompts put the terminal into raw mode (ICANON and ECHO cleared) and " +
        "it is still there at the first unattended stage, so the prompts' " +
        "terminal state outlived the prompts",
    );
  },
);

// ─── The progress region on a narrow terminal (feature 027) ────────────────
// The terminal is genuinely narrow: the width reaches the child through the
// PTY's window size (support/pty.ts `cols`), so the CLI reads it from its own
// tty exactly as it would from a narrow window. Telling the renderer a width
// through an environment variable would prove only that the harness can set a
// variable. The screen is then replayed at the SAME width, so a row that wrapped
// for the human wraps here too.

/** The stage the narrow-terminal scenarios drive the run to. */
const NARROW_STAGE = "storefront";
const NARROW_STAGE_KEY = "start.stage.storefront";
// The leading, unwrapped fragment of the stage's catalog description: a marker
// spanning a wrap point at 40 columns would never be observed as one substring.
const NARROW_STAGE_MARKER = "cloning the storefront";

/** Every stage the run plans, as the catalog names them. */
function allStages(): string[] {
  return [...PREFLIGHT_STAGES, ...CLOSE_SIDE_EFFECTING_STAGES];
}

function narrowColumns(world: JollyWorld): number {
  const cols = world.notes.terminalColumns as number | undefined;
  assert.ok(cols, "the scenario must name the terminal's width first");
  return cols;
}

/** The progress region as the human sees it, replayed at the run's own width. */
function progressScreen(world: JollyWorld): string[] {
  return renderTerminal(world.lastRun!.stderr, narrowColumns(world));
}

/** The screen rows that report a stage's status. */
function stageRows(world: JollyWorld): string[] {
  return progressScreen(world)
    .filter((line) => STAGE_STATUS_MARKER.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

Given(
  "an interactive terminal {int} columns wide",
  function (this: JollyWorld, columns: number) {
    this.notes.terminalColumns = columns;
  },
);

/**
 * The narrow-terminal run, built once per worker and shared.
 *
 * Both narrow-terminal scenarios drive the SAME run — `jolly start` at the same
 * width, read to the same stage — and each then asserts its own property of the
 * screen it left. The run is ambient state neither scenario asserts the
 * provisioning of, so it is built once and reused (Verification agreement,
 * "provision ambient state once and share it"). Driving it twice spent ~25s of
 * the logic tier's budget to produce a second identical screen. Keyed by width
 * and argv, so a scenario naming different ones still gets its own run, and a
 * cache miss runs it, so either scenario passes alone.
 */
const narrowRuns = new Map<string, CliResult>();

When(
  "the run reaches the storefront stage",
  { timeout: 170_000 },
  function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    const argvKey = (this.notes.startArgv as string[]) ?? ["start"];
    const cacheKey = `${narrowColumns(this)}::${argvKey.join(" ")}`;
    const cached = narrowRuns.get(cacheKey);
    if (cached) {
      this.previousRun = this.lastRun;
      this.lastRun = cached;
      return;
    }
    assert.ok(
      catalogMessage(NARROW_STAGE_KEY).includes(NARROW_STAGE_MARKER),
      `the marker "${NARROW_STAGE_MARKER}" is no longer part of the ` +
        `"${NARROW_STAGE_KEY}" catalog message — update it so the run is still ` +
        `read to the "${NARROW_STAGE}" stage`,
    );
    const argv = (this.notes.startArgv as string[]) ?? ["start"];
    const sequence = startPromptSequence({ argv, cwd: this.projectDir });
    const run = runUnderPty({
      runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
      argv: [CLI_ENTRY, ...argv],
      cwd: this.projectDir,
      env: interactiveChildEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }),
      cols: narrowColumns(this),
      separateStreams: true,
      inputs: acceptEveryPrompt(sequence),
      waitFor: [...sequence, NARROW_STAGE_MARKER],
      // Read to the stage under assertion and no further; the driver stops the
      // child there, so the run leaves nothing behind.
      readUntil: [NARROW_STAGE_MARKER],
      perChunkTimeoutMs: 90_000,
      timeoutMs: 150_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: argv,
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      envelope: findEnvelope(run.stdout ?? run.output),
    };
    assert.ok(
      stripAnsi(this.lastRun.stderr).includes(NARROW_STAGE_MARKER),
      `the run must have reached the "${NARROW_STAGE}" stage; the progress ` +
        `region was:\n${progressScreen(this).join("\n")}`,
    );
    narrowRuns.set(cacheKey, this.lastRun);
  },
);

Then(
  "each setup stage should appear exactly once in the progress region",
  function (this: JollyWorld) {
    const rows = stageRows(this);
    const screen = progressScreen(this).join("\n");
    const repeated: string[] = [];
    for (const stage of allStages()) {
      const naming = rows.filter((row) =>
        new RegExp(`\\b${stage}\\b`, "i").test(row),
      );
      if (naming.length > 1) repeated.push(`${stage} (${naming.length} rows)`);
    }
    assert.deepEqual(
      repeated,
      [],
      `a live progress region redraws each stage in place, so every stage holds ` +
        `one row however narrow the terminal; these stages hold more than one: ` +
        `${repeated.join(", ")}. Screen was:\n${screen}`,
    );
  },
);

Then("no stage row should appear twice on screen", function (this: JollyWorld) {
  const rows = stageRows(this);
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row, (seen.get(row) ?? 0) + 1);
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(
    duplicated.map(([row, count]) => `${JSON.stringify(row)} x${count}`),
    [],
    `the progress region redraws in place, so no stage row is left standing ` +
      `twice on the screen the human is looking at. Screen was:\n` +
      progressScreen(this).join("\n"),
  );
});

Then(
  "the storefront stage's row should occupy exactly one terminal line",
  function (this: JollyWorld) {
    const columns = narrowColumns(this);
    const screen = progressScreen(this);
    const index = screen.findIndex(
      (line) =>
        new RegExp(`\\b${NARROW_STAGE}\\b`, "i").test(line) &&
        STAGE_STATUS_MARKER.test(line),
    );
    assert.ok(
      index >= 0,
      `the progress region must show a "${NARROW_STAGE}" stage row; screen was:\n${screen.join("\n")}`,
    );
    assert.ok(
      screen[index]!.length <= columns,
      `the "${NARROW_STAGE}" row must fit the ${columns}-column terminal; it ran ` +
        `to ${screen[index]!.length} columns: ${JSON.stringify(screen[index])}`,
    );
    // A description too wide is shortened, not wrapped, so the row's own text
    // does not continue onto the line below it.
    const description = catalogMessage(NARROW_STAGE_KEY);
    const tail = description.slice(Math.max(0, description.length - 12));
    const next = screen[index + 1] ?? "";
    assert.ok(
      !next.includes(tail),
      `the "${NARROW_STAGE}" description must be shortened rather than wrapped, ` +
        `but its tail ${JSON.stringify(tail)} continues on the next line: ` +
        `${JSON.stringify(next)}`,
    );
  },
);

Then("the row should still name the storefront stage", function (this: JollyWorld) {
  const screen = progressScreen(this);
  const row = screen.find(
    (line) =>
      new RegExp(`\\b${NARROW_STAGE}\\b`, "i").test(line) &&
      STAGE_STATUS_MARKER.test(line),
  );
  assert.ok(
    row,
    `shortening must not cost the stage its name: no row on the ` +
      `${narrowColumns(this)}-column screen names "${NARROW_STAGE}". Screen was:\n${screen.join("\n")}`,
  );
});

// ─── Ctrl-C during the unattended stages (feature 027) ─────────────────────
// The human interrupts a running setup stage. Both scenarios are on-screen
// claims, so the run is driven on ONE merged PTY — the single terminal a human
// watches — and the assertions read the rendered screen (support/terminal-screen)
// rather than the byte stream: the live progress region redraws by cursor-up and
// erase, so the stream carries every draft of a row and only the screen says
// which one survived.
//
// The interrupt is a real SIGINT: `\x03` written to the PTY master is the byte a
// terminal driver turns into SIGINT for the foreground process group, exactly as
// a keyboard Ctrl-C does. It is fed only once the running stage's own
// description is OBSERVED, so "while a setup stage is running" is a fact of the
// run and not a hope about its timing.

/** The running description of the stage the interrupt lands on. */
const INTERRUPTED_STAGE = "store";
const INTERRUPTED_STAGE_KEY = "start.stage.store";
// The leading, unwrapped part of the catalog message: clack wraps at the 80-column
// PTY width, so a marker spanning a wrap point would never be observed as one
// substring.
const INTERRUPTED_STAGE_MARKER = "creating your Saleor store";

/** The screen the human is left with, and where the interrupt landed on it. */
function interruptedScreen(world: JollyWorld): {
  lines: string[];
  stageRow: number;
} {
  const lines = renderTerminal(world.lastRun!.stdout);
  const stageRow = lines.findIndex(
    (line) =>
      new RegExp(`\\b${INTERRUPTED_STAGE}\\b`, "i").test(line) &&
      STAGE_STATUS_MARKER.test(line),
  );
  assert.ok(
    stageRow >= 0,
    `the interrupted run's screen must still show the "${INTERRUPTED_STAGE}" stage row; screen was:\n${lines.join("\n")}`,
  );
  return { lines, stageRow };
}

/** Everything the run printed after the interrupt landed. */
function afterInterrupt(world: JollyWorld): string {
  const out = stripAnsi(world.lastRun!.stdout);
  const index = out.lastIndexOf(INTERRUPTED_STAGE_MARKER);
  assert.ok(
    index >= 0,
    `the run must have reached the "${INTERRUPTED_STAGE}" stage; got:\n${out}`,
  );
  return out.slice(index);
}

When(
  "the user presses Ctrl-C while a setup stage is running",
  { timeout: 170_000 },
  function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    // Copy drift in the marker would silently move the interrupt to a different
    // moment, so it is checked against the catalog the stage renders from.
    assert.ok(
      catalogMessage(INTERRUPTED_STAGE_KEY).includes(INTERRUPTED_STAGE_MARKER),
      `the interrupt marker "${INTERRUPTED_STAGE_MARKER}" is no longer part of the ` +
        `"${INTERRUPTED_STAGE_KEY}" catalog message — update it so the interrupt still ` +
        `lands while that stage is running`,
    );
    const argv = (this.notes.startArgv as string[]) ?? ["start"];
    const sequence = startPromptSequence({ argv, cwd: this.projectDir });
    const run = runUnderPty({
      runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
      argv: [CLI_ENTRY, ...argv],
      cwd: this.projectDir,
      // A real-format stand-in staff token satisfies start's auth gate without a
      // real sign-in, so the run reaches its setup stages (as the live-progress
      // scenarios above drive it).
      env: interactiveChildEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }),
      // Accept every prompt, then send SIGINT when the stage is observed running.
      inputs: [...acceptEveryPrompt(sequence), "\x03"],
      waitFor: [...sequence, INTERRUPTED_STAGE_MARKER],
      // The interrupt must make the CLI exit on its own; the read ends at EOF, so
      // a run that swallows SIGINT hits the ceiling and reds rather than passing.
      readUntil: "exit",
      perChunkTimeoutMs: 90_000,
      timeoutMs: 150_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: argv,
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
      envelope: findEnvelope(run.output),
    };
    this.notes.interruptStillRunning = run.stillRunning;

    // The interrupt must actually have stopped the run, or this scenario is not
    // this scenario: a run that ignores SIGINT reaches its last stage and closes
    // normally, and the terminal it leaves behind is the UNINTERRUPTED one. Every
    // assertion downstream would then pass without the behaviour it names. The
    // run is known interrupted when the stages beyond the interrupted one never
    // ran — `stripe` is the last stage the uninterrupted flow reaches.
    const screen = renderTerminal(run.output);
    const reachedLastStage = screen.some(
      (line) => /\bstripe\b/i.test(line) && /[✓✗]/.test(line),
    );
    assert.ok(
      !reachedLastStage,
      `Ctrl-C during the "${INTERRUPTED_STAGE}" stage must stop the run, but it carried on ` +
        `to its last stage and closed normally, so the interrupt had no effect. Screen was:\n${screen.join("\n")}`,
    );
  },
);

// Every setup stage the run plans, in the order the catalog declares them. The
// prompts precede the unattended stages, so `init` and `auth` are the preflight
// pair the interrupt scenario's Rule distinguishes from the side-effecting
// stages that follow — `store` is the stage the interrupt lands on.
const PREFLIGHT_STAGES = ["init", "auth"];
const CLOSE_SIDE_EFFECTING_STAGES = [
  "store",
  "storefront",
  "recipe",
  "stock",
  "deploy",
  "stripe",
];

/**
 * The stage names a close sentence reports as unfinished, read out of the
 * catalog's own `start.close.notFinished` template so a copy edit moves this
 * reader with it rather than silently matching nothing.
 */
function closeNamedStages(text: string): string[] | undefined {
  const head = catalogMessage("start.close.notFinished").split("{reasons}")[0]!;
  const pattern = head
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace("\\{stages\\}", "(.+?)")
    .replace("\\{stageWord\\}", "\\S+");
  const match = new RegExp(pattern).exec(text);
  if (!match) return undefined;
  return match[1]!
    .split(/,\s*/)
    .map((stage) => stage.trim())
    .filter(Boolean);
}

/** The stage names the interrupted run reported as unfinished. */
function interruptNamedStages(world: JollyWorld): string[] {
  const named = closeNamedStages(stripAnsi(world.lastRun!.stdout));
  assert.ok(
    named,
    "the interrupted close must render the catalog's " +
      `"start.close.notFinished" sentence naming the stages that did not ` +
      `complete; screen was:\n${renderTerminal(world.lastRun!.stdout).join("\n")}`,
  );
  return named;
}

Then(
  "the interactive output should name the side-effecting stages that did not finish",
  function (this: JollyWorld) {
    const named = interruptNamedStages(this);
    assert.ok(
      named.length > 0,
      "the interrupted close must name at least one unfinished stage: the run " +
        `was stopped during "${INTERRUPTED_STAGE}", which never completed`,
    );
    const notSideEffecting = named.filter(
      (stage) => !CLOSE_SIDE_EFFECTING_STAGES.includes(stage),
    );
    assert.deepEqual(
      notSideEffecting,
      [],
      `the interrupted close must name only side-effecting stages; it named ` +
        `${JSON.stringify(named)}, and ${JSON.stringify(notSideEffecting)} ` +
        `${notSideEffecting.length === 1 ? "is" : "are"} not side-effecting`,
    );
    assert.ok(
      named.includes(INTERRUPTED_STAGE),
      `the stage the interrupt landed on ("${INTERRUPTED_STAGE}") did not ` +
        `complete, so the close must name it; it named ${JSON.stringify(named)}`,
    );
  },
);

Then(
  "it should not name a preflight stage among the unfinished stages",
  function (this: JollyWorld) {
    const named = interruptNamedStages(this);
    const preflight = named.filter((stage) => PREFLIGHT_STAGES.includes(stage));
    assert.deepEqual(
      preflight,
      [],
      `a preflight stage is not unfinished setup, so the interrupted close must ` +
        `not name one; it named ${JSON.stringify(preflight)} among ` +
        `${JSON.stringify(named)}`,
    );
  },
);

Then(
  "the stages it names should be the same set the normal close would name for that run",
  function (this: JollyWorld) {
    const named = interruptNamedStages(this);
    // The normal close is not re-derived here, it is RUN: the same
    // `interactiveCloseSummary` seam the uninterrupted run closes through is
    // given this run's own observed stage outcomes, and its sentence is read
    // back through the same catalog reader. A reimplementation of the filter
    // would agree with itself and prove nothing.
    const { lines } = interruptedScreen(this);
    const stages = [...PREFLIGHT_STAGES, ...CLOSE_SIDE_EFFECTING_STAGES].map((stage) => {
      const row = lines.find(
        (line) =>
          new RegExp(`\\b${stage}\\b`, "i").test(line) &&
          STAGE_STATUS_MARKER.test(line),
      );
      return {
        stage,
        status: row && /[✓✔]/.test(row) ? "completed" : "pending",
      };
    });
    const closed = interactiveCloseSummary(
      {
        summary: "",
        checks: [],
        nextSteps: [],
        data: { stages },
      } as unknown as Parameters<typeof interactiveCloseSummary>[0],
      { stripeStep: "" },
    );
    const normal = closeNamedStages(closed.summary);
    assert.ok(
      normal,
      "the normal close must render the same catalog sentence for a run with " +
        `unfinished stages; it rendered: ${JSON.stringify(closed.summary)}`,
    );
    assert.deepEqual(
      [...named].sort(),
      [...normal].sort(),
      `both closes answer one question, so the interrupted close must name the ` +
        `same stage set the normal close names for this run: interrupted named ` +
        `${JSON.stringify([...named].sort())}, normal named ` +
        `${JSON.stringify([...normal].sort())}`,
    );
  },
);

Then(
  "the terminal cursor should be visible again after Jolly exits",
  function (this: JollyWorld) {
    const raw = this.lastRun!.stdout;
    // The live progress region hides the cursor while it redraws. Whatever it
    // hides it must restore before exiting, or the human's shell is left with an
    // invisible cursor. The last cursor-visibility toggle the terminal saw is what
    // the human is left with.
    const toggles = [...raw.matchAll(/\x1b\[\?25(l|h)/g)].map((m) => m[1]);
    assert.ok(
      toggles.includes("l"),
      `the interrupted run must have hidden the cursor for its live progress region, ` +
        `otherwise this scenario proves nothing; raw output:\n${JSON.stringify(raw.slice(-2000))}`,
    );
    assert.equal(
      toggles[toggles.length - 1],
      "h",
      `after an interrupt Jolly must restore the terminal cursor before exiting; the last ` +
        `cursor toggle the terminal saw was a hide. Raw tail:\n${JSON.stringify(raw.slice(-2000))}`,
    );
  },
);

Then(
  "the setup-stage progress rows should stay readable, with Jolly's closing line below them rather than drawn over them",
  function (this: JollyWorld) {
    const { lines, stageRow } = interruptedScreen(this);
    // Readable: the stage row survives on screen as text, not as a blanked line.
    assert.ok(
      lines[stageRow]!.trim().length > 0,
      `the "${INTERRUPTED_STAGE}" stage row must stay readable on the final screen; screen was:\n${lines.join("\n")}`,
    );
    // Below, not over: Jolly's closing line is the last thing it writes, and it
    // occupies a row beneath the progress rows rather than overwriting one.
    const closingRow = lines.reduce(
      (last, line, index) => (line.trim().length > 0 ? index : last),
      -1,
    );
    assert.ok(
      closingRow > stageRow,
      `Jolly's closing line must be drawn BELOW the setup-stage progress rows, not over ` +
        `them; the last written row (${closingRow}) is not below the "${INTERRUPTED_STAGE}" ` +
        `stage row (${stageRow}). Screen was:\n${lines.join("\n")}`,
    );
  },
);

Then(
  "the interactive output should name the setup stage that was interrupted",
  function (this: JollyWorld) {
    const closing = afterInterrupt(this);
    assert.match(
      closing,
      new RegExp(`\\b${INTERRUPTED_STAGE}\\b`, "i"),
      `after the interrupt Jolly must name the "${INTERRUPTED_STAGE}" stage it was running; got:\n${closing}`,
    );
  },
);

Then(
  "the interactive output should state that setup was interrupted and did not complete",
  function (this: JollyWorld) {
    const closing = afterInterrupt(this);
    assert.match(
      closing,
      /\b(interrupted|cancelled|canceled|stopped)\b/i,
      `after the interrupt Jolly must state that setup was interrupted; got:\n${closing}`,
    );
    assert.match(
      closing,
      /did not (?:complete|finish)|never (?:completed|finished)|incomplete|unfinished|not complete/i,
      `after the interrupt Jolly must state that setup did not complete; got:\n${closing}`,
    );
  },
);

Then("the exit code should be non-zero", function (this: JollyWorld) {
  // The CLI must exit ITSELF on the interrupt. A run the PTY driver had to kill
  // reports a non-zero code too, so the exit is only evidence once the run is
  // known to have ended on its own.
  assert.equal(
    this.notes.interruptStillRunning,
    false,
    "the interrupted run must exit on its own; it was still running when the read ended",
  );
  assert.notEqual(
    this.lastRun!.exitCode,
    0,
    `an interrupted setup must exit non-zero; got exit ${this.lastRun!.exitCode}`,
  );
});

Then(
  "the run should continue past the auth stage in the same session",
  function (this: JollyWorld) {
    const out = stripAnsi(this.lastRun!.stdout);
    const code = out.match(DEVICE_USER_CODE_RE);
    assert.ok(code, "the run must have shown the device user code");
    const afterAuth = out.slice(out.indexOf(code![0]));
    const sequence = (this.notes.inlineStartSequence as string[]) ?? [];
    assert.ok(
      sequence.length > 0,
      "the inline sign-in run must have recorded its prompt sequence",
    );
    // Continuation in the SAME session: after the grant display, this one run
    // reached every setup prompt of its flow (through the proceed gate), so the
    // auth stage was passed in-session rather than by a re-run.
    for (const marker of sequence) {
      assert.ok(
        afterAuth.includes(marker),
        `after the inline sign-in, the same session must continue to the "${marker}" prompt; got:\n${out}`,
      );
    }
  },
);
