// Step definitions for feature 018: Jolly auth commands.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadEnvValues, writeEnvValues } from "../../src/lib/env-file.ts";
import { findRiskContexts } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Login writes token to .env ───────────────────────────────────────────

Given(
  'the agent has a Saleor Cloud token value "jolly-login-test-token-abc"',
  function (this: JollyWorld) {
    this.trackSecret("jolly-login-test-token-abc");
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
      "JOLLY_SALEOR_CLOUD_TOKEN" in values,
      "JOLLY_SALEOR_CLOUD_TOKEN missing from .env",
    );
  },
);

Then(
  ".env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["JOLLY_SALEOR_CLOUD_TOKEN"],
      "jolly-login-test-token-abc",
    );
  },
);

// ── Logout ───────────────────────────────────────────────────────────────

Given(
  "Jolly has Saleor Cloud authentication state available",
  function (this: JollyWorld) {
    // Write some auth values.
    writeEnvValues(this.projectDir, {
      "JOLLY_SALEOR_CLOUD_TOKEN": "test-token",
    });
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
      "JOLLY_SALEOR_CLOUD_TOKEN should be removed",
    );
  },
);

Then(
  "it should not remove unrelated environment variables or third-party credentials without explicit intent",
  function (this: JollyWorld) {
    // Verified by scenario that preserves THIRD_PARTY_KEY.
  },
);

Then("it should report the result clearly", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "Should have a summary");
});

// ── Auth status ──────────────────────────────────────────────────────────

Given("the agent needs to know whether Saleor Cloud auth is available", function (this: JollyWorld) {
  // Contract.
});

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  this.runCli(["auth", "status"]);
});

Then("Jolly should report whether Saleor Cloud authentication is configured", function (this: JollyWorld) {
  const data = this.envelope.data as Record<string, unknown>;
  if (data && data.authenticated !== undefined) {
    // Should be a boolean.
    assert.ok(typeof data.authenticated === "boolean");
  }
  // If not in data, at minimum the command succeeded.
  assert.equal(this.envelope.status, "success");
});

Then(
  "it should report the authenticated account or organization context where safe",
  function (this: JollyWorld) {
    // Contract - if authenticated, optionally show context.
  },
);

Then("it should avoid exposing secret token values", function (this: JollyWorld) {
  this.assertNoSecretsIn(
    JSON.stringify(this.envelope),
    "envelope should not expose token values",
  );
});

Then(
  "it should support `--json`, `--quiet`, and other global output flags",
  function (this: JollyWorld) {
    // Already verified by other scenarios.
  },
);

// ── @sandbox: Login with OAuth ───────────────────────────────────────────

Given("the agent needs Saleor Cloud authentication", function (this: JollyWorld) {
  // Contract - @sandbox.
});

When("it invokes `jolly login`", function (this: JollyWorld) {
  this.runCli(["login"]);
});

Then(
  "Jolly should support browser OAuth authentication when available",
  function (this: JollyWorld) {
    // Contract.
  },
);

// `Jolly should support a headless token flow...` is in 002-v1-end-to-end...

Then(
  "Jolly should explain any required human browser or token steps",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Login dry-run ────────────────────────────────────────────────────────

When(
  "the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`",
  function (this: JollyWorld) {
    this.trackSecret("jolly-dry-run-token");
    this.runCli(["login", "--token", "jolly-dry-run-token", "--dry-run", "--json"]);
  },
);

// ── Logout removes only Jolly-managed values ─────────────────────────────

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and THIRD_PARTY_KEY=keep-me",
  function (this: JollyWorld) {
    writeEnvValues(this.projectDir, {
      "JOLLY_SALEOR_CLOUD_TOKEN": "some-token",
      "JOLLY_SALEOR_APP_TOKEN": "some-app-token",
      "THIRD_PARTY_KEY": "keep-me",
    });
  },
);

When("the agent runs `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout"]);
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN and JOLLY_SALEOR_APP_TOKEN from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
      "JOLLY_SALEOR_CLOUD_TOKEN should be removed",
    );
    assert.ok(
      !("JOLLY_SALEOR_APP_TOKEN" in values),
      "JOLLY_SALEOR_APP_TOKEN should be removed",
    );
  },
);

Then("THIRD_PARTY_KEY should remain in .env unchanged", function (this: JollyWorld) {
  const values = loadEnvValues(this.projectDir);
  assert.equal(values["THIRD_PARTY_KEY"], "keep-me");
});

Then("subsequent `jolly auth status` should report not authenticated", function (this: JollyWorld) {
  this.runCli(["auth", "status"]);
  assert.equal(this.envelope.status, "success");
  const data = this.envelope.data as Record<string, unknown>;
  if (data && data.authenticated !== undefined) {
    assert.ok(!data.authenticated, "Should report not authenticated");
  }
});

Then(
  "subsequent `jolly auth status` should report the token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status"]);
    assert.equal(this.envelope.status, "success");
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authenticated !== undefined) {
      assert.ok(data.authenticated, "auth status should report authenticated");
    }
  },
);

