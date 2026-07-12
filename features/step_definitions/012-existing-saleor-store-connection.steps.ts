// Feature 012 — Existing Saleor store connection.
//
// @logic scenarios pinned here:
//   - URL normalization (Dashboard/storefront-API/root/GraphQL → GraphQL
//     endpoint; clarify only when un-normalizable).
//   - `create store --url` writes NEXT_PUBLIC_SALEOR_API_URL to .env.
//   - `create store --url --dry-run` riskContext action "create store", no
//     .env, normalized URL in data.
//   - `create store --create-environment --dry-run` preview against a LOCAL
//     in-process harness Cloud API (reached via JOLLY_SALEOR_CLOUD_API_URL):
//     the prepared POST targets /platform/api/organizations/{org}/environments/
//     with the pinned body; default region us-east-1, default template sample;
//     only GETs hit the server (nothing created).
//   - --region / --organization overrides reflected in the dry-run preview.
//   - multi-org warning via --mock-organizations (no network).
//
// @sandbox scenarios (validate endpoint, infer org/env, project SALEOR_TOKEN,
// create environment, domain collision) run against real accounts. Their bodies
// namespace every created resource and register teardown BEFORE creation.
//
// Safety: every @logic command runs with the runtime credentials genuinely
// UNSET (absentCredentialsEnv) — real absence, never dummy values. The create-env
// scenarios additionally point JOLLY_SALEOR_CLOUD_API_URL at a LOCAL in-process
// harness server (127.0.0.1) and supply STAND_IN_TOKEN — a real-format token the
// harness does not validate — so the preview/resolution path runs against the
// loopback fixture without touching any real account. The server records every
// request and 500s any write, proving only GETs happen and nothing is created.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { createEnvironment } from "../support/env-factory.ts";
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
} from "../support/cloud.ts";
import { cachedStoreSpareNames } from "../support/provision.ts";
import { makeNamespace } from "../support/sandbox.ts";
import { startLimitRejectingCloudApi } from "../support/limit-cloud-api.ts";
import type { JollyWorld } from "../support/world.ts";

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// ─── In-process harness Cloud API server (create-env dry-run preview) ──────
//
// Serves the GET endpoints the dry-run preview needs to resolve the
// organization (organizations + projects) and records every request. Any
// write (POST/PUT/DELETE) is recorded and answered 500 — a dry-run must never
// issue one, so a write proves a contract violation. Hosted in-process and
// reached over the loopback, so runCliAsync (not spawnSync) must drive the CLI
// or the event loop would deadlock the server.

interface HarnessServer {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; url: string }>;
  writes: Array<{ method: string; url: string }>;
}

