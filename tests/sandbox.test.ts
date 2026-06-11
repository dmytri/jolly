// Logic-tier unit tests for the sandbox support utilities. No accounts needed.
// Runnable via `node --test` (and `bun test`). See feature 023.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingSandboxCreds,
  sandboxCredsAvailable,
  sandboxSkipReason,
  runNamespace,
  sandboxRuntimeEnv,
  sandboxSecretValues,
  CleanupRegistry,
} from "../features/support/sandbox.ts";

// Tests read the same runtime JOLLY_* variables Jolly itself uses (feature
// 023); there is no JOLLY_TEST_* namespace.
const ALL_CREDS = {
  JOLLY_SALEOR_CLOUD_TOKEN: "x",
  JOLLY_VERCEL_TOKEN: "x",
  JOLLY_STRIPE_SECRET_KEY: "x",
  JOLLY_STRIPE_PUBLISHABLE_KEY: "x",
};

test("missingSandboxCreds lists all required vars when env is empty", () => {
  assert.equal(missingSandboxCreds({}).length, 4);
  assert.ok(missingSandboxCreds({}).includes("JOLLY_VERCEL_TOKEN"));
});

test("required credentials use runtime JOLLY_* names, never JOLLY_TEST_*", () => {
  for (const name of missingSandboxCreds({})) {
    assert.match(name, /^JOLLY_/);
    assert.doesNotMatch(name, /^JOLLY_TEST_/);
  }
});

test("sandboxCredsAvailable is true only when every credential is present", () => {
  assert.equal(sandboxCredsAvailable({}), false);
  assert.equal(sandboxCredsAvailable(ALL_CREDS), true);
});

test("sandboxSkipReason names the missing credentials, or is null when complete", () => {
  assert.match(sandboxSkipReason({}) ?? "", /missing sandbox credentials/);
  assert.match(sandboxSkipReason({}) ?? "", /JOLLY_SALEOR_CLOUD_TOKEN/);
  assert.equal(sandboxSkipReason(ALL_CREDS), null);
});

test("runNamespace is prefixed and honors the HARNESS_RUN_ID knob", () => {
  assert.match(runNamespace("a", {}), /^jolly-test-/);
  assert.equal(
    runNamespace("seed", { HARNESS_RUN_ID: "run42" }),
    "jolly-test-run42-seed",
  );
});

test("sandboxRuntimeEnv passes recognized JOLLY_* vars through unchanged", () => {
  const env = { ...ALL_CREDS, JOLLY_SALEOR_URL: "https://x.saleor.cloud/graphql/", UNRELATED: "y" };
  const runtime = sandboxRuntimeEnv(env);
  assert.equal(runtime.JOLLY_VERCEL_TOKEN, "x");
  assert.equal(runtime.JOLLY_SALEOR_URL, "https://x.saleor.cloud/graphql/");
  assert.ok(!("UNRELATED" in runtime));
  assert.deepEqual(sandboxRuntimeEnv({}), {});
});

test("sandboxSecretValues includes tokens but never the store URL", () => {
  const env = {
    ...ALL_CREDS,
    JOLLY_SALEOR_APP_TOKEN: "app-token",
    JOLLY_SALEOR_URL: "https://x.saleor.cloud/graphql/",
  };
  const secrets = sandboxSecretValues(env);
  assert.ok(secrets.includes("app-token"));
  assert.ok(!secrets.includes("https://x.saleor.cloud/graphql/"));
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

test("CleanupRegistry is idempotent: a second runAll is a no-op", async () => {
  let runs = 0;
  const registry = new CleanupRegistry();
  registry.register("once", async () => {
    runs++;
  });
  await registry.runAll();
  await registry.runAll();
  assert.equal(runs, 1);
});