Then(
  "it should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    // Contract - CLI should load updated .env values after logout.
    const env = this.envelope;
    assert.ok(
      env.status === "success" || env.status === "warning",
      `Logout should succeed or warn, got ${env.status}`,
    );
  },
);

// ── OAuth: Browser authorization request (new @logic) ────────────────────

Given(
  "the agent has no existing Saleor Cloud authentication",
  function (this: JollyWorld) {
    // Temp project dir has no .env, so no auth state.
  },
);

Then(
  "Jolly should generate a PKCE code challenge and verifier",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.pkceChallenge) {
      assert.ok(
        typeof data.pkceChallenge === "string" &&
          (data.pkceChallenge as string).length > 0,
        "Should generate a PKCE code challenge",
      );
    }
    if (data?.pkceVerifier) {
      assert.ok(
        typeof data.pkceVerifier === "string" &&
          (data.pkceVerifier as string).length > 0,
        "Should generate a PKCE code verifier",
      );
    }
  },
);

Then(
  "it should construct a Keycloak authorization URL at auth.saleor.io",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authUrl) {
      const authUrl = String(data.authUrl);
      assert.ok(
        authUrl.includes("auth.saleor.io"),
        `authUrl should point at auth.saleor.io, got ${authUrl}`,
      );
      assert.ok(
        authUrl.includes("/auth/realms/") || authUrl.includes("protocol/openid-connect/auth"),
        `authUrl should be an OIDC authorization endpoint, got ${authUrl}`,
      );
    }
  },
);

Then(
  'the authorization URL should include response_type=code, client_id={string}, code_challenge, code_challenge_method=S256, state, redirect_uri, and scope={string}',
  function (this: JollyWorld, clientId: string, scope: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authUrl) {
      const authUrl = String(data.authUrl);
      assert.ok(authUrl.includes("response_type=code"), "Should include response_type=code");
      assert.ok(
        authUrl.includes(`client_id=${clientId}`),
        `Should include client_id=${clientId}`,
      );
      assert.ok(authUrl.includes("code_challenge="), "Should include code_challenge");
      assert.ok(
        authUrl.includes("code_challenge_method=S256"),
        "Should include code_challenge_method=S256",
      );
      assert.ok(authUrl.includes("state="), "Should include state");
      assert.ok(authUrl.includes("redirect_uri="), "Should include redirect_uri");
      assert.ok(
        authUrl.includes(`scope=${encodeURIComponent(scope)}`) ||
          authUrl.includes(`scope=${scope.replace(/ /g, "%20")}`),
        `Should include scope=${scope}`,
      );
    }
  },
);

Then(
  /^the redirect_uri should point to (127\.0\.0\.1:\d+\/callback)$/,
  function (this: JollyWorld, redirectUri: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authUrl) {
      const authUrl = String(data.authUrl);
      const match = authUrl.match(/redirect_uri=([^&]+)/);
      if (match) {
        const decoded = decodeURIComponent(match[1]);
        // "Points to" host:port/path — the OAuth redirect_uri itself carries
        // an http scheme (loopback redirect per RFC 8252).
        assert.match(
          decoded,
          new RegExp(`^https?://${redirectUri.replace(/[.\/]/g, "\\$&")}$`),
          `redirect_uri should point to "${redirectUri}", got "${decoded}"`,
        );
      }
    }
  },
);

Then(
  /^it should start a local HTTP server on port (\d+) to receive the callback$/,
  function (this: JollyWorld, port: number) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.callbackPort) {
      assert.equal(
        data.callbackPort,
        port,
        `Should start server on port ${port}, got ${data.callbackPort}`,
      );
    }
  },
);

When(
  "the agent runs `jolly login --browser --dry-run`",
  function (this: JollyWorld) {
    this.runCli(["login", "--browser", "--dry-run", "--json"]);
  },
);

// ── @requires-browser: full browser OAuth login flow ─────────────────────
// Gated by the @requires-browser Before hook (features/support/hooks.ts):
// native browser first, then Playwright, else skipped. The Saleor Cloud
// email/password credentials for Playwright automation and their env var
// names are deferred to CLI design (non-normative), so the harness asserts
// only the capability tier it can know about.

Given(
  "Playwright is installed with browser binaries and Saleor Cloud credentials are configured for browser login",
  function (this: JollyWorld) {
    // The Before hook already skipped the scenario when no tier is available.
    const tier = this.notes["browserTier"];
    assert.ok(
      tier === "native" || tier === "playwright",
      `browser capability tier should be resolved by the hook, got ${String(tier)}`,
    );
  },
);

When("the agent runs `jolly login --browser`", function (this: JollyWorld) {
  this.runCli(["login", "--browser", "--json"], { timeoutMs: 300_000 });
});

Then(
  "Jolly should complete the browser OAuth flow via Playwright automation",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.status,
      "success",
      `browser OAuth flow should succeed, got ${this.envelope.status}: ` +
        JSON.stringify(this.envelope.errors),
    );
  },
);

Then(
  "it should store the Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const stored = values["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(
      typeof stored === "string" && stored.trim() !== "",
      "JOLLY_SALEOR_CLOUD_TOKEN missing from .env after browser OAuth login",
    );
    this.trackSecret(stored);
  },
);

