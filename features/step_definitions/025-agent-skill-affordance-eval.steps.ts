// Feature 025 — Agent skill affordance evaluation (@eval tier).
//
// Drives the BASELINE `pi` agent over the REAL Captain-owned Jolly skill and the
// REAL published-shape Jolly CLI in a safe, bounded, per-run workspace, then
// asserts AFFORDANCES — that the agent discovered and invoked Jolly's documented
// commands (captured by a PATH-shim argv trace) and reached the documented local
// project state (feature 007 artifacts; the feature 020 envelope from Jolly's
// diagnostics) — never a working deployed store.
//
// Live by design (features 025 + 023): the agent runs against the REAL
// integrated test-env credentials — no fakes. Safety is harmless-by-design: a
// throwaway $HOME and temp workspace, every created cloud resource
// `jolly-test`-namespaced and reclaimed in best-effort teardown. The @eval Before
// hook (support/hooks.ts) skips — never fails — when the runner or
// HARNESS_OPENROUTER_API_KEY is absent, so this never gates normal CI.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertEnvelopeShape, type Envelope, findEnvelope } from "../support/envelope.ts";
import {
  assertRealInputs,
  type AgentRun,
  type EvalContext,
  DOCUMENTED_COMMANDS,
  envelopeFromTrace,
  parseTrace,
  persistEvalTranscript,
  resolveEvalTask,
  runBaselineAgent,
  setupEvalContext,
  subcommandOf,
  type TraceRecord,
} from "../support/eval.ts";
import { writeStripeCliTraceWrapper } from "../support/stripe-cli-trace.ts";
import { listAllEnvironments, deleteEnvironment } from "../support/cloud.ts";
import type { JollyWorld } from "../support/world.ts";

