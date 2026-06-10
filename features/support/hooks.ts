// Lifecycle hooks: gate @sandbox scenarios on credentials and clean up after
// every scenario. See features/023-test-architecture.feature.
import { Before, After, setDefaultTimeout } from "@cucumber/cucumber";
import { sandboxCredsAvailable, sandboxSkipReason } from "./sandbox.ts";
import type { JollyWorld } from "./world.ts";

// CLI-spawning steps (and sandbox flows) routinely exceed cucumber's 5s
// default. Individual heavy steps may still override with {timeout}.
setDefaultTimeout(120_000);

// Skip (not fail) sandbox scenarios when JOLLY_TEST_* credentials are absent.
Before({ tags: "@sandbox" }, function () {
  if (!sandboxCredsAvailable()) {
    // eslint-disable-next-line no-console
    console.log(sandboxSkipReason());
    return "skipped" as const;
  }
});

// Best-effort teardown of resources the scenario registered. Cleanup problems
// are reported, never used to fail the scenario.
After(async function (this: JollyWorld) {
  const failures = await this.cleanup.runAll();
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.warn(`cleanup left resources: ${failures.join("; ")}`);
  }
});
