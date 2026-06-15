// Feature 008 — Jolly create subcommands.
//
// These @logic scenarios pin the thin-CLI create surface (decision
// 2026-06-13): `jolly create --help` lists exactly store/app-token/stripe and
// NOT the retired tool-wrapping subcommands (deployment/deploy/recipe/
// storefront); and a create subcommand with unmet preconditions errors with a
// stable code and never fabricates a created/configured/stored resource or a
// `pass` check.
//
// Safety: every command runs under logicSafeEnv() — dummy credentials for all
// groups + an unroutable `.invalid` Cloud API base — so no side-effecting path
// can reach a real account (the "012 incident" lesson).
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background ------------------------------------------------------------
// `Jolly is executable via \`npx\`` is defined in 020's step file (shared).

Given(
  "`jolly create` is a thin plumbing surface that never wraps the Vercel CLI or `@saleor\\/configurator`",
  function () {
    // Capability statement; the thin surface is verified by the help scenario.
  },
);

Given(
  "`jolly start` orchestrates the official CLIs by spawning them under their own auth, guided by the Jolly skill",
  function () {
    // Capability statement.
  },
);

// --- Scenario: Agent discovers create subcommands --------------------------

Given(
  "the agent needs to create a specific resource",
  function () {
    // Framing; the help inspection happens in the When.
  },
);

When("it inspects `jolly create --help`", function (this: JollyWorld) {
  this.runCli(["create", "--help", "--json"], { env: logicSafeEnv() });
});

function helpSubcommandNames(world: JollyWorld): string[] {
  const data = world.envelope.data as { subcommands?: unknown };
  const subs = Array.isArray(data.subcommands) ? data.subcommands : [];
  return subs
    .map((s) => (s && typeof s === "object" ? (s as { name?: unknown }).name : s))
    .filter((n): n is string => typeof n === "string");
}

Then(
  "it should see only the plumbing subcommands `store`, `app-token`, and `stripe`",
  function (this: JollyWorld) {
    const names = helpSubcommandNames(this);
    assert.deepEqual(
      [...names].sort(),
      ["app-token", "store", "stripe"],
      `create --help should list exactly store, app-token, stripe; got ${JSON.stringify(names)}`,
    );
  },
);

Then(
  "each subcommand should have a clear resource boundary",
  function (this: JollyWorld) {
    const data = this.envelope.data as { subcommands?: unknown };
    const subs = Array.isArray(data.subcommands) ? data.subcommands : [];
    for (const sub of subs) {
      assert.ok(sub && typeof sub === "object", "subcommand entry must be an object");
      const desc = (sub as { description?: unknown }).description;
      assert.equal(typeof desc, "string", "each subcommand needs a description");
      assert.ok((desc as string).length > 0, "subcommand description non-empty");
    }
  },
);

Then(
  "it should not list `deployment`, `deploy`, `recipe`, or `storefront` — that orchestration lives inside `jolly start`, which spawns the official CLIs",
  function (this: JollyWorld) {
    const names = helpSubcommandNames(this);
    for (const retired of ["deployment", "deploy", "recipe", "storefront"]) {
      assert.ok(
        !names.includes(retired),
        `create --help must not list the retired subcommand "${retired}"`,
      );
    }
  },
);

// --- Scenario: never report a resource they did not produce ----------------

Given(
  "`jolly create {word}` is run with its preconditions unmet",
  function (this: JollyWorld, subcommand: string) {
    // Each create subcommand, run under logicSafeEnv with no instance URL and an
    // unroutable Cloud API, is a precondition-unmet path: there is no real
    // endpoint to reach, so the command must error honestly. logicSafeEnv points
    // everything at `.invalid` and the temp project has no
    // NEXT_PUBLIC_SALEOR_API_URL.
    this.runCli(["create", subcommand, "--json"], {
      env: logicSafeEnv({ NEXT_PUBLIC_SALEOR_API_URL: undefined }),
    });
  },
);

When("the command runs with `--json`", function (this: JollyWorld) {
  // The command already ran in the Given with --json.
  assert.ok(this.lastRun?.envelope, "expected a --json envelope");
});

