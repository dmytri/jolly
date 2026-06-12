// Step definitions for feature 018: Jolly auth commands.
//
// Regenerated fresh from the rewritten spec (Captain pass "honest auth,
// retired hosts", 2026-06-12). The former steps file encoded the retired
// id.saleor.online host and a fully mocked OAuth exchange and was deleted;
// nothing here is restored from it.
//
// CLI contract pinned by these steps (for Crew Mates):
//
//   Token verification (feature 018 Rule "Token verification is a real
//   request or it is not verification"): `jolly login --token <value>`
//   verifies with one authenticated read-only GET of
//   `${apiBase}/organizations/` where apiBase is JOLLY_SALEOR_CLOUD_API_URL
//   or the default https://cloud.saleor.io/platform/api.
//     - 2xx + parseable list → verified: write JOLLY_SALEOR_CLOUD_TOKEN and
//       JOLLY_SALEOR_ORGANIZATION (the REAL organization name from the
//       response — never a placeholder) to .env; check id
//       "login-token-verification" status "pass"; data.organization carries
//       the org name.
//     - 401/403 → status "error", stable code INVALID_TOKEN with numeric
//       `httpStatus`, nothing written to .env, no success/verified/
//       authenticated language, message directs to
//       https://cloud.saleor.io/tokens.
//     - any other failure (unreachable, 5xx, timeout) → token stored, org
//       NOT stored; envelope status "warning"; every surface says exactly
//       "stored, not verified"; check "login-token-verification" status
//       "unknown" — never "pass".
//   Every login execution envelope (success or warning) and the --dry-run
//   preview carry the same riskContext (feature 021).
//
//   Browser OAuth preview: `jolly login --browser --dry-run` emits
//   data.pkceChallenge + data.pkceVerifier (challenge = base64url(SHA-256(
//   verifier))) and data.authUrl — a Keycloak authorization URL on
//   auth.saleor.io (realm saleor-cloud) with response_type=code,
//   client_id=saleor-cli, code_challenge, code_challenge_method=S256,
//   state, redirect_uri=http://127.0.0.1:5375/callback, and
//   scope="email openid profile". No .env write.
//
//   OAuth code exchange: `jolly login --exchange-code <code> --dry-run`
//   previews the two real requests in data.exchangePreview:
//     tokenRequest      = { url: <auth.saleor.io realm token endpoint>,
//                           method: "POST", body: { code, code_verifier,
//                           client_id: "saleor-cli", redirect_uri } }
//     cloudTokenRequest = { url: `${apiBase}/tokens`, method: "POST",
//                           body fields naming id_token (no fabricated
//                           value — the id_token comes from the Keycloak
//                           response at execution time) }
//   The preview never claims any exchange/verification/login happened and
//   writes nothing. Without --dry-run the exchange request is REALLY sent
//   (a fresh verifier is generated when no pending login state exists) and
//   its real outcome reported: on failure, status "error" with stable code
//   OAUTH_EXCHANGE_FAILED carrying numeric `httpStatus` and the `endpoint`
//   on auth.saleor.io, nothing written to .env.
//
//   `jolly auth status` reports CONFIGURATION, not verification: data.
//   hasCloudToken / hasAppToken (booleans, from .env), data.accountContext
//   (JOLLY_SALEOR_ORGANIZATION value, or "unknown" when absent — never an
//   error). It makes no network request and never claims
//   `authenticated: true` for a token that was merely found on disk
//   (feature 020 "No fabricated success").
//
//   `jolly logout` removes exactly the Jolly-managed Saleor auth values
//   (JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN,
//   JOLLY_SALEOR_ORGANIZATION) from .env and preserves everything else.
//
// Safety (012-incident lesson): every @logic run forces dummy credentials
// and an unroutable .invalid Cloud API base via the runCli env override, so
// even a CLI that ignores --dry-run or misroutes requests can never reach a
// real account from the logic tier.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLOUD_API } from "../support/cloud.ts";
import { BROWSER_TIER_NOTE } from "../support/hooks.ts";
import type { BrowserTier } from "../support/browser.ts";
import { assertEnvelopeShape, type Envelope } from "../support/envelope.ts";
import { writeEnvValues, loadEnvValues } from "../../src/lib/env-file.ts";
import type { CliResult, JollyWorld } from "../support/world.ts";

