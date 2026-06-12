// Cucumber hooks (features 023 and 018).
//
// Before, in spec order:
//   1. @requires-browser — gate on browser capability (feature 018, Rule
//      "Browser OAuth prerequisites"): native browser first, then Playwright
//      plus the HARNESS_SALEOR_EMAIL / HARNESS_SALEOR_PASSWORD knobs, else
//      skip. This runs BEFORE the @sandbox credential check.
//   2. @sandbox — gate on the same runtime JOLLY_* credentials Jolly itself
//      uses (feature 023): when required credentials are absent the scenario
//      is skipped, not failed, with a reason naming the missing variables.
//
// After: run the scenario's LIFO, idempotent, best-effort cleanup registry
// and report anything it could not remove by its namespaced identifier
// (feature 023 "Harmless by design"). Teardown failures are reported, never
// swallowed silently — the scenario fails so leaked resources are visible.
import { After, AfterAll, Before } from "@cucumber/cucumber";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";
import { missingLoginKnobs, resolveBrowserTier } from "./browser.ts";
import {
  derivedSecrets,
  ensureSharedEnvironment,
  teardownSharedEnvironment,
} from "./provision.ts";
import { classifyCredentials, requiredGroups } from "./sandbox.ts";
import type { JollyWorld } from "./world.ts";

/**
 * The resolved tier for the current @requires-browser scenario, stashed on
 * world.notes so step definitions can drive the matching login path (Tier 1
 * native vs Tier 2 Playwright with stdin-piped harness credentials).
 */
export const BROWSER_TIER_NOTE = "browserTier";

// 1 — @requires-browser capability gate (checked before @sandbox credentials).
Before({ tags: "@requires-browser" }, function (this: JollyWorld) {
  const tier = resolveBrowserTier();
  if (tier.mode === "skip") {
    this.attach(`Skipped: ${tier.reason}`, "text/plain");
    return "skipped";
  }
  if (tier.mode === "playwright") {
    // Defensive double-check: Tier 2 must never start without the knobs.
    const missing = missingLoginKnobs();
    if (missing.length > 0) {
      this.attach(
        `Skipped: missing harness login knobs ${missing.join(", ")}`,
        "text/plain",
      );
      return "skipped";
    }
  }
  this.notes[BROWSER_TIER_NOTE] = tier;
});

// 2 — @sandbox credential gate (feature 023): skip (never fail) only when
// credentials are absent AND cannot be derived — the Cloud token itself, or
// Vercel/Stripe. A missing Saleor endpoint/app token with the Cloud token
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
      // The derived app token entered process.env after this world snapshot
      // took its secrets; track it so output-safety assertions cover it.
      for (const secret of derivedSecrets()) this.trackSecret(secret);
    }
  },
);

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
