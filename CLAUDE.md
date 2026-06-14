# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Jolly — "Ahoy, agent. Go build a store." A homepage + `npx` CLI + agent skills that
help a customer's own AI agent set up and iterate on an end-to-end commerce storefront on
Saleor Cloud. Agents are the primary consumers; human DX is secondary. The CLI empowers the
customer's agent rather than replacing it.

The project is **spec-driven and currently in planning mode**. Feature `.feature` files and
tests are the durable assets; application code is considered disposable and regenerated from
the specs. `src/` (CLI entry `src/index.ts`) is built by Crew Mates, driven by failing tests,
and deleted and regenerated whenever specs change. All Captain-owned content lives under
`assets/` (Shipshape rule): `assets/homepage/` (index.html, setup.md, vercel.json — the site at
jolly.cool) and `assets/skills/jolly/SKILL.md` (the Jolly skill Jolly installs). `assets/**` is
not specified in `.feature` files, not covered by tests, and never edited by QM or Crew.

**`AGENTS.md` is the authoritative charter.** Read it before doing substantive work; it owns
the product vision, V1 scope/boundaries, the pinned contracts (output envelope, risk context,
idempotency), and the Shipshape workflow integration. This file is the orientation layer;
`AGENTS.md` is the source of truth, and `HANDOVER.md` is the Quartermaster's starting brief.

## Shipshape workflow

This repository uses Shipshape for the generic Captain → Quartermaster → Crew Mate workflow.

Before substantive Claude Code work, install/load Shipshape:

```bash
npx skills add dmytri/shipshape --agent claude-code --skill '*'
```

Then read `AGENTS.md` for Jolly-specific constraints and `HANDOVER.md` for current Quartermaster state.

Do not recreate project-local `/captain`, `/qm`, `/crew`, `/clearrole`, or generic role prompts in this repository. Shipshape owns those.

Session rule:

- Captain → Quartermaster: clear the session or start a fresh agent.
- Quartermaster → Captain: do not clear; Captain benefits from QM's concrete blocker context.

## Commands

Dev/CI runtime/package manager is **Node.js ≥23 + npm** (decision 2026-06-13: dropped Bun for
dev/prod parity); TypeScript, ES modules. Step definitions, support code, and `src/` are loaded
directly via Node ≥23's native type stripping (project files are not under `node_modules`). The
**published CLI is a Node program** (feature 006): `bin/jolly` imports the esbuild-built
`dist/index.js` and never requires Bun. Bun is no longer used anywhere in the project.

```bash
npm install            # dev deps (cucumber, happy-dom, typescript, esbuild, @types/node)
npm test               # logic-tier unit tests via `node --test` on tests/**/*.test.ts
npm run test:bdd       # full BDD suite (cucumber-js); excludes @meta and @eval
npm run test:logic     # cucumber-js -p logic  → @logic scenarios only
npm run test:sandbox   # cucumber-js -p sandbox → @sandbox scenarios only
npm run test:eval      # cucumber-js -p eval → @eval skill-affordance eval (opt-in, feature 025)
npm run typecheck      # tsc --noEmit
npm run build          # esbuild src/ → dist/index.js (the published bundle)
npm start              # run the CLI (node src/index.ts)
npm run dev            # run the CLI in watch mode (node --watch src/index.ts)
```

Run a single feature or scenario:

```bash
npx cucumber-js features/020-cli-output-contract.feature        # one feature file
npx cucumber-js features/020-cli-output-contract.feature:10     # one scenario by line number
npx cucumber-js --dry-run                                       # list UNDEFINED scenarios (the worklist)
node --test tests/sandbox.test.ts                               # one logic-tier test file
```

## Test architecture (feature 023)

Three tiers, sandbox over mocks:

- **Logic tier** (`@logic`, `tests/` + `@logic` cucumber scenarios): pure local behavior —
  output-envelope shaping, flag parsing, URL normalization, risk-context construction. No
  accounts; always runs.
