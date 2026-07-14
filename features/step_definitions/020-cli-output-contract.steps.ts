// Feature 020 — Jolly CLI output contract.
//
// These @logic scenarios pin the structural envelope contract every command
// shares (command/status/summary/data/checks/nextSteps/errors; camelCase;
// checks vocabulary; stable error codes; no secret values). They assert SHAPE,
// not any one command's specific check-ids or codes, so they hold regardless
// of which command produces the envelope.
//
// Safety: every command here runs with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence, never dummy values — so no side-effecting
// path can reach a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHECK_STATUSES,
  ENVELOPE_STATUSES,
} from "../support/envelope.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { acceptEveryPrompt, startPromptSequence } from "../support/start-prompts.ts";
import { findEnvelope } from "../support/envelope.ts";
import {
  enumerateErrorEnvelopeSites,
  findErrorEnvelopeRecoveryViolations,
  type ErrorEnvelopeSite,
} from "../support/error-envelope-conformance.ts";
import type { InjectedSource, Violation } from "../support/module-conformance.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

// Real-format secret value used purely as a redaction probe: passed as command
// input and asserted never to be echoed. Not a credential for any real service.
const REDACTION_PROBE_CLOUD_TOKEN = "saleor-cloud-token-redaction-probe";

// SGR colour escape (e.g. \x1b[31m) and emoji ranges. Human terminal output may
// carry colour and restrained emoji; machine (--json), --quiet, and non-TTY
// output must not.
const ANSI_COLOUR = /\x1b\[[0-9;]*m/;
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// Run `jolly <argv>` under a real kernel PTY so stdout is a genuine terminal
// (process.stdout.isTTY === true). doctor renders no prompt, so no input is fed.
// Records the terminal output as the world's last run. Returns false when no PTY
// is available.
function runOnTerminal(world: JollyWorld, argv: string[]): boolean {
  if (!ptyAvailable()) return false;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...absentCredentialsEnv() })) {
    if (v !== undefined) env[k] = v;
  }
  if (!env.TERM) env.TERM = "xterm-256color";
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, ...argv],
    cwd: world.projectDir,
    env,
    inputs: [],
    timeoutMs: 60_000,
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

// --- Background ------------------------------------------------------------

Given("Jolly is executable via `npx`", function () {
  // Capability statement; exercised concretely by the scenarios below.
});

Given(
  "every command supports `--json`, `--quiet`, and \\(for side-effecting commands) `--dry-run`",
  function () {
    // Capability statement; the flag contract is verified per-scenario.
  },
);

// --- Shared When -----------------------------------------------------------

When("the command completes", function () {
  // The command is invoked in each scenario's Given; nothing to do here.
});

// --- Scenario Outline: Every command emits one envelope on --json stdout ---
//
// The outline substitutes each example command into the When; each row becomes
// a distinct step. The runCli call (previously in a generic Given) now lives in
// the named When, preserving the same envelope-shape assertions below.

When(
  "the agent runs `jolly doctor --json`",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: absentCredentialsEnv() });
  },
);

When(
  "the agent runs `jolly auth status --json`",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { env: absentCredentialsEnv() });
  },
);

When(
  "the agent runs `jolly create store --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--dry-run", "--json"], {
      env: absentCredentialsEnv(),
    });
  },
);

Then(
  "stdout should contain a single JSON envelope and nothing else",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    const trimmed = run.stdout.trim();
    assert.ok(run.envelope, "no envelope found in --json stdout");
    // --json mode: stdout is exactly the envelope (parses whole, no extra text).
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(trimmed);
    }, `--json stdout must be exactly one JSON object, got:\n${run.stdout}`);
    assert.ok(
      parsed && typeof parsed === "object" && "command" in (parsed as object),
      "the sole stdout JSON object must be the envelope",
    );
  },
);

Then(
  "the envelope should include a `command` identifier",
  function (this: JollyWorld) {
    assert.equal(typeof this.envelope.command, "string");
    assert.ok(this.envelope.command.length > 0, "command must be non-empty");
  },
);

Then(
  "the envelope should include a top-level `status` of `success`, `warning`, or `error`",
  function (this: JollyWorld) {
    assert.ok(
      ENVELOPE_STATUSES.includes(this.envelope.status),
      `status ${this.envelope.status} not in ${ENVELOPE_STATUSES.join("|")}`,
    );
  },
);

Then(
  "the envelope should include a human `summary` string",
  function (this: JollyWorld) {
    assert.equal(typeof this.envelope.summary, "string");
    assert.ok(this.envelope.summary.length > 0, "summary must be non-empty");
  },
);

Then(
  "the envelope should include a command-specific `data` object",
  function (this: JollyWorld) {
    const { data } = this.envelope;
    assert.ok(
      data && typeof data === "object" && !Array.isArray(data),
      "data must be an object",
    );
  },
);

Then(
  "the envelope should include a `checks` array",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.checks));
  },
);

Then(
  "the envelope should include a `nextSteps` array",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.nextSteps));
  },
);

Then(
  "the envelope should include an `errors` array that is empty on success",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.errors));
    if (this.envelope.status === "success") {
      assert.equal(
        this.envelope.errors.length,
        0,
        "errors must be empty when status is success",
      );
    }
  },
);

