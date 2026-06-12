// Step definitions for feature 012: existing Saleor store connection.
//
// Regenerated fresh from features/012-existing-saleor-store-connection.feature
// (Captain spec change: environment creation against in-use organizations).
//
// CLI contract pinned by these steps (for Crew Mates):
//   jolly create store --url <url> [--validate] [--infer-cloud] [--json]
//     --validate    performs a live introspection-style GraphQL validation of
//                   the endpoint before writing; on failure emits status
//                   "error" with an actionable message and writes nothing.
//                   Emits check id "create-store-validate-endpoint".
//     --infer-cloud queries the Cloud API for organizations/environments and
//                   matches the endpoint host; emits data.cloudContext with
//                   organizations[], environments[], matched, matchedDomain,
//                   organizationSlug, requiresSelection.
//   jolly create store --create-environment [--name <name>]
//       [--domain-label <label>] [--region <region>] [--organization <slug>]
//       [--dry-run] [--json]
//     Create-or-reuse project (plan "dev"), create environment, poll the
//     task, write NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN.
//     data must include organizationSlug, projectName, projectCreated,
//     projectReused (exactly one true), environmentKey, taskId, taskPollUrl,
//     taskStatus, domainUrl, appTokenCreated. On an org at its sandbox
//     environment limit: status "error" with stable code
//     ENVIRONMENT_LIMIT_REACHED — the harness treats that as an
//     environmental skip, not a failure.
//     --name / --domain-label override the generated environment name and
//       domain label (the harness namespaces test environments through them);
//       data.environmentName must reflect the override and data.domainUrl
//       must be https://<domain-label>.../graphql/.
//     --region overrides the default "us-east-1".
//     --organization <slug> selects the organization; when omitted and the
//       token sees several, status is "warning", data.organizations lists
//       the available slugs, data.organizationSlug names the selection, and
//       the output advises re-running with --organization <slug>.
//     --dry-run prepares the creation without any Cloud API write: data
//       carries requestUrl and requestBody (the prepared POST), nothing is
//       created and .env is not written.
//   Mock-injected @logic conditions (sandbox cannot produce them harmlessly):
//     --collision           Cloud API HTTP 400 "domain label already exists"
//     --needs-project       no project exists yet; project creation path
//     --mock-organizations <s1,s2,...>  the org list the token would see
//       (the sandbox account has one organization, so the multi-org premise
//       is injected; sanctioned by the feature's Rule + AGENTS.md)
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
} from "../support/cloud.ts";
import { makeNamespace } from "../support/sandbox.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";

function data(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data;
}

// ── Scenario: Agent accepts a pasted Saleor URL (@logic) ─────────────────
// Pure URL-normalization logic, exercised directly (no accounts).

Given(
  "the customer says they already have a Saleor store",
  function (this: JollyWorld) {
    // Shared premise marker (also used by feature 002's existing-store
    // scenario). No setup needed.
  },
);

When("the agent asks for the store connection", function (this: JollyWorld) {
  // The pasted forms are exercised in the Then steps below.
});

Then(
  "the customer may paste a Saleor Dashboard URL, storefront API URL, root Saleor Cloud URL, or GraphQL URL",
  function (this: JollyWorld) {
    const accepted = [
      "https://my-store.saleor.cloud/dashboard/",
      "https://my-store.saleor.cloud/graphql/",
      "https://my-store.eu.saleor.cloud",
      "https://my-store.saleor.cloud/graphql",
    ];
    for (const input of accepted) {
      const result = normalizeSaleorUrl(input);
      assert.ok(
        result.endpoint !== null,
        `"${input}" should be an accepted Saleor URL form, got clarification: ${result.clarification}`,
      );
    }
    this.notes["acceptedForms"] = accepted;
  },
);

Then(
  "Jolly should normalize the input to a Saleor GraphQL endpoint where possible",
  function (this: JollyWorld) {
    const accepted = this.notes["acceptedForms"] as string[];
    for (const input of accepted) {
      const result = normalizeSaleorUrl(input);
      assert.match(
        result.endpoint ?? "",
        /^https:\/\/[^/]+\/graphql\/$/,
        `"${input}" should normalize to https://<host>/graphql/, got "${result.endpoint}"`,
      );
    }
  },
);

Then(
  "Jolly should ask a clarifying question only when the URL cannot be normalized safely",
  function (this: JollyWorld) {
    // Normalizable inputs must not produce a clarifying question.
    for (const input of this.notes["acceptedForms"] as string[]) {
      const result = normalizeSaleorUrl(input);
      assert.equal(
        result.clarification,
        undefined,
        `"${input}" is normalizable and should not trigger a clarifying question`,
      );
    }
    // Un-normalizable inputs must.
    for (const input of ["not a url", "ftp://store.saleor.cloud", "https://example.com/some/random/path"]) {
      const result = normalizeSaleorUrl(input);
      assert.equal(result.endpoint, null, `"${input}" should not normalize`);
      assert.ok(
        typeof result.clarification === "string" && result.clarification.length > 0,
        `"${input}" should yield a clarifying question`,
      );
    }
  },
);

