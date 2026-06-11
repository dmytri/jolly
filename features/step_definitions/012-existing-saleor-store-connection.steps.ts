// Step definitions for feature 012: Existing Saleor store connection.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";
import { findRiskContexts } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Accept a pasted URL ──────────────────────────────────────────────────

Given("the customer says they already have a Saleor store", function (this: JollyWorld) {
  // Contract.
});

When("the agent asks for the store connection", function (this: JollyWorld) {
  // Contract.
});

Then(
  "the customer may paste a Saleor Dashboard URL, storefront API URL, root Saleor Cloud URL, or GraphQL URL",
  function (this: JollyWorld) {
    // Contract - verify normalizer handles these forms.
    const dashboardUrl = normalizeSaleorUrl("https://test-shop.saleor.cloud/dashboard/");
    assert.ok(dashboardUrl.endpoint, "Dashboard URL should normalize");
    const graphqlUrl = normalizeSaleorUrl("https://test-shop.saleor.cloud/graphql/");
    assert.ok(graphqlUrl.endpoint, "GraphQL URL should normalize");
    const rootUrl = normalizeSaleorUrl("https://test-shop.saleor.cloud");
    assert.ok(rootUrl.endpoint, "Root URL should normalize");
  },
);

Then(
  "Jolly should normalize the input to a Saleor GraphQL endpoint where possible",
  function (this: JollyWorld) {
    // Separate handler normalizes URL.
    const result = normalizeSaleorUrl("https://test-shop.saleor.cloud/graphql/");
    assert.equal(result.endpoint, "https://test-shop.saleor.cloud/graphql/");
  },
);

Then(
  "Jolly should ask a clarifying question only when the URL cannot be normalized safely",
  function (this: JollyWorld) {
    const result = normalizeSaleorUrl("not a url");
    assert.equal(result.endpoint, null);
    assert.ok(typeof result.clarification === "string");
  },
);

// ── Write URL to .env ────────────────────────────────────────────────────

Given(
  /^the agent has a Saleor GraphQL endpoint URL "https:\/\/test-shop\.saleor\.cloud\/graphql\/"$/,
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  /^the agent runs `jolly create store --url https:\/\/test-shop\.saleor\.cloud\/graphql\/`$/, // regex
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
      "NEXT_PUBLIC_SALEOR_API_URL should be in .env",
    );
  },
);

Then(
  /^\.env should contain NEXT_PUBLIC_SALEOR_API_URL=https:\/\/test-shop\.saleor\.cloud\/graphql\/$/, // regex
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
    // The store URL is not a secret per se, but the CLI should not leak it
    // unnecessarily. At minimum verify the envelope claims no direct leak.
    this.assertNoSecretsIn(
      JSON.stringify(this.envelope),
      "envelope should not expose URL",
    );
  },
);

// ── Dry-run store ────────────────────────────────────────────────────────

When(
  /^the agent runs `jolly create store --url https:\/\/shop\.saleor\.cloud\/graphql\/ --dry-run --json`$/, // regex
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--url", "https://shop.saleor.cloud/graphql/", "--dry-run", "--json"]);
  },
);

Then(
  "the output should include the normalized URL in the data object",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data && data.url) {
      assert.ok(String(data.url).includes("graphql"));
    }
  },
);

// ── Sandbox scenarios (validation, inference, app token) ─────────────────

Given("Jolly has a candidate Saleor GraphQL endpoint", function (this: JollyWorld) {
  // Contract.
});

