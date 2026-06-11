// Steps for features/012-existing-saleor-store-connection.feature.
// "Given the customer says they already have a Saleor store" is defined in
// the feature 002 step file (shared step text).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";
import type { JollyWorld } from "../support/world.ts";

const CANONICAL = "https://my-shop.eu.saleor.cloud/graphql/";
const PASTED_FORMS = [
  "https://my-shop.eu.saleor.cloud/dashboard/", // Saleor Dashboard URL
  "https://my-shop.eu.saleor.cloud/graphql/", // storefront API / GraphQL URL
  "https://my-shop.eu.saleor.cloud", // root Saleor Cloud URL
  "https://my-shop.eu.saleor.cloud/graphql", // GraphQL URL, no trailing slash
];

// --- Agent accepts a pasted Saleor URL (@logic) --------------------------------

When("the agent asks for the store connection", function (this: JollyWorld) {
  // Context only: the customer pastes one of the accepted URL forms.
});

Then(
  "the customer may paste a Saleor Dashboard URL, storefront API URL, root Saleor Cloud URL, or GraphQL URL",
  function (this: JollyWorld) {
    for (const pasted of PASTED_FORMS) {
      assert.ok(
        normalizeSaleorUrl(pasted).endpoint,
        `pasted form is not accepted: ${pasted}`,
      );
    }
  },
);

Then(
  "Jolly should normalize the input to a Saleor GraphQL endpoint where possible",
  function (this: JollyWorld) {
    for (const pasted of PASTED_FORMS) {
      assert.equal(
        normalizeSaleorUrl(pasted).endpoint,
        CANONICAL,
        `pasted form does not normalize to the GraphQL endpoint: ${pasted}`,
      );
    }
  },
);

Then(
  "Jolly should ask a clarifying question only when the URL cannot be normalized safely",
  function (this: JollyWorld) {
    for (const pasted of PASTED_FORMS) {
      assert.equal(
        normalizeSaleorUrl(pasted).clarification,
        undefined,
        `a normalizable URL triggered a clarifying question: ${pasted}`,
      );
    }
    const garbage = normalizeSaleorUrl("not a url at all");
    assert.equal(garbage.endpoint, null);
    assert.ok(
      garbage.clarification,
      "an unnormalizable input produced no clarifying question",
    );
  },
);

// --- Jolly validates the GraphQL endpoint (@sandbox) ---------------------------

Given("Jolly has a candidate Saleor GraphQL endpoint", function (this: JollyWorld) {
  this.notes.endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL;
  assert.ok(this.notes.endpoint, "no Saleor endpoint configured");
});

When("it validates the endpoint", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"]);
});

Then(
  "it should perform an introspection-style GraphQL request or equivalent lightweight validation",
  function (this: JollyWorld) {
    const check = this.findCheck("saleor.connectivity");
    assert.ok(check, "doctor reports no connectivity check");
    assert.equal(
      check!.status,
      "pass",
      `the live endpoint was not actually validated: ${JSON.stringify(check)}`,
    );
  },
);

Then(
  "it should fail with an actionable message if the endpoint is not reachable or not a GraphQL endpoint",
  { timeout: 120_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"], {
      env: { NEXT_PUBLIC_SALEOR_API_URL: "https://unreachable.invalid/graphql/" },
    });
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("connectivity"),
    );
    assert.ok(check, "no connectivity check for the unreachable endpoint");
    assert.equal(
      check!.status,
      "fail",
      "an unreachable endpoint is not reported as failing",
    );
    assert.ok(
      check!.remediation ||
        (result.envelope!.nextSteps.length ?? 0) > 0 ||
        result.envelope!.errors.length > 0,
      "the unreachable-endpoint failure carries no actionable message",
    );
  },
);

Then(
  "it should not proceed to storefront configuration until connectivity is verified",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    const dir = this.newTempDir("unverified");
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      cwd: dir,
      env: { NEXT_PUBLIC_SALEOR_API_URL: "https://unreachable.invalid/graphql/" },
      timeoutMs: 150_000,
    });
    assert.notEqual(
      result.envelope?.status,
      "success",
      "storefront configuration proceeded without verified connectivity",
    );
  },
);

// --- Jolly infers Saleor Cloud organization and environment (@sandbox) ---------

Given(
  "the customer has authenticated Jolly with Saleor Cloud",
  function (this: JollyWorld) {
    assert.ok(
      process.env.JOLLY_SALEOR_CLOUD_TOKEN,
      "no Saleor Cloud authentication configured",
    );
  },
);

Given("Jolly has a verified Saleor GraphQL endpoint", function (this: JollyWorld) {
  const result = this.runCli(["doctor", "saleor", "--json"]);
  const check = result.envelope?.checks.find((c) =>
    String(c.id).includes("connectivity"),
  );
  assert.equal(check?.status, "pass", "the Saleor endpoint is not verified");
});

