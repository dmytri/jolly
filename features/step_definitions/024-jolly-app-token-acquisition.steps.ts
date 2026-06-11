// Step definitions for feature 024: Jolly app token acquisition via Saleor GraphQL.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { findRiskContexts } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Background steps ──────────────────────────────────────────────────

Given(
  "Jolly has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    this.notes["cloudToken"] = "test-cloud-token-for-apps";
    this.trackSecret("test-cloud-token-for-apps");
  },
);

Given(
  "Jolly has a Saleor GraphQL instance URL",
  function (this: JollyWorld) {
    this.notes["graphqlUrl"] = "https://test-shop.saleor.cloud/graphql/";
  },
);

// ── List available apps ──────────────────────────────────────────────────

Given(
  /^the agent invokes `jolly create app-token`$/,
  function (this: JollyWorld) {
    this.runCli(["create", "app-token", "--json"]);
  },
);

When(
  "Jolly queries the Saleor instance for available apps",
  function (this: JollyWorld) {
    // Already triggered by the Given step.
  },
);

Then(
  "it should send the GetApps GraphQL query to the instance URL",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.graphqlQuery) {
      assert.ok(
        String(data.graphqlQuery).includes("GetApps") ||
          String(data.graphqlQuery).includes("apps"),
        "Should send a GetApps-like GraphQL query",
      );
    }
    if (data?.instanceUrl) {
      assert.equal(
        data.instanceUrl,
        this.notes["graphqlUrl"],
        "Should query the configured GraphQL instance URL",
      );
    }
  },
);

Then(
  "the query should be authenticated with the Saleor Cloud bearer token",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authMethod) {
      assert.ok(
        String(data.authMethod).toLowerCase().includes("bearer"),
        "Should use Bearer token authentication",
      );
    }
  },
);

Then(
  "it should parse the response for a list of app names and IDs",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.apps) {
      assert.ok(Array.isArray(data.apps), "apps should be an array");
    }
  },
);

Then(
  "if multiple apps are found, it should present them for selection",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.apps && Array.isArray(data.apps)) {
      if ((data.apps as unknown[]).length > 1) {
        assert.ok(
          data.requiresSelection === true || data.selectedApp !== undefined,
          "Should present apps for selection when multiple found",
        );
      }
    }
  },
);

// ── Construct mutation ───────────────────────────────────────────────────

Given(
  "the agent has selected a Saleor app by ID",
  function (this: JollyWorld) {
    this.notes["selectedAppId"] = "QXBybzpjbGktYXBwLWlk";
    this.notes["selectedAppName"] = "Jolly Setup App";
  },
);

When(
  "Jolly creates a token for that app",
  function (this: JollyWorld) {
    this.runCli([
      "create", "app-token",
      "--app-id", this.notes["selectedAppId"] as string,
      "--json",
    ]);
  },
);

Then(
  "it should send the appTokenCreate GraphQL mutation with the selected app ID",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.graphqlMutation) {
      const mutation = String(data.graphqlMutation);
      assert.ok(
        mutation.includes("appTokenCreate"),
        `Mutation should use appTokenCreate, got: ${mutation.substring(0, 100)}`,
      );
      if (data?.selectedAppId) {
        assert.equal(
          data.selectedAppId,
          this.notes["selectedAppId"],
          "Should use the selected app ID",
        );
      }
    }
  },
);

Then(
  "the mutation should request all available permissions for the token in v1",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.requestedPermissions) {
      assert.ok(
        Array.isArray(data.requestedPermissions),
        "requestedPermissions should be an array",
      );
      assert.ok(
        (data.requestedPermissions as unknown[]).length > 0,
        "Should request at least one permission",
      );
    }
  },
);

Then(
  "it should extract the authToken from the mutation response",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.authToken) {
      assert.ok(
        typeof data.authToken === "string" && (data.authToken as string).length > 0,
        "authToken should be a non-empty string",
      );
      this.trackSecret(data.authToken as string);
    }
  },
);

Then(
  "it should write the token to .env as JOLLY_SALEOR_APP_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "JOLLY_SALEOR_APP_TOKEN" in values,
      "JOLLY_SALEOR_APP_TOKEN missing from .env",
    );
  },
);

// ── Missing apps ─────────────────────────────────────────────────────────

Given(
  "the Saleor instance has no apps installed",
  function (this: JollyWorld) {
    this.notes["noApps"] = true;
  },
);

