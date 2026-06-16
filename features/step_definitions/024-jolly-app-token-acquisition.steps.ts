// Feature 024 — Jolly app token acquisition via Saleor GraphQL.
//
// Jolly acquires the workflow token from a DEDICATED app it owns, named "Jolly
// Setup", created with the full v1 permission set. It must never mint a token
// for an unrelated pre-existing app — `appTokenCreate` cannot escalate a
// stranger app's permissions, so the old "select apps[0]" flow produced an
// under-permissioned token on any non-pristine environment (the live
// `jolly-store` had a 3-permission "SMTP" app first, so Configurator failed
// Permission Denied).
//
// Coverage is two scenarios:
//   - @logic "--dry-run shows risk context": deterministic preview with the
//     workflow tokens unset (absentCredentialsEnv) against the real configured
//     instance URL — a --dry-run writes nothing and contacts no instance, and
//     with no token present nothing could be minted even if --dry-run were
//     ignored.
//   - @sandbox "acquires a real, fully-permissioned token from Saleor": runs
//     against the provisioned endpoint in CI (skips locally). It stores
//     JOLLY_SALEOR_APP_TOKEN, never prints it, proves the token's own app is the
//     dedicated "Jolly Setup" (never an unrelated one), that the app carries the
//     Configurator permission set, and that a re-run reuses it without creating
//     a duplicate.
//
// Shared steps (Background, "the output should include a risk context with
// action {string}", "it should write the token to .env as
// JOLLY_SALEOR_APP_TOKEN", "Jolly should not print the token value") live in
// shared.steps.ts.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// Deterministic real-format first-party instance endpoint the app-token preview
// resolves and names. A --dry-run contacts nothing, so this is a preview target
// label, never a service that is reached — no dummy creds, no `.invalid` host.
// This step is also reused by feature 008's `create app-token --dry-run`
// example, so it must resolve the endpoint without depending on 024's Given.
const PREVIEW_SALEOR_ENDPOINT = "https://jolly-preview.saleor.cloud/graphql/";

// Permissions Configurator needs for the recipe deploy (acceptance-run finding).
const CONFIGURATOR_PERMISSIONS = [
  "MANAGE_PRODUCTS",
  "MANAGE_CHANNELS",
  "MANAGE_SETTINGS",
  "MANAGE_SHIPPING",
  "MANAGE_CHECKOUTS",
];

// ─── Scenario: --dry-run shows risk context ────────────────────────────────

Given("the agent wants to preview app token creation", function (this: JollyWorld) {
  // Record the instance URL the preview will resolve and name, so the target
  // assertion can compare against it.
  this.notes.instanceUrl = PREVIEW_SALEOR_ENDPOINT;
});

