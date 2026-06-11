// Scenario hooks (feature 023).
//
// Before @sandbox: skip — never fail — when the runtime JOLLY_* configuration
// the scenario needs is absent, with a reason naming the missing variables.
// After every scenario: run the LIFO, idempotent, best-effort teardown and
// report anything it could not remove by its namespaced identifier.
import { After, Before, type ITestCaseHookParameter } from "@cucumber/cucumber";
import { missingCredentials, requiredGroups } from "./sandbox.ts";
import type { JollyWorld } from "./world.ts";

Before({ tags: "@sandbox" }, function (
  this: JollyWorld,
  { pickle }: ITestCaseHookParameter,
) {
  const groups = requiredGroups(pickle.name);
  const missing = missingCredentials(groups);
  if (missing.length > 0) {
    this.log(
      `Skipped (sandbox credentials absent): missing ${missing.join(", ")}. ` +
        `Set the same runtime variables Jolly itself uses to run this scenario; ` +
        `there is no test-only credential namespace.`,
    );
    return "skipped";
  }
});

After(async function (this: JollyWorld) {
  const failures = await this.cleanup.runAll();
  if (failures.length > 0) {
    this.log(
      `Teardown could not remove ${failures.length} resource(s): ` +
        failures.map((f) => `${f.description} (${f.error})`).join("; "),
    );
  }
});
