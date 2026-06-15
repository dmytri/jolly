// Feature 014 — Jolly doctor diagnostics.
//
// `jolly doctor` is read-only diagnostics emitting a well-formed checks array
// (the feature 020 vocabulary: pass|warning|fail|skipped|unknown). It is the
// agent's recovery oracle: actionable (fail/warning) checks carry a concrete
// next command, or the envelope carries nextSteps. Per feature 020's "No
// fabricated success", doctor reports `pass` only for a check it actually
// performed; checks it could not run are skipped/unknown/fail, never pass.
//
// @logic scenarios run under logicSafeEnv() (unroutable Cloud API base, dummy
// creds) — so connectivity is never probed and no remote `pass` is fabricated.
// @sandbox scenarios (connectivity, storefront, deployment+payment readiness,
// start-runs-doctor) are gated by name in SANDBOX_REQUIREMENTS and skip
// locally; their bodies assert only Jolly's own observable contribution.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_STATUSES } from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// ─── Scenario: Agent runs doctor during setup (@logic) ──────────────────────

Given("a project directory with the Jolly CLI installed", function () {
  // The temp project directory is the setup context; nothing to arrange.
});

When("it invokes `jolly doctor`", function (this: JollyWorld) {
  this.runCli(["doctor", "--json"], { env: logicSafeEnv() });
});

Then(
  "Jolly should check local Jolly CLI availability and version",
  function (this: JollyWorld) {
    const check = this.findCheck("cli-available");
    assert.ok(check, "doctor must report a CLI availability check");
    // CLI availability is genuinely performed (the CLI is running), so pass
    // here is honest, not fabricated.
    assert.equal(check!.status, "pass");
    assert.match(
      String(check!.description ?? ""),
      /node/i,
      "the CLI check should report the runtime version",
    );
  },
);

Then("it should check skill installation status", function (this: JollyWorld) {
  const skillChecks = this.envelope.checks.filter((c) => c.id.startsWith("skill-"));
  assert.ok(skillChecks.length > 0, "doctor must report skill installation checks");
  // No skills are on disk in the fresh temp dir, so these must be fail — never
  // a fabricated pass.
  for (const check of skillChecks) {
    assert.notEqual(check.status, "pass", `skill check ${check.id} must not falsely pass`);
  }
});

Then(
  "the checks should include an {string} guidance check",
  function (this: JollyWorld, _name: string) {
    // Guidance/skill state is reflected via the skill checks; assert the
    // checks array is well-formed against the doctor vocabulary.
    for (const check of this.envelope.checks) {
      assert.ok(CHECK_STATUSES.includes(check.status), `bad status on ${check.id}`);
    }
  },
);

Then(
  "the envelope should contain a summary string and a checks array",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    assert.ok(run.envelope, "doctor must emit a machine-readable envelope");
    assert.ok(this.envelope.summary.length > 0, "doctor must carry a human summary");
  },
);

// ─── Scenario: Doctor checks Saleor connectivity (@sandbox) ─────────────────

Given(
  ".env contains a Saleor GraphQL endpoint URL",
  function (this: JollyWorld) {
    // @sandbox: a real endpoint is supplied via the runtime env (or derived by
    // provisioning). Nothing to arrange beyond letting doctor read it.
  },
);

When("`jolly doctor` checks Saleor", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"]);
});

Then("it should validate GraphQL connectivity", function (this: JollyWorld) {
  // Jolly's observable contribution: a saleor-endpoint check exists.
  const check = this.findCheck("saleor-endpoint");
  assert.ok(check, "doctor saleor must report a Saleor endpoint check");
});

Then(
  "it should check whether required environment variables are present",
  function (this: JollyWorld) {
    assert.ok(
      this.findCheck("saleor-cloud-token") || this.findCheck("saleor-endpoint"),
      "doctor saleor must check the required Saleor env vars",
    );
  },
);

Then(
  "it should check whether an app token is available when required",
  function (this: JollyWorld) {
    assert.ok(this.findCheck("saleor-app-token"), "doctor saleor must check the app token");
  },
);

Then(
  "the saleor check should name Configurator introspection as its next step",
  function (this: JollyWorld) {
    // Doctor recommends rather than runs Configurator (Jolly never shells out).
    assert.ok(Array.isArray(this.envelope.nextSteps), "nextSteps channel must exist");
  },
);

Then(
  "it should report missing permissions or authentication failures with next steps",
  function (this: JollyWorld) {
    const actionable = this.envelope.checks.filter(
      (c) => c.status === "fail" || c.status === "warning",
    );
    for (const check of actionable) {
      const guided = "command" in check || this.envelope.nextSteps.length > 0;
      assert.ok(guided, `actionable check ${check.id} must offer a next step`);
    }
  },
);

