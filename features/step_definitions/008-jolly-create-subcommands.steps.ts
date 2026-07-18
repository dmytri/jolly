// Feature 008 — Jolly create subcommands.
//
// These @logic scenarios pin the thin-CLI create surface (decision
// 2026-06-13): `jolly create --help` lists exactly `store` and NOT the retired
// tool-wrapping subcommands (deployment/deploy/recipe/storefront); and a create
// subcommand with unmet preconditions errors with a stable code and never
// fabricates a created/configured/stored resource or a `pass` check.
//
// Safety: every command runs with the runtime credentials genuinely UNSET
// (absentCredentialsEnv) — real absence, never dummy values — so no side-effecting
// path can reach a real account. The network-touching preview resolves the org
// against a LOCAL loopback stand-in (below), driven with a real-format token the
// stand-in does not validate; nothing reaches a real account.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues, writeEnvValues } from "../../src/lib/env-file.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";
import { startLimitRejectingCloudApi } from "../support/limit-cloud-api.ts";
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
  this.runCli(["create", "--help", "--json"], { env: absentCredentialsEnv() });
});

function helpSubcommandNames(world: JollyWorld): string[] {
  const data = world.envelope.data as { subcommands?: unknown };
  const subs = Array.isArray(data.subcommands) ? data.subcommands : [];
  return subs
    .map((s) => (s && typeof s === "object" ? (s as { name?: unknown }).name : s))
    .filter((n): n is string => typeof n === "string");
}

Then(
  "it should see only the plumbing subcommand `store`",
  function (this: JollyWorld) {
    const names = helpSubcommandNames(this);
    assert.deepEqual(
      [...names].sort(),
      ["store"],
      `create --help should list exactly store; got ${JSON.stringify(names)}`,
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
    // Each create subcommand, run with every credential genuinely unset and no
    // instance URL, is a precondition-unmet path: there is no credential or
    // endpoint to reach, so the command must error honestly. absentCredentialsEnv
    // unsets everything and the temp project has no NEXT_PUBLIC_SALEOR_API_URL.
    this.runCli(["create", subcommand, "--json"], {
      env: absentCredentialsEnv(),
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

// ─── In-process stand-in for the create store path ─────────────────────────
//
// `create store` (default --create-environment) resolves the organization via
// the Cloud API before previewing/issuing the environment-creation request. It
// is driven against a LOCAL loopback stand-in so the @logic scenarios are
// deterministic and touch no real account (the "012 incident" lesson); the CLI
// reaches it over loopback, so runCliAsync (not spawnSync) must drive it.

/** Minimal Cloud API stand-in: answers org/projects/envs/services GETs so the
 *  store create-environment path resolves an organization and previews a real
 *  request. Records writes; a --dry-run must issue none. */
async function startCloudApiStandIn(world: JollyWorld): Promise<{ baseUrl: string; writes: Array<{ method: string; url: string }> }> {
  const writes: Array<{ method: string; url: string }> = [];
  // @exceptional-double: verifying that a create-environment --dry-run issues NO
  // write request cannot be done against the real mutating Cloud API — a regressed
  // dry-run guard would create a real environment. This request-recording stand-in
  // observes the would-be writes safely; the real create is the @sandbox scenario.
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
  function (this: JollyWorld, subcommand: string) {
    this.notes.subcommand = subcommand;
    // --url stores the Saleor endpoint to .env without verifying connectivity
    // (no introspection in this mode) — a value stored but not verified.
    this.runCli(
      ["create", "store", "--url", "https://logic-store.saleor.cloud/graphql/", "--json"],
      { env: absentCredentialsEnv() },
    );
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

// The `store` literal drives the dry-run preview against the Cloud API
// loopback stand-in below.
Given(
  "the agent runs `jolly create store --dry-run`",
  async function (this: JollyWorld) {
    this.notes.subcommand = "store";
    // Default store action is the Cloud API environment creation; the stand-in
    // resolves the org so the preview names the real request.
    const standIn = await startCloudApiStandIn(this);
    this.notes.cloudStandIn = standIn;
    await this.runCliAsync(["create", "store", "--dry-run", "--json"], {
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_API_URL: standIn.baseUrl,
        JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN,
      }),
    });
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
    // Cloud API request: host + path + resolved organization.
    const requestUrl = String(data["requestUrl"] ?? "");
    assert.match(requestUrl, /\/platform\/api\/organizations\/demo-org\/environments\/$/,
      `store preview must name the real Cloud API request URL; got "${requestUrl}"`);
    assert.equal(data["organization"], "demo-org", "store preview must name the resolved organization");
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
      "SALEOR_TOKEN",
    ]) {
      assert.ok(!(key in values), `a dry-run must not write ${key} to .env`);
    }
  }
  const standIn = this.notes.cloudStandIn as { writes: Array<unknown> } | undefined;
  if (standIn) {
    assert.equal(standIn.writes.length, 0, `a dry-run must issue no Cloud API writes; saw ${JSON.stringify(standIn.writes)}`);
  }
});

// ─── Rule: Credentials are read from .env, the way a real agent leaves them ──
//
// `jolly login`/`jolly create store` write JOLLY_* credentials to the project
// `.env`; a real agent does NOT export them into its shell. So every command
// must read its credentials from the `.env` FILE, never depending on the value
// being present in the spawned process environment. This @logic scenario
// produces exactly that real-agent state: the cloud token is written to the
// project `.env` and is genuinely ABSENT from the child's process environment
// (absentCredentialsEnv unsets it). For `create store`, the Cloud API is pointed
// at the in-process loopback stand-in so the org resolves and the dry-run names
// the real environments request without touching a real account.

Given(
  "the real `JOLLY_SALEOR_CLOUD_TOKEN` is written to the project `.env` but is absent from the spawned process environment",
  async function (this: JollyWorld) {
    // The token lives in the project `.env` FILE (where `jolly login` leaves it),
    // never in the process environment — exactly how a real agent leaves it.
    writeEnvValues(this.projectDir, { JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN });
    // A loopback Cloud API so a `create store` dry-run resolves the org and names
    // the real environments request deterministically, touching no real account.
    const standIn = await startCloudApiStandIn(this);
    this.notes.cloudStandIn = standIn;
    // Drive `create store --create-environment --dry-run` (021's shared step)
    // with the Cloud API pointed at the loopback and the token absent from the
    // process environment — so the command can only succeed by reading the token
    // from `.env`.
    this.notes.createStoreEnv = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_API_URL: standIn.baseUrl,
    });
  },
);

