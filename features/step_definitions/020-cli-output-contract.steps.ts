// Steps for features/020-cli-output-contract.feature (all @logic).
//
// "Any command" is asserted over a representative set of local-safe commands:
// `doctor` (diagnostics-only per feature 014) and `auth status` (read-only per
// feature 018). Failure behavior is produced with a guaranteed local failure:
// `jolly create storefront` into an occupied target directory (feature 022's
// collision rule) — no remote account needed.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, stripEnvelopeJson, hasHumanText, type RunResult } from "../support/cli.ts";
import {
  envelopeProblems,
  errorEntryProblems,
  CHECK_STATUS,
  ENVELOPE_STATUS,
  nonCamelCaseKeys,
} from "../support/envelope.ts";
import type { JollyWorld } from "../support/world.ts";

const SAMPLE_COMMANDS: string[][] = [
  ["doctor"],
  ["auth", "status"],
];

function runs(world: JollyWorld): RunResult[] {
  const stored = world.vars.get("runs020");
  assert.ok(Array.isArray(stored) && stored.length > 0, "no CLI runs recorded for this scenario");
  return stored as RunResult[];
}

Given(lit("every command supports `--json`, `--quiet`, and (for side-effecting commands) `--dry-run`"), function () {
  // Premise; the flag behavior itself is asserted by the scenarios below and
  // by features 006/021.
});

Given(lit("the agent invokes any Jolly command with `--json`"), async function (this: JollyWorld) {
  const results: RunResult[] = [];
  for (const args of SAMPLE_COMMANDS) {
    results.push(await this.jolly([...args, "--json"]));
  }
  this.vars.set("runs020", results);
});

When(lit("the command completes"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    assert.notEqual(run.exitCode, null, `command did not complete: jolly ${run.args.join(" ")}`);
  }
});

Then(lit("stdout should contain a single JSON envelope and nothing else"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    if (!run.args.includes("--json")) continue;
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(run.stdout);
    }, `with --json, stdout must be exactly one JSON document (jolly ${run.args.join(" ")}); got:\n${run.stdout.slice(0, 1000)}`);
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), "stdout JSON must be a single object");
  }
});

Then(lit("the envelope should include a `command` identifier"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    const envelope = requireEnvelope(run);
    assert.ok(typeof envelope.command === "string" && envelope.command.length > 0);
  }
});

Then(
  lit("the envelope should include a top-level `status` of `success`, `warning`, or `error`"),
  function (this: JollyWorld) {
    for (const run of runs(this)) {
      const envelope = requireEnvelope(run);
      assert.ok(
        ENVELOPE_STATUS.includes(envelope.status as (typeof ENVELOPE_STATUS)[number]),
        `status must be one of ${ENVELOPE_STATUS.join("|")}, got ${envelope.status}`,
      );
    }
  },
);

Then(lit("the envelope should include a human `summary` string"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    const envelope = requireEnvelope(run);
    assert.ok(typeof envelope.summary === "string" && envelope.summary.trim().length > 0);
  }
});

Then(lit("the envelope should include a command-specific `data` object"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    const envelope = requireEnvelope(run);
    assert.ok(envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data));
  }
});

Then(lit("the envelope should include a `nextSteps` array"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    assert.ok(Array.isArray(requireEnvelope(run).nextSteps), "`nextSteps` must be an array");
  }
});

Then(lit("the envelope should include an `errors` array that is empty on success"), function (this: JollyWorld) {
  for (const run of runs(this)) {
    const envelope = requireEnvelope(run);
    assert.ok(Array.isArray(envelope.errors), "`errors` must be an array");
    if (envelope.status === "success") {
      assert.equal((envelope.errors as unknown[]).length, 0, "`errors` must be empty when status is success");
    }
  }
});

Then(
  lit("the agent should be able to parse the same shape regardless of which command produced it"),
  function (this: JollyWorld) {
    for (const run of runs(this)) {
      const envelope = requireEnvelope(run);
      const problems = envelopeProblems(envelope);
      assert.deepEqual(problems, [], `jolly ${run.args.join(" ")}: ${problems.join("; ")}`);
      const offenders = nonCamelCaseKeys(envelope);
      assert.deepEqual(offenders, [], `non-camelCase field names: ${offenders.join(", ")}`);
    }
  },
);

Given(lit("the agent invokes a Jolly command without `--json`"), async function (this: JollyWorld) {
  const plain = await this.jolly(["doctor"]);
  const quiet = await this.jolly(["doctor", "--quiet"]);
  this.vars.set("runs020", [plain, quiet]);
  this.vars.set("plainRun", plain);
  this.vars.set("quietRun", quiet);
});

Then(
  lit("Jolly should print concise human-readable text for a developer reading along"),
  function (this: JollyWorld) {
    const run = this.vars.get("plainRun") as RunResult;
    requireEnvelope(run);
    assert.ok(
      hasHumanText(stripEnvelopeJson(run.stdout)),
      "default mode must include human-readable text beyond the JSON envelope",
    );
  },
);

Then(lit("it should still include the machine-readable envelope for the agent"), function (this: JollyWorld) {
  const run = this.vars.get("plainRun") as RunResult;
  assert.deepEqual(envelopeProblems(requireEnvelope(run)), []);
});

Then(
  lit("`--quiet` should reduce nonessential human text without removing the envelope"),
  function (this: JollyWorld) {
    const plain = this.vars.get("plainRun") as RunResult;
    const quiet = this.vars.get("quietRun") as RunResult;
    assert.deepEqual(envelopeProblems(requireEnvelope(quiet)), [], "--quiet must keep the envelope intact");
    assert.ok(
      quiet.stdout.length <= plain.stdout.length,
      `--quiet output (${quiet.stdout.length} chars) must not exceed default output (${plain.stdout.length} chars)`,
    );
  },
);