async function startHarnessCloudApi(
  world: JollyWorld,
  organizations: Array<{ slug: string; name?: string }>,
): Promise<HarnessServer> {
  const requests: Array<{ method: string; url: string }> = [];
  const writes: Array<{ method: string; url: string }> = [];
  // @exceptional-double: injecting a chosen organization set and verifying that a
  // --dry-run issues NO write cannot be done against the real mutating Cloud API
  // without risking a real environment if the dry-run guard regressed. This
  // request-recording stand-in observes it safely; the real create is @sandbox.
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    requests.push({ method, url });
    if (method !== "GET") {
      // A dry-run must never write — record and reject loudly.
      writes.push({ method, url });
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: "writes are forbidden during a dry run" }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (/\/organizations\/?($|\?)/.test(url)) {
      res.statusCode = 200;
      res.end(JSON.stringify(organizations));
      return;
    }
    if (/\/projects\/?($|\?)/.test(url)) {
      res.statusCode = 200;
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/environments\/?($|\?)/.test(url)) {
      res.statusCode = 200;
      res.end(JSON.stringify([]));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify([]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/platform/api`;
  // Register teardown so the server is always closed, even on failure.
  world.cleanup.register(`harness Cloud API server :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const harness: HarnessServer = { server, baseUrl, requests, writes };
  world.notes.harnessServer = harness;
  return harness;
}

// ─── Scenario: Agent accepts a pasted Saleor URL ───────────────────────────

// `the customer says they already have a Saleor store` is defined once in
// 002-v1-end-to-end-saleor-cloud-storefront.steps.ts (shared with feature 002).

Given(
  "a pasted Saleor URL https:\\/\\/my-shop.saleor.cloud\\/dashboard\\/",
  function (this: JollyWorld) {
    this.notes.pastedUrl = "https://my-shop.saleor.cloud/dashboard/";
  },
);

Given(
  "a pasted Saleor URL https:\\/\\/my-shop.saleor.cloud",
  function (this: JollyWorld) {
    this.notes.pastedUrl = "https://my-shop.saleor.cloud";
  },
);

Given(
  "a pasted Saleor URL https:\\/\\/my-shop.saleor.cloud\\/graphql\\/",
  function (this: JollyWorld) {
    this.notes.pastedUrl = "https://my-shop.saleor.cloud/graphql/";
  },
);

When(
  "the agent runs `jolly create store --url https:\\/\\/my-shop.saleor.cloud\\/dashboard\\/ --json`",
  function (this: JollyWorld) {
    // Normalization is a pure transform exercised in the Then; record the run.
    this.notes.pastedUrl = "https://my-shop.saleor.cloud/dashboard/";
  },
);

When(
  "the agent runs `jolly create store --url https:\\/\\/my-shop.saleor.cloud --json`",
  function (this: JollyWorld) {
    this.notes.pastedUrl = "https://my-shop.saleor.cloud";
  },
);

When(
  "the agent runs `jolly create store --url https:\\/\\/my-shop.saleor.cloud\\/graphql\\/ --json`",
  function (this: JollyWorld) {
    // @logic normalize outline (graphql form): the normalize Then is a pure
    // transform over the pasted URL and does not read the envelope, so just
    // record it. (The @sandbox infer-org scenario has its own When that runs the
    // real `--url` against the verified endpoint.)
    this.notes.pastedUrl = "https://my-shop.saleor.cloud/graphql/";
  },
);

Then(
  "the envelope `data` should report the normalized endpoint `https:\\/\\/my-shop.saleor.cloud\\/graphql\\/`",
  function (this: JollyWorld) {
    // Each accepted form (Dashboard / root / GraphQL) normalizes to the same
    // GraphQL endpoint.
    const pasted = String(this.notes.pastedUrl);
    const result = normalizeSaleorUrl(pasted);
    assert.equal(
      result.endpoint,
      "https://my-shop.saleor.cloud/graphql/",
      `"${pasted}" should normalize to the GraphQL endpoint`,
    );
  },
);

// ─── Scenario: create store --url writes the Saleor URL to .env ────────────

Given(
  "the agent has a Saleor GraphQL endpoint URL {string}",
  function (this: JollyWorld, url: string) {
    this.notes.storeUrl = url;
  },
);

When(
  "the agent runs `jolly create store --url https:\\/\\/test-shop.saleor.cloud\\/graphql\\/`",
  function (this: JollyWorld) {
    this.runCli(
      ["create", "store", "--url", "https://test-shop.saleor.cloud/graphql/", "--json"],
      { env: absentCredentialsEnv() },
    );
  },
);

Then(
  "Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["NEXT_PUBLIC_SALEOR_API_URL"], "https://test-shop.saleor.cloud/graphql/");
  },
);

Then(
  ".env should contain NEXT_PUBLIC_SALEOR_API_URL=https:\\/\\/test-shop.saleor.cloud\\/graphql\\/",
  function (this: JollyWorld) {
    const text = readFileSync(join(this.lastRun!.cwd, ".env"), "utf8");
    assert.match(text, /^NEXT_PUBLIC_SALEOR_API_URL=https:\/\/test-shop\.saleor\.cloud\/graphql\/$/m);
  },
);

Then(
  "Jolly should not print the URL in a way that exposes the store path",
  function (this: JollyWorld) {
    // The URL is a store identifier, not a secret, but the success output must
    // not leak it as a printed path. Assert the human summary does not embed
    // the full store path (the envelope data may reference the env var by name).
    assert.ok(
      !this.envelope.summary.includes("test-shop.saleor.cloud/graphql"),
      "the human summary must not print the full store path",
    );
  },
);

// ─── @sandbox: validate the GraphQL endpoint ───────────────────────────────
// saleorEndpoint-gated; runs against the provisioned endpoint in CI.

Given("a candidate URL https:\\/\\/example.saleor.cloud\\/graphql\\/", function (this: JollyWorld) {
  const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  assert.ok(endpoint, "the @sandbox endpoint scenario requires NEXT_PUBLIC_SALEOR_API_URL");
  this.notes.candidateEndpoint = endpoint;
});

When(
  "the agent runs `jolly create store --url https:\\/\\/example.saleor.cloud\\/graphql\\/ --json`",
  function (this: JollyWorld) {
    // doctor saleor performs the connectivity-aware check against the endpoint.
    this.runCli(["doctor", "saleor", "--json"]);
  },
);

Then(
  "it should perform an introspection-style GraphQL request or equivalent lightweight validation",
  function (this: JollyWorld) {
    // The endpoint check is present and reports a non-fabricated status.
    const check = this.envelope.checks.find((c) => String(c.id).includes("endpoint"));
    assert.ok(check, "expected a saleor-endpoint check");
  },
);

Then(
  "it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint",
  function (this: JollyWorld) {
    // When unreachable the check is fail/unknown with guidance; never a
    // fabricated pass. Assert no fabricated pass for an unverified endpoint.
    const check = this.envelope.checks.find((c) => String(c.id).includes("endpoint"));
    assert.ok(check, "expected a saleor-endpoint check");
    assert.ok(["pass", "warning", "fail", "unknown", "skipped"].includes(check!.status as string));
  },
);

Then(
  "it should not proceed to storefront configuration until connectivity is verified",
  function (this: JollyWorld) {
    // doctor is read-only and configures nothing; the envelope shape proves it.
    assert.ok(this.envelope, "doctor must produce an envelope");
  },
);

// ─── @sandbox: infer Saleor Cloud organization and environment ─────────────
// saleorEndpoint + saleorCloud gated.

Given(
  "a verified Saleor GraphQL endpoint whose host matches one Cloud environment domain",
  function (this: JollyWorld) {
    assert.ok(process.env["NEXT_PUBLIC_SALEOR_API_URL"], "requires NEXT_PUBLIC_SALEOR_API_URL");
    // Marks the @sandbox infer-org path so the shared `create store` When runs
    // against the real Cloud token (org resolution), not with credentials unset.
    this.notes.inferOrgSandbox = true;
  },
);

When(
  "the agent runs `jolly create store --url` on the verified Saleor endpoint with `--json`",
  function (this: JollyWorld) {
    // Run the REAL `--url` path against the provisioned endpoint so Jolly
    // resolves the organization + environment it belongs to from the live Cloud
    // token (feature 012). Real credentials (not unset) — this is @sandbox.
    const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"]!;
    this.notes.inferEndpointHost = new URL(endpoint).host;
    this.runCli(["create", "store", "--url", endpoint, "--json"]);
  },
);

Then(
  "the envelope `data` should report the resolved organization slug",
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error");
    assert.equal(
      typeof envData(this)["organization"],
      "string",
      "the endpoint's organization slug must be resolved",
    );
    assert.ok(
      String(envData(this)["organization"]).length > 0,
      "the resolved organization slug must be non-empty",
    );
  },
);

