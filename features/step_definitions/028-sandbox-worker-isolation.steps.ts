// Feature 028: sandbox worker isolation (@logic @property).
//
// Makes the AGENTS.md "Sandbox harness mechanics" per-worker isolation clause
// executable: two parallel workers must derive DIFFERENT jolly-cannon-fodder-
// namespaced names for the Saleor environment they provision and the Vercel
// project they deploy to, so concurrent load never lands on one shared store and
// one worker's teardown never removes another worker's live resource.
//
// The seam under test is workerNamespace(workerId) — the exact per-worker
// namespace the provisioner uses for its --name (features/support/provision.ts)
// and the deploy steps pass as JOLLY_VERCEL_PROJECT (features 002, 027). A
// harness that pinned every worker onto one shared per-run name would derive the
// same name twice and fail here.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { workerNamespace } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

// Two distinct cucumber worker ids, the shape CUCUMBER_WORKER_ID carries.
const WORKER_A = "0";
const WORKER_B = "1";

Given(
  "the @sandbox provisioner running under two different worker ids",
  function (this: JollyWorld) {
    this.notes.workerIds = [WORKER_A, WORKER_B];
  },
);

Given(
  "the @sandbox harness running under two different worker ids",
  function (this: JollyWorld) {
    this.notes.workerIds = [WORKER_A, WORKER_B];
  },
);

When(
  "each worker derives the Saleor environment it provisions",
  function (this: JollyWorld) {
    const [a, b] = this.notes.workerIds as [string, string];
    this.notes.derivedNames = [workerNamespace(a), workerNamespace(b)];
  },
);

When(
  "each worker derives the Vercel project it deploys to",
  function (this: JollyWorld) {
    const [a, b] = this.notes.workerIds as [string, string];
    this.notes.derivedNames = [workerNamespace(a), workerNamespace(b)];
  },
);

Then(
  "the two workers derive different jolly-cannon-fodder-namespaced environment names",
  function (this: JollyWorld) {
    assertDistinctNamespacedNames(this.notes.derivedNames as [string, string]);
  },
);

Then(
  "the two workers derive different jolly-cannon-fodder-namespaced Vercel project names",
  function (this: JollyWorld) {
    assertDistinctNamespacedNames(this.notes.derivedNames as [string, string]);
  },
);

// Scenario 3: the @sandbox tier's run profiles serialize the licensed spends
// (@pipeline and @creates-env, per feature verification-economy's licence Rule)
// and run the light remainder in parallel. The seam under test is cucumber.js's
// exported run profiles (the "test tiers and harness mechanics" config).
// Importing the config module enumerates its real profile objects.
interface CucumberProfile {
  tags?: string;
  parallel?: number;
}

Given(
  "the project's cucumber run profiles",
  async function (this: JollyWorld) {
    const configUrl = new URL("../../cucumber.js", import.meta.url);
    const mod = (await import(configUrl.href)) as Record<string, unknown>;
    const profiles: Record<string, CucumberProfile> = {};
    for (const [name, value] of Object.entries(mod)) {
      if (value && typeof value === "object" && "tags" in (value as object)) {
        profiles[name] = value as CucumberProfile;
      }
    }
    this.notes.profiles = profiles;
  },
);

When(
  "the @sandbox run profiles are enumerated",
  function (this: JollyWorld) {
    const profiles = this.notes.profiles as Record<string, CucumberProfile>;
    this.notes.sandboxProfiles = Object.entries(profiles).filter(
      ([, p]) => typeof p.tags === "string" && p.tags.includes("@sandbox"),
    );
  },
);

Then(
  "the parallel @sandbox profile runs its workers in parallel and excludes the @pipeline and @creates-env scenarios",
  function (this: JollyWorld) {
    const sandboxProfiles = this.notes.sandboxProfiles as [
      string,
      CucumberProfile,
    ][];
    const parallel = sandboxProfiles.filter(
      ([, p]) => typeof p.parallel === "number" && p.parallel >= 2,
    );
    assert.equal(
      parallel.length,
      1,
      `expected exactly one parallel @sandbox profile, found ${parallel.length}: ` +
        JSON.stringify(sandboxProfiles),
    );
    const [name, profile] = parallel[0];
    for (const licensed of ["@pipeline", "@creates-env"]) {
      assert.ok(
        profile.tags!.includes(`not ${licensed}`),
        `parallel @sandbox profile "${name}" tags "${profile.tags}" do not ` +
          `exclude the licensed ${licensed} scenarios`,
      );
    }
  },
);

Then(
  "a separate profile runs the @pipeline and @creates-env scenarios serially",
  function (this: JollyWorld) {
    const sandboxProfiles = this.notes.sandboxProfiles as [
      string,
      CucumberProfile,
    ][];
    const serial = sandboxProfiles.filter(
      ([, p]) =>
        typeof p.tags === "string" &&
        p.tags.includes("@pipeline") &&
        !p.tags.includes("not @pipeline") &&
        p.tags.includes("@creates-env") &&
        !p.tags.includes("not @creates-env"),
    );
    assert.equal(
      serial.length,
      1,
      `expected exactly one licensed-serial @sandbox profile selecting the ` +
        `@pipeline and @creates-env scenarios, found ${serial.length}: ` +
        JSON.stringify(sandboxProfiles),
    );
    const [name, profile] = serial[0];
    const workers = profile.parallel ?? 1;
    assert.ok(
      workers <= 1,
      `licensed @sandbox profile "${name}" runs ${workers} workers in parallel; ` +
        `the @pipeline and @creates-env scenarios must run serially`,
    );
  },
);

function assertDistinctNamespacedNames([a, b]: [string, string]): void {
  assert.ok(
    a.startsWith("jolly-cannon-fodder-"),
    `first worker's derived name is not jolly-cannon-fodder-namespaced: "${a}"`,
  );
  assert.ok(
    b.startsWith("jolly-cannon-fodder-"),
    `second worker's derived name is not jolly-cannon-fodder-namespaced: "${b}"`,
  );
  assert.notEqual(
    a,
    b,
    `the two workers derived the same name "${a}" — they share one resource ` +
      `instead of isolating per worker`,
  );
}
