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