const PLACEHOLDER_ORG = "Saleor Cloud user (authenticated)"; // retired — must never reappear

/** Words that claim an outcome; "stored, not verified" never matches. */
const SUCCESS_CLAIMS = /\b(succeeded|successful|verified|authenticated|exchanged|logged in)\b/i;

function data(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data;
}

/** Unroutable per-scenario Cloud API base (.invalid never resolves). */
function unreachableApiBase(world: JollyWorld): string {
  return `https://${world.namespace}.invalid/platform/api`;
}

/**
 * Env override for @logic auth runs: strip every real credential the test
 * process may hold so the CLI under test cannot reach a real account.
 */
function strippedAuthEnv(
  world: JollyWorld,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    JOLLY_SALEOR_CLOUD_TOKEN: undefined,
    JOLLY_SALEOR_APP_TOKEN: undefined,
    JOLLY_SALEOR_ORGANIZATION: undefined,
    NEXT_PUBLIC_SALEOR_API_URL: undefined,
    JOLLY_SALEOR_CLOUD_API_URL: unreachableApiBase(world),
    ...overrides,
  };
}

function assertNoSuccessClaims(text: string, context: string): void {
  const match = SUCCESS_CLAIMS.exec(text);
  assert.equal(
    match,
    null,
    `${context} must contain no success/verified/authenticated language, found "${match?.[0]}"`,
  );
}

/** No check may claim a verification outcome that did not happen. */
function assertNoVerifiedPassCheck(envelope: Envelope): void {
  for (const check of envelope.checks) {
    const text = `${check.id} ${String(check.description ?? "")}`;
    if (/verif/i.test(text)) {
      assert.notEqual(
        check.status,
        "pass",
        `check "${check.id}" claims verification that did not happen: ${JSON.stringify(check)}`,
      );
    }
  }
}

// ── Scenario: Jolly login stores a token honestly when verification is
//    unreachable (@logic) ───────────────────────────────────────────────────

Given("the Saleor Cloud API is unreachable", function (this: JollyWorld) {
  this.notes["apiBase"] = unreachableApiBase(this);
});

Given(
  "the agent has a Saleor Cloud token value {string}",
  function (this: JollyWorld, token: string) {
    this.notes["tokenValue"] = token;
    this.trackSecret(token);
  },
);

When(
  "the agent runs `jolly login --token jolly-login-test-token-abc`",
  function (this: JollyWorld) {
    this.runCli(["login", "--token", "jolly-login-test-token-abc"], {
      env: strippedAuthEnv(this),
    });
  },
);

Then(
  "Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      typeof values["JOLLY_SALEOR_CLOUD_TOKEN"] === "string" &&
        values["JOLLY_SALEOR_CLOUD_TOKEN"].length > 0,
      ".env should contain JOLLY_SALEOR_CLOUD_TOKEN",
    );
  },
);

Then(
  ".env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], "jolly-login-test-token-abc");
  },
);

Then(
  "the envelope status should be {string}",
  function (this: JollyWorld, status: string) {
    assert.equal(
      this.envelope.status,
      status,
      `envelope status should be "${status}": ${this.envelope.summary}`,
    );
  },
);

Then(
  "the output should state the token was stored, not verified",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.summary.toLowerCase().includes("stored, not verified"),
      `summary must say exactly "stored, not verified": "${this.envelope.summary}"`,
    );
    const verification = this.findCheck("login-token-verification");
    assert.ok(
      verification,
      `expected check "login-token-verification"; got: ${JSON.stringify(this.envelope.checks.map((c) => c.id))}`,
    );
    assert.equal(
      verification!.status,
      "unknown",
      'verification that did not happen must report check status "unknown"',
    );
  },
);

Then("no check may report the token as verified", function (this: JollyWorld) {
  assertNoVerifiedPassCheck(this.envelope);
});

