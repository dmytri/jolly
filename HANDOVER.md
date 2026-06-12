# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-12, Captain session following a green QM session)

Baseline at the previous QM commit (`5273b44`): typecheck clean, unit 44/44,
`@logic` 58/58, BDD 84 scenarios (74 passed, 10 skipped, 0 failed), 0 undefined.
The 012 `--validate` / `--infer-cloud` / app-token-configurator contract is
implemented; sandbox teardown was hardened (300s After-hook timeout, pre-run
snapshot catch-all diff teardown, retrying environment DELETE).

The Captain then resolved the leaked-environment blocker and changed the spec
(see below), which makes parts of the 012 create-environment coverage stale.

## Spec change this session (feature 012: opt-in, namespaced env creation)

Customer decision (2026-06-12): environment-creation tests are **opt-in,
jolly-test-namespaced, and self-cleaning**. See feature 012's new Rule
"Environment-creation test runs are opt-in, namespaced, and self-cleaning" and
`AGENTS.md` → Testing Strategy → "Environment creation is opt-in":

- The scenario runs only when expressly requested via `HARNESS_ENV_CREATE`
  (harness knob); default runs skip it with a clear reason.
- The CLI gains optional `--name <name>` / `--domain-label <label>` overrides on
  `jolly create store --create-environment` (Rule "Environment creation against
  in-use organizations"); the harness passes the per-run `jolly-test` namespace
  through them so test environments are positively identifiable.
- Before creating, the harness checks for leftover `jolly-test` environments:
  interactive sessions may ask and delete with explicit approval; otherwise skip
  naming the leftover. The harness never deletes an environment it cannot
  positively identify as test-created.
- Teardown deletes the created environment right after the run (registered
  before creation begins — the hardened machinery from `5273b44` stays).

The scenario's Given/When/Then text changed, so `bunx cucumber-js --dry-run`
shows the undefined steps — that is the worklist. The old create-environment
steps in `features/step_definitions/012-existing-saleor-store-connection.steps.ts`
are superseded; rework that section (remove the no-longer-matching steps) and
gate the scenario on `HARNESS_ENV_CREATE` in the harness (`features/support/`),
keeping the skip-not-fail semantics. `SANDBOX_REQUIREMENTS` knows nothing about
the new knob yet.

Implementation impact for Crew Mates: `src/index.ts` `cmdCreateEnvironment` does
not yet accept `--name`/`--domain-label`; it generates `jolly-env-<suffix>` /
`jolly-<suffix>` itself (around src/index.ts:700).

## Account state

The leaked `jolly-env-mq9xbafzoovm` was deleted by the Captain on 2026-06-12
(customer-approved); **one sandbox slot is free**. Never delete
`jolly-mq9ol7f2.saleor.cloud` (key `pFVKHJdY`) — the live instance.

## Credentials (`.env`, Bun auto-loads it)

```
JOLLY_SALEOR_CLOUD_TOKEN   (Saleor Cloud auth, dmytris-organization-1)
NEXT_PUBLIC_SALEOR_API_URL = https://jolly-mq9ol7f2.saleor.cloud/graphql/  (live instance — never delete)
JOLLY_SALEOR_APP_TOKEN     (app token for that instance)
JOLLY_SALEOR_ORGANIZATION  (non-secret auth context, written by jolly login)
```

Vercel/Stripe credentials are absent locally; those `@sandbox` scenarios skip.
`HARNESS_ENV_CREATE` is intentionally unset by default — set it only for an
expressly requested environment-creation run.

## Running the suite

```bash
bun test                    # logic-tier unit tests
bun run test:logic          # @logic scenarios only
bun run test:bdd            # full BDD suite
bun run test:sandbox        # @sandbox scenarios only (needs credentials)
bun run typecheck           # tsc --noEmit
bunx cucumber-js --dry-run  # list undefined scenarios (the worklist)
```

Note: bare `bunx cucumber-js <feature>` does not load `.env` — sandbox scenarios
will skip. Use `bun x --bun cucumber-js <feature>` (or the package scripts) so
Bun injects the credentials.
