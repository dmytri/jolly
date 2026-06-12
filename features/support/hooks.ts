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
import { After, Before } from "@cucumber/cucumber";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";
import { missingLoginKnobs, resolveBrowserTier } from "./browser.ts";
import { missingCredentials, requiredGroups } from "./sandbox.ts";
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

// 2 — @sandbox credential gate: skip (never fail) when the runtime JOLLY_*
// configuration the scenario needs is absent.
Before(
  { tags: "@sandbox" },
  function (this: JollyWorld, hook: ITestCaseHookParameter) {
    const scenarioName = hook.pickle.name;
    const missing = missingCredentials(requiredGroups(scenarioName));
    if (missing.length > 0) {
      this.attach(
        `Skipped: missing required credentials ${missing.join(", ")}`,
        "text/plain",
      );
      return "skipped";
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
