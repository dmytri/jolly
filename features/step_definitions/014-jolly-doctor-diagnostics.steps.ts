// Steps for features/014-jolly-doctor-diagnostics.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

const CLONE_TIMEOUT_MS = 900_000;
const DOCTOR_GROUPS = ["skills", "saleor", "storefront", "deployment", "stripe"];

// --- Agent runs doctor during setup (@logic) -----------------------------------

Given("the agent is setting up a Jolly storefront", function (this: JollyWorld) {
  // Context only.
});

When("it invokes `jolly doctor`", function (this: JollyWorld) {
  this.notes.defaultRun = this.runCli(["doctor"]);
  this.runCli(["doctor", "--json"]);
});

Then(
  "Jolly should check local Jolly CLI availability and version",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) => /^cli\./.test(String(c.id)));
    assert.ok(check, "doctor reports no CLI availability/version check");
  },
);

Then("it should check skill installation status", function (this: JollyWorld) {
  assert.ok(
    this.envelope.checks.some((c) => /skill/i.test(String(c.id))),
    "doctor reports no skill installation check",
  );
});

Then(
  "it should check supported agent guidance status where possible",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /guidance|agent/i.test(String(c.id))),
      "doctor reports no agent guidance check",
    );
  },
);

Then(
  "it should summarize findings in concise human text plus machine-readable output",
  function (this: JollyWorld) {
    const defaultRun = this.notes.defaultRun as { stdout: string; envelope?: unknown };
    assert.ok(defaultRun.envelope, "default doctor output has no machine-readable envelope");
    const humanText = defaultRun.stdout.replace(/\{[\s\S]*\}/, "").trim();
    assert.ok(humanText.length > 0, "default doctor output has no human text");
    assert.ok(this.envelope.summary.trim().length > 0, "doctor has no summary");
  },
);

// --- Doctor checks Saleor connectivity (@sandbox) -------------------------------

Given(
  "Jolly has or can infer a Saleor GraphQL endpoint",
  function (this: JollyWorld) {
    assert.ok(process.env.NEXT_PUBLIC_SALEOR_API_URL, "no Saleor endpoint configured");
  },
);

When("`jolly doctor` checks Saleor", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"]);
});

Then("it should validate GraphQL connectivity", function (this: JollyWorld) {
  const check = this.findCheck("saleor.connectivity");
  assert.ok(check, "no saleor connectivity check");
  assert.equal(
    check!.status,
    "pass",
    `live GraphQL connectivity was not validated: ${JSON.stringify(check)}`,
  );
});

Then(
  "it should check whether required environment variables are present",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /env/i.test(String(c.id))),
      "doctor reports no environment-variable check",
    );
  },
);

Then(
  "it should check whether an app token is available when required",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /token/i.test(String(c.id))),
      "doctor reports no app-token check",
    );
  },
);

Then(
  "it should run or recommend Configurator introspection where appropriate",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) =>
      /introspect/i.test(String(c.id)),
    );
    assert.ok(
      check ||
        /introspect/i.test(JSON.stringify(this.envelope.nextSteps)),
      "doctor neither runs nor recommends Configurator introspection",
    );
  },
);

Then(
  "it should report missing permissions or authentication failures with next steps",
  function (this: JollyWorld) {
    for (const check of this.envelope.checks) {
      if (
        /token|auth|permission/i.test(String(check.id)) &&
        (check.status === "fail" || check.status === "warning")
      ) {
        assert.ok(
          check.remediation || this.envelope.nextSteps.length > 0,
          `auth-related check ${check.id} fails without next steps`,
        );
      }
    }
  },
);

// --- Doctor checks storefront readiness (@sandbox) ------------------------------

Given(
  "a Paper storefront exists locally",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    assert.notEqual(result.envelope?.status, "error", "no local Paper storefront");
  },
);

When("`jolly doctor` checks the storefront", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"]);
});

Then(
  "it should verify required Paper environment variables",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /env/i.test(String(c.id))),
      "doctor storefront reports no Paper environment-variable check",
    );
  },
);

Then(
  "it should verify the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /node/i.test(String(c.id))),
      "doctor storefront reports no Node.js version check",
    );
  },
);

Then(
  "it should identify whether the Jolly starter recipe exists in the cloned storefront repository",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /recipe/i.test(String(c.id))),
      "doctor storefront reports no starter-recipe check",
    );
  },
);