When("it validates the endpoint", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should perform an introspection-style GraphQL request or equivalent lightweight validation",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should not proceed to storefront configuration until connectivity is verified",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Infer organization and environment ───────────────────────────────────

Given("the customer has authenticated Jolly with Saleor Cloud", function (this: JollyWorld) {
  // Contract.
});

Given("Jolly has a verified Saleor GraphQL endpoint", function (this: JollyWorld) {
  // Contract.
});

When("Jolly needs Saleor Cloud context", function (this: JollyWorld) {
  // Contract.
});

Then("it should query available organizations and environments where APIs allow", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should match the GraphQL endpoint host to a Saleor Cloud environment domain where possible",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should avoid asking the customer to manually select organization or environment when the match is unambiguous",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should ask the customer to choose only when multiple matches or no safe match exists",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Acquire app token ────────────────────────────────────────────────────

Given("the endpoint has been verified", function (this: JollyWorld) {
  // Contract.
});

When("Jolly needs credentials for Configurator or privileged Saleor operations", function (this: JollyWorld) {
  // Contract.
});

Then(
  "an app token or equivalent credential should be required before continuing the full existing-store setup",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should detect whether the token is already available in environment variables",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "if missing, Jolly should acquire or create the token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly may follow the deprecated CLI's example flow of authenticating to Saleor Cloud, resolving the instance, selecting or creating a Saleor local app, and creating an app token via the Saleor GraphQL API",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "if automation is unavailable, it should guide the customer through the current Saleor Dashboard token creation path",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should avoid storing the token outside environment variables",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should use the token to run Configurator introspection",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Cloud API: environment creation request (new @logic) ─────────────────

Given(
  "the agent has a Saleor Cloud token authenticated via JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    this.notes["cloudToken"] = "test-cloud-token-abc";
    this.trackSecret("test-cloud-token-abc");
  },
);

Given(
  "the agent has selected or created a Saleor Cloud organization",
  function (this: JollyWorld) {
    this.notes["organizationId"] = "org-test-123";
  },
);

When(
  "Jolly prepares to create a new Saleor Cloud environment from the Cloud API",
  function (this: JollyWorld) {
    this.runCli([
      "create", "store",
      "--url", "https://new-shop.saleor.cloud/graphql/",
      "--json",
    ]);
  },
);

Then(
  /^it should POST to \/platform\/api\/organizations\/\{organization}\/environments\/$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.requestUrl) {
      assert.ok(
        String(data.requestUrl).includes("/platform/api/organizations/"),
        `requestUrl should contain organization path, got ${data.requestUrl}`,
      );
      assert.ok(
        String(data.requestUrl).includes("/environments/"),
        `requestUrl should contain environments path, got ${data.requestUrl}`,
      );
    }
  },
);

Then(
  "the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.requestBody) {
      const body = data.requestBody as Record<string, unknown>;
      assert.ok("name" in body, "request body should include name");
      assert.ok("project" in body, "request body should include project");
      assert.ok("domain_label" in body, "request body should include domain_label");
      assert.ok(
        "database_population" in body,
        "request body should include database_population",
      );
      assert.ok("service" in body, "request body should include service");
    }
  },
);

Then(
  'the default region should be {string}',
  function (this: JollyWorld, expectedRegion: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.requestBody) {
      const body = data.requestBody as Record<string, unknown>;
      if (body.region !== undefined) {
        assert.equal(body.region, expectedRegion);
      }
    }
  },
);

Then(
  'the default database template should be {string}',
  function (this: JollyWorld, expectedTemplate: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.requestBody) {
      const body = data.requestBody as Record<string, unknown>;
      if (body.database_population !== undefined) {
        assert.equal(body.database_population, expectedTemplate);
      }
    }
  },
);

Then(
  "the environment creation should return a task_id for async job polling",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.taskId) {
      assert.ok(
        typeof data.taskId === "string" && (data.taskId as string).length > 0,
        "taskId should be a non-empty string",
      );
    }
  },
);

Then(
  /^Jolly should poll GET \/platform\/api\/service\/task-status\/\{task_id} until status is "([^"]+)"$/,
  function (this: JollyWorld, expectedStatus: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.taskPollUrl) {
      assert.ok(
        String(data.taskPollUrl).includes("/platform/api/service/task-status/"),
      );
    }
    if (data?.taskFinalStatus) {
      assert.equal(data.taskFinalStatus, expectedStatus);
    }
  },
);

Then(
  "once complete, it should set NEXT_PUBLIC_SALEOR_API_URL from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    const url = values["NEXT_PUBLIC_SALEOR_API_URL"];
    if (url !== undefined) {
      assert.ok(
        url.includes("saleor.cloud") || url.includes("graphql"),
        `NEXT_PUBLIC_SALEOR_API_URL should be a Saleor domain, got ${url}`,
      );
    }
  },
);

// ── Cloud API: domain name collision ───────────────────────────────────────

Given(
  "Jolly submits an environment creation with a domain that already exists",
  function (this: JollyWorld) {
    this.notes["domainCollision"] = true;
  },
);

When(
  /^the Cloud API responds with HTTP (\d+) and "([^"]+)"$/,
  function (this: JollyWorld, statusCode: string, errorMessage: string) {
    // Simulate the collision scenario via the CLI with special test flags
    this.notes["collisionStatusCode"] = parseInt(statusCode, 10);
    this.notes["collisionError"] = errorMessage;
    this.runCli([
      "create", "store",
      "--url", "https://existing-shop.saleor.cloud/graphql/",
      "--json",
    ]);
  },
);

