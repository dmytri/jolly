// Feature 024 — Jolly app token acquisition via Saleor GraphQL.
//
// Respec'd 2026-06-14 (acceptance-run finding): Jolly acquires the workflow
// token from a DEDICATED app it owns, named "Jolly Setup", created with the
// full v1 permission set. It must never mint a token for an unrelated
// pre-existing app — `appTokenCreate` cannot escalate a stranger app's
// permissions, so the old "select apps[0]" flow produced an under-permissioned
// token on any non-pristine environment (the live `jolly-store` had a 3-perm
// "SMTP" app first, so Configurator failed Permission Denied).
//
// @logic strategy — a LOCAL in-process Saleor GraphQL stand-in:
//   The `create app-token` command talks to the INSTANCE GraphQL URL (via
//   --url / NEXT_PUBLIC_SALEOR_API_URL), not the Cloud API. So we point --url
//   at an in-process GraphQL server that answers GetApps / PermissionEnum /
//   appCreate / appTokenCreate, records every operation, and lets us assert
//   exactly which mutation Jolly sent and against which app. This is hermetic
//   (loopback only) and reaches no real account. Because the server is
//   in-process, the CLI must be driven with runCliAsync (spawnSync would
//   deadlock the event loop — the feature 012 lesson).
//
// Safety: every @logic run uses logicSafeEnv() — dummy creds for all groups +
// an unroutable `.invalid` Cloud API base — and --url overrides the endpoint
// with the loopback stand-in. No @logic path can reach a real account.
//
// @sandbox "acquires a real, fully-permissioned token from Saleor" runs against
// the provisioned endpoint in CI (skips locally); it stores
// JOLLY_SALEOR_APP_TOKEN, never prints it, and verifies the dedicated app
// really carries the Configurator permission set.
//
// Shared steps (Background, "the output should include a risk context with
// action {string}", "it should write the token to .env as
// JOLLY_SALEOR_APP_TOKEN", "Jolly should not print the token value") live in
// shared.steps.ts.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv, UNROUTABLE_SALEOR_ENDPOINT, DUMMY } from "../support/logic-env.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// Permissions Configurator needs for the recipe deploy (acceptance-run finding).
const CONFIGURATOR_PERMISSIONS = [
  "MANAGE_PRODUCTS",
  "MANAGE_CHANNELS",
  "MANAGE_SETTINGS",
  "MANAGE_SHIPPING",
  "MANAGE_CHECKOUTS",
];

// The full PermissionEnum the stand-in advertises: the Configurator set plus a
// few extras, so "all available permissions" is a meaningful superset to assert.
const ALL_PERMISSIONS = [
  ...CONFIGURATOR_PERMISSIONS,
  "MANAGE_ORDERS",
  "MANAGE_USERS",
  "MANAGE_GIFT_CARD",
  "MANAGE_DISCOUNTS",
  "MANAGE_MENUS",
  "MANAGE_APPS",
];

// ─── In-process Saleor GraphQL stand-in ────────────────────────────────────
//
// Answers the four operations acquireAppToken uses and records each, so a
// scenario can assert which mutation was sent and against which app. The bearer
// token on every request is captured so we can assert the GetApps query is
// authenticated. The created/minted tokens are deterministic dummy values.

interface GqlOperation {
  type: "getApps" | "permissionEnum" | "appCreate" | "appTokenCreate" | "unknown";
  authorization?: string;
  /** appCreate: requested name. */
  name?: string;
  /** appCreate: requested permissions. */
  permissions?: string[];
  /** appTokenCreate: target app id. */
  appId?: string;
}

interface GqlStandIn {
  server: Server;
  endpoint: string;
  operations: GqlOperation[];
}

const CREATED_APP_TOKEN = "stand-in-created-app-token";
const MINTED_APP_TOKEN = "stand-in-minted-app-token";
const CREATED_APP_ID = "QXBwOmNyZWF0ZWQ="; // base64 "App:created"-ish