Then(
  "it should report whether product browsing, cart, and checkout readiness checks can be performed",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /browsing|cart|checkout/i,
      "doctor storefront does not report browsing/cart/checkout readiness",
    );
  },
);

Then(
  "it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /full[- ]?validation|generate|typecheck|build/i,
      "lightweight vs full validation is not distinguished",
    );
  },
);

Then(
  "`jolly doctor storefront --full-validation` should run full storefront validation checks where feasible",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const result = this.runCli(
      ["doctor", "storefront", "--full-validation", "--json"],
      { timeoutMs: CLONE_TIMEOUT_MS },
    );
    assert.ok(result.envelope, "--full-validation emitted no envelope");
    assert.doesNotMatch(
      JSON.stringify(result.envelope.errors),
      /unknown (flag|option)/i,
      "--full-validation is not a recognized flag",
    );
  },
);

// --- Doctor checks deployment and payment readiness (@sandbox) ------------------

Given("the storefront may be deployed", function (this: JollyWorld) {
  // Context only.
});

When("`jolly doctor` checks remote readiness", function (this: JollyWorld) {
  this.runCli(["doctor", "--json"]);
});

Then(
  "it should check Vercel deployment configuration where credentials or context allow",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) =>
      /deployment|vercel/i.test(String(c.id)),
    );
    assert.ok(check, "doctor reports no Vercel deployment check");
    assert.notEqual(
      check!.status,
      "skipped",
      "Vercel deployment was not checked despite credentials being configured",
    );
  },
);

Then(
  "it should check whether required Vercel environment variables are configured",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /vercel.*env|env.*vercel|NEXT_PUBLIC_SALEOR_API_URL/i,
      "doctor does not check Vercel environment variables",
    );
  },
);

Then(
  "it should check whether Saleor trusted origins include the deployed storefront URL where possible",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /origin/i,
      "doctor does not check Saleor trusted origins",
    );
  },
);

Then(
  "it should check Stripe test-mode setup status where possible",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /stripe/i.test(String(c.id))),
      "doctor reports no Stripe test-mode check",
    );
  },
);

// --- Jolly start runs doctor automatically (@sandbox) ---------------------------

Given(
  "`jolly start` has completed setup steps",
  { timeout: 1_800_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["start", "--yes", "--json"], {
      timeoutMs: 1_740_000,
    });
    assert.notEqual(result.envelope?.status, "error", result.stdout);
  },
);

When("it performs final verification", function (this: JollyWorld) {
  assert.ok(this.lastRun, "no `jolly start` run captured");
});

Then("it should run `jolly doctor` automatically", function (this: JollyWorld) {
  assert.ok(
    this.envelope.checks.length > 0,
    "`jolly start` output carries no automatic doctor checks",
  );
});

Then(
  "it should include doctor results in the final `jolly start` output",
  function (this: JollyWorld) {
    // checks[] uses the doctor vocabulary; envelope shape validation enforces it.
    assert.ok(this.envelope.checks.length > 0);
  },
);

// --- Agent runs targeted doctor checks (@logic) ----------------------------------

Given("the agent needs to diagnose a specific area", function (this: JollyWorld) {
  // Context only.
});

When("it invokes a named `jolly doctor` check group", function (this: JollyWorld) {
  this.runCli(["doctor", "skills", "--json"]);
});

Then(
  "Jolly should run only the relevant checks for that group",
  function (this: JollyWorld) {
    assert.ok(this.envelope.checks.length > 0, "the named group ran no checks");
    for (const check of this.envelope.checks) {
      assert.match(
        String(check.id),
        /skill/i,
        `doctor skills ran an unrelated check: ${check.id}`,
      );
    }
  },
);

Then(
  "supported v1 groups should include skills, saleor, storefront, deployment, and stripe",
  function (this: JollyWorld) {
    for (const group of DOCTOR_GROUPS) {
      const result = this.runCli(["doctor", group, "--json"]);
      assert.ok(result.envelope, `doctor ${group} emitted no envelope`);
      assert.doesNotMatch(
        JSON.stringify(result.envelope.errors),
        /unknown (group|check)/i,
        `doctor group ${group} is not supported`,
      );
    }
  },
);
