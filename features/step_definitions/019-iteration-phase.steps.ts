// Steps for features/019-iteration-phase.feature.
// The live-access scenario performs read-only queries of pre-existing
// resources (explicitly allowed here: this is the spec that requires
// verifying live access) and one namespaced, unpublished creation with
// registered teardown for the mutation check.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

function findMcpConfig(projectDir: string): { path: string; content: string } | undefined {
  const candidates = [
    ".mcp.json",
    "mcp.json",
    join(".cursor", "mcp.json"),
    join(".vscode", "mcp.json"),
    join(".gemini", "settings.json"),
  ];
  for (const relative of candidates) {
    const path = join(projectDir, relative);
    if (existsSync(path)) return { path, content: readFileSync(path, "utf8") };
  }
  // Fallback: any json file mentioning mcp-graphql at the project top level.
  for (const entry of readdirSync(projectDir)) {
    const path = join(projectDir, entry);
    if (statSync(path).isFile() && entry.endsWith(".json")) {
      const content = readFileSync(path, "utf8");
      if (/mcp[-_]?graphql/i.test(content)) return { path, content };
    }
  }
  return undefined;
}

// --- Background ----------------------------------------------------------------

Given(
  "the customer has completed Jolly setup and has a working deployed storefront",
  function (this: JollyWorld) {
    // Context only.
  },
);

Given(
  "the customer's agent is the primary interface for all ongoing commerce work",
  function (this: JollyWorld) {
    // Pinned iteration-phase principle; context only.
  },
);

Given(
  "Jolly's role in the iteration phase is diagnostics, tooling config, and update management",
  function (this: JollyWorld) {
    // Pinned iteration-phase principle; context only.
  },
);

// --- Agent has live store access from day one (@sandbox) --------------------------

Given("jolly init has completed", { timeout: 180_000 }, function (this: JollyWorld) {
  const result = this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
  assert.notEqual(result.envelope?.status, "error", result.stdout);
});

When(
  "the agent needs to query or modify the live Saleor store",
  function (this: JollyWorld) {
    // Context only; the queries below verify the access.
  },
);

Then(
  "jolly init should have written an mcp-graphql config pointing to the customer's Saleor GraphQL endpoint",
  function (this: JollyWorld) {
    const config = findMcpConfig(this.projectDir);
    assert.ok(config, "jolly init wrote no mcp-graphql config");
    assert.match(config!.content, /mcp[-_]?graphql/i, "the config does not use mcp-graphql");
    const endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL!;
    assert.ok(
      config!.content.includes(endpoint) ||
        config!.content.includes("NEXT_PUBLIC_SALEOR_API_URL"),
      "the mcp-graphql config does not point at the customer's Saleor GraphQL endpoint",
    );
    this.notes.mcpConfig = config;
  },
);

Then("the config should use the stored app token", function (this: JollyWorld) {
  const config = this.notes.mcpConfig as { path: string; content: string };
  assert.match(
    config.content,
    /JOLLY_SALEOR_APP_TOKEN|SALEOR_APP_TOKEN/,
    "the mcp-graphql config does not reference the stored app token",
  );
  // Secrets are referenced by name, never embedded.
  this.assertNoSecretsIn(config.content, `mcp config ${config.path}`);
});

Then(
  "the agent should be able to query products, orders, channels, and store configuration through mcp-graphql",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    const endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL!;
    const token = process.env.JOLLY_SALEOR_APP_TOKEN!;
    // Read-only queries of pre-existing resources, explicitly required here
    // to verify live access with the customer's configured credentials.
    const result = await saleorGraphql(
      endpoint,
      token,
      `query {
        shop { name }
        channels { slug }
        products(first: 1) { edges { node { id } } }
        orders(first: 1) { edges { node { id } } }
      }`,
    );
    assert.ok(result.data?.shop, "store configuration (shop) is not queryable");
    assert.ok(result.data?.channels, "channels are not queryable");
    assert.ok(result.data?.products, "products are not queryable");
    if (!result.data?.orders) {
      // Orders need MANAGE_ORDERS; surface rather than fail if the token
      // lacks it — v1 requests all available permissions, so report it.
      assert.fail(
        `orders are not queryable with the configured app token: ${JSON.stringify(result.errors)}`,
      );
    }
  },
);

