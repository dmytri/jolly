// Feature 018 — Jolly auth commands (login / logout / auth status).
//
// @logic scenarios pinned here:
//   - login --token when the Cloud API is unreachable: token stored honestly,
//     status "warning", "stored, not verified", verification check "unknown"
//     (never "pass"), no organization written, token never printed.
//   - login token sources: --token-file, --token-stdin, $JOLLY_SALEOR_CLOUD_TOKEN,
//     and the interactive paste prompt (real PTY); precedence and empty-source
//     honest errors.
//   - login with no token source in a non-interactive shell: honest error
//     pointing to `jolly login --token <value>`; never prompts or blocks.
//   - logout: removes the Jolly-managed auth vars, preserves third-party vars.
//   - auth status: configuration only, accountContext from
//     JOLLY_SALEOR_ORGANIZATION or "unknown", no token printed, --json/--quiet.
//   - login --token --dry-run: riskContext action "login", .env not created,
//     non-empty nextSteps.
//
// @sandbox scenarios (invalid/valid token verification) have bodies written for
// credentialed CI; they SKIP locally.
//
// Safety: every @logic command runs with the runtime credentials genuinely
// UNSET (absentCredentialsEnv) — real absence, never dummy values — so no @logic
// path can reach a real account. The one exception is the @exceptional-double
// "login when the Cloud API is unreachable" scenario, which deliberately points
// the Cloud API at an unreachable `.invalid` host (justified inline) — the
// "stored, not verified" condition the real test env cannot produce on demand.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

const TOKEN_PAGE = "https://cloud.saleor.io/tokens";
const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// ─── Scenario: login stores a token honestly when verification unreachable ──

Given("the Saleor Cloud API is unreachable", function (this: JollyWorld) {
  // Framing for the @exceptional-double condition: the When points the Cloud
  // API at a deliberately-unreachable host so verification genuinely cannot
  // happen and login must store the token honestly without verifying.
  this.notes.cloudUnreachable = true;
});

Given(
  "the agent has a Saleor Cloud token value {string}",
  function (this: JollyWorld, token: string) {
    this.notes.loginToken = token;
    this.trackSecret(token);
  },
);

When(
  "the agent runs `jolly login --token jolly-login-test-token-abc`",
  function (this: JollyWorld) {
    const token = String(this.notes.loginToken ?? "jolly-login-test-token-abc");
    this.trackSecret(token);
    // Verification cannot happen against a deliberately-unreachable Cloud API, so
    // login must store the token honestly ("stored, not verified").
    // @exceptional-double: a deliberately-unreachable Cloud API host (RFC 6761),
    // the unreachable-service condition the real test env cannot produce on demand.
    const unreachableCloudApi = "https://jolly-unreachable.invalid";
    this.runCli(["login", "--token", token, "--json"], {
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_API_URL: unreachableCloudApi }),
    });
  },
);

Then(
  "Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], String(this.notes.loginToken));
  },
);

Then(
  // Parametrized: the exact stored value varies per scenario (the unreachable
  // "stored, not verified" token, plus the --token-file / --token-stdin / env
  // headless-source tokens). Captures the literal value and asserts the line.
  /^\.env should contain JOLLY_SALEOR_CLOUD_TOKEN=(\S+)$/,
  function (this: JollyWorld, value: string) {
    const text = readFileSync(join(this.lastRun!.cwd, ".env"), "utf8");
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(text, new RegExp(`^JOLLY_SALEOR_CLOUD_TOKEN=${escaped}$`, "m"));
  },
);

Then(
  "the output should state the token was stored, not verified",
  function (this: JollyWorld) {
    const haystack = (
      this.envelope.summary +
      " " +
      JSON.stringify(this.envelope.data)
    ).toLowerCase();
    assert.ok(
      haystack.includes("stored, not verified"),
      `output must say exactly "stored, not verified"; got: ${haystack}`,
    );
  },
);

Then("no check may report the token as verified", function (this: JollyWorld) {
  const verification = this.envelope.checks.find((c) =>
    String(c.id).includes("verification"),
  );
  if (verification) {
    assert.notEqual(
      verification.status,
      "pass",
      "the verification check must not be 'pass' when verification did not happen",
    );
    assert.equal(verification.status, "unknown");
  }
  // No check anywhere may claim a pass for verification.
  for (const check of this.envelope.checks) {
    if (String(check.id).includes("verification")) {
      assert.notEqual(check.status, "pass");
    }
  }
});