Then(
  "the envelope status should be {string} with a stable error code",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    assert.ok(this.envelope.errors.length > 0, "expected at least one error");
    for (const err of this.envelope.errors) {
      assert.equal(typeof err.code, "string");
      assert.match(
        err.code as string,
        /^[A-Z][A-Z0-9_]*$/,
        `error code "${err.code}" must be a stable machine identifier`,
      );
    }
  },
);

Then(
  "the output must not report a created, configured, or stored resource it did not produce",
  function (this: JollyWorld) {
    const env = this.envelope;
    assert.notEqual(env.status, "success", "an unmet-precondition run must not succeed");
    // Scan summary + data, but EXCLUDE the feature-021 `riskContext`: it is a
    // forward-looking preview of what the action *would* do ("Creates a Saleor
    // Cloud project…"), not a report of completed work.
    const { riskContext: _ignored, ...data } = env.data as Record<string, unknown>;
    let scan = (JSON.stringify(data) + " " + env.summary).toLowerCase();
    // Honest negations ("nothing was created", "nothing was stored") are not
    // claims of production — strip them before checking for fabricated claims.
    scan = scan.replace(
      /\b(nothing(?: was)?|no|not|never|without)\b[^.;:]*?\b(created|configured|stored|acquired|provisioned)\b/g,
      "",
    );
    for (const claim of ["created", "configured", "stored", "acquired", "provisioned"]) {
      assert.ok(
        !new RegExp(`\\b${claim}\\b`).test(scan),
        `error output must not claim a resource was ${claim}; summary/data: ${scan}`,
      );
    }
  },
);

Then(
  "no check should report {string} for work that did not happen",
  function (this: JollyWorld, badStatus: string) {
    for (const check of this.envelope.checks) {
      assert.notEqual(
        check.status,
        badStatus,
        `check ${check.id} reports "${badStatus}" for work that did not happen`,
      );
    }
  },
);

// ─── In-process stand-ins for the create paths ─────────────────────────────
//
// Two create subcommands reach the network on their store/preview path:
//   - `store` (default --create-environment) resolves the organization via the
//     Cloud API before previewing/issuing the environment-creation request;
//   - `app-token` mints a token via the instance GraphQL API.
// Both are driven against LOCAL loopback stand-ins so the @logic scenarios are
// deterministic and touch no real account (the "012 incident" lesson); the CLI
// reaches them over loopback, so runCliAsync (not spawnSync) must drive it.

/** Minimal Cloud API stand-in: answers org/projects/envs/services GETs so the
 *  store create-environment path resolves an organization and previews a real
 *  request. Records writes; a --dry-run must issue none. */