// ── Scenario: Jolly create store writes the Saleor URL to .env (@logic) ──

Given(
  "the agent has a Saleor GraphQL endpoint URL {string}",
  function (this: JollyWorld, url: string) {
    this.notes["endpointUrl"] = url;
  },
);

When(
  /^the agent runs `jolly create store --url https:\/\/test-shop\.saleor\.cloud\/graphql\/`$/,
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--url", "https://test-shop.saleor.cloud/graphql/"]);
  },
);

Then(
  "Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "NEXT_PUBLIC_SALEOR_API_URL" in values,
      `.env should contain NEXT_PUBLIC_SALEOR_API_URL; contents: ${JSON.stringify(Object.keys(values))}`,
    );
  },
);

Then(
  /^\.env should contain NEXT_PUBLIC_SALEOR_API_URL=https:\/\/test-shop\.saleor\.cloud\/graphql\/$/,
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["NEXT_PUBLIC_SALEOR_API_URL"],
      "https://test-shop.saleor.cloud/graphql/",
    );
  },
);

Then(
  "Jolly should not print the URL in a way that exposes the store path",
  function (this: JollyWorld) {
    // The machine-readable data object may carry the URL for the agent; the
    // human-facing summary must not expose the store host/path.
    assert.ok(
      !this.envelope.summary.includes("test-shop.saleor.cloud"),
      `summary should not expose the store URL: "${this.envelope.summary}"`,
    );
  },
);

// ── Scenario: Jolly validates the GraphQL endpoint (@sandbox) ────────────

Given(
  "Jolly has a candidate Saleor GraphQL endpoint",
  function (this: JollyWorld) {
    const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(url, "NEXT_PUBLIC_SALEOR_API_URL must be set (gated by @sandbox hook)");
    this.notes["candidateEndpoint"] = url;
  },
);

When("it validates the endpoint", function (this: JollyWorld) {
  const url = this.notes["candidateEndpoint"] as string;
  // Valid endpoint: live introspection-style validation must pass.
  this.runCli(["create", "store", "--url", url, "--validate", "--json"]);
  this.notes["validRun"] = this.lastRun;
  // Unreachable endpoint (.invalid TLD never resolves): validation must fail
  // before anything is written. Run in a fresh directory.
  const badDir = this.newTempDir("invalid-endpoint");
  this.runCli(
    ["create", "store", "--url", `https://${this.namespace}.invalid/graphql/`, "--validate", "--json"],
    { cwd: badDir },
  );
  this.notes["invalidRun"] = this.lastRun;
  this.notes["invalidRunDir"] = badDir;
});

Then(
  "it should perform an introspection-style GraphQL request or equivalent lightweight validation",
  function (this: JollyWorld) {
    const run = this.notes["validRun"] as JollyWorld["lastRun"];
    assert.ok(run?.envelope, "no envelope from the valid-endpoint run");
    assert.equal(
      run!.envelope!.status,
      "success",
      `validation of the live endpoint should succeed: ${JSON.stringify(run!.envelope!.errors)}`,
    );
    const check = run!.envelope!.checks.find(
      (c) => c.id === "create-store-validate-endpoint",
    );
    assert.ok(
      check,
      `expected check "create-store-validate-endpoint"; got: ${JSON.stringify(run!.envelope!.checks.map((c) => c.id))}`,
    );
    assert.equal(check!.status, "pass", "endpoint validation check should pass");
  },
);

Then(
  "it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint",
  function (this: JollyWorld) {
    const run = this.notes["invalidRun"] as JollyWorld["lastRun"];
    assert.ok(run?.envelope, "no envelope from the unreachable-endpoint run");
    assert.equal(run!.envelope!.status, "error", "unreachable endpoint must yield status error");
    const errors = run!.envelope!.errors;
    assert.ok(errors.length > 0, "errors[] must explain the validation failure");
    const first = errors[0] as Record<string, unknown>;
    assert.ok(
      typeof first.code === "string" && (first.code as string).length > 0,
      "error must carry a stable code",
    );
    assert.ok(
      typeof first.message === "string" && (first.message as string).length > 0,
      "error must carry an actionable message",
    );
  },
);

Then(
  "it should not proceed to storefront configuration until connectivity is verified",
  function (this: JollyWorld) {
    const badDir = this.notes["invalidRunDir"] as string;
    const values = loadEnvValues(badDir);
    assert.ok(
      !("NEXT_PUBLIC_SALEOR_API_URL" in values),
      "failed validation must not write the endpoint to .env",
    );
  },
);

