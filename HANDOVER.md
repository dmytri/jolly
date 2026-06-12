# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-12, Captain pass: honest auth, retired hosts)

Customer-driven audit of `cmdLogin` found fabricated success output: "Token
verified via id.saleor.online/verify" / "at id.saleor.online/configure" with
**no network request ever made** (validation was `startsWith("invalid-")`),
plus a fully mocked OAuth exchange (`saleor-cloud-token-from-exchange`,
`oidc-id-token-mock`). Live probes (2026-06-12): id.saleor.online is a
Cloudflare stub ("Hello, Saleor!"), /verify and /configure 404;
auth.saleor.io/realms/saleor-cloud is real Keycloak. The bogus host was in
the committed spec (feature 018, imported from the deprecated saleor/cli
study, commit dd04d7b) — a spec defect, now fixed at the spec level.

Spec changes (all committed this pass):

- **018**: id.saleor.online retired. Token verification redefined as a real
  authenticated GET of `https://cloud.saleor.io/platform/api/organizations/`
  (2xx+parse = verified; 401/403 = INVALID_TOKEN, nothing written; other
  failure = "stored, not verified", envelope warning, check `unknown`).
  Scenarios rewritten: @logic unreachable-API honest storage; @logic OAuth
  exchange --dry-run preview (real endpoints, no success claims); @sandbox
  failed-exchange honesty (needs no creds, just network); @sandbox real
  token verification (stores the **real** org name — the placeholder
  "Saleor Cloud user (authenticated)" is retired); @sandbox invalid-token
  rejection with no success language. New runtime var
  `JOLLY_SALEOR_CLOUD_API_URL` overrides the Cloud API base (default
  cloud.saleor.io/platform/api) — the mock-free way for tests to produce
  "unreachable" (point it at an .invalid host).
