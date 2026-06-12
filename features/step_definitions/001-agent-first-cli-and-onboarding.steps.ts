// Step definitions for feature 001: agent-first Jolly onboarding and CLI.
//
// Lean by design: the feature's only executable scenario is the @sandbox
// "Jolly start completes successfully" end-to-end run (FULL_END_TO_END
// credentials; the homepage/setup-guide scenarios were retired when
// homepage/ became a Captain-owned asset outside the spec/test loop).
//
// CLI contract pinned by these steps (for Crew Mates):
//   jolly start --json — runs the full setup flow; the final success
//   envelope must carry key URLs in data, run jolly doctor automatically
//   and include its results as data.doctor.checks (feature 014), and give
//   nextSteps guidance toward customizing the storefront with the
//   customer's own agent. Secrets are referenced by name, never printed.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { CHECK_STATUSES } from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

Given(
  "`jolly start` has completed the end-to-end setup flow",
  { timeout: 900_000 },
  function (this: JollyWorld) {
    // The end-to-end flow provisions real resources (Saleor environment,
    // storefront, Vercel deploy, Stripe test config) — generous timeout.
    this.runCli(["start", "--json"], { timeoutMs: 840_000 });
    assert.equal(
      this.envelope.status,
      "success",
      `jolly start should complete successfully: ${this.envelope.summary}\n${JSON.stringify(this.envelope.errors)}`,
    );
  },
);

When("Jolly prints the final success output", function (this: JollyWorld) {
  // Already captured by runCli; the Then steps inspect it.
  assert.ok(this.lastRun, "jolly start must have run");
});

Then(
  "it should include a concise human-readable summary",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.summary.trim().length > 0,
      "envelope.summary should be a non-empty human-readable summary",
    );
  },
);

Then(
  "it should include machine-readable JSON or report data for the customer's agent on stdout",
  function (this: JollyWorld) {
    // findEnvelope + assertEnvelopeShape (via world.envelope) already proved
    // a valid machine-readable envelope is on stdout.
    assert.ok(this.lastRun!.envelope, "stdout should carry the JSON envelope");
    assert.ok(
      typeof this.envelope.data === "object" && this.envelope.data !== null,
      "the envelope should carry a data report object",
    );
  },
);

Then(
  "it should include key URLs and status values",
  function (this: JollyWorld) {
    const serialized = JSON.stringify(this.envelope.data);
    assert.match(
      serialized,
      /https?:\/\//,
      `envelope.data should include key URLs (store/storefront/deployment): ${serialized}`,
    );
    assert.ok(
      this.envelope.checks.length > 0,
      "envelope.checks should carry status values for the setup stages",
    );
  },
);

Then(
  "it should include final verification results from an automatic `jolly doctor` run",
  function (this: JollyWorld) {
    const doctor = this.envelope.data.doctor as
      | Record<string, unknown>
      | undefined;
    assert.ok(
      doctor && Array.isArray(doctor.checks),
      `envelope.data.doctor.checks should carry the automatic doctor results: ${JSON.stringify(this.envelope.data)}`,
    );
    for (const check of doctor.checks as Array<Record<string, unknown>>) {
      assert.ok(
        typeof check.id === "string" && (check.id as string).length > 0,
        `doctor check missing stable id: ${JSON.stringify(check)}`,
      );
      assert.ok(
        (CHECK_STATUSES as readonly string[]).includes(String(check.status)),
        `doctor check "${check.id}" has invalid status "${check.status}"`,
      );
    }
  },
);

Then(
  "it should include next-step guidance for customizing the storefront with the customer's own agent and workflow",
  function (this: JollyWorld) {
    const steps = this.envelope.nextSteps.map((step) =>
      String(step.description ?? ""),
    );
    assert.ok(steps.length > 0, "envelope.nextSteps should not be empty");
    assert.ok(
      steps.some((text) => /custom|storefront|agent|iterat/i.test(text)),
      `nextSteps should guide toward customizing the storefront with the customer's own agent: ${JSON.stringify(steps)}`,
    );
  },
);

Then("it should avoid printing secret values", function (this: JollyWorld) {
  this.assertNoSecretsIn(
    this.lastRun!.stdout + this.lastRun!.stderr,
    "jolly start final output",
  );
});
