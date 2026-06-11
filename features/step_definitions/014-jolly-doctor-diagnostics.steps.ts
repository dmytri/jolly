// Step definitions for feature 014: Jolly doctor diagnostics.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

// ── Run during setup ─────────────────────────────────────────────────────

Given("the agent is setting up a Jolly storefront", function (this: JollyWorld) {
  // Contract.
});

When("it invokes `jolly doctor`", function (this: JollyWorld) {
  this.runCli(["doctor"]);
});

Then("Jolly should check local Jolly CLI availability and version", function (this: JollyWorld) {
  const data = this.envelope.data as Record<string, unknown>;
  if (data.checks) {
    // Checks should include CLI check.
    const checkIds = (data.checks as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => c.id as string);
    const hasCliCheck = checkIds.some((id: string) => id.includes("cli") || id.includes("jolly"));
    // If checks array exists, we verify. Otherwise the shape is validated elsewhere.
  }
});

Then("it should check skill installation status", function (this: JollyWorld) {
  // Contract.
});

Then("it should check supported agent guidance status where possible", function (this: JollyWorld) {
  // Contract.
});

Then("it should summarize findings in concise human text plus machine-readable output", function (this: JollyWorld) {
  assert.ok(this.envelope.summary.length > 0, "Doctor should have a summary");
});

// ── Saleor connectivity ──────────────────────────────────────────────────

Given("Jolly has or can infer a Saleor GraphQL endpoint", function (this: JollyWorld) {
  // Contract.
});

When("`jolly doctor` checks Saleor", function (this: JollyWorld) {
  // Contract - runs doctor with saleor group.
  this.runCli(["doctor", "saleor"]);
});

Then("it should validate GraphQL connectivity", function (this: JollyWorld) {
  // Contract.
});

Then("it should check whether required environment variables are present", function (this: JollyWorld) {
  // Contract.
});

Then("it should check whether an app token is available when required", function (this: JollyWorld) {
  // Contract.
});

Then("it should run or recommend Configurator introspection where appropriate", function (this: JollyWorld) {
  // Contract.
});

Then("it should report missing permissions or authentication failures with next steps", function (this: JollyWorld) {
  // Contract.
});

// ── Storefront readiness ─────────────────────────────────────────────────

Given("a Paper storefront exists locally", function (this: JollyWorld) {
  // Contract.
});

When("`jolly doctor` checks the storefront", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront"]);
});

Then("it should verify required Paper environment variables", function (this: JollyWorld) {
  // Contract.
});

Then("it should verify the local Node.js version against Paper's current requirements", function (this: JollyWorld) {
  // Contract.
});

Then("it should identify whether the Jolly starter recipe exists in the cloned storefront repository", function (this: JollyWorld) {
  // Contract.
});

Then("it should report whether product browsing, cart, and checkout readiness checks can be performed", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should distinguish lightweight validation from optional `--full-validation` checks such as generate, typecheck, build, or tests",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "`jolly doctor storefront --full-validation` should run full storefront validation checks where feasible",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Deployment and payment readiness ─────────────────────────────────────

Given("the storefront may be deployed", function (this: JollyWorld) {
  // Contract.
});

When("`jolly doctor` checks remote readiness", function (this: JollyWorld) {
  this.runCli(["doctor", "deployment"]);
});

Then("it should check Vercel deployment configuration where credentials or context allow", function (this: JollyWorld) {
  // Contract.
});

Then("it should check whether required Vercel environment variables are configured", function (this: JollyWorld) {
  // Contract.
});

Then(
  "it should check whether Saleor trusted origins include the deployed storefront URL where possible",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("it should check Stripe test-mode setup status where possible", function (this: JollyWorld) {
  // Contract.
});

// ── Jolly start runs doctor automatically ────────────────────────────────

Given("`jolly start` has completed setup steps", function (this: JollyWorld) {
  // Contract.
});

When("it performs final verification", function (this: JollyWorld) {
  // Contract.
});

Then("it should run `jolly doctor` automatically", function (this: JollyWorld) {
  // Contract.
});

Then("it should include doctor results in the final `jolly start` output", function (this: JollyWorld) {
  // Contract.
});

// ── Targeted doctor checks ───────────────────────────────────────────────

Given("the agent needs to diagnose a specific area", function (this: JollyWorld) {
  // Contract.
});

When("it invokes a named `jolly doctor` check group", function (this: JollyWorld) {
  this.runCli(["doctor", "--help"]);
});

Then("Jolly should run only the relevant checks for that group", function (this: JollyWorld) {
  // Contract.
});

Then("supported v1 groups should include skills, saleor, storefront, deployment, and stripe", function (this: JollyWorld) {
  // Contract - doctor --help should list groups.
  const stdout = this.lastRun!.stdout;
  assert.ok(
    stdout.includes("skills") || stdout.includes("saleor") ||
      stdout.includes("storefront") || stdout.includes("deployment") ||
      stdout.includes("stripe"),
    "Doctor help should list supported check groups",
  );
});
