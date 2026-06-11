# Captain handover

You are the **Quartermaster (QM)** role. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

Crew Mate dispatch: this environment provides the `crew-mate` subagent (Agent tool), so the
QM dispatches Crew Mates for production code as the charter requires. The fallback rule
(QM writes production code itself) applies only if that mechanism is genuinely absent.

## Current state (2026-06-11, Captain follow-up session)

A prior QM session regenerated the previously deleted artifacts (012/018 step
definitions, `features/support/browser.ts`, `features/support/hooks.ts`,
`src/lib/cloud-api.ts`, the `src/index.ts` rebuild, and the `SANDBOX_REQUIREMENTS`
re-key); the Captain committed that work as `d788933`. At that commit: typecheck clean,
0 undefined scenarios, unit 44/44, `@logic` 57/58 (one failure: `jolly auth status`
reported no account context), `@sandbox` tier not re-verified.

The Captain then resolved that failure at the spec level (see below) and **deleted
`features/step_definitions/018-jolly-auth-commands.steps.ts` again** — regenerate it
fresh from the committed feature file, never from git history.

## Spec change this session (feature 018: JOLLY_SALEOR_ORGANIZATION)

Customer decision: non-secret auth state lives in `.env`. This answers (and removes)
the former open question "Where should Jolly store non-secret auth state, if any?".
See feature 018 and `AGENTS.md` → Playwright and Browser OAuth:

- Successful login flows store the authenticated organization name in `.env` as
  `JOLLY_SALEOR_ORGANIZATION` (non-secret context, not a credential; may appear in
  output). Asserted in the headless-token-validation scenario; normative for all
  login flows via the Auth command principles rule.
- `jolly auth status` reports that stored value as the account context — no network
  call. When it is absent, the account context is reported as unknown, never an error.
- `jolly logout` removes `JOLLY_SALEOR_ORGANIZATION` along with both tokens (the
  logout scenarios' Given/Then now include it).

Impacted, not deleted (the regenerated 018 step defs will be red against it, forcing
Crew Mate rework): `src/index.ts` — `cmdLogin()` (store org name), `cmdAuthStatus()`
(report `accountContext`), `cmdLogout()` (remove the org var).

## QM worklist

1. Regenerate `features/step_definitions/018-jolly-auth-commands.steps.ts` fresh from
   the committed feature file.
2. Dispatch Crew Mates for the failing 018 coverage (`cmdLogin`/`cmdAuthStatus`/
   `cmdLogout` per the spec change above).
3. Verify end-to-end: `bun run typecheck`, `bun test`, `bun run test:logic`,
   `bun run test:bdd` (the `@sandbox` tier has not been re-verified since the
   regeneration; Saleor Cloud credentials are in `.env`).
4. Commit.

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
