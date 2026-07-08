// Cucumber hooks (feature 023).
//
// BeforeAll (unconditional, every invocation regardless of tags): reclaim
// stale jolly-cannon-fodder leftovers — Cloud environments and local scratch
// dirs — from any PRIOR run, crashed or clean, that didn't get reclaimed by
// its own tier running again. This used to be buried inside @sandbox's and
// @eval's own provisioning paths, so a leftover from one tier only got
// cleaned up the next time THAT SAME tier happened to run — which could be
// days or weeks if the other tier was the one being iterated on. Running it
// here, unconditionally, up front, means every invocation of any tier cleans
// house first.
//
// Before @sandbox: ensure the run's stable-named shared jolly-cannon-fodder
// store exists (created fresh, or reused from a prior invocation if still
// healthy — see provision.ts) and export its derived endpoint + SALEOR_TOKEN
// for the scenario, then track the derived secret for output-safety.
// Credentials for every tier are present by fitting-out; the underlying
// provisioner reads the Cloud token from the environment. Assume present.
//
// Before @eval: build the published-shape CLI bundle the shimmed bin/jolly imports.
//
// After: run the scenario's LIFO, idempotent, best-effort cleanup registry
// and report anything it could not remove by its namespaced identifier
// (feature 023 "Harmless by design"). Teardown failures are reported, never
// swallowed silently — the scenario fails so leaked resources are visible.
// Note this never touches the shared store itself — it's deliberately
// long-lived (provision.ts), not scenario- or run-scoped cleanup.
import { After, AfterAll, Before, BeforeAll } from "@cucumber/cucumber";
import { ensureCliBundle } from "./eval.ts";
import {
  derivedSecrets,
  ensureSharedEnvironment,
  reclaimStaleResources,
  teardownSharedEnvironment,
} from "./provision.ts";
import type { JollyWorld } from "./world.ts";

BeforeAll({ timeout: 120_000 }, async function () {
  await reclaimStaleResources();
});

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

// Run-end teardown of local scratch state only (the scratch project
// directory the shared-store provisioning wrote its derived .env into). The
// shared Cloud store itself is intentionally NOT torn down here — it's a
// deliberately long-lived, stable-named resource (provision.ts) reused by the
// next invocation; cleanup of genuine leftovers is the BeforeAll reclaim
// above, not this hook. Same long timeout and same loud-failure rule as After.
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