// --- Scenario: Default output is human-friendly and omits the envelope -----
//
// Default mode (no --json) is human-friendly and does NOT carry the machine
// envelope; the envelope appears on stdout only with --json (the agent's
// explicit opt-in to machine output).

When("the agent runs `jolly doctor`", function (this: JollyWorld) {
  this.runCli(["doctor"], { env: absentCredentialsEnv() });
});

Then(
  "stdout should contain human-readable check results",
  function (this: JollyWorld) {
    const stdout = this.lastRun!.stdout;
    // Human-readable: doctor names checks with their status, not as raw JSON.
    assert.ok(
      /\bdoctor\b/.test(stdout),
      `default doctor output must read as human text; got:\n${stdout}`,
    );
    assert.match(
      stdout,
      /\[(pass|fail|warning|skip|ok|error)\]/i,
      `default doctor output must show human-readable check results; got:\n${stdout}`,
    );
  },
);

Then(
  "stdout should not contain a JSON envelope",
  function (this: JollyWorld) {
    assert.equal(
      findEnvelope(this.lastRun!.stdout),
      undefined,
      `default mode must omit the machine envelope from stdout; got:\n${this.lastRun!.stdout}`,
    );
  },
);

Then(
  "the JSON envelope should appear on stdout only when `--json` is passed",
  function (this: JollyWorld) {
    // The default run already proved the envelope is absent; the same command
    // with --json must carry exactly the envelope.
    const defaultRun = this.lastRun!;
    assert.equal(
      findEnvelope(defaultRun.stdout),
      undefined,
      "default mode must omit the envelope",
    );
    this.runCli(["doctor", "--json"], { env: absentCredentialsEnv() });
    assert.ok(
      this.lastRun!.envelope,
      "the envelope must appear on stdout when --json is passed",
    );
  },
);

// --- Scenario: --quiet stays silent on a successful run --------------------
// `jolly start --dry-run` previews the plan (status success, no side effects);
// under --quiet a successful run prints nothing on either stream.

When(
  "the agent runs `jolly start --dry-run --quiet`",
  function (this: JollyWorld) {
    this.runCli(["start", "--dry-run", "--quiet"], { env: absentCredentialsEnv() });
  },
);

Then("stderr should be empty", function (this: JollyWorld) {
  assert.equal(
    this.lastRun!.stderr.trim(),
    "",
    `stderr must be empty on a successful --quiet run; got:\n${this.lastRun!.stderr}`,
  );
});

// --- Scenario: --quiet reports only the problem on a failed run ------------
// A refused non-first-party `--url` fails pre-flight; under --quiet the failure
// and its stable code go to stderr only, with no stdout and no envelope.

When(
  /^the agent runs `jolly create store --url https:\/\/evil\.example\.com\/graphql\/ --quiet`$/,
  function (this: JollyWorld) {
    const env = (this.notes.urlGuardEnv as Record<string, string | undefined>)
      ?? absentCredentialsEnv();
    this.runCli(
      ["create", "store", "--url", "https://evil.example.com/graphql/", "--quiet"],
      { env },
    );
  },
);

Then(
  "stderr should name the failure and the stable code `NON_FIRST_PARTY_HOST`",
  function (this: JollyWorld) {
    const stderr = this.lastRun!.stderr;
    assert.ok(
      stderr.includes("NON_FIRST_PARTY_HOST"),
      `--quiet must print the stable code NON_FIRST_PARTY_HOST to stderr; got:\n${stderr}`,
    );
    assert.ok(
      stderr.includes("evil.example.com"),
      `--quiet must name the refused host on stderr; got:\n${stderr}`,
    );
  },
);

// --- Scenario: Human output is colourful in a terminal and plain when not --
// Colour appears only in human terminal output: present when stdout is a real
// terminal, absent when stdout is a pipe and under --json.

When("`jolly doctor` runs in an interactive terminal", function (this: JollyWorld) {
  assert.ok(runOnTerminal(this, ["doctor"]), "the interactive terminal run must start");
});

Then("stdout should contain ANSI colour codes", function (this: JollyWorld) {
  assert.match(
    this.lastRun!.stdout,
    ANSI_COLOUR,
    `human terminal output must carry ANSI colour; got:\n${this.lastRun!.stdout}`,
  );
});

When(
  "the agent runs `jolly doctor` with stdout not a terminal",
  function (this: JollyWorld) {
    this.runCli(["doctor"], { env: absentCredentialsEnv() });
  },
);

Then("stdout should contain no ANSI colour codes", function (this: JollyWorld) {
  assert.doesNotMatch(
    this.lastRun!.stdout,
    ANSI_COLOUR,
    `non-terminal stdout must carry no ANSI colour; got:\n${this.lastRun!.stdout}`,
  );
});

Then(
  "`jolly doctor --json` stdout should contain no ANSI colour codes",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: absentCredentialsEnv() });
    assert.doesNotMatch(
      this.lastRun!.stdout,
      ANSI_COLOUR,
      `--json stdout must carry no ANSI colour; got:\n${this.lastRun!.stdout}`,
    );
  },
);

// --- Scenario: Machine output carries no colour or emoji -------------------

