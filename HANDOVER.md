# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state: harness regenerated fresh from the specs (2026-06-11)

After the Captain's spec changes (env-var unification, harmless-by-design, Bun-native
scripts) and deletion of the old harness, the harness was regenerated **fresh from the
committed specs** per the no-resurrection rule. Current status:

- `bunx cucumber-js --dry-run`: 63 scenarios, 516 steps, **0 undefined**.
- `bun run test:bdd`: 39 `@logic` scenarios pass; 24 `@sandbox` scenarios skip locally
  (runtime `JOLLY_*` credentials absent — that is the designed behavior, not a failure).
- `bun run test` (44 logic-tier units) and `bun run typecheck` are green.
- The Crew-Mate-built `src/` and `homepage/` satisfy every locally actionable scenario;
  no Crew Mate dispatch was needed. The `@sandbox` tier has not yet run against real
  accounts — CI (or any environment with the runtime `JOLLY_*` variables) exercises it.

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
  - `homepage.ts` — happy-dom loading of `homepage/index.html` + `setup-guide.md`;
    copy-box convention: `[data-jolly-copy-box]`/`[data-jolly-agent-prompt]`, falling
    back to the phrase "copy this to your agent to get started" and the nearest
    textarea/pre/code.
  - `saleor-graphql.ts` — minimal client for spec-required live-access checks (019) and
    the one namespaced mutation check (category create + registered delete).
- `features/step_definitions/<slug>.steps.ts` — one per feature (001–022, no 023: it is
  `@meta`). Step text shared between features is defined once, in the lowest-numbered
  feature's file, with a comment in the other file.
- `tests/` — logic-tier units for harness machinery (`sandbox.test.ts`,
  `envelope.test.ts`) and the pinned `src/lib` seams (`saleor-url.test.ts`,
  `env-file.test.ts`: `normalizeSaleorUrl`, `writeEnvValues`/`loadEnvValues`).

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

## What is in scope vs. a blocker (so you don't stall)

- **In scope now:** the pinned contracts — 020 envelope shape, 006 flags, 021
  `riskContext` fields/enums, 022 idempotency behavior, 014 doctor check vocabulary.
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
