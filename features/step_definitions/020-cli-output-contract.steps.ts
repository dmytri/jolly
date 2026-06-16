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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHECK_STATUSES,
  ENVELOPE_STATUSES,
} from "../support/envelope.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

// Real-format secret values used purely as redaction probes: passed as command
// input and asserted never to be echoed. Not credentials for any real service.
const REDACTION_PROBE_CLOUD_TOKEN = "saleor-cloud-token-redaction-probe";
const REDACTION_PROBE_STRIPE_SECRET = "sk_test_redactionprobe";

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

// --- Scenario: Default output combines human text and the envelope ---------

Given(
  "the agent runs `jolly doctor`",
  function (this: JollyWorld) {
    this.runCli(["doctor"], { env: absentCredentialsEnv() });
    this.notes.defaultStdout = this.lastRun!.stdout;
  },
);

Then(
  "stdout should contain human-readable text in addition to the envelope",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    assert.ok(run.envelope, "default mode must still carry the envelope");
    // There must be human text beyond the raw envelope JSON.
    const envelopeJson = JSON.stringify(run.envelope);
    const nonEnvelope = run.stdout
      .replace(envelopeJson, "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      nonEnvelope.length > 0 || /\n/.test(run.stdout),
      "default mode should include human-readable text alongside the envelope",
    );
  },
);

Then(
  "stdout should still include the machine-readable envelope",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "envelope must be present in default mode");
  },
);

Then(
  "running `jolly doctor --quiet` should trim only the human text and still include the envelope",
  function (this: JollyWorld) {
    const defaultStdout = String(this.notes.defaultStdout ?? "");
    this.runCli(["doctor", "--quiet"], { env: absentCredentialsEnv() });
    const quiet = this.lastRun!;
    assert.ok(quiet.envelope, "--quiet must keep the envelope");
    assert.ok(
      quiet.stdout.length <= defaultStdout.length,
      "--quiet output should not be longer than default output",
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
  "the agent runs `jolly login --token {string} --json`",
  function (this: JollyWorld, token: string) {
    // An empty token is junk input: login must fail honestly with an
    // envelope carrying errors[].code, never fabricated success.
    this.runCli(["login", "--token", token, "--json"], { env: absentCredentialsEnv() });
  },
);

When("the agent inspects the envelope", function () {
  // The failing command already ran.
});

Then(
  "each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`",
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
      if ("remediation" in error) {
        assert.equal(typeof error.remediation, "string");
      }
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

// --- Scenario: Output never exposes secrets --------------------------------

// Run a secret-handling command in default, --json, and --quiet modes,
// asserting in each mode that the tracked secret never leaks. The probe secret
// is passed as command input and tracked explicitly. Assertions are unchanged
// from the prior scenario; the loop just exercises every mode named in the step.
function assertNoLeakAcrossModes(
  world: JollyWorld,
  baseArgs: string[],
): void {
  for (const mode of [[], ["--json"], ["--quiet"]]) {
    world.runCli([...baseArgs, ...mode], { env: absentCredentialsEnv() });
    world.assertNoSecretsIn(world.lastRun!.stdout, "stdout");
    world.assertNoSecretsIn(world.lastRun!.stderr, "stderr");
  }
}

When(
  "the agent runs `jolly login --token <value>` in default, `--json`, and `--quiet` modes",
  function (this: JollyWorld) {
    this.trackSecret(REDACTION_PROBE_CLOUD_TOKEN);
    assertNoLeakAcrossModes(this, ["login", "--token", REDACTION_PROBE_CLOUD_TOKEN]);
  },
);

When(
  "the agent runs `jolly create stripe --secret-key <value>` in default, `--json`, and `--quiet` modes",
  function (this: JollyWorld) {
    this.trackSecret(REDACTION_PROBE_STRIPE_SECRET);
    assertNoLeakAcrossModes(this, [
      "create",
      "stripe",
      "--secret-key",
      REDACTION_PROBE_STRIPE_SECRET,
    ]);
  },
);

Then(
  "no field in the envelope or human text should contain the secret value",
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
// request-sending code contacts ONLY auth.saleor.io, cloud.saleor.io, the
// customer's *.saleor.cloud domains, github.com, and 127.0.0.1, plus any
// JOLLY_SALEOR_CLOUD_API_URL override. To make "the hosts it can contact"
// enumerable and "exactly" assertable, Jolly declares the allowlist in one
// canonical module (src/lib/hosts.ts) that the request layer honors — the
// enumeration reads that declaration. Neither api.vercel.com nor api.stripe.com
// is first-party: Vercel is reached only by the spawned Vercel CLI and Stripe
// only by the spawned Stripe CLI, so neither host appears in Jolly's own request
// code; this and the retired id.saleor.online / api.saleor.cloud are checked by
// scanning the whole of src (Jolly's code). Long Then patterns use RegExp so
// Cucumber Expressions don't mis-parse "127.0.0.1" as a {float}.{float} param.

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
  "auth.saleor.io",
  "cloud.saleor.io",
  "github.com",
  "127.0.0.1",
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
  /^they should be exactly auth\.saleor\.io, cloud\.saleor\.io, the customer's `\*\.saleor\.cloud` domains, github\.com, and 127\.0\.0\.1, plus any `JOLLY_SALEOR_CLOUD_API_URL` override$/,
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
    // Non-first-party hosts are rejected: Vercel and Stripe are reached only by
    // their own spawned CLIs, never by Jolly's own request code.
    assert.equal(isFirstParty!("api.vercel.com"), false, "api.vercel.com must NOT be first-party");
    assert.equal(isFirstParty!("api.stripe.com"), false, "api.stripe.com must NOT be first-party");
  },
);

Then(
  /^neither api\.vercel\.com nor api\.stripe\.com should appear in Jolly's own request code — Vercel is reached only by the spawned Vercel CLI, and Stripe only by the spawned Stripe CLI$/,
  function (this: JollyWorld) {
    const src = String(this.notes.srcText);
    assert.ok(
      !src.includes("api.vercel.com"),
      "api.vercel.com must not appear in Jolly's own code — Vercel is reached only by the spawned Vercel CLI",
    );
    assert.ok(
      !src.includes("api.stripe.com"),
      "api.stripe.com must not appear in Jolly's own code — Stripe is reached only by the spawned Stripe CLI",
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
  this.notes.appTokenEnv = absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN });
});

When(
  /^the agent runs `jolly create app-token --url https:\/\/evil\.example\.com\/graphql\/ --json`$/,
  function (this: JollyWorld) {
    const env = (this.notes.appTokenEnv as Record<string, string | undefined>)
      ?? absentCredentialsEnv();
    this.runCli(
      [
        "create",
        "app-token",
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