Then(
  "no organization name should be written to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !("JOLLY_SALEOR_ORGANIZATION" in values),
      "an unverified login must not write JOLLY_SALEOR_ORGANIZATION " +
        `(got "${values["JOLLY_SALEOR_ORGANIZATION"]}")`,
    );
  },
);

Then(
  "subsequent `jolly auth status` should report the token is configured",
  function (this: JollyWorld) {
    const loginRun = this.lastRun;
    this.runCli(["auth", "status", "--json"], { env: strippedAuthEnv(this) });
    assert.equal(
      data(this).hasCloudToken,
      true,
      `auth status should report the token as configured: ${JSON.stringify(data(this))}`,
    );
    // The token value must not leak from either run.
    this.assertNoSecretsIn(
      loginRun!.stdout + loginRun!.stderr,
      "login stdout/stderr",
    );
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "auth status stdout/stderr",
    );
  },
);

// ── Scenario: Jolly login prepares browser OAuth authorization material
//    (@logic) ────────────────────────────────────────────────────────────────

Given(
  "the agent has no existing Saleor Cloud authentication",
  function (this: JollyWorld) {
    // Fresh temp project dir (no .env); real credentials are stripped from
    // the CLI env by the When step.
  },
);

When(
  "the agent runs `jolly login --browser --dry-run`",
  function (this: JollyWorld) {
    this.runCli(["login", "--browser", "--dry-run", "--json"], {
      env: strippedAuthEnv(this),
    });
  },
);

Then(
  "Jolly should generate a PKCE code challenge and verifier",
  function (this: JollyWorld) {
    const challenge = data(this).pkceChallenge;
    const verifier = data(this).pkceVerifier;
    assert.ok(
      typeof challenge === "string" && challenge.length > 0,
      `data.pkceChallenge should carry the PKCE challenge: ${JSON.stringify(data(this))}`,
    );
    assert.ok(
      typeof verifier === "string" && verifier.length >= 43,
      "data.pkceVerifier should carry a verifier of at least 43 chars (RFC 7636)",
    );
    const derived = createHash("sha256")
      .update(verifier as string)
      .digest("base64url");
    assert.equal(
      challenge,
      derived,
      "the challenge must be base64url(SHA-256(verifier)) — a real S256 pair, not placeholders",
    );
  },
);

Then(
  "it should construct a Keycloak authorization URL at auth.saleor.io",
  function (this: JollyWorld) {
    const authUrl = new URL(String(data(this).authUrl));
    assert.equal(authUrl.host, "auth.saleor.io");
    assert.ok(
      authUrl.pathname.includes("/realms/saleor-cloud/"),
      `authorization URL should target the saleor-cloud realm: ${authUrl.href}`,
    );
    this.notes["authUrl"] = authUrl;
  },
);

Then(
  'the authorization URL should include response_type=code, client_id="saleor-cli", code_challenge, code_challenge_method=S256, state, redirect_uri, and scope="email openid profile"',
  function (this: JollyWorld) {
    const authUrl = this.notes["authUrl"] as URL;
    const params = authUrl.searchParams;
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("client_id"), "saleor-cli");
    assert.equal(
      params.get("code_challenge"),
      data(this).pkceChallenge,
      "code_challenge in the URL must be the generated PKCE challenge",
    );
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.ok(
      (params.get("state") ?? "").length > 0,
      "state must be a non-empty value",
    );
    assert.ok(
      (params.get("redirect_uri") ?? "").length > 0,
      "redirect_uri must be present",
    );
    assert.equal(params.get("scope"), "email openid profile");
  },
);

Then(
  "the redirect_uri should point to 127.0.0.1:5375\\/callback",
  function (this: JollyWorld) {
    const authUrl = this.notes["authUrl"] as URL;
    const redirect = new URL(authUrl.searchParams.get("redirect_uri")!);
    assert.equal(redirect.hostname, "127.0.0.1");
    assert.equal(redirect.port, "5375");
    assert.equal(redirect.pathname, "/callback");
  },
);

// ── Scenario: Jolly login previews the OAuth code exchange requests
//    (@logic) ────────────────────────────────────────────────────────────────