Then(
  "the stdout envelope should contain no ANSI colour codes",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "expected a --json envelope on stdout");
    assert.doesNotMatch(
      this.lastRun!.stdout,
      ANSI_COLOUR,
      `--json stdout must carry no ANSI colour; got:\n${this.lastRun!.stdout}`,
    );
  },
);

Then(
  "the stdout envelope should contain no emoji",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "expected a --json envelope on stdout");
    assert.doesNotMatch(
      this.lastRun!.stdout,
      EMOJI,
      `--json stdout must carry no emoji; got:\n${this.lastRun!.stdout}`,
    );
  },
);

// --- Scenario: Progress is shown in place on stderr, never on the result stream ---
//
// The output contract (Rule "Output envelope principles"): the result goes to
// stdout (the human summary), while progress and status chatter go to stderr and
// update IN PLACE, so piping stdout stays clean. To observe the split, `jolly
// start` runs under THREE real PTYs (support/pty.ts separateStreams) — each of
// stdin/stdout/stderr a genuine terminal — so stdout and stderr are captured
// distinctly. The run uses absentCredentialsEnv (real credential absence), so no
// real account is reached; the high-risk stages attempt and fail fast under the
// missing credentials while their progress still renders. Enter advances each
// pre-filled prompt and confirms the proceed gate, so the run reaches the stages.
//
// In-place progress redraws the same region: a carriage return, cursor-up, or
// erase-line control. A line-per-update implementation carries none of these.
const IN_PLACE_PROGRESS = /\r|\x1b\[[0-9]*[AK]/;
// Braille frames are the spinner glyphs a Bombshell/ora-style spinner cycles.
const SPINNER_GLYPH = /[⠀-⣿]/u;

// Run `jolly start` interactively with stdout and stderr on separate PTYs, so the
// progress contract's stream split is observable. Records the captured streams as
// the world's last run. Returns false when no PTY is available (caller skips).
function runStartSeparated(world: JollyWorld): boolean {
  if (!ptyAvailable()) return false;
  const argv = (world.notes.startArgv as string[]) ?? ["start"];
  const env: Record<string, string> = {};
  // A real-format stand-in staff token in the environment satisfies start's auth
  // gate (interactive start signs in through the device grant only when NO auth
  // is configured, feature 018/027), so the run reaches the gates and stages
  // without a real sign-in; it resolves no organizations, which start handles.
  for (const [k, v] of Object.entries({
    ...process.env,
    ...absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }),
  })) {
    if (v !== undefined) env[k] = v;
  }
  if (!env.TERM) env.TERM = "xterm-256color";
  // Enter advances each pre-filled prompt (environment name, project dir) and
  // confirms the proceed gate, so the side-effecting stages are reached. Each
  // Enter is fed when its prompt is observed, never on a guessed delay.
  const sequence = startPromptSequence({ argv, cwd: world.projectDir });
  const run = runUnderPty({
    runtime: process.env.HARNESS_CLI_RUNTIME ?? "node",
    argv: [CLI_ENTRY, ...argv],
    cwd: world.projectDir,
    env,
    inputs: acceptEveryPrompt(sequence),
    waitFor: sequence,
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
  "progress for the long stages should be shown on stderr",
  { timeout: 160_000 },
  function (this: JollyWorld) {
    // The shared When ("`jolly start` runs in an interactive terminal") only
    // records the argv; perform the separated-stream run here.
    assert.ok(runStartSeparated(this), "the separated-stream interactive run must start");
    const stderr = this.lastRun!.stderr;
    assert.ok(
      stderr.trim().length > 0,
      `interactive start must write progress to stderr; it was empty. stdout was:\n${this.lastRun!.stdout}`,
    );
    assert.match(
      stderr,
      IN_PLACE_PROGRESS,
      `start progress must render live on stderr (carriage-return / cursor control); got:\n${JSON.stringify(stderr)}`,
    );
    return undefined;
  },
);

Then(
  "the progress should update in place rather than appending one line per update",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stderr,
      IN_PLACE_PROGRESS,
      "progress must redraw in place (carriage-return / cursor control), not append one line per update",
    );
  },
);

Then(
  "stdout should carry no progress or spinner text",
  function (this: JollyWorld) {
    const stdout = this.lastRun!.stdout;
    assert.doesNotMatch(
      stdout,
      IN_PLACE_PROGRESS,
      `the result stream (stdout) must stay clean — no in-place progress redraws; got:\n${JSON.stringify(stdout)}`,
    );
    assert.doesNotMatch(
      stdout,
      SPINNER_GLYPH,
      `stdout must carry no spinner glyphs; got:\n${JSON.stringify(stdout)}`,
    );
  },
);

Then(
  "`jolly start --json` should show no progress on stdout",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    this.runCli(["start", "--json"], { env: absentCredentialsEnv() });
    const stdout = this.lastRun!.stdout;
    assert.ok(
      this.lastRun!.envelope,
      `jolly start --json must emit the envelope on stdout; got:\n${stdout}`,
    );
    assert.doesNotMatch(
      stdout,
      IN_PLACE_PROGRESS,
      `--json stdout must carry no progress; got:\n${JSON.stringify(stdout)}`,
    );
    assert.doesNotMatch(
      stdout,
      SPINNER_GLYPH,
      `--json stdout must carry no spinner glyphs; got:\n${JSON.stringify(stdout)}`,
    );
  },
);

