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
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { findEnvelope } from "../support/envelope.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

// Bombshell (@clack/prompts) renders its prompts with these box-drawing and
// symbol glyphs. clack re-renders incrementally, so the prompt TEXT does not
// linearize in the raw PTY byte stream, but these glyphs survive — they are the
// reliable signal that an interactive prompt UI was shown (vs. the plain agent
// path, which prints none).
const CLACK_GLYPH = /[│┌└◆◇◻◼●○◐◓◑◒▪]/u;

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
// available (the caller then skips).
function runInteractive(
  world: JollyWorld,
  argv: string[],
  inputs: string[],
  overrides: Record<string, string | undefined> = {},
): boolean {
  if (!ptyAvailable()) return false;
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, ...argv],
    cwd: world.projectDir,
    env: interactiveChildEnv(overrides),
    inputs,
    inputDelayMs: 600,
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

// Press Enter at every prompt: a generous run of carriage returns. Extra Enters
// after the last prompt are written past child exit and harmlessly dropped.
const ENTER_AT_EVERY_PROMPT = ["\r", "\r", "\r", "\r", "\r", "\r"];

// ─── Unsupported command: fail clearly, name the supported surface ─────────

When("the agent runs `jolly frobnicate --json`", function (this: JollyWorld) {
  this.runCli(["frobnicate", "--json"], { env: absentCredentialsEnv() });
});

// Every supported command, exactly as the scenario names them. "auth status" is
// the two-word subcommand; the rest are single tokens.
const SUPPORTED_COMMANDS = [
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

Then(
  "the error should name the supported commands login, logout, auth status, init, start, doctor, upgrade, skills, create, and completion",
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
  "the script should reference the supported commands login, logout, init, start, doctor, upgrade, skills, and create",
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
    for (const command of ["login", "logout", "init", "start", "doctor", "upgrade", "skills", "create"]) {
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

function startArgvWithMock(world: JollyWorld): string[] {
  const base = (world.notes.startArgv as string[]) ?? ["start"];
  if (!world.notes.noMock && world.notes.mockOrgs) {
    return [...base, `--mock-organizations=${String(world.notes.mockOrgs)}`];
  }
  return base;
}

When(
  "the user presses Enter at every prompt",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    if (!runInteractive(this, startArgvWithMock(this), ENTER_AT_EVERY_PROMPT)) {
      return "skipped";
    }
  },
);

When(
  "the user declines the confirmation before the first side-effecting stage",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // Accept the config prompts (environment name, project directory) with Enter,
    // then decline the side-effecting confirmation with `n` (clack confirm
    // submits immediately on `n`).
    if (!runInteractive(this, startArgvWithMock(this), ["\r", "\r", "n"])) {
      return "skipped";
    }
  },
);

When(
  "`jolly start --dry-run --yes` runs in an interactive terminal and receives no input",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    if (!runInteractive(this, ["start", "--dry-run", "--yes"], [])) return "skipped";
  },
);

When(
  "`jolly start --dry-run --json` runs in an interactive terminal",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    if (!runInteractive(this, ["start", "--dry-run", "--json"], [])) return "skipped";
  },
);

function resolvedConfig(world: JollyWorld): {
  organization?: string;
  availableOrganizations: string[];
  organizationPrompted: boolean;
} {
  const data = world.envelope.data as { resolved?: Record<string, unknown> };
  assert.ok(data.resolved, "interactive start must report the resolved configuration in data.resolved");
  return data.resolved as never;
}

Then("Jolly should present interactive setup prompts", function (this: JollyWorld) {
  assert.ok(
    CLACK_GLYPH.test(this.lastRun!.stdout),
    `interactive start must render Bombshell prompts; got: ${this.lastRun!.stdout}`,
  );
});

Then(
  "the previewed plan should equal the plan from `jolly start --dry-run --yes --json`",
  function (this: JollyWorld) {
    const previewed = (this.envelope.data as { plan?: unknown }).plan;
    assert.ok(previewed, "the interactive preview must carry a plan");
    // The non-interactive --yes --json plan, under the same credential-absent env
    // and project directory, so only the run mode differs.
    this.runCli(["start", "--dry-run", "--yes", "--json"], { env: absentCredentialsEnv() });
    const expected = (this.envelope.data as { plan?: unknown }).plan;
    assert.deepEqual(
      previewed,
      expected,
      "the interactively-previewed plan must equal the non-interactive --yes --json plan",
    );
  },
);

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

Then(
  "Jolly should prompt the human to choose between organizations {string} and {string}",
  function (this: JollyWorld, a: string, b: string) {
    const resolved = resolvedConfig(this);
    assert.equal(
      resolved.organizationPrompted,
      true,
      "Jolly must prompt for the organization when the token resolves more than one",
    );
    for (const org of [a, b]) {
      assert.ok(
        resolved.availableOrganizations.includes(org),
        `the organization choice must offer "${org}"; got ${resolved.availableOrganizations.join(", ")}`,
      );
    }
  },
);

Then(
  "the previewed plan should target the organization the human accepted by default",
  function (this: JollyWorld) {
    const resolved = resolvedConfig(this);
    assert.equal(
      resolved.organization,
      resolved.availableOrganizations[0],
      "accepting the default must target the first (default) organization",
    );
  },
);

Then("Jolly should not prompt for an organization", function (this: JollyWorld) {
  const resolved = resolvedConfig(this);
  assert.equal(
    resolved.organizationPrompted,
    false,
    "Jolly must not prompt for an organization when the token resolves exactly one",
  );
});

Then(
  "the previewed plan should target organization {string}",
  function (this: JollyWorld, org: string) {
    const resolved = resolvedConfig(this);
    assert.equal(resolved.organization, org, `the plan must target organization "${org}"`);
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

Then("Jolly should complete without blocking for any prompt", function (this: JollyWorld) {
  assert.equal(
    this.lastRun!.exitCode,
    0,
    `--yes must complete without blocking; exit ${this.lastRun!.exitCode}`,
  );
  assert.ok(this.envelope, "the run must emit an envelope");
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

Then(
  "the overall envelope status should be {string}",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
  },
);

// RegExp: in a Cucumber expression `(...)` marks an optional group, which would
// drop the stage list from the matched text.
Then(
  /^the side-effecting stages \(store, storefront, recipe, deployment\) should be reported as pending or blocked-on-a-gate, never as passed$/,
  function (this: JollyWorld) {
    const stages = (this.envelope.data as { stages?: Array<{ stage: string; status: string }> }).stages ?? [];
    // "deployment" in the scenario is the "deploy" stage id.
    const sideEffecting = ["store", "storefront", "recipe", "deploy"];
    const blockedOrPending = new Set(["pending", "blocked", "awaiting-approval"]);
    for (const name of sideEffecting) {
      const stage = stages.find((s) => s.stage === name);
      assert.ok(stage, `the plan must report the "${name}" stage`);
      assert.ok(
        blockedOrPending.has(stage!.status),
        `the "${name}" stage must be pending or blocked-on-a-gate after declining, never passed; got "${stage!.status}"`,
      );
      assert.notEqual(stage!.status, "completed", `the "${name}" stage must not be reported as passed`);
    }
  },
);

Then("Jolly must not print a fabricated URL or verification result", function (this: JollyWorld) {
  const data = this.envelope.data as { store?: unknown; deploy?: unknown };
  assert.ok(!data.store, "declining must not surface a fabricated provisioned-store result");
  assert.ok(!data.deploy, "declining must not surface a fabricated deployment result");
});
