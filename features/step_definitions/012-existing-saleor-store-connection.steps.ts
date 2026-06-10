// Steps for features/012-existing-saleor-store-connection.feature.
//
// URL normalization is pure local logic (feature 023 names it a logic-tier
// example). Harness seam (QM-owned convention): the implementation exposes
//   src/lib/saleor-url.ts
//     export function normalizeSaleorUrl(input: string):
//       { endpoint: string | null; clarification?: string }
// where `endpoint` is the normalized GraphQL endpoint URL, or null with a
// human `clarification` question when the input cannot be normalized safely.
// The remaining scenarios touch a real Saleor endpoint and are @sandbox.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { repoRoot, requireEnvelope, type Envelope } from "../support/cli.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

type Normalize = (input: string) => { endpoint: string | null; clarification?: string };

async function loadNormalize(): Promise<Normalize> {
  const modulePath = join(repoRoot, "src", "lib", "saleor-url.ts");
  assert.ok(
    existsSync(modulePath),
    `URL normalization module not implemented yet: ${modulePath} (see harness seam contract in this step file)`,
  );
  const module = await import(modulePath);
  assert.equal(typeof module.normalizeSaleorUrl, "function", "src/lib/saleor-url.ts must export normalizeSaleorUrl");
  return module.normalizeSaleorUrl as Normalize;
}

const URL_FORMS = {
  dashboard: "https://store-test.eu.saleor.cloud/dashboard/",
  api: "https://store-test.eu.saleor.cloud/graphql/",
  root: "https://store-test.eu.saleor.cloud",
  graphqlNoSlash: "https://store-test.eu.saleor.cloud/graphql",
};
const EXPECTED_ENDPOINT = "https://store-test.eu.saleor.cloud/graphql/";

// --- Scenario: Agent accepts a pasted Saleor URL (@logic) --------------------

When(lit("the agent asks for the store connection"), async function (this: JollyWorld) {
  this.vars.set("normalize", await loadNormalize());
});

Then(
  lit("the customer may paste a Saleor Dashboard URL, storefront API URL, root Saleor Cloud URL, or GraphQL URL"),
  function (this: JollyWorld) {
    const normalize = this.vars.get("normalize") as Normalize;
    for (const [form, url] of Object.entries(URL_FORMS)) {
      const result = normalize(url);
      assert.ok(result.endpoint, `${form} URL ${url} was not accepted (clarification: ${result.clarification})`);
    }
  },
);

Then(
  lit("Jolly should normalize the input to a Saleor GraphQL endpoint where possible"),
  function (this: JollyWorld) {
    const normalize = this.vars.get("normalize") as Normalize;
    for (const [form, url] of Object.entries(URL_FORMS)) {
      assert.equal(normalize(url).endpoint, EXPECTED_ENDPOINT, `${form} URL ${url} normalized incorrectly`);
    }
  },
);

Then(
  lit("Jolly should ask a clarifying question only when the URL cannot be normalized safely"),
  function (this: JollyWorld) {
    const normalize = this.vars.get("normalize") as Normalize;
    for (const url of Object.values(URL_FORMS)) {
      assert.equal(normalize(url).clarification, undefined, `normalizable URL ${url} should not need clarification`);
    }
    const garbage = normalize("not a url at all");
    assert.equal(garbage.endpoint, null, "un-normalizable input must not produce an endpoint");
    assert.ok(garbage.clarification, "un-normalizable input must come with a clarifying question");
  },
);

// --- Scenario: Jolly validates the GraphQL endpoint (@sandbox) ---------------

Given(lit("Jolly has a candidate Saleor GraphQL endpoint"), function (this: JollyWorld) {
  const endpoint = process.env.JOLLY_TEST_SALEOR_API_URL;
  if (!endpoint) return "skipped" as const; // optional sandbox input absent
  this.vars.set("endpoint", endpoint);
});

