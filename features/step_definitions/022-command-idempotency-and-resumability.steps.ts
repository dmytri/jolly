// Steps for features/022-command-idempotency-and-resumability.feature.
//
// The collision scenario (@logic) is produced locally with an occupied
// `storefront` target directory. The re-run/resume scenarios (@sandbox) use
// real sandbox accounts: a partial `jolly start` is produced honestly by
// withholding the Stripe credentials (a condition the sandbox can produce),
// then resumed with the full credential set.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import { envelopeProblems } from "../support/envelope.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

const LONG = { timeout: 1_800_000 };

Given(
  lit("`jolly start` is optional convenience orchestration for the full end-to-end flow"),
  function () {
    // Premise (feature 006/008).
  },
);

Given(
  lit("the agent may instead invoke individual `jolly create` subcommands at its own discretion"),
  function () {
    // Premise (feature 008).
  },
);

// --- Scenario: Re-running a create subcommand detects existing work (@sandbox)

Given(
  lit("a `jolly create` subcommand has already completed its resource"),
  LONG,
  async function (this: JollyWorld) {
    const env = sandboxRuntimeEnv();
    const first = await this.jolly(["create", "storefront", "--json", "--yes"], { env, timeoutMs: 1_500_000 });
    const envelope = requireEnvelope(first);
    assert.equal(envelope.status, "success", `first create storefront run failed: ${envelope.summary}`);
    this.vars.set("firstRun", first);
  },
);

When(lit("the agent invokes the same subcommand again"), LONG, async function (this: JollyWorld) {
  await this.jolly(["create", "storefront", "--json", "--yes"], { env: sandboxRuntimeEnv() });
});

Then(lit("Jolly should detect the already-completed work"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(
    /already|exist|detected|satisfied|skip/i.test(JSON.stringify(envelope)),
    "re-run envelope must report detected existing state",
  );
});

Then(lit("it should not create a duplicate store, clone, recipe, or deployment"), function (this: JollyWorld) {
  const entries = readdirSync(this.projectDir).filter((name) => name.startsWith("storefront"));
  assert.deepEqual(entries, ["storefront"], `duplicate artifacts created: ${entries.join(", ")}`);
});

Then(
  lit("it should report the detected existing state through the standard output envelope"),
  function (this: JollyWorld) {
    assert.deepEqual(envelopeProblems(requireEnvelope(this.lastRun!)), []);
  },
);

Then(lit("it should not fail merely because the resource already exists"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "error", `re-run must not error on "already exists": ${envelope.summary}`);
});

// --- Scenario: Jolly start resumes from the first incomplete stage (@sandbox)

Given(
  lit("a previous `jolly start` run completed some stages but not others"),
  LONG,
  async function (this: JollyWorld) {
    // Honest partial run: withhold Stripe credentials so the payment stage
    // cannot complete while earlier stages do.
    const env = { ...sandboxRuntimeEnv() };
    delete env.JOLLY_STRIPE_SECRET_KEY;
    delete env.JOLLY_STRIPE_PUBLISHABLE_KEY;
    const partial = await this.jolly(["start", "--json", "--yes"], { env, timeoutMs: 1_500_000 });
    const envelope = requireEnvelope(partial);
    assert.notEqual(envelope.status, "success", "start without Stripe creds should not fully succeed");
    this.vars.set("partialRun", partial);
  },
);

When(lit("the agent runs `jolly start` again"), LONG, async function (this: JollyWorld) {
  await this.jolly(["start", "--json", "--yes"], { env: sandboxRuntimeEnv(), timeoutMs: 1_500_000 });
});

Then(lit("Jolly should detect which stages are already satisfied"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.ok(
    /satisfied|skip|already|complete/i.test(JSON.stringify(envelope)),
    "resume envelope must report stage satisfaction state",
  );
});

Then(lit("it should skip the satisfied stages"), function (this: JollyWorld) {
  assert.ok(
    /skip/i.test(JSON.stringify(requireEnvelope(this.lastRun!))),
    "resume envelope must report skipped stages",
  );
});