Given(
  lit("a command performs verification such as `jolly start` or `jolly doctor`"),
  async function (this: JollyWorld) {
    this.vars.set("runs020", [await this.jolly(["doctor", "--json"])]);
  },
);

When(lit("it reports check results in the envelope"), function (this: JollyWorld) {
  const envelope = requireEnvelope(runs(this)[0]);
  assert.ok(Array.isArray(envelope.checks), "verifying commands must report a `checks` array");
});

Then(lit("each check should appear in a `checks` array"), function (this: JollyWorld) {
  const envelope = requireEnvelope(runs(this)[0]);
  assert.ok(Array.isArray(envelope.checks) && envelope.checks.length > 0, "`checks` must be a non-empty array");
});

Then(lit("each check should carry a stable check id"), function (this: JollyWorld) {
  const envelope = requireEnvelope(runs(this)[0]);
  for (const check of envelope.checks as Record<string, unknown>[]) {
    assert.ok(typeof check.id === "string" && check.id.length > 0, `check without id: ${JSON.stringify(check)}`);
  }
});

Then(
  lit("each check `status` should be one of pass, warning, fail, skipped, or unknown"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(runs(this)[0]);
    for (const check of envelope.checks as Record<string, unknown>[]) {
      assert.ok(
        CHECK_STATUS.includes(check.status as (typeof CHECK_STATUS)[number]),
        `check ${check.id} has invalid status ${JSON.stringify(check.status)}`,
      );
    }
  },
);

Then(
  lit("each check should be able to carry a concrete next command or manual step"),
  function (this: JollyWorld) {
    // Capability contract: any non-passing check carries guidance (a
    // remediation/nextStep on the check itself or a matching nextSteps entry).
    const envelope = requireEnvelope(runs(this)[0]);
    const checks = envelope.checks as Record<string, unknown>[];
    const failing = checks.filter((c) => c.status === "fail" || c.status === "warning");
    for (const check of failing) {
      const onCheck = JSON.stringify(check);
      const guided = /nextStep|remediation|command|manual/i.test(onCheck) || (envelope.nextSteps as unknown[]).length > 0;
      assert.ok(guided, `non-passing check ${check.id} carries no concrete next command or manual step`);
    }
  },
);

Given(lit("a command fails or partially succeeds"), async function (this: JollyWorld) {
  // Guaranteed local failure: storefront target directory collision (feature 022).
  mkdirSync(join(this.projectDir, "storefront"), { recursive: true });
  writeFileSync(join(this.projectDir, "storefront", "keep.txt"), "user data, do not overwrite\n");
  const first = await this.jolly(["create", "storefront", "--json", "--yes"]);
  const second = await this.jolly(["create", "storefront", "--json", "--yes"]);
  this.vars.set("runs020", [first, second]);
  const envelope = requireEnvelope(first);
  assert.notEqual(envelope.status, "success", "expected the collision run to fail or partially succeed");
});

When(lit("the agent inspects the envelope"), function (this: JollyWorld) {
  requireEnvelope(runs(this)[0]);
});

Then(
  lit("each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(runs(this)[0]);
    const errors = envelope.errors as unknown[];
    assert.ok(errors.length > 0, "a failing command must report at least one errors[] entry");
    for (const entry of errors) {
      assert.deepEqual(errorEntryProblems(entry), [], JSON.stringify(entry));
    }
  },
);

Then(
  lit("the documented `code` and check id strings should remain stable so the agent can branch on them programmatically"),
  function (this: JollyWorld) {
    const [first, second] = runs(this);
    const codesOf = (run: RunResult) =>
      ((requireEnvelope(run).errors as Record<string, unknown>[]) ?? []).map((e) => e.code).sort();
    assert.deepEqual(codesOf(second), codesOf(first), "identical failures must produce identical stable codes");
  },
);

Given(lit("a command handles secret values such as tokens or API keys"), async function (this: JollyWorld) {
  const secret = `sk_test_${this.namespace}_supersecret`;
  this.vars.set("secret", secret);
  const env = { JOLLY_SALEOR_APP_TOKEN: secret, JOLLY_STRIPE_SECRET_KEY: secret };
  this.vars.set("runs020", [
    await this.jolly(["auth", "status", "--json"], { env }),
    await this.jolly(["auth", "status"], { env }),
    await this.jolly(["doctor"], { env }),
  ]);
});

When(lit("it produces output in any mode"), function (this: JollyWorld) {
  // The contract is about real output: every mode must actually produce an
  // envelope (otherwise this scenario would pass vacuously on empty output).
  for (const run of runs(this)) {
    assert.notEqual(run.exitCode, null);
    requireEnvelope(run);
  }
});

Then(
  lit("no field in the envelope or human text should contain a secret value"),
  function (this: JollyWorld) {
    const secret = this.vars.get("secret") as string;
    for (const run of runs(this)) {
      assert.ok(
        !run.stdout.includes(secret) && !run.stderr.includes(secret),
        `secret value leaked in output of jolly ${run.args.join(" ")}`,
      );
    }
  },
);

Then(lit("secrets should be referenced by name only"), function (this: JollyWorld) {
  // The runs above provided JOLLY_SALEOR_APP_TOKEN: when output talks about
  // that credential it must use the variable name, never the value.
  const secret = this.vars.get("secret") as string;
  for (const run of runs(this)) {
    assert.ok(!run.stdout.includes(secret), "secret value must never appear; reference it by name");
  }
});