// --- Scenario: Commands that run checks reuse the doctor vocabulary --------
//
// The `Given the agent runs `jolly doctor --json`` precondition reuses the
// identical When defined above for the envelope outline (cucumber matches
// Given/When/Then interchangeably) — doctor runs read-only checks and with the
// credentials unset yields fail/unknown checks (never a fabricated pass) but a
// well-formed checks array.

When("it reports check results in the envelope", function () {
  // Already produced by the Given.
});

Then("each check should appear in a `checks` array", function (this: JollyWorld) {
  assert.ok(Array.isArray(this.envelope.checks));
  assert.ok(this.envelope.checks.length > 0, "doctor must report checks");
});

Then("each check should carry a stable check id", function (this: JollyWorld) {
  for (const check of this.envelope.checks) {
    assert.equal(typeof check.id, "string");
    assert.ok(check.id.length > 0, "check id must be non-empty");
  }
});

Then(
  "each check `status` should be one of pass, warning, fail, skipped, or unknown",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      assert.ok(
        CHECK_STATUSES.includes(check.status),
        `check ${check.id} status ${check.status} not in vocabulary`,
      );
    }
  },
);

Then(
  "each check should be able to carry a concrete next command or manual step",
  function (this: JollyWorld) {
    // Capability: guidance is available on failing/warning checks, either on
    // the check itself or via nextSteps. Assert the channel exists.
    assert.ok(
      Array.isArray(this.envelope.nextSteps),
      "nextSteps channel must exist for guidance",
    );
    const actionable = this.envelope.checks.filter(
      (c) => c.status === "fail" || c.status === "warning",
    );
    for (const check of actionable) {
      const hasGuidance =
        "command" in check ||
        "remediation" in check ||
        "manualStep" in check ||
        "nextStep" in check ||
        this.envelope.nextSteps.length > 0;
      assert.ok(
        hasGuidance,
        `actionable check ${check.id} should offer a next command or manual step`,
      );
    }
  },
);

// --- Scenario: Agent branches on stable codes ------------------------------

Given(
  "the agent runs `jolly login --json` with an invalid JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    // A present-but-invalid staff token is verified for real against the Cloud
    // API and really rejected (401/403), yielding an error envelope with a
    // stable INVALID_TOKEN code the agent can branch on. Real bad input — no
    // account is reached — so it stays a safe @logic check.
    const token = `invalid-${this.namespace}-token`;
    this.trackSecret(token);
    this.runCli(["login", "--json"], {
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: token }),
    });
  },
);

When("the agent inspects the envelope", function () {
  // The failing command already ran.
});

Then(
  "each entry in `errors` should include a stable `code`, a `message`, and a `remediation`",
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "success",
      "a failed/partial command must not report success",
    );
    assert.ok(this.envelope.errors.length > 0, "expected at least one error");
    for (const error of this.envelope.errors) {
      assert.equal(typeof error.code, "string");
      assert.ok((error.code as string).length > 0, "error code non-empty");
      assert.equal(typeof error.message, "string");
      assert.equal(
        typeof error.remediation,
        "string",
        `error ${error.code} must carry a remediation`,
      );
      assert.ok(
        (error.remediation as string).length > 0,
        `error ${error.code} remediation non-empty`,
      );
    }
  },
);

Then(
  "the documented `code` and check id strings should remain stable so the agent can branch on them programmatically",
  function (this: JollyWorld) {
    // Stable codes are machine identifiers: uppercase/underscore, no spaces.
    for (const error of this.envelope.errors) {
      assert.match(
        error.code as string,
        /^[A-Z][A-Z0-9_]*$/,
        `error code "${error.code}" should be a stable machine identifier`,
      );
    }
  },
);

// --- Scenario: Doctor's error envelope carries the recovery -----------------
//
// Doctor's failing checks are diagnostic: a check can fail with nothing to run.
// The envelope still owes the agent its recovery, so this drives a real doctor
// run whose token is present-but-invalid (really rejected by the Cloud API) and
// asserts the recovery on the envelope it actually emitted.

Given(
  "the agent runs `jolly doctor --json` with an invalid JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const token = `invalid-${this.namespace}-token`;
    this.trackSecret(token);
    this.runCli(["doctor", "--json"], {
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: token }),
    });
  },
);

Then(
  "the envelope should carry at least one `nextSteps` entry naming what to do next",
  function (this: JollyWorld) {
    const steps = this.envelope.nextSteps;
    assert.ok(Array.isArray(steps), "envelope must carry a nextSteps channel");
    assert.ok(
      steps.length > 0,
      "an error envelope must carry at least one nextSteps entry",
    );
    for (const step of steps) {
      const description = String(step.description ?? "");
      assert.ok(
        description.trim().length > 0,
        `nextSteps entry must name what to do next: ${JSON.stringify(step)}`,
      );
    }
  },
);

// --- Scenario: A Cloud API error carries the recovery whatever its code -----
//
// A non-limit rejection of an environment creation is an ordinary failure the
// real Cloud API produces from real bad input, so it is produced for real: the
// run asks the real Cloud API to create an environment under a domain label the
// Cloud API rejects as invalid. The rejection is real, it names a code other
// than ENVIRONMENT_LIMIT_REACHED, and it creates nothing — no double, and no
// dependence on what happens to be standing in the org.

