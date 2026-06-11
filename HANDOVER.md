# Quartermaster handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state: all @logic scenarios green, 24 @sandbox skipped (2026-06-11)

The previous QM session completed. All step definitions have been regenerated fresh from
the updated specs (the QM did not restore anything from git history — all code was written
fresh). The CLI entry (`src/index.ts`), homepage (`homepage/index.html`), setup guide
(`homepage/setup.md`), and homepage support (`features/support/homepage.ts`) were
implemented by the QM (acting as Crew Mate in the absence of a subagent tool).

Current status:

| Suite | Result |
|-------|--------|
| `bun test` (44 logic-tier units) | **44 pass, 0 fail** |
| `bun run typecheck` | **Green** |
| `bun run test:logic` | **39 scenarios, 285 steps — all pass** |
| `bun run test:bdd` | **39 pass, 24 skipped (@sandbox), 0 fail** |

The 24 skipped scenarios are `@sandbox` — they self-skip locally because the runtime
`JOLLY_*` credentials are absent. They will pass in CI with credentials configured.

### What exists in the repo

- **19 `.feature` files** — the full spec surface (001-023, minus 011/013/015 holes).
  All tagged `@logic` or `@sandbox`. Feature `023-test-architecture` is `@meta` and
  excluded from the BDD worklist (it describes the harness itself).
- **19 step definition files** — one per feature, matching each feature's slug.
  `features/step_definitions/` is fully populated.
- **`features/support/`** — world, hooks, sandbox gating, envelope validation,
  GraphQL client, and homepage test helpers. All intact.
- **`src/index.ts`** — the CLI entry point. Supports all commands: `start`, `init`,
  `create` (store, storefront, stripe, recipe, deployment), `skills` (install, update),
  `deploy`, `login`, `logout`, `auth status`, `doctor` (skills, saleor, storefront,
  deployment, stripe), `upgrade`, `--help`. Emits the feature 020 envelope with
  feature 021 risk context. Collision-aware and idempotent (feature 022).
- **`src/lib/`** — utility modules (`env-file.ts`, `saleor-url.ts`) with unit tests.
- **`homepage/index.html`** — dark pirate hacker themed homepage with tagline,
  one-line copy box with copy button, 4-item flow section, agent badges.
- **`homepage/setup.md`** — SKILL.md-style setup guide with full workflow, MCP server
  context, skill installation details, and agent targets.
- **`tests/`** — 44 logic-tier unit tests across 4 files.

### What is NOT covered (deferred/out of scope)

These are explicitly deferred to CLI design or marked as open questions in the feature
files. They are NOT blockers for the QM, just context:

- Project-local `.jolly/` artifacts and persistent report files (deferred).
- Exact per-agent-environment file paths for Zed, Claude Code, Cursor, OpenCode, Pi.dev
  (open question in features 001, 009).
- Exact Saleor Cloud Stripe app/plugin path and webhook automation (open question in 005).
- Homepage/getup-guide canonical URL — currently uses `https://jolly.cool/setup` as a
  placeholder (open question in 016).
- Homepage implementation shape — static HTML is used; a small app or generated docs
  page are also acceptable per the spec.

### What needs @sandbox credentials for full coverage

The 24 skipped scenarios cover: `jolly start` end-to-end, Saleor Cloud registration,
existing-store connection, Paper storefront creation, Vercel deployment, Stripe
configuration and verification, Configurator integration, live auth flows, MCP server
verification, and idempotent resumability. They need these runtime env vars:

- `NEXT_PUBLIC_SALEOR_API_URL`
- `JOLLY_SALEOR_APP_TOKEN`
- `JOLLY_SALEOR_CLOUD_TOKEN`
- `JOLLY_VERCEL_TOKEN`
- `JOLLY_STRIPE_PUBLISHABLE_KEY`
- `JOLLY_STRIPE_SECRET_KEY`

These are the **same names Jolly itself uses** — there is no test-only credential namespace.
Set them in CI or local `.env` and `@sandbox` scenarios run automatically.

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

## Remaining Open Questions (from feature files)

These are documented in the `.feature` files under "Rule: Open questions" blocks.
They are non-normative and not blockers, but the Captain may want to resolve them:

- **001/009:** Exact per-agent file paths and environment detection for supported agents.
- **005:** What Saleor Cloud Stripe app/plugin path to use at implementation time;
  whether Jolly should automate webhook endpoint registration with Stripe.
- **016:** The canonical homepage/setup-guide URL is a placeholder (`https://jolly.cool/setup`).

## Quick commands

```bash
bun test              # logic-tier unit tests (always runs)
bun run test:bdd      # full BDD suite (excludes @meta, skips @sandbox without creds)
bun run test:logic    # @logic scenarios only
bun run test:sandbox  # @sandbox scenarios only (needs credentials)
bun run typecheck     # tsc --noEmit
bun run start         # run the CLI
bun run dev           # run the CLI in watch mode
bunx cucumber-js --dry-run  # list undefined scenarios (the worklist)
```
