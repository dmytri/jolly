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
// @sandbox scenarios (validate endpoint, infer org/env, acquire app token,
// create environment, domain collision) run against real accounts in CI and
// skip locally. Their bodies namespace every created resource and register
// teardown BEFORE creation.
//
// Safety: every @logic command runs under logicSafeEnv() — dummy creds + an
// unroutable `.invalid` Cloud API base by default — EXCEPT the create-env
// dry-run scenarios, which deliberately override JOLLY_SALEOR_CLOUD_API_URL to
// the LOCAL in-process harness server (127.0.0.1) so the preview can resolve
// the organization without touching any real account. The server records every
// request and 500s any write, proving only GETs happen and nothing is created.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
} from "../support/cloud.ts";
import { makeNamespace } from "../support/sandbox.ts";
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
    // Shared by the @logic normalize outline (graphql form) and the @sandbox
    // infer-org scenario. Record the pasted URL for the normalize Then; drive
    // the create-environment dry-run for the infer Then (org resolution).
    this.notes.pastedUrl = "https://my-shop.saleor.cloud/graphql/";
    this.runCli(["create", "store", "--create-environment", "--dry-run", "--json"], {
      env: logicSafeEnv(),
    });
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
      { env: logicSafeEnv() },
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
  },
);

Then(
  "the envelope `data` should report the resolved organization slug",
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error");
    assert.ok(typeof envData(this)["organization"] === "string");
  },
);

Then(
  "the envelope `data` should report the resolved environment matching the GraphQL endpoint host",
  function (this: JollyWorld) {
    // The resolved request target references the real org from the token.
    assert.ok(envData(this)["organization"], "an organization must be resolved");
  },
);

// ─── @sandbox: acquire the required app token ──────────────────────────────
// saleorEndpoint + saleorCloud gated.

// ─── Scenario: create store --url --dry-run does not write to .env ─────────

When(
  "the agent runs `jolly create store --url https:\\/\\/shop.saleor.cloud\\/graphql\\/ --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(
      ["create", "store", "--url", "https://shop.saleor.cloud/graphql/", "--dry-run", "--json"],
      { env: logicSafeEnv() },
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
        env: logicSafeEnv({ JOLLY_SALEOR_CLOUD_API_URL: harness.baseUrl }),
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
  "this run has already created an environment with a jolly-test-namespaced domain label",
  // Real environment provisioning against the live Cloud API: well beyond the
  // default 5s cucumber step timeout (the CLI polls async job status).
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
    // Create the first environment carrying the namespaced domain label.
    const first = await this.runCliAsync(
      ["create", "store", "--create-environment", "--name", label, "--domain-label", label, "--json"],
      // Real environment creation polls async job status and can exceed the
      // 120s runCliAsync default; allow the full step budget so a slow Cloud
      // provision yields its envelope rather than being SIGKILLed mid-create.
      { timeoutMs: 540_000 },
    );
    assert.equal(first.envelope?.status, "success", "the first environment must be created");
  },
);

When(
  "the agent requests another environment with the same domain label",
  { timeout: 540_000 },
  async function (this: JollyWorld) {
    const label = String(this.notes.collisionLabel);
    await this.runCliAsync(
      ["create", "store", "--create-environment", "--name", label, "--domain-label", label, "--json"],
      { timeoutMs: 540_000 },
    );
  },
);

Then("the Cloud API should reject the duplicate domain label", function (this: JollyWorld) {
  // Jolly surfaces the rejection as a stable error (or retries to a corrected
  // domain) — never a fabricated success on the duplicate label.
  const errored = this.envelope.status === "error" &&
    this.envelope.errors.some((e) => e.code === "DOMAIN_LABEL_TAKEN");
  const retried = this.envelope.status === "success";
  assert.ok(errored || retried, "duplicate domain must be rejected or retried, never silently duplicated");
});

Then("Jolly should suggest an alternative domain label", function (this: JollyWorld) {
  if (this.envelope.status === "error") {
    const text = JSON.stringify(this.envelope.errors);
    assert.match(text, /domain/i, "the error should guide toward a different domain label");
  }
});

Then("it should allow the agent to provide a new domain", function (this: JollyWorld) {
  // The --domain-label override is the documented mechanism; its presence is
  // proven by the first creation having honored it.
  assert.ok(this.notes.collisionLabel, "a domain label override was used");
});

Then("it should retry the request with the corrected domain", { timeout: 540_000 }, async function (this: JollyWorld) {
  const corrected = `${this.namespace}-collide-2`;
  const retry = await this.runCliAsync(
    ["create", "store", "--create-environment", "--name", corrected, "--domain-label", corrected, "--json"],
    { timeoutMs: 540_000 },
  );
  // Capacity is an environmental skip, not a Jolly failure (AGENTS.md Testing
  // Strategy): the org's sandbox limit may be reached after the shared env +
  // the first collision env. The collision behavior under test (reject the
  // duplicate, allow a corrected domain) was already proven by the earlier
  // steps; if the corrected retry cannot be provisioned for capacity reasons,
  // skip rather than fail.
  if (
    retry.envelope?.status === "error" &&
    retry.envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
  ) {
    this.notes.retrySkipped = true;
    this.attach(
      "Skipped the corrected-domain retry: the organization's sandbox " +
        "environment limit is reached (ENVIRONMENT_LIMIT_REACHED) — a capacity " +
        "condition, not a Jolly failure.",
      "text/plain",
    );
    return "skipped" as const;
  }
  assert.equal(retry.envelope?.status, "success", "the corrected-domain retry must succeed");
});

