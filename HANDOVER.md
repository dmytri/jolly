# Captain handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. You read only repository files, do not converse with
anyone, and write tests — not production code. The full charter is in `AGENTS.md`
(Three-Role Agent Workflow). Read it first, then this file.

## Current state: all step definitions deleted, 0 undefined → all undefined (2026-06-11)

The **Captain** tightened the `.feature` specs to require **real side-effect behavior**
from CLI commands — not just envelope-shape compliance. The old step definitions tested
only that the CLI *mentioned* side effects in its output envelope, not that it *performed*
them. They are deleted.

The old CLI entry (`src/index.ts`) was a stub that returned mock success envelopes claiming
to write `.env`, acquire tokens, etc., without actually doing any real I/O. It is deleted.

**The QM must regenerate all step definitions and the CLI entry from the tightened specs.**

### Specs updated by the Captain

The following `.feature` files were tightened with concrete, testable `@logic` scenarios
that verify actual side effects (`.env` writing, file creation, state detection):

| Feature | New scenarios | What they test |
|---------|--------------|----------------|
| **005** (Stripe) | `Jolly create stripe writes keys to .env` | `jolly create stripe --publishable-key X --secret-key Y` writes both keys to `.env`, ensures `.gitignore`, doesn't print secrets |
| **005** (Stripe) | `Jolly create stripe --dry-run does not write to .env` | Dry-run mode: risk context in output, no `.env` created |
| **007** (Init) | `Agent init is safe to rerun and detects existing state` | Second `jolly init` detects first run's artifacts, doesn't error |
| **007** (Init) | `Agent init is safe to rerun in a clean directory` | First `jolly init` installs skills, writes glue files that actually exist on disk |
| **012** (Store) | `Jolly create store writes the Saleor URL to .env` | `jolly create store --url X` writes normalized URL as `NEXT_PUBLIC_SALEOR_API_URL` to `.env` |
| **012** (Store) | `Jolly create store --dry-run does not write to .env` | Dry-run mode: risk context in output, no `.env` created |
| **018** (Auth) | `Jolly login writes token values to .env` | `jolly login --token X` writes token as `JOLLY_SALEOR_CLOUD_TOKEN` to `.env`, `.gitignore` updated, auth status confirms |
| **018** (Auth) | `Jolly login --dry-run does not write to .env` | Dry-run mode: risk context in output, no `.env` created |
| **018** (Auth) | `Jolly logout removes only Jolly-managed auth values from .env` | Logout removes `JOLLY_SALEOR_*` tokens but preserves unrelated vars |

Additional tightening:
- **007**: `jolly init` must write glue files that actually exist on disk (not just mention them in the envelope).
- **005/018/012**: Every dry-run scenario must verify `.env` is NOT created, and the output
  must include risk context.

### What exists in the repo

- **19 `.feature` files** — the full spec surface (001-023, minus 011/013/015 holes).
  All tagged `@logic` or `@sandbox`. Feature `023-test-architecture` is `@meta` and
  excluded from the BDD worklist (it describes the harness itself).
- **`features/support/`** — world, hooks, sandbox gating, envelope validation,
  GraphQL client, and homepage test helpers. All intact and unchanged.
- **`src/lib/env-file.ts`** — real utility: `writeEnvValues()`, `loadEnvValues()`.
  Tested by `tests/env-file.test.ts` (44 unit tests, all pass).
- **`src/lib/saleor-url.ts`** — real utility: `normalizeSaleorUrl()`. Tested by
  `tests/saleor-url.test.ts`.
- **`tests/`** — 44 logic-tier unit tests across 4 files. All pass.
- **`homepage/index.html`** — static homepage. Keep.
- **`homepage/setup.md`** — SKILL.md-style setup guide. Keep.

### What must be regenerated

**Everything in `features/step_definitions/` and `src/index.ts` must be written fresh
from the committed specs** — these were deleted by the Captain because they encoded
stub behavior (envelope-only, no real side effects).

The QM must:
1. Write step definitions for all scenarios in all `.feature` files
2. Implement `src/index.ts` as the CLI entry point that actually does real I/O

**Do not restore deleted files from git history.** The whole point of the deletion is
that the old code encoded dead requirements. Write everything fresh from the specs.

### Key contract: CLI commands must actually perform their side effects

The tightened specs require that commands making side-effect claims actually do them:

- `jolly login --token <value>` → writes `<value>` as `JOLLY_SALEOR_CLOUD_TOKEN` to `.env`
  via `writeEnvValues()`, verifies `.gitignore`, makes the token visible to subsequent
  `jolly auth status` in the same command flow.
- `jolly create store --url <url>` → normalizes via `normalizeSaleorUrl()`, writes
  result as `NEXT_PUBLIC_SALEOR_API_URL` to `.env`.
- `jolly create stripe --publishable-key <pk> --secret-key <sk>` → writes both to `.env`.
- `jolly logout` → removes `JOLLY_SALEOR_CLOUD_TOKEN` and `JOLLY_SALEOR_APP_TOKEN` from
  `.env`, preserves unrelated variables.
- `jolly init` → writes glue files that exist on disk (at minimum, the `.env` and
  `.gitignore` artifacts it's responsible for).

All `--dry-run` modes must:
- Include a `riskContext` in the output envelope
- NOT actually create or modify files
- Still validate inputs (e.g., URL normalization)

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
- How Jolly detects completed remote work (022 open question).
- `@sandbox` scenarios need real credentials; the Captain will handle
  credential setup separately using the functional CLI.

### Conventions (normative, from feature 023 and AGENTS.md)

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
- Tag every scenario `@logic` or `@sandbox` (the feature files already do).
  Field names in JSON contracts are camelCase. Secrets are never printed or committed.

### Quick commands

```bash
bun test              # logic-tier unit tests (44 pass, always runs)
bun run test:bdd      # full BDD suite — currently ALL undefined steps
bun run test:logic    # @logic scenarios only
bun run test:sandbox  # @sandbox scenarios only (needs credentials)
bun run typecheck     # tsc --noEmit (green)
bunx cucumber-js --dry-run  # list undefined scenarios (the QM worklist)
```