Then(
  "no organization name should be written to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      !("JOLLY_SALEOR_ORGANIZATION" in values),
      "no organization should be written when verification did not happen",
    );
  },
);

Then(
  "subsequent `jolly auth status` should report the token is configured",
  function (this: JollyWorld) {
    // Re-run auth status in the SAME project dir (the .env just written), with
    // the env token unset so it can't override the on-disk value (auth status is
    // configuration-only and reads the on-disk .env).
    this.runCli(["auth", "status", "--json"], {
      cwd: this.lastRun!.cwd,
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: undefined }),
    });
    assert.equal(envData(this)["hasCloudToken"], true);
  },
);

// ─── Shared: no existing authentication / no token value in output ──────────

Given(
  "the agent has no existing Saleor Cloud authentication",
  function (this: JollyWorld) {
    // The scenario's temp project has no .env; nothing to do.
  },
);

Then("no token value should appear in the output", function (this: JollyWorld) {
  const text = this.lastRun!.stdout + " " + this.lastRun!.stderr;
  // No real credential value: only var names and bracketed <placeholders> are
  // allowed in the dry-run preview, never an actual token assignment or value.
  assert.ok(
    !/JOLLY_SALEOR_(CLOUD|APP)_TOKEN=\S/.test(text),
    "no token value should be written to the output",
  );
  assert.ok(
    !/"(id_token|access_token|cloud_token)"\s*:\s*"(?!<)/.test(text),
    "no concrete token value should appear in the output",
  );
});

Then("it should not write any value to .env", function (this: JollyWorld) {
  const path = join(this.lastRun!.cwd, ".env");
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    assert.ok(
      !/JOLLY_SALEOR_(CLOUD|APP)_TOKEN=/.test(text),
      "a failed exchange must not write a token to .env",
    );
  }
});

Then(
  "the output should contain no success, verified, or authenticated language",
  function (this: JollyWorld) {
    const text = (this.lastRun!.stdout + " " + this.lastRun!.stderr).toLowerCase();
    for (const claim of ["successfully logged in", "authenticated as", "token verified", "verification succeeded"]) {
      assert.ok(!text.includes(claim), `output must not claim "${claim}"`);
    }
  },
);

// ─── @sandbox: verify a headless token against the Cloud API ───────────────
// saleorCloud-gated; runs in CI with the real token. Written for CI.

Given(
  "the agent provides a valid token from https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "the @sandbox valid-token scenario requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.validToken = token;
    this.trackSecret(token!);
  },
);

When("Jolly validates the token", function (this: JollyWorld) {
  // Real verification against the real Cloud API (no override → cloud.saleor.io).
  this.runCli(["login", "--token", String(this.notes.validToken), "--json"]);
});

Then(
  "it should verify the token with an authenticated read-only request to the Cloud API organizations endpoint",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
    const verification = this.envelope.checks.find((c) =>
      String(c.id).includes("verification"),
    );
    assert.ok(verification, "expected a verification check");
    assert.equal(verification!.status, "pass");
  },
);

Then(
  "it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], String(this.notes.validToken));
  },
);

Then(
  "it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      values["JOLLY_SALEOR_ORGANIZATION"] && values["JOLLY_SALEOR_ORGANIZATION"].length > 0,
      "the real organization name must be stored",
    );
  },
);

Then(
  "it should report the authenticated organization context using values from the real response",
  function (this: JollyWorld) {
    const ctx = envData(this)["accountContext"];
    assert.equal(typeof ctx, "string");
    assert.ok((ctx as string).length > 0, "accountContext must be a real org name");
    assert.notEqual(ctx, "unknown");
  },
);

// ─── @sandbox: login rejects an invalid token gracefully ───────────────────
// saleorCloud requirement is `[]` per SANDBOX_REQUIREMENTS (network only).

Given(
  "the agent provides an invalid or expired token",
  function (this: JollyWorld) {
    this.notes.invalidToken = `invalid-${this.namespace}-token`;
    this.trackSecret(String(this.notes.invalidToken));
  },
);

When("Jolly validates the token against the Cloud API", function (this: JollyWorld) {
  // Real request to the real Cloud API; a bogus token is really rejected 401.
  this.runCli(["login", "--token", String(this.notes.invalidToken), "--json"]);
});

