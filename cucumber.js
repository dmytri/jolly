// Cucumber.js configuration. See features/023-test-architecture.feature.
// Step definitions and support code are TypeScript, loaded directly (Bun
// runs TS natively; Node >= 23 strips types on import).
const common = {
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
  paths: ["features/**/*.feature"],
};

// Default: run everything. @sandbox scenarios self-skip when JOLLY_TEST_*
// credentials are absent (see features/support/hooks.ts).
export default common;

// Targeted profiles: `cucumber-js -p logic` / `-p sandbox`.
export const logic = { ...common, tags: "@logic" };
export const sandbox = { ...common, tags: "@sandbox" };
