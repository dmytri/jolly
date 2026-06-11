// Step definitions for feature 018: Jolly auth commands.
//
// Regenerated fresh from features/018-jolly-auth-commands.feature (Captain
// spec change: login credentials are one-time inputs, never persisted —
// the Playwright flow prompts for email/password on stdin, holds them in
// memory only, and the durable artifact is JOLLY_SALEOR_CLOUD_TOKEN in .env).
//
// The @requires-browser scenario is tier-gated by features/support/hooks.ts
// (native browser first, then Playwright + HARNESS_SALEOR_EMAIL /
// HARNESS_SALEOR_PASSWORD, else skip). In Tier 2 this file pipes the harness
// knobs into Jolly's stdin prompt; nothing ever writes them to .env.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";
import { BROWSER_TIER_NOTE } from "../support/hooks.ts";
import type { BrowserTier } from "../support/browser.ts";
import { writeEnvValues, loadEnvValues } from "../../src/lib/env-file.ts";

function data(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data;
}

// ── Scenario: Jolly login writes token values to .env (@logic) ───────────

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
    this.runCli(["login", "--token", "jolly-login-test-token-abc"]);
  },
);

Then(
  "Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      typeof values["JOLLY_SALEOR_CLOUD_TOKEN"] === "string" &&
        values["JOLLY_SALEOR_CLOUD_TOKEN"].length > 0,
      "JOLLY_SALEOR_CLOUD_TOKEN should be written to .env",
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
  "subsequent `jolly auth status` should report the token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"]);
    assert.equal(
      data(this).authenticated,
      true,
      `auth status should report authenticated: ${JSON.stringify(data(this))}`,
    );
  },
);

// ── Scenario: Jolly login prepares browser OAuth authorization material ──

Given(
  "the agent has no existing Saleor Cloud authentication",
  function (this: JollyWorld) {
    // Fresh per-scenario temp project dir — nothing configured yet.
  },
);

When(
  "the agent runs `jolly login --browser --dry-run`",
  function (this: JollyWorld) {
    this.runCli(["login", "--browser", "--dry-run", "--json"]);
  },
);

Then(
  "Jolly should generate a PKCE code challenge and verifier",
  function (this: JollyWorld) {
    const d = data(this);
    assert.ok(
      typeof d.pkceChallenge === "string" && (d.pkceChallenge as string).length > 0,
      "data.pkceChallenge should be present",
    );
    assert.ok(
      typeof d.pkceVerifier === "string" && (d.pkceVerifier as string).length > 0,
      "data.pkceVerifier should be present",
    );
    this.notes["pkceChallenge"] = d.pkceChallenge;
  },
);

Then(
  "it should construct a Keycloak authorization URL at auth.saleor.io",
  function (this: JollyWorld) {
    const authUrl = String(data(this).authUrl);
    assert.ok(
      authUrl.startsWith("https://auth.saleor.io/"),
      `authorization URL should be at auth.saleor.io: ${authUrl}`,
    );
    this.notes["authUrl"] = authUrl;
  },
);

Then(
  'the authorization URL should include response_type=code, client_id="saleor-cli", code_challenge, code_challenge_method=S256, state, redirect_uri, and scope="email openid profile"',
  function (this: JollyWorld) {
    const authUrl = new URL(this.notes["authUrl"] as string);
    const params = authUrl.searchParams;
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("client_id"), "saleor-cli");
    assert.ok(
      (params.get("code_challenge") ?? "").length > 0,
      "code_challenge must be present",
    );
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.ok((params.get("state") ?? "").length > 0, "state must be present");
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
    const authUrl = new URL(this.notes["authUrl"] as string);
    const redirect = new URL(authUrl.searchParams.get("redirect_uri")!);
    assert.equal(redirect.hostname, "127.0.0.1");
    assert.equal(redirect.port, "5375");
    assert.equal(redirect.pathname, "/callback");
  },
);

// ── Scenario: Jolly login exchanges the OAuth code for a token (@logic) ──

Given(
  "Jolly receives an authorization code on the localhost callback",
  function (this: JollyWorld) {
    this.notes["authCode"] = "test-authorization-code-123";
  },
);

