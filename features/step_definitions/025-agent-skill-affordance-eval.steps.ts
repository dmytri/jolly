// Feature 025 — Agent skill affordance evaluation (@eval tier).
//
// Drives the BASELINE `pi` agent over the REAL Captain-owned Jolly skill and the
// REAL published-shape Jolly CLI in a safe, bounded, per-run workspace, then
// asserts AFFORDANCES — that the agent discovered and invoked Jolly's documented
// commands (captured by a PATH-shim argv trace) and reached the documented local
// project state (feature 007 artifacts; the feature 020 envelope from Jolly's
// diagnostics) — never a working deployed store.
//
// Safety is enforced by the harness, not the agent: a throwaway $HOME, forced
// safe credentials (dummy JOLLY_* + an unroutable `.invalid` Cloud API base),
// and a temp workspace, all torn down after the run (features 025 + 023). The
// @eval Before hook (support/hooks.ts) skips — never fails — when the runner or
// HARNESS_OPENROUTER_API_KEY is absent, so this never gates normal CI.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertEnvelopeShape, findEnvelope } from "../support/envelope.ts";
import {
  assertRealInputs,
  type AgentRun,
  type EvalContext,
  DOCUMENTED_COMMANDS,
  DUMMY,
  envelopeFromTrace,
  parseTrace,
  runBaselineAgent,
  setupEvalContext,
  subcommandOf,
  type TraceRecord,
} from "../support/eval.ts";
import { UNROUTABLE_CLOUD_API } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// A live LLM agent run is slow; the When step that runs it carries an explicit
// 15-minute timeout (the agent process is itself bounded by
// HARNESS_EVAL_TIMEOUT_MS, default 10 min). All other steps use the default.
const AGENT_STEP_TIMEOUT_MS = 900_000;

const CTX = "evalContext";
const RUN = "evalRun";
const TRACE = "evalTrace";

function ctx(world: JollyWorld): EvalContext {
  const value = world.notes[CTX] as EvalContext | undefined;
  assert.ok(value, "eval context was not set up by the Background/Given steps");
  return value;
}

// ─── Background ─────────────────────────────────────────────────────────────

Given(
  "the actual published-shape Jolly CLI and the actual Captain-owned Jolly skill \\(no mocks)",
  function () {
    // Fail loudly (not skip) if the real inputs are missing — the @eval Before
    // hook has already confirmed the runner and key, so this is a real defect.
    assertRealInputs();
  },
);

Given("feature 007 defines the local artifacts `jolly init` produces", function () {
  // Narrative context: the artifacts asserted below are exactly feature 007's
  // (installed skill, merged .mcp.json, scaffolded .env, marker-merged AGENTS.md).
});

// ─── Scenario setup ─────────────────────────────────────────────────────────

Given(
  "a fresh per-run temporary workspace with the Jolly skill and CLI available",
  function (this: JollyWorld) {
    const context = setupEvalContext(this.namespace, (description, fn) =>
      this.cleanup.register(description, fn),
    );
    this.notes[CTX] = context;
  },
);

Given(
  "the baseline agent runs under a throwaway `$HOME` so its own config and credentials stay isolated",
  function (this: JollyWorld) {
    // The throwaway $HOME was created with the context; confirm it is isolated
    // (a fresh temp dir, not the real home).
    const home = ctx(this).fakeHome;
    assert.ok(existsSync(home), "the throwaway $HOME must exist");
    assert.notEqual(home, process.env.HOME, "the agent $HOME must not be the real home");
  },
);

