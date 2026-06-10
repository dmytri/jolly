// Steps for features/018-jolly-auth-commands.feature.
// login is @sandbox (real Saleor Cloud); logout and auth status are @logic.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type RunResult } from "../support/cli.ts";
import { envelopeProblems } from "../support/envelope.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

function readEnvFile(world: JollyWorld): string {
  const path = join(world.projectDir, ".env");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// --- Scenario: Agent logs in to Saleor Cloud (@sandbox) ----------------------

Given(lit("the agent needs Saleor Cloud authentication"), function () {
  // Premise.
});

When(lit("it invokes `jolly login`"), async function (this: JollyWorld) {
  // Headless flow: token provided via runtime env (browser OAuth cannot run
  // in CI); login must verify it and persist it to .env.
  await this.jolly(["login", "--json", "--yes"], { env: sandboxRuntimeEnv() });
});

Then(lit("Jolly should support browser OAuth authentication when available"), async function (this: JollyWorld) {
  const help = await this.jolly(["login", "--help"]);
  assert.ok(/browser|oauth/i.test(help.stdout), "`jolly login --help` must document browser OAuth");
});

Then(lit("Jolly should explain any required human browser or token steps"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.previousRun ?? this.lastRun!);
  const serialized = JSON.stringify(envelope);
  assert.ok(
    /browser|token|consent|dashboard/i.test(serialized),
    "login output must explain the human browser/token steps",
  );
});

Then(lit("Jolly should write acquired token values to `.env`"), function (this: JollyWorld) {
  const env = readEnvFile(this);
  assert.ok(/JOLLY_[A-Z_]*TOKEN\s*=/.test(env), "login must persist the acquired token in .env under a JOLLY_* name");
});

Then(lit("Jolly should ensure `.env` is ignored by Git before writing secrets"), function (this: JollyWorld) {
  const gitignore = join(this.projectDir, ".gitignore");
  assert.ok(existsSync(gitignore), "login must create .gitignore when writing .env secrets");
  assert.ok(
    readFileSync(gitignore, "utf8").split("\n").some((line) => line.trim() === ".env"),
    ".gitignore must list .env",
  );
});

Then(
  lit("Jolly should load the updated `.env` values for the current command flow where possible"),
  function (this: JollyWorld) {
    // Observable contract: the login run itself proceeded with the new values
    // (it reports authenticated state in the same flow).
    const envelope = requireEnvelope(this.lastRun!);
    assert.notEqual(envelope.status, "error", `login flow did not complete with the new values: ${envelope.summary}`);
  },
);

Then(lit("it should avoid printing secret token values"), function (this: JollyWorld) {
  const token = process.env.JOLLY_TEST_SALEOR_CLOUD_TOKEN;
  if (!token) return "skipped" as const;
  for (const run of [this.lastRun!, this.previousRun].filter(Boolean) as RunResult[]) {
    assert.ok(!run.stdout.includes(token) && !run.stderr.includes(token), "secret token printed in login output");
  }
});

// --- Scenario: Agent logs out (@logic) ---------------------------------------

Given(lit("Jolly has Saleor Cloud authentication state available"), function (this: JollyWorld) {
  writeFileSync(
    join(this.projectDir, ".env"),
    [
      "JOLLY_SALEOR_CLOUD_TOKEN=jolly-test-token-value",
      "JOLLY_SALEOR_APP_TOKEN=jolly-test-app-token-value",
      "UNRELATED_API_KEY=unrelated-keep-me",
      "NEXT_PUBLIC_SALEOR_API_URL=https://example.saleor.cloud/graphql/",
      "",
    ].join("\n"),
  );
});

When(lit("the agent invokes `jolly logout`"), async function (this: JollyWorld) {
  await this.jolly(["logout", "--json", "--yes"]);
});

