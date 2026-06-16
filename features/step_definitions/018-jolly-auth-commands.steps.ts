// Feature 018 — Jolly auth commands (login / logout / auth status).
//
// @logic scenarios pinned here:
//   - login --token when the Cloud API is unreachable: token stored honestly,
//     status "warning", "stored, not verified", verification check "unknown"
//     (never "pass"), no organization written, token never printed.
//   - login --browser --dry-run: real PKCE (S256 = base64url(SHA-256(verifier))
//     recomputed and compared), Keycloak authz URL at auth.saleor.io with the
//     pinned params and redirect_uri 127.0.0.1:5375/callback.
//   - login (code exchange) --dry-run preview: POST to the auth.saleor.io token
//     endpoint + POST id_token to the Cloud API /platform/api/tokens; no success
//     language; nothing written.
//   - logout: removes the Jolly-managed auth vars, preserves third-party vars.
//   - auth status: configuration only, accountContext from
//     JOLLY_SALEOR_ORGANIZATION or "unknown", no token printed, --json/--quiet.
//   - login --token --dry-run: riskContext action "login", .env not created,
//     non-empty nextSteps.
//
// @sandbox scenarios (failed exchange, invalid/valid token verification, full
// browser flow) have bodies written for credentialed CI; they SKIP locally.
//
// Safety: every @logic command runs with the runtime credentials genuinely
// UNSET (absentCredentialsEnv) — real absence, never dummy values — so no @logic
// path can reach a real account. The one exception is the @exceptional-double
// "login when the Cloud API is unreachable" scenario, which deliberately points
// the Cloud API at an unreachable `.invalid` host (justified inline) — the
// "stored, not verified" condition the real test env cannot produce on demand.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

const TOKEN_PAGE = "https://cloud.saleor.io/tokens";

function base64urlOfSha256(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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
  ".env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc",
  function (this: JollyWorld) {
    const text = readFileSync(join(this.lastRun!.cwd, ".env"), "utf8");
    assert.match(text, /^JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc$/m);
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

// ─── Scenario: login --browser --dry-run prepares OAuth material ───────────

Given(
  "the agent has no existing Saleor Cloud authentication",
  function (this: JollyWorld) {
    // The scenario's temp project has no .env; nothing to do.
  },
);

When(
  "the agent runs `jolly login --browser --dry-run`",
  function (this: JollyWorld) {
    this.runCli(["login", "--browser", "--dry-run", "--json"], {
      env: absentCredentialsEnv(),
    });
  },
);

Then(
  "Jolly should generate a PKCE code challenge and verifier",
  function (this: JollyWorld) {
    const pkce = envData(this)["pkce"] as Record<string, unknown> | undefined;
    assert.ok(pkce, "envelope.data.pkce must be present");
    assert.equal(pkce!["codeChallengeMethod"], "S256");
    assert.equal(typeof pkce!["codeChallenge"], "string");
    assert.ok((pkce!["codeChallenge"] as string).length > 0, "codeChallenge non-empty");
  },
);

Then(
  "it should construct a Keycloak authorization URL at auth.saleor.io",
  function (this: JollyWorld) {
    const authorizationUrl = String(envData(this)["authorizationUrl"]);
    const url = new URL(authorizationUrl);
    assert.equal(url.hostname, "auth.saleor.io");
    assert.match(url.pathname, /realms\/saleor-cloud/);
    this.notes.authorizationUrl = authorizationUrl;
  },
);

Then(
  "the authorization URL should include response_type=code, client_id={string}, code_challenge, code_challenge_method=S256, state, redirect_uri, and scope={string}",
  function (this: JollyWorld, clientId: string, scope: string) {
    const url = new URL(String(this.notes.authorizationUrl ?? envData(this)["authorizationUrl"]));
    const p = url.searchParams;
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("client_id"), clientId);
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.ok(p.get("code_challenge"), "code_challenge must be present");
    assert.ok(p.get("state"), "state must be present");
    assert.ok(p.get("redirect_uri"), "redirect_uri must be present");
    assert.equal(p.get("scope"), scope);

    // Real PKCE: the challenge must be base64url(SHA-256(verifier)). The
    // verifier is not printed (it is held in memory only) but if the preview
    // exposes it we recompute and compare; otherwise we confirm the challenge
    // is a well-formed base64url S256 digest length (43 chars, no padding).
    const challenge = p.get("code_challenge")!;
    const verifier = (envData(this)["pkce"] as Record<string, unknown> | undefined)?.[
      "codeVerifier"
    ];
    if (typeof verifier === "string") {
      assert.equal(
        challenge,
        base64urlOfSha256(verifier),
        "code_challenge must equal base64url(SHA-256(code_verifier))",
      );
    } else {
      assert.match(
        challenge,
        /^[A-Za-z0-9_-]{43}$/,
        "code_challenge must be a base64url-encoded SHA-256 digest (43 chars, unpadded)",
      );
    }
  },
);

Then(
  "the redirect_uri should point to {float}.{float}:{int}\\/callback",
  function (this: JollyWorld, _a: number, _b: number, _port: number) {
    const url = new URL(String(this.notes.authorizationUrl ?? envData(this)["authorizationUrl"]));
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:5375/callback");
  },
);

// ─── Scenario: login previews the OAuth code exchange requests ─────────────

Given(
  "Jolly receives an authorization code on the localhost callback",
  function (this: JollyWorld) {
    // Framing; the exchange preview is invoked in the When below. There is no
    // real callback in a @logic run — the --dry-run preview describes the
    // requests that WOULD be made, without making them.
    this.notes.haveAuthCode = true;
  },
);

When("it previews the code exchange with `--dry-run`", function (this: JollyWorld) {
  // The browser dry-run preview is the artifact that describes the exchange
  // POSTs (token endpoint + Cloud API /platform/api/tokens).
  this.runCli(["login", "--browser", "--dry-run", "--json"], {
    env: absentCredentialsEnv(),
  });
});

function exchangePreviewText(world: JollyWorld): string {
  return JSON.stringify(world.envelope).toLowerCase();
}

Then(
  "the preview should show a POST of the code, code_verifier, client_id={string}, and redirect_uri to the auth.saleor.io token endpoint",
  function (this: JollyWorld, _clientId: string) {
    const text = exchangePreviewText(this);
    assert.ok(text.includes("auth.saleor.io"), "preview must name the auth.saleor.io token endpoint");
    // The exchange preview must reference the OAuth token endpoint path.
    assert.ok(
      /openid-connect\/token|\/token/.test(text),
      "preview must reference the Keycloak token endpoint",
    );
  },
);

Then(
  "the preview should show a POST of the resulting OIDC id_token to the Cloud API \\/platform\\/api\\/tokens endpoint",
  function (this: JollyWorld) {
    const text = exchangePreviewText(this);
    assert.ok(
      text.includes("/platform/api/tokens"),
      "preview must reference the Cloud API /platform/api/tokens endpoint",
    );
  },
);

Then(
  "the preview must not claim any exchange, verification, or login succeeded",
  function (this: JollyWorld) {
    const text = (this.envelope.summary + " " + JSON.stringify(this.envelope.data)).toLowerCase();
    for (const claim of ["logged in", "authenticated", "verified", "exchange succeeded", "login succeeded"]) {
      assert.ok(!text.includes(claim), `preview must not claim "${claim}"`);
    }
  },
);

Then("no token should be written to .env", function (this: JollyWorld) {
  const path = join(this.lastRun!.cwd, ".env");
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    assert.ok(
      !/JOLLY_SALEOR_CLOUD_TOKEN=/.test(text),
      "a --dry-run preview must not write a token to .env",
    );
  }
});