// ── Scenario: Jolly infers Saleor Cloud organization and environment ─────

Given(
  "the customer has authenticated Jolly with Saleor Cloud",
  function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "JOLLY_SALEOR_CLOUD_TOKEN must be set (gated by @sandbox hook)");
    this.trackSecret(token!);
    this.runCli(["login", "--token", token!]);
    assert.equal(this.envelope.status, "success", "jolly login should succeed");
  },
);

Given(
  "Jolly has a verified Saleor GraphQL endpoint",
  function (this: JollyWorld) {
    const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(url, "NEXT_PUBLIC_SALEOR_API_URL must be set (gated by @sandbox hook)");
    this.notes["candidateEndpoint"] = url;
  },
);

When("Jolly needs Saleor Cloud context", function (this: JollyWorld) {
  const url = this.notes["candidateEndpoint"] as string;
  this.runCli(["create", "store", "--url", url, "--infer-cloud", "--json"]);
});

Then(
  "it should query available organizations and environments where APIs allow",
  function (this: JollyWorld) {
    const cloudContext = data(this).cloudContext as Record<string, unknown> | undefined;
    assert.ok(cloudContext, "envelope.data.cloudContext should describe the Cloud API context");
    assert.ok(
      Array.isArray(cloudContext.organizations) && cloudContext.organizations.length > 0,
      `cloudContext.organizations should list the account's organizations: ${JSON.stringify(cloudContext)}`,
    );
    assert.ok(
      Array.isArray(cloudContext.environments),
      "cloudContext.environments should list the queried environments",
    );
  },
);

Then(
  "it should match the GraphQL endpoint host to a Saleor Cloud environment domain where possible",
  function (this: JollyWorld) {
    const cloudContext = data(this).cloudContext as Record<string, unknown>;
    const host = new URL(this.notes["candidateEndpoint"] as string).host;
    assert.equal(
      typeof cloudContext.matched,
      "boolean",
      "cloudContext.matched must state whether the endpoint host matched an environment domain",
    );
    if (cloudContext.matched === true) {
      assert.ok(
        typeof cloudContext.matchedDomain === "string" &&
          (cloudContext.matchedDomain as string).includes(host.split(".")[0]),
        `cloudContext.matchedDomain ("${cloudContext.matchedDomain}") should correspond to the endpoint host "${host}"`,
      );
    }
  },
);

Then(
  "it should avoid asking the customer to manually select organization or environment when the match is unambiguous",
  function (this: JollyWorld) {
    const cloudContext = data(this).cloudContext as Record<string, unknown>;
    if (cloudContext.matched === true) {
      assert.notEqual(
        cloudContext.requiresSelection,
        true,
        "an unambiguous match must not ask the customer to select manually",
      );
      assert.ok(
        typeof cloudContext.organizationSlug === "string" &&
          (cloudContext.organizationSlug as string).length > 0,
        "the matched organization should be identified",
      );
    }
  },
);

Then(
  "it should ask the customer to choose only when multiple matches or no safe match exists",
  function (this: JollyWorld) {
    const cloudContext = data(this).cloudContext as Record<string, unknown>;
    if (cloudContext.matched !== true) {
      assert.equal(
        cloudContext.requiresSelection,
        true,
        "with no safe match the customer must be asked to choose",
      );
    }
  },
);

// ── Scenario: Jolly acquires the required app token (@sandbox) ───────────

Given("the endpoint has been verified", function (this: JollyWorld) {
  const url = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  assert.ok(url && token, "sandbox credentials must be present (gated by @sandbox hook)");
  this.trackSecret(token!);
  this.runCli(["login", "--token", token!]);
  this.runCli(["create", "store", "--url", url!]);
  this.notes["candidateEndpoint"] = url;
});

When(
  "Jolly needs credentials for Configurator or privileged Saleor operations",
  { timeout: 60_000 },
  function (this: JollyWorld) {
    // Detection first: is the token already available?
    this.runCli(["auth", "status", "--json"]);
    this.notes["statusBefore"] = this.lastRun;

    // Acquisition: list apps, then create a token for the first one.
    this.runCli(["create", "app-token", "--json"]);
    const apps = data(this).apps as Array<{ id: string; name: string }> | undefined;
    if (!Array.isArray(apps) || apps.length === 0) {
      this.notes["automationUnavailable"] = true;
      this.notes["acquisitionRun"] = this.lastRun;
      return;
    }
    this.runCli(["create", "app-token", "--app-id", apps[0].id, "--json"]);
    this.notes["acquisitionRun"] = this.lastRun;
  },
);