Given(
  "the agent is run with forced safe credentials so no real cloud resources can be created",
  function (this: JollyWorld) {
    // The forced-safe `.env` was seeded with the context; confirm it carries the
    // dummy credentials and the unroutable Cloud API base (the "012 incident"
    // discipline) so even a create/deploy command cannot reach a real account.
    const envFile = join(ctx(this).workspace, ".env");
    assert.ok(existsSync(envFile), "a forced-safe .env must be seeded in the workspace");
    const contents = readFileSync(envFile, "utf8");
    assert.match(
      contents,
      new RegExp(UNROUTABLE_CLOUD_API.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the safe .env must point the Cloud API at an unroutable .invalid base",
    );
    assert.ok(
      contents.includes(DUMMY.cloudToken),
      "the safe .env must carry a dummy Saleor Cloud token",
    );
    for (const secret of Object.values(DUMMY)) this.trackSecret(secret);
  },
);

Given("Jolly's CLI invocations in the workspace are traced", function (this: JollyWorld) {
  // The PATH-shim tracer was installed with the context; confirm the shim and
  // the (initially empty) trace file are in place.
  const c = ctx(this);
  assert.ok(existsSync(join(c.shimDir, "jolly")), "the `jolly` PATH shim must exist");
  assert.ok(existsSync(c.traceFile), "the invocation trace file must exist");
});

// ─── The agent run ──────────────────────────────────────────────────────────

When(
  "a baseline agent is given the task:",
  { timeout: AGENT_STEP_TIMEOUT_MS },
  function (this: JollyWorld, task: string) {
    const run = runBaselineAgent(ctx(this), task);
    this.notes[RUN] = run;
    const records = parseTrace(ctx(this).traceFile);
    this.notes[TRACE] = records;
    // Attach diagnostics so a non-deterministic failure is debuggable.
    this.attach(
      `Agent exit ${run.exitCode} in ${run.durationMs}ms` +
        (run.timedOut ? " (TIMED OUT)" : "") +
        `\nTraced Jolly invocations: ` +
        records.map((r) => `${r.tool} ${r.argv.join(" ")}`).join(" | "),
      "text/plain",
    );
  },
);

function run(world: JollyWorld): AgentRun {
  return world.notes[RUN] as AgentRun;
}
function trace(world: JollyWorld): TraceRecord[] {
  return (world.notes[TRACE] as TraceRecord[]) ?? [];
}

// ─── Affordance assertions ──────────────────────────────────────────────────

Then(
  "the agent should have invoked Jolly's documented CLI commands",
  function (this: JollyWorld) {
    const records = trace(this);
    assert.ok(
      !run(this).timedOut,
      "the baseline agent timed out before completing the task",
    );
    assert.ok(
      records.length > 0,
      "the agent invoked no Jolly commands at all (the PATH-shim trace is empty)",
    );
    const subs = records.map(subcommandOf).filter((s): s is string => Boolean(s));
    // Every Jolly invocation must be a documented command (no invented surface).
    for (const sub of subs) {
      assert.ok(
        DOCUMENTED_COMMANDS.has(sub),
        `agent invoked an undocumented Jolly command "${sub}"`,
      );
    }
    // And it must have run at least one substantive setup/diagnostic command —
    // not merely `jolly --help`.
    const substantive = subs.some((s) =>
      ["init", "start", "doctor", "create"].includes(s),
    );
    assert.ok(
      substantive,
      `agent ran only ${JSON.stringify(subs)}; expected a setup/diagnostic command (init/start/doctor/create)`,
    );
  },
);

Then(
  "the workspace should contain the local artifacts `jolly init` produces \\(the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)",
  function (this: JollyWorld) {
    const ws = ctx(this).workspace;

    // Installed Jolly skill on disk.
    assert.ok(
      existsSync(join(ws, ".claude", "skills", "jolly", "SKILL.md")),
      "the installed Jolly skill must be present on disk",
    );

    // Merged .mcp.json carrying the Jolly mcp-graphql server entry.
    const mcpPath = join(ws, ".mcp.json");
    assert.ok(existsSync(mcpPath), "`jolly init` must produce a merged .mcp.json");
    const mcp = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(
      mcp.mcpServers && mcp.mcpServers["saleor-graphql"],
      ".mcp.json must carry the Jolly saleor-graphql server entry",
    );

    // Scaffolded .env (the forced-safe credential file).
    assert.ok(existsSync(join(ws, ".env")), "a scaffolded .env must be present");

    // Marker-merged AGENTS.md.
    const agentsPath = join(ws, "AGENTS.md");
    assert.ok(existsSync(agentsPath), "`jolly init` must produce a marker-merged AGENTS.md");
    assert.match(
      readFileSync(agentsPath, "utf8"),
      /jolly:begin/,
      "AGENTS.md must carry the Jolly marker section",
    );

    // It must NOT assert artifacts Jolly does not produce (feature 025).
    assert.ok(
      !existsSync(join(ws, "jolly.config.ts")),
      "Jolly does not produce a jolly.config.ts; it must not appear",
    );
  },
);

Then(
  "Jolly's diagnostics should have run and emitted the standard output envelope",
  function (this: JollyWorld) {
    // Diagnostics = `jolly doctor` (or `jolly start`, which runs doctor).
    const found = envelopeFromTrace(trace(this), ["doctor", "start"]);
    assert.ok(
      found,
      "no `jolly doctor`/`jolly start` invocation emitted an output envelope",
    );
    assertEnvelopeShape(found.envelope);
    assert.equal(
      found.envelope.command,
      found.command,
      "the envelope's command field must match the invoked diagnostics command",
    );
  },
);

Then(
  "no real cloud resource should have been created and nothing should have been deployed",
  function (this: JollyWorld) {
    // Safety is structural (forced-safe creds + throwaway home), but assert the
    // observable evidence too: no traced Jolly envelope reported a real created
    // resource or a deployment, and the safe Cloud API base was never replaced
    // with a real one in the workspace .env.
    for (const rec of trace(this)) {
      const env = rec.stdout ? findEnvelope(rec.stdout) : undefined;
      if (!env) continue;
      const data = env.data as Record<string, unknown>;
      for (const key of ["environmentKey", "deploymentUrl", "organizationSlug"]) {
        assert.ok(
          !(key in data) || env.status === "error",
          `a Jolly command reported a real cloud resource (${key}) under safe credentials`,
        );
      }
    }
    // The workspace endpoint must remain the unroutable safe value — no real
    // *.saleor.cloud environment was provisioned into it.
    const envFile = join(ctx(this).workspace, ".env");
    if (existsSync(envFile)) {
      const contents = readFileSync(envFile, "utf8");
      assert.ok(
        !/https:\/\/[^\s]*\.saleor\.cloud/.test(contents),
        "the workspace .env points at a real *.saleor.cloud endpoint — a real resource was created",
      );
    }
  },
);
