# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Jolly — "Ahoy, agent. Go build a store." A homepage + `npx` CLI + agent skills that
help a customer's own AI agent set up and iterate on an end-to-end commerce storefront on
Saleor Cloud. Agents are the primary consumers; human DX is secondary. The CLI empowers the
customer's agent rather than replacing it.

The project is **spec-driven and currently in planning mode**. Feature `.feature` files and
tests are the durable assets; application code is considered disposable and regenerated from
the specs. `src/` (CLI entry `src/index.ts`) and `homepage/` exist, built by Crew Mates and
driven by failing tests; they are deleted and regenerated whenever specs change.

**`AGENTS.md` is the authoritative charter.** Read it before doing substantive work; it owns
the product vision, V1 scope/boundaries, the pinned contracts (output envelope, risk context,
idempotency), and the three-role workflow. This file is the orientation layer; `AGENTS.md` is
the source of truth, and `HANDOVER.md` is the Quartermaster's starting brief.

## Commands

Runtime/package manager is **Bun**; TypeScript, ES modules. Step definitions and support code
are TypeScript loaded directly (Bun runs TS natively; Node ≥23 strips types on import).

Package scripts are **Bun-native** (feature 023); Node ≥23 is a fallback runtime only.

```bash
bun install            # dev deps (cucumber, happy-dom, typescript, @types/node)
bun test               # logic-tier unit tests on tests/**/*.test.ts
bun run test:bdd       # full BDD suite (cucumber-js); excludes @meta
bun run test:logic     # cucumber-js -p logic  → @logic scenarios only
bun run test:sandbox   # cucumber-js -p sandbox → @sandbox scenarios only
bun run typecheck      # tsc --noEmit
bun run start          # run the CLI
bun run dev            # run the CLI in watch mode
```

Run a single feature or scenario:

```bash
bunx cucumber-js features/020-cli-output-contract.feature        # one feature file
bunx cucumber-js features/020-cli-output-contract.feature:10     # one scenario by line number
bunx cucumber-js --dry-run                                       # list UNDEFINED scenarios (the worklist)
bun test tests/sandbox.test.ts                                   # one logic-tier test file
```

## Test architecture (feature 023)

Two tiers, sandbox over mocks:

- **Logic tier** (`@logic`, `tests/` + `@logic` cucumber scenarios): pure local behavior —
  output-envelope shaping, flag parsing, URL normalization, risk-context construction. No
  accounts; always runs.
- **Sandbox tier** (`@sandbox`): behavior touching Saleor Cloud, Configurator, Vercel, or
  Stripe, against real accounts via the **same runtime `JOLLY_*` env vars Jolly itself uses**
  — no test-only credential namespace. Whether those point at dedicated test accounts is the
  customer's choice; Jolly and the tests never know or check. When creds are absent the
  scenario is **skipped, not failed** (`features/support/hooks.ts`), so the suite always runs
  locally; CI supplies creds. Use mocks only for conditions a sandbox cannot produce.

Sandbox tests are **harmless by design** — safe against any store, production included: never
modify or delete resources the run didn't create (read-only queries of pre-existing resources
only where a spec demands live-access verification); namespace every created resource (unpublished/inactive
where possible) and register its teardown; shared settings only additive + reverted; payment
flows use test card numbers only. `features/support/` holds the machinery: `world.ts` gives
each run a `namespace` and a `cleanup` registry; `sandbox.ts` gates credentials, builds the
namespace, and runs LIFO best-effort teardown. No target detection or refusal. Harness-only
knobs use a `HARNESS_*` prefix, never `JOLLY_*`.

Layout convention: each `features/<slug>.feature` maps to
`features/step_definitions/<slug>.steps.ts`; shared hooks/world/sandbox setup go in
`features/support/`; logic-tier units go in `tests/`. Feature `023` is the harness charter,
tagged `@meta` and **excluded** from the BDD worklist — do not write step definitions for it.
DOM checks (homepage/storefront) use happy-dom.

## Pinned contracts (do not redesign without spec change)

- **Output envelope (020):** every command emits one envelope —
  `command`, `status` (`success`|`warning`|`error`), `summary`, `data`, `checks`,
  `nextSteps`, `errors`. `--json` ⇒ envelope-only on stdout; default adds human text;
  `--quiet` trims human text only. `checks[].status` ∈ pass|warning|fail|skipped|unknown.
  Field names are **camelCase**. Secrets are referenced by name, never printed.
- **Risk context (021):** before any create/modify/deploy/delete/expose action, emit a
  `riskContext` (`action`, `target`, `riskLevel` low|medium|high, `categories`, `reversible`,
  `sideEffects`, `dryRunAvailable`) inside the envelope; identical for `--dry-run` and real
  execution. Jolly never hardcodes the approval decision — the customer's agent decides.
- **Idempotency/resumability (022):** re-running any `jolly create` subcommand or
  `jolly start` is safe and creates no duplicates; `jolly start` skips satisfied stages.

## Three-role workflow (see AGENTS.md for the full charter)

New sessions continue from committed docs alone — assume no prior chat history.

- **Captain** (`/captain`): the only role that talks to humans. "Vibe codes" `.feature` files
  and agent instructions, resolves blockers raised by QM/Crew. Updates `AGENTS.md` on durable
  decisions. Never creates/edits tests, steps, or code — but **deletes** any of them a spec
  change even *might* invalidate: err on the side of deletion (code is disposable; git
  remembers; QM/Crew regenerate).
- **Quartermaster** (`/qm`): turns specs into executable tests; writes/maintains step
  definitions, fixtures, harness — **no production code**. Derives its worklist from test
  status (undefined → write step defs; failing → dispatch a Crew Mate; green → done), then
  launches `crew-mate` subagents to implement. Regenerates Captain-deleted coverage **fresh
  from the committed specs — never by restoring deleted files from git history**.
- **Crew Mate** (`/crew`, `.claude/agents/crew-mate.md`): implementation agent; makes a
  specified failing scenario pass with minimal `src/` code, strictly per the committed specs.

QM and Crew Mates **do not converse** and **must not accept ad hoc instructions**. When
blocked by a missing/contradictory normative requirement, they stop, report, and quit — the
fix is to update the feature files/instructions, then re-run. "Open questions" and anything
"deferred to CLI design" are non-normative and out of scope, not blockers.

## Secrets & environment

Local secrets live in `.env` (Git-ignored). Workflow credentials use `JOLLY_*`; generated
storefront runtime vars use the target project's names (e.g. Paper's
`NEXT_PUBLIC_SALEOR_API_URL`, `SALEOR_APP_TOKEN`). The same `JOLLY_*` names are used
everywhere — dev, tests, CI, prod; there is no `JOLLY_TEST_*` namespace. Never print secret
values; ensure `.env` is ignored before writing to it.

## Saleor source boundaries (V1)

Saleor Cloud only (no self-hosted). Storefront baseline: `saleor/storefront` Paper template
(Next.js App Router, Tailwind, pnpm); deploy to Vercel; payments via Stripe (test mode for
first-run). Use `saleor/configurator` for config-as-code. Jolly is complementary to the
read-only Saleor MCP server (`mcp.saleor.app`) and configures mcp-graphql during `jolly init`.
Treat `saleor/cli` as **deprecated reference only** — never depend on, shell out to, or
require it. Re-check upstream Saleor repos at implementation time; their flows change.
