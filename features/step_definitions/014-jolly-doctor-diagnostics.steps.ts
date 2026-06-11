// Steps for features/014-jolly-doctor-diagnostics.feature.
//
// Harness convention: check ids are namespaced by their v1 group —
// `skills.*`, `saleor.*`, `storefront.*`, `deployment.*`, `stripe.*`, plus
// `cli.*` for the doctor's own CLI checks. This is what makes "run only the
// relevant checks for that group" mechanically testable.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, stripEnvelopeJson, hasHumanText, type RunResult, type Envelope } from "../support/cli.ts";
import { CHECK_STATUS } from "../support/envelope.ts";
import { sandboxRuntimeEnv, memoizedRun } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

export const DOCTOR_GROUPS = ["skills", "saleor", "storefront", "deployment", "stripe"];

type Check = { id: string; status: string; [key: string]: unknown };

function checksOf(envelope: Envelope): Check[] {
  assert.ok(Array.isArray(envelope.checks), "doctor envelope must carry a checks array");
  return envelope.checks as Check[];
}

function findCheck(envelope: Envelope, pattern: RegExp): Check | undefined {
  return checksOf(envelope).find((check) => pattern.test(check.id));
}

function assertCheckPresent(envelope: Envelope, pattern: RegExp, what: string): Check {
  const check = findCheck(envelope, pattern);
  assert.ok(check, `doctor must include a ${what} check (id matching ${pattern}); got ids: ${checksOf(envelope).map((c) => c.id).join(", ")}`);
  assert.ok(CHECK_STATUS.includes(check.status as (typeof CHECK_STATUS)[number]), `check ${check.id} has invalid status`);
  return check;
}

// Minimal local Paper-shaped storefront fixture (paper-version.json is Paper's
// own baseline marker per feature 003 research notes).
export function writePaperFixture(projectDir: string): string {
  const dir = join(projectDir, "storefront");
  mkdirSync(join(dir, "migrations"), { recursive: true });
  writeFileSync(join(dir, "paper-version.json"), JSON.stringify({ version: "0.0.0-fixture" }, null, 2));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "paper-fixture", packageManager: "pnpm@9.0.0", engines: { node: ">=24" } }, null, 2),
  );
  writeFileSync(join(dir, "migrations", "0001-fixture.md"), "# Fixture migration guidance\n");
  return dir;
}

// --- Scenario: Agent runs doctor during setup (@logic) -----------------------

Given(lit("the agent is setting up a Jolly storefront"), function () {
  // Premise; runs in the scenario's fresh project dir.
});

When(lit("it invokes `jolly doctor`"), async function (this: JollyWorld) {
  const plain = await this.jolly(["doctor"]);
  const json = await this.jolly(["doctor", "--json"]);
  this.vars.set("plainRun", plain);
  this.vars.set("doctorEnvelope", requireEnvelope(json));
});

Then(lit("Jolly should check local Jolly CLI availability and version"), function (this: JollyWorld) {
  const envelope = this.vars.get("doctorEnvelope") as Envelope;
  const check = assertCheckPresent(envelope, /^cli\./, "CLI availability/version");
  assert.ok(
    /version/i.test(JSON.stringify(check)) || /\d+\.\d+/.test(JSON.stringify(envelope.data)),
    "doctor must report the CLI version",
  );
});

Then(lit("it should check skill installation status"), function (this: JollyWorld) {
  assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /^skills\./, "skill installation");
});

Then(lit("it should check supported agent guidance status where possible"), function (this: JollyWorld) {
  // "Where possible": the check must exist; in a bare directory its status may
  // be any of the doctor vocabulary (commonly warning/unknown).
  assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /guidance|agent/i, "agent guidance status");
});

Then(
  lit("it should summarize findings in concise human text plus machine-readable output"),
  function (this: JollyWorld) {
    const plain = this.vars.get("plainRun") as RunResult;
    const envelope = requireEnvelope(plain);
    assert.ok(envelope.summary.trim().length > 0, "doctor must carry a summary");
    assert.ok(hasHumanText(stripEnvelopeJson(plain.stdout)), "doctor default mode must include human text");
  },
);

// --- Scenario: Doctor checks Saleor connectivity (@sandbox) ------------------

Given(lit("Jolly has or can infer a Saleor GraphQL endpoint"), function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL) {
    return "skipped" as const; // optional sandbox input absent
  }
});

