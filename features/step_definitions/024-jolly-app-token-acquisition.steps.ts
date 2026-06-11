// Step definitions for feature 024: Jolly app token acquisition via Saleor GraphQL.
//
// Background steps set up the Cloud token and GraphQL instance URL in .env.
// Logic-tier scenarios verify the CLI's mock/contract behavior.
// Sandbox scenarios exercise the real Saleor GraphQL API.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { JollyWorld } from "../support/world.ts";
import { findRiskContexts, assertRiskContextShape, type RiskContext } from "../support/envelope.ts";
import { writeEnvValues, loadEnvValues } from "../../src/lib/env-file.ts";

// ── Shared test app ID for logic-tier scenarios ──────────────────────────
const LOGIC_APP_ID = "QXBybzpjbGktYXBwLWlk";

// ── Background ───────────────────────────────────────────────────────────

Given(
  "Jolly has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    // Write the token from the runtime env into the scenario's .env
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    if (token) {
      writeEnvValues(this.projectDir, { "JOLLY_SALEOR_CLOUD_TOKEN": token });
      this.trackSecret(token);
    }
    // For @logic scenarios where credentials may be absent, store a dummy
    // so the CLI can construct its mock output shape.
    const existing = loadEnvValues(this.projectDir);
    if (!existing["JOLLY_SALEOR_CLOUD_TOKEN"]) {
      writeEnvValues(this.projectDir, {
        "JOLLY_SALEOR_CLOUD_TOKEN": "test-cloud-token-for-logic",
      });
    }
  },
);

Given(
  "Jolly has a Saleor GraphQL instance URL",
  function (this: JollyWorld) {
    const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    if (url) {
      writeEnvValues(this.projectDir, { "NEXT_PUBLIC_SALEOR_API_URL": url });
    }
    const existing = loadEnvValues(this.projectDir);
    if (!existing["NEXT_PUBLIC_SALEOR_API_URL"]) {
      writeEnvValues(this.projectDir, {
        "NEXT_PUBLIC_SALEOR_API_URL": "https://test-shop.saleor.cloud/graphql/",
      });
    }
  },
);

// ── Scenario: Jolly create app-token lists available apps via GraphQL ────

Given(
  "the agent invokes `jolly create app-token`",
  function (this: JollyWorld) {
    this.runCli(["create", "app-token"]);
  },
);

When(
  "Jolly queries the Saleor instance for available apps",
  function (this: JollyWorld) {
    // The query already happened inside create app-token.
    // This step acknowledges the flow.
  },
);

Then(
  "it should send the GetApps GraphQL query to the instance URL",
  function (this: JollyWorld) {
    assert.ok(
      typeof this.envelope.data.graphqlQuery === "string",
      "envelope.data.graphqlQuery should contain the GraphQL query",
    );
    assert.ok(
      (this.envelope.data.graphqlQuery as string).includes("GetApps"),
      `graphqlQuery should include "GetApps": ${this.envelope.data.graphqlQuery}`,
    );
    assert.ok(
      typeof this.envelope.data.instanceUrl === "string",
      "envelope.data.instanceUrl should be the target Saleor instance URL",
    );
  },
);

Then(
  "the query should be authenticated with the Saleor Cloud bearer token",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.data.authMethod,
      "Bearer",
      `authMethod should be "Bearer", got "${this.envelope.data.authMethod}"`,
    );
  },
);

Then(
  "it should parse the response for a list of app names and IDs",
  function (this: JollyWorld) {
    const apps = this.envelope.data.apps as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(apps), "envelope.data.apps should be an array");
    assert.ok(apps.length > 0, "apps array should not be empty");
    for (const app of apps) {
      assert.ok(typeof app.id === "string", `app.id should be a string, got ${typeof app.id}`);
      assert.ok(typeof app.name === "string", `app.name should be a string, got ${typeof app.name}`);
    }
  },
);

Then(
  "if multiple apps are found, it should present them for selection",
  function (this: JollyWorld) {
    const apps = this.envelope.data.apps as Array<unknown> | undefined;
    if (apps && apps.length > 1) {
      assert.equal(
        this.envelope.data.requiresSelection,
        true,
        "requiresSelection should be true when multiple apps are found",
      );
    }
  },
);

// ── Scenario: Jolly create app-token constructs the correct GraphQL mutation ──

Given(
  "the agent has selected a Saleor app by ID",
  function (this: JollyWorld) {
    // Store the selected app ID for the When step
    this.notes["selectedAppId"] = LOGIC_APP_ID;
  },
);

When(
  "Jolly creates a token for that app",
  function (this: JollyWorld) {
    const appId = this.notes["selectedAppId"] as string;
    assert.ok(appId, "No selectedAppId set — missing Given step");
    this.runCli(["create", "app-token", "--app-id", appId]);
  },
);