Then(
  "the verification request should really be sent and really be rejected",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    const code = this.envelope.errors[0]?.code;
    assert.equal(code, "INVALID_TOKEN");
  },
);

Then("Jolly should report a clear error message", function (this: JollyWorld) {
  assert.ok(this.envelope.errors.length > 0);
  assert.ok((this.envelope.errors[0].message as string).length > 0);
});

Then(
  "the error message should direct the customer to create a new token at https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.errors) + " " + JSON.stringify(this.envelope.nextSteps);
    assert.ok(text.includes(TOKEN_PAGE), `error guidance must name ${TOKEN_PAGE}`);
  },
);

// ─── Scenario: Agent logs out (generic) ────────────────────────────────────

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token",
  function (this: JollyWorld) {
    // Seed a .env with managed auth vars plus an unrelated third-party var.
    writeFileSync(
      join(this.projectDir, ".env"),
      "JOLLY_SALEOR_CLOUD_TOKEN=some-token\nTHIRD_PARTY_KEY=keep-me\n",
    );
  },
);

When("the agent invokes `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(!("JOLLY_SALEOR_CLOUD_TOKEN" in values), "the managed Cloud token must be removed");
  },
);

Then(
  "any non-JOLLY_ variable in .env should remain unchanged",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["THIRD_PARTY_KEY"], "keep-me", "unrelated vars must be preserved");
  },
);

Then(
  "it should load the updated `.env` values for the current command flow",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
  },
);

// ─── Scenario: Agent checks auth status ────────────────────────────────────

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  // Seed an organization so the accountContext-from-org assertion can hold,
  // then run auth status reading the on-disk .env (configuration-only).
  writeFileSync(
    join(this.projectDir, ".env"),
    "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\nJOLLY_SALEOR_ORGANIZATION=acme-org\n",
  );
  this.runCli(["auth", "status", "--json"], {
    env: absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      JOLLY_SALEOR_ORGANIZATION: undefined,
    }),
  });
});

Then(
  "Jolly should report whether Saleor Cloud authentication is configured",
  function (this: JollyWorld) {
    assert.equal(typeof envData(this)["hasCloudToken"], "boolean");
  },
);

Then(
  "when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context",
  function (this: JollyWorld) {
    assert.equal(envData(this)["accountContext"], "acme-org");
  },
);

Then(
  "when no organization is stored, it should report the account context as unknown rather than failing",
  function (this: JollyWorld) {
    // Re-run in a fresh dir with a token but no org: accountContext "unknown",
    // and the command does not fail.
    const dir = this.newTempDir("no-org");
    writeFileSync(join(dir, ".env"), "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\n");
    this.runCli(["auth", "status", "--json"], {
      cwd: dir,
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_TOKEN: undefined,
        JOLLY_SALEOR_ORGANIZATION: undefined,
      }),
    });
    assert.notEqual(this.envelope.status, "error");
    assert.equal(envData(this)["accountContext"], "unknown");
  },
);

Then("the output should not contain the token value", function (this: JollyWorld) {
  this.trackSecret("seed-token");
  this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
});

Then(
  "it should support `--json` and `--quiet`",
  function (this: JollyWorld) {
    const dir = this.newTempDir("flags");
    writeFileSync(join(dir, ".env"), "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\n");
    const safe = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      JOLLY_SALEOR_ORGANIZATION: undefined,
    });
    this.runCli(["auth", "status", "--json"], { cwd: dir, env: safe });
    assert.ok(this.lastRun!.envelope, "--json must carry the envelope");
    const jsonLen = this.lastRun!.stdout.length;
    this.runCli(["auth", "status", "--quiet"], { cwd: dir, env: safe });
    assert.ok(this.lastRun!.envelope, "--quiet must keep the envelope");
  },
);

// ─── Scenario: login --token --dry-run does not write to .env ──────────────

When(
  "the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`",
  function (this: JollyWorld) {
    this.trackSecret("jolly-dry-run-token");
    this.runCli(
      ["login", "--token", "jolly-dry-run-token", "--dry-run", "--json"],
      { env: absentCredentialsEnv() },
    );
  },
);

Then(
  "the output should include a nextSteps array with at least one step",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.nextSteps));
    assert.ok(this.envelope.nextSteps.length >= 1, "expected at least one nextStep");
  },
);

