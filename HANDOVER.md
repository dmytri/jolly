# Captain handover

You are the **Quartermaster (QM)** role. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

Crew Mate dispatch: this environment provides the `crew-mate` subagent (Agent tool), so the
QM dispatches Crew Mates for production code as the charter requires. The fallback rule
(QM writes production code itself) applies only if that mechanism is genuinely absent.

## Current state (2026-06-11, Captain follow-up session)

A prior QM session already regenerated the Captain-deleted artifacts (012/018 step
definitions, `features/support/browser.ts`, `features/support/hooks.ts`,
`src/lib/cloud-api.ts`, the `src/index.ts` rebuild, and the `SANDBOX_REQUIREMENTS`
re-key) but left the work **uncommitted in the working tree**. Worklist items 1–3
below are done; do not redo them — verify, finish, and commit.

Verified status of the working tree as of this brief:

| Suite | Result |
|-------|--------|
| `bun run typecheck` | passes |
| `bunx cucumber-js --dry-run` | 0 undefined (84 scenarios all defined) |
| `bun test` (unit) | 44/44 pass |
| `bun run test:logic` | **57/58 — 1 failing scenario** (see below) |
| `@sandbox` tier | not yet re-verified after regeneration |

The one failing scenario is feature 018 "Agent checks auth status": `jolly auth status`
must "report the authenticated account or organization context where safe"
(`features/018-jolly-auth-commands.feature:75`), but `data` lacks `accountContext`
(currently only `{authenticated, hasCloudToken, hasAppToken}`). The spec and step
definition agree; this is Crew Mate implementation work, not a spec gap. Remaining QM
loop: dispatch a Crew Mate for that scenario, re-verify end-to-end (including
`@sandbox` with the available Saleor Cloud credentials), then commit everything.

## Spec changes this session (feature 018: login credentials never persisted)

Customer decision: Saleor Cloud email/password are **one-time login inputs** — Jolly
never persists them and never reads them from env vars or files. See the new Rule
"Login credentials are one-time inputs, never persisted" in
`features/018-jolly-auth-commands.feature` and the updated "Playwright and Browser
OAuth" section of `AGENTS.md`. Key points:

- Playwright login flow prompts for email/password on stdin (hidden on TTY, piped
  otherwise); in-memory only; the durable artifact is `JOLLY_SALEOR_CLOUD_TOKEN` in `.env`.
- No credentials on stdin → error with `--token` guidance.
- The `@requires-browser` scenario was reworded (new Given, new "no email/password in
  .env" Then) and Tier 2 gating changed: harness pipes `HARNESS_SALEOR_EMAIL` /
  `HARNESS_SALEOR_PASSWORD` into the prompt; Playwright present but knobs absent → skip
  naming the missing knobs. Tier ordering (native first, then Playwright) is unchanged.

**Additional artifacts DELETED by the Captain for this change** (regenerate fresh from
the committed specs):

```
features/step_definitions/018-jolly-auth-commands.steps.ts
features/support/browser.ts
features/support/hooks.ts
```

Note `hooks.ts` carried the @sandbox credential-skip and After-teardown hooks (feature
023) plus the @requires-browser gate (feature 018) — regenerate all of it from those two
specs. `src/index.ts` `cmdLogin()` is impacted too (stdin prompting for the Playwright
path); it is already guaranteed-red via the broken `cloud-api.ts` import below.

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

1. Regenerate `features/support/hooks.ts` (feature 023 @sandbox gate + After teardown;
   feature 018 @requires-browser gate with the new Tier 2 HARNESS_* knob condition) and
   the browser-capability detection it needs.
2. `bunx cucumber-js --dry-run` → regenerate feature 012 and feature 018 step
   definitions fresh from the committed feature files (never from git history).
3. Update the `SANDBOX_REQUIREMENTS` key in `features/support/sandbox.ts` (see above).
4. Dispatch Crew Mates for the failing/undefined coverage — at minimum the Cloud API
   client + `cmdCreateEnvironment()` rebuild, and `cmdLogin()` stdin prompting for the
   Playwright path.
5. Verify end-to-end: `bun run typecheck`, `bun test`, `bun run test:logic`,
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