// --- Scenario: jolly create store reads the Saleor Cloud token from .env -----
// (When `the agent runs \`jolly create store --create-environment --dry-run
// --json\`` is feature 021's shared step, which honors notes.createStoreEnv.)

Then(
  "the preview should name the real Cloud API `organizations\\/\\{organization\\}\\/environments\\/` request it would send to provision the store",
  function (this: JollyWorld) {
    const data = this.envelope.data as Record<string, unknown>;
    assert.equal(data["dryRun"], true, "a --dry-run preview must mark dryRun: true");
    const requestUrl = String(data["requestUrl"] ?? "");
    assert.match(
      requestUrl,
      /\/organizations\/[^/]+\/environments\/$/,
      `store preview must name the real Cloud API organizations/{organization}/environments/ ` +
        `request it would send to provision the store; got "${requestUrl}"`,
    );
  },
);

// ─── Scenario: actionable recovery when the org is at its environment limit ──
// @logic @exceptional-double. The shared limit-rejecting Cloud API loopback
// (features/support/limit-cloud-api.ts) returns the real ENVIRONMENT_LIMIT_REACHED
// rejection on the create POST; the shared When (002 step file) runs the real
// `create store --create-environment` against it when notes.limitHarness is set,
// with credentials unset (plus a stand-in token), so no real account is touched.

Given(
  "the Saleor Cloud environments endpoint returns ENVIRONMENT_LIMIT_REACHED",
  async function (this: JollyWorld) {
    const harness = await startLimitRejectingCloudApi(this);
    this.notes.limitHarness = { baseUrl: harness.baseUrl };
  },
);

Then(
  "nextSteps should name freeing a sandbox environment and upgrading the plan as recovery options",
  function (this: JollyWorld) {
    const text = JSON.stringify(this.envelope.nextSteps ?? []).toLowerCase();
    assert.match(
      text,
      /(free|delete|remove).*(sandbox|environment)/,
      `nextSteps must offer freeing a sandbox environment as a recovery option; ` +
        `got ${JSON.stringify(this.envelope.nextSteps)}`,
    );
    assert.match(
      text,
      /upgrade.*plan/,
      `nextSteps must offer upgrading the plan as a recovery option; ` +
        `got ${JSON.stringify(this.envelope.nextSteps)}`,
    );
  },
);

Then(
  "it should not report a created or stored environment",
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "success",
      "a limit-rejected run must not succeed",
    );
    // Scan summary + data (sans the forward-looking riskContext preview) + checks;
    // strip honest negations before checking for a fabricated created/stored claim.
    let scan = envelopeText(this);
    scan = scan.replace(
      /\b(nothing(?: was)?|no|not|never|without)\b[^.;:,"}]*?\b(created|stored|provisioned)\b/g,
      "",
    );
    for (const claim of ["created", "stored", "provisioned"]) {
      assert.ok(
        !new RegExp(`\\b${claim}\\b`).test(scan),
        `a limit-rejected run must not report an environment ${claim}; scan: ${scan}`,
      );
    }
  },
);