When(lit("`jolly doctor` checks Saleor"), async function (this: JollyWorld) {
  const json = await this.jolly(["doctor", "saleor", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("doctorEnvelope", requireEnvelope(json));
});

Then(lit("it should validate GraphQL connectivity"), function (this: JollyWorld) {
  const check = assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /^saleor\./, "Saleor connectivity");
  assert.ok(["pass", "warning"].includes(check.status), `connectivity against the sandbox endpoint should pass, got ${check.status}`);
});

Then(lit("it should check whether required environment variables are present"), function (this: JollyWorld) {
  assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /env/i, "required environment variables");
});

Then(lit("it should check whether an app token is available when required"), function (this: JollyWorld) {
  assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /token/i, "app token availability");
});

Then(lit("it should run or recommend Configurator introspection where appropriate"), function (this: JollyWorld) {
  const envelope = this.vars.get("doctorEnvelope") as Envelope;
  assert.ok(/introspect/i.test(JSON.stringify(envelope)), "doctor saleor must run or recommend introspection");
});

Then(
  lit("it should report missing permissions or authentication failures with next steps"),
  async function (this: JollyWorld) {
    // Produce an authentication failure honestly: bogus token, then expect
    // failing check plus guidance.
    const env = { ...sandboxRuntimeEnv(), JOLLY_SALEOR_APP_TOKEN: "invalid-token-for-test" };
    const run = await this.jolly(["doctor", "saleor", "--json"], { env });
    const envelope = requireEnvelope(run);
    const failing = checksOf(envelope).filter((c) => c.status === "fail" || c.status === "warning");
    assert.ok(failing.length > 0, "doctor must flag the invalid app token");
    assert.ok(
      (envelope.nextSteps as unknown[]).length > 0 || /remediation|nextStep/i.test(JSON.stringify(failing)),
      "auth failures must come with next steps",
    );
  },
);

// --- Scenario: Doctor checks storefront readiness (@sandbox) -----------------

Given(lit("a Paper storefront exists locally"), function (this: JollyWorld) {
  writePaperFixture(this.projectDir);
});

When(lit("`jolly doctor` checks the storefront"), async function (this: JollyWorld) {
  const json = await this.jolly(["doctor", "storefront", "--json"]);
  this.vars.set("doctorEnvelope", requireEnvelope(json));
});

Then(lit("it should verify required Paper environment variables"), function (this: JollyWorld) {
  const check = assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /env/i, "Paper env vars");
  // The fixture has no env configured, so this cannot pass silently.
  assert.notEqual(check.status, "pass", "missing NEXT_PUBLIC_SALEOR_API_URL must not pass");
});

Then(
  lit("it should verify the local Node.js version against Paper's current requirements"),
  function (this: JollyWorld) {
    assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /node/i, "Node.js version");
  },
);

Then(
  lit("it should identify whether the Jolly starter recipe exists in the cloned storefront repository"),
  function (this: JollyWorld) {
    assertCheckPresent(this.vars.get("doctorEnvelope") as Envelope, /recipe/i, "starter recipe presence");
  },
);

Then(
  lit("it should report whether product browsing, cart, and checkout readiness checks can be performed"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(this.vars.get("doctorEnvelope"));
    for (const area of ["brows", "cart", "checkout"]) {
      assert.ok(new RegExp(area, "i").test(serialized), `doctor storefront must report on ${area} readiness`);
    }
  },
);

Then(
  lit("it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests"),
  async function (this: JollyWorld) {
    const help = await this.jolly(["doctor", "--help"]);
    assert.ok(/--full-validation/.test(help.stdout), "doctor --help must document --full-validation");
  },
);

Then(
  lit("`jolly doctor storefront --full-validation` should run full storefront validation checks where feasible"),
  async function (this: JollyWorld) {
    const run = await this.jolly(["doctor", "storefront", "--full-validation", "--json"], { timeoutMs: 600_000 });
    const envelope = requireEnvelope(run);
    // The fixture cannot build; "where feasible" means the checks appear and
    // report honestly (fail/skipped), never that they are silently absent.
    assert.ok(
      /generate|typecheck|build|test/i.test(JSON.stringify(envelope.checks)),
      "--full-validation must surface the full validation checks",
    );
  },
);

// --- Scenario: Doctor checks deployment and payment readiness (@sandbox) -----

Given(lit("the storefront may be deployed"), function () {
  // Premise; checks below run "where credentials or context allow".
});