Then(
  "an app token or equivalent credential should be required before continuing the full existing-store setup",
  function (this: JollyWorld) {
    const statusBefore = this.notes["statusBefore"] as JollyWorld["lastRun"];
    assert.ok(statusBefore?.envelope, "auth status should emit an envelope");
    assert.ok(
      "hasAppToken" in (statusBefore!.envelope!.data as Record<string, unknown>),
      "auth status must report whether the app token requirement is satisfied",
    );
  },
);

Then(
  "Jolly should detect whether the token is already available in environment variables",
  function (this: JollyWorld) {
    const statusBefore = this.notes["statusBefore"] as JollyWorld["lastRun"];
    const reported = (statusBefore!.envelope!.data as Record<string, unknown>).hasAppToken;
    assert.equal(typeof reported, "boolean", "hasAppToken must be a boolean detection result");
    // The scenario's project dir started without an app token.
    assert.equal(reported, false, "no app token was configured before acquisition");
  },
);

Then(
  "if missing, Jolly should acquire or create the token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    if (this.notes["automationUnavailable"]) return; // guidance branch below
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      typeof values["JOLLY_SALEOR_APP_TOKEN"] === "string" &&
        values["JOLLY_SALEOR_APP_TOKEN"].length > 0,
      "JOLLY_SALEOR_APP_TOKEN should have been acquired and written to .env",
    );
    this.trackSecret(values["JOLLY_SALEOR_APP_TOKEN"]);
  },
);

Then(
  "Jolly may follow the deprecated CLI's example flow of authenticating to Saleor Cloud, resolving the instance, selecting or creating a Saleor local app, and creating an app token via the Saleor GraphQL API",
  function (this: JollyWorld) {
    // "may": the deprecated CLI is reference material only — nothing to assert.
  },
);

Then(
  "if automation is unavailable, it should guide the customer through the current Saleor Dashboard token creation path",
  function (this: JollyWorld) {
    if (!this.notes["automationUnavailable"]) return; // automation succeeded
    const run = this.notes["acquisitionRun"] as JollyWorld["lastRun"];
    const nextSteps = run!.envelope!.nextSteps;
    assert.ok(
      nextSteps.some((step) =>
        String(step.description).toLowerCase().includes("dashboard"),
      ),
      `nextSteps should guide through the Saleor Dashboard token path: ${JSON.stringify(nextSteps)}`,
    );
  },
);

Then(
  "it should avoid storing the token outside environment variables",
  function (this: JollyWorld) {
    const run = this.notes["acquisitionRun"] as JollyWorld["lastRun"];
    this.assertNoSecretsIn(
      run!.stdout + run!.stderr,
      "app-token acquisition output",
    );
  },
);

Then(
  "it should use the token to run Configurator introspection",
  function (this: JollyWorld) {
    if (this.notes["automationUnavailable"]) return;
    const run = this.notes["acquisitionRun"] as JollyWorld["lastRun"];
    const envelopeText = JSON.stringify(run!.envelope).toLowerCase();
    assert.ok(
      envelopeText.includes("configurator"),
      "the acquisition flow should run (or direct the agent to) Configurator introspection",
    );
  },
);

// ── Scenario: Jolly create store --dry-run does not write to .env ────────

When(
  /^the agent runs `jolly create store --url https:\/\/shop\.saleor\.cloud\/graphql\/ --dry-run --json`$/,
  function (this: JollyWorld) {
    this.runCli([
      "create", "store",
      "--url", "https://shop.saleor.cloud/graphql/",
      "--dry-run", "--json",
    ]);
  },
);

Then(
  "the output should include the normalized URL in the data object",
  function (this: JollyWorld) {
    assert.equal(
      data(this).url,
      "https://shop.saleor.cloud/graphql/",
      `data.url should carry the normalized URL: ${JSON.stringify(data(this))}`,
    );
  },
);

// ── Scenario: Jolly create store builds a Cloud API environment creation
//    request (@logic) ──────────────────────────────────────────────────────

Given(
  "the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    // Real token when present (sandbox); a dummy otherwise so @logic
    // request-construction scenarios can run without accounts.
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    if (token) this.trackSecret(token);
    this.runCli([
      "login", "--token", token ?? "test-cloud-token-for-logic",
    ]);
  },
);

Given(
  "the agent has selected or created a Saleor Cloud organization",
  function (this: JollyWorld) {
    // Premise marker — the organization appears in the constructed request.
  },
);

When(
  "Jolly prepares to create a new Saleor Cloud environment from the Cloud API",
  function (this: JollyWorld) {
    this.runCli([
      "create", "store",
      "--url", "https://test-shop.saleor.cloud/graphql/",
      "--json",
    ]);
  },
);