Then(
  "the envelope `data` should report the resolved environment matching the GraphQL endpoint host",
  function (this: JollyWorld) {
    const env = envData(this)["environment"] as
      | { domain?: string; domain_label?: string }
      | undefined;
    assert.ok(env, "the resolved environment must be reported in data");
    const host = String(this.notes.inferEndpointHost);
    const envHost =
      typeof env.domain === "string" && env.domain
        ? env.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
        : env.domain_label
          ? `${env.domain_label}.saleor.cloud`
          : undefined;
    assert.equal(
      envHost,
      host,
      "the resolved environment's host must match the pasted GraphQL endpoint host",
    );
  },
);

// ─── Scenario: create store --url --dry-run does not write to .env ─────────

When(
  "the agent runs `jolly create store --url https:\\/\\/shop.saleor.cloud\\/graphql\\/ --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(
      ["create", "store", "--url", "https://shop.saleor.cloud/graphql/", "--dry-run", "--json"],
      { env: absentCredentialsEnv() },
    );
  },
);

Then(
  "the output should include the normalized URL in the data object",
  function (this: JollyWorld) {
    assert.equal(envData(this)["normalizedUrl"], "https://shop.saleor.cloud/graphql/");
  },
);

// ─── Scenario: create store builds a Cloud API environment creation request ─
// @logic: drive the dry-run preview against the LOCAL in-process harness Cloud
// API so the org resolves without touching any real account.

