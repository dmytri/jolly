# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state: fresh homepage spec, stale artifacts deleted (2026-06-11)

The Captain redesigned the homepage spec: new tagline ("Ahoy, agent. Go build a store."),
one-line copy box (moltbook-style), dark pirate hacker visual direction, and a simplified
agent flow where `jolly start` auto-installs all skills (no separate optional install step).
All impacted artifacts were deleted — step definitions, homepage HTML, setup guide, CLI
entry, agent-assets lib — so you must regenerate them fresh from the updated specs.

Current status:

- `bunx cucumber-js --dry-run`: 63 scenarios (31 undefined, 32 skipped), 520 steps.
  The 31 undefined scenarios are your worklist: 7 feature files lost their step definitions.
- `bun test` (44 logic-tier units) and `bun run typecheck` are still green — the
  `src/lib/` utility modules (`env-file.ts`, `saleor-url.ts`) and `tests/` units were
  not impacted by the homepage changes.
- The 32 skipped scenarios are the `@sandbox` tier (runtime credentials absent locally).
- All `src/` and `homepage/` implementation artifacts were deleted and need regeneration.

## Layout (feature 023 is the charter)

- `package.json` scripts (QM-owned, Bun-native): `test` (bun test on `tests/`),
  `test:bdd`, `test:logic`, `test:sandbox` (cucumber-js via `bun x --bun`), `typecheck`.
  Node >= 23 is a documented fallback runtime, never the script default.
- `cucumber.js`: default profile excludes `@meta`; `-p logic` / `-p sandbox` target one
  tier. No explicit `paths`, so `bunx cucumber-js <file>[:line]` targets a single
  feature/scenario (use the `Scenario:` declaration line).
- `features/support/`:
  - `world.ts` — per-scenario world: CLI invocation seam (`runCli`, Bun by default,
    `HARNESS_CLI_RUNTIME` selects the Node fallback), lazy temp project dir, envelope
    accessor, secret tracking (`assertNoSecretsIn`).
  - `sandbox.ts` — credential groups on the runtime `JOLLY_*` names Jolly itself uses
    (no `JOLLY_TEST_*`), per-scenario requirement map (`SANDBOX_REQUIREMENTS`, keyed by
    scenario name; unmapped @sandbox scenarios require all groups), per-run id
    (`HARNESS_RUN_ID` override) + `jolly-test-<id>` namespace, LIFO best-effort
    `CleanupRegistry`.
  - `hooks.ts` — Before(@sandbox) skips (never fails) with a reason naming the missing
    variables; After runs teardown and reports anything it could not remove.
  - `envelope.ts` — feature 020/021 validators (envelope shape, camelCase, doctor check
    vocabulary, riskContext shape/categories) and JSON extraction from mixed output.
  - `homepage.ts` was deleted (stale — loaded old homepage/setup-guide HTML).
    The QM must recreate it for the new homepage implementation.
  - `saleor-graphql.ts` — minimal client for spec-required live-access checks (019) and
    the one namespaced mutation check (category create + registered delete). Unchanged.
- `features/step_definitions/` — **step definitions for 7 features were deleted** because
  their specs changed or they referenced deleted artifacts. The QM must regenerate them:
  001, 002, 003, 005, 007, 009, 010, 016. All other feature step definitions remain intact.
- `tests/` — logic-tier units for harness machinery (`sandbox.test.ts`,
  `envelope.test.ts`) and the pinned `src/lib` seams (`saleor-url.test.ts`,
  `env-file.test.ts`: `normalizeSaleorUrl`, `writeEnvValues`/`loadEnvValues`). Unchanged.

## Conventions (normative, from feature 023 and AGENTS.md)

- **One configuration everywhere:** tests read the same runtime variables Jolly itself
  uses: `NEXT_PUBLIC_SALEOR_API_URL`, `JOLLY_SALEOR_APP_TOKEN`, `JOLLY_SALEOR_CLOUD_TOKEN`,
  `JOLLY_VERCEL_TOKEN`, `JOLLY_STRIPE_PUBLISHABLE_KEY`, `JOLLY_STRIPE_SECRET_KEY`.
  Absent creds → `@sandbox` scenarios are skipped, not failed, naming the missing
  variables. There is **no `JOLLY_TEST_*` namespace**.
- **Harness-internal knobs use `HARNESS_*`** (`HARNESS_RUN_ID`, `HARNESS_CLI_RUNTIME`),
  never `JOLLY_*`.
- **Harmless by design:** no target detection or refusal; never modify or delete
  resources the run did not create; read-only queries of pre-existing resources only
  where a spec requires live-access verification (feature 019); namespace every creation
  and register teardown (idempotent, best-effort, LIFO); recipe/payment paths are
  exercised via `--dry-run` previews; remote resources the harness cannot remove are
  reported by namespaced identifier in teardown.
- Tag every scenario `@logic` or `@sandbox` (the Captain's feature files already do).
  Field names in JSON contracts are camelCase. Secrets are never printed or committed.

## Key spec changes from the Captain session

1. **Tagline:** Changed from "Saleor's Hydrogen for the agentic age" to "Ahoy, agent. Go build a store."
2. **Copy box:** Now a single line: `Read https://jolly.dev/setup and follow the instructions to set up Jolly`
   — like moltbook.com, not a numbered list. Must have a clickable copy button.
3. **Visual direction:** Dark neon/hacker aesthetic (swamp.club) + heavy pirate/swashbuckling personality
   + Saleor.io polish. Jolly Roger logo, XO mark, gold/amber accent, CRT scan lines, pirate emoji.
4. **Agent flow simplified:** Skills are auto-installed by `jolly start`. No separate optional
   `jolly init` or `jolly skills install` step for the agent. The CLI handles it.
5. **Setup guide:** SKILL.md-style (like moltbook.com/skill.md) — points the agent at
   `npx @saleor/jolly start`. Full workflow and MCP server details live there, not on the homepage.
6. **Homepage flow section:** 4 short items with pirate emoji bullets (see feature 016).
7. **No scope/boundaries footer** on the homepage — let the product speak for itself.

## What is in scope vs. a blocker (so you don't stall)

- **In scope now:** the pinned contracts — 020 envelope shape, 006 flags, 021
  `riskContext` fields/enums, 022 idempotency behavior, 014 doctor check vocabulary.
  Also the new homepage spec (016) and updated agent flow (001).
- **Your worklist (undefined scenarios):** 31 undefined scenarios across 8 feature files:
  001, 002, 003, 005, 007, 009, 010, 016. Write step definitions for these, then dispatch
  Crew Mates to implement the failing `src/` and `homepage/` artifacts.
- **Missing product implementation is expected** — failing scenarios get a Crew Mate
  (`.claude/agents/crew-mate.md`), pointed at the failing scenario, not given novel
  product instructions.
- **Out of scope (not blockers):** "Open questions" blocks and anything "deferred to
  CLI design". Environment-dependent branches ("where possible"/"where APIs allow")
  are conditionally skipped inside steps, not failed.
- **A real blocker** is a missing or contradictory *normative* requirement or harness
  convention. Only then: stop, report that you cannot continue, and quit. Do not accept
  ad hoc instructions — the feature files and instructions are updated first, then you
  re-run.