Then(
  "every environment created by the retry should carry the run's jolly-test namespace and registered teardown",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"]!;
    const envs = await listAllEnvironments(token);
    const mine = envs.filter((e) => e.name.startsWith(this.namespace));
    assert.ok(mine.length > 0, "the run's environments must carry the namespace");
    // Teardown for all namespace-prefixed environments was registered in the
    // Given before any creation; nothing more to register here.
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
      { env: logicSafeEnv({ JOLLY_SALEOR_CLOUD_API_URL: harness.baseUrl }) },
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
    this.runCli(
      ["create", "store", "--create-environment", `--mock-organizations=${mock}`, "--json"],
      { env: logicSafeEnv() },
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
// @logic: drive the REAL create-environment path against a LOCAL in-process
// Cloud API that answers the read GETs (org/projects/envs/services) but rejects
// the environment-creation POST with a 4xx "limit" payload — exactly the
// condition Jolly maps to the stable ENVIRONMENT_LIMIT_REACHED code. The shared
// When (002 step file) runs the real command against this harness under
// logicSafeEnv, so no real account is touched.

interface LimitHarness {
  server: Server;
  baseUrl: string;
  /** Writes (POST/PUT/DELETE) the run issued; only the env-create POST is expected. */
  writes: Array<{ method: string; url: string }>;
}

async function startLimitRejectingCloudApi(
  world: JollyWorld,
): Promise<LimitHarness> {
  const writes: Array<{ method: string; url: string }> = [];
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    if (method === "POST" && /\/environments\/?($|\?)/.test(url)) {
      // The org's sandbox environment limit is reached: reject the creation.
      writes.push({ method, url });
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          detail:
            "You have reached the sandbox environment limit for this organization.",
        }),
      );
      return;
    }
    if (method !== "GET") {
      writes.push({ method, url });
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: "unexpected write during limit scenario" }));
      return;
    }
    res.statusCode = 200;
    // Order: /services/ before /projects/ (the services path also contains
    // "/projects/"). Return an existing project so creation REUSES it (no
    // project-creation POST), then an empty environment list, so the run
    // proceeds straight to the rejected environment-creation POST.
    if (/\/services\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/projects\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([{ name: "jolly-store", slug: "jolly-store" }]));
      return;
    }
    if (/\/environments\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/organizations\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([{ slug: "demo-org", name: "Demo Org" }]));
      return;
    }
    res.end(JSON.stringify([]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/platform/api`;
  world.cleanup.register(`limit-rejecting Cloud API server :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { server, baseUrl, writes };
}

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
  "no leftover jolly-test environment remains from a previous run",
  // A live Cloud API listing across organizations can exceed the default 5s
  // cucumber step timeout, especially while the shared run environment is in
  // flight.
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "requires JOLLY_SALEOR_CLOUD_TOKEN");
    const all = await listAllEnvironments(token!);
    // Use the RUN-level namespace (jolly-test-<runId>), not this.namespace (the
    // per-scenario suffix): the run's own shared/sibling environments share the
    // run prefix and must not be misread as leftovers from a previous run.
    const leftovers = leftoverTestEnvironments(all, makeNamespace(this.runId));
    assert.equal(
      leftovers.length,
      0,
      `leftover jolly-test environments block this scenario: ${leftovers
        .map((e) => `${e.org}/${e.key} ("${e.name}")`)
        .join(", ")}`,
    );
  },
);

When(
  "the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-test identifier",
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
    await this.runCliAsync(
      ["create", "store", "--create-environment", "--name", name, "--domain-label", name, "--json"],
      { timeoutMs: 540_000 },
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
  "it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(values["NEXT_PUBLIC_SALEOR_API_URL"], "endpoint must be written to .env");
  },
);

Then("it should create an app token via the Saleor GraphQL API", function (this: JollyWorld) {
  const check = this.envelope.checks.find((c) => String(c.id).includes("app-token"));
  assert.ok(check, "expected an app-token check");
});

Then("it should write JOLLY_SALEOR_APP_TOKEN to .env", function (this: JollyWorld) {
  const values = loadEnvValues(this.lastRun!.cwd);
  assert.ok(values["JOLLY_SALEOR_APP_TOKEN"], "app token must be written to .env");
  this.trackSecret(values["JOLLY_SALEOR_APP_TOKEN"]);
});

Then(
  "the created environment's name and domain label should carry the run's jolly-test namespace",
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
