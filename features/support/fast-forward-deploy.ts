// Shared fast-forward-to-deploy setup for `@sandbox @heavy` `jolly start`
// scenarios whose behaviour under test lives at or after the Vercel deploy
// stage (feature 002's Vercel-sign-in scenarios, feature 005's Stripe
// app-install stage). Reaching those stages via a REAL full `jolly start` would
// pay a fresh store provision + real Paper clone + real Vercel deploy every run,
// none of which is those scenarios' behaviour under test (the store provision +
// cold-start gate is covered for real by 002/012/026, the Paper clone/install by
// 002/029, and the real Vercel deploy by 002/029). This module is the
// minimal-sufficient setup (AGENTS.md Verification "Reuse" clause) that lets such
// a run reach its real stage cheaply — never a fake of the assertion.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "./world.ts";

/**
 * Fast-forward the store + storefront stages of a real `jolly start` so a
 * @heavy scenario reaches the REAL deploy (and later stripe) stage cheaply —
 * without a fresh store provision + real Paper clone, neither of which is the
 * behaviour under test for the consumers of this helper (the store provision +
 * cold-start gate is covered for real by 002:41/002:51, the Paper clone/install
 * by 002:90/002:103 and feature 029). This is minimal-sufficient setup, not a
 * fake of the assertion: the deploy stage's real no-Vercel-session sign-in gate
 * (and, for feature 005, the real Stripe appInstall) is still exercised for real.
 *
 * Mirrors 002:41's neutralization (the "When the store stage runs" step):
 *   - write the shared @sandbox store's endpoint + token (surfaced into
 *     process.env by the @sandbox Before hook → provision.ts) into the project
 *     `.env`, so runStoreStage sees an already-configured NEXT_PUBLIC_SALEOR_API_URL
 *     and REUSES it — it returns the store stage `completed` without any Cloud API
 *     `create` (src/index.ts runStoreStage: an existing endpoint short-circuits to
 *     reuse before the provision path; runStartCore's already-satisfied store skip);
 *   - pre-create storefront/ + node_modules + package.json so runStorefrontStage
 *     takes its idempotent reuse path and skips the real `git clone` + `pnpm install`
 *     (src/index.ts runStorefrontStage: node_modules + package.json present ⇒
 *     "Reused the already-cloned storefront/" ⇒ completed).
 * The store(reuse) → storefront(present) → recipe/stock(idempotent reconcile
 * against the shared store) → deploy(sign-in gate) → stripe(real appInstall)
 * chain then runs cheaply.
 */
export function prepareFastForwardDeployStart(world: JollyWorld): void {
  const endpoint = process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  const token = process.env["SALEOR_TOKEN"];
  assert.ok(
    endpoint && token,
    "the @sandbox Before hook must have provisioned the shared store " +
      "(NEXT_PUBLIC_SALEOR_API_URL + SALEOR_TOKEN in process.env) so the store " +
      "stage can reuse it instead of provisioning a fresh one",
  );
  // Reuse the shared store: an already-configured endpoint (mirrored to SALEOR_URL)
  // plus its SALEOR_TOKEN in .env makes runStoreStage report the store stage
  // completed without provisioning, and lets the recipe/stock stages reconcile.
  writeEnvValues(world.projectDir, {
    NEXT_PUBLIC_SALEOR_API_URL: endpoint!,
    SALEOR_URL: endpoint!,
    SALEOR_TOKEN: token!,
  });
  // Skip the real Paper clone: a present storefront/ with node_modules +
  // package.json takes runStorefrontStage's idempotent reuse path.
  const storefront = join(world.projectDir, "storefront");
  mkdirSync(join(storefront, "node_modules"), { recursive: true });
  writeFileSync(
    join(storefront, "package.json"),
    JSON.stringify({ name: "paper", version: "0.0.0" }),
  );
}

/**
 * Point the Vercel CLI at an isolated, session-less config so the deploy stage
 * finds NO signed-in Vercel session and returns its pending sign-in gate fast
 * (no real deploy). Real, producible no-session condition (real-by-default, not a
 * double): fresh, empty XDG config/data dirs under the scenario temp root (removed
 * in teardown) hold no auth.json, so `vercel whoami`/`vercel login` find no
 * credentials. The fragment propagates through `jolly` to the `vercel` CLI it
 * spawns (runCli merges it into the child env; Jolly spawns vercel with its own
 * process env). Stashed on notes.vercelXdg (shared with feature 014's no-session
 * vercel-auth scenario) and returned so the caller can merge it into the run env.
 */
export function isolatedVercelXdg(world: JollyWorld): Record<string, string> {
  const dir = world.newTempDir("vercel-config");
  const xdg = {
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_DATA_HOME: join(dir, "data"),
  };
  world.notes.vercelXdg = xdg;
  return xdg;
}