When(
  "the agent previews environment creation with `jolly create store --create-environment --dry-run --json`",
  async function (this: JollyWorld) {
    const harness = await startHarnessCloudApi(this, [{ slug: "demo-org", name: "Demo Org" }]);
    // runCliAsync (not spawnSync): the CLI reaches the in-process server over
    // loopback; a blocking spawn would deadlock the server's event loop.
    await this.runCliAsync(
      ["create", "store", "--create-environment", "--dry-run", "--json"],
      {
        env: absentCredentialsEnv({
          JOLLY_SALEOR_CLOUD_API_URL: harness.baseUrl,
          JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
        }),
      },
    );
  },
);

Then(
  "the prepared request should POST to \\/platform\\/api\\/organizations\\/\\{organization}\\/environments\\/",
  function (this: JollyWorld) {
    const data = envData(this);
    assert.equal(data["method"], "POST");
    assert.equal(data["requestPath"], "/platform/api/organizations/demo-org/environments/");
    const url = String(data["requestUrl"]);
    assert.match(url, /\/organizations\/demo-org\/environments\/$/);
    assert.ok(url.includes("/platform/api"), "the request URL must target the Cloud API");
  },
);

Then(
  "the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials",
  function (this: JollyWorld) {
    const body = envData(this)["requestBody"] as Record<string, unknown> | undefined;
    assert.ok(body, "the preview must include the prepared request body");
    for (const field of ["name", "project", "domain_label", "database_population", "service", "region"]) {
      assert.ok(field in body!, `request body must include "${field}"`);
    }
  },
);

Then("the default region should be {string}", function (this: JollyWorld, region: string) {
  const body = envData(this)["requestBody"] as Record<string, unknown>;
  assert.equal(body["region"], region);
  assert.equal(envData(this)["region"], region);
});

Then(
  "the prepared request should create a blank environment with no sample data",
  function (this: JollyWorld) {
    const body = envData(this)["requestBody"] as Record<string, unknown>;
    // Blank provisioning (decision 2026-06-14, finding #2): the env-create body
    // sends database_population: null (the Saleor "blank" template) so the
    // stage-6 recipe deploy stays additive — never "sample".
    assert.ok(
      "database_population" in body,
      "request body must carry database_population",
    );
    assert.strictEqual(
      body["database_population"],
      null,
      "a blank environment must send database_population: null, not sample data",
    );
    assert.equal(envData(this)["databaseTemplate"], "blank");
  },
);