Then(
  "the agent should be able to make mutations through mcp-graphql where the app token permissions allow",
  { timeout: 120_000 },
  async function (this: JollyWorld) {
    const endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL!;
    const token = process.env.JOLLY_SALEOR_APP_TOKEN!;
    // Harmless mutation: create one namespaced, unpublished product type? A
    // category is the lightest namespaced object; create it and tear it down.
    const name = `${this.namespace}-mutation-check`;
    const created = await saleorGraphql(
      endpoint,
      token,
      `mutation($name: String!) {
        categoryCreate(input: { name: $name }) {
          category { id }
          errors { field message }
        }
      }`,
      { name },
    );
    const payload = created.data?.categoryCreate as
      | { category?: { id: string }; errors?: Array<{ message: string }> }
      | undefined;
    assert.ok(
      payload?.category?.id,
      `mutation through the configured app token failed: ${JSON.stringify(
        payload?.errors ?? created.errors,
      )}`,
    );
    const id = payload!.category!.id;
    this.cleanup.register(`Saleor category ${name} (${id})`, async () => {
      const deleted = await saleorGraphql(
        endpoint,
        token,
        `mutation($id: ID!) { categoryDelete(id: $id) { errors { message } } }`,
        { id },
      );
      const errors = (deleted.data?.categoryDelete as { errors?: unknown[] })?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        throw new Error(JSON.stringify(errors));
      }
    });
  },
);

// --- Agent runs ongoing health checks (@logic) -------------------------------------

Given("the storefront has been deployed", function (this: JollyWorld) {
  // Context only: doctor must be safe regardless of deployment state.
});

When(
  "the customer or agent wants to verify everything is working correctly",
  function (this: JollyWorld) {
    this.notes.before = snapshotDir(this.projectDir);
    this.runCli(["doctor", "--json"]);
  },
);

Then(
  "the agent should run jolly doctor at any time without side effects",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"]);
    assert.equal(
      snapshotDir(this.projectDir),
      this.notes.before,
      "jolly doctor changed project files",
    );
  },
);

Then(
  "jolly doctor should detect configuration drift, missing env vars, and connectivity problems",
  function (this: JollyWorld) {
    const ids = this.envelope.checks.map((c) => String(c.id)).join(" ");
    assert.match(ids, /env/i, "doctor has no env-var checks");
    assert.match(ids, /connectivity|saleor/i, "doctor has no connectivity checks");
  },
);

Then(
  "it should report actionable next steps for any issues found",
  function (this: JollyWorld) {
    const issues = this.envelope.checks.filter(
      (c) => c.status === "fail" || c.status === "warning",
    );
    for (const check of issues) {
      assert.ok(
        check.remediation || this.envelope.nextSteps.length > 0,
        `issue ${check.id} has no actionable next step`,
      );
    }
  },
);

Then(
  "it should support --json for structured output the agent can parse",
  function (this: JollyWorld) {
    assert.doesNotThrow(() => JSON.parse(this.lastRun!.stdout.trim()));
  },
);

// --- Agent upgrades Jolly-managed assets (@logic) ------------------------------------

Given(
  "skills or agent guidance may become outdated over time",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["init", "--yes", "--json"], { timeoutMs: 150_000 });
    assert.notEqual(result.envelope?.status, "error", result.stdout);
    // A minimal Paper storefront so the migration-handling steps are exercised.
    const dir = join(this.projectDir, "storefront");
    mkdirSync(join(dir, "migrations"), { recursive: true });
    writeFileSync(
      join(dir, "paper-version.json"),
      JSON.stringify({ version: "0.0.1-test" }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "paper-storefront-fixture", private: true }),
    );
    writeFileSync(
      join(dir, "migrations", "0001-example.md"),
      "# Example Paper migration guidance\n",
    );
  },
);

When(
  "the agent wants to keep the project current",
  { timeout: 180_000 },
  function (this: JollyWorld) {
    this.notes.storefrontBefore = existsSync(join(this.projectDir, "storefront"))
      ? snapshotDir(join(this.projectDir, "storefront"))
      : undefined;
    this.runCli(["upgrade", "--yes", "--json"], { timeoutMs: 150_000 });
  },
);

Then(
  "it should run jolly upgrade to update Jolly-managed skills and agent guidance",
  function (this: JollyWorld) {
    assert.match(this.envelope.command, /upgrade/i);
    assert.match(JSON.stringify(this.envelope), /skill|guidance/i);
  },
);

Then(
  "Jolly should report what changed and what the agent should review",
  function (this: JollyWorld) {
    assert.ok(this.envelope.summary.trim().length > 0, "upgrade has no summary");
    assert.match(
      JSON.stringify(this.envelope),
      /updated|unchanged|review|current|up.to.date/i,
      "upgrade does not report what changed or needs review",
    );
  },
);

Then(
  "Jolly should not automatically apply Paper storefront migrations in v1",
  function (this: JollyWorld) {
    const before = this.notes.storefrontBefore as string | undefined;
    if (before === undefined) return "skipped"; // no storefront in this run
    assert.equal(
      snapshotDir(join(this.projectDir, "storefront")),
      before,
      "upgrade applied Paper migrations automatically",
    );
  },
);

Then(
  "it should generate an upgrade plan for Paper changes and present it to the agent",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /plan|paper/i,
      "no Paper upgrade plan is presented",
    );
  },
);

function snapshotDir(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".git") walk(path);
      } else {
        parts.push(`${path}:${statSync(path).size}:${readFileSync(path, "utf8")}`);
      }
    }
  };
  walk(dir);
  return parts.join("\n---\n");
}