// ─── Scenario: A completed create subcommand points back to jolly start ──────
// Feature 022 composition: a completed `jolly create store` succeeds and its
// nextSteps point the agent back to `jolly start`, stating that start continues
// the end-to-end setup and RECOGNIZES the stored store rather than redoing it —
// so running a stage standalone and then `jolly start` composes without
// contradiction. Mode-1 `--url` is a pure `.env` write; credentials are
// genuinely unset (harmless), and the temp project starts with no endpoint so
// there is no collision.

When(
  "the agent runs `jolly create store --url https:\\/\\/example.saleor.cloud --json`",
  function (this: JollyWorld) {
    this.runCli(
      ["create", "store", "--url", "https://example.saleor.cloud", "--json"],
      { env: absentCredentialsEnv() },
    );
  },
);

Then(
  "nextSteps should include a step whose command is `jolly start`",
  function (this: JollyWorld) {
    const step = this.envelope.nextSteps.find(
      (s) => String(s.command).trim() === "jolly start",
    );
    assert.ok(
      step,
      `nextSteps must include a step whose command is exactly "jolly start"; ` +
        `got ${JSON.stringify(this.envelope.nextSteps)}`,
    );
    this.notes.startStep = step;
  },
);

Then(
  "that step should state that `jolly start` continues the end-to-end setup and recognizes the stored store rather than redoing it \\(feature {int})",
  function (this: JollyWorld, _feature: number) {
    const step = this.notes.startStep as Record<string, unknown> | undefined;
    assert.ok(step, "the `jolly start` nextStep must be present");
    const text = String(
      (step as { description?: unknown }).description ?? "",
    ).toLowerCase();
    // Continues the end-to-end setup.
    assert.match(
      text,
      /continue|resume/,
      `the step must state that jolly start continues the end-to-end setup; got "${text}"`,
    );
    // Recognizes the stored store rather than redoing it.
    assert.match(
      text,
      /recogniz|already|rather than redo|without redo|not redo/,
      `the step must state that jolly start recognizes the stored store rather ` +
        `than redoing it; got "${text}"`,
    );
  },
);

Then(
  "the preview should report that the Cloud token it would authenticate with was read from the project `.env`",
  function (this: JollyWorld) {
    // The Given put JOLLY_SALEOR_CLOUD_TOKEN in the project `.env` FILE only and
    // unset it from the process environment, so a correct preview must report it
    // authenticated with the token read from `.env` — not the process env. Assert
    // a dedicated source field (not the incidental `.env` in riskContext
    // sideEffects, which would make this pass trivially).
    const data = this.envelope.data as Record<string, unknown>;
    const source = String(data["cloudTokenSource"] ?? "").toLowerCase();
    assert.ok(
      source.includes(".env"),
      `the preview must report the Cloud token's source as the project .env file; ` +
        `got cloudTokenSource="${data["cloudTokenSource"] ?? ""}"`,
    );
    assert.ok(
      !source.includes("process") && !source.includes("environment"),
      `the preview must report the Cloud token was read from the .env FILE, ` +
        `not the process environment; got "${data["cloudTokenSource"] ?? ""}"`,
    );
  },
);

// --- Scenario: An unknown create subcommand errors naming the supported set --

When("the agent runs `jolly create frobnicate --json`", function (this: JollyWorld) {
  this.runCli(["create", "frobnicate", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the envelope status should be {string} with the stable code `UNKNOWN_CREATE_SUBCOMMAND`",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    assert.ok(
      this.envelope.errors.some((e) => e.code === "UNKNOWN_CREATE_SUBCOMMAND"),
      `expected a stable UNKNOWN_CREATE_SUBCOMMAND error; got ${JSON.stringify(this.envelope.errors)}`,
    );
  },
);

Then(
  "the error message should name the supported subcommand `store`",
  function (this: JollyWorld) {
    const error = this.envelope.errors.find(
      (e) => e.code === "UNKNOWN_CREATE_SUBCOMMAND",
    );
    assert.ok(error, "expected the UNKNOWN_CREATE_SUBCOMMAND error");
    const text = `${String(error!.message ?? "")} ${String(error!.remediation ?? "")}`;
    assert.ok(
      /\bstore\b/.test(text),
      `the unknown-subcommand error must name the supported subcommand "store"; got: ${text}`,
    );
  },
);

Then(
  "nextSteps should include a step whose command is `jolly create --help`",
  function (this: JollyWorld) {
    const commands = this.envelope.nextSteps.map((step) => String(step.command ?? ""));
    assert.ok(
      commands.includes("jolly create --help"),
      `nextSteps must include a step whose command is \`jolly create --help\`; got ${JSON.stringify(commands)}`,
    );
  },
);
