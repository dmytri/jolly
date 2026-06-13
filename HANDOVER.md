# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-13, Captain re-architecture: skill-driven thin CLI + clean code reset)

This session pivoted Jolly's architecture and reset the disposable code so QM/Crew
rebuild from current specs. Read the new specs, not the old src — the old src is gone.

**How we got here.** The customer wanted to get to MVP. A Captain audit found the back
half of the end-to-end (`create storefront`/`deployment`/`recipe`, `start`, `doctor
storefront`) was **fabricating success** while doing no real work — the green suite missed
it because those `@sandbox` scenarios skipped without creds. While fixing that, the customer
made three architecture decisions that supersede the "Jolly orchestrates the deploy" model:

1. **Use official CLIs, never reimplement** — where an official CLI exists (Vercel CLI,
   `@saleor/configurator`), it is used exclusively; no raw-API reimplementation, no
   token-passing variant, no fallback.
2. **Skill-driven, thin CLI — the agent runs the tools, not Jolly** — Jolly does not replace
   the agent. It installs a **Jolly skill** (the end-to-end playbook) + the Saleor skills,
   does deterministic plumbing, and emits a playbook; the **customer's agent** runs
   `npx vercel`, `@saleor/configurator`, `git`, `pnpm`. Jolly never shells out to those CLIs.
3. **Install skills via `npx skills add`** — for every skill, falling back to Git only when a
   skill isn't available that way (e.g. Paper's embedded skill).

**Credential finding (live-checked):** the `JOLLY_VERCEL_TOKEN` previously in `.env` is
**invalid** (api.vercel.com returns 403); the customer's `vercel login` CLI session *is*
valid. Under the new model there is **no `JOLLY_VERCEL_TOKEN`** at all — Vercel auth lives
only in the Vercel CLI session. The stale value should be removed from `.env`.

**New thin command surface** (feature 006/008): `login`, `logout`, `auth status`, `init`,
`start`, `doctor`, `upgrade`, `skills`, and `create store` / `create app-token` / `create
stripe`. The tool-wrapping subcommands `create deployment`, `deploy`, `create recipe`,
`create storefront` are **retired** — the agent runs those CLIs itself per the Jolly skill.
`jolly start` = bootstrap (install skills, `.mcp.json`, scaffold, doctor) + emit the playbook,
NOT an orchestrator that deploys.

**Specs updated this pass (all committed):** AGENTS.md (new "Skill-driven, thin CLI"
principle, `npx skills add` principle, the Jolly skill, MVP/Launch Definition rewritten to
9 agent-driven stages, Network Boundaries — api.vercel.com removed from Jolly's allowlist,
thin command surface, Vercel-gating note); CLAUDE.md (pinned contracts + Saleor boundaries);
features 001, 002, 003, 004, 005, 006, 007, 008, 009, 020. New Captain-owned asset
`skills/jolly/SKILL.md` (first-draft end-to-end playbook).

**Code reset (Captain deleted disposable artifacts invalidated by the spec change):**
- `src/index.ts` — DELETED (the old fat CLI: retired commands, simulation `start`,
  fabricating doctor/storefront/deployment/recipe). Crew rebuilds the thin CLI from specs.
- `features/step_definitions/*.steps.ts` — ALL DELETED (derived from specs; QM regenerates).
- `tests/*.test.ts` — ALL DELETED (logic-tier units pinning old behavior; QM regenerates).
- **Kept:** `src/lib/` (`cloud-api.ts`, `env-file.ts`, `saleor-url.ts` — reusable plumbing
  the thin CLI will build on; `provision.ts` imports `env-file.ts`) and `features/support/`
  (the harness charter, feature 023 — world, hooks, sandbox, cloud, provision, envelope,
  saleor-graphql, browser). Verified: typecheck clean; `bunx cucumber-js --dry-run` = 82
  scenarios, all undefined (the clean worklist); 20 feature files parse.

QM worklist (the path to MVP, in order):

1. **Rebuild the thin CLI (Crew).** From the updated specs, build `src/index.ts` as the thin
   surface above. Honest behavior is the contract: Jolly's commands report success/`pass`
   only for work performed and confirmed; unbuilt/unperformable paths error honestly (stable
   `errors[].code`); `jolly start` reports bootstrap + playbook, never a deploy it didn't do.
2. **Regenerate step defs + logic tests (QM).** All 82 scenarios are undefined — regenerate
   step defs against current specs, plus the logic-tier units. **Carry forward the
   012-incident safety lesson**: any `@logic` step exercising a side-effecting command path
   forces dummy creds for all groups + an unroutable `.invalid` Cloud API base.