Given(
  "Jolly receives an authorization code on the localhost callback",
  function (this: JollyWorld) {
    this.notes["authCode"] = `jolly-test-auth-code-${this.namespace}`;
  },
);

When(
  "it previews the code exchange with `--dry-run`",
  function (this: JollyWorld) {
    const apiBase = unreachableApiBase(this);
    this.notes["apiBase"] = apiBase;
    this.runCli(
      [
        "login",
        "--exchange-code",
        this.notes["authCode"] as string,
        "--dry-run",
        "--json",
      ],
      { env: strippedAuthEnv(this, { JOLLY_SALEOR_CLOUD_API_URL: apiBase }) },
    );
  },
);

Then(
  'the preview should show a POST of the code, code_verifier, client_id="saleor-cli", and redirect_uri to the auth.saleor.io token endpoint',
  function (this: JollyWorld) {
    const preview = data(this).exchangePreview as Record<string, unknown> | undefined;
    assert.ok(
      preview,
      `data.exchangePreview should carry the previewed requests: ${JSON.stringify(data(this))}`,
    );
    const tokenRequest = preview!.tokenRequest as Record<string, unknown> | undefined;
    assert.ok(tokenRequest, "exchangePreview.tokenRequest should describe the Keycloak POST");
    const url = new URL(String(tokenRequest!.url));
    assert.equal(url.host, "auth.saleor.io");
    assert.ok(
      url.pathname.includes("/realms/saleor-cloud/") && url.pathname.endsWith("/token"),
      `tokenRequest.url should be the saleor-cloud realm token endpoint: ${url.href}`,
    );
    assert.equal(String(tokenRequest!.method).toUpperCase(), "POST");
    const body = tokenRequest!.body as Record<string, unknown>;
    assert.ok(body, "tokenRequest.body should carry the POST body");
    assert.equal(body.code, this.notes["authCode"]);
    assert.ok(
      typeof body.code_verifier === "string" && (body.code_verifier as string).length > 0,
      "tokenRequest.body.code_verifier must be a real generated verifier",
    );
    assert.equal(body.client_id, "saleor-cli");
    assert.ok(
      String(body.redirect_uri).includes("127.0.0.1:5375/callback"),
      `tokenRequest.body.redirect_uri should be the localhost callback: ${body.redirect_uri}`,
    );
  },
);

Then(
  "the preview should show a POST of the resulting OIDC id_token to the Cloud API \\/platform\\/api\\/tokens endpoint",
  function (this: JollyWorld) {
    const preview = data(this).exchangePreview as Record<string, unknown>;
    const cloudRequest = preview.cloudTokenRequest as Record<string, unknown> | undefined;
    assert.ok(
      cloudRequest,
      "exchangePreview.cloudTokenRequest should describe the Cloud API POST",
    );
    assert.ok(
      String(cloudRequest!.url).endsWith("/platform/api/tokens"),
      `cloudTokenRequest.url should be the Cloud API tokens endpoint: ${cloudRequest!.url}`,
    );
    // The configured Cloud API base must be honored (feature 018 Rule).
    assert.ok(
      String(cloudRequest!.url).startsWith(this.notes["apiBase"] as string),
      `cloudTokenRequest.url should honor JOLLY_SALEOR_CLOUD_API_URL: ${cloudRequest!.url}`,
    );
    assert.equal(String(cloudRequest!.method).toUpperCase(), "POST");
    assert.ok(
      JSON.stringify(cloudRequest).includes("id_token"),
      "cloudTokenRequest should name the id_token field it will send",
    );
  },
);

Then(
  "the preview must not claim any exchange, verification, or login succeeded",
  function (this: JollyWorld) {
    assertNoSuccessClaims(this.envelope.summary, "preview summary");
    for (const check of this.envelope.checks) {
      assertNoSuccessClaims(
        `${check.id} ${String(check.description ?? "")}`,
        `preview check "${check.id}"`,
      );
    }
    assert.notEqual(data(this).authenticated, true, "preview must not claim authentication");
    assert.notEqual(data(this).tokenConfigured, true, "preview must not claim a configured token");
  },
);