Given(
  "the Cloud API rejects an environment creation with a code other than `ENVIRONMENT_LIMIT_REACHED`",
  function (this: JollyWorld) {
    this.notes.rejectedDomainLabel = `Invalid Label ${this.namespace}!!`;
  },
);

// --- Scenario: Every error envelope carries the recovery --------------------
//
// An error envelope carries its own recovery: at least one `nextSteps` entry,
// and a `remediation` on every `errors` entry. The agent that hit the error then
// has everything it needs to act, in the reply it already has.
//
// The envelopes Jolly "can emit" are enumerated from the construction code
// rather than by driving each failure path, because failures Jolly cannot be
// made to take at will (a Cloud API 500, an environment-limit rejection) would
// otherwise go unchecked. The enumeration covers BOTH construction seams: every
// errorEnvelope(...) call, and every envelope({...}) call whose status is not
// literally success or warning (the doctor envelope computes its status, so it
// can emit an error and is enumerated as one).

Given("Jolly's error-envelope construction code", function (this: JollyWorld) {
  assert.ok(
    existsSync(CLI_ENTRY),
    "the production source (src/index.ts) must exist to check",
  );
});

When("the error envelopes it can emit are enumerated", function (this: JollyWorld) {
  this.notes.errorEnvelopeSites = enumerateErrorEnvelopeSites();
  this.notes.errorEnvelopeViolations = findErrorEnvelopeRecoveryViolations();
});