Then(
  /^it should POST to \/platform\/api\/organizations\/\{organization\}\/environments\/$/,
  function (this: JollyWorld) {
    assert.match(
      String(data(this).requestUrl),
      /\/platform\/api\/organizations\/[^/]+\/environments\/$/,
      `data.requestUrl should be the Cloud API environments endpoint: ${data(this).requestUrl}`,
    );
  },
);

Then(
  "the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials",
  function (this: JollyWorld) {
    const body = data(this).requestBody as Record<string, unknown> | undefined;
    assert.ok(body, "data.requestBody should carry the constructed POST body");
    for (const field of ["name", "project", "domain_label", "database_population", "service"]) {
      assert.ok(field in body!, `requestBody should include "${field}": ${JSON.stringify(body)}`);
    }
    // basic-auth credentials are optional — present or absent are both valid.
  },
);

Then(
  "the default region should be {string}",
  function (this: JollyWorld, region: string) {
    const body = data(this).requestBody as Record<string, unknown>;
    assert.equal(body.region, region);
  },
);

Then(
  "the default database template should be {string}",
  function (this: JollyWorld, template: string) {
    const body = data(this).requestBody as Record<string, unknown>;
    assert.equal(body.database_population, template);
  },
);

// Shared by the @logic request-construction scenario and the @sandbox
// environment-creation scenario.
Then(
  "the environment creation should return a task_id for async job polling",
  function (this: JollyWorld) {
    assert.ok(
      typeof data(this).taskId === "string" && (data(this).taskId as string).length > 0,
      `data.taskId should be the async task id: ${JSON.stringify(data(this))}`,
    );
  },
);

Then(
  /^Jolly should poll GET \/platform\/api\/service\/task-status\/\{task_id\} until status is "SUCCEEDED"$/,
  function (this: JollyWorld) {
    const taskId = data(this).taskId as string;
    assert.match(
      String(data(this).taskPollUrl),
      new RegExp(`/platform/api/service/task-status/${taskId}`),
      `data.taskPollUrl should poll the task status endpoint: ${data(this).taskPollUrl}`,
    );
    const finalStatus = data(this).taskStatus ?? data(this).taskFinalStatus;
    assert.equal(finalStatus, "SUCCEEDED", "polling must continue until SUCCEEDED");
  },
);

Then(
  "once complete, it should set NEXT_PUBLIC_SALEOR_API_URL from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      typeof values["NEXT_PUBLIC_SALEOR_API_URL"] === "string" &&
        values["NEXT_PUBLIC_SALEOR_API_URL"].length > 0,
      "NEXT_PUBLIC_SALEOR_API_URL should be set in .env",
    );
  },
);

// ── Scenario: Jolly create store handles domain name collision (@logic) ──

Given(
  "Jolly submits an environment creation with a domain that already exists",
  function (this: JollyWorld) {
    this.notes["collisionDomain"] = "existing-shop";
  },
);

When(
  "the Cloud API responds with HTTP {int} and {string}",
  function (this: JollyWorld, _status: number, _message: string) {
    // The sandbox cannot produce a domain collision harmlessly (it would
    // need a pre-existing environment), so the condition is mock-injected.
    this.runCli([
      "create", "store",
      "--url", "https://existing-shop.saleor.cloud/graphql/",
      "--collision", "--json",
    ]);
  },
);

Then(
  "Jolly should suggest an alternative domain label",
  function (this: JollyWorld) {
    const suggested = data(this).suggestedDomain;
    assert.ok(
      typeof suggested === "string" && suggested.length > 0,
      `data.suggestedDomain should propose an alternative: ${JSON.stringify(data(this))}`,
    );
    assert.notEqual(
      suggested,
      this.notes["collisionDomain"],
      "the suggestion must differ from the colliding label",
    );
  },
);

Then(
  "it should allow the agent to provide a new domain",
  function (this: JollyWorld) {
    assert.equal(
      data(this).retryAvailable,
      true,
      "data.retryAvailable should signal that the agent may provide a new domain",
    );
  },
);

Then(
  "it should retry the request with the corrected domain",
  function (this: JollyWorld) {
    assert.equal(
      data(this).retried,
      true,
      "data.retried should confirm the request was retried with the corrected domain",
    );
  },
);

// ── Scenario: Jolly create store creates a project when none exists ──────

Given(
  "the agent has not created or selected a Saleor Cloud project",
  function (this: JollyWorld) {
    // Premise marker — the no-project condition is mock-injected below.
  },
);

When(
  "Jolly needs a project for environment creation",
  function (this: JollyWorld) {
    this.runCli([
      "create", "store",
      "--url", "https://new-project.saleor.cloud/graphql/",
      "--needs-project", "--json",
    ]);
  },
);