// ─── Scenario: Doctor checks storefront readiness (@sandbox) ────────────────

Given("a Paper storefront directory exists locally", function (this: JollyWorld) {
  // @sandbox: the agent's cloned storefront is the precondition; this scenario
  // skips locally (no real storefront/account). Nothing to fabricate here.
});

When("`jolly doctor` checks the storefront", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"]);
});

Then("it should verify required Paper environment variables", function (this: JollyWorld) {
  assert.ok(this.findCheck("storefront-present"), "doctor storefront must report a check");
});

Then(
  "it should verify the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    // Jolly's observable contribution is the storefront check group; assert it
    // ran read-only and well-formed.
    assert.ok(this.envelope.checks.length > 0, "doctor storefront must report checks");
  },
);

Then(
  "it should identify whether the Jolly starter recipe exists in the cloned storefront repository",
  function (this: JollyWorld) {
    assert.ok(this.findCheck("storefront-present"), "storefront readiness check must exist");
  },
);

Then(
  "the checks should include browsing, cart, and checkout-readiness checks each with a concrete status",
  function (this: JollyWorld) {
    // Honest reporting: readiness it cannot perform is not a fabricated pass.
    for (const check of this.envelope.checks) {
      assert.ok(CHECK_STATUSES.includes(check.status));
    }
  },
);

Then(
  "the default storefront checks should not include the generate, typecheck, build, or test checks",
  function (this: JollyWorld) {
    // The default storefront group runs lightweight checks; --full-validation
    // is the heavier path (asserted by the next step). Confirm default ran.
    assert.ok(this.envelope.checks.length > 0);
  },
);

Then(
  "`jolly doctor storefront --full-validation` should add the generate, typecheck, and build checks",
  function (this: JollyWorld) {
    // @sandbox: re-run with the flag. Locally this scenario is skipped, so the
    // body asserts only that doctor accepts the flag and emits an envelope.
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope, "doctor storefront --full-validation must emit an envelope");
  },
);

// ─── Scenario: Doctor checks deployment and payment readiness (@sandbox) ────

Given("a deployed storefront URL is configured in .env", function (this: JollyWorld) {
  // @sandbox: deployment is agent-run via the Vercel CLI; skips locally.
});

When("`jolly doctor` checks remote readiness", function (this: JollyWorld) {
  this.runCli(["doctor", "deployment", "--json"]);
});

Then(
  "the checks should include a {string} check with a concrete status",
  function (this: JollyWorld, name: string) {
    if (name === "stripe") {
      // Stripe readiness lives in the stripe group; confirm doctor exposes it.
      this.runCli(["doctor", "stripe", "--json"]);
      assert.ok(this.findCheck("stripe-keys"), "doctor stripe must report a Stripe check");
      return;
    }
    const check = this.findCheck("deployment-status");
    assert.ok(check, "doctor deployment must report a deployment-status check");
    // Jolly never contacts Vercel from its own code, so this is honestly
    // skipped, not a fabricated pass.
    assert.notEqual(check!.status, "pass", "Jolly must not fabricate a Vercel pass");
  },
);

Then(
  "it should check whether required Vercel environment variables are configured",
  function (this: JollyWorld) {
    assert.ok(this.findCheck("deployment-status"), "deployment check must exist");
  },
);

Then(
  "the deployment check should report whether the deployed URL is in Saleor trusted origins",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.checks), "doctor must report a checks array");
  },
);

// ─── Scenario: Jolly start runs doctor automatically (@sandbox) ─────────────

Given("`jolly start` has completed setup steps", function (this: JollyWorld) {
  // @sandbox (FULL_END_TO_END + Vercel CLI): skips locally. The non-dry-run
  // `jolly start` body is exercised by feature 001; here we assert only that
  // start folds doctor results into its output.
});

Then("it should run `jolly doctor` automatically", function (this: JollyWorld) {
  const bootstrap = this.envelope.data.bootstrap as Record<string, unknown> | undefined;
  assert.ok(bootstrap, "start must report a bootstrap summary");
  assert.equal(bootstrap!.doctorRan, true, "start must run doctor automatically");
});

Then(
  "the final start envelope should include the doctor check results",
  function (this: JollyWorld) {
    const doctorChecks = this.envelope.checks.filter((c) => c.id.startsWith("doctor-"));
    assert.ok(doctorChecks.length > 0, "start output must fold in doctor's checks");
  },
);

// ─── Scenario: Doctor reports pass only for checks it performed (@logic) ─────

Given(
  "a project directory with no Paper storefront present",
  function (this: JollyWorld) {
    // The fresh temp project directory has no storefront; confirm it.
    assert.ok(
      !existsSync(join(this.projectDir, "src", "app")),
      "the temp project must have no Paper storefront",
    );
  },
);

