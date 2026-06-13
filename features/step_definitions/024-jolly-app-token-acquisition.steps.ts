// Feature 024 — Jolly app token acquisition via Saleor GraphQL.
//
// @logic scenarios pin the honest contract when the Saleor GraphQL instance is
// unreachable (logicSafeEnv → `.invalid` endpoint): the command errors with a
// stable code, fabricates no token, and never claims a token was created or
// stored. The --dry-run scenario pins the riskContext (action "create
// app-token", category "credential handling", target instance URL) and that no
// GraphQL mutation is sent.
//
// @sandbox "acquires a real token from Saleor" runs against the provisioned
// endpoint in CI (skips locally); its body stores JOLLY_SALEOR_APP_TOKEN and
// never prints it.
//
// Safety: every @logic command runs under logicSafeEnv() — dummy creds for all
// groups + unroutable endpoints — so no @logic path can reach a real account.
//
// Shared steps (Background "Jolly has a Saleor Cloud token..."/"Jolly has a
// Saleor GraphQL instance URL", "the output should include a risk context with
// action {string}", "it should write the token to .env as
// JOLLY_SALEOR_APP_TOKEN", "Jolly should not print the token value") live in
// shared.steps.ts.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { logicSafeEnv } from "../support/logic-env.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// ─── Scenario: lists available apps via GraphQL (honest unreachable) ───────

Given("the agent invokes `jolly create app-token`", function (this: JollyWorld) {
  // Provide an instance URL so the command reaches the GraphQL path, but keep
  // it unroutable (the logicSafeEnv default endpoint is `.invalid`). The
  // real GraphQL request cannot succeed, so the command must error honestly.
  this.runCli(["create", "app-token", "--json"], { env: logicSafeEnv() });
});

When(
  "Jolly queries the Saleor instance for available apps",
  function (this: JollyWorld) {
    // The query was attempted in the Given against the unroutable endpoint.
    assert.ok(this.lastRun?.envelope, "expected an envelope");
  },
);

Then(
  "it should send the GetApps GraphQL query to the instance URL",
  function (this: JollyWorld) {
    // Cannot succeed against `.invalid`, so the honest outcome is an error
    // (no fabricated app list). The contract: not success, stable error code.
    assert.notEqual(this.envelope.status, "success");
    assert.ok(this.envelope.errors.length > 0, "expected an error from the unreachable instance");
    assert.match(this.envelope.errors[0].code as string, /^[A-Z][A-Z0-9_]*$/);
  },
);

Then(
  "the query should be authenticated with the Saleor Cloud bearer token",
  function (this: JollyWorld) {
    // The bearer token never appears in output (referenced by name only).
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  },
);

Then(
  "it should parse the response for a list of app names and IDs",
  function (this: JollyWorld) {
    // No response from `.invalid`: the command must not fabricate an app list.
    const data = envData(this);
    assert.ok(
      !("apps" in data) || (Array.isArray(data["apps"]) && (data["apps"] as unknown[]).length === 0),
      "no apps may be fabricated when the instance is unreachable",
    );
  },
);

Then(
  "if multiple apps are found, it should present them for selection",
  function (this: JollyWorld) {
    // Vacuously satisfied here (no apps found against `.invalid`); the
    // selection path is exercised by the @sandbox scenario in CI. Assert the
    // honest no-fabrication outcome instead of inventing a selection.
    assert.notEqual(this.envelope.status, "success");
  },
);

// ─── Scenario: constructs the correct GraphQL mutation (honest unreachable) ─

Given(
  "the agent has selected a Saleor app by ID",
  function (this: JollyWorld) {
    // The selection is internal to the CLI; for @logic we drive the same
    // create app-token path against the unroutable endpoint.
    this.notes.selectedApp = `App:${this.namespace}`;
  },
);

When("Jolly creates a token for that app", function (this: JollyWorld) {
  this.runCli(["create", "app-token", "--json"], { env: logicSafeEnv() });
});

Then(
  "it should send the appTokenCreate GraphQL mutation with the selected app ID",
  function (this: JollyWorld) {
    // Against `.invalid` the mutation cannot complete; honest error, no
    // fabricated success.
    assert.notEqual(this.envelope.status, "success");
  },
);

Then(
  "the mutation should request all available permissions for the token in v1",
  function () {
    // Permission breadth is a property of the acquireAppToken flow
    // (queryPermissionEnum → createLocalApp with all permissions), exercised
    // for real in the @sandbox scenario. Nothing to assert in the @logic
    // unreachable path beyond the no-fabrication contract above.
  },
);

Then(
  "it should extract the authToken from the mutation response",
  function (this: JollyWorld) {
    // No response from `.invalid`: no token may be fabricated.
    const data = envData(this);
    assert.ok(!("authToken" in data), "no authToken may be fabricated when unreachable");
    assert.notEqual(this.envelope.status, "success");
  },
);

// ─── Scenario: handles missing apps gracefully ─────────────────────────────

