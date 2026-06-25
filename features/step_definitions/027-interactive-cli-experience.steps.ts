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
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
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
  "the user declines the proceed confirmation",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // No Cloud token configured, so interactive start authenticates inline first
    // (the loopback stand-in reached via STAND_IN_TOKEN), accept the env-name and
    // project-directory defaults with Enter, then decline the single proceed
    // confirmation with `n` (clack confirm submits on `n`).
    if (
      !runInteractive(this, startArgvWithMock(this), [
        `${STAND_IN_TOKEN}\r`,
        "\r",
        "\r",
        "n",
      ])
    ) {
      return "skipped";
    }
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
    assert.doesNotMatch(
      out,
      /\b(verified|verification (?:passed|succeeded)|store is ready|environment[^\n]*ready)\b/i,
      `declining must not print a fabricated verification result; got:\n${out}`,
    );
  },
);