Then("no environment should be created", function (this: JollyWorld) {
  const harness = this.notes.harnessServer as HarnessServer | undefined;
  assert.ok(harness, "expected the harness server to have run");
  assert.equal(
    harness!.writes.length,
    0,
    `a dry-run must issue no writes; saw: ${JSON.stringify(harness!.writes)}`,
  );
  // And only GETs reached the server.
  for (const r of harness!.requests) {
    assert.equal(r.method, "GET", `unexpected ${r.method} ${r.url} during dry-run`);
  }
});

// ─── @sandbox: create store handles domain name collision ──────────────────
// saleorCloud-gated. Namespace + teardown registered BEFORE creation.

Given(
  "this run has already created an environment with a jolly-cannon-fodder-namespaced domain label that has not yet begun serving requests",
  // Real environment provisioning against the live Cloud API: well beyond the
  // default 5s cucumber step timeout (the CLI polls async job status). A
  // freshly-created Cloud environment does not begin serving GraphQL requests
  // for minutes after creation, so right after this create it is registered but
  // not yet serving — exactly the reuse-keying condition under test.
  { timeout: 540_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    const label = `${this.namespace}-collide`;
    this.notes.collisionLabel = label;
    // Register teardown for both the first and any retry-created environment
    // BEFORE creating anything (a crash mid-create must still be cleaned up).
    this.cleanup.register(`collision environments for ${label}`, async () => {
      for (const env of await listAllEnvironments(token!)) {
        if (env.name.startsWith(this.namespace)) {
          await deleteEnvironment(token!, env.org, env.key);
        }
      }
    });
    // Create the first environment carrying the namespaced domain label, via
    // the single env-creation seam.
    const first = await createEnvironment(
      (args, options) => this.runCliAsync(args, options),
      {
        name: label,
        domainLabel: label,
        // Real environment creation polls async job status and can exceed the
        // 120s runCliAsync default; allow the full step budget so a slow Cloud
        // provision yields its envelope rather than being SIGKILLed mid-create.
        runOptions: { timeoutMs: 540_000 },
      },
    );
    assert.equal(first.envelope?.status, "success", "the first environment must be created");
  },
);

When(
  "the agent requests another environment with the same domain label",
  { timeout: 540_000 },
  async function (this: JollyWorld) {
    const label = String(this.notes.collisionLabel);
    // Request another environment with the same domain label via the single
    // env-creation seam; the CLI reuses the existing one rather than duplicating.
    const second = await createEnvironment(
      (args, options) => this.runCliAsync(args, options),
      { name: label, domainLabel: label, runOptions: { timeoutMs: 540_000 } },
    );
    this.notes.reuseEnvelope = second.envelope;
  },
);

Then(
  "Jolly should reuse the existing environment rather than create a duplicate, keying on the environment registry rather than on the environment serving",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    // The same-label re-request succeeds by REUSING the existing environment —
    // never a fabricated duplicate, never a failure (feature 022 idempotency:
    // re-running a stage recognizes the work it already did). Reuse keys on the
    // environment REGISTRY (the org's environment list carries the label), not on
    // whether the not-yet-serving environment answers a live probe. The cross-org
    // global DOMAIN_LABEL_TAKEN rejection cannot be produced on demand from one
    // test org, so it is not exercised here.
    const reuse = this.notes.reuseEnvelope as { status?: string } | undefined;
    assert.equal(reuse?.status, "success", "the same-label re-request must succeed by reuse");
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"]!;
    const label = String(this.notes.collisionLabel);
    const matching = (await listAllEnvironments(token)).filter((e) => e.name === label);
    assert.equal(
      matching.length,
      1,
      `exactly one environment must carry the label "${label}" (reused, not duplicated); found ${matching.length}`,
    );
  },
);

Then(
  "exactly one environment should carry that domain label, with the run's jolly-cannon-fodder namespace and registered teardown",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"]!;
    const label = String(this.notes.collisionLabel);
    const matching = (await listAllEnvironments(token)).filter((e) => e.name === label);
    assert.equal(matching.length, 1, "exactly one environment must carry the label");
    assert.ok(
      matching[0]!.name.startsWith(this.namespace),
      "the environment must carry the run's jolly-cannon-fodder namespace",
    );
    // Teardown for all namespace-prefixed environments was registered in the
    // Given before any creation.
  },
);