When(lit("`jolly doctor` checks remote readiness"), async function (this: JollyWorld) {
  const deployment = await this.jolly(["doctor", "deployment", "--json"], { env: sandboxRuntimeEnv() });
  const stripe = await this.jolly(["doctor", "stripe", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("deploymentEnvelope", requireEnvelope(deployment));
  this.vars.set("stripeEnvelope", requireEnvelope(stripe));
});

Then(
  lit("it should check Vercel deployment configuration where credentials or context allow"),
  function (this: JollyWorld) {
    assertCheckPresent(this.vars.get("deploymentEnvelope") as Envelope, /^deployment\./, "Vercel deployment configuration");
  },
);

Then(
  lit("it should check whether required Vercel environment variables are configured"),
  function (this: JollyWorld) {
    assertCheckPresent(this.vars.get("deploymentEnvelope") as Envelope, /env/i, "Vercel env vars");
  },
);

Then(
  lit("it should check whether Saleor trusted origins include the deployed storefront URL where possible"),
  function (this: JollyWorld) {
    assertCheckPresent(
      this.vars.get("deploymentEnvelope") as Envelope,
      /origin/i,
      "Saleor trusted origins",
    );
  },
);

Then(lit("it should check Stripe test-mode setup status where possible"), function (this: JollyWorld) {
  assertCheckPresent(this.vars.get("stripeEnvelope") as Envelope, /^stripe\./, "Stripe test-mode status");
});

// --- Scenario: Jolly start runs doctor automatically (@sandbox) --------------

Given(lit("`jolly start` has completed setup steps"), { timeout: 1_800_000 }, async function (this: JollyWorld) {
  // One full sandbox `jolly start` is shared process-wide (memoizedRun) so the
  // suite pays for at most one end-to-end run.
  const result = await memoizedRun("jolly-start-e2e", () =>
    this.jolly(["start", "--json", "--yes"], { env: sandboxRuntimeEnv(), timeoutMs: 1_500_000 }),
  );
  this.vars.set("startRun", result);
});

When(lit("it performs final verification"), function (this: JollyWorld) {
  requireEnvelope(this.vars.get("startRun") as RunResult);
});

Then(lit("it should run `jolly doctor` automatically"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
  assert.ok(
    Array.isArray(envelope.checks) && envelope.checks.length > 0,
    "start output must carry doctor verification checks",
  );
});

Then(lit("it should include doctor results in the final `jolly start` output"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
  for (const check of checksOf(envelope)) {
    assert.ok(CHECK_STATUS.includes(check.status as (typeof CHECK_STATUS)[number]), `invalid check status in start output: ${JSON.stringify(check)}`);
  }
});

// --- Scenario: Agent runs targeted doctor checks (@logic) --------------------

Given(lit("the agent needs to diagnose a specific area"), function () {
  // Premise.
});

When(lit("it invokes a named `jolly doctor` check group"), async function (this: JollyWorld) {
  const fullRun = await this.jolly(["doctor", "--json"]);
  const groupRun = await this.jolly(["doctor", "skills", "--json"]);
  this.vars.set("fullEnvelope", requireEnvelope(fullRun));
  this.vars.set("groupEnvelope", requireEnvelope(groupRun));
});

Then(lit("Jolly should run only the relevant checks for that group"), function (this: JollyWorld) {
  const group = this.vars.get("groupEnvelope") as Envelope;
  const checks = checksOf(group);
  assert.ok(checks.length > 0, "doctor skills must run the skills checks");
  const stray = checks.filter((check) => !check.id.startsWith("skills."));
  assert.deepEqual(
    stray.map((c) => c.id),
    [],
    "doctor skills must run only skills.* checks",
  );
});

Then(
  lit("supported v1 groups should include skills, saleor, storefront, deployment, and stripe"),
  async function (this: JollyWorld) {
    for (const group of DOCTOR_GROUPS) {
      const run = await this.jolly(["doctor", group, "--json"]);
      const envelope = requireEnvelope(run);
      assert.notEqual(
        envelope.status,
        "error",
        `doctor group ${group} must be supported; got: ${envelope.summary}`,
      );
      const checks = checksOf(envelope);
      assert.ok(checks.length > 0, `doctor ${group} ran no checks`);
      assert.ok(
        checks.every((check) => check.id.startsWith(`${group}.`)),
        `doctor ${group} ran checks outside its group: ${checks.map((c) => c.id).join(", ")}`,
      );
    }
  },
);
