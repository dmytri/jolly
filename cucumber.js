// Cucumber.js configuration. See features/023-test-architecture.feature.
// Step definitions and support code are TypeScript, loaded directly (Bun
// runs TS natively; Node >= 23 strips types on import).
const common = {
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
  paths: ["features/**/*.feature"],
};

// Default: the product worklist. Excludes @meta (the test-architecture spec,
// feature 023, which describes the harness rather than product behavior).
// @sandbox scenarios self-skip when JOLLY_TEST_* credentials are absent
// (see features/support/hooks.ts).
export default { ...common, tags: "not @meta" };

// Targeted profiles: `cucumber-js -p logic` / `-p sandbox`.
export const logic = { ...common, tags: "@logic" };
export const sandbox = { ...common, tags: "@sandbox" };
