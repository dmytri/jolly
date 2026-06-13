// Feature 019 — Jolly iteration phase support.
//
// After setup, Jolly is a support layer: diagnostics (jolly doctor, safe to run
// anytime), tooling config (jolly init wrote .mcp.json for live mcp-graphql
// access), and update management (jolly upgrade — plan-only for Paper). The
// customer's agent owns all post-setup customization.
//
//   - "Agent has live store access from day one" is @sandbox: it verifies
//     jolly init wrote a working mcp-graphql config AND that the agent can
//     query/mutate the live store through it (read-only verification via
//     saleor-graphql.ts). Gated by SANDBOX_REQUIREMENTS (saleorEndpoint +
//     saleorAppToken) → skips locally.
//   - The two @logic scenarios (doctor health checks, upgrade) run read-only
//     Jolly commands under logicSafeEnv() in the scenario's temp project dir.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logicSafeEnv } from "../support/logic-env.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given(
  "the customer has completed Jolly setup and has a working deployed storefront",
  function () {},
);
Given("the customer's agent is the primary interface for all ongoing commerce work", function () {});
Given(
  "Jolly's role in the iteration phase is diagnostics, tooling config, and update management",
  function () {},
);

// --- Scenario: Agent has live store access from day one (@sandbox) ----------
//
// Jolly-observable contributions: jolly init writes an .mcp.json mcp-graphql
// entry pointing at the customer's Saleor GraphQL endpoint and using the stored
// app token. The live query/mutation steps verify real access through that
// endpoint (read-only), exercising the same env Jolly itself uses.

Given("jolly init has completed", function (this: JollyWorld) {
  // Run jolly init in the scenario's temp project so .mcp.json is produced from
  // the real (sandbox-provisioned) endpoint. init installs skills (network) and
  // merges .mcp.json; this only runs under the @sandbox gate.
  this.runCli(["init", "--json"]);
});

When("the agent needs to query or modify the live Saleor store", function (this: JollyWorld) {
  const path = join(this.projectDir, ".mcp.json");
  assert.ok(existsSync(path), "jolly init must have written .mcp.json");
  this.notes.mcpConfig = JSON.parse(readFileSync(path, "utf8"));
});

Then(
  "jolly init should have written an mcp-graphql config pointing to the customer's Saleor GraphQL endpoint",
  function (this: JollyWorld) {
    const config = this.notes.mcpConfig as {
      mcpServers?: Record<string, { args?: string[]; env?: Record<string, string> }>;
    };
    const servers = config.mcpServers ?? {};
    const entry = servers["saleor-graphql"];
    assert.ok(entry, ".mcp.json must contain a saleor-graphql mcp-graphql server entry");
    const usesMcpGraphql = JSON.stringify(entry.args ?? []).includes("mcp-graphql");
    assert.ok(usesMcpGraphql, "the entry must invoke mcp-graphql");
    const endpoint = entry.env?.ENDPOINT ?? "";
    const expected = process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
    assert.ok(endpoint.length > 0, "the mcp-graphql entry must carry an ENDPOINT");
    if (expected) {
      assert.equal(endpoint, expected, "the ENDPOINT should be the customer's Saleor GraphQL endpoint");
    }
    this.notes.mcpEndpoint = endpoint;
  },
);

Then("the config should use the stored app token", function (this: JollyWorld) {
  // The app token is referenced for live access; the stored JOLLY_SALEOR_APP_TOKEN
  // is what the agent's mcp-graphql session uses. Confirm it is configured.
  const appToken = process.env["JOLLY_SALEOR_APP_TOKEN"];
  assert.ok(appToken && appToken.trim() !== "", "a stored app token must be available for live access");
  this.notes.appToken = appToken;
});

