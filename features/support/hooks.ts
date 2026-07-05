// Cucumber hooks (feature 023).
//
// Before @sandbox: provision the run's one shared jolly-cannon-fodder store and
// export its derived endpoint + SALEOR_TOKEN for the scenario, then track the
// derived secret for output-safety. Credentials for every tier are present by
// fitting-out; the underlying provisioner reads the Cloud token from the
// environment. Assume they are present.
//
// Before @eval: build the published-shape CLI bundle the shimmed bin/jolly imports.
//
// After: run the scenario's LIFO, idempotent, best-effort cleanup registry
// and report anything it could not remove by its namespaced identifier
// (feature 023 "Harmless by design"). Teardown failures are reported, never
// swallowed silently — the scenario fails so leaked resources are visible.
import { After, AfterAll, Before } from "@cucumber/cucumber";
import { ensureCliBundle } from "./eval.ts";
import {
  derivedSecrets,
  ensureSharedEnvironment,
  teardownSharedEnvironment,
} from "./provision.ts";
import type { JollyWorld } from "./world.ts";

// Provision the run's one shared jolly-cannon-fodder store (endpoint + SALEOR_TOKEN
// derived from the Cloud token) and track the derived secret so output-safety
// assertions cover it. Provisioning creates a real environment, so the timeout
// is generous. A scenario that needs a clean, store-less starting state passes
// its own env to the CLI (absentCredentialsEnv).
Before(
  { tags: "@sandbox", timeout: 900_000 },
  async function (this: JollyWorld) {
    await ensureSharedEnvironment();
    for (const secret of derivedSecrets()) this.trackSecret(secret);
  },
);

// Build the published-shape CLI bundle (dist/index.js) the shimmed `bin/jolly`
// imports, so the eval drives the real published shape. A build failure fails
// the scenario.
Before({ tags: "@eval", timeout: 180_000 }, function (this: JollyWorld) {
  const buildError = ensureCliBundle();
  if (buildError) throw new Error(buildError);
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
