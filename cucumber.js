// Cucumber.js configuration. See features/023-test-architecture.feature.
// Step definitions and support code are TypeScript, loaded directly under
// native Node >= 23, which strips types on import (these project files are
// not under node_modules). Dev/CI run on Node + npm (Bun dropped 2026-06-13).
// No explicit `paths`: cucumber's default is features/**/*.feature, and
// leaving it unset lets `npx cucumber-js <file>[:line]` target a single
// feature or scenario.
const common = {
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
};

// Default: the product worklist. Excludes @meta (the test-architecture spec,
// feature 023, which describes the harness rather than product behavior).
// @sandbox scenarios self-skip when the runtime JOLLY_* credentials they need
// are absent (see features/support/hooks.ts) — there is no test-only
// credential namespace.
export default { ...common, tags: "not @meta" };

// Targeted profiles: `cucumber-js -p logic` / `-p sandbox`.
export const logic = { ...common, tags: "@logic" };
export const sandbox = { ...common, tags: "@sandbox" };