When(
  "it exchanges the code with the Keycloak token endpoint",
  function (this: JollyWorld) {
    this.runCli([
      "login", "--exchange-code", this.notes["authCode"] as string, "--json",
    ]);
  },
);

Then(
  'it should POST the code, code_verifier, client_id="saleor-cli", and redirect_uri',
  function (this: JollyWorld) {
    const body = data(this).tokenExchangeBody as Record<string, unknown> | undefined;
    assert.ok(body, "data.tokenExchangeBody should carry the token exchange POST body");
    assert.equal(body!.code, this.notes["authCode"]);
    assert.ok(
      typeof body!.code_verifier === "string" && (body!.code_verifier as string).length > 0,
      "code_verifier must be included",
    );
    assert.equal(body!.client_id, "saleor-cli");
    assert.ok(
      typeof body!.redirect_uri === "string" && (body!.redirect_uri as string).length > 0,
      "redirect_uri must be included",
    );
  },
);

Then(
  "it should call POST \\/platform\\/api\\/tokens on the Cloud API with the OIDC id_token",
  function (this: JollyWorld) {
    const d = data(this);
    assert.match(
      String(d.cloudTokenUrl),
      /\/platform\/api\/tokens$/,
      `data.cloudTokenUrl should be the Cloud API tokens endpoint: ${d.cloudTokenUrl}`,
    );
    const body = d.cloudTokenBody as Record<string, unknown> | undefined;
    assert.ok(
      body && "id_token" in body,
      `data.cloudTokenBody should carry the OIDC id_token: ${JSON.stringify(body)}`,
    );
  },
);

Then(
  "it should store the resulting Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const token = values["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(
      typeof token === "string" && token.length > 0,
      "JOLLY_SALEOR_CLOUD_TOKEN should be stored in .env",
    );
    this.trackSecret(token);
  },
);

Then(
  "it should verify the stored token via the id.saleor.online\\/verify endpoint",
  function (this: JollyWorld) {
    assert.match(
      String(data(this).verifyUrl),
      /id\.saleor\.online\/verify/,
      `data.verifyUrl should be the verify endpoint: ${data(this).verifyUrl}`,
    );
  },
);

// ── Scenarios: headless token validation, valid and invalid (@logic) ─────

Given(
  "the agent provides a token from https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    this.notes["tokenValue"] = "jolly-headless-cloud-token-xyz";
    this.trackSecret("jolly-headless-cloud-token-xyz");
  },
);

Given(
  "the agent provides an invalid or expired token",
  function (this: JollyWorld) {
    // The "invalid-" prefix is the committed mock seam for a token the
    // verify endpoint rejects (a real verification failure cannot be
    // produced deterministically at the logic tier).
    this.notes["tokenValue"] = "invalid-expired-test-token";
    this.trackSecret("invalid-expired-test-token");
  },
);

When("Jolly validates the token", function (this: JollyWorld) {
  this.runCli(["login", "--token", this.notes["tokenValue"] as string, "--json"]);
});

Then(
  "it should POST the token to https:\\/\\/id.saleor.online\\/configure for verification",
  function (this: JollyWorld) {
    assert.equal(
      data(this).verifyUrl,
      "https://id.saleor.online/configure",
      `data.verifyUrl should be the configure verification endpoint: ${data(this).verifyUrl}`,
    );
  },
);

Then(
  "if valid, it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], this.notes["tokenValue"]);
  },
);

Then(
  "it should report the authenticated account or organization context",
  function (this: JollyWorld) {
    const context = data(this).accountContext;
    assert.ok(
      typeof context === "string" && context.length > 0,
      `data.accountContext should name the authenticated account/organization: ${JSON.stringify(data(this))}`,
    );
  },
);

Then("it should report a clear error message", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "error", "invalid token must yield status error");
  const errors = this.envelope.errors;
  assert.ok(errors.length > 0, "errors[] must describe the rejection");
  assert.ok(
    typeof errors[0].message === "string" && (errors[0].message as string).length > 0,
    "the error message must be non-empty",
  );
});