Then("no token should be written to .env", function (this: JollyWorld) {
  assert.ok(
    !existsSync(join(this.projectDir, ".env")),
    "the dry-run preview must not create .env",
  );
});

// ── Scenario: A failed OAuth code exchange is reported honestly
//    (@sandbox, network only — no credentials) ──────────────────────────────

Given(
  "Jolly receives an authorization code that Keycloak will reject",
  function (this: JollyWorld) {
    this.notes["authCode"] = `jolly-test-bogus-code-${this.namespace}`;
  },
);

When(
  "it exchanges the code with the Keycloak token endpoint",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    // Real network, real Keycloak; no credentials involved. Real Saleor
    // creds are still stripped so nothing else can be reached.
    this.runCli(
      ["login", "--exchange-code", this.notes["authCode"] as string, "--json"],
      {
        env: {
          JOLLY_SALEOR_CLOUD_TOKEN: undefined,
          JOLLY_SALEOR_APP_TOKEN: undefined,
          JOLLY_SALEOR_ORGANIZATION: undefined,
        },
      },
    );
  },
);

Then(
  "the exchange request should really be sent and really fail",
  function (this: JollyWorld) {
    const error = this.envelope.errors.find(
      (e) => e.code === "OAUTH_EXCHANGE_FAILED",
    );
    assert.ok(
      error,
      `expected stable error code OAUTH_EXCHANGE_FAILED: ${JSON.stringify(this.envelope.errors)}`,
    );
    // Evidence the request was really sent: the real HTTP status Keycloak
    // returned and the real endpoint it was sent to.
    assert.ok(
      typeof error!.httpStatus === "number" && (error!.httpStatus as number) >= 400,
      `errors[].httpStatus must carry the real Keycloak HTTP status: ${JSON.stringify(error)}`,
    );
    assert.ok(
      String(error!.endpoint).includes("auth.saleor.io"),
      `errors[].endpoint must name the real Keycloak endpoint: ${JSON.stringify(error)}`,
    );
  },
);

Then(
  "Jolly should emit an error envelope naming the step that failed",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    const text =
      this.envelope.summary +
      this.envelope.errors.map((e) => String(e.message)).join(" ");
    assert.ok(
      /exchange/i.test(text),
      `the error must name the failed exchange step: "${text}"`,
    );
  },
);

Then("it should not write any value to .env", function (this: JollyWorld) {
  assert.ok(
    !existsSync(join(this.projectDir, ".env")),
    "a failed flow must not write .env",
  );
});

Then(
  "the output should contain no success, verified, or authenticated language",
  function (this: JollyWorld) {
    assertNoSuccessClaims(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "stdout/stderr",
    );
  },
);

// ── Scenario: Jolly login verifies a headless token against the Cloud API
//    (@sandbox, saleorCloud) ─────────────────────────────────────────────────

Given(
  "the agent provides a valid token from https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "JOLLY_SALEOR_CLOUD_TOKEN must be set (gated by @sandbox hook)");
    this.trackSecret(token!);
    this.notes["cloudToken"] = token;
  },
);

When(
  "Jolly validates the token",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    this.runCli(["login", "--token", this.notes["cloudToken"] as string, "--json"]);
  },
);

Then(
  "it should verify the token with an authenticated read-only request to the Cloud API organizations endpoint",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const verification = this.findCheck("login-token-verification");
    assert.ok(
      verification,
      `expected check "login-token-verification": ${JSON.stringify(this.envelope.checks.map((c) => c.id))}`,
    );
    assert.equal(
      verification!.status,
      "pass",
      "a real 2xx organizations response is the only thing that may yield a pass",
    );
    // Cross-check against the same endpoint directly: the organization the
    // CLI reports must exist in the real response.
    const response = await fetch(`${CLOUD_API}/organizations/`, {
      headers: { Authorization: `Token ${this.notes["cloudToken"]}` },
    });
    assert.ok(response.ok, `direct organizations GET failed: HTTP ${response.status}`);
    const organizations = (await response.json()) as Array<{ name: string }>;
    this.notes["realOrgNames"] = organizations.map((o) => String(o.name));
  },
);