When(lit("it validates the endpoint"), async function (this: JollyWorld) {
  const run = await this.jolly(["doctor", "saleor", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("validEnvelope", requireEnvelope(run));
});

Then(
  lit("it should perform an introspection-style GraphQL request or equivalent lightweight validation"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("validEnvelope") as Envelope;
    const connectivity = (envelope.checks as { id: string; status: string }[]).find((c) =>
      /saleor.*(connect|endpoint|graphql)/i.test(c.id),
    );
    assert.ok(connectivity, "doctor saleor must run an endpoint validation check");
    assert.equal(connectivity.status, "pass", "validation against the sandbox endpoint must pass");
  },
);

Then(
  lit("it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint"),
  async function (this: JollyWorld) {
    const bogus = `https://${this.namespace}.invalid/graphql/`;
    const run = await this.jolly(["doctor", "saleor", "--json"], {
      env: { ...sandboxRuntimeEnv(), JOLLY_SALEOR_URL: bogus },
    });
    const envelope = requireEnvelope(run);
    const failing = (envelope.checks as { status: string }[]).filter((c) => c.status === "fail");
    assert.ok(failing.length > 0, "unreachable endpoint must produce a failing check");
    assert.ok(
      (envelope.nextSteps as unknown[]).length > 0 || /remediation/i.test(JSON.stringify(envelope.errors)),
      "the failure must be actionable",
    );
  },
);

Then(
  lit("it should not proceed to storefront configuration until connectivity is verified"),
  async function (this: JollyWorld) {
    const bogus = `https://${this.namespace}.invalid/graphql/`;
    const run = await this.jolly(["create", "storefront", "--json", "--yes"], {
      env: { ...sandboxRuntimeEnv(), JOLLY_SALEOR_URL: bogus },
    });
    const envelope = requireEnvelope(run);
    assert.equal(envelope.status, "error", "storefront setup must not proceed with unverifiable connectivity");
    assert.ok(
      !existsSync(join(this.projectDir, "storefront", "package.json")),
      "storefront was configured despite failed connectivity verification",
    );
  },
);

// --- Scenario: Jolly infers Saleor Cloud organization and environment (@sandbox)

Given(lit("the customer has authenticated Jolly with Saleor Cloud"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_SALEOR_CLOUD_TOKEN) return "skipped" as const;
});

Given(lit("Jolly has a verified Saleor GraphQL endpoint"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_SALEOR_API_URL) return "skipped" as const;
});