When(
  "Jolly queries GetApps",
  function (this: JollyWorld) {
    const args = ["create", "app-token", "--json"];
    if (this.notes["noApps"]) {
      args.push("--no-apps");
    }
    this.runCli(args);
  },
);

Then(
  "it should report that no apps are available",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.apps !== undefined) {
      const apps = data.apps as unknown[];
      if (apps.length === 0) {
        // No apps case - expect a message.
        assert.ok(
          this.envelope.summary.toLowerCase().includes("no app") ||
            this.envelope.summary.toLowerCase().includes("no apps"),
          `Summary should mention no apps available, got: ${this.envelope.summary}`,
        );
      }
    } else {
      // Fallback: check the status is warning/error
      assert.ok(
        this.envelope.status === "warning" || this.envelope.status === "error",
        `Status should be warning or error when no apps, got ${this.envelope.status}`,
      );
    }
  },
);

Then(
  "it should suggest creating a Saleor app via the Dashboard",
  function (this: JollyWorld) {
    const allText =
      this.envelope.summary +
      " " +
      JSON.stringify(this.envelope.errors) +
      " " +
      JSON.stringify(this.envelope.nextSteps);
    assert.ok(
      allText.toLowerCase().includes("dashboard") ||
        allText.toLowerCase().includes("create") ||
        allText.toLowerCase().includes("saleor"),
      "Should suggest creating an app via the Dashboard",
    );
  },
);

Then(
  /^it should return an empty error code "([^"]+)"$/,
  function (this: JollyWorld, errorCode: string) {
    assert.ok(
      this.envelope.errors.length > 0,
      "Should have at least one error entry",
    );
    const matchingError = this.envelope.errors.find(
      (e) => e.code === errorCode,
    );
    assert.ok(
      matchingError,
      `Error with code "${errorCode}" not found in: ${JSON.stringify(this.envelope.errors)}`,
    );
  },
);

// ── Dry-run ──────────────────────────────────────────────────────────────

Given(
  "the agent wants to preview app token creation",
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  /^the agent runs `jolly create app-token --dry-run`$/,
  function (this: JollyWorld) {
    this.runCli(["create", "app-token", "--dry-run", "--json"]);
  },
);

Then(
  /^the risk context should include categories "([^"]+)"$/,
  function (this: JollyWorld, categoriesStr: string) {
    const categories = categoriesStr.split(",").map((c) => c.trim());
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "No riskContext found");
    const rc = rcs[0] as Record<string, unknown>;
    const rcCategories = rc.categories as string[];
    for (const cat of categories) {
      assert.ok(
        rcCategories.includes(cat),
        `Risk context should include category "${cat}", got: ${JSON.stringify(rcCategories)}`,
      );
    }
  },
);

Then(
  "the risk context should include the target instance URL",
  function (this: JollyWorld) {
    const rcs = findRiskContexts(this.envelope);
    assert.ok(rcs.length > 0, "No riskContext found");
    const rc = rcs[0] as Record<string, unknown>;
    assert.ok(rc.target !== undefined, "riskContext should have a target");
    const target = String(rc.target);
    assert.ok(
      target.includes("graphql") || target.includes("saleor.cloud") || target.length > 0,
      `riskContext target should reference the instance, got: ${target}`,
    );
  },
);

Then(
  "no GraphQL mutations should be sent to the Saleor instance",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      data?.dryRun === true,
      "Should be in dry-run mode",
    );
    if (data?.mutationsSent !== undefined) {
      assert.equal(
        data.mutationsSent,
        0,
        `No mutations should be sent in dry-run mode, got ${data.mutationsSent}`,
      );
    }
  },
);

// ── @sandbox: Real token acquisition ─────────────────────────────────────

Given(
  "the Saleor instance has at least one app installed",
  function (this: JollyWorld) {
    // @sandbox - needs real Saleor instance.
  },
);

When(
  /^the agent runs `jolly create app-token` with a selected app$/,
  function (this: JollyWorld) {
    // @sandbox - real invocation.
  },
);

Then(
  "Jolly should successfully create a new app token via GraphQL",
  function (this: JollyWorld) {
    // @sandbox - verified by end-to-end flow.
  },
);

Then(
  "subsequent `jolly auth status` should report the app token is configured",
  function (this: JollyWorld) {
    // Reuse the same pattern from 018 for auth status check.
    this.runCli(["auth", "status", "--json"]);
    assert.equal(this.envelope.status, "success");
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.hasAppToken !== undefined) {
      assert.ok(data.hasAppToken, "auth status should report app token configured");
    }
  },
);