Then("it should not write any value to .env", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.ok(
    !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
    "a rejected token must not be written to .env",
  );
});

Then(
  "the error message should direct the customer to create a new token at https:\\/\\/cloud.saleor.io\\/tokens",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.errors);
    assert.ok(
      text.includes("cloud.saleor.io/tokens"),
      `the error should point at https://cloud.saleor.io/tokens: ${text}`,
    );
  },
);

// ── Scenario: Agent completes the full browser OAuth login flow ──────────
// Tier-gated by the @requires-browser Before hook (feature 018, Rule
// "Browser OAuth prerequisites"). Tier 1 opens the native browser and a
// human completes consent; Tier 2 pipes the harness knobs into Jolly's
// stdin prompt for the Playwright-automated Keycloak form.

Given(
  "the runner can complete a browser OAuth flow natively or via Playwright with harness-supplied login input",
  function (this: JollyWorld) {
    const tier = this.notes[BROWSER_TIER_NOTE] as BrowserTier | undefined;
    assert.ok(
      tier && tier.mode !== "skip",
      "the @requires-browser hook should have resolved a runnable tier (or skipped the scenario)",
    );
  },
);

When(
  "the agent runs `jolly login --browser`",
  { timeout: 360_000 },
  function (this: JollyWorld) {
    const tier = this.notes[BROWSER_TIER_NOTE] as BrowserTier;
    let input: string | undefined;
    if (tier.mode === "playwright") {
      // One-time inputs piped into the stdin prompt — in memory only, never
      // persisted by Jolly, never written to .env by the harness.
      const email = process.env["HARNESS_SALEOR_EMAIL"]!;
      const password = process.env["HARNESS_SALEOR_PASSWORD"]!;
      this.trackSecret(email);
      this.trackSecret(password);
      input = `${email}\n${password}\n`;
    }
    this.runCli(["login", "--browser"], { timeoutMs: 300_000, input });
  },
);

Then(
  "Jolly should complete the browser OAuth flow",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.status,
      "success",
      `browser OAuth login should succeed: ${JSON.stringify(this.envelope.errors)}\nstderr: ${this.lastRun!.stderr}`,
    );
    assert.equal(
      data(this).authenticated,
      true,
      "data.authenticated should confirm the completed flow",
    );
  },
);

Then(
  "it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const token = values["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(
      typeof token === "string" && token.length > 0,
      "JOLLY_SALEOR_CLOUD_TOKEN should be stored in .env",
    );
    this.trackSecret(token);
  },
);

Then(
  ".env should not contain any email or password value",
  function (this: JollyWorld) {
    const envPath = join(this.projectDir, ".env");
    const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    // No variable named after email/password — Jolly has no such settings.
    for (const line of raw.split("\n")) {
      const name = line.split("=")[0]?.trim() ?? "";
      assert.ok(
        !/EMAIL|PASSWORD/i.test(name),
        `.env must not carry an email/password variable, found "${name}"`,
      );
    }
    // Nor the harness-supplied credential values themselves.
    for (const knob of ["HARNESS_SALEOR_EMAIL", "HARNESS_SALEOR_PASSWORD"]) {
      const value = process.env[knob];
      if (value && value.trim() !== "") {
        assert.ok(
          !raw.includes(value),
          `.env must not contain the ${knob} value`,
        );
      }
    }
  },
);

// ── Scenario: Agent logs out (@logic) ────────────────────────────────────

Given(
  "Jolly has Saleor Cloud authentication state available",
  function (this: JollyWorld) {
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: "logout-test-cloud-token",
      OTHER_SERVICE_KEY: "unrelated-keep-me",
    });
    this.trackSecret("logout-test-cloud-token");
  },
);

When("the agent invokes `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout"]);
});

Then(
  "Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
      "JOLLY_SALEOR_CLOUD_TOKEN should be removed by logout",
    );
  },
);

Then(
  "it should not remove unrelated environment variables or third-party credentials without explicit intent",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["OTHER_SERVICE_KEY"],
      "unrelated-keep-me",
      "unrelated values must survive logout",
    );
  },
);