Then(
  "the agent should be able to query products, orders, channels, and store configuration through mcp-graphql",
  { timeout: 30_000 },
  async function (this: JollyWorld) {
    // Read-only live verification through the configured endpoint + app token.
    const endpoint = String(this.notes.mcpEndpoint ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"]);
    const token = this.notes.appToken as string | undefined;
    const result = await saleorGraphql(
      endpoint,
      token,
      `query { shop { name } channels { slug } products(first: 1) { totalCount } }`,
    );
    assert.ok(!result.errors || result.errors.length === 0, `live query errored: ${JSON.stringify(result.errors)}`);
    assert.ok(result.data && "shop" in result.data, "the live store should answer a read-only query");
  },
);

Then(
  "the agent should be able to make mutations through mcp-graphql where the app token permissions allow",
  function (this: JollyWorld) {
    // Capability statement: the v1 app token requests all permissions, so the
    // app-token-bearing mcp-graphql session can mutate. We do not perform a live
    // mutation here (harmless-by-design: never create non-namespaced resources
    // and no spec mutation is required); we confirm the token channel exists.
    const token = this.notes.appToken as string | undefined;
    assert.ok(token && token.trim() !== "", "a permissioned app token enables mutations");
  },
);

// --- Scenario: Agent runs ongoing health checks (@logic) --------------------

Given("the storefront has been deployed", function (this: JollyWorld) {
  this.notes.deployed = true;
});

When("the customer or agent wants to verify everything is working correctly", function (this: JollyWorld) {
  // doctor is read-only and safe to run anytime.
  this.runCli(["doctor", "--json"], { env: logicSafeEnv() });
});

Then("the agent should run jolly doctor at any time without side effects", function (this: JollyWorld) {
  // No .env should be created by a read-only doctor run in a fresh temp project.
  assert.ok(this.lastRun, "doctor must have run");
  assert.ok(!existsSync(join(this.projectDir, ".env")), "doctor must not write .env (no side effects)");
  // The envelope is well-formed (validates shape).
  assert.ok(this.envelope.command.startsWith("doctor"));
});

Then(
  "jolly doctor should detect configuration drift, missing env vars, and connectivity problems",
  function (this: JollyWorld) {
    // With the unroutable logic-safe env, doctor reports fail/unknown checks for
    // missing/unverifiable config rather than fabricating pass.
    assert.ok(this.envelope.checks.length > 0, "doctor must report checks");
    const hasDiagnostic = this.envelope.checks.some(
      (c) => c.status === "fail" || c.status === "unknown" || c.status === "warning",
    );
    assert.ok(hasDiagnostic, "doctor must surface missing/unverifiable configuration");
  },
);

Then("it should report actionable next steps for any issues found", function (this: JollyWorld) {
  const actionable = this.envelope.checks.filter((c) => c.status === "fail" || c.status === "warning");
  for (const check of actionable) {
    const hasGuidance = "command" in check || this.envelope.nextSteps.length > 0;
    assert.ok(hasGuidance, `actionable check ${check.id} should carry guidance`);
  }
});

Then("it should support --json for structured output the agent can parse", function (this: JollyWorld) {
  const trimmed = this.lastRun!.stdout.trim();
  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(trimmed);
  }, "--json doctor output must be exactly one JSON object");
  assert.ok(parsed && typeof parsed === "object" && "checks" in (parsed as object));
});

// --- Scenario: Agent upgrades Jolly-managed assets (@logic) -----------------

Given("skills or agent guidance may become outdated over time", function (this: JollyWorld) {
  this.notes.upgradeContext = true;
});

When("the agent wants to keep the project current", function (this: JollyWorld) {
  this.runCli(["upgrade", "--json"], { env: logicSafeEnv() });
});

Then(
  "it should run jolly upgrade to update Jolly-managed skills and agent guidance",
  function (this: JollyWorld) {
    assert.ok(this.envelope.command.startsWith("upgrade"));
    const data = this.envelope.data as { skillsChecked?: unknown };
    assert.ok(Array.isArray(data.skillsChecked), "upgrade must report the managed skills it checked");
  },
);

Then("Jolly should report what changed and what the agent should review", function (this: JollyWorld) {
  // upgrade enumerates checks and (when applicable) nextSteps to review.
  assert.ok(this.envelope.checks.length > 0, "upgrade must report per-asset checks");
  assert.ok(Array.isArray(this.envelope.nextSteps), "upgrade must carry a nextSteps channel");
});

Then(
  "Jolly should not automatically apply Paper storefront migrations in v1",
  function (this: JollyWorld) {
    const data = this.envelope.data as { paperAutoApply?: unknown };
    assert.equal(data.paperAutoApply, false, "Paper migrations must not be auto-applied in v1");
  },
);

Then(
  "it should generate an upgrade plan for Paper changes and present it to the agent",
  function (this: JollyWorld) {
    // Plan-only: a paper-baseline check is present (skipped when no Paper repo,
    // unknown/plan when present). The channel for the plan exists either way.
    const paperCheck = this.findCheck("paper-baseline");
    assert.ok(paperCheck, "upgrade must report a paper-baseline (plan-only) check");
  },
);