// ─── Scenario: logout removes only Jolly-managed auth values from .env ──────

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me",
  function (this: JollyWorld) {
    writeFileSync(
      join(this.projectDir, ".env"),
      "JOLLY_SALEOR_CLOUD_TOKEN=some-token\n" +
        "JOLLY_SALEOR_APP_TOKEN=some-app-token\n" +
        "JOLLY_SALEOR_ORGANIZATION=some-org\n" +
        "THIRD_PARTY_KEY=keep-me\n",
    );
  },
);

When("the agent runs `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(!("JOLLY_SALEOR_CLOUD_TOKEN" in values));
    assert.ok(!("JOLLY_SALEOR_APP_TOKEN" in values));
    assert.ok(!("JOLLY_SALEOR_ORGANIZATION" in values));
  },
);

Then("THIRD_PARTY_KEY should remain in .env unchanged", function (this: JollyWorld) {
  const values = loadEnvValues(this.lastRun!.cwd);
  assert.equal(values["THIRD_PARTY_KEY"], "keep-me");
});

Then(
  "subsequent `jolly auth status` should report not authenticated",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], {
      cwd: this.lastRun!.cwd,
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: undefined }),
    });
    assert.equal(envData(this)["hasCloudToken"], false);
  },
);

// ─── Headless token sources: --token-file, --token-stdin, $JOLLY_SALEOR_CLOUD_TOKEN ──
// The non-interactive login sources. The @logic scenarios point the Cloud API
// at a deliberately-unreachable host so login stores the token honestly
// ("stored, not verified") without a verification round-trip.

// @exceptional-double: deliberately-unreachable Cloud API host for the "stored, not verified" path the real test env cannot produce on demand.
const UNREACHABLE_CLOUD_API = "https://jolly-unreachable.invalid";

// Build the child env for a headless-source login. Re-adds a real $JOLLY_SALEOR_
// CLOUD_TOKEN when the scenario set one (the env-source and precedence cases),
// and points the Cloud API at the unreachable host when the scenario declared it.
function headlessLoginEnv(world: JollyWorld): Record<string, string | undefined> {
  const overrides: Record<string, string | undefined> = {};
  if (world.notes.cloudUnreachable) {
    overrides.JOLLY_SALEOR_CLOUD_API_URL = UNREACHABLE_CLOUD_API;
  }
  if (world.notes.envToken !== undefined) {
    overrides.JOLLY_SALEOR_CLOUD_TOKEN = String(world.notes.envToken);
  }
  return absentCredentialsEnv(overrides);
}

Given(
  "a file at .\\/cloud-token.txt contains the token value {string}",
  function (this: JollyWorld, token: string) {
    this.notes.loginToken = token;
    this.notes.tokenFilePath = "./cloud-token.txt";
    this.trackSecret(token);
    // Realistic file shape: trailing newline. Login reads "the token value", so
    // the stored value is the trimmed token, not the raw bytes.
    writeFileSync(join(this.projectDir, "cloud-token.txt"), token + "\n");
  },
);

When(
  "the agent runs `jolly login --token-file .\\/cloud-token.txt`",
  function (this: JollyWorld) {
    this.runCli(["login", "--token-file", "./cloud-token.txt"], {
      env: headlessLoginEnv(this),
    });
  },
);

Given(
  "the token value {string} is provided on standard input",
  function (this: JollyWorld, token: string) {
    this.notes.loginToken = token;
    this.notes.stdinToken = token;
    this.trackSecret(token);
  },
);

When("the agent runs `jolly login --token-stdin`", function (this: JollyWorld) {
  this.runCli(["login", "--token-stdin"], {
    env: headlessLoginEnv(this),
    input: String(this.notes.stdinToken) + "\n",
  });
});

Given(
  "the environment variable JOLLY_SALEOR_CLOUD_TOKEN is set to {string}",
  function (this: JollyWorld, token: string) {
    this.notes.envToken = token;
    this.notes.loginToken = token;
    this.trackSecret(token);
  },
);

// ─── Scenario: no token source in a non-interactive shell fails honestly ────
// Non-TTY subprocess (runCli pipes stdin) with every token source absent: login
// must fail honestly with a stable code that points to `jolly login --token
// <value>`, never prompt and never block waiting for terminal input.

When(
  "the agent runs `jolly login --json` with no token source in a non-interactive shell",
  function (this: JollyWorld) {
    this.runCli(["login", "--json"], { env: absentCredentialsEnv() });
  },
);

