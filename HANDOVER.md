# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state (mostly green; scripts to regenerate)

The harness is rebuilt on the unified env-var convention (feature 023) and the suite is
green under Bun:

```bash
bun install                          # dev deps: @cucumber/cucumber, happy-dom, typescript, @types/node
bun test tests/                      # logic-tier unit tests — green
bun node_modules/.bin/cucumber-js    # BDD suite — 63 scenarios: @logic pass against src/;
                                     # @sandbox skip cleanly when JOLLY_* creds are absent
bun node_modules/.bin/tsc --noEmit   # typecheck — green
```

**Pending QM work:** feature 023 now pins **Bun-native package scripts** (`test`,
`test:bdd`, `test:logic`, `test:sandbox`, `typecheck`); the old node/npm-shaped scripts
were deleted with the spec change. Recreate them Bun-native (you own the Cucumber config
and test scripts). Node >= 23 stays a documented fallback runtime, never the script
default.

Your worklist is whatever test status says it is: `bunx cucumber-js --dry-run` →
undefined scenarios need step definitions; failing scenarios need a Crew Mate; green is
done. After a Captain spec change, expect deleted artifacts — regenerate them from the
updated specs (git history is reference material, but the committed specs win).

## Harness map

- `cucumber.js` — profiles: default (all, excludes `@meta`), `-p logic`, `-p sandbox`.
- `features/support/world.ts` — per-scenario `JollyWorld`: `namespace`, `cleanup`
  registry, throwaway `projectDir`, `jolly()` CLI runner.
- `features/support/sandbox.ts` — credential gating, per-run namespace, env passthrough,
  secret-value list, memoized cross-scenario runs, `CleanupRegistry` (LIFO, best-effort).
- `features/support/hooks.ts` — skips `@sandbox` when creds absent (reason names the
  missing variables); runs teardown after every scenario.
- `features/support/cli.ts` — spawns `src/index.ts` (Bun, else Node ≥ 23) with a minimal
  env; envelope extraction/validation seams. `features/support/envelope.ts` — feature
  020/021 validators. `features/support/homepage.ts` + `content.ts` — artifact discovery
  and DOM/content checks (happy-dom). `features/support/text.ts` — `lit()` literal step
  matcher.
- `features/step_definitions/<feature-slug>.steps.ts` — one per feature; `common.steps.ts`
  holds shared steps. `tests/` — logic-tier units for the harness seams.

## Conventions (feature 023 is the charter)

- **One configuration everywhere:** tests read the same runtime `JOLLY_*` variables Jolly
  itself uses — required: `JOLLY_SALEOR_CLOUD_TOKEN`, `JOLLY_VERCEL_TOKEN`,
  `JOLLY_STRIPE_SECRET_KEY`, `JOLLY_STRIPE_PUBLISHABLE_KEY`; optional (existing-store
  scenarios): `JOLLY_SALEOR_URL`, `JOLLY_SALEOR_APP_TOKEN`. There is **no `JOLLY_TEST_*`
  namespace**. Absent creds → `@sandbox` scenarios are skipped, not failed.
- **Harness-internal knobs use `HARNESS_*`**, never `JOLLY_*`: `HARNESS_RUN_ID`,
  `HARNESS_RUNTIME`, `HARNESS_HOMEPAGE_HTML`, `HARNESS_SETUP_GUIDE`.
- **Harmless by design:** no target detection or refusal; never touch resources the run
  did not create; namespace every creation (`world.namespace`) and register teardown on
  `world.cleanup`; created resources stay unpublished/inactive where possible; shared
  settings only additive + reverted; payment flows use test card numbers only.
- Tag every scenario `@logic` or `@sandbox`. Field names in JSON contracts are camelCase.
  Secrets are never printed or committed.

## What is in scope vs. a blocker (so you don't stall)

- **In scope now:** the pinned contracts — 020 envelope shape, 006 flags, 021
  `riskContext` fields/enums, 022 idempotency behavior, 014 doctor check vocabulary.
- **Missing product implementation is expected** — write failing (red) step definitions
  against the spec for the Crew Mates to satisfy.
- **Out of scope (not blockers):** any "Open questions" block and anything marked
  "deferred to CLI design". Skip these; do not test them.
- **A real blocker** is a missing or contradictory *normative* requirement or harness
  convention. Only then: stop, report that you cannot continue, and quit. Do not accept ad
  hoc instructions — the feature files and instructions are updated first, then you re-run.