Then(
  /^it should create a project via POST \/platform\/api\/organizations\/\{organization\}\/projects\/$/,
  function (this: JollyWorld) {
    assert.match(
      String(data(this).projectCreateUrl),
      /\/platform\/api\/organizations\/[^/]+\/projects\/$/,
      `data.projectCreateUrl should be the Cloud API projects endpoint: ${data(this).projectCreateUrl}`,
    );
    assert.equal(data(this).projectCreated, true, "data.projectCreated should be true");
  },
);

Then(
  'the project body should include name, plan="dev", and region',
  function (this: JollyWorld) {
    const body = data(this).projectBody as Record<string, unknown> | undefined;
    assert.ok(body, "data.projectBody should carry the project POST body");
    assert.ok(typeof body!.name === "string" && (body!.name as string).length > 0);
    assert.equal(body!.plan, "dev");
    assert.ok(typeof body!.region === "string" && (body!.region as string).length > 0);
  },
);

Then(
  "it should proceed to create the environment in the new project",
  function (this: JollyWorld) {
    assert.equal(
      data(this).environmentCreated,
      true,
      "data.environmentCreated should be true after the project was created",
    );
  },
);

// ── Scenario: Jolly create store honors --region and --organization
//    overrides (@logic, via the --dry-run path) ──────────────────────────
// --create-environment --dry-run must prepare the request without any Cloud
// API call, so it must work with a dummy token. The runs below force one:
// harmless by design means a logic-tier test can never create a real
// environment, even against a CLI that does not implement --dry-run yet.

const LOGIC_CLOUD_TOKEN = "test-cloud-token-for-logic";

When(
  "the agent runs `jolly create store --create-environment --organization other-org --region eu-central-1 --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(
      [
        "create", "store", "--create-environment",
        "--organization", "other-org",
        "--region", "eu-central-1",
        "--dry-run", "--json",
      ],
      { env: { JOLLY_SALEOR_CLOUD_TOKEN: LOGIC_CLOUD_TOKEN } },
    );
  },
);

Then(
  "the prepared environment creation should target organization {string}",
  function (this: JollyWorld, organization: string) {
    assert.equal(
      data(this).organizationSlug,
      organization,
      `data.organizationSlug should be the --organization override: ${JSON.stringify(data(this))}`,
    );
    assert.match(
      String(data(this).requestUrl),
      new RegExp(`/platform/api/organizations/${organization}/environments/$`),
      `data.requestUrl should target the overridden organization: ${data(this).requestUrl}`,
    );
  },
);

Then(
  "the prepared environment creation region should be {string}",
  function (this: JollyWorld, region: string) {
    const body = data(this).requestBody as Record<string, unknown> | undefined;
    assert.ok(body, "data.requestBody should carry the prepared POST body");
    assert.equal(
      body!.region,
      region,
      `requestBody.region should be the --region override: ${JSON.stringify(body)}`,
    );
  },
);

// ── Scenario: Jolly create store warns when the token has multiple
//    organizations (@logic) ────────────────────────────────────────────────
// The sandbox account has exactly one organization, so the multi-org premise
// is mock-injected via --mock-organizations (sanctioned by the feature Rule).

Given(
  "the Cloud token can access organizations {string} and {string}",
  function (this: JollyWorld, orgOne: string, orgTwo: string) {
    this.notes["mockOrganizations"] = [orgOne, orgTwo];
    // The org list is mock-injected; a dummy token keeps this @logic and
    // guarantees the real account is never touched.
    this.runCli(["login", "--token", LOGIC_CLOUD_TOKEN], {
      env: { JOLLY_SALEOR_CLOUD_TOKEN: LOGIC_CLOUD_TOKEN },
    });
  },
);

When(
  "the agent runs `jolly create store --create-environment` without `--organization`",
  function (this: JollyWorld) {
    const organizations = this.notes["mockOrganizations"] as string[];
    this.runCli(
      [
        "create", "store", "--create-environment",
        "--mock-organizations", organizations.join(","),
        "--dry-run", "--json",
      ],
      { env: { JOLLY_SALEOR_CLOUD_TOKEN: LOGIC_CLOUD_TOKEN } },
    );
  },
);

Then(
  "the output envelope status should be {string}",
  function (this: JollyWorld, status: string) {
    assert.equal(
      this.envelope.status,
      status,
      `envelope status should be "${status}": ${this.envelope.summary}`,
    );
  },
);

Then(
  "the output should list the available organization slugs",
  function (this: JollyWorld) {
    const expected = this.notes["mockOrganizations"] as string[];
    const listed = data(this).organizations;
    assert.ok(
      Array.isArray(listed),
      `data.organizations should list the available organizations: ${JSON.stringify(data(this))}`,
    );
    const slugs = (listed as unknown[]).map((entry) =>
      typeof entry === "string"
        ? entry
        : String((entry as Record<string, unknown>).slug),
    );
    for (const slug of expected) {
      assert.ok(
        slugs.includes(slug),
        `data.organizations should include "${slug}": ${JSON.stringify(slugs)}`,
      );
    }
  },
);