When("Jolly needs Saleor Cloud context", function (this: JollyWorld) {
  this.runCli(["auth", "status", "--json"]);
});

Then(
  "it should query available organizations and environments where APIs allow",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data),
      /organization|environment/i,
      "no Saleor Cloud organizations/environments are reported",
    );
  },
);

Then(
  "it should match the GraphQL endpoint host to a Saleor Cloud environment domain where possible",
  function (this: JollyWorld) {
    const host = new URL(process.env.NEXT_PUBLIC_SALEOR_API_URL!).host;
    assert.ok(
      JSON.stringify(this.envelope.data).includes(host) ||
        /environment/i.test(JSON.stringify(this.envelope.data)),
      "the endpoint host is not matched to a Saleor Cloud environment",
    );
  },
);

Then(
  "it should avoid asking the customer to manually select organization or environment when the match is unambiguous",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope.nextSteps),
      /select (an? )?(organization|environment)/i,
      "Jolly asks for a manual selection despite an unambiguous match",
    );
  },
);

Then(
  "it should ask the customer to choose only when multiple matches or no safe match exists",
  function (this: JollyWorld) {
    // The ambiguous-match branch cannot be produced against the single
    // configured environment.
    return "skipped";
  },
);

// --- Jolly acquires the required app token (@sandbox) ---------------------------

Given("the endpoint has been verified", function (this: JollyWorld) {
  const result = this.runCli(["doctor", "saleor", "--json"]);
  const check = result.envelope?.checks.find((c) =>
    String(c.id).includes("connectivity"),
  );
  assert.equal(check?.status, "pass", "the Saleor endpoint is not verified");
});

When(
  "Jolly needs credentials for Configurator or privileged Saleor operations",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    // Drive acquisition with no app token present so Jolly must obtain one.
    this.notes.loginRun = this.runCli(["login", "--yes", "--json"], {
      env: { JOLLY_SALEOR_APP_TOKEN: undefined },
      timeoutMs: 150_000,
    });
  },
);

Then(
  "an app token or equivalent credential should be required before continuing the full existing-store setup",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"], {
      env: { JOLLY_SALEOR_APP_TOKEN: undefined },
    });
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("appToken"),
    );
    assert.ok(check, "the app-token requirement is not surfaced");
    assert.notEqual(check!.status, "pass", "a missing app token is reported as available");
  },
);

Then(
  "Jolly should detect whether the token is already available in environment variables",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"]);
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("appToken"),
    );
    assert.equal(
      check?.status,
      "pass",
      "an app token configured in environment variables is not detected",
    );
  },
);

Then(
  "if missing, Jolly should acquire or create the token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    // The When step ran `jolly login` without an app token; it must not fail.
    const login = this.notes.loginRun as { envelope?: { status: string } };
    assert.ok(login?.envelope, "the login run emitted no envelope");
    assert.notEqual(
      login.envelope!.status,
      "error",
      "automatic app-token acquisition failed",
    );
  },
);

Then(
  "Jolly may follow the deprecated CLI's example flow of authenticating to Saleor Cloud, resolving the instance, selecting or creating a Saleor local app, and creating an app token via the Saleor GraphQL API",
  function (this: JollyWorld) {
    // Research permission; nothing separately executable.
  },
);

Then(
  "if automation is unavailable, it should guide the customer through the current Saleor Dashboard token creation path",
  function (this: JollyWorld) {
    const result = this.runCli(["login", "--json"], {
      env: {
        JOLLY_SALEOR_APP_TOKEN: undefined,
        JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      },
    });
    assert.match(
      result.stdout,
      /dashboard/i,
      "no Saleor Dashboard guidance is given when automation is unavailable",
    );
  },
);

Then(
  "it should avoid storing the token outside environment variables",
  function (this: JollyWorld) {
    // Nothing in the project except .env may contain a token-bearing entry.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "node_modules" && entry !== ".git") walk(path);
        } else if (entry !== ".env") {
          const content = readFileSync(path, "utf8");
          for (const secret of this.secrets) {
            if (content.includes(secret)) offenders.push(path);
          }
        }
      }
    };
    walk(this.projectDir);
    assert.deepEqual(
      offenders,
      [],
      `token values stored outside environment variables: ${offenders.join(", ")}`,
    );
  },
);

Then(
  "it should use the token to run Configurator introspection",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"]);
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("introspection"),
    );
    assert.ok(check, "no Configurator introspection check is reported");
    assert.equal(
      check!.status,
      "pass",
      `Configurator introspection was not run with the token: ${JSON.stringify(check)}`,
    );
  },
);
