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

## Spec change this session (features 023 + 012: self-provisioned endpoints)

Customer decision (2026-06-12, superseding the same-day `HARNESS_ENV_CREATE`
opt-in decision — that knob is **gone, never implemented**): needed Saleor
endpoints are **created rather than skipped, in all cases**. See feature 023
(scenarios "Sandbox tests provision missing Saleor endpoints instead of
skipping" / "Sandbox tests skip cleanly only when credentials cannot be
derived" + Rule "Credentials and gating"), feature 012's Rule
"Environment-creation test runs are namespaced and self-cleaning", and
`AGENTS.md` → Testing Strategy → "Self-provisioned endpoints":

- When a sandbox scenario needs `NEXT_PUBLIC_SALEOR_API_URL` /
  `JOLLY_SALEOR_APP_TOKEN` and they are not configured but
  `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness provisions **one shared
  per-run environment** (jolly-test namespace), derives both values from it for
  the whole run, and tears it down when the run ends.
- Skip-not-fail remains only for credentials that cannot be derived (missing
  Cloud token; Vercel/Stripe) and for capacity limits
  (`ENVIRONMENT_LIMIT_REACHED` stays an environmental skip).
- The CLI gains optional `--name <name>` / `--domain-label <label>` overrides on
  `jolly create store --create-environment`; the harness passes the per-run
  `jolly-test` namespace through them so test environments are positively
  identifiable.
- Leftover `jolly-test` environments from previous runs block creation:
  interactive sessions may ask and delete with explicit approval; otherwise skip
  naming the leftover. The harness never deletes an environment it cannot
  positively identify as test-created.
- Teardown deletes whatever the run created, registered before creation begins —
  the hardened machinery from `5273b44` stays.

QM worklist notes:

- `bunx cucumber-js --dry-run` shows the undefined 012 create-environment steps;
  the old steps in `012-...steps.ts` are superseded — rework that section.
- The harness work is the bigger piece: suite-level provisioning (likely a
  lazy BeforeAll-style fixture in `features/support/` that creates the shared
  environment on first need, exports the derived `JOLLY_*`/`NEXT_PUBLIC_*`
  values, and registers suite-end teardown), plus reworking the credential
  gating in `hooks.ts`/`sandbox.ts` (`SANDBOX_REQUIREMENTS` currently treats
  `saleorEndpoint`/`saleorAppToken` as skip conditions — they become derivable
  from `saleorCloud`).
- Expect credentialed runs without a configured endpoint to take minutes
  (environment creation + app token); that cost is accepted by the customer.
- Crew Mate impact: `src/index.ts` `cmdCreateEnvironment` does not yet accept
  `--name`/`--domain-label`; it generates `jolly-env-<suffix>` /
  `jolly-<suffix>` itself (around src/index.ts:700).

## Account state

All environments in `dmytris-organization-1` were deleted at the customer's
request on 2026-06-12 — including the former live instance
`jolly-mq9ol7f2.saleor.cloud` (explicitly confirmed; the earlier "never delete"
standing order is rescinded). The organization is **empty**: all sandbox slots
are free, and there is no live Saleor instance.

Consequences:

- `@sandbox` scenarios needing `NEXT_PUBLIC_SALEOR_API_URL` /
  `JOLLY_SALEOR_APP_TOKEN` skip (24 skips vs the previous 10) — skip-not-fail
  verified after the deletion: 59 passed, 24 skipped, 0 failed, 1 undefined
  (the expected feature 012 QM worklist).
- Endpoint coverage returns automatically once the self-provisioning harness
  work (below) lands: the suite will create its own per-run environment from
  `JOLLY_SALEOR_CLOUD_TOKEN`. No manual instance creation is needed.

## Credentials (`.env`, Bun auto-loads it)

```
JOLLY_SALEOR_CLOUD_TOKEN   (Saleor Cloud auth, dmytris-organization-1 — the only var present)
```

`NEXT_PUBLIC_SALEOR_API_URL` and `JOLLY_SALEOR_APP_TOKEN` were removed with the
instance they belonged to — under the new spec the harness derives them by
provisioning a per-run environment. Vercel/Stripe credentials are absent
locally; those `@sandbox` scenarios skip (not derivable).

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
