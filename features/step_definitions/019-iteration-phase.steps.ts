// Steps for features/019-iteration-phase.feature.
// Scenario 1 (@sandbox) verifies the mcp-graphql config against a live store;
// scenarios 2-3 (@logic) verify doctor's side-effect-free diagnostics and the
// upgrade reporting/plan behavior locally.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type Envelope, type RunResult } from "../support/cli.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import { writePaperFixture } from "./014-jolly-doctor-diagnostics.steps.ts";
import type { JollyWorld } from "../support/world.ts";

const LONG = { timeout: 600_000 };

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function snapshot(dir: string): string {
  return filesUnder(dir)
    .map((path) => `${path}:${readFileSync(path).length}`)
    .sort()
    .join("\n");
}

// --- Background premises ------------------------------------------------------

Given(lit("the customer has completed Jolly setup and has a working deployed storefront"), function () {
  // Premise; concrete preconditions are produced per scenario.
});

Given(lit("the customer's agent is the primary interface for all ongoing commerce work"), function () {});

Given(lit("Jolly's role in the iteration phase is diagnostics, tooling config, and update management"), function () {});

// --- Scenario: Agent has live store access from day one (@sandbox) -----------

Given(lit("jolly init has completed"), LONG, async function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL || !process.env.JOLLY_SALEOR_APP_TOKEN) {
    return "skipped" as const;
  }
  // The endpoint/token are available to init through the runtime env/.env.
  writeFileSync(
    join(this.projectDir, ".env"),
    [
      `NEXT_PUBLIC_SALEOR_API_URL=${process.env.JOLLY_SALEOR_URL}`,
      `SALEOR_APP_TOKEN=${process.env.JOLLY_SALEOR_APP_TOKEN}`,
      "",
    ].join("\n"),
  );
  const run = await this.jolly(["init", "--json", "--yes"], { env: sandboxRuntimeEnv(), timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(run).status, "error", "jolly init must succeed");
});

When(lit("the agent needs to query or modify the live Saleor store"), function (this: JollyWorld) {
  const configs = filesUnder(this.projectDir).filter((path) => /mcp/i.test(path) || /mcp[-_]?graphql/i.test(safeRead(path)));
  assert.ok(configs.length > 0, "init wrote no mcp-graphql configuration");
  this.vars.set("mcpConfigs", configs);
});

Then(
  lit("jolly init should have written an mcp-graphql config pointing to the customer's Saleor GraphQL endpoint"),
  function (this: JollyWorld) {
    const endpoint = process.env.JOLLY_SALEOR_URL as string;
    const configs = this.vars.get("mcpConfigs") as string[];
    assert.ok(
      configs.some((path) => safeRead(path).includes(endpoint)),
      `no mcp-graphql config points at ${endpoint}`,
    );
  },
);

Then(lit("the config should use the stored app token"), function (this: JollyWorld) {
  const configs = this.vars.get("mcpConfigs") as string[];
  const combined = configs.map(safeRead).join("\n");
  // Secrets are referenced by name (env var), never inlined.
  assert.ok(/SALEOR_APP_TOKEN|JOLLY_SALEOR_APP_TOKEN/.test(combined), "config must reference the stored app token");
  const token = process.env.JOLLY_SALEOR_APP_TOKEN as string;
  assert.ok(!combined.includes(token), "config must reference the token by name, not embed its value");
});