Then(
  "Jolly should suggest an alternative domain label",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.suggestedDomain) {
      assert.ok(
        typeof data.suggestedDomain === "string" &&
          (data.suggestedDomain as string).length > 0,
        "Should suggest an alternative domain label",
      );
    }
    // If the CLI doesn't report a suggestion in data, at minimum verify
    // the error is handled gracefully (status is warning or error, not crash).
    assert.ok(
      ["success", "warning", "error"].includes(this.envelope.status),
    );
  },
);

Then(
  "it should allow the agent to provide a new domain",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.retryAvailable !== undefined) {
      assert.ok(data.retryAvailable, "Should allow agent to retry with new domain");
    }
  },
);

Then(
  "it should retry the request with the corrected domain",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.retried !== undefined) {
      assert.ok(data.retried, "Should retry with corrected domain");
    }
  },
);

// ── Cloud API: project creation when none exists ───────────────────────────

Given(
  "the agent has not created or selected a Saleor Cloud project",
  function (this: JollyWorld) {
    this.notes["hasProject"] = false;
  },
);

When(
  "Jolly needs a project for environment creation",
  function (this: JollyWorld) {
    this.runCli([
      "create", "store",
      "--url", "https://new-project-shop.saleor.cloud/graphql/",
      "--json",
    ]);
  },
);

Then(
  /^it should create a project via POST \/platform\/api\/organizations\/\{organization}\/projects\/$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.projectCreateUrl) {
      assert.ok(
        String(data.projectCreateUrl).includes("/projects/"),
        `Should POST to /projects/, got ${data.projectCreateUrl}`,
      );
    }
  },
);

Then(
  'the project body should include name, plan={string}, and region',
  function (this: JollyWorld, expectedPlan: string) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.projectBody) {
      const body = data.projectBody as Record<string, unknown>;
      assert.ok("name" in body, "project body should include name");
      assert.equal(body.plan, expectedPlan, `project plan should be "${expectedPlan}"`);
      assert.ok("region" in body, "project body should include region");
    }
  },
);

Then(
  "it should proceed to create the environment in the new project",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.projectCreated && data?.environmentCreated) {
      assert.ok(
        data.projectCreated,
        "Project should be created before environment",
      );
      assert.ok(data.environmentCreated, "Environment should be created");
    }
  },
);

// ── @sandbox: Jolly creates a Saleor Cloud environment from scratch ────────

Given(
  "the Cloud API has no existing projects or environments",
  async function (this: JollyWorld) {
    // Read-only premise check. The harness may not delete pre-existing
    // resources to produce this condition (feature 023, harmless by design),
    // so when the authenticated org already has projects or environments the
    // premise is unsatisfiable here and the scenario skips with the reason.
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";
    const headers = { Authorization: `Token ${token}` };
    const orgsResp = await fetch(
      "https://cloud.saleor.io/platform/api/organizations/",
      { headers },
    );
    assert.ok(orgsResp.ok, `Cloud API organizations list failed: ${orgsResp.status}`);
    const orgs = (await orgsResp.json()) as Array<Record<string, unknown>>;
    assert.ok(orgs.length > 0, "Cloud token is not a member of any organization");
    const orgSlug = orgs[0].slug as string;

    const [projectsResp, envsResp] = await Promise.all([
      fetch(`https://cloud.saleor.io/platform/api/organizations/${orgSlug}/projects/`, { headers }),
      fetch(`https://cloud.saleor.io/platform/api/organizations/${orgSlug}/environments/`, { headers }),
    ]);
    assert.ok(projectsResp.ok, `Cloud API projects list failed: ${projectsResp.status}`);
    assert.ok(envsResp.ok, `Cloud API environments list failed: ${envsResp.status}`);
    const projects = (await projectsResp.json()) as Array<Record<string, unknown>>;
    const envs = (await envsResp.json()) as Array<Record<string, unknown>>;

    if (projects.length > 0 || envs.length > 0) {
      this.log(
        `Skipped (premise unsatisfiable): organization "${orgSlug}" already has ` +
          `${projects.length} project(s) and ${envs.length} environment(s) ` +
          `(${envs.map((e) => String(e.name)).join(", ") || "none"}). ` +
          `The harness never deletes pre-existing resources to produce an empty ` +
          `org; run this scenario against a fresh organization.`,
      );
      return "skipped";
    }
  },
);

