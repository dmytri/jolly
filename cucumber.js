// Cucumber.js configuration. See AGENTS.md (test tiers and harness mechanics).
// Step definitions and support code are TypeScript, loaded directly under
// native Node >= 23, which strips types on import (these project files are
// not under node_modules). Dev/CI run on Node >= 23 + npm.
// No explicit `paths`: cucumber's default is features/**/*.feature, and
// leaving it unset lets `npx cucumber-js <file>[:line]` target a single
// feature or scenario.
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
// in parallel for fast status/worklist feedback. The sandbox tier stays serial:
// parallel workers would race on the single shared per-run Saleor environment the
// harness provisions (see AGENTS.md, sandbox harness mechanics) — parallelize it
// only once that setup is guarded for concurrent workers.
export const logic = { ...common, tags: "@logic", parallel: 2 };
export const sandbox = { ...common, tags: "@sandbox" };

// The eval profile runs ONLY the opt-in @eval tier (feature 025). `eval` is a
// reserved identifier, so it is exported under that name via an alias.
const evalProfile = { ...common, tags: "@eval" };
export { evalProfile as eval };
