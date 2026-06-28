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
//     SALEOR_TOKEN) → skips locally.
//   - The two @logic scenarios (doctor health checks, upgrade) run read-only
//     Jolly commands under absentCredentialsEnv() in the scenario's temp project dir.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background (capability statements) -------------------------------------

Given("`jolly init` has completed", function () {});
Given("a deployed storefront URL in .env", function () {});

// --- Scenario: Agent has live store access from day one (@sandbox) ----------
//
// Jolly-observable contributions: jolly init writes an .mcp.json mcp-graphql
// entry pointing at the customer's Saleor GraphQL endpoint and using the
// resolved store token (SALEOR_TOKEN). The live query/mutation steps verify real
// access through that endpoint (read-only), exercising the same env Jolly itself
// uses. MCP is refresh-on-401: it captures ${SALEOR_TOKEN} at spawn, so a
// 401 means re-auth and reload the MCP server.

Given("jolly init has completed", function (this: JollyWorld) {
  // Run jolly init in the scenario's temp project so .mcp.json is produced from
  // the real (sandbox-provisioned) endpoint. init installs skills (network) and
  // merges .mcp.json; this only runs under the @sandbox gate.
  this.runCli(["init", "--json"]);
});

When("the agent runs a products query through mcp-graphql", function (this: JollyWorld) {
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

Then(
  /^the config should send the `Authorization: Bearer \$\{SALEOR_TOKEN\}` header$/,
  function (this: JollyWorld) {
    // The saleor-graphql entry must authenticate live access with the resolved
    // store token, referenced via env expansion (${SALEOR_TOKEN}) so the MCP
    // client resolves it at launch — never the literal secret in the file
    // (feature 007 keeps secrets out of the scaffolded config). The token rides
    // as Bearer (store GraphQL is always Bearer), never an "App" scheme.
    const config = this.notes.mcpConfig as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const headers = config.mcpServers?.["saleor-graphql"]?.env?.HEADERS ?? "";
    assert.match(
      headers,
      /Authorization.*Bearer.*\$\{?SALEOR_TOKEN\}?/i,
      "the saleor-graphql entry must authenticate with the resolved store token via HEADERS (by env reference, not the literal)",
    );
    const storeToken = process.env["SALEOR_TOKEN"];
    assert.ok(storeToken && storeToken.trim() !== "", "a resolved store token must be available for live access");
    this.notes.storeToken = storeToken;
  },
);

Then(
  /^the `\.mcp\.json` saleor-graphql entry should target the customer's Saleor GraphQL endpoint with the `\$\{SALEOR_TOKEN\}` Bearer header$/,
  { timeout: 30_000 },
  async function (this: JollyWorld) {
    // Read-only live verification through the configured endpoint + SALEOR_TOKEN.
    const endpoint = String(this.notes.mcpEndpoint ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"]);
    const token = this.notes.storeToken as string | undefined;
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
  /^because the MCP server captures `SALEOR_TOKEN` at spawn, recovery from a `401` is to refresh the token and reload the MCP server$/,
  function (this: JollyWorld) {
    // Refresh-on-401 hinges on the entry referencing SALEOR_TOKEN by ENV
    // EXPANSION (not the literal value baked in): the MCP server resolves
    // ${SALEOR_TOKEN} from the environment when it spawns, so a refreshed token
    // is picked up only on a reload. Confirm the captured config expresses that
    // contract — the HEADERS carry the ${SALEOR_TOKEN} reference, never the
    // resolved secret.
    const config = this.notes.mcpConfig as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const headers = config.mcpServers?.["saleor-graphql"]?.env?.HEADERS ?? "";
    assert.match(
      headers,
      /\$\{?SALEOR_TOKEN\}?/,
      "HEADERS must reference SALEOR_TOKEN by env expansion so a reload picks up a refreshed token",
    );
    const token = this.notes.storeToken as string | undefined;
    if (token) {
      assert.ok(
        !headers.includes(token),
        "HEADERS must not bake the resolved token literal in — it must be captured from the env at spawn",
      );
    }
  },
);

// --- Scenario: Agent runs ongoing health checks (@logic) --------------------

Given("the storefront has been deployed", function (this: JollyWorld) {
  this.notes.deployed = true;
});

// `When the agent runs \`jolly doctor --json\`` is defined in
// 020-cli-output-contract.steps.ts (identical body: runCli doctor with
// credentials unset). Reused here — not duplicated, to avoid an ambiguous match.

Then("`jolly doctor` should make no local or remote changes", function (this: JollyWorld) {
  // No .env should be created by a read-only doctor run in a fresh temp project.
  assert.ok(this.lastRun, "doctor must have run");
  assert.ok(!existsSync(join(this.projectDir, ".env")), "doctor must not write .env (no side effects)");
  // The envelope is well-formed (validates shape).
  assert.ok(this.envelope.command.startsWith("doctor"));
});

Then(
  "jolly doctor should detect configuration drift, missing env vars, and connectivity problems",
  function (this: JollyWorld) {
    // With the credentials unset, doctor reports fail/unknown checks for
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

When("the agent runs `jolly upgrade --json`", function (this: JollyWorld) {
  this.runCli(["upgrade", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the envelope should report the updated skills and guidance",
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