async function startInstanceGraphql(
  world: JollyWorld,
  apps: Array<{ id: string; name: string }>,
): Promise<GqlStandIn> {
  const operations: GqlOperation[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk));
    req.on("end", () => {
      let body: { query?: string; variables?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const query = body.query ?? "";
      const variables = body.variables ?? {};
      const authorization = req.headers["authorization"];
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;

      // Order matters: "appTokenCreate" must be matched before "appCreate".
      if (query.includes("appTokenCreate")) {
        operations.push({
          type: "appTokenCreate",
          authorization,
          appId: String(variables["app"] ?? ""),
        });
        res.end(
          JSON.stringify({
            data: { appTokenCreate: { authToken: MINTED_APP_TOKEN, errors: [] } },
          }),
        );
        return;
      }
      if (query.includes("appCreate")) {
        const input = (variables["input"] ?? {}) as Record<string, unknown>;
        operations.push({
          type: "appCreate",
          authorization,
          name: String(input["name"] ?? ""),
          permissions: Array.isArray(input["permissions"])
            ? (input["permissions"] as string[])
            : [],
        });
        res.end(
          JSON.stringify({
            data: {
              appCreate: {
                authToken: CREATED_APP_TOKEN,
                app: { id: CREATED_APP_ID, name: String(input["name"] ?? "") },
                errors: [],
              },
            },
          }),
        );
        return;
      }
      if (query.includes("PermissionEnum")) {
        operations.push({ type: "permissionEnum", authorization });
        res.end(
          JSON.stringify({
            data: { __type: { enumValues: ALL_PERMISSIONS.map((name) => ({ name })) } },
          }),
        );
        return;
      }
      if (query.includes("apps")) {
        operations.push({ type: "getApps", authorization });
        res.end(
          JSON.stringify({
            data: {
              apps: { edges: apps.map((a) => ({ node: { id: a.id, name: a.name } })) },
            },
          }),
        );
        return;
      }
      operations.push({ type: "unknown", authorization });
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const endpoint = `http://127.0.0.1:${port}/graphql/`;
  world.cleanup.register(`instance GraphQL stand-in :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const standIn: GqlStandIn = { server, endpoint, operations };
  world.notes.standIn = standIn;
  return standIn;
}

function standIn(world: JollyWorld): GqlStandIn {
  const value = world.notes.standIn as GqlStandIn | undefined;
  assert.ok(value, "expected the instance GraphQL stand-in to have started");
  return value!;
}

/** Run `jolly create app-token` against the stand-in (loopback → runCliAsync). */
async function runCreateAppToken(world: JollyWorld): Promise<void> {
  const endpoint = standIn(world).endpoint;
  await world.runCliAsync(
    ["create", "app-token", "--url", endpoint, "--json"],
    { env: logicSafeEnv() },
  );
}

// ─── Scenario: ensures a dedicated Jolly Setup app ─────────────────────────

Given("the agent invokes `jolly create app-token`", async function (this: JollyWorld) {
  // An unrelated pre-existing app is present (no "Jolly Setup" yet), so the
  // "must not mint a token for a stranger app" assertion is meaningful.
  await startInstanceGraphql(this, [{ id: "QXBwOnNtdHA=", name: "SMTP" }]);
  await runCreateAppToken(this);
});

When("Jolly resolves which app to mint a token for", function (this: JollyWorld) {
  // The resolution happened in the Given (the invocation). Proof that Jolly
  // listed apps before deciding:
  const listed = standIn(this).operations.some((op) => op.type === "getApps");
  assert.ok(listed, "Jolly must list apps (GetApps) before resolving which to use");
});

Then(
  "it should send the GetApps GraphQL query to the instance URL",
  function (this: JollyWorld) {
    const ops = standIn(this).operations;
    assert.ok(
      ops.some((op) => op.type === "getApps"),
      "expected a GetApps query against the instance URL",
    );
  },
);

Then(
  "the query should be authenticated with the Saleor Cloud bearer token",
  function (this: JollyWorld) {
    const getApps = standIn(this).operations.find((op) => op.type === "getApps");
    assert.ok(getApps, "expected a GetApps query");
    assert.equal(
      getApps!.authorization,
      `Bearer ${DUMMY.cloudToken}`,
      "GetApps must carry the Saleor Cloud bearer token",
    );
    // And the bearer value never leaks to stdout.
    this.trackSecret(DUMMY.cloudToken);
    this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  },
);

Then(
  'it should look for an app it owns by the dedicated name "Jolly Setup"',
  function (this: JollyWorld) {
    // "Jolly Setup" is absent, so resolving by name leads Jolly to CREATE it —
    // the observable proof it looked by name rather than reusing apps[0].
    const created = standIn(this).operations.find((op) => op.type === "appCreate");
    assert.ok(created, "expected Jolly to create the dedicated app when absent");
    assert.equal(created!.name, "Jolly Setup", "the dedicated app must be named Jolly Setup");
  },
);

Then(
  "it should not mint a token for an unrelated pre-existing app",
  function (this: JollyWorld) {
    const minted = standIn(this).operations.filter((op) => op.type === "appTokenCreate");
    const strangerTokens = minted.filter((op) => op.appId === "QXBwOnNtdHA=");
    assert.equal(
      strangerTokens.length,
      0,
      `Jolly must never mint a token for the unrelated app; saw ${JSON.stringify(minted)}`,
    );
  },
);

// ─── Scenario: creates the Jolly Setup app with full permissions when absent ─

Given("the instance has no \"Jolly Setup\" app yet", async function (this: JollyWorld) {
  // A pristine instance: zero apps. Jolly must create its dedicated app.
  await startInstanceGraphql(this, []);
});

When("Jolly creates the dedicated app", async function (this: JollyWorld) {
  await runCreateAppToken(this);
});

Then(
  'it should send the appCreate GraphQL mutation named "Jolly Setup"',
  function (this: JollyWorld) {
    const created = standIn(this).operations.find((op) => op.type === "appCreate");
    assert.ok(created, "expected an appCreate mutation");
    assert.equal(created!.name, "Jolly Setup");
  },
);

Then(
  "the mutation should request all available permissions for the app in v1",
  function (this: JollyWorld) {
    const created = standIn(this).operations.find((op) => op.type === "appCreate");
    assert.ok(created, "expected an appCreate mutation");
    const requested = [...(created!.permissions ?? [])].sort();
    const all = [...ALL_PERMISSIONS].sort();
    assert.deepEqual(
      requested,
      all,
      "appCreate must request every PermissionEnum value the instance advertises",
    );
  },
);

Then(
  "it should extract the authToken returned directly by appCreate",
  function (this: JollyWorld) {
    // appCreate returns its token inline (no appTokenCreate round-trip), and it
    // is what landed in .env.
    assert.equal(this.envelope.status, "success");
    const noMint = standIn(this).operations.every((op) => op.type !== "appTokenCreate");
    assert.ok(noMint, "a freshly created app needs no appTokenCreate call");
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(
      values["JOLLY_SALEOR_APP_TOKEN"],
      CREATED_APP_TOKEN,
      "the token from appCreate must be the one stored",
    );
    this.trackSecret(CREATED_APP_TOKEN);
  },
);

// ─── Scenario: reuses an existing Jolly Setup app idempotently ─────────────

Given(
  "the instance already has a \"Jolly Setup\" app from a previous run",
  async function (this: JollyWorld) {
    // A realistic non-pristine instance: an unrelated app FIRST, then the
    // dedicated app. apps[0] is therefore NOT "Jolly Setup", so resolution must
    // be by name — the precise regression the old apps[0] flow failed.
    this.notes.jollyAppId = "QXBwOmpvbGx5";
    await startInstanceGraphql(this, [
      { id: "QXBwOnNtdHA=", name: "SMTP" },
      { id: "QXBwOmpvbGx5", name: "Jolly Setup" },
    ]);
  },
);

When("Jolly acquires a token", async function (this: JollyWorld) {
  await runCreateAppToken(this);
});

Then(
  "it should send the appTokenCreate mutation for that existing Jolly Setup app",
  function (this: JollyWorld) {
    const minted = standIn(this).operations.find((op) => op.type === "appTokenCreate");
    assert.ok(minted, "expected an appTokenCreate mutation reusing the existing app");
    assert.equal(
      minted!.appId,
      String(this.notes.jollyAppId),
      "appTokenCreate must target the existing Jolly Setup app, not apps[0]",
    );
  },
);

Then("it should not create a duplicate app", function (this: JollyWorld) {
  const created = standIn(this).operations.filter((op) => op.type === "appCreate");
  assert.equal(
    created.length,
    0,
    `reuse must not create a duplicate app; saw ${JSON.stringify(created)}`,
  );
});

// ─── Scenario: does not reuse an unrelated low-permission app ───────────────

Given(
  "the instance has a pre-existing app with only a few permissions and no \"Jolly Setup\" app",
  async function (this: JollyWorld) {
    await startInstanceGraphql(this, [{ id: "QXBwOnNtdHA=", name: "SMTP" }]);
  },
);

Then(
  'it should create the dedicated "Jolly Setup" app with all available permissions',
  function (this: JollyWorld) {
    const created = standIn(this).operations.find((op) => op.type === "appCreate");
    assert.ok(created, "expected Jolly to create its dedicated app");
    assert.equal(created!.name, "Jolly Setup");
    const requested = [...(created!.permissions ?? [])].sort();
    assert.deepEqual(requested, [...ALL_PERMISSIONS].sort());
  },
);

Then(
  "it should not mint a token for the unrelated pre-existing app",
  function (this: JollyWorld) {
    const minted = standIn(this).operations.filter((op) => op.type === "appTokenCreate");
    const stranger = minted.filter((op) => op.appId === "QXBwOnNtdHA=");
    assert.equal(stranger.length, 0, "must not mint a token for the low-perm SMTP app");
  },
);

Then(
  "the resulting token's app should carry the permissions Configurator requires",
  function (this: JollyWorld) {
    const created = standIn(this).operations.find((op) => op.type === "appCreate");
    assert.ok(created, "expected an appCreate mutation");
    for (const perm of CONFIGURATOR_PERMISSIONS) {
      assert.ok(
        (created!.permissions ?? []).includes(perm),
        `the dedicated app must request ${perm} (Configurator requires it)`,
      );
    }
  },
);

// ─── Scenario: --dry-run shows risk context ────────────────────────────────

Given("the agent wants to preview app token creation", function (this: JollyWorld) {
  // The dry-run resolves the instance URL from the (unroutable) logic-safe
  // endpoint; record it so the target assertion can compare.
  this.notes.instanceUrl = UNROUTABLE_SALEOR_ENDPOINT;
});

When("the agent runs `jolly create app-token --dry-run`", function (this: JollyWorld) {
  this.runCli(["create", "app-token", "--dry-run", "--json"], { env: logicSafeEnv() });
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
  "subsequent `jolly auth status` should report the app token is configured",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], { cwd: this.lastRun!.cwd });
    assert.equal((this.envelope.data as { hasAppToken?: unknown })["hasAppToken"], true);
  },
);