Then(
  "each should carry at least one `nextSteps` entry naming what to do next",
  function (this: JollyWorld) {
    const sites = this.notes.errorEnvelopeSites as ErrorEnvelopeSite[];
    assert.ok(
      sites.length > 0,
      "no error-envelope construction site was found — the enumeration is not reading Jolly's construction code",
    );
    const missing = (this.notes.errorEnvelopeViolations as Violation[]).filter(
      (violation) => violation.message.includes("no `nextSteps` entry"),
    );
    assert.equal(
      missing.length,
      0,
      `error envelopes constructed with no nextSteps entry (${missing.length} of ${sites.length} sites):\n${missing
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "each `errors` entry should carry a `remediation`",
  function (this: JollyWorld) {
    // Two scenarios share this step text and each supplies its own subject.
    // The live-envelope scenario ran a real failing command; the @property
    // scenario enumerated the construction sites. Assert against whichever
    // subject the scenario's When established — never vacuously.
    const violations = this.notes.errorEnvelopeViolations as
      | Violation[]
      | undefined;
    if (violations === undefined) {
      const errors = this.envelope.errors;
      assert.ok(
        errors.length > 0,
        "an error envelope must carry at least one errors entry",
      );
      for (const error of errors) {
        const remediation = error.remediation;
        assert.equal(
          typeof remediation,
          "string",
          `error ${error.code} must carry a remediation`,
        );
        assert.ok(
          (remediation as string).trim().length > 0,
          `error ${error.code} remediation must be non-empty`,
        );
      }
      return;
    }
    const missing = violations.filter(
      (violation) => violation.message.includes("no `remediation`"),
    );
    assert.equal(
      missing.length,
      0,
      `errors entries carrying no remediation:\n${missing
        .map((violation) => `  - ${violation.message}`)
        .join("\n")}`,
    );
  },
);

Then(
  "an error envelope constructed with an empty `nextSteps`, or with an error carrying no `remediation`, should redden the check",
  function (this: JollyWorld) {
    // The planted red: two virtual sources, never written to disk, each breaking
    // one half of the recovery contract. A check that cannot go red proves
    // nothing about the envelopes that pass it.
    const emptyNextSteps: InjectedSource = {
      file: "src/.planted-empty-next-steps.ts",
      text: `export function plantedEmptyNextSteps() {
  return errorEnvelope("planted", "Planted failure.", [
    { code: "PLANTED_EMPTY_NEXT_STEPS", message: "Planted.", remediation: "Planted remediation." },
  ], { nextSteps: [] });
}`,
    };
    const noRemediation: InjectedSource = {
      file: "src/.planted-no-remediation.ts",
      text: `export function plantedNoRemediation() {
  return errorEnvelope("planted", "Planted failure.", [
    { code: "PLANTED_NO_REMEDIATION", message: "Planted." },
  ], { nextSteps: [{ description: "Planted next step." }] });
}`,
    };

    const reddened = findErrorEnvelopeRecoveryViolations([
      emptyNextSteps,
      noRemediation,
    ]);
    assert.ok(
      reddened.some(
        (violation) =>
          violation.file === emptyNextSteps.file &&
          violation.message.includes("no `nextSteps` entry"),
      ),
      "an error envelope constructed with an empty nextSteps did not redden the check",
    );
    assert.ok(
      reddened.some(
        (violation) =>
          violation.file === noRemediation.file &&
          violation.message.includes("no `remediation`"),
      ),
      "an error carrying no remediation did not redden the check",
    );
  },
);

Then(
  "an error envelope whose `nextSteps` are supplied for only some error codes, and empty for the rest, should redden the check",
  function (this: JollyWorld) {
    // The second planted red: recovery keyed on the error code, so one code is
    // served and every other code gets nothing. Both shapes an envelope can wear
    // are planted — the ternary on the code, and the by-code lookup with an empty
    // fallback — because each supplies the steps for only some codes and leaves
    // the rest empty. Neither is an empty array literal at the call site, so a
    // check that only reads literals would pass them both.
    const codeTernary: InjectedSource = {
      file: "src/.planted-code-keyed-next-steps.ts",
      text: `export function plantedCodeKeyedNextSteps(code: string) {
  return errorEnvelope("planted", "Planted failure.", [
    { code, message: "Planted.", remediation: "Planted remediation." },
  ], {
    nextSteps:
      code === "PLANTED_KNOWN_CODE"
        ? [{ description: "Planted next step." }]
        : [],
  });
}`,
    };
    const codeLookup: InjectedSource = {
      file: "src/.planted-lookup-next-steps.ts",
      text: `const PLANTED_STEPS_BY_CODE: Record<string, Array<{ description: string }>> = {
  PLANTED_KNOWN_CODE: [{ description: "Planted next step." }],
};
export function plantedLookupNextSteps(code: string) {
  return errorEnvelope("planted", "Planted failure.", [
    { code, message: "Planted.", remediation: "Planted remediation." },
  ], { nextSteps: PLANTED_STEPS_BY_CODE[code] ?? [] });
}`,
    };

    const reddened = findErrorEnvelopeRecoveryViolations([
      codeTernary,
      codeLookup,
    ]);
    for (const planted of [codeTernary, codeLookup]) {
      assert.ok(
        reddened.some(
          (violation) =>
            violation.file === planted.file &&
            violation.message.includes("no `nextSteps` entry"),
        ),
        `an error envelope supplying nextSteps for only some error codes did not redden the check (${planted.file})`,
      );
    }
  },
);

// --- Scenario: Output never exposes secrets --------------------------------

// Run a secret-handling command in default, --json, and --quiet modes,
// asserting in each mode that the tracked secret never leaks. The probe secret
// is passed as command input and tracked explicitly. Assertions are unchanged
// from the prior scenario; the loop just exercises every mode named in the step.
function assertNoLeakAcrossModes(
  world: JollyWorld,
  baseArgs: string[],
): void {
  // login reads the staff token from JOLLY_SALEOR_CLOUD_TOKEN. The probe is
  // configured as that env secret — real bad input — so login genuinely
  // processes it (verification is rejected or unreachable) and must reference
  // it by name only, never echo it.
  for (const mode of [[], ["--json"], ["--quiet"]]) {
    world.runCli([...baseArgs, ...mode], {
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_TOKEN: REDACTION_PROBE_CLOUD_TOKEN,
      }),
    });
    world.assertNoSecretsIn(world.lastRun!.stdout, "stdout");
    world.assertNoSecretsIn(world.lastRun!.stderr, "stderr");
  }
}

When(
  "the agent runs `jolly login` in default, `--json`, and `--quiet` modes",
  function (this: JollyWorld) {
    this.trackSecret(REDACTION_PROBE_CLOUD_TOKEN);
    assertNoLeakAcrossModes(this, ["login"]);
  },
);

Then(
  "no human text, nor any field of the envelope when one is emitted, should contain the secret value",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    this.assertNoSecretsIn(run.stdout, "stdout");
    this.assertNoSecretsIn(run.stderr, "stderr");
  },
);

Then(
  "the secret should be referenced by name only",
  function (this: JollyWorld) {
    // Reaffirm no value leaked across the modes run in this scenario.
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  },
);

// --- Scenario: Jolly's request code contacts only first-party hosts ---------
//
// The first-party-hosts allowlist is a security contract: Jolly's own
// request-sending code contacts ONLY cloud.saleor.io, the customer's
// *.saleor.cloud domains, and github.com, plus any JOLLY_SALEOR_CLOUD_API_URL
// override. To make "the hosts it can contact" enumerable and "exactly"
// assertable, Jolly declares the allowlist in one canonical module
// (src/lib/hosts.ts) that the request layer honors — the enumeration reads that
// declaration. Neither api.vercel.com nor api.stripe.com is first-party: Vercel
// is reached only by the spawned Vercel CLI, and api.stripe.com only by the
// Saleor Stripe app Jolly installs, so neither host appears in Jolly's own
// request code; this and the
// retired id.saleor.online / api.saleor.cloud are checked by scanning the whole
// of src (Jolly's code). Long Then patterns use RegExp so Cucumber Expressions
// don't mis-parse a dotted host literal as a {float}.{float} param.

/** Concatenate every TypeScript file under src (Jolly's own code) for scanning. */
function allSrcText(): string {
  const root = join(REPO_ROOT, "src");
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return parts.join("\n");
}

const EXPECTED_FIRST_PARTY_HOSTS = [
  "cloud.saleor.io",
  "auth.saleor.io",
  "github.com",
].sort();

Given("Jolly's own network-request-sending code", function (this: JollyWorld) {
  this.notes.srcText = allSrcText();
});

When("the hosts it can contact are enumerated", async function (this: JollyWorld) {
  // The canonical allowlist Jolly's request layer declares. Imported
  // dynamically so a missing declaration fails ONLY this scenario (not the
  // whole step-file load).
  try {
    this.notes.hostsModule = await import("../../src/lib/hosts.ts");
  } catch (err) {
    this.notes.hostsImportError = err instanceof Error ? err.message : String(err);
  }
});

Then(
  /^they should be exactly cloud\.saleor\.io, auth\.saleor\.io, the customer's `\*\.saleor\.cloud` domains, and github\.com, plus any `JOLLY_SALEOR_CLOUD_API_URL` or `JOLLY_SALEOR_AUTH_URL` override$/,
  function (this: JollyWorld) {
    const mod = this.notes.hostsModule as
      | { FIRST_PARTY_HOSTS?: unknown; isFirstPartyHost?: (h: string) => boolean }
      | undefined;
    assert.ok(
      mod,
      "Jolly must declare its first-party host allowlist in a canonical module " +
        `(src/lib/hosts.ts) so contactable hosts are enumerable; import failed: ${String(
          this.notes.hostsImportError,
        )}`,
    );
    // The fixed exact hosts must be exactly the declared set.
    const declared = mod!.FIRST_PARTY_HOSTS;
    assert.ok(Array.isArray(declared), "FIRST_PARTY_HOSTS must be an array of host strings");
    assert.deepEqual(
      [...(declared as string[])].sort(),
      EXPECTED_FIRST_PARTY_HOSTS,
      "the declared fixed first-party hosts must be exactly the allowlist",
    );
    // The *.saleor.cloud domains and the JOLLY_SALEOR_CLOUD_API_URL override are
    // covered by the predicate, not the fixed list.
    const isFirstParty = mod!.isFirstPartyHost;
    assert.equal(typeof isFirstParty, "function", "hosts module must export isFirstPartyHost");
    assert.ok(isFirstParty!("demo.saleor.cloud"), "a customer's *.saleor.cloud domain must be first-party");
    assert.ok(isFirstParty!("any-store.eu.saleor.cloud"), "any *.saleor.cloud domain must be first-party");
    // The override host is honored when JOLLY_SALEOR_CLOUD_API_URL is set.
    const prev = process.env["JOLLY_SALEOR_CLOUD_API_URL"];
    try {
      process.env["JOLLY_SALEOR_CLOUD_API_URL"] = "https://cloud.example.test/platform/api";
      assert.ok(
        isFirstParty!("cloud.example.test"),
        "the JOLLY_SALEOR_CLOUD_API_URL override host must be first-party",
      );
    } finally {
      if (prev === undefined) delete process.env["JOLLY_SALEOR_CLOUD_API_URL"];
      else process.env["JOLLY_SALEOR_CLOUD_API_URL"] = prev;
    }
    // The auth-host override host is honored when JOLLY_SALEOR_AUTH_URL is set:
    // the device + refresh grant may be redirected (proxy/self-routing), the same
    // affordance as JOLLY_SALEOR_CLOUD_API_URL for the Cloud API.
    const prevAuth = process.env["JOLLY_SALEOR_AUTH_URL"];
    try {
      process.env["JOLLY_SALEOR_AUTH_URL"] =
        "https://auth.example.test/realms/saleor-cloud";
      assert.ok(
        isFirstParty!("auth.example.test"),
        "the JOLLY_SALEOR_AUTH_URL override host must be first-party",
      );
    } finally {
      if (prevAuth === undefined) delete process.env["JOLLY_SALEOR_AUTH_URL"];
      else process.env["JOLLY_SALEOR_AUTH_URL"] = prevAuth;
    }
    // Non-first-party hosts are rejected: Vercel and Stripe are reached only by
    // their own spawned CLIs, never by Jolly's own request code.
    assert.equal(isFirstParty!("api.vercel.com"), false, "api.vercel.com must NOT be first-party");
    assert.equal(isFirstParty!("api.stripe.com"), false, "api.stripe.com must NOT be first-party");
  },
);

Then(
  /^neither api\.vercel\.com nor api\.stripe\.com should appear in Jolly's own request code — Vercel is reached only by the spawned Vercel CLI, and api\.stripe\.com only by the Saleor Stripe app that Jolly installs via Saleor GraphQL `appInstall`$/,
  function (this: JollyWorld) {
    const src = String(this.notes.srcText);
    assert.ok(
      !src.includes("api.vercel.com"),
      "api.vercel.com must not appear in Jolly's own code — Vercel is reached only by the spawned Vercel CLI",
    );
    assert.ok(
      !src.includes("api.stripe.com"),
      "api.stripe.com must not appear in Jolly's own code — api.stripe.com is reached only by the Saleor Stripe app installed via Saleor GraphQL appInstall",
    );
  },
);

Then(
  /^the retired hosts id\.saleor\.online and api\.saleor\.cloud should not appear anywhere in Jolly's code or output$/,
  function (this: JollyWorld) {
    const src = String(this.notes.srcText);
    for (const retired of ["id.saleor.online", "api.saleor.cloud"]) {
      assert.ok(
        !src.includes(retired),
        `the retired host ${retired} must not appear anywhere in Jolly's code`,
      );
    }
  },
);

