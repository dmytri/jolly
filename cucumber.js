// Cucumber.js configuration. See AGENTS.md (test tiers and harness mechanics).
// Step definitions and support code are TypeScript, loaded directly under
// native Node >= 23, which strips types on import (these project files are
// not under node_modules). Dev/CI run on Node >= 23 + npm.
// No explicit `paths`: cucumber's default is features/**/*.feature, and
// leaving it unset lets `npx cucumber-js <file>[:line]` target a single
// feature or scenario.
// A run-wide id shared by every parallel worker. The main process sets it here
// on config load and the worker child processes inherit it, keeping it via `??=`.
// The @sandbox provisioner namespaces each worker's store by this run id plus the
// worker id, so concurrent workers reclaim and tear down only their own
// environment, never a sibling's live store (features/support/provision.ts).
process.env.HARNESS_RUN_ID ??= `run-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

const common = {
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
};

// Default: the product worklist. Excludes @eval (the opt-in skill-behavior
// affordance evaluation, feature 025, which drives a live baseline agent —
// non-deterministic, credentialed, slow, and never a green/red gate). @sandbox
// scenarios self-skip when the runtime JOLLY_* credentials they need are absent
// (see features/support/hooks.ts) — there is no test-only credential namespace;
// @eval self-skips without its model key.
export default { ...common, tags: "not @eval" };

// Targeted profiles: `cucumber-js -p logic` / `-p sandbox` / `-p eval`.
// The logic tier is pure local behavior with no shared external state, so it runs
// in parallel for fast status/worklist feedback. The sandbox tier provisions ONE
// shared Saleor environment for the whole run (features/support/provision.ts):
// the lock winner creates it, every other worker reuses its derived values, so
// the run holds a single env slot and the org's second slot stays free for the
// few env-creating scenarios. That decouples the worker count from the 2-env cap.
// The real ceiling then is the free Saleor instance's tolerance for CONCURRENT
// load, not CPU or the env budget. MEASURED against this org: parallel:4 -> 11
// failures, parallel:2 -> 8, SERIAL -> 0 (42 pass). The heavy scenarios (full
// `jolly start` deploys + store queries) hammer the single shared instance until
// it goes not-serving (persistent 404 / "unable to connect"), which no retry
// budget fixes because it is sustained, not momentary. So @sandbox runs SERIAL:
// reliable-and-slower (~48m) beats flaky-and-fast, which just means re-runs. The
// shared-store fix makes serial affordable (no per-scenario provisioning). Push
// parallel only behind a paid instance or a heavy/light phase split.
export const logic = { ...common, tags: "@logic", parallel: 2 };
export const sandbox = { ...common, tags: "@sandbox", parallel: 1 };

// The eval profile runs ONLY the opt-in @eval tier (feature 025). `eval` is a
// reserved identifier, so it is exported under that name via an alias.
const evalProfile = { ...common, tags: "@eval" };
export { evalProfile as eval };