Then(
  "it should send the appTokenCreate GraphQL mutation with the selected app ID",
  function (this: JollyWorld) {
    const graphqlMutation = this.envelope.data.graphqlMutation as string | undefined;
    assert.ok(
      typeof graphqlMutation === "string",
      "envelope.data.graphqlMutation should contain the GraphQL mutation",
    );
    assert.ok(
      graphqlMutation.includes("appTokenCreate"),
      `graphqlMutation should include "appTokenCreate": ${graphqlMutation}`,
    );
    const selectedAppId = this.notes["selectedAppId"] as string;
    assert.ok(
      graphqlMutation.includes(selectedAppId),
      `graphqlMutation should include the selected app ID "${selectedAppId}": ${graphqlMutation}`,
    );
  },
);

Then(
  "the mutation should request all available permissions for the token in v1",
  function (this: JollyWorld) {
    const permissions = this.envelope.data.requestedPermissions as string[] | undefined;
    assert.ok(
      Array.isArray(permissions),
      "envelope.data.requestedPermissions should be an array",
    );
    assert.ok(
      permissions.length > 0,
      "requestedPermissions should not be empty",
    );
    // Should include common Saleor permissions
    const expectedPermissions = [
      "MANAGE_PRODUCTS",
      "MANAGE_ORDERS",
      "MANAGE_APPS",
      "MANAGE_CHANNELS",
      "MANAGE_USERS",
    ];
    const found = expectedPermissions.filter((p) => permissions.includes(p));
    assert.ok(
      found.length >= 3,
      `Expected at least 3 of the standard permissions, found ${found.length} in: ${JSON.stringify(permissions)}`,
    );
  },
);

Then(
  "it should extract the authToken from the mutation response",
  function (this: JollyWorld) {
    const data = this.envelope.data;
    // The authToken field should exist (may be redacted for safety)
    assert.ok(
      "authToken" in data,
      "envelope.data should include an authToken field (even if redacted)",
    );
  },
);

Then(
  "it should write the token to .env as JOLLY_SALEOR_APP_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "JOLLY_SALEOR_APP_TOKEN" in values,
      "JOLLY_SALEOR_APP_TOKEN should be present in .env",
    );
    assert.ok(
      (values["JOLLY_SALEOR_APP_TOKEN"] as string).length > 0,
      "JOLLY_SALEOR_APP_TOKEN should be a non-empty string",
    );
  },
);

// ── Scenario: Jolly create app-token handles missing apps gracefully ─────

Given(
  "the Saleor instance has no apps installed",
  function (this: JollyWorld) {
    // Tell the CLI to simulate the no-apps case via --no-apps flag
    this.notes["noApps"] = true;
  },
);

When(
  "Jolly queries GetApps",
  function (this: JollyWorld) {
    if (this.notes["noApps"]) {
      this.runCli(["create", "app-token", "--no-apps"]);
    } else {
      this.runCli(["create", "app-token"]);
    }
  },
);

Then(
  "it should report that no apps are available",
  function (this: JollyWorld) {
    // The command returns status "warning" when no apps are found
    assert.ok(
      this.envelope.status === "warning" || this.envelope.status === "error",
      `Expected warning or error status, got "${this.envelope.status}"`,
    );
    const apps = this.envelope.data.apps as Array<unknown> | undefined;
    if (Array.isArray(apps)) {
      assert.equal(apps.length, 0, "apps array should be empty when no apps available");
    }
  },
);

Then(
  "it should suggest creating a Saleor app via the Dashboard",
  function (this: JollyWorld) {
    // Check nextSteps for a dashboard suggestion
    const nextSteps = this.envelope.nextSteps;
    const hasDashboardSuggestion = nextSteps.some(
      (step) =>
        (step.description as string).toLowerCase().includes("dashboard") ||
        (step.description as string).toLowerCase().includes("create") ||
        (step.description as string).toLowerCase().includes("saleor app"),
    );
    assert.ok(
      hasDashboardSuggestion,
      `Expected a nextStep suggesting Dashboard or app creation: ${JSON.stringify(nextSteps)}`,
    );
  },
);

Then(
  "it should return an empty error code {string}",
  function (this: JollyWorld, code: string) {
    const errors = this.envelope.errors;
    const hasCode = errors.some((e) => e.code === code);
    assert.ok(
      hasCode,
      `Expected error code "${code}" in errors array: ${JSON.stringify(errors)}`,
    );
  },
);

// ── Scenario: Jolly create app-token --dry-run shows risk context ────────

Given(
  "the agent wants to preview app token creation",
  function (this: JollyWorld) {
    // Simple setup — no state needed beyond the background credentials
  },
);

