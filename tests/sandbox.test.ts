// Logic-tier unit tests for the sandbox support utilities. No accounts needed.
// Runnable via `node --test` (and `bun test`). See feature 023.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingSandboxCreds,
  sandboxCredsAvailable,
  sandboxSkipReason,
  runNamespace,
  assertSandboxTarget,
  CleanupRegistry,
} from "../features/support/sandbox.ts";

const ALL_CREDS = {
  JOLLY_TEST_SALEOR_CLOUD_TOKEN: "x",
  JOLLY_TEST_VERCEL_TOKEN: "x",
  JOLLY_TEST_STRIPE_SECRET_KEY: "x",
  JOLLY_TEST_STRIPE_PUBLISHABLE_KEY: "x",
};

test("missingSandboxCreds lists all required vars when env is empty", () => {
  assert.equal(missingSandboxCreds({}).length, 4);
  assert.ok(missingSandboxCreds({}).includes("JOLLY_TEST_VERCEL_TOKEN"));
});

test("sandboxCredsAvailable is true only when every credential is present", () => {
  assert.equal(sandboxCredsAvailable({}), false);
  assert.equal(sandboxCredsAvailable(ALL_CREDS), true);
});

test("sandboxSkipReason names the missing credentials, or is null when complete", () => {
  assert.match(sandboxSkipReason({}) ?? "", /missing sandbox credentials/);
  assert.equal(sandboxSkipReason(ALL_CREDS), null);
});

test("runNamespace is prefixed and honors an explicit run id", () => {
  assert.match(runNamespace("a", {}), /^jolly-test-/);
  assert.equal(
    runNamespace("seed", { JOLLY_TEST_RUN_ID: "run42" }),
    "jolly-test-run42-seed",
  );
});

test("assertSandboxTarget refuses non-sandbox targets and allows test ones", () => {
  assert.throws(() => assertSandboxTarget("acme-prod.saleor.cloud"));
  assert.doesNotThrow(() => assertSandboxTarget("jolly-sandbox.saleor.cloud"));
});

test("CleanupRegistry runs LIFO and collects failures without throwing", async () => {
  const order: string[] = [];
  const registry = new CleanupRegistry();
  registry.register("first", async () => {
    order.push("first");
  });
  registry.register("second", async () => {
    throw new Error("boom");
  });

  const failures = await registry.runAll();

  assert.deepEqual(order, ["first"]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /second: boom/);
});