Then(
  "it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], this.notes["cloudToken"]);
  },
);

Then(
  "it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const stored = values["JOLLY_SALEOR_ORGANIZATION"];
    const realNames = this.notes["realOrgNames"] as string[];
    assert.notEqual(stored, PLACEHOLDER_ORG, "the placeholder organization label is retired");
    assert.ok(
      typeof stored === "string" && realNames.includes(stored),
      `JOLLY_SALEOR_ORGANIZATION ("${stored}") must be an organization name from the real response: ${JSON.stringify(realNames)}`,
    );
  },
);

Then(
  "it should report the authenticated organization context using values from the real response",
  function (this: JollyWorld) {
    const realNames = this.notes["realOrgNames"] as string[];
    const reported = data(this).organization;
    assert.ok(
      typeof reported === "string" && realNames.includes(reported),
      `data.organization ("${reported}") must come from the real response: ${JSON.stringify(realNames)}`,
    );
  },
);

// ── Scenario: Jolly login rejects an invalid token gracefully
//    (@sandbox, network only — no credentials) ──────────────────────────────

Given(
  "the agent provides an invalid or expired token",
  function (this: JollyWorld) {
    this.notes["invalidToken"] = `jolly-invalid-token-${this.namespace}`;
  },
);

When(
  "Jolly validates the token against the Cloud API",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    // Real network, real Cloud API, default base: the invalid token must be
    // really rejected. Real creds stripped so the flag value is all there is.
    this.runCli(
      ["login", "--token", this.notes["invalidToken"] as string, "--json"],
      {
        env: {
          JOLLY_SALEOR_CLOUD_TOKEN: undefined,
          JOLLY_SALEOR_APP_TOKEN: undefined,
          JOLLY_SALEOR_ORGANIZATION: undefined,
        },
      },
    );
  },
);

Then(
  "the verification request should really be sent and really be rejected",
  function (this: JollyWorld) {
    const error = this.envelope.errors.find((e) => e.code === "INVALID_TOKEN");
    assert.ok(
      error,
      `expected stable error code INVALID_TOKEN: ${JSON.stringify(this.envelope.errors)}`,
    );
    // Evidence of a real rejection: the actual 401/403 the Cloud API returned.
    assert.ok(
      error!.httpStatus === 401 || error!.httpStatus === 403,
      `errors[].httpStatus must carry the real 401/403 rejection: ${JSON.stringify(error)}`,
    );
  },
);

Then("Jolly should report a clear error message", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "error");
  const error = this.envelope.errors[0] as Record<string, unknown>;
  assert.ok(
    typeof error.message === "string" && (error.message as string).length > 0,
    "errors[].message must explain the rejection",
  );
});

Then(
  "the error message should direct the customer to create a new token at https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const text =
      JSON.stringify(this.envelope.errors) + JSON.stringify(this.envelope.nextSteps);
    assert.ok(
      text.includes("https://cloud.saleor.io/tokens"),
      `the error must direct to https://cloud.saleor.io/tokens: ${text}`,
    );
  },
);

// ── Scenario: Agent completes the full browser OAuth login flow
//    (@requires-browser) ──────────────────────────────────────────────────────

Given(
  "the runner can complete a browser OAuth flow natively or via Playwright with harness-supplied login input",
  function (this: JollyWorld) {
    const tier = this.notes[BROWSER_TIER_NOTE] as BrowserTier | undefined;
    assert.ok(
      tier && tier.mode !== "skip",
      "the @requires-browser hook must have resolved a runnable tier",
    );
  },
);

When(
  "the agent runs `jolly login --browser`",
  { timeout: 600_000 },
  function (this: JollyWorld) {
    const tier = this.notes[BROWSER_TIER_NOTE] as BrowserTier;
    // Tier 2 pipes the harness-only knobs into Jolly's stdin prompt; they
    // are one-time inputs and must never appear in .env or output.
    const input =
      tier.mode === "playwright"
        ? `${process.env.HARNESS_SALEOR_EMAIL}\n${process.env.HARNESS_SALEOR_PASSWORD}\n`
        : undefined;
    if (process.env.HARNESS_SALEOR_PASSWORD) {
      this.trackSecret(process.env.HARNESS_SALEOR_PASSWORD);
    }
    this.runCli(["login", "--browser", "--json"], {
      input,
      timeoutMs: 540_000,
    });
  },
);