Then(
  "it should direct the user to run `jolly login --token <value>`",
  function (this: JollyWorld) {
    const text =
      JSON.stringify(this.envelope.errors) + " " + JSON.stringify(this.envelope.nextSteps);
    assert.ok(
      text.includes("jolly login --token"),
      `login must direct the user to run jolly login --token <value>; got: ${text}`,
    );
  },
);

// ─── Scenario: env-source token in a non-interactive shell ──────────────────
// Non-TTY subprocess with no token flag: login resolves the token from
// $JOLLY_SALEOR_CLOUD_TOKEN and stores it (stored-not-verified against the
// deliberately-unreachable Cloud API), never prompting or blocking on input.

When(
  "the agent runs `jolly login` with no token flag in a non-interactive shell",
  function (this: JollyWorld) {
    this.runCli(["login"], { env: headlessLoginEnv(this) });
  },
);

Then(
  /^the value (\S+) should not appear in \.env$/,
  function (this: JollyWorld, value: string) {
    const path = join(this.lastRun!.cwd, ".env");
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    assert.ok(
      !text.includes(value),
      `the superseded value "${value}" must not appear in .env`,
    );
  },
);

Given(
  "a file at .\\/empty-token.txt that is empty",
  function (this: JollyWorld) {
    writeFileSync(join(this.projectDir, "empty-token.txt"), "");
  },
);

When(
  "the agent runs `jolly login --token-file .\\/empty-token.txt --json`",
  function (this: JollyWorld) {
    this.runCli(["login", "--token-file", "./empty-token.txt", "--json"], {
      env: absentCredentialsEnv(),
    });
  },
);

Then(
  "the envelope status should be \"error\" with a stable `code`",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    assert.ok(this.envelope.errors.length > 0, "expected an error entry");
    assert.match(this.envelope.errors[0].code as string, /^[A-Z][A-Z0-9_]*$/);
  },
);

Then(
  "the error should name the empty token file as the cause",
  function (this: JollyWorld) {
    const reported = (
      JSON.stringify(this.envelope.errors) +
      " " +
      this.envelope.summary
    ).toLowerCase();
    assert.ok(reported.includes("empty"), `error must name the empty file as the cause; got: ${reported}`);
    assert.ok(
      /token[ -]?file|empty-token\.txt/.test(reported),
      `error must identify the token file; got: ${reported}`,
    );
  },
);

// ─── @sandbox: verify a --token-file token against the real Cloud API ──────
// saleorCloud-gated; runs in CI with the real token, skips locally.

Given(
  "a file containing a valid token from https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "the @sandbox valid-token-file scenario requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.validToken = token;
    this.trackSecret(token!);
    const path = join(this.projectDir, "valid-cloud-token.txt");
    writeFileSync(path, token! + "\n");
    this.notes.tokenFilePath = path;
  },
);

When("the agent runs `jolly login --token-file <path>`", function (this: JollyWorld) {
  // Real verification against the real Cloud API (no override → cloud.saleor.io).
  this.runCli(["login", "--token-file", String(this.notes.tokenFilePath), "--json"]);
});

// ─── @property: the .env Jolly writes is private to its owner (mode 600) ────
// The shared .env writer must create the file owner-read/write only. Exercised
// via the stored-not-verified path against the deliberately-unreachable Cloud
// API (the inline @exceptional-double) so the local WRITE is observed without a
// real verify round-trip.

When(
  "the agent runs `jolly login --token jolly-perms-test-token-001`",
  function (this: JollyWorld) {
    const token = String(this.notes.loginToken ?? "jolly-perms-test-token-001");
    this.trackSecret(token);
    this.runCli(["login", "--token", token, "--json"], {
      env: headlessLoginEnv(this),
    });
  },
);

Then(
  /^the \.env file Jolly wrote should be readable and writable only by its owner \(mode 600\)$/,
  function (this: JollyWorld) {
    const path = join(this.lastRun!.cwd, ".env");
    assert.ok(existsSync(path), ".env must have been written");
    const mode = statSync(path).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `.env must be mode 600 (owner read/write only); got ${mode.toString(8)}`,
    );
  },
);

// ─── @property: the .env Jolly writes survives POSIX shell sourcing ─────────
// A value carrying a space and an apostrophe must be quoted so `set -a; . .env`
// sources without error and round-trips the original value. Same stored-not-
// verified path against the unreachable Cloud API.