async function startCloudApiStandIn(world: JollyWorld): Promise<{ baseUrl: string; writes: Array<{ method: string; url: string }> }> {
  const writes: Array<{ method: string; url: string }> = [];
  const server: Server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    if (method !== "GET") {
      writes.push({ method, url });
      res.statusCode = 200;
      res.end(JSON.stringify({ task_id: "stand-in-task", key: "stand-in-env" }));
      return;
    }
    res.statusCode = 200;
    if (/\/services\/?($|\?)/.test(url)) return void res.end(JSON.stringify([]));
    if (/\/projects\/?($|\?)/.test(url))
      return void res.end(JSON.stringify([{ name: "jolly-store", slug: "jolly-store" }]));
    if (/\/environments\/?($|\?)/.test(url)) return void res.end(JSON.stringify([]));
    if (/\/organizations\/?($|\?)/.test(url))
      return void res.end(JSON.stringify([{ slug: "demo-org", name: "Demo Org" }]));
    res.end(JSON.stringify([]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/platform/api`;
  world.cleanup.register(`cloud API stand-in :${port}`, () => new Promise<void>((r) => server.close(() => r())));
  return { baseUrl, writes };
}

/** Minimal instance GraphQL stand-in: a "Jolly Setup" app already exists, so
 *  acquireAppToken mints a token via appTokenCreate (one mutation). The token
 *  is returned but never exercised — the value app-token stores without
 *  verifying. */
async function startGraphqlStandIn(world: JollyWorld): Promise<string> {
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      let body: { query?: string } = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const query = body.query ?? "";
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      if (query.includes("appTokenCreate")) {
        res.end(JSON.stringify({ data: { appTokenCreate: { authToken: "stand-in-app-token", errors: [] } } }));
        return;
      }
      if (query.includes("apps")) {
        res.end(JSON.stringify({ data: { apps: { edges: [{ node: { id: "QXBwOmpvbGx5", name: "Jolly Setup" } }] } } }));
        return;
      }
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const endpoint = `http://127.0.0.1:${port}/graphql/`;
  world.cleanup.register(`graphql stand-in :${port}`, () => new Promise<void>((r) => server.close(() => r())));
  return endpoint;
}

/** Combined envelope text (summary + data sans riskContext + checks), lowercased. */
function envelopeText(world: JollyWorld): string {
  const env = world.envelope;
  const { riskContext: _ignored, ...data } = env.data as Record<string, unknown>;
  return (
    env.summary +
    " " +
    JSON.stringify(data) +
    " " +
    JSON.stringify(env.checks)
  ).toLowerCase();
}

// ─── Scenario Outline: An unverified value is reported as "stored, not verified" ─

Given(
  "`jolly create {word}` stores a value it cannot verify in this run",
  async function (this: JollyWorld, subcommand: string) {
    this.notes.subcommand = subcommand;
    if (subcommand === "store") {
      // --url stores the Saleor endpoint to .env without verifying connectivity
      // (no introspection in this mode) — a value stored but not verified.
      this.runCli(
        ["create", "store", "--url", "https://logic-store.saleor.cloud/graphql/", "--json"],
        { env: logicSafeEnv() },
      );
    } else if (subcommand === "stripe") {
      // Stripe test keys are written to .env without being exercised against
      // Stripe — stored, not verified.
      this.runCli(
        ["create", "stripe", "--publishable-key", "pk_test_logic", "--secret-key", "sk_test_logic", "--json"],
        { env: logicSafeEnv() },
      );
    } else {
      // app-token mints a token via GraphQL (the stand-in returns one) and
      // stores it, but never exercises it — stored, not verified.
      const endpoint = await startGraphqlStandIn(this);
      await this.runCliAsync(["create", "app-token", "--url", endpoint, "--json"], {
        env: logicSafeEnv(),
      });
    }
  },
);

When("it reports the result with `--json`", function (this: JollyWorld) {
  // The command already ran in the Given with --json.
  assert.ok(this.lastRun?.envelope, "expected a --json envelope");
});

Then(
  'the output should describe that value as exactly "stored, not verified"',
  function (this: JollyWorld) {
    assert.ok(
      envelopeText(this).includes("stored, not verified"),
      `${this.notes.subcommand} must describe the stored-but-unverified value as exactly ` +
        `"stored, not verified"; envelope: ${envelopeText(this)}`,
    );
  },
);

Then(
  "it should not report the value as created, configured, or verified",
  function (this: JollyWorld) {
    // Strip the honest phrase itself and honest negations, then ensure no
    // positive created/configured/verified claim about the stored value remains.
    let scan = envelopeText(this)
      .replaceAll("stored, not verified", "")
      .replace(/\bnot verified\b/g, "");
    scan = scan.replace(
      /\b(nothing(?: was)?|no|not|never|without)\b[^.;:,"}]*?\b(created|configured|verified)\b/g,
      "",
    );
    for (const claim of ["created", "configured", "verified"]) {
      assert.ok(
        !new RegExp(`\\b${claim}\\b`).test(scan),
        `${this.notes.subcommand} must not report the stored value as ${claim}; scan: ${scan}`,
      );
    }
  },
);

// ─── Scenario Outline: create --dry-run shows the real request ─────────────

// store + stripe literals; the app-token example reuses 024's identical
// `jolly create app-token --dry-run` step (it runs the dry-run under
// logicSafeEnv, resolving the instance URL the preview names). Defining a
// {word} or app-token variant here would be ambiguous with that step.
Given(
  "the agent runs `jolly create store --dry-run`",
  async function (this: JollyWorld) {
    this.notes.subcommand = "store";
    // Default store action is the Cloud API environment creation; the stand-in
    // resolves the org so the preview names the real request.
    const standIn = await startCloudApiStandIn(this);
    this.notes.cloudStandIn = standIn;
    await this.runCliAsync(["create", "store", "--dry-run", "--json"], {
      env: logicSafeEnv({ JOLLY_SALEOR_CLOUD_API_URL: standIn.baseUrl }),
    });
  },
);

Given(
  "the agent runs `jolly create stripe --dry-run`",
  function (this: JollyWorld) {
    this.notes.subcommand = "stripe";
    // Keys must be present to preview storing them.
    this.runCli(
      ["create", "stripe", "--publishable-key", "pk_test_logic", "--secret-key", "sk_test_logic", "--dry-run", "--json"],
      { env: logicSafeEnv() },
    );
  },
);

When("the preview is produced", function (this: JollyWorld) {
  assert.ok(this.lastRun?.envelope, "expected a --json preview envelope");
  assert.equal(this.envelope.data["dryRun"], true, "a --dry-run preview must mark dryRun: true");
});

Then(
  "it should name the real request it would send — host, path, and resolved identifiers",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    // Branch on the envelope's own command (robust whether the Given was 008's
    // store/stripe step or 024's shared app-token --dry-run step).
    const command = this.envelope.command;
    if (command.includes("store")) {
      // Cloud API request: host + path + resolved organization.
      const requestUrl = String(data["requestUrl"] ?? "");
      assert.match(requestUrl, /\/platform\/api\/organizations\/demo-org\/environments\/$/,
        `store preview must name the real Cloud API request URL; got "${requestUrl}"`);
      assert.equal(data["organization"], "demo-org", "store preview must name the resolved organization");
    } else if (command.includes("app-token")) {
      // GraphQL request: the resolved instance endpoint (host + /graphql/ path).
      const instanceUrl = String(data["instanceUrl"] ?? "");
      assert.match(instanceUrl, /^https?:\/\/[^/]+\/graphql\/?$/,
        `app-token preview must name the resolved instance GraphQL endpoint; got "${instanceUrl}"`);
    } else {
      // stripe writes locally (no network host): the preview must name the
      // concrete target it would write — the .env Stripe key variables.
      const target = String((this.envelope.data["riskContext"] as Record<string, unknown> | undefined)?.["target"] ?? "");
      assert.match(target, /\.env/i, "stripe preview must name the .env target it would write");
      assert.match(target, /STRIPE/i, "stripe preview must name the Stripe key variables it would write");
    }
  },
);

Then("it should not claim the work was done", function (this: JollyWorld) {
  // A dry-run preview must not claim it created/stored/wrote/configured anything;
  // honest negations ("nothing was written") are allowed.
  let scan = envelopeText(this).replace(
    /\b(nothing(?: was)?|no|not|never|without)\b[^.;:,"}]*?\b(created|configured|stored|wrote|written|installed|deployed|acquired)\b/g,
    "",
  );
  for (const claim of ["created", "configured", "wrote", "written", "installed", "deployed", "acquired"]) {
    assert.ok(
      !new RegExp(`\\b${claim}\\b`).test(scan),
      `a dry-run must not claim the work was done (${claim}); scan: ${scan}`,
    );
  }
});

Then("it should not create, configure, or store anything", function (this: JollyWorld) {
  // No .env was written, and no harness write was issued.
  const envPath = join(this.lastRun!.cwd, ".env");
  if (existsSync(envPath)) {
    const values = loadEnvValues(this.lastRun!.cwd);
    for (const key of [
      "NEXT_PUBLIC_SALEOR_API_URL",
      "JOLLY_SALEOR_APP_TOKEN",
      "JOLLY_STRIPE_PUBLISHABLE_KEY",
      "JOLLY_STRIPE_SECRET_KEY",
    ]) {
      assert.ok(!(key in values), `a dry-run must not write ${key} to .env`);
    }
  }
  const standIn = this.notes.cloudStandIn as { writes: Array<unknown> } | undefined;
  if (standIn) {
    assert.equal(standIn.writes.length, 0, `a dry-run must issue no Cloud API writes; saw ${JSON.stringify(standIn.writes)}`);
  }
});