Then("Jolly should complete the browser OAuth flow", function (this: JollyWorld) {
  assert.equal(
    this.envelope.status,
    "success",
    `browser OAuth flow should complete: ${this.envelope.summary}\n${JSON.stringify(this.envelope.errors)}`,
  );
});

Then(
  "it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const token = values["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(
      typeof token === "string" && token.length > 0,
      "the durable artifact of the login flow is JOLLY_SALEOR_CLOUD_TOKEN in .env",
    );
    this.trackSecret(token);
  },
);

Then(
  ".env should not contain any email or password value",
  function (this: JollyWorld) {
    const envPath = join(this.projectDir, ".env");
    const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    for (const knob of ["HARNESS_SALEOR_EMAIL", "HARNESS_SALEOR_PASSWORD"]) {
      const value = process.env[knob];
      if (value && value.trim() !== "") {
        assert.ok(
          !raw.includes(value),
          `.env must not contain the ${knob} value`,
        );
      }
    }
    assert.ok(
      !/EMAIL|PASSWORD/i.test(
        Object.keys(loadEnvValues(this.projectDir)).join(" "),
      ),
      ".env must hold no email/password keys — credentials are one-time inputs",
    );
  },
);

// ── Scenario: Agent logs out (@logic) ────────────────────────────────────

Given(
  "Jolly has Saleor Cloud authentication state available",
  function (this: JollyWorld) {
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: "jolly-logout-test-token",
      JOLLY_SALEOR_ORGANIZATION: "jolly-logout-test-org",
      OTHER_SERVICE_KEY: "keep-me",
    });
    this.trackSecret("jolly-logout-test-token");
  },
);

When("the agent invokes `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: strippedAuthEnv(this) });
});

Then(
  "Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
      "JOLLY_SALEOR_CLOUD_TOKEN should have been removed",
    );
    assert.ok(
      !("JOLLY_SALEOR_ORGANIZATION" in values),
      "JOLLY_SALEOR_ORGANIZATION should have been removed",
    );
  },
);

Then(
  "it should not remove unrelated environment variables or third-party credentials without explicit intent",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["OTHER_SERVICE_KEY"],
      "keep-me",
      "unrelated .env entries must survive logout",
    );
  },
);

Then(
  "it should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    // The flow must have continued with the post-logout values; "where
    // possible" permits a no-op report, not a failure.
    assert.notEqual(this.envelope.status, "error");
  },
);

Then("it should report the result clearly", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
  assert.ok(
    this.envelope.summary.length > 0,
    "logout must summarize what it did",
  );
});

// ── Scenario: Agent checks auth status (@logic) ──────────────────────────

Given(
  "the agent needs to know whether Saleor Cloud auth is available",
  function (this: JollyWorld) {
    // Premise — the When step exercises both configured and unconfigured dirs.
  },
);

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  const env = strippedAuthEnv(this);
  // Configured project: token plus stored organization context.
  writeEnvValues(this.projectDir, {
    JOLLY_SALEOR_CLOUD_TOKEN: "jolly-status-test-token",
    JOLLY_SALEOR_ORGANIZATION: "jolly-status-test-org",
  });
  this.trackSecret("jolly-status-test-token");
  this.runCli(["auth", "status", "--json"], { env });
  this.notes["statusConfigured"] = this.lastRun;

  // Unconfigured project: no .env at all.
  const emptyDir = this.newTempDir("auth-status-empty");
  this.runCli(["auth", "status", "--json"], { env, cwd: emptyDir });
  this.notes["statusUnconfigured"] = this.lastRun;

  // Global output flags.
  this.runCli(["auth", "status", "--quiet"], { env });
  this.notes["statusQuiet"] = this.lastRun;
});