// A live LLM agent run is slow; the When step that runs it carries an explicit
// timeout that must exceed the agent process budget (HARNESS_EVAL_TIMEOUT_MS,
// default 10 min) — otherwise cucumber kills the step before the agent's own
// budget elapses. Derive it from that knob plus a 5-minute buffer so a raised
// budget (e.g. a full store+deploy run) is honored. All other steps use the
// default.
const AGENT_BUDGET_MS = (() => {
  const raw = process.env.HARNESS_EVAL_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 600_000;
})();
const AGENT_STEP_TIMEOUT_MS = Math.max(900_000, AGENT_BUDGET_MS + 300_000);

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
  "the actual published-shape Jolly CLI and the actual shipped Jolly skill \\(no mocks)",
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
  "a real Stripe CLI test-mode session is available",
  function (this: JollyWorld) {
    // Live by design: use the runner's REAL Stripe CLI, never a fake. A
    // passthrough trace wrapper (records argv, then execs the real binary) is
    // placed first on the agent PATH so the eval can observe a read-only
    // `config --list`. The browser `stripe login` is a human step that cannot be
    // provisioned on demand; when no real test-mode session is present the
    // Stripe-import affordance is simply not exercised here (it is covered by
    // feature 005) and the run proceeds against the other real credentials.
    const c = ctx(this);
    const probe = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
    const stdout = typeof probe.stdout === "string" ? probe.stdout : "";
    const pub = /test_mode_pub_key\s*=\s*["']?(pk_test_[^"'\s]+)/.exec(stdout)?.[1];
    const secret = /test_mode_api_key\s*=\s*["']?((?:sk|rk)_test_[^"'\s]+)/.exec(stdout)?.[1];
    if (probe.status !== 0 || !pub || !secret) {
      this.attach(
        "No real Stripe CLI test-mode session on the runner; the Stripe-import " +
          "affordance is not exercised in this run (covered by feature 005).",
        "text/plain",
      );
      return;
    }
    const resolved = spawnSync("sh", ["-c", "command -v stripe"], { encoding: "utf8" });
    const realStripePath = (resolved.stdout ?? "").trim();
    assert.ok(realStripePath, "must resolve the real `stripe` binary path");
    this.trackSecret(pub);
    this.trackSecret(secret);
    writeStripeCliTraceWrapper(c.shimDir, {
      traceFile: c.stripeTraceFile,
      realStripePath,
    });
  },
);

Given(
  "the agent is run with the real integrated test-env credentials, every resource it creates `jolly-test`-namespaced and removed in teardown",
  function (this: JollyWorld) {
    // The workspace `.env` was seeded with the REAL runtime credentials by
    // setupEvalContext; confirm it carries the real Saleor Cloud token (live by
    // design — no dummy stand-in).
    const realToken = process.env.JOLLY_SALEOR_CLOUD_TOKEN;
    assert.ok(realToken, "feature 025 needs the real JOLLY_SALEOR_CLOUD_TOKEN in the test env");
    const envFile = join(ctx(this).workspace, ".env");
    assert.ok(existsSync(envFile), "the workspace must carry a seeded .env");
    assert.ok(
      readFileSync(envFile, "utf8").includes(realToken),
      "the seeded .env must carry the REAL Saleor Cloud token (live by design)",
    );
    // Track the real secrets so the no-leak assertions cover them.
    for (const name of [
      "JOLLY_SALEOR_CLOUD_TOKEN",
      "JOLLY_SALEOR_APP_TOKEN",
      "JOLLY_STRIPE_SECRET_KEY",
      "JOLLY_STRIPE_PUBLISHABLE_KEY",
    ]) {
      const v = process.env[name];
      if (v && v.trim() !== "") this.trackSecret(v);
    }
    // Best-effort teardown reclaiming the jolly-test-namespaced Saleor
    // environments the run created — unless retention is explicitly requested.
    // jolly-test-namespaced environments are this test org's disposable
    // resources (AGENTS.md); only that namespace is ever deleted.
    const keep = process.env.HARNESS_EVAL_KEEP_STORE;
    if (keep && keep.trim() !== "") {
      this.attach("HARNESS_EVAL_KEEP_STORE set: created store retained, teardown skipped.", "text/plain");
      return;
    }
    const token = realToken;
    const runNamespace = this.namespace;
    this.cleanup.register(`eval jolly-test environments (run ${runNamespace})`, async () => {
      for (const env of await listAllEnvironments(token)) {
        if (env.name.startsWith("jolly-test")) {
          await deleteEnvironment(token, env.org, env.key);
        }
      }
    });
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
    // Default: the live `jolly.cool/setup` URL the docstring carries, unchanged.
    // Opt-in HARNESS_EVAL_SETUP_LOCAL: serve `assets/homepage/setup.md` over an
    // ephemeral 127.0.0.1 server (torn down via the scenario cleanup registry)
    // and point the task at it, so the setup guide can be iterated locally.
    const resolvedTask = resolveEvalTask(task, (description, fn) =>
      this.cleanup.register(description, fn),
    );
    const run = runBaselineAgent(ctx(this), resolvedTask);
    this.notes[RUN] = run;
    const records = parseTrace(ctx(this).traceFile);
    this.notes[TRACE] = records;
    // Persist the run's evidence before teardown when HARNESS_EVAL_TRANSCRIPT_DIR
    // is set (feature 023 transcript keeping). Observability only — done here,
    // before the Then assertions, so a non-deterministic FAIL is still captured;
    // never affects pass/fail. Unset knob → no-op (the default throwaway run).
    const transcriptDir = persistEvalTranscript(ctx(this), run, this.namespace);
    // Attach diagnostics so a non-deterministic failure is debuggable.
    this.attach(
      `Agent exit ${run.exitCode} in ${run.durationMs}ms` +
        (run.timedOut ? " (TIMED OUT)" : "") +
        (transcriptDir ? `\nTranscript: ${transcriptDir}` : "") +
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
  "the agent should have invoked Jolly's documented CLI commands, including `jolly start`",
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
    // Reworded 2026-06-14 (the "Agent-supervised orchestration" pivot): the
    // `/setup` guide directs the agent to `jolly start` as the orchestrated entry
    // point, so the agent must specifically have invoked it — not merely some
    // other setup command.
    assert.ok(
      subs.includes("start"),
      `agent never invoked \`jolly start\`; ran ${JSON.stringify(subs)}`,
    );
  },
);

Then(
  "the workspace should contain the local artifacts `jolly init` produces \\(the installed Jolly skill, a merged `.mcp.json`, a scaffolded `.env`, and the marker-merged `AGENTS.md`)",
  function (this: JollyWorld) {
    const ws = ctx(this).workspace;

    // Installed Jolly skill on disk.
    assert.ok(
      existsSync(join(ws, ".agents", "skills", "jolly", "SKILL.md")),
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

    // Scaffolded .env (seeded with the real integrated test-env credentials).
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
  "the run should report only outcomes it actually achieved, stopping honestly at any remaining human gate without fabricating success",
  function (this: JollyWorld) {
    const envelopes = trace(this)
      .map((rec) => (rec.stdout ? findEnvelope(rec.stdout) : undefined))
      .filter((e): e is Envelope => Boolean(e));
    assert.ok(
      envelopes.length > 0,
      "no Jolly command emitted an output envelope to judge stop-honesty",
    );

    // (a) No self-contradicting success: an envelope reporting overall "success"
    // must carry no failing check (a success that contradicts its own checks is
    // fabricated — the feature 001/020 no-fabrication invariant).
    for (const env of envelopes) {
      if (env.status === "success") {
        const failing = env.checks.find((c) => c.status === "fail");
        assert.ok(
          !failing,
          `an envelope reported overall success while a check failed: ${JSON.stringify(failing)}`,
        );
      }
    }

    // (b) No deployment/live-store claim without a real URL to back it: a run
    // that did not deploy must not assert a live storefront.
    for (const env of envelopes) {
      const claimsLive = /deployed(\s+to)?|store is live|storefront is live|catalog deployed/i.test(
        env.summary,
      );
      if (claimsLive) {
        const data = env.data as Record<string, unknown>;
        const hasUrl = Object.values(data).some(
          (v) => typeof v === "string" && /^https:\/\//.test(v),
        );
        assert.ok(
          hasUrl,
          `the run claimed a live outcome without reporting a real URL: "${env.summary}"`,
        );
      }
    }
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
  "when the store stage completed, the run must surface the real Saleor Dashboard URL Jolly emitted for the `jolly-test`-namespaced environment it created — a real `.saleor.cloud\\/dashboard\\/` URL observed from Jolly's output, never fabricated — and likewise the deployed storefront URL when the Vercel deploy completed",
  function (this: JollyWorld) {
    // Surface, from Jolly's OWN output envelopes, the real URLs reported for the
    // stages that actually completed — never fabricated. The assertion is
    // CONDITIONAL on stage completion: a run that honestly paused at the store
    // approval gate (or whose Vercel deploy was gated) completed no such stage
    // and is required to surface no URL — its absence is reported, not invented.
    const envelopes = trace(this)
      .map((rec) => (rec.stdout ? findEnvelope(rec.stdout) : undefined))
      .filter((e): e is Envelope => Boolean(e));

    const stageCompleted = (name: string): boolean =>
      envelopes.some((env) => {
        const stages = ((env.data as Record<string, unknown>)?.["stages"] ?? []) as Array<{
          stage?: string;
          status?: string;
        }>;
        return stages.some((s) => s.stage === name && s.status === "completed");
      });

    // Collect every https URL Jolly emitted, recursing into nested data objects
    // (the store/deploy stages surface URLs under data.store / data.deploy).
    const dashboardUrls = new Set<string>();
    const storefrontUrls = new Set<string>();
    const visit = (obj: unknown): void => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "string" && /^https:\/\//.test(v)) {
          if (/dashboard/i.test(k)) dashboardUrls.add(v);
          if (/(deployment|storefront)/i.test(k) && /url/i.test(k)) storefrontUrls.add(v);
        } else if (v && typeof v === "object") {
          visit(v);
        }
      }
    };
    for (const env of envelopes) visit(env.data);

    this.attach(
      `Reported Saleor dashboard URL(s): ${[...dashboardUrls].join(", ") || "(none — store stage not completed)"}\n` +
        `Reported storefront URL(s): ${[...storefrontUrls].join(", ") || "(none — Vercel deploy gated/not completed)"}`,
      "text/plain",
    );

    // When a stage genuinely completed, its real URL must be present (never a
    // fabricated or guessed value); when it did not, no URL is required.
    if (stageCompleted("store")) {
      const dash = [...dashboardUrls].find((u) => /\.saleor\.cloud\/dashboard\//.test(u));
      assert.ok(
        dash,
        "the store stage completed, so the run must surface the real .saleor.cloud/dashboard/ URL Jolly emitted",
      );
    }
    if (stageCompleted("deploy")) {
      assert.ok(
        storefrontUrls.size > 0,
        "the Vercel deploy stage completed, so the run must surface the deployed storefront URL Jolly captured",
      );
    }
    // Any URL the run reports must be a real https URL emitted by Jolly, never a
    // fabricated placeholder.
    for (const url of [...dashboardUrls, ...storefrontUrls]) {
      assert.match(url, /^https:\/\/[^/\s]+\.[^/\s]+/, `a reported URL must be a real https URL: ${url}`);
    }
  },
);

Then(
  "every cloud resource the agent created should be `jolly-test`-namespaced and, unless retention is explicitly requested via `HARNESS_EVAL_KEEP_STORE`, removed in best-effort teardown, with nothing outside that namespace touched",
  function (this: JollyWorld) {
    // Any environment/store the run reports in its envelopes must be
    // jolly-test-namespaced. Best-effort teardown reclamation was registered by
    // the credentials Given (skipped only when HARNESS_EVAL_KEEP_STORE is set);
    // it deletes only jolly-test-namespaced environments, nothing else.
    const envelopes = trace(this)
      .map((rec) => (rec.stdout ? findEnvelope(rec.stdout) : undefined))
      .filter((e): e is Envelope => Boolean(e));
    for (const env of envelopes) {
      const data = env.data as Record<string, unknown>;
      for (const key of ["environmentName", "storeName", "environmentKey", "environment"]) {
        const v = data[key];
        if (typeof v === "string" && v.trim() !== "") {
          assert.ok(
            v.includes("jolly-test"),
            `a created cloud resource (${key}="${v}") must be jolly-test-namespaced`,
          );
        }
      }
    }
    const keep = process.env.HARNESS_EVAL_KEEP_STORE;
    this.attach(
      keep && keep.trim() !== ""
        ? "HARNESS_EVAL_KEEP_STORE set: created jolly-test store retained for inspection."
        : "Created jolly-test resources will be reclaimed in best-effort teardown.",
      "text/plain",
    );
  },
);