Then(
  lit("the agent should be able to query products, orders, channels, and store configuration through mcp-graphql"),
  async function (this: JollyWorld) {
    // Equivalent live-access check without an MCP host: the configured
    // endpoint+token must answer a channels query.
    const endpoint = process.env.JOLLY_SALEOR_URL as string;
    const token = process.env.JOLLY_SALEOR_APP_TOKEN as string;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: "{ channels { id slug } }" }),
    });
    assert.ok(response.ok, `live store query failed: HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { channels?: unknown[] }; errors?: unknown[] };
    assert.ok(body.data?.channels, `live store query returned no channels: ${JSON.stringify(body.errors)}`);
  },
);

Then(
  lit("the agent should be able to make mutations through mcp-graphql where the app token permissions allow"),
  function () {
    // Mutating the shared sandbox store outside namespaced flows is unsafe;
    // permission-gated mutation access is covered by the recipe deployment
    // scenarios (feature 004), which write through the same token.
    return "skipped" as const;
  },
);

// --- Scenario: Agent runs ongoing health checks (@logic) ----------------------

Given(lit("the storefront has been deployed"), function (this: JollyWorld) {
  // Local stand-in: a Paper-shaped storefront exists; doctor must work at any
  // time regardless of deployment state.
  writePaperFixture(this.projectDir);
});

When(lit("the customer or agent wants to verify everything is working correctly"), function () {
  // Premise.
});

Then(lit("the agent should run jolly doctor at any time without side effects"), async function (this: JollyWorld) {
  const before = snapshot(this.projectDir);
  const run = await this.jolly(["doctor", "--json"]);
  requireEnvelope(run);
  const after = snapshot(this.projectDir);
  assert.equal(after, before, "jolly doctor modified project files — it must be side-effect free");
});

Then(
  lit("jolly doctor should detect configuration drift, missing env vars, and connectivity problems"),
  async function (this: JollyWorld) {
    // The fixture has no env configured: the missing-env-var condition is real.
    const run = await this.jolly(["doctor", "--json"]);
    const envelope = requireEnvelope(run);
    const checks = envelope.checks as { id: string; status: string }[];
    const envCheck = checks.find((c) => /env/i.test(c.id));
    assert.ok(envCheck, "doctor must check environment variables");
    assert.notEqual(envCheck.status, "pass", "missing Paper env vars must be detected, not passed");
    assert.ok(
      checks.some((c) => /saleor|connect/i.test(c.id)),
      "doctor must include connectivity checks",
    );
    this.vars.set("doctorRun", run);
  },
);

Then(lit("it should report actionable next steps for any issues found"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("doctorRun") as RunResult);
  const hasIssues = (envelope.checks as { status: string }[]).some((c) => c.status === "fail" || c.status === "warning");
  assert.ok(hasIssues, "expected the fixture to produce at least one issue");
  assert.ok((envelope.nextSteps as unknown[]).length > 0, "issues found must come with actionable nextSteps");
});

Then(lit("it should support --json for structured output the agent can parse"), function (this: JollyWorld) {
  const run = this.vars.get("doctorRun") as RunResult;
  assert.doesNotThrow(() => JSON.parse(run.stdout), "doctor --json stdout must be parseable JSON");
});

// --- Scenario: Agent upgrades Jolly-managed assets (@logic) -------------------

Given(lit("skills or agent guidance may become outdated over time"), LONG, async function (this: JollyWorld) {
  writePaperFixture(this.projectDir);
  const init = await this.jolly(["init", "--json", "--yes"], { timeoutMs: 540_000 });
  assert.notEqual(requireEnvelope(init).status, "error", "init must succeed before upgrade");
  this.vars.set("storefrontSnapshot", snapshot(join(this.projectDir, "storefront")));
});

When(lit("the agent wants to keep the project current"), LONG, async function (this: JollyWorld) {
  await this.jolly(["upgrade", "--json", "--yes"], { timeoutMs: 540_000 });
});

Then(
  lit("it should run jolly upgrade to update Jolly-managed skills and agent guidance"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.lastRun!);
    assert.notEqual(envelope.status, "error", `upgrade failed: ${envelope.summary}`);
    assert.ok(/skill|guidance/i.test(JSON.stringify(envelope.data)), "upgrade must cover skills and guidance");
  },
);

Then(lit("Jolly should report what changed and what the agent should review"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(envelope.summary.trim().length > 0, "upgrade must summarize what changed");
  assert.ok(Array.isArray(envelope.nextSteps), "upgrade must report what to review via nextSteps");
});

Then(lit("Jolly should not automatically apply Paper storefront migrations in v1"), function (this: JollyWorld) {
  assert.equal(
    snapshot(join(this.projectDir, "storefront")),
    this.vars.get("storefrontSnapshot"),
    "upgrade modified the storefront — Paper migrations must not be auto-applied",
  );
});

Then(
  lit("it should generate an upgrade plan for Paper changes and present it to the agent"),
  function (this: JollyWorld) {
    assert.ok(
      /plan/i.test(JSON.stringify(requireEnvelope(this.lastRun!))),
      "upgrade must present a Paper upgrade plan",
    );
  },
);

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