Given(
  "a file at .\\/odd-token.txt contains the token value {string}",
  function (this: JollyWorld, token: string) {
    this.notes.loginToken = token;
    this.notes.tokenFilePath = "./odd-token.txt";
    this.trackSecret(token);
    writeFileSync(join(this.projectDir, "odd-token.txt"), token + "\n");
  },
);

When(
  "the agent runs `jolly login --token-file .\\/odd-token.txt`",
  function (this: JollyWorld) {
    this.runCli(["login", "--token-file", "./odd-token.txt"], {
      env: headlessLoginEnv(this),
    });
  },
);

Then(
  "sourcing the written .env in a POSIX shell should exit zero",
  function (this: JollyWorld) {
    const result = spawnSync("sh", ["-c", "set -a; . ./.env"], {
      cwd: this.lastRun!.cwd,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `sourcing .env must exit zero; status ${result.status}, stderr: ${result.stderr}`,
    );
  },
);

Then(
  "the value read back for JOLLY_SALEOR_CLOUD_TOKEN should equal {string}",
  function (this: JollyWorld, expected: string) {
    const result = spawnSync(
      "sh",
      ["-c", 'set -a; . ./.env; printf %s "$JOLLY_SALEOR_CLOUD_TOKEN"'],
      { cwd: this.lastRun!.cwd, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `sourcing .env failed: ${result.stderr}`);
    assert.equal(result.stdout, expected);
  },
);

// ─── Scenario: interactive prompt pastes the token when no source is given ──
// The lowest-precedence token source. With no --token-file/--token-stdin/--token
// flag and no $JOLLY_SALEOR_CLOUD_TOKEN, an interactive `jolly login` (stdin a
// TTY) prompts the user to paste the Cloud token and reads it from the terminal
// with echo disabled. Exercised against a REAL kernel PTY (support/pty.ts) — the
// CLI genuinely sees an interactive terminal; nothing about the terminal is
// faked. @exceptional-double: the verify is short-circuited by pointing the
// Cloud API at the unreachable host (stored-not-verified), so the contract under
// test is the local terminal read, not the network verify.

function resolvedChildEnv(
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

Given(
  "`jolly login` runs in an interactive terminal with no token flag and no token in the environment",
  function (this: JollyWorld) {
    // Framing for the When: an interactive (TTY) invocation with no token from
    // any explicit source. The TTY is the real PTY the When allocates; the
    // env-token is absent because the child env unsets every runtime credential.
    this.notes.interactiveLogin = true;
  },
);

When(
  "the user pastes the token value {string} at the prompt",
  { timeout: 45_000 },
  function (this: JollyWorld, token: string) {
    if (!ptyAvailable()) return "skipped";
    this.notes.loginToken = token;
    this.trackSecret(token);
    // No token flag and no env token (absentCredentialsEnv unsets the runtime
    // credentials); the Cloud API points at the deliberately-unreachable host so
    // the pasted token follows the stored-not-verified path.
    const env = resolvedChildEnv(
      absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_API_URL: UNREACHABLE_CLOUD_API }),
    );
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const run = runUnderPty({
      runtime,
      argv: [CLI_ENTRY, "login"],
      cwd: this.projectDir,
      env,
      input: token,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: ["login"],
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
    };
  },
);

Then(
  "Jolly should prompt the user to paste their Saleor Cloud token",
  function (this: JollyWorld) {
    const text = this.lastRun!.stdout.toLowerCase();
    // Must be a prompt to paste the TOKEN at the terminal — not the browser
    // URL-first guidance ("copy and paste it into any browser"), which also
    // mentions paste and --token. Require "paste <your/the/their> [Saleor
    // Cloud] token".
    assert.ok(
      /paste\s+(your|the|their)\s+(saleor\s+cloud\s+)?token/.test(text),
      `the terminal output must prompt the user to paste their Saleor Cloud token; got: ${this.lastRun!.stdout}`,
    );
  },
);

Then(
  "the terminal output should not contain the pasted token value",
  function (this: JollyWorld) {
    const token = String(this.notes.loginToken);
    assert.ok(
      !this.lastRun!.stdout.includes(token),
      "the pasted token must be read with echo disabled and never appear in the terminal output",
    );
  },
);
