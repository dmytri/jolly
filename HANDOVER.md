# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-12, QM session — suite fully green)

All verification passes at this commit:

- `bun run typecheck` — clean
- `bun test` — 44/44
- `bun run test:logic` — 58/58 scenarios
- `bun run test:bdd` — 84 scenarios: 74 passed, 10 skipped, 0 failed
- `bunx cucumber-js --dry-run` — 0 undefined

The 10 skips: 8 from absent Vercel/Stripe credentials (expected locally; CI
supplies them) and the rest environmental — including the 012 create-environment
scenario, which skips on `ENVIRONMENT_LIMIT_REACHED` (see blocker below).

Work completed this session:

1. **012 sandbox contract implemented** (Crew Mate, in `src/index.ts`):
   `create store --validate` (live introspection check `create-store-validate-endpoint`;
   on failure status error + stable code, nothing written to .env);
   `create store --infer-cloud` (`data.cloudContext` from the Cloud API via
   `src/lib/cloud-api.ts`); `create app-token` success envelope now directs the
   agent to Configurator introspection via `nextSteps`. Plus
   `JOLLY_SALEOR_ORGANIZATION` added to `cmdCreateStore`'s jolly-managed key list.
2. **Sandbox teardown hardened** (QM): the After cleanup hook now has an explicit
   300s timeout (it previously ran under Cucumber's 5s default — a cut-off DELETE
   is a leak path); the 012 create-environment step registers a catch-all diff
   teardown *before* the CLI runs (pre-run snapshot of environment keys; any new
   `jolly-env-*` environment is deleted even if the CLI timed out or crashed
   before emitting an envelope), and environment deletion retries while
   provisioning tasks briefly block it.

## Blocker for Captain

A leaked sandbox environment occupies the org's only free sandbox slot:
`jolly-env-mq9xbafzoovm` (key `dkobNf93`, domain `jolly-mq9xbafzoovm.saleor.cloud`,
created 2026-06-11T20:01:41Z — by the previous QM session's sandbox run, before
the teardown hardening above existed). Per the harmless-by-design rules the
harness/QM never deletes pre-existing resources; the previous leak
(`jolly-env-mq9pzkc1`) was deleted by the Captain with customer approval —
this one needs the same decision. Until then the 012 create-environment
scenario skips environmentally (`ENVIRONMENT_LIMIT_REACHED`); once the slot is
freed, the hardened teardown should keep it from leaking again.

Never delete `jolly-mq9ol7f2.saleor.cloud` (key `pFVKHJdY`) — the live instance.

## Credentials & account state (`.env`, Bun auto-loads it)

```
JOLLY_SALEOR_CLOUD_TOKEN   (Saleor Cloud auth, dmytris-organization-1)
NEXT_PUBLIC_SALEOR_API_URL = https://jolly-mq9ol7f2.saleor.cloud/graphql/  (live instance — never delete)
JOLLY_SALEOR_APP_TOKEN     (app token for that instance)
JOLLY_SALEOR_ORGANIZATION  (non-secret auth context, written by jolly login)
```

Vercel/Stripe credentials are absent locally; those `@sandbox` scenarios skip.

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
