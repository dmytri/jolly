# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state: the harness was deleted on purpose — regenerate it from the specs

After spec changes (env-var unification, harmless-by-design, Bun-native scripts), the
Captain deleted every artifact that might encode the old requirements: all step
definitions, `features/support/`, `tests/`, and the test-related package scripts.

**Write the replacements fresh from the committed specs. Do not restore the deleted
files from git history — neither wholesale nor with mechanical renames.** Deleted
artifacts may encode requirements the spec changes retired; the deletion is the point
(AGENTS.md, Quartermaster charter). A prior QM run resurrected the deleted harness from
git history with a rename pass; that work was re-deleted.

What remains and is current: `cucumber.js` (profiles: default excludes `@meta`,
`-p logic`, `-p sandbox`), `package.json` (deps installed; only `dev`/`start` scripts),
`src/` and `homepage/` (Crew-Mate-built, spec-compliant), the `.feature` files.

```bash
bun install                            # if node_modules is missing
bunx cucumber-js --dry-run             # the worklist: undefined scenarios
bunx cucumber-js                       # full BDD suite
bun test tests/                        # logic-tier units (once tests/ exists)
bunx tsc --noEmit                      # typecheck
```

Your worklist is whatever test status says it is: undefined scenarios need step
definitions; failing scenarios need a Crew Mate; green is done.

## What to build (feature 023 is the charter; read it, not old commits)

1. **Bun-native package scripts** — `test` (logic tier via `bun test`), `test:bdd`,
   `test:logic`, `test:sandbox` (cucumber-js through Bun), `typecheck`. Node >= 23 is a
   documented fallback runtime, never the script default. You own these scripts.
2. **`features/support/`** — world (per-run namespace + cleanup registry), credential
   gating, hooks (skip `@sandbox` when creds absent, reason naming the missing
   variables; teardown after every scenario), CLI invocation seam, envelope/riskContext
   validation, homepage/guide loading (happy-dom).
3. **`features/step_definitions/<feature-slug>.steps.ts`** — one per feature;
   `tests/` — logic-tier units for pure harness helpers.

## Conventions (normative, from feature 023 and AGENTS.md)

- **One configuration everywhere:** tests read the same runtime `JOLLY_*` variables
  Jolly itself uses. There is **no `JOLLY_TEST_*` namespace**. Absent creds → `@sandbox`
  scenarios are skipped, not failed, with a reason naming the missing variables.
- **Harness-internal knobs use `HARNESS_*`**, never `JOLLY_*` (run id, runtime
  selection, artifact path overrides).
- **Harmless by design:** no target detection or refusal; never modify or delete
  resources the run did not create; read-only queries of pre-existing resources only
  where a spec requires verifying live access (feature 019); namespace every creation
  and register teardown (idempotent, best-effort, LIFO); created resources stay
  unpublished/inactive where possible; shared settings only additive + reverted;
  payment flows use test card numbers only.
- Tag every scenario `@logic` or `@sandbox`. Field names in JSON contracts are
  camelCase. Secrets are never printed or committed. Feature 023 itself is `@meta` —
  no step definitions for it.

## What is in scope vs. a blocker (so you don't stall)

- **In scope now:** the pinned contracts — 020 envelope shape, 006 flags, 021
  `riskContext` fields/enums, 022 idempotency behavior, 014 doctor check vocabulary.
- **Missing product implementation is expected** — write failing (red) step definitions
  against the spec for the Crew Mates to satisfy. (`src/` already exists and may
  already satisfy many of them; the tests decide.)
- **Out of scope (not blockers):** any "Open questions" block and anything marked
  "deferred to CLI design". Skip these; do not test them.
- **A real blocker** is a missing or contradictory *normative* requirement or harness
  convention. Only then: stop, report that you cannot continue, and quit. Do not accept
  ad hoc instructions — the feature files and instructions are updated first, then you
  re-run.