- **Sandbox tier** (`@sandbox`): behavior touching Saleor Cloud, Configurator, Vercel, or
  Stripe, against real accounts via the **same runtime `JOLLY_*` env vars Jolly itself uses**
  — no test-only credential namespace. Whether those point at dedicated test accounts is the
  customer's choice; Jolly and the tests never know or check. When a Saleor endpoint or app
  token is missing but `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness **provisions** a
  shared per-run `jolly-test` environment (torn down after the run) rather than skipping;
  scenarios are **skipped, not failed** only when creds cannot be derived (no Cloud token, or
  Vercel/Stripe), so the suite always runs locally; CI supplies creds. Use mocks only for
  conditions a sandbox cannot produce.
- **Eval tier** (`@eval`, feature 025): the opt-in skill-behavior affordance evaluation — a
  baseline agent (bundled `pi` + a cheap model) driven over the **real** Captain-owned skill and
  CLI in a safe, bounded, per-run workspace with forced safe credentials. Asserts *affordances*
  (the agent invoked Jolly's documented commands via a PATH-shim trace; the documented local
  artifacts appeared), never a deployed store. Non-deterministic/credentialed/slow, so it is
  **excluded from the default worklist** (`not @meta and not @eval`), runs only via an explicit
  `eval` profile, and skips when its agent/model credential is absent. Never a green/red gate.

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
DOM checks (storefront) use happy-dom; the homepage has no test coverage (Captain-owned asset).

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
- **No fabricated success + first-party hosts (020, 018):** success/verified claims and
  `pass` checks only for operations actually performed and confirmed; unverified storage
  says exactly "stored, not verified"; unimplemented paths error honestly. Jolly's code
  sends requests only to the allowlisted first-party hosts (auth.saleor.io,
  cloud.saleor.io, *.saleor.cloud, api.stripe.com, github.com, 127.0.0.1); secrets go only
  to their own service. **api.vercel.com is NOT in this list (decision 2026-06-13)** — Vercel
  is reached only by the Vercel CLI the agent runs, never by Jolly's code, and there is no
  `JOLLY_VERCEL_TOKEN`. mcp.saleor.app is informational only (agent guidance — Jolly never
  contacts it; `.mcp.json` configures local mcp-graphql against the customer's own endpoint).
  `id.saleor.online` and `api.saleor.cloud` are retired hosts — never use them. Cloud API
  base: `JOLLY_SALEOR_CLOUD_API_URL` override.
- **Skill-driven, thin CLI (decision 2026-06-13):** Jolly does not replace the agent. It
  installs a **Jolly skill** (the end-to-end playbook) plus the Saleor agent-skills via
  `npx skills add`, does deterministic plumbing (`login`, `create store`/`app-token`/`stripe`,
  `init`, `start`, `doctor`), and emits a playbook. The **customer's agent runs the official
  CLIs** (`npx vercel`, `@saleor/configurator`, `git`, `pnpm`); Jolly never shells out to
  Vercel or configurator. **Narrow exception (decision 2026-06-13):** `jolly create stripe`
  (no flags) may invoke the Stripe CLI **read-only** (`stripe config --list`) to import
  already-authorized test keys into `.env`; Jolly never runs the Stripe CLI's `login`/OAuth
  (the agent does). `create deployment`, `deploy`, `create recipe`, `create storefront`
  are **retired** subcommands. See AGENTS.md "Skill-driven, thin CLI" and features 006/008.

## Secrets & environment

Local secrets live in `.env` (Git-ignored). Workflow credentials use `JOLLY_*`; generated
storefront runtime vars use the target project's names (e.g. Paper's
`NEXT_PUBLIC_SALEOR_API_URL`, `SALEOR_APP_TOKEN`). The same `JOLLY_*` names are used
everywhere — dev, tests, CI, prod; there is no `JOLLY_TEST_*` namespace. Never print secret
values; ensure `.env` is ignored before writing to it.

## Saleor source boundaries (V1)

Saleor Cloud only (no self-hosted). Storefront baseline: `saleor/storefront` Paper template
(Next.js App Router, Tailwind, pnpm); deploy to Vercel; payments via Stripe (test mode for
first-run). The **customer's agent** runs `git`, `@saleor/configurator` (config-as-code), the
Vercel CLI, and `pnpm` — guided by the Jolly skill; Jolly never shells out to configurator or
the Vercel CLI (decision 2026-06-13). Jolly is complementary to the read-only Saleor MCP server
(`mcp.saleor.app`) and configures mcp-graphql during `jolly init`. Treat `saleor/cli` as
**deprecated reference only** — never depend on, shell out to, or require it. Re-check upstream
Saleor repos at implementation time; their flows change.