When(lit("Jolly needs Saleor Cloud context"), async function (this: JollyWorld) {
  const run = await this.jolly(["doctor", "saleor", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("contextEnvelope", requireEnvelope(run));
});

Then(lit("it should query available organizations and environments where APIs allow"), function (this: JollyWorld) {
  const serialized = JSON.stringify(this.vars.get("contextEnvelope"));
  assert.ok(/organi[sz]ation|environment/i.test(serialized), "doctor saleor must surface Cloud org/environment context");
});

Then(
  lit("it should match the GraphQL endpoint host to a Saleor Cloud environment domain where possible"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("contextEnvelope") as Envelope;
    const host = new URL(process.env.JOLLY_TEST_SALEOR_API_URL as string).host;
    assert.ok(
      JSON.stringify(envelope.data).includes(host),
      `inferred environment context must reference the endpoint host ${host}`,
    );
  },
);

Then(
  lit("it should avoid asking the customer to manually select organization or environment when the match is unambiguous"),
  function (this: JollyWorld) {
    // Non-interactive --json run already completed without prompting; the
    // envelope must not demand a manual selection for the matched env.
    const envelope = this.vars.get("contextEnvelope") as Envelope;
    assert.ok(
      !/select (an? )?(organi[sz]ation|environment)/i.test(envelope.summary),
      "unambiguous match must not ask for manual selection",
    );
  },
);

Then(
  lit("it should ask the customer to choose only when multiple matches or no safe match exists"),
  function () {
    // The sandbox has a single unambiguous environment; the multi-match branch
    // cannot be produced here.
    return "skipped" as const;
  },
);

// --- Scenario: Jolly acquires the required app token (@sandbox) --------------

Given(lit("the endpoint has been verified"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_SALEOR_API_URL) return "skipped" as const;
});

When(lit("Jolly needs credentials for Configurator or privileged Saleor operations"), async function (this: JollyWorld) {
  // Without an app token: the requirement must surface. With one: detection.
  const env = { ...sandboxRuntimeEnv() };
  delete env.JOLLY_SALEOR_APP_TOKEN;
  const withoutToken = await this.jolly(["doctor", "saleor", "--json"], { env });
  this.vars.set("withoutToken", requireEnvelope(withoutToken));
  if (process.env.JOLLY_TEST_SALEOR_APP_TOKEN) {
    const withToken = await this.jolly(["doctor", "saleor", "--json"], { env: sandboxRuntimeEnv() });
    this.vars.set("withToken", requireEnvelope(withToken));
  }
});

Then(
  lit("an app token or equivalent credential should be required before continuing the full existing-store setup"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("withoutToken") as Envelope;
    const tokenCheck = (envelope.checks as { id: string; status: string }[]).find((c) => /token/i.test(c.id));
    assert.ok(tokenCheck, "doctor saleor must check for the app token");
    assert.notEqual(tokenCheck.status, "pass", "a missing app token must not pass the requirement check");
  },
);

Then(
  lit("Jolly should detect whether the token is already available in environment variables"),
  function (this: JollyWorld) {
    const withToken = this.vars.get("withToken") as Envelope | undefined;
    if (!withToken) return "skipped" as const; // JOLLY_TEST_SALEOR_APP_TOKEN absent
    const tokenCheck = (withToken.checks as { id: string; status: string }[]).find((c) => /token/i.test(c.id));
    assert.ok(tokenCheck && tokenCheck.status === "pass", "an env-provided app token must be detected");
  },
);

Then(
  lit("if missing, Jolly should acquire or create the token automatically where Saleor APIs allow"),
  function () {
    // Automatic token creation mutates the shared sandbox store's apps;
    // exercised only in the dedicated E2E flow, not in diagnostics.
    return "skipped" as const;
  },
);

Then(
  lit("Jolly may follow the deprecated CLI's example flow of authenticating to Saleor Cloud, resolving the instance, selecting or creating a Saleor local app, and creating an app token via the Saleor GraphQL API"),
  function () {
    // Permission, not an obligation — nothing to assert.
  },
);

Then(
  lit("if automation is unavailable, it should guide the customer through the current Saleor Dashboard token creation path"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("withoutToken") as Envelope;
    assert.ok(
      /dashboard/i.test(JSON.stringify(envelope.nextSteps) + JSON.stringify(envelope.checks)),
      "missing-token guidance must point at the Saleor Dashboard token path",
    );
  },
);

Then(lit("it should avoid storing the token outside environment variables"), function (this: JollyWorld) {
  const token = process.env.JOLLY_TEST_SALEOR_APP_TOKEN;
  if (!token) return "skipped" as const;
  const offenders = readdirSync(this.projectDir)
    .filter((name) => name !== ".env" && name !== "node_modules")
    .filter((name) => {
      try {
        return readFileSync(join(this.projectDir, name), "utf8").includes(token);
      } catch {
        return false;
      }
    });
  assert.deepEqual(offenders, [], `token stored outside .env: ${offenders.join(", ")}`);
});

Then(lit("it should use the token to run Configurator introspection"), function (this: JollyWorld) {
  const withToken = this.vars.get("withToken") as Envelope | undefined;
  if (!withToken) return "skipped" as const;
  assert.ok(/introspect/i.test(JSON.stringify(withToken)), "with a token available, introspection must run or be reported");
});
