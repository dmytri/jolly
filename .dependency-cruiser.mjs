// Boundary scantling (Captain-owned, referenced from
// features/module-boundary-conformance.feature). Encodes two invariants
// already held by convention in the real import graph:
//   - src/lib/* (leaf utilities) never imports src/index.ts (orchestration).
//   - src/** (production) never imports features/support or
//     features/step_definitions (verification code), so test/harness code
//     can never leak into the shipped dist/index.js bundle.
export default {
  forbidden: [
    {
      name: "lib-no-index",
      severity: "error",
      comment: "src/lib is leaf-level; only src/index.ts may depend on it, never the reverse.",
      from: { path: "^src/lib" },
      to: { path: "^src/index\\.ts$" },
    },
    {
      name: "production-no-verification",
      severity: "error",
      comment: "Production code must never import verification/test support code.",
      from: { path: "^src" },
      to: { path: "^features/(support|step_definitions)" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
