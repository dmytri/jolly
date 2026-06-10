# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: turn the committed `.feature` specs into
executable test coverage. You read only repository files, do not converse with anyone, and
write tests — not production code. The full charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

## What is already set up (start from green)

The harness is installed and verified:

```bash
npm install        # dev deps: @cucumber/cucumber, happy-dom, typescript, @types/node
npm test           # logic-tier unit tests (node --test) — currently 6/6 green
npx cucumber-js    # BDD suite — currently 69 scenarios, all UNDEFINED (your worklist)
npx tsc --noEmit   # typecheck — green
```

- `cucumber.js` — profiles: default (all), `-p logic` (`@logic`), `-p sandbox` (`@sandbox`).
- `features/support/` — `world.ts` (per-run namespace + cleanup registry), `hooks.ts`
  (skips `@sandbox` when creds absent; runs teardown), `sandbox.ts` (credential gating,
  isolation, non-prod safety guard). Covered by `tests/sandbox.test.ts`.
- `features/step_definitions/` — empty; this is where your step definitions go.
- `tests/` — logic-tier unit tests (`node --test` / `bun test`).

## The strategy: sandbox over mocks (feature 023)

- **Logic tier** (`@logic`, no accounts): pure local behavior — output-envelope shaping
  (020), flag parsing (006), URL normalization (012), risk-context construction (021).
- **Sandbox tier** (`@sandbox`): real dedicated test accounts via `JOLLY_TEST_*` env vars
  (Saleor Cloud, Configurator, Vercel, Stripe **test mode**). Absent creds → scenario is
  **skipped, not failed**. Namespace every created resource with `world.namespace`,
  register teardown on `world.cleanup`, and never target a non-sandbox account.
- Use mocks only for conditions a sandbox cannot produce (injected failures, etc.).

## Conventions

- One step-definition file per feature: `features/step_definitions/<feature-slug>.steps.ts`.
- Tag scenarios `@logic` or `@sandbox` as you implement them.
- Field names in JSON contracts are **camelCase** (e.g. `nextSteps`, `riskLevel`).
- Secrets/credentials are never printed or committed.

## What is in scope vs. a blocker (so you don't stall)

- **In scope now:** the pinned contracts — 020 envelope shape, 006 flags, 021 `riskContext`
  fields/enums, 022 idempotency behavior, 014 doctor check vocabulary.
- **Missing product implementation is expected** — write failing (red) step definitions
  against the spec for the Crew Mates to satisfy.
- **Out of scope (not blockers):** any "Open questions" block and anything marked
  "deferred to CLI design". Skip these; do not test them.
- **A real blocker** is a missing or contradictory *normative* requirement or harness
  convention. Only then: stop, report that you cannot continue, and quit. Do not accept ad
  hoc instructions — the feature files and instructions are updated first, then you re-run.

## Suggested first pass

1. Logic-tier step defs for the contract surfaces (020 → 021 → 022 → 006), plus matching
   `tests/` unit tests for any pure helpers you factor out.
2. Sandbox-tier red step defs for the end-to-end flows (002, 004, 005, 012), gated on
   `JOLLY_TEST_*`, using `world.namespace` + `world.cleanup`.
3. Keep `features/<slug>` ↔ `step_definitions/<slug>.steps.ts` traceability complete.