Then(
  "the output should name the organization slug Jolly selected",
  function (this: JollyWorld) {
    const expected = this.notes["mockOrganizations"] as string[];
    const selected = data(this).organizationSlug;
    assert.ok(
      typeof selected === "string" && expected.includes(selected),
      `data.organizationSlug should name the selected organization (one of ${expected.join(", ")}): got ${JSON.stringify(selected)}`,
    );
  },
);

Then(
  "the output should advise re-running with `--organization <slug>` if the selection is wrong",
  function (this: JollyWorld) {
    const advice =
      JSON.stringify(this.envelope.nextSteps) + this.envelope.summary;
    assert.ok(
      advice.includes("--organization"),
      `the envelope should advise re-running with --organization: nextSteps=${JSON.stringify(this.envelope.nextSteps)}, summary="${this.envelope.summary}"`,
    );
  },
);

// ── Scenario: Jolly creates a Saleor Cloud environment (@sandbox) ────────
// Must work against organizations that already have projects and
// environments. ENVIRONMENT_LIMIT_REACHED is an environmental skip. The
// created environment carries the run's jolly-test namespace as its name
// and domain label (via --name/--domain-label) and its deletion is
// registered in teardown so a run never permanently consumes a sandbox slot
// — including when the CLI times out or crashes after creation but before
// emitting an envelope: a catch-all diff teardown is registered BEFORE the
// CLI runs, deleting any environment that did not exist in the pre-run
// snapshot and carries a name this run could have generated.

Given(
  "no leftover jolly-test environment remains from a previous run",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(cloudToken, "JOLLY_SALEOR_CLOUD_TOKEN must be set (gated by @sandbox hook)");
    const leftovers = leftoverTestEnvironments(
      await listAllEnvironments(cloudToken!),
      makeNamespace(this.runId),
    );
    if (leftovers.length > 0) {
      // Leftovers block creation. This non-interactive run never deletes an
      // environment it cannot positively identify as its own — skip, naming
      // the leftover so the customer can remove it (feature 012 Rule).
      const named = leftovers
        .map((env) => `${env.org}/${env.key} ("${env.name}")`)
        .join(", ");
      this.attach(
        `Skipped: leftover jolly-test environment(s) from a previous run: ${named}. ` +
          "Delete them to re-enable this scenario.",
        "text/plain",
      );
      return "skipped";
    }
  },
);

When(
  "the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-test identifier",
  { timeout: 600_000 },
  async function (this: JollyWorld) {
    // Catch-all teardown, registered before the CLI can create anything: if
    // the run dies without an envelope (timeout, crash), the diff against
    // this snapshot still finds and deletes whatever it created. Only
    // environments absent from the snapshot and carrying a name this run
    // could have generated are touched — never a pre-existing resource.
    // (jolly-env-* covers a CLI that ignores --name and falls back to its
    // own generated names; such an environment still must not leak.)
    const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    const environmentName = this.namespace;
    this.notes["requestedEnvironmentName"] = environmentName;
    if (cloudToken) {
      const snapshot = new Set(
        (await listAllEnvironments(cloudToken)).map((env) => env.key),
      );
      this.cleanup.register(
        "Saleor Cloud environments created by this run (catch-all diff vs pre-run snapshot)",
        async () => {
          for (const env of await listAllEnvironments(cloudToken)) {
            if (
              !snapshot.has(env.key) &&
              (env.name.startsWith(this.namespace) ||
                env.name.startsWith("jolly-env-"))
            ) {
              await deleteEnvironment(cloudToken, env.org, env.key);
            }
          }
        },
      );
    }

    this.runCli(
      [
        "create", "store", "--create-environment",
        "--name", environmentName,
        "--domain-label", environmentName,
        "--json",
      ],
      { timeoutMs: 540_000 },
    );
    const envelope = this.envelope;

    if (
      envelope.status === "error" &&
      envelope.errors.some((e) => e.code === "ENVIRONMENT_LIMIT_REACHED")
    ) {
      // The organization's sandbox capacity — not Jolly's behavior — blocked
      // the run: environmental skip, like absent credentials (feature 012
      // Rule / feature 023).
      this.attach(
        "Skipped: Cloud API rejected environment creation with " +
          "ENVIRONMENT_LIMIT_REACHED (organization sandbox limit). " +
          "Delete an unused environment or upgrade the plan to run this scenario.",
        "text/plain",
      );
      return "skipped";
    }

    // Precise teardown for the reported environment, registered before any
    // assertion can fail (LIFO: runs before the catch-all diff, which then
    // finds nothing left to remove).
    const created = envelope.data as Record<string, unknown>;
    const organizationSlug = created.organizationSlug;
    const environmentKey = created.environmentKey;
    if (
      typeof organizationSlug === "string" &&
      typeof environmentKey === "string" &&
      cloudToken
    ) {
      this.cleanup.register(
        `Saleor Cloud environment ${organizationSlug}/${environmentKey}`,
        () => deleteEnvironment(cloudToken, organizationSlug, environmentKey),
      );
      this.notes["environmentTeardownRegistered"] = true;
    }
  },
);

