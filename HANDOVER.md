# Captain handover

You are the **Quartermaster (QM)** role. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

Crew Mate dispatch: this environment provides the `crew-mate` subagent (Agent tool), so the
QM dispatches Crew Mates for production code as the charter requires. The fallback rule
(QM writes production code itself) applies only if that mechanism is genuinely absent.

## Current state (2026-06-11, Captain session)

Baseline before this session's spec change was fully green (commit `2eb1240`):
unit 44/44, `@logic` 58/58, full BDD 74 passed / 10 skipped / 0 failed, typecheck clean.

This session's spec change then **deleted** two artifacts, so the suite is now
intentionally red/undefined until regenerated:

| Suite | Expected result now |
|-------|---------------------|
| `bun run typecheck` | **fails** — `src/index.ts` imports the deleted `src/lib/cloud-api.ts` |
| `bunx cucumber-js --dry-run` | undefined scenarios in feature 012 (step defs deleted) |
| `bun test` (unit) | passes (no unit test touched the deleted files) |

## Spec changes this session (feature 012)

The `@sandbox` environment-creation scenario was reworked; see
`features/012-existing-saleor-store-connection.feature`:

- Scenario renamed: "Jolly creates a Saleor Cloud environment **from scratch**" →
  "Jolly creates a Saleor Cloud environment". The empty-org Given is gone — the command
  must work against organizations that already have projects and environments.
- Project handling is **create-or-reuse**: reuse an existing project when one exists,
  otherwise create one with plan "dev"; the envelope `data` must state which happened.
- New stable error code **`ENVIRONMENT_LIMIT_REACHED`** when the Cloud API rejects
  creation because the org's sandbox limit is reached, with guidance to delete an unused
  environment or upgrade.
- New harness convention (also added to `AGENTS.md` → Testing Strategy): an
  `ENVIRONMENT_LIMIT_REACHED` outcome — and any premise the harness cannot produce
  harmlessly — is an **environmental skip, not a failure**.
- Sandbox runs that create an environment must register its deletion in teardown so a
  test run never permanently consumes a sandbox slot.

## Artifacts DELETED by the Captain (regenerate fresh from the committed specs)

```
features/step_definitions/012-existing-saleor-store-connection.steps.ts
src/lib/cloud-api.ts
```

Also impacted, not deleted (fix via regeneration, the broken import forces it):

- `src/index.ts` — imports the deleted `src/lib/cloud-api.ts`; its
  `cmdCreateEnvironment()` encodes the retired behavior (hardcoded
  `projectCreated: true`, no created-vs-reused distinction, no
  `ENVIRONMENT_LIMIT_REACHED` code). Crew Mates rebuild this against the new spec.
- `features/support/sandbox.ts` — `SANDBOX_REQUIREMENTS` still keys the old scenario
  name "Jolly creates a Saleor Cloud environment from scratch". Re-key to the new
  name "Jolly creates a Saleor Cloud environment" (needs `saleorCloud`), or the
  scenario will conservatively require every credential group and never run.

## QM worklist

1. `bunx cucumber-js --dry-run` → regenerate feature 012 step definitions fresh from the
   committed feature file (never from git history).
2. Update the `SANDBOX_REQUIREMENTS` key in `features/support/sandbox.ts` (see above).
3. Dispatch Crew Mates for the failing/undefined coverage — at minimum the Cloud API
   client and `cmdCreateEnvironment()` rebuild in `src/`.
4. Verify end-to-end: `bun run typecheck`, `bun test`, `bun run test:logic`,
   `bun run test:bdd`.

## Credentials & account state (`.env`, Bun auto-loads it)

```
JOLLY_SALEOR_CLOUD_TOKEN   (Saleor Cloud auth, dmytris-organization-1)
NEXT_PUBLIC_SALEOR_API_URL = https://jolly-mq9ol7f2.saleor.cloud/graphql/  (live instance — never delete)
JOLLY_SALEOR_APP_TOKEN     (app token for that instance)
```

Vercel/Stripe credentials are absent locally; those `@sandbox` scenarios skip (8 of the
10 skips in the green baseline). The org's sandbox environment capacity: the leaked
`jolly-env-mq9pzkc1` was deleted by the Captain on 2026-06-11 (customer-approved), so
**one sandbox slot is free** for the environment-creation scenario; its teardown must
delete what it creates (the teardown DELETE-response check landed in `2eb1240`).

## Running the suite

```bash
bun test                    # logic-tier unit tests
bun run test:logic          # @logic scenarios only
bun run test:bdd            # full BDD suite
bun run test:sandbox        # @sandbox scenarios only (needs credentials)
bun run typecheck           # tsc --noEmit
bunx cucumber-js --dry-run  # list undefined scenarios (the worklist)
```