- **020**: new Rules "No fabricated success" (pass checks only for work
  actually performed+confirmed; "stored, not verified" wording; junk input
  never yields success language from any command; unimplemented → honest
  error; dry-run previews show the real request) and "First-party hosts
  only" (request-sending allowlist: auth.saleor.io, cloud.saleor.io,
  *.saleor.cloud, api.vercel.com, api.stripe.com, github.com, 127.0.0.1;
  secrets only to their own service; id.saleor.online + api.saleor.cloud
  banned). Clarified same day: the allowlist covers hosts Jolly's code
  sends requests to — exactly equal to hosts in request-sending code.
  mcp.saleor.app is informational only (agent guidance in init output;
  Jolly never contacts it; .mcp.json configures local mcp-graphql against
  the customer's own endpoint), so a host gate must distinguish
  request-sending code from informational mentions in output strings.
- **012**: Cloud API rule now names api.saleor.cloud as retired and requires
  dry-run previews to show the real host/org/no invented ids.
- **AGENTS.md** (output contract bullet + new "Network Boundaries" section)
  and **CLAUDE.md** (pinned contract bullet) updated.

QM worklist from this pass:

- `features/step_definitions/018-...steps.ts` was **deleted** (encoded the
  retired host and the mocked exchange) — regenerate from the updated spec.
  All 018 scenarios are now undefined.
- Known spec-stale implementation for Crew (via failing tests): `cmdLogin`
  in `src/index.ts` (~535–680) — mocked exchange, prefix-based "validation",
  fabricated verified checks, placeholder org name, id.saleor.online;
  `api.saleor.cloud` ×4 in src (also `cmdCreateStore` ~1330–1390: invented
  org-test-123, Math.random task ids, `--collision`/`--needs-project`/URL-
  substring fabrication branches — violate the new 020 honesty rule and the
  012 preview rule).
- Other QM steps that run `jolly login --token <dummy>` as a vehicle
  (012:273/368/512/790, 020:38, 021:41) must be reconciled: under the new
  spec a dummy-token login hits the real Cloud API. For @logic, set
  `JOLLY_SALEOR_CLOUD_API_URL` to an unroutable `.invalid` URL and expect
  the "stored, not verified" warning path (status may change from success
  to warning where asserted).
- New 020 honesty rules warrant a junk-input sweep test (no success/
  verification language from any command on junk input) — QM judgment on
  shape (unit sweep vs scenario steps).
- Package naming (decision 2026-06-12, feature 006 rule): `@dk/jolly`
  everywhere; `@saleor/jolly` must never be mentioned — not as runnable,
  not as "future/official". Jolly is a tool by Dmytri Kleiner, not an
  official product of Saleor, Vercel, or Stripe (AGENTS.md Product
  Vision). Spec-stale in src: `src/index.ts:10` (comment) and `:247`
  (init output string says `npx @saleor/jolly start`) — the output string
  is test-reachable; homepage/setup.md and index.html already updated by
  Captain (Captain-owned).
- The @sandbox 018 scenarios needing only network (failed exchange,
  invalid-token rejection) should run without any credentials — gate
  accordingly.

## Previous state (2026-06-12, QM session after Captain commit bae8910)

All green at this QM commit: typecheck clean, unit 54/54, full BDD 80
scenarios (72 passed, 8 skipped, 0 failed), 0 undefined. The 8 skips are
unchanged — all Vercel/Stripe-gated (underivable credentials). Teardown
verified: the organization has zero environments after the run.

This session covered Captain commit bae8910 (feature 006: the published
Jolly CLI is a Node program; Bun is dev-env only):

- **006 Node-launcher steps** — new @logic scenario steps in
  `006-...steps.ts` execute `bin/jolly` directly (shebang and all, exactly
  as npx would) on a PATH holding only a `node` symlink, after asserting
  Bun is not resolvable on it; the envelope must come back on stdout with
  exit 0. Per the 012-incident lesson the run builds its env from scratch
  (no `.env` leakage) and forces dummy credentials for all groups plus an
  unroutable `.invalid` API URL.
- **`tests/node-launcher.test.ts`** — logic-tier units pinning the 006
  rule bullets: `engines.node` declared and >= 23, no `engines.bun`,
  `bin.jolly` = `bin/jolly`.
- **Crew-implemented Node launcher** — `bin/jolly` is now plain
  CommonJS-compatible JS with a `#!/usr/bin/env node` shebang: an explicit
  version guard (clear error naming Node >= 23 on older majors — the rule
  bullet about too-old Node; written so old Node parses it instead of
  raising a syntax/module error), dynamic `import()` of `src/index.ts` via
  native type stripping, and an `ERR_UNKNOWN_FILE_EXTENSION` fallback that
  re-spawns with `--experimental-strip-types` for Node 23.0–23.5.
  `package.json` `engines` is now `{"node": ">=23.0.0"}`. Dev scripts and
  devDependencies stay Bun-native (feature 023).

Coverage gap (accepted): the too-old-Node clear-error rule bullet has no
executable test — the harness cannot produce an old Node binary; the guard
is implemented in the launcher. Note for Captain: `bin/jolly` and `engines`
changed after the `@dk/jolly` 0.1.11 publish — a republish/version bump is
a Captain/customer action.

## Previous session (same day, after Captain commit 42b5dc1)

All green at this QM commit: typecheck clean, unit 51/51, `@logic` 53/53,
full BDD 79 scenarios (71 passed, 8 skipped, 0 failed), 0 undefined. The 8
skips are unchanged — all Vercel/Stripe-gated (underivable credentials).
Teardown verified: the organization has zero environments after the run.

This session covered Captain commit 42b5dc1 (feature 001: `jolly start
--dry-run` as a true preview plan):

- **001 dry-run preview steps** — new @logic scenario steps in
  `001-...steps.ts` pin the contract (documented in the file header):
  `data.dryRun === true`; `data.plan` entries `{stage, effects}` with the
  four intended-effect arrays (`directoriesCreated`, `filesWritten`,
  `networkHostsContacted`, `repositoriesCloned`), each kind non-empty
  somewhere in a fresh-project plan; feature 021 `riskContext`
  (`dryRunAvailable: true`) on every side-effecting entry; a
  `start-dry-run` check (the `<command>-dry-run` convention) for
  programmatic distinguishability; nextSteps directing `jolly start`
  (without `--dry-run`); and a before/after recursive snapshot proving no
  file in the project directory was created or modified. Following the
  012-incident lesson, the When step forces dummy credentials for **all**
  credential groups (Cloud/app token, Vercel, Stripe) and an unroutable
  `.invalid` API URL — a CLI ignoring `--dry-run` cannot reach any real
  account.
- **Crew-implemented `cmdStartDryRun`** — `src/index.ts` gained a dry-run
  branch in `cmdStart` (six-stage static plan incl. doctor; no file writes,
  no network). The non-dry-run `jolly start` path is untouched.

## Previous session (same day, second Captain session)

That session delivered the whole worklist from its previous handover:

- **Self-provisioning harness (features 023 + 012)** — `features/support/`
  gained `cloud.ts` (shared Cloud API helpers: list/delete/leftover
  detection) and `provision.ts` (lazy once-per-run shared environment,
  created through the CLI itself with `--name`/`--domain-label` =
  `jolly-test-<runId>-shared`, derives `NEXT_PUBLIC_SALEOR_API_URL` +
  `JOLLY_SALEOR_APP_TOKEN` into `process.env`, AfterAll teardown).
  `sandbox.ts` gained `classifyCredentials`/`DERIVABLE_GROUPS` (endpoint and
  app token derivable when the Cloud token is present); the `@sandbox`
  Before hook (900s timeout) skips only on underivable creds, leftover
  jolly-test environments, or `ENVIRONMENT_LIMIT_REACHED`; any other
  provisioning failure fails loudly. Verified live: the shared environment
  was provisioned, used by the endpoint scenarios (skips fell 24 → 8), and
  deleted by AfterAll.
- **012 steps reworked + Crew-implemented** — sandbox env-creation scenario
  now runs `--create-environment --name <ns> --domain-label <ns>` with
  leftover-check Given, namespace assertion, and teardown-registration
  assertion. New @logic scenarios pass: `--region`/`--organization`
  overrides via `--dry-run` (no Cloud API write; works with a dummy token)
  and the multi-org warning (`--mock-organizations` injection flag). Crew
  implemented the flags, the dry-run path (`requestUrl`/`requestBody`), and
  the multi-org `warning` envelope in `cmdCreateEnvironment`.
- **007 steps + Crew-implemented** — `jolly init` now reports
  `data.skills` `{name, path, verified}` checked on disk (fail loudly with
  stderr + non-zero exit on install/verify failure), merges `.mcp.json`
  (adds a `saleor-graphql` mcp-graphql entry, user entries survive,
  unparseable files left untouched with a warning check) and merges
  `AGENTS.md` via `<!-- jolly:begin/end -->` markers.
- **001 steps regenerated lean** — only the @sandbox "Jolly start completes
  successfully" scenario; pins that the final envelope carries key URLs,
  automatic doctor results as `data.doctor.checks`, customization nextSteps,
  and no secrets.

**Safety incident, resolved:** the first @logic run of the new 012 override
scenarios created two real environments — the CLI ignored `--dry-run` on the
`--create-environment` path (unimplemented) and unknown flags are silently
ignored, while Bun had loaded the real `.env` token. Both environments were
deleted the same hour. The steps were hardened so this cannot recur: the
@logic create-environment runs force a dummy `JOLLY_SALEOR_CLOUD_TOKEN` via
the runCli env override, so even a CLI without `--dry-run` support cannot
reach the real account. Lesson for future QM step-writing: any @logic step
that exercises a side-effecting command path must inject dummy credentials,
not rely on `--dry-run` being implemented.

## Known latent worklist (blocked on Vercel/Stripe credentials)

The regenerated 001 steps pin `jolly start --json` emitting
`data.doctor.checks` (automatic doctor run) and key URLs; `cmdStart` in
`src/index.ts` is still a stage-status stub that emits neither, and the
e2e flow (storefront clone, Vercel deploy, Stripe config) is unbuilt. The
scenario skips locally (Vercel/Stripe underivable), so there is no failing
target to dispatch yet — first credentialed CI run will surface it. Same for
the other FULL_END_TO_END scenarios.

## Previous baseline (for context)

Baseline at the previous QM commit (`5273b44`): typecheck clean, unit 44/44,
`@logic` 58/58, BDD 84 scenarios (74 passed, 10 skipped, 0 failed), 0 undefined.
Three Captain passes followed: the self-provisioning spec change (next
section), a finalization pass committing further spec additions, and an
ownership change pulling the homepage out of the spec/test loop entirely —
all now covered, as described above.

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

QM worklist notes — **all delivered this session** (see Current state):
undefined steps are at 0, the provisioning harness is live in
`features/support/{cloud,provision,sandbox,hooks}.ts`, and
`cmdCreateEnvironment` accepts `--name`/`--domain-label`/`--region`/
`--organization`/`--dry-run`/`--mock-organizations`. Credentialed runs
without a configured endpoint take minutes (one shared environment per run);
that cost is accepted by the customer — the full BDD run is ~4.5 minutes.

## Account state

All environments in `dmytris-organization-1` were deleted at the customer's
request on 2026-06-12 — including the former live instance
`jolly-mq9ol7f2.saleor.cloud` (explicitly confirmed; the earlier "never delete"
standing order is rescinded). The organization is **empty**: all sandbox slots
are free, and there is no live Saleor instance.

Consequences (updated this QM session): the self-provisioning harness now
restores endpoint coverage automatically — the suite creates its own per-run
environment from `JOLLY_SALEOR_CLOUD_TOKEN` and deletes it after the run.
Skips are down to the 8 Vercel/Stripe-gated scenarios. No manual instance
creation is needed; the organization stays empty between runs.

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
