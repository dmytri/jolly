# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-12, second Captain session of the day)

Baseline at the previous QM commit (`5273b44`): typecheck clean, unit 44/44,
`@logic` 58/58, BDD 84 scenarios (74 passed, 10 skipped, 0 failed), 0 undefined.
The 012 `--validate` / `--infer-cloud` / app-token-configurator contract is
implemented; sandbox teardown was hardened (300s After-hook timeout, pre-run
snapshot catch-all diff teardown, retrying environment DELETE).

Three Captain passes followed: the self-provisioning spec change (next
section), a finalization pass committing further spec additions, and an
ownership change pulling the homepage out of the spec/test loop entirely. The
dry-run worklist now shows 78 scenarios, 6 undefined / 24 undefined steps;
typecheck clean; `test:logic` has 0 failures (only undefined + skips).

## Ownership change this session: homepage is a Captain-owned asset

Customer decision (2026-06-12): the **entire `homepage/` directory**
(`index.html`, styles, `setup.md` — everything served) is a Captain-owned
asset like `assets/**`: not specified in `.feature` files, not covered by
tests, never worked on by QM or Crew. See `AGENTS.md` (Durable Assets, Crew
Mate notes, Testing Strategy) and `CLAUDE.md`.

Consequences already applied:

- Feature 016 (homepage and agent setup guide) **deleted**, along with its
  step definitions and `features/support/homepage.ts` (happy-dom homepage
  helpers). happy-dom stays a dev dependency for future storefront DOM checks.
- The three homepage/setup-guide `@logic` scenarios were removed from feature
  001; its remaining `@sandbox` scenario ("Jolly start completes successfully")
  is unchanged, but `001-...steps.ts` was deleted as invalidated — QM should
  regenerate a lean steps file for just that scenario (8 undefined steps of the
  24 are this).
- `homepage/setup.md` was restored by the Captain from `assets/homepage/setup.md`
  (clean markdown, HIPP TODO sections omitted). Do not edit or test it.

## Spec additions this session (features 007, 009, 012)

- **007 (`jolly init`):** three new scenario steps — skill install output must
  report what was actually verified on disk (fail loudly, surface stderr,
  non-zero exit on clone/install failure); existing `.mcp.json` and
  `AGENTS.md`/glue files are **merged, never replaced** (add the Jolly entry /
  section without removing user-authored content). Crew impact: `src/index.ts`
  init/skills code currently pre-computes names and rewrites files.
- **009 (skill targets):** former open questions are now a binding agent
  detection rule — check in order `opencode` (.opencode/ or .agents/), `claude`
  (CLAUDE.md or .claude/), `cursor` (.cursor/rules/), `zed` (.zed/), `pi`
  (.pi/), stop at first match; `generic` fallback must report that no specific
  agent was detected. Rule-level (no new undefined steps); QM should make sure
  existing 009/007 coverage exercises the order and the generic-fallback report.
- **012 (create store):** new flags on `--create-environment` — `--region`
  (default `us-east-1`) and `--organization <slug>` (auto-select when the token
  sees one org; warn + list + name the selection when several). Two new @logic
  scenarios cover the overrides (via the `--dry-run` path) and the multi-org
  warning; the multi-org premise cannot be produced in the sandbox (the account
  has one organization), so a mock/injected org list is the sanctioned approach
  there.
(A fourth area, feature 016 / the setup guide, was superseded within the same
session by the homepage ownership change above — 016 no longer exists.)

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

- `bunx cucumber-js --dry-run` shows the undefined steps: the 012
  create-environment rework, the two new 012 region/organization scenarios, the
  three new 007 merge/verified-on-disk steps, and the 001 sandbox scenario
  whose steps file was deleted (regenerate it lean); the old create-environment
  steps in `012-...steps.ts` are superseded — rework that section.
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