Then(
  "the created environment's name and domain label should carry the run's jolly-test namespace",
  function (this: JollyWorld) {
    const requested = this.notes["requestedEnvironmentName"] as string;
    assert.equal(
      data(this).environmentName,
      requested,
      `data.environmentName should be the namespaced --name override "${requested}": ${JSON.stringify(data(this))}`,
    );
    assert.match(
      String(data(this).domainUrl),
      new RegExp(`^https://${requested}\\.`),
      `data.domainUrl should start with the namespaced --domain-label "${requested}": ${data(this).domainUrl}`,
    );
  },
);

Then(
  "teardown should delete the created environment right after the scenario",
  function (this: JollyWorld) {
    // The deletion must be REGISTERED (feature 012: before creation can
    // begin); the After hook then executes it and fails loudly if the
    // environment could not be removed.
    assert.equal(
      this.notes["environmentTeardownRegistered"],
      true,
      "a teardown deletion for the created environment should have been registered",
    );
    assert.ok(
      this.cleanup.size > 0,
      "the cleanup registry should hold the registered environment deletion",
    );
  },
);

Then(
  "Jolly should discover the organization from the Cloud API",
  function (this: JollyWorld) {
    assert.ok(
      typeof data(this).organizationSlug === "string" &&
        (data(this).organizationSlug as string).length > 0,
      `data.organizationSlug should identify the discovered organization: ${JSON.stringify(data(this))}`,
    );
  },
);

Then(
  /^it should reuse an existing project when one exists, otherwise create one via POST \/platform\/api\/organizations\/\{organization\}\/projects\/ with plan="dev"$/,
  function (this: JollyWorld) {
    const d = data(this);
    assert.ok(
      typeof d.projectName === "string" && (d.projectName as string).length > 0,
      "data.projectName should identify the project used",
    );
    assert.equal(typeof d.projectCreated, "boolean", "data.projectCreated must be a boolean");
    assert.equal(typeof d.projectReused, "boolean", "data.projectReused must be a boolean");
    if (d.projectCreated === true) {
      assert.equal(d.projectPlan, "dev", 'a newly created project must use plan "dev"');
    }
  },
);

Then(
  "the output envelope data should state whether the project was created or reused",
  function (this: JollyWorld) {
    const d = data(this);
    assert.notEqual(
      d.projectCreated,
      d.projectReused,
      `exactly one of projectCreated/projectReused must be true: created=${d.projectCreated}, reused=${d.projectReused}`,
    );
  },
);

Then(
  /^it should create an environment via POST \/platform\/api\/organizations\/\{organization\}\/environments\/$/,
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success", `environment creation should succeed: ${JSON.stringify(this.envelope.errors)}`);
    assert.ok(
      typeof data(this).environmentKey === "string" &&
        (data(this).environmentKey as string).length > 0,
      "data.environmentKey should identify the created environment (used for teardown deletion)",
    );
  },
);

Then(
  "Jolly should extract the resulting domain from the task result",
  function (this: JollyWorld) {
    assert.match(
      String(data(this).domainUrl),
      /^https:\/\/[^/]+\/graphql\/$/,
      `data.domainUrl should be the new environment's GraphQL URL: ${data(this).domainUrl}`,
    );
  },
);

Then(
  "it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.equal(
      values["NEXT_PUBLIC_SALEOR_API_URL"],
      data(this).domainUrl,
      ".env NEXT_PUBLIC_SALEOR_API_URL should equal the resulting domain URL",
    );
  },
);

Then(
  "it should create an app token via the Saleor GraphQL API",
  function (this: JollyWorld) {
    assert.equal(
      data(this).appTokenCreated,
      true,
      "data.appTokenCreated should confirm app token creation on the new instance",
    );
  },
);

Then(
  "it should write JOLLY_SALEOR_APP_TOKEN to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      typeof values["JOLLY_SALEOR_APP_TOKEN"] === "string" &&
        values["JOLLY_SALEOR_APP_TOKEN"].length > 0,
      "JOLLY_SALEOR_APP_TOKEN should be written to .env",
    );
    this.trackSecret(values["JOLLY_SALEOR_APP_TOKEN"]);
  },
);