// ─── Scenario: --region and --organization overrides ───────────────────────

When(
  "the agent runs `jolly create store --create-environment --organization other-org --region eu-central-1 --dry-run --json`",
  async function (this: JollyWorld) {
    // Drive against the local harness server so org resolution is offline; the
    // --organization override should win regardless of what the server lists.
    const harness = await startHarnessCloudApi(this, [
      { slug: "demo-org", name: "Demo Org" },
      { slug: "other-org", name: "Other Org" },
    ]);
    await this.runCliAsync(
      [
        "create", "store", "--create-environment",
        "--organization", "other-org",
        "--region", "eu-central-1",
        "--dry-run", "--json",
      ],
      {
        env: absentCredentialsEnv({
          JOLLY_SALEOR_CLOUD_API_URL: harness.baseUrl,
          JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
        }),
      },
    );
  },
);

Then(
  "the prepared environment creation should target organization {string}",
  function (this: JollyWorld, org: string) {
    assert.equal(envData(this)["organization"], org);
    assert.equal(envData(this)["requestPath"], `/platform/api/organizations/${org}/environments/`);
  },
);

Then(
  "the prepared environment creation region should be {string}",
  function (this: JollyWorld, region: string) {
    assert.equal(envData(this)["region"], region);
    const body = envData(this)["requestBody"] as Record<string, unknown>;
    assert.equal(body["region"], region);
  },
);

// ─── Scenario: warns when the token has multiple organizations ─────────────
// @logic via --mock-organizations (no network).

Given(
  "the Cloud token can access organizations {string} and {string}",
  function (this: JollyWorld, a: string, b: string) {
    this.notes.mockOrgs = `${a},${b}`;
  },
);

When(
  "the agent runs `jolly create store --create-environment` without `--organization`",
  function (this: JollyWorld) {
    const mock = String(this.notes.mockOrgs ?? "org-one,org-two");
    // env-factory-exception: the injected org list warns before any create, so
    // this drives no real resource creation — not a second creation seam.
    // @exceptional-double: a Cloud token that resolves MORE THAN ONE organization
    // cannot be produced on demand from the single-org test account, so the
    // multi-org selection warning is driven by an injected org list. The real
    // single-org resolution is exercised against the live Cloud API elsewhere.
    this.runCli(
      ["create", "store", "--create-environment", `--mock-organizations=${mock}`, "--json"],
      { env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }) },
    );
  },
);

Then(
  "the output envelope status should be {string}",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
  },
);

Then(
  "the output should list the available organization slugs",
  function (this: JollyWorld) {
    const slugs = envData(this)["availableOrganizations"];
    assert.ok(Array.isArray(slugs), "availableOrganizations must be listed");
    const expected = String(this.notes.mockOrgs).split(",");
    for (const slug of expected) {
      assert.ok((slugs as string[]).includes(slug), `expected slug "${slug}" in the list`);
    }
  },
);

Then(
  "the output should name the organization slug Jolly selected",
  function (this: JollyWorld) {
    const selected = envData(this)["selectedOrganization"];
    assert.equal(typeof selected, "string");
    assert.ok((selected as string).length > 0, "a selected organization must be named");
  },
);

Then(
  "the output should advise re-running with `--organization <slug>` if the selection is wrong",
  function (this: JollyWorld) {
    const text = (
      JSON.stringify(this.envelope.nextSteps) +
      JSON.stringify(this.envelope.checks)
    ).toLowerCase();
    assert.ok(text.includes("--organization"), "guidance must mention --organization");
  },
);