3. **Update harness gating (QM).** `features/support/sandbox.ts` still gates `vercel:
   ["JOLLY_VERCEL_TOKEN"]` — retire that; deployment `@sandbox` steps gate on the Vercel CLI
   session (`npx vercel whoami` exit 0), not a Jolly env var. Remove `JOLLY_VERCEL_TOKEN`
   references from `tests`/step-defs as they're regenerated.
4. **Agent-driven e2e testing (QM design needed).** The deploy/configurator/clone stages are
   now agent behavior, not Jolly commands — decide how `@sandbox` verifies them (likely the
   harness runs the CLI steps the Jolly skill prescribes, as a proxy for the agent), and how
   to validate the Jolly skill's correctness. This is the main open testing question.

Trust + frictionless handoff (later same-day Captain pass): captured the "trustworthy
first-step handoff" principle (AGENTS.md + feature 001) — the pasted setup must not trip a
security-conscious agent's alarms (named inspectable `npx @dk/jolly`, clear provenance, exact
hosts, secrets only to their own services, agent-decided approvals, no fabrication) while
staying frictionless to a live store. Trust rests on npm + git, **not** npm provenance
attestation (don't require/claim it). `homepage/setup.md` rewritten to the skill-driven model
(hosts split into "Jolly contacts" vs "the CLIs you run contact"; retired commands removed).

Gap-closure pass (MVP-bounded, do not over-engineer): three gaps that made "friction-free"
contingent are now specced — (1) feature 022: resume spans the agent↔Jolly boundary; Jolly
detects agent-produced state (cloned storefront, configured store, deployment) so the playbook
resumes without redoing — detection stays simple for v1; (2) feature 014: `jolly doctor` is the
agent's recovery oracle (actionable next-step on any fail) and reflects agent-produced state;
(3) AGENTS.md: the Jolly-skill MVP bar is the happy path running end-to-end (paste → live store
with test-mode payment) with doctor for recovery — edge cases iterate later.

Open Captain items: finish authoring `skills/jolly/SKILL.md` to the MVP bar against
verified current upstream CLI flows (Vercel CLI, `@saleor/configurator`, Paper) — the skill
carries the smoothness; confirm the `npx skills add` ref/registry for distributing it. (The
stale `JOLLY_VERCEL_TOKEN` was already removed from `.env`.)

Guiding intent (customer, 2026-06-13): get to a clean end-to-end MVP we can really use, then
iterate — do not premature-optimize or chase every edge case.

## Previous state (2026-06-12, QM session: honest-auth coverage + Crew rewrite, all green)

All green at this QM commit: typecheck clean, unit 61/61 (two new
enforcement suites), full BDD 80 scenarios (72 passed, 8 skipped, 0 failed),
0 undefined. The 8 skips are unchanged — all Vercel/Stripe-gated
(underivable credentials). Teardown verified: the organization has zero
environments after the run (the run provisioned the shared environment AND
the collision-retry environment; both deleted).

This session delivered the whole worklist from the Captain's honest-auth
pass (next section):

- **018 steps regenerated** (`018-...steps.ts`, all 11 scenarios). The
  header pins the CLI contract: verification = one authenticated GET of
  `${apiBase}/organizations/` honoring `JOLLY_SALEOR_CLOUD_API_URL`;
  2xx → verified (real org name stored, check `login-token-verification`
  pass); 401/403 → `INVALID_TOKEN` + numeric `httpStatus`, nothing written;
  other failure → "stored, not verified" warning with check `unknown`.
  Browser preview pins realm saleor-cloud, real S256 PKCE (the step
  recomputes base64url(SHA-256(verifier))), and the full param set.
  Exchange preview pins `data.exchangePreview.tokenRequest/cloudTokenRequest`;
  the real exchange pins `OAUTH_EXCHANGE_FAILED` + `httpStatus` + `endpoint`
  as evidence the request was really sent. auth status reports
  configuration only (`hasCloudToken`/`hasAppToken`/`accountContext`,
  "unknown" fallback) and may not claim `authenticated: true` from a file
  read. The two no-credential @sandbox scenarios (failed exchange,
  invalid token) are gated `[]` in `SANDBOX_REQUIREMENTS` — network only.
- **012 steps reworked.** The @logic env-creation preview now runs against
  a LOCAL harness Cloud API server through the `JOLLY_SALEOR_CLOUD_API_URL`
  override (serves organizations + projects GETs, records and 500s any
  write) — pins that the org/project in the preview are really resolved
  from the token, only GETs happen, and nothing is created. The collision
  scenario is honestly @sandbox: the run's shared provisioned environment
  is the duplicate-label premise, the rejection must carry
  `DOMAIN_LABEL_TAKEN` + `httpStatus` + `data.suggestedDomain` +
  `retryAvailable`, and the agent-driven retry (namespaced
  `<ns>-retry`, teardown registered before assertions) really creates and
  deletes an environment. Orphaned steps for the retired
  --collision/--needs-project mock scenarios deleted.
- **Dummy-token login vehicles reconciled** (012 Givens, 020:secrets Given,
  021 dry-run-consistency Given): each now forces an unroutable `.invalid`
  API base so the run takes the honest "stored, not verified" warning path
  and can never reach a real account. The common step "Jolly should load
  the updated .env values..." now asserts status !== error (warning is the
  legitimate unverified-store outcome). 002's signup-URL step text updated
  to cloud.saleor.io.