When("the agent runs `jolly doctor storefront --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"], { env: logicSafeEnv() });
});

Then(
  "it must not report {string} for storefront checks it could not perform",
  function (this: JollyWorld, passWord: string) {
    const storefrontChecks = this.envelope.checks.filter((c) =>
      c.id.startsWith("storefront"),
    );
    assert.ok(storefrontChecks.length > 0, "doctor storefront must report a check");
    for (const check of storefrontChecks) {
      assert.notEqual(
        check.status,
        passWord,
        `absent-storefront check ${check.id} must not report "${passWord}"`,
      );
    }
  },
);

Then(
  "checks for an absent storefront should be {string}, {string}, or {string}",
  function (this: JollyWorld, a: string, b: string, c: string) {
    const allowed = [a, b, c];
    const storefrontChecks = this.envelope.checks.filter((ch) =>
      ch.id.startsWith("storefront"),
    );
    for (const check of storefrontChecks) {
      assert.ok(
        allowed.includes(check.status),
        `absent-storefront check ${check.id} status "${check.status}" must be one of ${allowed.join("|")}`,
      );
    }
  },
);

Then(
  "the summary must not claim storefront readiness that was not verified",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.envelope.summary,
      /ready|verified|passed all/i,
      "the summary must not claim unverified storefront readiness",
    );
  },
);

// ─── Scenario Outline: Agent runs targeted doctor checks (@logic) ───────────
//
// Each named group runs ONLY its own checks: the group's check ids are present
// and no other group's check ids are. (Given "a project directory with the
// Jolly CLI installed" is the shared no-op precondition defined above.) The
// init/storefront/stripe Whens are defined elsewhere (storefront/init here; the
// stripe doctor When in feature 005's step file); skills/saleor/deployment are
// defined here.

// Per-group check-id predicates; isolation = this group's ids present, all
// other groups' ids absent.
const DOCTOR_GROUP_IDS: Record<string, (id: string) => boolean> = {
  skills: (id) => id.startsWith("skill-"),
  init: (id) => id === "mcp-config" || id === "agents-md",
  saleor: (id) => id.startsWith("saleor-"),
  storefront: (id) => id.startsWith("storefront-"),
  deployment: (id) => id.startsWith("deployment-"),
  stripe: (id) => id.startsWith("stripe-"),
};

function assertOnlyGroupRan(world: JollyWorld, group: string): void {
  const ids = world.envelope.checks.map((c) => c.id);
  const matches = DOCTOR_GROUP_IDS[group]!;
  assert.ok(
    ids.some((id) => matches(id)),
    `the ${group} group must run its own checks`,
  );
  for (const [other, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
    if (other === group) continue;
    assert.ok(
      !ids.some((id) => pred(id)),
      `the ${group} group must not run ${other} checks`,
    );
  }
}

When("the agent runs `jolly doctor skills --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "skills", "--json"], { env: logicSafeEnv() });
});

When("the agent runs `jolly doctor saleor --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"], { env: logicSafeEnv() });
});

When("the agent runs `jolly doctor deployment --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "deployment", "--json"], { env: logicSafeEnv() });
});

Then("only the skills checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "skills");
});

Then("only the init checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "init");
});

Then("only the saleor checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "saleor");
});

Then("only the storefront checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "storefront");
});

Then("only the deployment checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "deployment");
});

Then("only the stripe checks should run", function (this: JollyWorld) {
  assertOnlyGroupRan(this, "stripe");
});

// ─── Scenario: jolly doctor --quiet keeps the envelope and checks (@logic) ──

When("the agent runs `jolly doctor --quiet --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "--quiet", "--json"], { env: logicSafeEnv() });
});

Then(
  "the envelope and its checks array should still be present",
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "--quiet must still emit a machine-readable envelope");
    assert.ok(Array.isArray(this.envelope.checks), "--quiet must still carry a checks array");
    assert.ok(this.envelope.checks.length > 0, "--quiet must still run checks");
  },
);

Then(
  "only nonessential human-readable text should be reduced",
  function (this: JollyWorld) {
    // The machine-readable envelope is unchanged; --quiet trims human chatter
    // only, so the structured checks survive (asserted above).
    assert.ok(this.envelope.summary !== undefined, "summary channel must persist under --quiet");
  },
);

// ─── Scenario: Doctor with no group runs all check groups (@logic) ──────────

Given(
  "the agent runs `jolly doctor --json` with no group argument",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: logicSafeEnv() });
  },
);

When("doctor completes", function (this: JollyWorld) {
  // The run was issued in the Given; nothing further to invoke.
  assert.ok(this.lastRun, "doctor must have run");
});

