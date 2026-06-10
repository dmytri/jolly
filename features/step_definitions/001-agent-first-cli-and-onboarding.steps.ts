// Steps for features/001-agent-first-cli-and-onboarding.feature.
//
// Scenarios 1-3 (@logic) assert the durable artifacts that drive agent
// behavior: the homepage copy box, its prompt, and the setup guide. Where the
// spec says "the agent should X", the testable contract is that the committed
// onboarding content instructs the agent to X. Scenario 4 (@sandbox) asserts
// the final output of a real end-to-end `jolly start`.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import { findCopyBox } from "../support/homepage.ts";
import {
  homepage,
  copyPrompt,
  guideText,
  onboardingText,
  assertPromptMentions,
  assertMentions,
} from "../support/content.ts";
import { sandboxRuntimeEnv, sandboxSecretValues, memoizedRun } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

Given(lit("a customer visits the Jolly homepage"), function () {
  homepage();
});

When(lit("they want to start using Jolly with their agent"), function () {
  // Premise.
});

Then(lit("they should see a prominent copy box"), function () {
  findCopyBox(homepage().document);
});

Then(lit("the copied content should include a URL to Jolly's homepage"), function () {
  assertPromptMentions(
    /https?:\/\/\S+|<[A-Za-z0-9 _-]*url[A-Za-z0-9 _-]*>/i,
    "must include the homepage URL (or its committed placeholder)",
  );
});

Then(lit("the URL should lead the agent to setup instructions"), function () {
  // The linked setup instructions are the committed setup-guide artifact; the
  // prompt must tie its URL to that guide.
  assertPromptMentions(/setup|guide|instructions/i, "URL must be presented as the way to the setup instructions");
  assert.ok(guideText().trim().length > 0, "the setup guide the URL leads to must exist");
});

Then(
  lit("the copied content should tell the agent to read the setup guide, run Jolly via `npx`, use the Jolly CLI to install/manage required skills, and then run `jolly start`"),
  function () {
    assertPromptMentions(/read|guide/i, "must tell the agent to read the setup guide");
    assertPromptMentions(/npx/, "must tell the agent to run Jolly via npx");
    assertPromptMentions(/skills?/i, "must tell the agent to manage skills through the Jolly CLI");
    assertPromptMentions(/jolly start/i, "must tell the agent to run jolly start");
  },
);

Given(lit("the customer pasted the copied setup prompt into their agent"), function () {
  copyPrompt();
});

When(lit("the agent follows the instructions"), function () {
  assert.ok(guideText().trim().length > 0, "the instructions lead to the setup guide, which must exist");
});

Then(lit("the agent should give a brief welcome"), function () {
  assertMentions(onboardingText(), /welcome|greet/i, "onboarding content: must instruct the agent to welcome the customer");
});

Then(lit("the agent should explain Jolly in one or two concise sentences"), function () {
  assertMentions(
    onboardingText(),
    /(one or two|1-2|two concise|brief(ly)?|concise(ly)?).*(sentence|explanation|explain)|explain.*(brief|concise|one or two)/i,
    "onboarding content: must instruct a one-or-two-sentence explanation of Jolly",
  );
});

Then(
  lit("the agent should ask whether the customer already has a Saleor store or wants to register one"),
  function () {
    assertMentions(onboardingText(), /already (have|has)/i, "must instruct asking about an existing store");
    assertMentions(onboardingText(), /register/i, "must instruct offering the register branch");
  },
);

Then(
  lit("the agent should know how to invoke the Jolly CLI via `npx` without requiring a prior global install"),
  function () {
    assertMentions(onboardingText(), /npx/, "must teach npx invocation");
    assertMentions(onboardingText(), /global(ly)? install|no install|without.*install/i, "must note no prior global install is needed");
  },
);

Then(
  lit("the agent should use the Jolly CLI to install and manage Saleor/Jolly skills so Jolly can handle version updates over time"),
  function () {
    assertMentions(onboardingText(), /jolly skills|skills install/i, "must route skill management through the Jolly CLI");
  },
);

Then(lit("the agent should understand that it is the primary interface for Jolly workflows"), function () {
  assertMentions(onboardingText(), /primary/i, "must state the agent is the primary interface/orchestrator");
});

Given(lit("the agent has welcomed the customer"), function () {
  // Premise.
});

When(lit("the agent asks about Saleor store status"), function () {
  assert.ok(onboardingText().trim().length > 0);
});

Then(lit('the customer should be able to choose "I already have a Saleor store"'), function () {
  assertMentions(onboardingText(), /already have a Saleor store/i, "must offer the existing-store choice verbatim");
});

Then(lit('the customer should be able to choose "I want to register a Saleor store"'), function () {
  assertMentions(onboardingText(), /register a Saleor store/i, "must offer the register choice");
});

Then(
  lit("the agent should not proceed to storefront creation until this branch is known"),
  function () {
    assertMentions(
      onboardingText(),
      /(before|until|first|then).{0,160}(storefront|proceed)|(storefront|proceed).{0,160}(after|once|until)/i,
      "must order the store-status question before storefront creation",
    );
  },
);

// --- Scenario: Jolly start completes successfully (@sandbox) -----------------

Given(
  lit("`jolly start` has completed the end-to-end setup flow"),
  { timeout: 1_800_000 },
  async function (this: JollyWorld) {
    const result = await memoizedRun("jolly-start-e2e", () =>
      this.jolly(["start", "--json", "--yes"], { env: sandboxRuntimeEnv(), timeoutMs: 1_500_000 }),
    );
    this.vars.set("startRun", result);
    const envelope = requireEnvelope(result as RunResult);
    assert.equal(envelope.status, "success", `end-to-end start did not succeed: ${envelope.summary}`);
  },
);

When(lit("Jolly prints the final success output"), function (this: JollyWorld) {
  requireEnvelope(this.vars.get("startRun") as RunResult);
});

Then(lit("it should include a concise human-readable summary"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
  assert.ok(envelope.summary.trim().length > 0, "final output must carry a summary");
});

Then(
  lit("it should include machine-readable JSON or report data for the customer's agent on stdout"),
  function (this: JollyWorld) {
    const run = this.vars.get("startRun") as RunResult;
    assert.doesNotThrow(() => JSON.parse(run.stdout), "with --json, stdout must be machine-readable");
  },
);

Then(lit("it should include key URLs and status values"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
  assert.ok(/https?:\/\//.test(JSON.stringify(envelope.data)), "final output must include key URLs");
});

Then(
  lit("it should include final verification results from an automatic `jolly doctor` run"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
    assert.ok(Array.isArray(envelope.checks) && envelope.checks.length > 0, "final output must include doctor checks");
  },
);

Then(
  lit("it should include next-step guidance for customizing the storefront with the customer's own agent and workflow"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("startRun") as RunResult);
    assert.ok((envelope.nextSteps as unknown[]).length > 0, "final output must include nextSteps guidance");
    assert.ok(/customiz|iterat|agent/i.test(JSON.stringify(envelope.nextSteps)), "nextSteps must point at agent-driven customization");
  },
);

Then(lit("it should avoid printing secret values"), function (this: JollyWorld) {
  const run = this.vars.get("startRun") as RunResult;
  for (const secret of sandboxSecretValues()) {
    assert.ok(
      !run.stdout.includes(secret) && !run.stderr.includes(secret),
      "a sandbox secret value appeared in jolly start output",
    );
  }
});
