// Cucumber hooks (feature 023).
//
// Before, in spec order:
//   1. @sandbox — gate on the same runtime JOLLY_* credentials Jolly itself
//      uses (feature 023): when required credentials are absent the scenario
//      is skipped, not failed, with a reason naming the missing variables.
//
// After: run the scenario's LIFO, idempotent, best-effort cleanup registry
// and report anything it could not remove by its namespaced identifier
// (feature 023 "Harmless by design"). Teardown failures are reported, never
// swallowed silently — the scenario fails so leaked resources are visible.
import { After, AfterAll, Before } from "@cucumber/cucumber";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";
import { ensureCliBundle, evalGate } from "./eval.ts";
import {
  derivedSecrets,
  ensureSharedEnvironment,
  teardownSharedEnvironment,
} from "./provision.ts";
import {
  classifyCredentials,
  deviceGrantRefreshAvailable,
  requiredGroups,
  requiresDeviceGrantRefresh,
  requiresVercelCli,
  vercelCliAuthenticated,
} from "./sandbox.ts";
import type { JollyWorld } from "./world.ts";

// 1 — @sandbox credential gate (feature 023): skip (never fail) only when
// credentials are absent AND cannot be derived — the Cloud token itself, or
// Vercel/Stripe. A missing Saleor endpoint/SALEOR_TOKEN with the Cloud token
// present is DERIVED instead: the harness provisions one shared per-run
// jolly-test environment on first need and exports the values for the whole
// run. Provisioning creates a real environment, so the timeout is generous.
Before(
  { tags: "@sandbox", timeout: 900_000 },
  async function (this: JollyWorld, hook: ITestCaseHookParameter) {
    const scenarioName = hook.pickle.name;
    const gate = classifyCredentials(requiredGroups(scenarioName));
    if (gate.missing.length > 0) {
      this.attach(
        `Skipped: missing required credentials ${gate.missing.join(", ")}`,
        "text/plain",
      );
      return "skipped";
    }
    if (gate.derivable.length > 0) {
      const outcome = await ensureSharedEnvironment();
      if (outcome.status === "skip") {
        this.attach(`Skipped: ${outcome.reason}`, "text/plain");
        return "skipped";
      }
      // The derived SALEOR_TOKEN entered process.env after this world snapshot
      // took its secrets; track it so output-safety assertions cover it.
      for (const secret of derivedSecrets()) this.trackSecret(secret);
    }
    // Device-grant refresh capability gate (@exceptional-double): the refresh-
    // grant scenarios need a stored device-grant refresh token a human authorize
    // cannot produce on demand. Absent → skip, never fail.
    if (requiresDeviceGrantRefresh(scenarioName) && !deviceGrantRefreshAvailable()) {
      this.attach(
        "Skipped: no stored device-grant refresh token (JOLLY_SALEOR_REFRESH_TOKEN) " +
          "to seed the authorized grant",
        "text/plain",
      );
      return "skipped";
    }
    // Vercel capability gate (decision 2026-06-13): deployment-touching
    // scenarios need an authenticated Vercel CLI session, not a Jolly env var.
    if (requiresVercelCli(scenarioName) && !vercelCliAuthenticated()) {
      this.attach(
        "Skipped: Vercel CLI is not authenticated (`npx vercel whoami` exited " +
          "non-zero); run `vercel login` to enable deployment scenarios",
        "text/plain",
      );
      return "skipped";
    }
  },
);

// 2 — @eval gate (feature 025): skip — never fail — when the baseline-agent
// runner or the model key (HARNESS_OPENROUTER_API_KEY) is absent, exactly like
// @sandbox credential gating. The eval is opt-in and never gates normal CI.
// When it can run, ensure the published-shape CLI bundle (dist/index.js) the
// shimmed `bin/jolly` imports is built; a build failure is a clean skip.
Before({ tags: "@eval", timeout: 180_000 }, function (this: JollyWorld) {
  const gate = evalGate();
  if (!gate.ok) {
    this.attach(`Skipped: ${gate.reason}`, "text/plain");
    return "skipped";
  }
  const buildError = ensureCliBundle();
  if (buildError) {
    this.attach(`Skipped: ${buildError}`, "text/plain");
    return "skipped";
  }
});

// Teardown: LIFO best-effort cleanup of everything the scenario created.
// Explicit timeout: cleanup talks to live APIs (environment deletion can be
// slow or briefly blocked by provisioning tasks) and must never be cut off
// by the 5s hook default — a cut-off teardown is how sandbox slots leak.
After({ timeout: 300_000 }, async function (this: JollyWorld) {
  if (this.cleanup.size === 0) return;
  const failures = await this.cleanup.runAll();
  if (failures.length > 0) {
    const report = failures
      .map((failure) => `- ${failure.description}: ${failure.error}`)
      .join("\n");
    this.attach(`Teardown could not remove:\n${report}`, "text/plain");
    throw new Error(
      `teardown could not remove ${failures.length} resource(s):\n${report}`,
    );
  }
});

// Run-end teardown of the shared provisioned environment (features 023 +
// 012: deleted right after the run; a test run never permanently consumes a
// sandbox slot). Same long timeout and same loud-failure rule as After.
AfterAll({ timeout: 300_000 }, async function () {
  const failures = await teardownSharedEnvironment();
  if (failures.length > 0) {
    const report = failures
      .map((failure) => `- ${failure.description}: ${failure.error}`)
      .join("\n");
    throw new Error(
      `shared-environment teardown could not remove ${failures.length} resource(s):\n${report}`,
    );
  }
});