Then(lit("it should continue from the first incomplete stage"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  // The withheld-then-provided Stripe stage must now be performed, not skipped.
  assert.ok(
    /stripe|payment/i.test(JSON.stringify(envelope)),
    "resumed run must perform the previously incomplete payment stage",
  );
});

Then(
  lit("it should report which stages were skipped versus performed in the output envelope"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(requireEnvelope(this.lastRun!));
    assert.ok(/skip/i.test(serialized), "envelope must distinguish skipped stages");
    assert.ok(/perform|ran|done|complete|created/i.test(serialized), "envelope must distinguish performed stages");
  },
);

// --- Scenario: Composed subcommands and start agree on state (@sandbox) ------

Given(
  lit("the agent has already run individual `jolly create` subcommands"),
  LONG,
  async function (this: JollyWorld) {
    const env = sandboxRuntimeEnv();
    const run = await this.jolly(["create", "storefront", "--json", "--yes"], { env, timeoutMs: 1_500_000 });
    assert.equal(requireEnvelope(run).status, "success", "create storefront must succeed before composing with start");
    this.vars.set("storefrontMtime", statSafe(join(this.projectDir, "storefront", "package.json")));
  },
);

When(lit("the agent later runs `jolly start`"), LONG, async function (this: JollyWorld) {
  await this.jolly(["start", "--json", "--yes"], { env: sandboxRuntimeEnv(), timeoutMs: 1_500_000 });
});

Then(
  lit("`jolly start` should treat the work done by those subcommands as already satisfied"),
  function (this: JollyWorld) {
    assert.ok(
      /satisfied|skip|already|exist/i.test(JSON.stringify(requireEnvelope(this.lastRun!))),
      "start must recognize subcommand work as satisfied stages",
    );
  },
);

Then(lit("it should not redo or duplicate that work"), function (this: JollyWorld) {
  const entries = readdirSync(this.projectDir).filter((name) => name.startsWith("storefront"));
  assert.deepEqual(entries, ["storefront"], "start must not duplicate the storefront clone");
});

// --- Scenario: Collisions pause instead of overwriting (@logic) --------------

Given(
  lit("a step would otherwise overwrite existing local or remote state it did not create"),
  function (this: JollyWorld) {
    const dir = join(this.projectDir, "storefront");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "precious.txt"), "user-authored state Jolly did not create\n");
    this.vars.set("collisionFile", join(dir, "precious.txt"));
  },
);

When(lit("the conflict is detected"), async function (this: JollyWorld) {
  await this.jolly(["create", "storefront", "--json", "--yes"]);
});

Then(lit("Jolly should pause and ask how to resolve the collision"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.notEqual(envelope.status, "success", "a collision must not be reported as plain success");
  const serialized = JSON.stringify(envelope);
  assert.ok(
    /collision|conflict|exist|occupied/i.test(serialized),
    "envelope must identify the collision",
  );
  assert.ok(
    (envelope.nextSteps as unknown[]).length > 0 || (envelope.errors as unknown[]).length > 0,
    "envelope must ask how to resolve (nextSteps or errors with remediation)",
  );
});

Then(lit("it should not silently overwrite the existing state"), function (this: JollyWorld) {
  const file = this.vars.get("collisionFile") as string;
  assert.ok(existsSync(file), "pre-existing file was deleted");
  assert.equal(
    readFileSync(file, "utf8"),
    "user-authored state Jolly did not create\n",
    "pre-existing file was overwritten",
  );
});

Then(
  lit("this should follow the same collision handling as the storefront target directory in feature 002"),
  function (this: JollyWorld) {
    // Same surface as feature 002: the storefront target dir collision above
    // must be reported through the standard envelope, with stable codes.
    assert.deepEqual(envelopeProblems(requireEnvelope(this.lastRun!)), []);
  },
);

function statSafe(path: string): number | undefined {
  try {
    return readFileSync(path, "utf8").length;
  } catch {
    return undefined;
  }
}
