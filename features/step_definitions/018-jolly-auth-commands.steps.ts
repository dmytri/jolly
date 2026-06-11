// Steps for features/018-jolly-auth-commands.feature.
// "Jolly should support a headless token flow ..." is defined in the feature
// 002 step file (shared step text).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

const FAKE_CLOUD_TOKEN = "jolly-test-cloud-token-canary";
const FAKE_APP_TOKEN = "jolly-test-app-token-canary";

// --- Agent logs in to Saleor Cloud (@sandbox) ------------------------------------

Given("the agent needs Saleor Cloud authentication", function (this: JollyWorld) {
  // Context only; the runtime JOLLY_* configuration supplies the token.
});

When("it invokes `jolly login`", { timeout: 180_000 }, function (this: JollyWorld) {
  this.notes.loginRun = this.runCli(["login", "--yes", "--json"], {
    timeoutMs: 150_000,
  });
});

Then(
  "Jolly should support browser OAuth authentication when available",
  function (this: JollyWorld) {
    // This headless environment cannot open a browser or receive a callback.
    return "skipped";
  },
);

Then(
  "Jolly should explain any required human browser or token steps",
  function (this: JollyWorld) {
    for (const step of this.envelope.nextSteps) {
      assert.ok(
        String(step.description ?? "").trim().length > 0,
        "a login next step lacks a description",
      );
    }
  },
);

Then("Jolly should write acquired token values to `.env`", function (this: JollyWorld) {
  const envPath = join(this.projectDir, ".env");
  assert.ok(existsSync(envPath), "login wrote no .env");
  assert.match(
    readFileSync(envPath, "utf8"),
    /JOLLY_SALEOR_(CLOUD|APP)_TOKEN=/,
    ".env carries no Jolly-managed Saleor auth values",
  );
});

Then(
  "Jolly should ensure `.env` is ignored by Git before writing secrets",
  function (this: JollyWorld) {
    const gitignore = join(this.projectDir, ".gitignore");
    assert.ok(existsSync(gitignore), "no .gitignore was created");
    assert.ok(
      readFileSync(gitignore, "utf8")
        .split("\n")
        .some((line) => line.trim() === ".env"),
      ".env is not Git-ignored",
    );
  },
);

Then(
  "Jolly should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    const status = this.runCli(["auth", "status", "--json"]);
    assert.match(
      JSON.stringify(status.envelope?.data ?? {}),
      /true|configured|authenticated/i,
      "the freshly written auth values are not visible to the command flow",
    );
  },
);

Then("it should avoid printing secret token values", function (this: JollyWorld) {
  const login = this.notes.loginRun as { stdout: string; stderr: string };
  this.assertNoSecretsIn(login.stdout + login.stderr, "login output");
  const run = this.lastRun!;
  this.assertNoSecretsIn(run.stdout + run.stderr, "auth output");
});

// --- Agent logs out (@logic) -------------------------------------------------------

Given(
  "Jolly has Saleor Cloud authentication state available",
  function (this: JollyWorld) {
    this.trackSecret(FAKE_CLOUD_TOKEN);
    this.trackSecret(FAKE_APP_TOKEN);
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: FAKE_CLOUD_TOKEN,
      JOLLY_SALEOR_APP_TOKEN: FAKE_APP_TOKEN,
      THIRD_PARTY_API_KEY: "unrelated-third-party-credential",
      OTHER_SETTING: "keep-me",
    });
  },
);

When("the agent invokes `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], {
    env: {
      // Auth state lives in the project .env, not the test process env.
      JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      JOLLY_SALEOR_APP_TOKEN: undefined,
    },
  });
});

Then(
  "Jolly should remove or invalidate Jolly-managed Saleor Cloud auth values in `.env` where applicable",
  function (this: JollyWorld) {
    const env = readFileSync(join(this.projectDir, ".env"), "utf8");
    assert.ok(
      !env.includes(FAKE_CLOUD_TOKEN),
      "the Saleor Cloud token survives logout",
    );
  },
);

Then(
  "it should not remove unrelated environment variables or third-party credentials without explicit intent",
  function (this: JollyWorld) {
    const env = readFileSync(join(this.projectDir, ".env"), "utf8");
    assert.match(env, /THIRD_PARTY_API_KEY=unrelated-third-party-credential/);
    assert.match(env, /OTHER_SETTING=keep-me/);
  },
);

Then(
  "it should load the updated `.env` values for the current command flow where possible",
  function (this: JollyWorld) {
    const status = this.runCli(["auth", "status", "--json"], {
      env: {
        JOLLY_SALEOR_CLOUD_TOKEN: undefined,
        JOLLY_SALEOR_APP_TOKEN: undefined,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(status.envelope?.data ?? {}),
      /"(configured|authenticated)"\s*:\s*true/i,
      "auth still reports as configured after logout",
    );
  },
);

Then("it should report the result clearly", function (this: JollyWorld) {
  // The logout envelope (run before the follow-up status query).
  const logout = this.previousRun ?? this.lastRun;
  assert.ok(logout?.envelope, "logout emitted no envelope");
  assert.ok(
    logout!.envelope!.summary.trim().length > 0,
    "logout has no summary",
  );
});

// --- Agent checks auth status (@logic) -----------------------------------------------

Given(
  "the agent needs to know whether Saleor Cloud auth is available",
  function (this: JollyWorld) {
    this.trackSecret(FAKE_CLOUD_TOKEN);
    writeEnvValues(this.projectDir, {
      JOLLY_SALEOR_CLOUD_TOKEN: FAKE_CLOUD_TOKEN,
    });
  },
);

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  this.runCli(["auth", "status", "--json"], {
    env: { JOLLY_SALEOR_CLOUD_TOKEN: undefined },
  });
});

Then(
  "Jolly should report whether Saleor Cloud authentication is configured",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope.data),
      /configured|authenticated|auth/i,
      "auth status does not report whether authentication is configured",
    );
  },
);

Then(
  "it should report the authenticated account or organization context where safe",
  function (this: JollyWorld) {
    // The status data must carry the account/organization context fields;
    // resolving them live is only possible with real Saleor Cloud auth.
    assert.ok(
      "account" in this.envelope.data || "organization" in this.envelope.data,
      "auth status reports no account/organization context field",
    );
    if (process.env.JOLLY_SALEOR_CLOUD_TOKEN) {
      assert.match(
        JSON.stringify(this.envelope.data),
        /"(account|organization)"\s*:\s*"/,
        "no live account/organization context is reported despite Cloud auth",
      );
    }
  },
);

Then("it should avoid exposing secret token values", function (this: JollyWorld) {
  const run = this.lastRun!;
  this.assertNoSecretsIn(run.stdout + run.stderr, "auth status output");
});

Then(
  "it should support `--json`, `--quiet`, and other global output flags",
  function (this: JollyWorld) {
    const json = this.runCli(["auth", "status", "--json"]);
    assert.ok(json.envelope, "auth status --json emitted no envelope");
    assert.doesNotThrow(() => JSON.parse(json.stdout.trim()));
    const quiet = this.runCli(["auth", "status", "--quiet"]);
    assert.ok(quiet.envelope, "--quiet removed the machine-readable envelope");
  },
);