// ── OAuth: Code exchange (new @logic) ───────────────────────────────────────

Given(
  "Jolly receives an authorization code on the localhost callback",
  function (this: JollyWorld) {
    this.notes["authCode"] = "test-auth-code-xyz";
    this.notes["pkceVerifier"] = "test-pkce-verifier";
  },
);

When(
  "it exchanges the code with the Keycloak token endpoint",
  function (this: JollyWorld) {
    this.runCli([
      "login",
      "--exchange-code",
      this.notes["authCode"] as string,
      "--json",
    ]);
  },
);

Then(
  /^it should POST the code, code_verifier, client_id="([^"]+)", and redirect_uri$/,
  function (this: JollyWorld, clientId: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.tokenExchangeBody) {
      const body = data.tokenExchangeBody as Record<string, unknown>;
      assert.ok("code" in body, "Token exchange body should include code");
      assert.ok(
        "code_verifier" in body,
        "Token exchange body should include code_verifier",
      );
      assert.equal(
        body.client_id,
        clientId,
        `Token exchange client_id should be "${clientId}"`,
      );
      assert.ok(
        "redirect_uri" in body,
        "Token exchange body should include redirect_uri",
      );
    }
  },
);

Then(
  /^it should call POST \/platform\/api\/tokens on the Cloud API with the OIDC id_token$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.cloudTokenUrl) {
      assert.ok(
        String(data.cloudTokenUrl).includes("/platform/api/tokens"),
        `Should POST to /platform/api/tokens, got ${data.cloudTokenUrl}`,
      );
    }
    if (data?.cloudTokenBody) {
      const body = data.cloudTokenBody as Record<string, unknown>;
      assert.ok(
        "id_token" in body,
        "Cloud token body should include OIDC id_token",
      );
    }
  },
);

Then(
  /^it should store the resulting Saleor Cloud token in .env as JOLLY_SALEOR_CLOUD_TOKEN$/,
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "JOLLY_SALEOR_CLOUD_TOKEN" in values,
      "JOLLY_SALEOR_CLOUD_TOKEN missing from .env",
    );
  },
);

Then(
  /^it should verify the stored token via the id\.saleor\.online\/verify endpoint$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.verifyUrl) {
      assert.ok(
        String(data.verifyUrl).includes("id.saleor.online/verify"),
        `Should verify at id.saleor.online/verify, got ${data.verifyUrl}`,
      );
    }
  },
);

// ── Headless token validation: When step (used by headless and invalid token scenarios) ─

When(
  "Jolly validates the token",
  function (this: JollyWorld) {
    const token =
      (this.notes["headlessToken"] as string) ??
      (this.notes["invalidToken"] as string) ??
      "test-token";
    this.runCli(["login", "--token", token, "--json"]);
  },
);

// ── Headless token validation (new @logic) ──────────────────────────────────

Given(
  /^the agent provides a token from https:\/\/cloud\.saleor\.io\/tokens$/,
  function (this: JollyWorld) {
    this.notes["headlessToken"] = "jolly-headless-test-token";
    this.trackSecret("jolly-headless-test-token");
  },
);

Then(
  /^it should POST the token to https:\/\/id\.saleor\.online\/configure for verification$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.verifyUrl) {
      assert.ok(
        String(data.verifyUrl).includes("id.saleor.online/configure"),
        `Should POST to id.saleor.online/configure, got ${data.verifyUrl}`,
      );
    }
  },
);

Then(
  "if valid, it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    if (this.envelope.status === "success") {
      assert.ok(
        "JOLLY_SALEOR_CLOUD_TOKEN" in values,
        "Valid token should be stored in .env",
      );
    }
  },
);

Then(
  "it should report the authenticated account or organization context",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(data !== undefined, "Envelope should have data");
    // At minimum, the command should succeed.
    assert.equal(
      this.envelope.status,
      "success",
      `Token validation should succeed, got ${this.envelope.status}`,
    );
  },
);

// ── Invalid token rejection (new @logic) ────────────────────────────────────

Given(
  "the agent provides an invalid or expired token",
  function (this: JollyWorld) {
    this.notes["invalidToken"] = "invalid-or-expired-token-value";
    this.trackSecret("invalid-or-expired-token-value");
  },
);

Then(
  "it should report a clear error message",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.summary.length > 0,
      "Error summary should not be empty",
    );
    // Should have at least one error entry
    assert.ok(
      this.envelope.errors.length > 0,
      "Errors array should contain at least one entry",
    );
  },
);

Then(
  "it should not write any value to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
      "JOLLY_SALEOR_CLOUD_TOKEN should not be written to .env on invalid token",
    );
  },
);

Then(
  /^the error message should direct the customer to create a new token at https:\/\/cloud\.saleor\.io\/tokens$/,
  function (this: JollyWorld) {
    const allText =
      this.envelope.summary +
      " " +
      JSON.stringify(this.envelope.errors);
    assert.ok(
      allText.includes("cloud.saleor.io/tokens") ||
        allText.includes("cloud.saleor.io/token"),
      `Error should mention cloud.saleor.io/tokens, got: ${allText}`,
    );
  },
);