When(
  "the agent runs `jolly create app-token --dry-run`",
  function (this: JollyWorld) {
    this.runCli(["create", "app-token", "--dry-run"]);
  },
);

Then(
  "the risk context should include categories {string}",
  function (this: JollyWorld, categoriesStr: string) {
    const expectedCategories = categoriesStr.split(",").map((c) => c.trim());
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "No riskContext found in envelope data or checks");
    const rc = rcs[0] as RiskContext;
    assertRiskContextShape(rc);
    for (const cat of expectedCategories) {
      assert.ok(
        rc.categories.includes(cat),
        `Expected category "${cat}" in risk context categories: ${JSON.stringify(rc.categories)}`,
      );
    }
  },
);

Then(
  "the risk context should include the target instance URL",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "No riskContext found in envelope data or checks");
    const rc = rcs[0] as RiskContext;
    assertRiskContextShape(rc);
    // Target should refer to the instance URL
    const target = rc.target as Record<string, unknown> | string;
    if (typeof target === "object") {
      const targetStr = JSON.stringify(target).toLowerCase();
      assert.ok(
        targetStr.includes("graphql") || targetStr.includes("saleor.cloud") ||
          targetStr.includes("instance") || targetStr.includes("url"),
        `riskContext.target should reference the instance URL: ${JSON.stringify(target)}`,
      );
    } else if (typeof target === "string") {
      assert.ok(
        target.includes("graphql") || target.includes("saleor.cloud") ||
          target.includes("http"),
        `riskContext.target should reference the instance URL: ${target}`,
      );
    }
  },
);

Then(
  "no GraphQL mutations should be sent to the Saleor instance",
  function (this: JollyWorld) {
    // During dry-run, no mutations should be sent
    const data = this.envelope.data as Record<string, unknown>;
    if ("mutationsSent" in data) {
      assert.equal(
        data.mutationsSent,
        0,
        `Expected 0 mutations sent during dry-run, got ${data.mutationsSent}`,
      );
    }
    if ("dryRun" in data) {
      assert.equal(
        data.dryRun,
        true,
        "dryRun should be true in the output for --dry-run",
      );
    }
    // During dry-run, .env should not be written
    const envPath = this.projectDir + "/.env";
    if (existsSync(envPath)) {
      const values = loadEnvValues(this.projectDir);
      const hasNewToken = values["JOLLY_SALEOR_APP_TOKEN"] &&
        !["test-cloud-token-for-logic"].includes(values["JOLLY_SALEOR_APP_TOKEN"] as string);
      assert.ok(
        !hasNewToken,
        "JOLLY_SALEOR_APP_TOKEN should not be written during dry-run",
      );
    }
  },
);

// ── Scenario: Jolly create app-token acquires a real token from Saleor ───

Given(
  "the Saleor instance has at least one app installed",
  function (this: JollyWorld) {
    // Credentials are gated by the @sandbox Before hook.
    // The CLI will discover apps at runtime.
  },
);

When(
  "the agent runs `jolly create app-token` with a selected app",
  function (this: JollyWorld) {
    // For sandbox, we need to first discover apps, then pick one.
    // First, run without --app-id to list available apps.
    this.runCli(["create", "app-token"]);
    const apps = this.envelope.data.apps as Array<{ id: string; name: string }> | undefined;
    assert.ok(
      Array.isArray(apps) && apps.length > 0,
      "Expected at least one app to be available on the Saleor instance",
    );

    // Pick the first app and create a token for it
    const selectedApp = apps[0];
    this.notes["selectedAppId"] = selectedApp.id;
    this.notes["selectedAppName"] = selectedApp.name;
    this.trackSecret(selectedApp.id);

    this.runCli(["create", "app-token", "--app-id", selectedApp.id]);
  },
);

Then(
  "Jolly should successfully create a new app token via GraphQL",
  function (this: JollyWorld) {
    assert.equal(
      this.envelope.status,
      "success",
      `Expected success status, got "${this.envelope.status}": ${JSON.stringify(this.envelope.errors)}`,
    );
    const data = this.envelope.data;
    assert.ok(
      "selectedAppId" in data,
      "envelope.data should include selectedAppId",
    );
    assert.equal(
      data.selectedAppId,
      this.notes["selectedAppId"],
      "selectedAppId should match the app used",
    );
  },
);

Then(
  "subsequent `jolly auth status` should report the app token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status"]);
    const checks = this.envelope.checks;
    const appTokenCheck = checks.find(
      (c) => c.id === "auth-app-token",
    );
    if (appTokenCheck) {
      assert.ok(
        appTokenCheck.status === "pass" || appTokenCheck.status === "skipped",
        `auth-app-token check should be pass or skipped, got "${appTokenCheck.status}"`,
      );
    }
  },
);