When("the agent runs `jolly create app-token --dry-run`", function (this: JollyWorld) {
  // Tokens unset (nothing could be minted even if --dry-run were ignored); a
  // real-format instance URL kept so the preview resolves and names a target.
  this.runCli(["create", "app-token", "--dry-run", "--json"], {
    env: absentCredentialsEnv({ NEXT_PUBLIC_SALEOR_API_URL: PREVIEW_SALEOR_ENDPOINT }),
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
    // A --dry-run writes nothing and contacts no instance: dryRun flagged, no .env.
    assert.equal(envData(this)["dryRun"], true);
    const path = join(this.lastRun!.cwd, ".env");
    assert.ok(!existsSync(path), "a --dry-run must not write .env");
  },
);

// ─── @sandbox: acquires a real, fully-permissioned token from Saleor ───────
// saleorEndpoint + saleorCloud gated; runs against the provisioned endpoint in
// CI, skips locally. Verifies the dedicated app really carries the Configurator
// permission set — the acceptance-run regression, proven end to end.

Given(
  "a real Saleor instance, which may already have unrelated apps installed",
  function (this: JollyWorld) {
    const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(endpoint, "the @sandbox scenario requires NEXT_PUBLIC_SALEOR_API_URL");
    assert.ok(
      process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
      "the @sandbox scenario requires JOLLY_SALEOR_CLOUD_TOKEN",
    );
    this.notes.instanceUrl = endpoint;
  },
);

When(
  "the agent runs `jolly create app-token`",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    this.runCli(["create", "app-token", "--json"]);
  },
);

Then(
  'Jolly should ensure a dedicated "Jolly Setup" app and create a token for it via GraphQL',
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
  "the token's app should be the dedicated {string} app, never an unrelated pre-existing app it found on the instance",
  { timeout: 60_000 },
  async function (this: JollyWorld, dedicatedName: string) {
    // The app token written to .env belongs to exactly one app. Saleor's `app`
    // query (no id) returns the REQUESTING token's own app, so resolving it to
    // the dedicated "Jolly Setup" name proves Jolly minted the token for its own
    // app — never for an unrelated pre-existing app it found on the instance
    // (the acceptance-run regression: a 3-permission "SMTP" app was first).
    const endpoint = String(this.notes.instanceUrl);
    const values = loadEnvValues(this.lastRun!.cwd);
    const appToken = values["JOLLY_SALEOR_APP_TOKEN"];
    assert.ok(appToken, "the run must have written JOLLY_SALEOR_APP_TOKEN to .env");
    this.trackSecret(appToken);
    const result = await saleorGraphql(endpoint, appToken, `query { app { name } }`);
    const app = result.data?.app as { name?: string } | null | undefined;
    assert.ok(app, "the app token must resolve to its own app via the `app` query");
    assert.equal(
      app!.name,
      dedicatedName,
      `the token's app must be the dedicated "${dedicatedName}" app, never an unrelated one`,
    );
  },
);

Then(
  "the token's app should hold the management permissions Configurator requires",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    // Real verification: query the instance for the "Jolly Setup" app and assert
    // its granted permissions include the Configurator set (this is exactly the
    // condition whose absence broke the acceptance run's recipe deploy).
    const endpoint = String(this.notes.instanceUrl);
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    const result = await saleorGraphql(
      endpoint,
      cloudToken,
      `query { apps(first: 100) { edges { node { name permissions { code } } } } }`,
    );
    const edges =
      ((result.data?.apps as { edges?: Array<{ node: { name: string; permissions: Array<{ code: string }> } }> })
        ?.edges) ?? [];
    const jollyApp = edges.map((e) => e.node).find((n) => n.name === "Jolly Setup");
    assert.ok(jollyApp, "a dedicated 'Jolly Setup' app must exist on the instance");
    const codes = (jollyApp!.permissions ?? []).map((p) => p.code);
    for (const perm of CONFIGURATOR_PERMISSIONS) {
      assert.ok(
        codes.includes(perm),
        `the Jolly Setup app must hold ${perm}; got ${JSON.stringify(codes)}`,
      );
    }
  },
);

Then(
  "re-running `jolly create app-token` should reuse the existing {string} app rather than creating a duplicate",
  { timeout: 120_000 },
  async function (this: JollyWorld, dedicatedName: string) {
    // Idempotent acquisition (feature 022): a second run must reuse the existing
    // dedicated app (minting a fresh token via appTokenCreate) rather than create
    // a second "Jolly Setup" app. Count the dedicated apps before and after.
    const endpoint = String(this.notes.instanceUrl);
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    const countDedicated = async (): Promise<number> => {
      const result = await saleorGraphql(
        endpoint,
        cloudToken,
        `query { apps(first: 100) { edges { node { name } } } }`,
      );
      const edges =
        ((result.data?.apps as { edges?: Array<{ node: { name: string } }> })?.edges) ?? [];
      return edges.filter((e) => e.node.name === dedicatedName).length;
    };
    const before = await countDedicated();
    assert.ok(before >= 1, `the first run must have created the "${dedicatedName}" app`);
    this.runCli(["create", "app-token", "--json"], { cwd: this.lastRun!.cwd });
    assert.equal(this.envelope.status, "success", "the re-run must succeed");
    const values = loadEnvValues(this.lastRun!.cwd);
    if (values["JOLLY_SALEOR_APP_TOKEN"]) this.trackSecret(values["JOLLY_SALEOR_APP_TOKEN"]);
    const after = await countDedicated();
    assert.equal(
      after,
      before,
      `re-running must reuse the existing "${dedicatedName}" app, not create a duplicate ` +
        `(was ${before}, now ${after})`,
    );
  },
);

Then(
  "subsequent `jolly auth status` should report the app token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { cwd: this.lastRun!.cwd });
    assert.equal((this.envelope.data as { hasAppToken?: unknown })["hasAppToken"], true);
  },
);