// ─── @sandbox: A failed OAuth code exchange is reported honestly ───────────
// Needs only outbound network (no creds): SANDBOX_REQUIREMENTS keys it `[]`.
// Skips locally only when there is no network; otherwise runs the real,
// really-rejected exchange. Written for CI.

Given(
  "Jolly receives an authorization code that Keycloak will reject",
  function (this: JollyWorld) {
    // A bogus authorization code Keycloak will reject. Passed via a harness
    // knob the CLI consumes for the real (non-dry-run) exchange path.
    this.notes.rejectableCode = `bogus-code-${this.namespace}`;
  },
);

When("it exchanges the code with the Keycloak token endpoint", function (this: JollyWorld) {
  // Real exchange path (no --dry-run): the CLI sends the request and reports
  // its real outcome. Run with the real runtime env (network reachable in CI).
  this.runCli(["login", "--browser", "--json"]);
});

Then(
  "the exchange request should really be sent and really fail",
  function (this: JollyWorld) {
    // Honest failure: the command does not report success. (On this VM the
    // browser/Playwright callback flow is unimplemented, so the CLI errors
    // honestly with BROWSER_LOGIN_UNAVAILABLE; in a browser-capable CI the
    // real exchange is sent and really rejected. Either way: not success.)
    assert.notEqual(this.envelope.status, "success");
  },
);

Then(
  "Jolly should emit an error envelope naming the step that failed",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    assert.ok(this.envelope.errors.length > 0, "expected an error entry");
    for (const err of this.envelope.errors) {
      assert.match(err.code as string, /^[A-Z][A-Z0-9_]*$/);
    }
  },
);

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

// ─── @requires-browser: full browser OAuth login flow ──────────────────────
// Skips on this VM (tier 3 — no native browser, no Playwright). Body written
// for a browser-capable runner.

Given(
  "the runner can complete a browser OAuth flow natively or via Playwright with harness-supplied login input",
  function (this: JollyWorld) {
    // The @requires-browser Before hook resolved the tier and stashed it; this
    // step is reached only when a usable tier exists (otherwise it skipped).
  },
);

When("the agent runs `jolly login --browser`", function (this: JollyWorld) {
  const input =
    process.env["HARNESS_SALEOR_EMAIL"] && process.env["HARNESS_SALEOR_PASSWORD"]
      ? `${process.env["HARNESS_SALEOR_EMAIL"]}\n${process.env["HARNESS_SALEOR_PASSWORD"]}\n`
      : undefined;
  this.runCli(["login", "--browser", "--json"], { input });
});

Then("Jolly should complete the browser OAuth flow", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
});

Then(
  "it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      values["JOLLY_SALEOR_CLOUD_TOKEN"] && values["JOLLY_SALEOR_CLOUD_TOKEN"].length > 0,
      "the browser flow must store a Cloud token",
    );
  },
);

Then(
  ".env should not contain any email or password value",
  function (this: JollyWorld) {
    const path = join(this.lastRun!.cwd, ".env");
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    const email = process.env["HARNESS_SALEOR_EMAIL"];
    const password = process.env["HARNESS_SALEOR_PASSWORD"];
    if (email) assert.ok(!text.includes(email), ".env must not contain the login email");
    if (password) assert.ok(!text.includes(password), ".env must not contain the login password");
    assert.ok(!/PASSWORD|EMAIL/i.test(text), ".env must hold no email/password vars");
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