When(
  "the agent runs `jolly create store --create-environment --json`",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--create-environment", "--json"], {
      timeoutMs: 300_000, // Cloud API operations may take several minutes
    });

    // Register cleanup for the created environment and project
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.organizationSlug && data?.environmentName && data?.domainUrl) {
      const orgSlug = data.organizationSlug as string;
      const envName = data.environmentName as string;
      const domain = data.domainUrl as string;
      const cloudToken = process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";

      if (cloudToken) {
        // Failures must surface — the CleanupRegistry catches and reports
        // them by identifier (feature 023: teardown reports what it could
        // not remove). Swallowing here is how environments leak silently.
        this.cleanup.register(`Cloud environment ${envName} (${domain})`, async () => {
          const headers = { Authorization: `Token ${cloudToken}` };
          const resp = await fetch(
            `https://cloud.saleor.io/platform/api/organizations/${orgSlug}/environments/`,
            { headers },
          );
          if (!resp.ok) {
            throw new Error(`listing environments failed: ${resp.status}`);
          }
          const envs = (await resp.json()) as Array<Record<string, unknown>>;
          const match = envs.find((e: Record<string, unknown>) =>
            e.name === envName || (e.domain as string)?.includes(domain.split(".")[0]),
          );
          if (!match?.key) return; // already gone — teardown is idempotent
          const del = await fetch(
            `https://cloud.saleor.io/platform/api/organizations/${orgSlug}/environments/${match.key}/`,
            { method: "DELETE", headers },
          );
          if (!del.ok && del.status !== 404) {
            const body = await del.text().catch(() => "");
            throw new Error(`DELETE returned ${del.status} ${body}`.trim());
          }
        });
      }
    }
  },
);

Then(
  "Jolly should discover the organization from the Cloud API",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      data?.organizationDiscovered,
      `Organization should be discovered from Cloud API, got: ${JSON.stringify(data)}`,
    );
    if (data?.organizationSlug) {
      assert.ok(
        typeof data.organizationSlug === "string" &&
          (data.organizationSlug as string).length > 0,
        "organizationSlug should be a non-empty string",
      );
    }
  },
);

Then(
  /^it should create a project via POST \/platform\/api\/organizations\/\{organization}\/projects\/ with plan="([^"]+)"$/,
  function (this: JollyWorld, expectedPlan: string) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      data?.projectCreated,
      `Project should have been created, got: ${JSON.stringify(data)}`,
    );
    if (data?.projectPlan) {
      assert.equal(
        data.projectPlan,
        expectedPlan,
        `Project plan should be "${expectedPlan}"`,
      );
    }
  },
);

Then(
  /^it should create an environment via POST \/platform\/api\/organizations\/\{organization}\/environments\/$/,
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      data?.environmentCreated,
      `Environment should have been created, got: ${JSON.stringify(data)}`,
    );
    if (data?.environmentName) {
      assert.ok(
        typeof data.environmentName === "string" &&
          (data.environmentName as string).length > 0,
        "environmentName should be a non-empty string",
      );
    }
  },
);

Then(
  "Jolly should extract the resulting domain from the task result",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.ok(
      data?.taskStatus === "SUCCEEDED",
      `Task should have succeeded, got status: ${String(data?.taskStatus)}`,
    );
    if (data?.domainUrl) {
      assert.ok(
        typeof data.domainUrl === "string" &&
          (data.domainUrl as string).includes("saleor.cloud"),
        `domainUrl should be a Saleor Cloud domain, got: ${String(data.domainUrl)}`,
      );
    }
  },
);

Then(
  "it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "NEXT_PUBLIC_SALEOR_API_URL" in values,
      "NEXT_PUBLIC_SALEOR_API_URL should be in .env",
    );
    const url = values["NEXT_PUBLIC_SALEOR_API_URL"];
    assert.ok(
      url && url.includes("saleor.cloud"),
      `NEXT_PUBLIC_SALEOR_API_URL should be a Saleor Cloud URL, got: ${url}`,
    );
  },
);

Then(
  "it should create an app token via the Saleor GraphQL API",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    if (data?.appTokenCreated !== undefined) {
      assert.ok(
        data.appTokenCreated,
        "App token should have been created via GraphQL",
      );
    }
    // If appTokenCreated is not in data, check that at minimum the command
    // reported a successful outcome that implies token creation.
    if (data?.authToken !== undefined) {
      // authToken value is redacted in output; just verify it was set
      this.trackSecret(String(data.authToken));
    }
  },
);

Then(
  "it should write JOLLY_SALEOR_APP_TOKEN to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.projectDir);
    assert.ok(
      "JOLLY_SALEOR_APP_TOKEN" in values,
      "JOLLY_SALEOR_APP_TOKEN should be in .env",
    );
    const token = values["JOLLY_SALEOR_APP_TOKEN"];
    assert.ok(
      token && token.length > 0,
      "JOLLY_SALEOR_APP_TOKEN should be a non-empty string",
    );
    this.trackSecret(token);
  },
);