// --- Scenario: Jolly refuses a request to a non-first-party host ------------
//
// Pre-flight enforcement (the "First-party hosts only" rule): a customer-
// supplied `--url` whose host is not first-party must be REFUSED before any
// request is sent, with the stable code NON_FIRST_PARTY_HOST naming the host.
// The refusal is pre-flight (before any request is sent), so even a guard bug
// could only ever reach the customer-supplied evil.example.com `--url` host, never
// a real Saleor account; the token is a stand-in. The reused "nothing should be
// written to .env" step (feature 005) confirms the refusal path is side-effect-free.

Given("a Saleor Cloud token is configured", function (this: JollyWorld) {
  // A Cloud token is present (a stand-in value), so the refusal below fires
  // pre-flight on the --url host — not because auth is missing.
  this.notes.urlGuardEnv = absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN });
});

When(
  /^the agent runs `jolly create store --url https:\/\/evil\.example\.com\/graphql\/ --json`$/,
  function (this: JollyWorld) {
    const env = (this.notes.urlGuardEnv as Record<string, string | undefined>)
      ?? absentCredentialsEnv();
    this.runCli(
      [
        "create",
        "store",
        "--url",
        "https://evil.example.com/graphql/",
        "--json",
      ],
      { env },
    );
  },
);