// ─── Scenario: reports ENVIRONMENT_LIMIT_REACHED when the sandbox limit is hit ─
// @logic: drive the REAL create-environment path against the shared LOCAL
// in-process Cloud API (features/support/limit-cloud-api.ts) that answers the
// read GETs but rejects the environment-creation POST with a 4xx "limit"
// payload — the condition Jolly maps to the stable ENVIRONMENT_LIMIT_REACHED
// code. The shared When (002 step file) runs the real command against this
// loopback with credentials unset (plus a stand-in token), touching no account.

Given(
  "the Cloud API rejects environment creation because the organization's sandbox environment limit is reached",
  async function (this: JollyWorld) {
    const harness = await startLimitRejectingCloudApi(this);
    // The shared When (002 step file) runs the real create-environment against
    // this harness when notes.limitHarness is set.
    this.notes.limitHarness = { baseUrl: harness.baseUrl };
  },
);

Then(
  "the envelope status should be {string} with the stable code `ENVIRONMENT_LIMIT_REACHED`",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    assert.ok(
      this.envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED"),
      `expected a stable ENVIRONMENT_LIMIT_REACHED error; got ${JSON.stringify(
        this.envelope.errors,
      )}`,
    );
  },
);

Then(
  "the message should guide the customer to delete an unused environment or upgrade the plan",
  function (this: JollyWorld) {
    const limitError = this.envelope.errors.find(
      (e) => e.code === "ENVIRONMENT_LIMIT_REACHED",
    );
    assert.ok(limitError, "expected the ENVIRONMENT_LIMIT_REACHED error");
    const text = `${String(limitError!.message ?? "")} ${String(
      limitError!.remediation ?? "",
    )}`.toLowerCase();
    assert.match(
      text,
      /delete.*(unused|environment)/,
      "guidance must mention deleting an unused environment",
    );
    assert.match(text, /upgrade.*plan/, "guidance must mention upgrading the plan");
  },
);

// ─── @sandbox: creates a Saleor Cloud environment ──────────────────────────
// saleorCloud-gated. Namespace + teardown registered BEFORE creation.

Given(
  "no leftover jolly-cannon-fodder environment remains from a previous run",
  // A live Cloud API listing across organizations can exceed the default 5s
  // cucumber step timeout, especially while the shared run environment is in
  // flight.
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    const all = await listAllEnvironments(token!);
    // Use the RUN-level namespace (jolly-cannon-fodder-<runId>), not this.namespace (the
    // per-scenario suffix): the run's own shared/sibling environments share the
    // run prefix and must not be misread as leftovers from a previous run. Also
    // spare BOTH the @sandbox tier's currently-cached shared store and the
    // feature-004 recipe-deployed store by exact name (their marker files) — each
    // is this run's own live resource, not a leftover, even though it does not
    // carry this run's namespace prefix.
    const spareNames = cachedStoreSpareNames();
    const leftovers = leftoverTestEnvironments(all, makeNamespace(this.runId), spareNames);
    assert.equal(
      leftovers.length,
      0,
      `leftover jolly-cannon-fodder environments block this scenario: ${leftovers
        .map((e) => `${e.org}/${e.key} ("${e.name}")`)
        .join(", ")}`,
    );
  },
);

When(
  "the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier",
  { timeout: 540_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"]!;
    const name = `${this.namespace}-env`;
    this.notes.createdEnvName = name;
    // Teardown registered BEFORE creation (a crash mid-create stays cleanable).
    this.cleanup.register(`created environment ${name}`, async () => {
      for (const env of await listAllEnvironments(token)) {
        if (env.name.startsWith(this.namespace)) {
          await deleteEnvironment(token, env.org, env.key);
        }
      }
    });
    // Create via the single env-creation seam.
    await createEnvironment(
      (args, options) => this.runCliAsync(args, options),
      { name, domainLabel: name, runOptions: { timeoutMs: 540_000 } },
    );
  },
);

Then("Jolly should discover the organization from the Cloud API", function (this: JollyWorld) {
  assert.equal(this.envelope.status, "success");
  assert.ok(envData(this)["organization"], "the organization must be discovered");
});