Then(
  "Jolly should report whether Saleor Cloud authentication is configured",
  function (this: JollyWorld) {
    const configured = (this.notes["statusConfigured"] as CliResult).envelope!;
    const unconfigured = (this.notes["statusUnconfigured"] as CliResult).envelope!;
    assert.equal(
      configured.data.hasCloudToken,
      true,
      `a stored token must be reported as configured: ${JSON.stringify(configured.data)}`,
    );
    assert.equal(
      unconfigured.data.hasCloudToken,
      false,
      `no stored token must be reported as not configured: ${JSON.stringify(unconfigured.data)}`,
    );
    // Configuration is a file read, not a verification: it must not be
    // dressed up as authentication (feature 020 "No fabricated success").
    assert.notEqual(
      configured.data.authenticated,
      true,
      "auth status must not claim `authenticated` for a token merely found on disk",
    );
  },
);

Then(
  "when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context",
  function (this: JollyWorld) {
    const configured = (this.notes["statusConfigured"] as CliResult).envelope!;
    assert.equal(
      configured.data.accountContext,
      "jolly-status-test-org",
      `data.accountContext should be the stored organization: ${JSON.stringify(configured.data)}`,
    );
  },
);

Then(
  "when no organization is stored, it should report the account context as unknown rather than failing",
  function (this: JollyWorld) {
    const run = this.notes["statusUnconfigured"] as CliResult;
    assert.equal(run.exitCode, 0, "a missing organization must not fail the command");
    assert.notEqual(run.envelope!.status, "error");
    assert.equal(
      run.envelope!.data.accountContext,
      "unknown",
      `account context without a stored organization is "unknown": ${JSON.stringify(run.envelope!.data)}`,
    );
  },
);

Then(
  "it should avoid exposing secret token values",
  function (this: JollyWorld) {
    for (const note of ["statusConfigured", "statusUnconfigured", "statusQuiet"]) {
      const run = this.notes[note] as CliResult;
      this.assertNoSecretsIn(run.stdout + run.stderr, `${note} stdout/stderr`);
    }
  },
);

Then(
  "it should support `--json`, `--quiet`, and other global output flags",
  function (this: JollyWorld) {
    const jsonRun = this.notes["statusConfigured"] as CliResult;
    const parsed: unknown = JSON.parse(jsonRun.stdout.trim());
    assertEnvelopeShape(parsed);
    const quietRun = this.notes["statusQuiet"] as CliResult;
    assert.ok(
      quietRun.envelope !== undefined,
      "--quiet must trim human text without removing the envelope",
    );
  },
);

// ── Scenario: Jolly login --dry-run does not write to .env (@logic) ──────

When(
  "the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(
      ["login", "--token", "jolly-dry-run-token", "--dry-run", "--json"],
      { env: strippedAuthEnv(this) },
    );
  },
);

// ── Scenario: Jolly logout removes only Jolly-managed auth values from
//    .env (@logic) ───────────────────────────────────────────────────────────

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me",
  function (this: JollyWorld) {
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: "some-token",
      JOLLY_SALEOR_APP_TOKEN: "some-app-token",
      JOLLY_SALEOR_ORGANIZATION: "some-org",
      THIRD_PARTY_KEY: "keep-me",
    });
  },
);

When("the agent runs `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: strippedAuthEnv(this) });
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    for (const key of [
      "JOLLY_SALEOR_CLOUD_TOKEN",
      "JOLLY_SALEOR_APP_TOKEN",
      "JOLLY_SALEOR_ORGANIZATION",
    ]) {
      assert.ok(!(key in values), `"${key}" should have been removed from .env`);
    }
  },
);

Then("THIRD_PARTY_KEY should remain in .env unchanged", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.equal(
    values["THIRD_PARTY_KEY"],
    "keep-me",
    "third-party .env entries must survive logout unchanged",
  );
});

Then(
  "subsequent `jolly auth status` should report not authenticated",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { env: strippedAuthEnv(this) });
    assert.notEqual(this.envelope.status, "error");
    assert.equal(
      data(this).hasCloudToken,
      false,
      `after logout, auth status must report no configured token: ${JSON.stringify(data(this))}`,
    );
  },
);
