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

Two Captain passes followed: first the self-provisioning spec change (next
section), then a finalization pass that committed further spec additions. The
dry-run worklist now shows 86 scenarios, 5 undefined / 16 undefined steps.

## Spec additions this session (features 007, 009, 012, 016)

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
- **016 (homepage/setup guide):** `assets/homepage/setup.md` is now the durable
  source of truth for setup-guide content; `homepage/setup.md` is derived
  implementation output — the stale derived copy was **deleted** and Crew must
  regenerate it from the asset. New content rules: preserve the asset's
  sections (provenance, contacted hosts, prerequisites, human moments,
  dry-run-first quick start, per-step verification, skills table,
  troubleshooting, idempotency, supported agents, boundaries); command examples
  pin exact versions (`npx @saleor/jolly@X.Y.Z start`, never `@latest`) and the
  pinned form satisfies start-command checks. The asset's `[TODO: HIPP ...]`
  reproducible-build verification flow is an open question — derived guides
  omit unresolved sections rather than inventing content. Expect the 001 and
  016 step defs asserting on the old `homepage/setup.md` to fail until
  regeneration (verified: `test:logic` is 6 failed / 4 undefined / 50 passed at
  handover — all failures trace to the deleted derived guide or the new
  undefined steps).

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
  create-environment rework, the two new 012 region/organization scenarios, and
  the three new 007 merge/verified-on-disk steps; the old create-environment
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