Then(
  "the envelope status should be {string} with the stable code `NON_FIRST_PARTY_HOST`",
  function (this: JollyWorld, status: string) {
    assert.equal(
      this.envelope.status,
      status,
      `envelope status must be "${status}" when a non-first-party host is refused`,
    );
    const codes = this.envelope.errors.map((e) => e.code);
    assert.ok(
      codes.includes("NON_FIRST_PARTY_HOST"),
      `errors[] must carry the stable code NON_FIRST_PARTY_HOST; got ${JSON.stringify(codes)}`,
    );
  },
);

Then(
  "the error message should name the refused host evil.example.com",
  function (this: JollyWorld) {
    const refusal = this.envelope.errors.find(
      (e) => e.code === "NON_FIRST_PARTY_HOST",
    );
    assert.ok(refusal, "expected a NON_FIRST_PARTY_HOST error entry");
    assert.ok(
      String(refusal!.message).includes("evil.example.com"),
      `the error message must name the refused host evil.example.com; got: ${String(refusal!.message)}`,
    );
  },
);

// --- Scenario: An unexpected internal error surfaces as a stable envelope ----
//
// An unexpected internal throw (feature 020 Rule) must be caught at the top level
// (main()'s try/catch around dispatch, src/index.ts) and rendered as the shared
// error envelope with the stable UNEXPECTED_ERROR code, never a raw stack trace on
// stdout. The Given (feature 002 steps) plants a malformed storefront/package.json;
// the narrow `jolly storefront` stage command (feature 029) then parses that
// package.json to approve Paper's build scripts and throws on the malformed JSON —
// the SAME top-level envelope-wrapping code path a full `jolly start` would reach
// through the storefront stage, but induced locally in milliseconds with no cloud,
// so this is a @logic check (no real account is touched: the throw fires before any
// clone/install/network).

When("the agent runs `jolly storefront --json`", function (this: JollyWorld) {
  this.runCli(["storefront", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the envelope status should be {string} with the stable `code` {string}",
  function (this: JollyWorld, status: string, code: string) {
    assert.equal(
      this.envelope.status,
      status,
      `envelope status must be "${status}" for an unexpected internal error; ` +
        `got "${this.envelope.status}"`,
    );
    const codes = this.envelope.errors.map((e) => e.code);
    assert.ok(
      codes.includes(code),
      `errors[] must carry the stable code ${code}; got ${JSON.stringify(codes)}`,
    );
  },
);

Then(
  "the `errors` remediation should tell the agent to re-run with `--json` and report the error code",
  function (this: JollyWorld) {
    const entry =
      this.envelope.errors.find((e) => e.code === "UNEXPECTED_ERROR") ??
      this.envelope.errors[0];
    assert.ok(entry, "expected at least one error entry");
    const remediation = String((entry as { remediation?: unknown }).remediation ?? "");
    assert.match(
      remediation,
      /--json/,
      `remediation must tell the agent to re-run with --json; got: "${remediation}"`,
    );
    assert.match(
      remediation,
      /code/i,
      `remediation must tell the agent to report the error code; got: "${remediation}"`,
    );
  },
);

Then(
  "stdout should carry the JSON envelope rather than a raw stack trace",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    assert.ok(
      run.envelope,
      `stdout must carry the JSON envelope; got:\n${run.stdout}`,
    );
    assert.doesNotMatch(
      run.stdout,
      /\n\s+at\s+.+:\d+:\d+/,
      `stdout must not carry a raw stack trace; got:\n${run.stdout}`,
    );
  },
);

Then("nothing should be written to .env", function (this: JollyWorld) {
  // A refused request must not write any Jolly-managed credential to .env. The
  // strongest form is that the refused command created no .env at all; if one
  // pre-existed, it must carry no JOLLY_ credential the refused command writes.
  const envPath = join(this.lastRun!.cwd, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  assert.ok(
    !/^JOLLY_[A-Z_]+=/m.test(text),
    ".env must carry no Jolly-managed credential after a refused request",
  );
});