Then(
  "it should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    const d = data(this);
    if (d.envUpdated !== undefined) {
      assert.equal(d.envUpdated, true, "the updated .env state should be loaded/reported");
    }
  },
);

Then("it should report the result clearly", function (this: JollyWorld) {
  assert.ok(
    this.envelope.summary.length > 0,
    "logout should produce a clear summary",
  );
  assert.notEqual(this.envelope.status, "error", "logout should not error");
});

// ── Scenario: Agent checks auth status (@logic) ──────────────────────────

Given(
  "the agent needs to know whether Saleor Cloud auth is available",
  function (this: JollyWorld) {
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: "status-test-cloud-token",
    });
    this.trackSecret("status-test-cloud-token");
  },
);

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  this.runCli(["auth", "status"]);
});

Then(
  "Jolly should report whether Saleor Cloud authentication is configured",
  function (this: JollyWorld) {
    assert.equal(
      typeof data(this).authenticated,
      "boolean",
      `data.authenticated should report the auth state: ${JSON.stringify(data(this))}`,
    );
    assert.equal(data(this).authenticated, true, "the configured token should be detected");
  },
);

Then(
  "it should report the authenticated account or organization context where safe",
  function (this: JollyWorld) {
    // "Where safe": when authenticated, the context is reported by
    // name/reference — never as a secret value.
    if (data(this).authenticated === true) {
      const context = data(this).accountContext;
      assert.ok(
        typeof context === "string" && context.length > 0,
        `data.accountContext should reference the account/organization: ${JSON.stringify(data(this))}`,
      );
    }
  },
);

Then(
  "it should avoid exposing secret token values",
  function (this: JollyWorld) {
    this.assertNoSecretsIn(
      this.lastRun!.stdout + this.lastRun!.stderr,
      "auth status output",
    );
  },
);

Then(
  "it should support `--json`, `--quiet`, and other global output flags",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"]);
    const stdout = this.lastRun!.stdout.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      assert.fail(`--json stdout must be only the envelope: ${stdout}`);
    }
    assert.ok(
      typeof parsed === "object" && parsed !== null && "command" in (parsed as object),
      "--json output must be the envelope",
    );
    this.runCli(["auth", "status", "--quiet"]);
    assert.ok(
      this.lastRun!.envelope,
      "--quiet must trim human text without removing the envelope",
    );
  },
);

// ── Scenario: Jolly login --dry-run does not write to .env (@logic) ──────

When(
  "the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(["login", "--token", "jolly-dry-run-token", "--dry-run", "--json"]);
  },
);

// ── Scenario: Jolly logout removes only Jolly-managed auth values ────────

Given(
  // Unquoted KEY=value list ("A=1 and B=2 and C=3") — the quoted variant
  // lives in common.steps.ts as `.env contains {string}`.
  /^\.env contains ((?:[A-Z][A-Z0-9_]*=\S+)(?: and [A-Z][A-Z0-9_]*=\S+)*)$/,
  function (this: JollyWorld, entries: string) {
    const values: Record<string, string> = {};
    for (const entry of entries.split(" and ")) {
      const eqIdx = entry.indexOf("=");
      values[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
    writeEnvValues(this.projectDir, values);
    for (const [name, value] of Object.entries(values)) {
      if (/TOKEN|SECRET|KEY|PASSWORD/.test(name)) this.trackSecret(value);
    }
  },
);

When("the agent runs `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout"]);
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN and JOLLY_SALEOR_APP_TOKEN from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    for (const key of ["JOLLY_SALEOR_CLOUD_TOKEN", "JOLLY_SALEOR_APP_TOKEN"]) {
      assert.ok(!(key in values), `"${key}" should have been removed from .env`);
    }
  },
);

Then(
  "THIRD_PARTY_KEY should remain in .env unchanged",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["THIRD_PARTY_KEY"],
      "keep-me",
      "THIRD_PARTY_KEY must remain untouched",
    );
  },
);

Then(
  "subsequent `jolly auth status` should report not authenticated",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"]);
    assert.equal(
      data(this).authenticated,
      false,
      `auth status should report not authenticated after logout: ${JSON.stringify(data(this))}`,
    );
  },
);