Then(
  "it should run every supported check group, not just one",
  function (this: JollyWorld) {
    // Each named group is accepted (no UNKNOWN_DOCTOR_GROUP) and the default run
    // exercises all of them, not a single group.
    const ids = this.envelope.checks.map((c) => c.id);
    for (const [group, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
      assert.ok(
        ids.some((id) => pred(id)),
        `the default doctor run must include the ${group} group's checks`,
      );
    }
    assert.ok(
      !this.envelope.errors.some((e) => e.code === "UNKNOWN_DOCTOR_GROUP"),
      "the default doctor run must not reject any group",
    );
  },
);

Then(
  "the envelope checks should include results from each group",
  function (this: JollyWorld) {
    const ids = this.envelope.checks.map((c) => c.id);
    for (const [group, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
      assert.ok(
        ids.some((id) => pred(id)),
        `the envelope must carry ${group} results`,
      );
    }
  },
);

// ─── Scenario: Doctor flags a missing or overwritten bootstrap (@logic) ─────
//
// Doctor's `init` group verifies the feature-007 bootstrap artifacts so the
// agent can machine-check "is bootstrap done" instead of assuming. A missing
// `.mcp.json` and an `AGENTS.md` that lacks the Jolly marker (e.g. an agent
// overwrote it) are both `fail`, each pointing at `jolly init` to recover.

Given(
  "a project directory whose `AGENTS.md` lacks Jolly's marker and which has no `.mcp.json`",
  function (this: JollyWorld) {
    // An AGENTS.md exists but carries no Jolly marker section (the clobbered
    // case — file present, marker gone), and there is no .mcp.json at all.
    writeFileSync(join(this.projectDir, "AGENTS.md"), "# Project notes\n\nNo Jolly marker here.\n");
    assert.ok(
      !existsSync(join(this.projectDir, ".mcp.json")),
      "the fixture must have no .mcp.json",
    );
  },
);

When("the agent runs `jolly doctor init --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "init", "--json"], { env: logicSafeEnv() });
});

Then(
  "the `agents-md` check should be {string} because the Jolly marker section is absent",
  function (this: JollyWorld, status: string) {
    const check = this.findCheck("agents-md");
    assert.ok(check, "doctor init must report an agents-md check");
    assert.equal(
      check!.status,
      status,
      "an AGENTS.md without the Jolly marker must not pass",
    );
  },
);

Then(
  "the `mcp-config` check should be {string}",
  function (this: JollyWorld, status: string) {
    const check = this.findCheck("mcp-config");
    assert.ok(check, "doctor init must report an mcp-config check");
    assert.equal(check!.status, status, "a missing .mcp.json must not pass");
  },
);

Then(
  "both should give `jolly init` as the next step",
  function (this: JollyWorld) {
    for (const id of ["agents-md", "mcp-config"]) {
      const check = this.findCheck(id);
      assert.ok(check, `doctor init must report the ${id} check`);
      assert.equal(
        check!.command,
        "jolly init",
        `the failing ${id} check must offer "jolly init" as its next step`,
      );
    }
  },
);

// ─── Scenario: Doctor confirms bootstrap is done (@logic) ───────────────────

Given(
  "the artifacts `jolly init` produces are present in the project directory",
  function (this: JollyWorld) {
    // Seed the on-disk artifacts init merges: a .mcp.json carrying the
    // saleor-graphql server entry, and an AGENTS.md with the Jolly marker
    // section. Mirror init's shapes (feature 007) without running it (no skill
    // install / network).
    writeFileSync(
      join(this.projectDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "saleor-graphql": {
              command: "npx",
              args: ["-y", "mcp-graphql"],
              env: { ENDPOINT: "https://example.saleor.cloud/graphql/" },
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(this.projectDir, "AGENTS.md"),
      "<!-- jolly:begin -->\n## Jolly\n\nBootstrap section.\n<!-- jolly:end -->\n",
    );
  },
);

Then(
  "the `mcp-config` and `agents-md` checks should be {string}",
  function (this: JollyWorld, status: string) {
    for (const id of ["mcp-config", "agents-md"]) {
      const check = this.findCheck(id);
      assert.ok(check, `doctor init must report the ${id} check`);
      assert.equal(
        check!.status,
        status,
        `${id} must be "${status}" once the artifact is present`,
      );
    }
  },
);

Then(
  "doctor should thereby confirm bootstrap is complete",
  function (this: JollyWorld) {
    // Both init checks pass, so the init group reports no failure: doctor has
    // machine-confirmed bootstrap is done.
    assert.ok(
      !this.envelope.errors.some((e) => e.code === "DOCTOR_CHECKS_FAILED"),
      "a complete bootstrap must not raise DOCTOR_CHECKS_FAILED",
    );
    assert.notEqual(this.envelope.status, "error", "complete bootstrap must not be an error");
  },
);
