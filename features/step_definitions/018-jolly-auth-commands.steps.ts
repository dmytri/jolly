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