Then(
  lit("Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable"),
  function (this: JollyWorld) {
    const env = readEnvFile(this);
    assert.ok(
      !/JOLLY_SALEOR_CLOUD_TOKEN\s*=\s*jolly-test-token-value/.test(env),
      "logout must remove/invalidate the Jolly-managed Saleor Cloud token",
    );
  },
);

Then(
  lit("it should not remove unrelated environment variables or third-party credentials without explicit intent"),
  function (this: JollyWorld) {
    const env = readEnvFile(this);
    assert.ok(env.includes("UNRELATED_API_KEY=unrelated-keep-me"), "logout removed an unrelated variable");
    assert.ok(
      env.includes("NEXT_PUBLIC_SALEOR_API_URL=https://example.saleor.cloud/graphql/"),
      "logout removed a storefront runtime variable it does not manage",
    );
  },
);

Then(
  lit("it should load the updated `.env` values for the current command flow where possible"),
  function (this: JollyWorld) {
    // Observable contract: the logout envelope reflects the post-logout state.
    const envelope = requireEnvelope(this.lastRun!);
    assert.ok(
      !/jolly-test-token-value/.test(JSON.stringify(envelope)),
      "logout envelope still reflects the removed token value",
    );
  },
);

Then(lit("it should report the result clearly"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.lastRun!);
  assert.deepEqual(envelopeProblems(envelope), []);
  assert.ok(/log(ged)?\s?out|removed|cleared/i.test(envelope.summary), `unclear logout summary: ${envelope.summary}`);
});

// --- Scenario: Agent checks auth status (@logic) ------------------------------

Given(lit("the agent needs to know whether Saleor Cloud auth is available"), function () {
  // Premise; this scenario runs once without and once with a token.
});

When(lit("it invokes `jolly auth status`"), async function (this: JollyWorld) {
  const without = await this.jolly(["auth", "status", "--json"]);
  const secret = `jolly-secret-${this.namespace}`;
  this.vars.set("secret", secret);
  const withToken = await this.jolly(["auth", "status", "--json"], {
    env: { JOLLY_SALEOR_CLOUD_TOKEN: secret },
  });
  this.vars.set("without", without);
  this.vars.set("withToken", withToken);
});

Then(lit("Jolly should report whether Saleor Cloud authentication is configured"), function (this: JollyWorld) {
  const without = requireEnvelope(this.vars.get("without") as RunResult);
  const withToken = requireEnvelope(this.vars.get("withToken") as RunResult);
  const summaryOf = (e: typeof without) => JSON.stringify({ summary: e.summary, data: e.data });
  // The two states must be distinguishable from the envelope.
  assert.notEqual(
    summaryOf(without),
    summaryOf(withToken),
    "auth status must distinguish configured from unconfigured authentication",
  );
  assert.ok(
    /auth|token|configured|logged/i.test(summaryOf(without)),
    "auth status must talk about authentication state",
  );
});

Then(
  lit("it should report the authenticated account or organization context where safe"),
  function (this: JollyWorld) {
    // With a fake token there is no real account; "where safe" means the field
    // is part of the reported shape, even if null/unknown.
    const withToken = requireEnvelope(this.vars.get("withToken") as RunResult);
    assert.ok(
      /account|organi[sz]ation|context/i.test(JSON.stringify(withToken.data)),
      "auth status data must carry account/organization context",
    );
  },
);

Then(lit("it should avoid exposing secret token values"), function (this: JollyWorld) {
  const secret = this.vars.get("secret") as string;
  const run = this.vars.get("withToken") as RunResult;
  assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret), "auth status leaked the token value");
});

Then(lit("it should support `--json`, `--quiet`, and other global output flags"), async function (this: JollyWorld) {
  const json = requireEnvelope(this.vars.get("withToken") as RunResult);
  assert.deepEqual(envelopeProblems(json), []);
  const quiet = await this.jolly(["auth", "status", "--quiet"]);
  assert.notEqual(quiet.exitCode, null, "auth status --quiet must run");
  requireEnvelope(quiet);
});