- **New enforcement units**: `tests/first-party-hosts.test.ts` (retired
  hosts id.saleor.online / api.saleor.cloud and the `@saleor/` package
  scope appear nowhere in src/, bin/jolly, package.json) and
  `tests/honesty.test.ts` (junk-input sweep: junk token / junk URLs /
  junk exchange code never yield success status, pass verification checks,
  or authenticated/valid claims; runs with from-scratch env + `.invalid`
  API base).
- **Harness fix (QM-owned)**: `world.runCliAsync()` added — the 012 preview
  step hosts an in-process server, and `spawnSync` blocks the event loop
  (deadlock found by Crew). Async spawn with the same env/result handling.
- **Crew-implemented honest auth** (dispatched, delivered, verified):
  `src/lib/cloud-api.ts` gained `cloudApiBase()` honoring
  `JOLLY_SALEOR_CLOUD_API_URL` for every Cloud API request plus real
  duplicate-domain detection; `cmdLogin` rewritten (real verification,
  warning path, realm saleor-cloud, real PKCE/state, pure exchange
  preview, real exchange POSTs, honest `--browser` error when no
  browser/Playwright); `cmdAuthStatus` reports configuration only;
  `cmdCreateStore`/`cmdCreateEnvironment` fabrication branches removed
  (--collision, --needs-project, URL-substring triggers, org-test-123,
  Math.random task ids); `npx @saleor/jolly` → `npx @dk/jolly`. Live-
  verified during the run: real token verified with the real organization
  name; invalid token really rejected 401; bogus OAuth code really
  rejected by Keycloak.

Notes for the next session:

- The full credentialed BDD run now creates TWO environments (shared +
  collision retry) and takes ~5 minutes; cost accepted per the existing
  customer decision on per-run provisioning.
- `jolly login --browser` real execution errors honestly
  (`BROWSER_LOGIN_UNAVAILABLE`) — the native/Playwright callback flow is
  still unimplemented; the @requires-browser scenario skips (tier 3) on
  this VM, so there is no failing target to dispatch until a browser-
  capable runner exists.
- The known latent worklist (cmdStart stage stub vs 001 sandbox pins)
  is unchanged — still blocked on Vercel/Stripe credentials.

## Previous state (2026-06-12, Captain pass: honest auth, retired hosts)

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
- Housekeeping pass (same day): feature 012's fabrication-prone @logic
  scenarios were reconciled with the honesty rule — "builds a Cloud API
  environment creation request" is now an explicit `--dry-run` preview
  (no polling/env-write steps; those stay pinned by the @sandbox creation
  scenario), "handles domain name collision" is retagged @sandbox with a
  producible premise (duplicate jolly-test domain label within the run;
  retry-created environments need namespace + teardown), and the @logic
  "creates a project when none exists" scenario was deleted (duplicated
  the sandbox create-or-reuse coverage). 002: keyword-only Gherkin fixes
  (no step-text changes) plus signup URL changed `saleor.io/cloud` →
  `cloud.saleor.io` in two steps — 002 step texts affected. Open-question
  rules cleaned across 001/004/008/009/012/014/017/018 (settled decisions
  moved into principles or removed as duplicates; the default skill-set
  list now lives in 001's Product principles). README gained the Shipshape
  link and the author/non-affiliation statement. Worklist: 14 undefined
  steps total (11 from the 018 rewrite, 3 from the 012 rework); 012/002
  steps files have orphaned or mismatched steps to regenerate or update.
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
