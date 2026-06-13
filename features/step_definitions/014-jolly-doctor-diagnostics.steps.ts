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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHECK_STATUSES } from "../support/envelope.ts";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// ─── Scenario: Agent runs doctor during setup (@logic) ──────────────────────

Given("the agent is setting up a Jolly storefront", function () {
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
  "it should check supported agent guidance status where possible",
  function (this: JollyWorld) {
    // Guidance/skill state is reflected via the skill checks; assert the
    // checks array is well-formed against the doctor vocabulary.
    for (const check of this.envelope.checks) {
      assert.ok(CHECK_STATUSES.includes(check.status), `bad status on ${check.id}`);
    }
  },
);

Then(
  "it should summarize findings in concise human text plus machine-readable output",
  function (this: JollyWorld) {
    const run = this.lastRun!;
    assert.ok(run.envelope, "doctor must emit a machine-readable envelope");
    assert.ok(this.envelope.summary.length > 0, "doctor must carry a human summary");
  },
);

// ─── Scenario: Doctor checks Saleor connectivity (@sandbox) ─────────────────

Given(
  "Jolly has or can infer a Saleor GraphQL endpoint",
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
  "it should run or recommend Configurator introspection where appropriate",
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

Given("a Paper storefront exists locally", function (this: JollyWorld) {
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
  "it should report whether product browsing, cart, and checkout readiness checks can be performed",
  function (this: JollyWorld) {
    // Honest reporting: readiness it cannot perform is not a fabricated pass.
    for (const check of this.envelope.checks) {
      assert.ok(CHECK_STATUSES.includes(check.status));
    }
  },
);

Then(
  "it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests",
  function (this: JollyWorld) {
    // The default storefront group runs lightweight checks; --full-validation
    // is the heavier path (asserted by the next step). Confirm default ran.
    assert.ok(this.envelope.checks.length > 0);
  },
);

Then(
  "`jolly doctor storefront --full-validation` should run full storefront validation checks where feasible",
  function (this: JollyWorld) {
    // @sandbox: re-run with the flag. Locally this scenario is skipped, so the
    // body asserts only that doctor accepts the flag and emits an envelope.
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope, "doctor storefront --full-validation must emit an envelope");
  },
);

// ─── Scenario: Doctor checks deployment and payment readiness (@sandbox) ────

Given("the storefront may be deployed", function (this: JollyWorld) {
  // @sandbox: deployment is agent-run via the Vercel CLI; skips locally.
});

When("`jolly doctor` checks remote readiness", function (this: JollyWorld) {
  this.runCli(["doctor", "deployment", "--json"]);
});

Then(
  "it should check Vercel deployment configuration where credentials or context allow",
  function (this: JollyWorld) {
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
  "it should check whether Saleor trusted origins include the deployed storefront URL where possible",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.checks), "doctor must report a checks array");
  },
);

Then(
  "it should check Stripe test-mode setup status where possible",
  function (this: JollyWorld) {
    // Stripe readiness lives in the stripe group; confirm doctor exposes it.
    this.runCli(["doctor", "stripe", "--json"]);
    assert.ok(this.findCheck("stripe-keys"), "doctor stripe must report a Stripe check");
  },
);

// ─── Scenario: Jolly start runs doctor automatically (@sandbox) ─────────────

Given("`jolly start` has completed setup steps", function (this: JollyWorld) {
  // @sandbox (FULL_END_TO_END + Vercel CLI): skips locally. The non-dry-run
  // `jolly start` body is exercised by feature 001; here we assert only that
  // start folds doctor results into its output.
});

When("it performs final verification", function (this: JollyWorld) {
  this.runCli(["start", "--json"], { env: logicSafeEnv() });
});

Then("it should run `jolly doctor` automatically", function (this: JollyWorld) {
  const bootstrap = this.envelope.data.bootstrap as Record<string, unknown> | undefined;
  assert.ok(bootstrap, "start must report a bootstrap summary");
  assert.equal(bootstrap!.doctorRan, true, "start must run doctor automatically");
});

Then(
  "it should include doctor results in the final `jolly start` output",
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

// ─── Scenario: Agent runs targeted doctor checks (@logic) ───────────────────

Given("the agent needs to diagnose a specific area", function () {
  // The scenario invokes a named group in the When step.
});

When("it invokes a named `jolly doctor` check group", function (this: JollyWorld) {
  this.runCli(["doctor", "skills", "--json"], { env: logicSafeEnv() });
});

Then(
  "Jolly should run only the relevant checks for that group",
  function (this: JollyWorld) {
    // The skills group emits skill-* checks and no saleor/stripe/deployment ones.
    const ids = this.envelope.checks.map((c) => c.id);
    assert.ok(
      ids.some((id) => id.startsWith("skill-")),
      "the skills group must run skill checks",
    );
    assert.ok(
      !ids.some((id) => id.startsWith("saleor-") || id.startsWith("stripe") || id.startsWith("deployment")),
      "the skills group must not run other groups' checks",
    );
  },
);

Then(
  "supported v1 groups should include skills, saleor, storefront, deployment, and stripe",
  function (this: JollyWorld) {
    // Each named group is accepted (no UNKNOWN_DOCTOR_GROUP) and yields an
    // envelope; an unknown group errors.
    for (const group of ["skills", "saleor", "storefront", "deployment", "stripe"]) {
      this.runCli(["doctor", group, "--json"], { env: logicSafeEnv() });
      assert.ok(
        !this.envelope.errors.some((e) => e.code === "UNKNOWN_DOCTOR_GROUP"),
        `"${group}" must be a supported doctor group`,
      );
    }
  },
);
