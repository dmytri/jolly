// Load the repository .env into process.env for the test run.
//
// Bun auto-loaded .env; native Node does not (decision 2026-06-13: Bun dropped
// for dev/prod parity). The sandbox/provisioning harness reads the same runtime
// JOLLY_* credentials Jolly itself uses from process.env (feature 023, "one
// configuration everywhere"), so the suite must load .env the way Jolly's own
// CLI does. Parsing goes through Jolly's own loadEnvValues for consistency.
//
// Values already present in the environment WIN: CI exports real credentials
// as actual env vars, so this never overrides an explicit setting — it only
// fills in what a local .env provides. @logic scenarios remain safe regardless:
// they force dummy credentials over process.env via logicSafeEnv (the "012
// incident" lesson), exactly as they did when Bun pre-loaded the real .env.
//
// This module runs its side effect once, at support-code import time — before
// any Before hook or step reads process.env.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvValues } from "../../src/lib/env-file.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

for (const [key, value] of Object.entries(loadEnvValues(REPO_ROOT))) {
  if (process.env[key] === undefined && value !== undefined) {
    process.env[key] = value;
  }
}