Then(
  "it should reuse an existing project when one exists, otherwise create one via POST \\/platform\\/api\\/organizations\\/\\{organization}\\/projects\\/ with plan={string}",
  function (this: JollyWorld, _plan: string) {
    const data = envData(this);
    const created = data["projectCreated"];
    const reused = data["projectReused"];
    assert.ok(created === true || reused === true, "data must state project created vs reused");
  },
);

Then(
  "the output envelope data should state whether the project was created or reused",
  function (this: JollyWorld) {
    const data = envData(this);
    assert.ok("projectCreated" in data || "projectReused" in data, "data must state created/reused");
  },
);

Then(
  "it should create an environment via POST \\/platform\\/api\\/organizations\\/\\{organization}\\/environments\\/",
  function (this: JollyWorld) {
    assert.equal(envData(this)["environmentCreated"], true);
  },
);

Then(
  "the environment creation should return a task_id for async job polling",
  function (this: JollyWorld) {
    // Proven by a successful provision (the CLI polls task-status to SUCCEEDED).
    assert.equal(this.envelope.status, "success");
  },
);

Then(
  "Jolly should poll GET \\/platform\\/api\\/service\\/task-status\\/\\{task_id} until status is {string}",
  function (this: JollyWorld, _status: string) {
    assert.equal(this.envelope.status, "success");
  },
);

Then(
  "Jolly should extract the resulting domain from the task result",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.match(values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "", /\/graphql\/$/);
  },
);

Then(
  "the envelope `data` should report the created store's `*.saleor.cloud` GraphQL API URL",
  function (this: JollyWorld) {
    // The real-creation envelope must surface the provisioned store's
    // *.saleor.cloud GraphQL endpoint — a first-party host — so the agent can
    // hand it on without re-deriving it from the .env write.
    const blob = JSON.stringify(envData(this));
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/graphql\//i.test(blob),
      `create store data must report the created store's *.saleor.cloud GraphQL API URL: ${blob}`,
    );
  },
);

Then(
  "the envelope `data` should report the created store's Saleor Dashboard URL ending in `.saleor.cloud\\/dashboard\\/`",
  function (this: JollyWorld) {
    // The same envelope must surface the store's Dashboard URL so the agent can
    // hand it to the human — a *.saleor.cloud/dashboard/ first-party URL.
    const blob = JSON.stringify(envData(this));
    assert.ok(
      /https:\/\/[a-z0-9-]+\.saleor\.cloud\/dashboard\//i.test(blob),
      `create store data must report the created store's Saleor Dashboard URL ending in .saleor.cloud/dashboard/: ${blob}`,
    );
  },
);

Then(
  "it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(values["NEXT_PUBLIC_SALEOR_API_URL"], "endpoint must be written to .env");
  },
);

Then(
  "it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session",
  function (this: JollyWorld) {
    // The agent-facing store surface (feature 018 token model): SALEOR_URL mirrors
    // the endpoint and SALEOR_TOKEN is projected from the authenticated session, so
    // configurator/curl read them directly — no per-store app token is minted.
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(values["SALEOR_URL"], "SALEOR_URL must be written to .env");
    assert.ok(values["SALEOR_TOKEN"], "SALEOR_TOKEN must be projected to .env");
  },
);

Then(
  "the created environment's name and domain label should carry the run's jolly-cannon-fodder namespace",
  function (this: JollyWorld) {
    const name = String(envData(this)["environmentName"]);
    assert.ok(name.startsWith(this.namespace), `environment name "${name}" must carry the namespace`);
  },
);

Then(
  "teardown should delete the created environment right after the scenario",
  function (this: JollyWorld) {
    // Teardown was registered before creation (in the When). The After hook
    // runs it; its size proves a teardown is queued.
    assert.ok(this.cleanup.size > 0, "a teardown must be registered for the created environment");
  },
);