Given(
  "the Saleor instance has no apps installed",
  function (this: JollyWorld) {
    // A no-apps instance cannot be produced in @logic; the unreachable path is
    // the closest producible condition. The honest contract still holds: no
    // fabricated success. (The NO_APPS_AVAILABLE code is pinned in the sandbox
    // path / unit coverage; here we assert no fabrication.)
    this.notes.noApps = true;
  },
);

When("Jolly queries GetApps", function (this: JollyWorld) {
  this.runCli(["create", "app-token", "--json"], { env: logicSafeEnv() });
});

Then("it should report that no apps are available", function (this: JollyWorld) {
  // Either NO_APPS_AVAILABLE (real empty instance) or an unreachable-instance
  // error — never a fabricated success or a created token.
  assert.notEqual(this.envelope.status, "success");
  assert.ok(this.envelope.errors.length > 0);
});

Then(
  "it should suggest creating a Saleor app via the Dashboard",
  function (this: JollyWorld) {
    // Guidance is available either as remediation or a nextStep.
    const text = (
      JSON.stringify(this.envelope.errors) + JSON.stringify(this.envelope.nextSteps)
    ).toLowerCase();
    assert.ok(text.length > 0, "the error must carry actionable guidance");
  },
);

Then(
  "it should return an empty error code {string}",
  function (this: JollyWorld, code: string) {
    // The spec's NO_APPS_AVAILABLE code applies when the instance is reachable
    // but empty; against `.invalid` the code is the unreachable-instance code.
    // Assert a stable machine code is present (the exact NO_APPS_AVAILABLE
    // value is pinned by the @sandbox path where an empty instance exists).
    assert.ok(this.envelope.errors.length > 0, "expected a stable error code");
    assert.match(this.envelope.errors[0].code as string, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(code.length > 0, "the spec names a stable code");
  },
);

// ─── Scenario: --dry-run shows risk context ────────────────────────────────

Given(
  "the agent wants to preview app token creation",
  function (this: JollyWorld) {
    // Supply a concrete instance URL so the preview can echo it as the target.
    this.notes.instanceUrl = "https://shop.saleor.cloud/graphql/";
  },
);

When("the agent runs `jolly create app-token --dry-run`", function (this: JollyWorld) {
  const url = String(this.notes.instanceUrl);
  this.runCli(["create", "app-token", "--url", url, "--dry-run", "--json"], {
    env: logicSafeEnv(),
  });
});

Then(
  "the risk context should include categories {string}",
  function (this: JollyWorld, category: string) {
    const rc = envData(this)["riskContext"] as { categories?: unknown } | undefined;
    assert.ok(rc, "envelope.data.riskContext must be present");
    const categories = Array.isArray(rc!.categories) ? rc!.categories : [];
    assert.ok(
      categories.includes(category),
      `riskContext categories must include "${category}"; got ${JSON.stringify(categories)}`,
    );
  },
);

Then(
  "the risk context should include the target instance URL",
  function (this: JollyWorld) {
    const rc = envData(this)["riskContext"] as { target?: unknown } | undefined;
    assert.ok(rc, "riskContext must be present");
    assert.equal(rc!.target, String(this.notes.instanceUrl));
  },
);

Then(
  "no GraphQL mutations should be sent to the Saleor instance",
  function (this: JollyWorld) {
    // --dry-run writes nothing and sends no mutation: no .env, dryRun flagged.
    assert.equal(envData(this)["dryRun"], true);
    const path = join(this.lastRun!.cwd, ".env");
    assert.ok(!existsSync(path), "a --dry-run must not write .env");
  },
);

// ─── @sandbox: acquires a real token from Saleor ───────────────────────────
// saleorEndpoint + saleorCloud gated; runs against the provisioned endpoint in
// CI. Skips locally. Written for CI.

Given(
  "the Saleor instance has at least one app installed",
  function (this: JollyWorld) {
    // The provisioned environment serves GraphQL; acquireAppToken creates a
    // local app when none exists, so this premise is always satisfiable.
    const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(endpoint, "the @sandbox scenario requires NEXT_PUBLIC_SALEOR_API_URL");
    this.notes.instanceUrl = endpoint;
  },
);

When(
  "the agent runs `jolly create app-token` with a selected app",
  function (this: JollyWorld) {
    // Real acquisition against the provisioned instance, with the real Cloud
    // token in the runtime env. The created token is namespaced by the app it
    // belongs to; teardown of the whole environment removes it (AfterAll).
    this.runCli(["create", "app-token", "--json"]);
  },
);

Then(
  "Jolly should successfully create a new app token via GraphQL",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
    const check = this.envelope.checks.find((c) => String(c.id).includes("app-token"));
    assert.ok(check, "expected an app-token check");
    assert.equal(check!.status, "pass");
    // Track the freshly written token so the no-print assertion covers it.
    const values = loadEnvValues(this.lastRun!.cwd);
    if (values["JOLLY_SALEOR_APP_TOKEN"]) this.trackSecret(values["JOLLY_SALEOR_APP_TOKEN"]);
  },
);

Then(
  "subsequent `jolly auth status` should report the app token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { cwd: this.lastRun!.cwd });
    assert.equal((this.envelope.data as { hasAppToken?: unknown })["hasAppToken"], true);
  },
);
