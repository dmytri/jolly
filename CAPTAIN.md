<!-- ============================================================= -->
<!-- STOP. CAPTAIN ROLE ONLY.                                      -->
<!-- If you are NOT running as the Captain — i.e. you are the      -->
<!-- Quartermaster, Crew Mate, Bosun, or any other role — do NOT   -->
<!-- read past this line. Close this file now. Its contents are    -->
<!-- Captain-only working context and must never enter another     -->
<!-- role's context. You were not given this file by your role.    -->
<!-- ============================================================= -->

> **STOP — CAPTAIN ROLE ONLY.** If you are not running as the Captain (you are the Quartermaster, Crew Mate, Bosun, or any other role), **stop reading now and close this file.** Nothing here is input to your role; reading it leaks Captain-only context. Binding behavior lives in `features/*.feature` and referenced `assets/**` — not here.

# Captain Notes

Captain-only notes: product framing and current design. **Non-binding.** Only Captain may read or
edit this file. Binding behavior lives in `features/*.feature` and referenced `assets/**`, never here.
History lives in git — these notes describe only the current design.

> **Captain authors every `.feature` scenario** — read and follow `SCENARIO_WRITING.md` for each one.

## Governing principle: live-by-design, never mock/fake

Jolly's suite runs against **real services** in a fully integrated test env matching production — the
`JOLLY_*` Saleor Cloud / Vercel / Stripe credentials in `.env` ARE that env. **Never mock or fake**
(no fake CLIs, dummy credentials, `.invalid` endpoints, simulated responses). Creating real resources
is expected; safety is **harmless-by-design** = namespace every created resource + idempotent teardown
+ never modify/delete a resource the run did not create (AGENTS.md rules), NOT credential-faking.
Scope: every tier including `@logic`. Made executable by feature 026's `@property` "no forbidden
double" so a green suite carrying a fake fails there.

- **Failures: real where possible.** Produce every failure reachable from real bad input for real
  (empty/garbage token → real auth rejection; non-first-party `--url` → real `NON_FIRST_PARTY_HOST`).
  A justified-exception double (inline `@exceptional-double`, never the normal path) is allowed only
  for conditions the real env cannot produce on demand — current set: `ENVIRONMENT_LIMIT_REACHED`
  and the unverifiable-endpoint "stored, not verified" path.
- **Env limits — cannon fodder.** `jolly-test-`-prefixed environments are disposable; the prefix IS
  the protection boundary (only `jolly-test-*` are deletable; the configured store is never touched).
- A persistently-skipping `@sandbox` scenario is un-verified, not done ([[skip-mask-sandbox-unverified]]).

## Current product design

### IN FLIGHT — human `jolly start` completion + live progress (cycle specced 2026-06-26)

dk ran the published `npx @dk/jolly start` by hand and surfaced four human-UX defects; this cycle
specs all of them ("everything together"), ordered in `cycle.json` (progress first — dk's loudest
pain). Decisions (dk: "do whatever will work best"):

1. **Live per-stage progress (027 + 020).** Production wraps the WHOLE stage run in ONE static
   `clackSpinner("Running setup stages")` (`src/index.ts:3539`) and never updates it — after the
   proceed confirm there is no output until everything finishes and the checks dump. **The
   verification was a FALSE-GREEN** (`features/step_definitions/020-cli-output-contract.steps.ts:458`,
   `:484`): it asserts only that the substrings `store`/`storefront`/`deploy` appear *somewhere* on
   stderr (they sit in the static "Planned stages" box, printed before the spinner) and that *any*
   carriage-return exists (the spinner emits one) — so the broken single-spinner passes. This is why
   in-place progress is "still not done despite asking many times": green ≠ correct (Article 10,
   [[skip-mask-sandbox-unverified]]). Fix: strengthened the 027 progress scenario to demand each
   stage *advance from running to its own terminal status* with >1 stage resolving distinctly — a
   single static spinner can no longer pass. The changed scenario text orphans the false-green step
   defs, forcing QM to re-implement them genuinely and Crew to emit real per-stage updates. Verifiable
   at @logic: under the stand-in token the stages still run-and-fail-fast (the existing separated-PTY
   harness reaches them), so a genuine per-stage display IS observable without sandbox.
2. **Friendly completion, not an envelope dump (027).** The human close prints the machine envelope
   rendered as text (the `command: [status] / - [check]: / next:` block) — on a real run that is 35+
   lines, most of them stale bootstrap `doctor-*` checks (no-endpoint/app-token/storefront,
   not-logged-into-vercel) contradicted by the same run's later stage successes, plus a misleading
   `⚠️ Bootstrap complete; proceeding through the orchestrated stages` headline. Contract: the human
   close is a concise prose summary naming the live store URLs (the Dashboard + deployed storefront
   URLs feature 002 already carries in envelope `data`) and the one remaining Stripe Dashboard step;
   it does NOT render the `checks[]` enumeration or `nextSteps[]` command lines (those stay
   `--json`-only, 020); a pre-flight readiness check the run then resolves is never reported as a
   failure of the completed run. @logic scenario pins the FORM (dry-run close = prose, no check
   enumeration); the URL CONTENT rides feature 002's @sandbox end-to-end. The curated summary is what
   makes the stale-doctor cruft disappear from the human view.
3. **Planned-stages box lists `init`/`auth` (027).** The plan note renders all `startPlan()` stages
   including the internal bootstrap `init`/`auth` — already done by the time it prints, after the
   Saleor sign-in (dk: "says 'auth login' as a planned stage … not sure we need this at all, at least
   not for humans"). Contract: the human plan names only the side-effecting creation stages (store,
   storefront, recipe, deploy, stripe), never `init`/`auth`; and once the human proceeds, no separate
   static plan list is re-printed — the live per-stage progress carries the run.
4. **Real bugs surfaced (specs already existed).** (a) **pnpm** — a missing global `pnpm` surfaced as
   a raw `storefront-prepared: fail … spawnSync pnpm ENOENT`. pnpm stays a prerequisite, NOT npx-driven
   ([[clis-via-npx]] lists only configurator/vercel/stripe); fix is a clean `pnpm-available` fail
   check with a remediation, surfaced early by `jolly doctor` (new @logic scenario, pnpm hidden from
   PATH), never a raw ENOENT (002 clause strengthened). (b) **recipe** — `recipe-deployed: pass` (from
   configurator's optimistic exit) co-existed with `recipe-collections: fail "… the starter recipe is
   not deployed"`. This violates the EXISTING 004:93-97 / 004:217 store-back-confirmation rule; added a
   consistency clause (the recipe checks tell one story, never deployed-and-not-deployed at once). The
   recipe stage status must be store-confirmed, collapsing the contradiction. @sandbox (real store).

5. **Clickable sign-in URLs, no browser takeover (027 + 002).** dk: `vercel login` opens a browser;
   prefer a clickable URL, for both the Vercel and the Saleor device-auth URLs. Findings: Bombshell
   has NO clickable-URL primitive (checked `@clack/prompts` exports) — clickable URLs are OSC 8
   terminal hyperlinks Jolly emits itself (no dep, dependency-averse). `vercel login --help` shows no
   browser-suppress flag. So: render BOTH device-auth URLs (Saleor + Vercel) as OSC 8 hyperlinks
   where the terminal supports it (027 @logic for Saleor front-half; 002 clause for Vercel); Jolly's
   OWN code opens no browser (true today for Saleor). **Honest limitation flagged to dk:** the
   delegated Vercel CLI still auto-opens its own browser, and Jolly cannot cleanly stop that without
   reimplementing the Vercel device flow (002 forbids) or a fragile env hack — so the clickable URL
   is the achievable win; full Vercel-browser suppression is dk's call (left as "prefer a no-open
   CLI mode where one exists").

**Spec-quality corrections (after dk pushed back "is this specced well?").** Re-audited my own
scenarios; two were weak and got fixed: (a) the completion contract was only a dry-run @logic FORM
check that an empty "Done." would pass and left the real URL/genuine-failure content in Rule prose
only — added an @sandbox scenario pinning the completed run's content (names the store Dashboard URL,
the remaining Stripe step, no stale resolved-readiness failures, no check enumeration); (b) the recipe
"consistency" line was vacuous on the green path — reworded to bind `recipe-deployed`'s status to the
store read-back so it structurally cannot pass while a declared entity is absent. Progress wording
tightened to "list every stage, update each in place" so it is unambiguously @logic-observable (the
display renders all stages up front, not one fixed spinner).

Nothing deferred this cycle. [[mvp-then-iterate]] applies within each item (smallest falsifiable
scenario). Outbound (push + a republish, since copy/behaviour ships in the tarball) waits until the
cycle lands and is green. [[outbound-check-npm-publish-not-just-git]]

### IN FLIGHT — interactive `jolly start` overhaul (cycle being specced 2026-06-25)

dk-directed overhaul of the interactive experience. **Device grant verified live with dk this session**
— [[device-grant-platform-api-gap]] is RESOLVED (the old "gap" was a header-scheme mismatch). Six
requirements, recorded as one coherent cycle (018/002/020/024/027/014); the pnpm + recipe-collections
bug-fixes follow as a small second cycle.

**Device-grant test speed — fake auth host (2026-06-25 — dk).** The device grant is a POLLING flow,
not a redirect/callback: Jolly reaches OUT to `auth.saleor.io/.../token` and polls; nothing calls back
INTO Jolly (no local callback server, no `redirect_uri`). So the slow `@logic` login scenarios were
waiting out the real poll for an approval no human gives in CI. Decision (dk, after a long design
back-and-forth): verify the device grant against a tiny LOCAL fake auth host that approves on the first
poll, which Jolly is pointed at through a new `JOLLY_SALEOR_AUTH_URL` override (mirrors
`JOLLY_SALEOR_CLOUD_API_URL`; default the real `saleor-cloud` realm base; added to the 020 allowlist).
The faked human-approve is the narrow `@exceptional-double` (026 rule extended) — Jolly's real
request/relay/poll/store code runs unchanged; only the un-producible human click is injected. This
makes the login scenarios fast AND restores the approved-completion coverage (access + refresh tokens
stored) that earlier had to be dropped as unrealizable. We are NOT mocking Keycloak's protocol or
testing Keycloak itself — the fake just returns the approval. Specs rewritten this cycle: 018
(Interactive + Agent-driven login sign-in, the relay `Scenario Outline`), 020 (allowlist enumeration),
026 (admissible-double rule). Worklist:
- **Crew** — (a) add the `JOLLY_SALEOR_AUTH_URL` override to `src/lib/device-grant.ts` + the
  `src/lib/hosts.ts` allowlist; (b) on approval, the agent-driven `jolly login --json` MUST report
  status `success` honestly — today `deviceGrantLoginAgent` emits a "pending" warning envelope and then
  `process.exit(0)` without correcting it, so a completed sign-in misreports as pending. The new
  `018:Agent-driven jolly login signs in` asserts `status "success"`, which forces this fix.
- **QM** — write the fake-auth-host harness (a tiny `127.0.0.1` HTTP server returning the device code +
  approval) and the step defs. Apply the fake to EVERY no-token `jolly login` invocation, not only the
  two 018 scenarios: the `006` "Every command accepts the global output flags" login rows currently
  poll real Keycloak too, so wire the fake there (via a shared hook or the login When) or they stay
  slow. Update feature 026's double-enumeration step to bless the fake auth host as the new
  `@exceptional-double`, so the no-forbidden-double `@property` stays green.

Shipped as **0.10.2** (`main` + tag `v0.10.2` on GitHub, `@dk/jolly` on npm `latest`, 2026-06-25): the catalog ships in the tarball (`files`), guarded by `006:14`; live 0.10.1 predated the whole feature. [[mvp-then-iterate]] [[outbound-check-npm-publish-not-just-git]]

1. **Device authorization grant = the ONLY interactive auth flow**, humans and agents alike.
   - **Saleor** — Jolly drives the grant itself (no Saleor CLI exists). Realm `saleor-cloud`, public
     client `jolly` (no secret): POST `…/auth/device` with `client_id=jolly&scope=openid` → show the
     `user_code` + `https://auth.saleor.io/realms/saleor-cloud/device` URL via Bombshell → poll
     `…/token` → JWT (`aud: jolly`) + refresh_token. **The platform API accepts this JWT only as
     `Authorization: Bearer <jwt>`** (sending `Token <jwt>` → 401 "Invalid token header"). Access token
     is **300s**; refresh ~12h — so a long `jolly start` MUST refresh (grant_type=refresh_token,
     client_id=jolly). An agent relays the `user_code` + URL to its human; same flow, no
     terminal-blocking — this dissolves the old "agent can't paste a secret" firewall problem.
   - **Vercel** — `npx vercel login` IS a device grant. Jolly spawns the CLI and lets it **complete**
     (stop killing it before auth — reverses the v0.9.5 "bounds the spawn"), run **upfront**. Stays
     CLI-driven: the 002 invariants hold (Jolly holds no Vercel token, no api.vercel.com, never
     reimplements the CLI).
2. **Raw token only via env/.env (and CI).** Non-interactive supply is `$JOLLY_SALEOR_CLOUD_TOKEN`
   (today's staff token from `https://cloud.saleor.io/tokens`) — kept for testing flows + CI. The
   explicit `--token`/`--token-file`/`--token-stdin` argv/file/stdin sources and the interactive masked
   paste are RETIRED. Jolly keeps the device-grant tokens in their own variables
   (`JOLLY_SALEOR_ACCESS_TOKEN` + `JOLLY_SALEOR_REFRESH_TOKEN`) and the staff token in
   `JOLLY_SALEOR_CLOUD_TOKEN`, and picks the platform-API scheme by **which variable holds the
   token**: access token → `Bearer`, staff token → `Token` (separate-vars decision 2026-06-25, below;
   supersedes the earlier "by token shape" framing).
3. **Host allowlist (020) adds `auth.saleor.io`** (currently excluded) for the grant + refresh.
4. **Honest interactive copy — IN PROGRESS (2026-06-25, dk).** This change was agreed earlier but
   never built: the copy was hard-coded in `src/` and unspecified, so nothing failed when it never
   shipped (the drift this fixes). Decision: move human-facing interactive copy OUT of `src/` into a
   message catalog **asset** `assets/messages/cli.json` (plain JSON, keyed; a tiny `t(key)` loader
   reads it at runtime — no gettext/i18n lib, dependency-averse, [[copy-less-is-more]]). Rewording
   becomes a pure Captain asset edit, no code/test cycle. Two `@logic` 027 scenarios (no dedicated
   Rule — Bosun `4622ced` moved the contract out of Rule prose into the scenarios, per the
   scenario-writing agreement) pin that the rendered
   notes/proceed/decline equal the catalog entries — positive and wording-agnostic, so QM never
   authors copy and we avoid [[no-self-defeating-absence-assertions]]; copy *quality* stays a
   human/asset concern, not a test concern. Corrected wording lives in the catalog: no "Gate:" prefix
   (the Stripe paste is the trailing final step, not a wait — already 027:31-33), no "side-effecting"
   in human strings (kept as internal machine/spec vocabulary). Proceed → "Build your store now? This
   creates the store, storefront, and deployment." `assets/messages/` added to package.json `files` so
   it bundles in the published package. **Packaging guard landed (2026-06-25):** beyond the `files`
   entry, 006 now carries a PTY published-launcher catalog-render scenario ("The published package
   renders interactive copy from its shipped message catalog", `006:14`) — npm pack + install the
   tarball, run the installed `jolly start --dry-run` under a real PTY accepting every default, and
   assert the trailing Stripe-step note IS the `start.stripeFinal` catalog message. A missing catalog
   in the published tarball now fails `@logic`, closing the drift this point fixes
   ([[outbound-check-npm-publish-not-just-git]]). **Scope this cycle = interactive `jolly start` strings only**
   (`start.vercelSignin`, `start.stripeFinal`, `start.proceed`, `start.declined`); cycle.json selects
   the two scenarios. **PHASE 2 (later, no re-explaining needed): sweep ALL remaining human-facing CLI
   copy into the catalog** — identical pattern (add keys, render via `t(key)`); the catalog-binding
   Rule already generalizes, so each surface needs only a binding assertion, or fold into a `@property`
   invariant in the 026 "no forbidden double" family once broad. Published-copy edits still need a
   republish (catalog ships in the tarball); in-repo, copy is decoupled from code and tests.
5. **Front-load every human gate.** Gather ALL human interaction upfront — Saleor sign-in, Vercel
   sign-in, org/env/dir choices, proceed confirm — then the mechanical chain runs **unattended**, so
   the human need not watch. The ONE irreducible trailing step stays the Stripe keys + `us`-channel
   mapping in the Saleor Dashboard (005: needs the installed app to exist; no public API can do it).
6. **Pretty in-place progress.** The setup stages render as a live, in-place, updating multi-stage
   display (status per stage), NOT an append-only log scroll. On stderr (020); falsifiable via the
   3-PTY harness (in-place = CR redraws, not newline appends).

**Testability note:** the Saleor grant cannot complete without a human clicking authorize, so CI cannot
drive the full grant unattended. CI/tests use the env/.env staff-token lane (req 2); the human
authorization step is the narrow justified `@exceptional-double` (Article 8) for the interactive
grant's coverage. The front-half (device-code request + `user_code`/URL display + polling start) is
`@logic`-observable.

**Cycle correction (2026-06-25 — QM blocker resolved).** The device-grant `Bearer` platform-API
coverage is realizable ONLY on a path that genuinely consumes a stored refresh token: `jolly doctor
saleor` minting a fresh JWT through the real refresh grant, then a real `Authorization: Bearer`
platform-API read (018 "An expired access token is refreshed from the stored refresh token"). The
harness seeds a real refresh token captured once from a human authorize — a `HARNESS_*` secret,
gated to skip when absent (so it is CI-verified, not a [[skip-mask-sandbox-unverified]]). The 018
scenario "An authorized device grant stores credentials and reports the organization" was NOT
realizable — `jolly login`'s interactive grant cannot be completed unattended in CI and login does
not (and should not) consume a stored refresh token — so it contradicted the testability note above
and is REMOVED. Its real coverage already lives in the front-half `@logic` (018 "Interactive jolly
login starts the Saleor device authorization grant"), the staff-token store+report (`@sandbox` 018
"jolly login verifies and stores the env/.env staff token as Token"), and the refresh
`@exceptional-double` above. The token-shape scheme (JWT→`Bearer`, staff→`Token`), env-only
non-interactive supply, and org-name storage stay UNIMPLEMENTED in production (`cloudFetch` hardcodes
`Token`; `commandLogin` still carries the retired `--token`/`--token-file`/`--token-stdin`
machinery) — that is the expected Crew worklist this cycle, with Bosun removing the orphaned
`--token*` step definitions and the stale `SANDBOX_REQUIREMENTS` keys.

**Separate-vars decision (2026-06-25 — dk).** The device grant MUST NOT clobber a configured staff
token, because tests (and CI) run on the staff token in `.env` (`JOLLY_SALEOR_CLOUD_TOKEN`). So the
two Cloud credentials live in separate variables:
- staff token → `JOLLY_SALEOR_CLOUD_TOKEN`, sent as `Authorization: Token`;
- device-grant access token (Keycloak JWT) → `JOLLY_SALEOR_ACCESS_TOKEN`, sent as
  `Authorization: Bearer`, refreshed from `JOLLY_SALEOR_REFRESH_TOKEN` when expired.

The interactive device grant writes only the access + refresh variables and never overwrites
`JOLLY_SALEOR_CLOUD_TOKEN`. The platform-API scheme is chosen by **which variable holds the token**,
not by token shape; when both are stored, the device-grant access token is used (this is what makes
the refresh `@exceptional-double` exercise the refresh path even with a staff token also present).
The realizable, falsifiable home for the non-clobber/separate-var guarantee is the refresh path
(018 "An expired access token is refreshed…" + 014 "Doctor validates stored device-grant credentials
with Bearer"), which stores a freshly-minted access token into `JOLLY_SALEOR_ACCESS_TOKEN`. Logout's
managed set now includes `JOLLY_SALEOR_ACCESS_TOKEN`. Specs rewritten in 018 (scheme rule, refresh,
logout, verification rule) and 014 (doctor rule prose + the device-grant Bearer scenario);
`@logic`/staff-token scenarios and titles are unchanged so `cycle.json` stays valid. Crew worklist
grows accordingly (store the access token in its own var; choose scheme by variable). The refresh
seed stays a skip-when-absent `HARNESS_*` secret the harness writes into the project `.env` as
`JOLLY_SALEOR_REFRESH_TOKEN`.

**Interactive device-grant scenarios removed (2026-06-25 — dk).** The two `027` scenarios "Interactive
start gathers every human gate before the unattended stages" and "Interactive start runs the Saleor
device-grant sign-in inline, in the same session" are REMOVED. Each bundled a real front-half with a
back-half ("after the user authorizes/proceeds, the run continues into the setup stages") that needs
the device grant — and, for the gates scenario, the Vercel sign-in — to COMPLETE unattended. That is
the same unrealizability that retired the 018 "authorized device grant stores credentials" scenario
(testability note above): a `HARNESS_*` captured refresh token realizes only the refresh-CONSUMPTION
path, not a freshly-displayed grant completing on demand. Realizable coverage already lives elsewhere:
the inline device-grant front-half in 018 "Interactive jolly login starts the Saleor device
authorization grant"; the Jolly-owned, bounded Vercel sign-in in 002/014 `@sandbox`; the inline /
up-front framing in 027 "tells the human which steps are theirs" and "Declining the proceed
confirmation stops honestly". The "runs unattended once every gate passes" guarantee stays as 027 Rule
prose (context only). `cycle.json` pass2 dropped both. Bosun prunes the now-orphaned paste step
definitions (the masked Cloud-token entry When/Thens, used by no scenario). **Known drift to iterate:**
production interactive `jolly start` still authenticates by pasted token (`src/index.ts:473`
`clackPassword`); the 027 Rule says device-grant inline. No scenario now drives that switch, so it is a
future iteration, not this cycle's Crew work — [[mvp-then-iterate]], [[spec-cleanup-found-issues]].

**Follow-ups (2026-06-25 — dk: "do all three").** Status after the follow-up work:
1. **gplint gate made real — DONE** (commit `2c2ab8a`). The AGENTS.md command
   `npx gplint "features/**/*.feature"` matched ZERO files (gplint 2.5.2 does not expand a quoted
   `**`), so the gate never linted the corpus. Fixed to `features/*.feature`; tuned `.gplintrc` to the
   project's codified conventions (lowercase domain steps; long descriptive titles; many-scenario
   files; multi-assertion `Then`s; `When`-first scenarios; per-scenario tags) and disabled the
   cosmetic/convention-conflict rules (`indentation` — flat 2-space under Rules per the Shipshape
   agreement, which gplint can't model; `table-align`; `file-name` — intentional `002-v1`); fixed the
   genuine violations (020 dual-phase colour scenario split; 025 background-only inlined; 009/014
   blank lines). Gate lints all 22 files and exits 0.
2. **`--token`/paste machinery retired — DONE** (commit `8640fec`). `commandLogin` now resolves the
   token from `$JOLLY_SALEOR_CLOUD_TOKEN` + the device grant only (no `--token`/`--token-file`/
   `--token-stdin`/paste); flags dropped; every `jolly login --token <value>` guidance string →
   `jolly login`; the 3 rewritten env-var scenarios (018 login --dry-run / .env-private / .env-POSIX)
   implemented; 40 orphaned step defs + dead helpers pruned. Logic tier 149 passed / 0 failed.
3. **Device-grant Bearer end-to-end + interactive-start device-grant sign-in — DONE** (dk: "do all
   three / finish the work"). The full cycle landed: (a) `cloudFetch` (src/lib/cloud-api.ts) now chooses
   the platform-API scheme by which variable holds the token — a value equal to
   `JOLLY_SALEOR_ACCESS_TOKEN` authenticates as `Bearer`, the staff token as `Token`
   (`platformAuthScheme`); (b) `refreshAccessToken` + `isJwtExpired` (device-grant.ts) mint a fresh
   access token through the refresh grant, and the doctor-saleor path (`resolvePlatformToken`) prefers
   the access token and refreshes-on-expiry, persisting the fresh token — the production behind
   `018:78` + `014:145` (`@sandbox @exceptional-double`, CI-verified when `JOLLY_SALEOR_REFRESH_TOKEN`
   is seeded; skip locally); (c) `runInteractiveStart`'s no-token auth now runs the device grant inline
   (shows the user code + verification URL, never a pasted secret), verified by the new `@logic` 027
   scenario "Interactive start signs in with the device grant inline, never a pasted token" (front-half,
   PTY, real `auth.saleor.io` device-code request, polls to the deadline); `promptForToken`/paste
   removed; (d) the non-doctor platform/cloud-token call sites (create-store, provision, app-token,
   stripe install, org-resolution, start's auth-stage `needsToken`) resolve through `cloudPlatformToken`
   (prefer access → Bearer, else staff → Token) — non-regressive for staff-token flows by construction
   (no access token present → staff resolved unchanged), so all `@sandbox`/staff scenarios are
   unaffected; (e) the `@logic` start seam (020 `runStartSeparated`, 027 decline) seeds a stand-in staff
   token in the environment instead of pasting, so start skips the grant and reaches the gates.
   **Verified-in-real-use only (no `@logic`/`@sandbox` coverage exists — the e2e device-grant grant
   cannot complete unattended):** that a device-grant access token is accepted by the *store* GraphQL
   stages (`appInstall`/app-token) — feature 005 documents those as staff-token operations; the
   device-grant JWT is sent there as `Bearer` exactly as the staff token is, the consistent choice, but
   the store's acceptance of it is exercised only by a real authorized run. [[mvp-then-iterate]]

### Shipped design being superseded by the above

- **Saleor auth is token-only (018) — being replaced by req 1/2 above.** `jolly login` takes the Cloud token from
  `--token`/`--token-file`/`--token-stdin`/`$JOLLY_SALEOR_CLOUD_TOKEN`/interactive TTY paste (echo off,
  never via argv/LLM), verifies, and stores it. No token + no TTY → honest error pointing to
  `jolly login --token <value>`. No browser OAuth. Host allowlist (020) excludes `auth.saleor.io`/`127.0.0.1`.
- **Stripe = Saleor Stripe app + skill (005/007).** `jolly start` installs the Saleor Stripe app
  (`appInstall`, HANDLE_PAYMENTS) and the `stripe-best-practices` skill. Entering the keys + mapping the
  `us` channel stays the human Saleor-Dashboard gate. No Stripe CLI, no `JOLLY_STRIPE_*` keys held by Jolly.
- **Vercel: CLI passthrough, Jolly-driven sign-in (shipped v0.9.5, `5dd59ec`).**
  `jolly start` deploys only via the Vercel CLI under the CLI's own session (Jolly holds no Vercel
  token, contacts no `api.vercel.com`). With no session, **Jolly owns the sign-in** at the deploy
  stage in BOTH human and agent paths: it spawns `npx vercel login` itself, captures the device-
  authorization URL and routes it to stderr (human at the terminal, or agent relays to its human),
  **bounds the spawn** (kills before auth completes), and reports the deploy stage as a `pending`
  sign-in gate naming **Jolly running the sign-in together with the human** — never a deploy
  `fail`/`blocked` for a missing session. **No envelope surface — nextSteps, error remediations, or
  check `command`/`remediation` fields — ever hands the agent `vercel login` or tells it to re-run
  `jolly start` after a manual sign-in** (uniform with the Stripe Dashboard gate); the doctor
  `vercel-auth` no-session next step is `jolly start`, never `vercel login`.
  **Environmental reality (2026-06-24, confirmed in build):** the installed Vercel CLI (54.16.0) does
  NOT passively "report no session" — `vercel whoami` with no session **auto-starts the device-login
  flow** (prints `…/oauth/device?user_code=…`, then blocks on "Waiting for authentication…"). So
  **detection and sign-in are one action**: the spawn IS the probe, the device URL it emits IS the
  affordance. Production bounds the spawn (capture URL, kill before auth, report `pending`).
  **Verified `@sandbox`** — no-session forced by an isolated empty Vercel XDG config so the scenarios
  need only the CLI, not a real session; they run in CI, not a [[skip-mask-sandbox-unverified]]. (002
  "spawns the Vercel sign-in itself", 002 "owns the Vercel sign-in rather than telling the agent", 014
  "Doctor reads the Vercel CLI login state".) [[mvp-then-iterate]]
- **All CLIs via `npx`** — configurator/vercel; a missing global binary is not a failure ([[clis-via-npx]]).
- **Docs describe only current behavior, positively** — no references to removed paths, no "don't do X"
  negatives ([[no-self-defeating-absence-assertions]]).
- **Published Node floor is >=20.12.0 (006).** The published package ships compiled JS, so its `engines`
  floor tracks its deps (strictest `@clack/prompts` >=20.12.0); `bin/jolly` guards major>=20, esbuild
  targets `node20.12`. Dev/CI floor stays >=23 (dev runs `src/` as raw TypeScript via native type
  stripping; AGENTS.md). Spec 006 states the published-vs-dev split.
- **Human CLI DX via Bombshell (027, current iteration).** `jolly start` gains a TTY-gated interactive
  discovery built on `@clack/prompts`: it prompts only for genuine human decisions (org pick when >1,
  env name, project dir), every prompt has a sane default, and Enter always advances to the same config
  `--yes` would reach. Design law: **beautiful but never nagging — less is more**; never ask for what can
  be inferred/defaulted (001/012). The layer is **purely additive**: `--json`, `--yes`, and non-TTY are
  byte-for-byte the agent path (020 firewall holds). Side-effecting stages get a default-proceed confirm
  (human analogue of 021's riskContext); declining stops honestly, no fabrication. Also adopted:
  `@bomb.sh/args` as the single typed argument parser for EVERY invocation — agent and human alike
  (unsupported command/flag errors clearly rather than silently accepted; "agent path unchanged" means
  observable behaviour, reached through Bombshell, not a second parser) — and `@bomb.sh/tab` (`jolly
  completion <shell>` script — the one command exempt from the 020 envelope). **Design law: everything
  Bombshell can serve, Bombshell serves — args (`@bomb.sh/args`), prompts/confirms/masked-entry/spinners
  (`@clack/prompts`), completion (`@bomb.sh/tab`) — with no redundant hand-rolled plumbing, one
  implementation per concern, enforced by a `@property` conformance scenario in the family of 026's
  no-forbidden-double.** All bundled into
  `dist/index.js` so `npx @dk/jolly` stays self-contained. `jolly login`'s interactive token paste
  (018) moves onto the **same** `@clack/prompts` masked password prompt, so every human prompt shares one
  Bombshell stack — full Bombshell human UX, no duplicate prompt mechanism, agent path (token via
  flag/file/stdin/env, non-TTY honest error) byte-for-byte unchanged. Shipped in **v0.9.0**
  (`main` + tag on GitHub, `@dk/jolly` on npm). Homepage unchanged by this CLI-internals release, so not redeployed.
- **Human-friendly output by default (020, current iteration).** Default (no `--json`) output is
  human-first: concise, colourful, restrained emoji, in-place progress (Bombshell `@clack/prompts`
  spinners on stderr) for the long stages in a terminal; plain text when stdout is not a terminal.
  The machine-readable envelope is emitted **only under `--json`** — the agent's explicit opt-in —
  never in default mode. `--quiet` is silent on success, printing only warnings/errors (each with its
  stable `code`) to stderr. The result goes to stdout, progress/chatter to stderr, so piping stdout
  stays clean; colour/emoji are off under `--json`/`--quiet`/non-TTY/`NO_COLOR`. **This retires the old
  "hybrid default (human + envelope)" — agents stay the primary consumer but now opt into the envelope
  with `--json`.** Specs updated (020 primary; 001/006/014/027 reconciled) and **built**: interactive
  `jolly start` routes all Bombshell chatter plus an in-place `@clack/prompts` stage spinner to
  `process.stderr`, the result stays on stdout via `emit()`, so piping stdout stays clean. The agent/
  `--json` path is untouched. Verified by a three-PTY harness mode that captures stdout and stderr
  separately (ONLCR disabled, so a bare CR is a real redraw) — making "on stderr, not stdout" falsifiable.
- **Human interactive start runs end-to-end in one session (027, current iteration — built, `@logic`-green,
  on `main` ahead of release).** The human/TTY path gathers required input **inline** and never hands the
  human a next command for an input gate. When no Cloud token is configured, interactive `jolly start`
  prompts to **paste it inline** (the same `@clack/prompts` masked entry as `jolly login`, on `stderr` so
  stdout stays clean per 020), persists it, and continues — never closing at a blocked auth stage. The
  Vercel sign-in runs inline via the deploy stage's `vercel login` passthrough (002:98); the preview names
  it as run "with you inline". The run **ends at the one irreducible step Jolly cannot do** — pasting the
  Stripe keys + mapping the `us` channel in the Saleor Dashboard, store already live — named as the **final**
  step, never a re-run. A genuine stage *failure* (not a gate) still stops honestly; the **agent path
  (`--json`/`--yes`/non-TTY) is unchanged**. The masked token prompt is the one prompt with **no sane
  default** — a secret cannot be inferred — so Enter does not auto-advance it; this is the intended
  secret-entry exception to the "every prompt defaults" rule (056), shared with `jolly login` (018).

- **Homepage offers Agent + Terminal modes (current iteration — asset updated, specs reconciled,
  redeployed to jolly.cool 2026-06-24).** The jolly.cool hero install area is now a two-tab copybox switcher (default
  **Agent**): the Agent tab keeps the existing paste-to-agent copybox with the agent badges below it;
  the **Terminal** tab shows `npx @dk/jolly start` (same copybox style + copy-button), agent badges
  hidden. Hero microcopy: "Use Jolly with your coding agent, or run the setup directly from your
  terminal." Only one copybox shows at a time. Agent-first stays the headline/default; terminal-run
  is now an **offered** entry mode, not merely a failure fallback (002 rule "Human-runnable
  `jolly start` is an offered entry mode" reconciled; the stale "homepage copy box is unchanged"
  narration removed). Homepage stays a human-authored asset (001) — not specced/tested. **Considered
  and dropped:** making `jolly init` an alias for `jolly start` — it reverses 007's bootstrap-only
  contract and makes `start` call itself, so `init` stays bootstrap-only (007 unchanged) and the
  terminal entry command is `jolly start`.
- **Resumable-stage output continuity (008/022).** A completed `create` subcommand's `nextSteps` point
  back to `jolly start` and state it recognizes the stored work rather than redoing it (008); a
  resumable stage presents a 021 approval riskContext only for work it would actually perform this run,
  and announces an already-satisfied stage as satisfied — never re-gating it (022, incl. the `022:40`
  `@sandbox` standalone→`start` agree-on-state). The CLI's `summary`/`nextSteps` ARE the agent's
  instructions, so this contract lives in the copy.

## Shipped

Latest **0.10.2** (`main` + tag `v0.10.2`, `@dk/jolly` npm `latest`, 2026-06-25): human-facing
interactive `jolly start` copy renders from the `assets/messages/cli.json` catalog asset (027), shipped
in the tarball and guarded by the `006:14` PTY published-launcher catalog-render scenario. Earlier in
0.10.x: device-grant `Bearer`/refresh platform-API auth, `JOLLY_SALEOR_AUTH_URL` override, agent-login
success envelope, device-grant verification URL carrying `user_code`.

Through **v0.9.5** (`main`+tag on GitHub, `@dk/jolly` on npm `latest`; homepage redeployed): token-only
Saleor auth (browser OAuth removed), Stripe = app + skill (Stripe CLI removed), `@dk/jolly` naming, the
`stripe-best-practices` skill in the default set; **Bombshell CLI plumbing (027)** — `@bomb.sh/args` typed
parser, `@bomb.sh/tab` completion, `@clack/prompts` interactive `jolly start` + masked login, agent path
unchanged; **human-friendly output by default (020/027)** — human-first default, machine envelope only
under `--json`, in-place progress on stderr; **end-to-end inline human start (027)** — inline masked
Cloud-token paste, "with you inline" Vercel / "final step" Stripe gate copy; **resumable-stage continuity
(022:40, `@sandbox`-green)**; **published Node floor >=20.12.0 (006)**; and **Jolly-owned Vercel
sign-in (002/014)** — at the deploy stage with no Vercel session, Jolly spawns `npx vercel login`
itself, surfaces the device URL on stderr, bounds the spawn, reports a `pending` sign-in gate naming
Jolly + the human, and never hands the agent `vercel login` (doctor `vercel-auth` next step is `jolly
start`); `@sandbox`-verified. Launch bar met mechanically:
homepage paste → live deployed Paper storefront on Vercel → browsable/stocked store against Saleor Cloud →
checkout reaches the Stripe test step (behind the human Stripe-Dashboard gate). Full history in git.

## Open / watch

- **Paper `main` build break (watch):** `next build` of cloned Paper `main` fails with
  `EmptyGenerateStaticParamsError` on `/[locale]/[channel]/cart` (Next "Cache Components" needs a non-empty
  `generateStaticParams`). A real `jolly start` hits the same Vercel build failure today. Treated as transient
  upstream — re-verify the sandbox tier once Paper fixes `main`; if it persists, pin Jolly's Paper clone to a
  known-good ref (002/003).
- **Sandbox capacity flakiness:** a busy run can exhaust the test org's environment limit mid-run (env-create
  returns `error`); confirmed transient — creation and the harness's own direct-API create work between runs.
- **Feature 027 interactive-PTY `@logic` flakiness (watch):** the PTY-driven `jolly start` interactive
  scenarios fail non-deterministically under the parallel `-p logic` profile — same tree across three runs:
  parallel run failed 2 scenarios, a re-run was fully green, a serial run failed a *different* scenario.
  The failing target moves between runs = harness/PTY timing, not a product defect (no `src/` path changed
  by `968a28a` is exercised by 027). Risk: an unreliable `@logic` gate masks real regressions. If it
  persists, harden the PTY driver / serialize the 027 scenarios. ([[logic-parallel-loopback-flakiness]])
- **Bun report (resolved on our side):** published `@dk/jolly` is bun-free (bin shebang `node`, no bun
  shebang/scripts/engines anywhere) and `npx -y @dk/jolly` runs clean on real `node:23-alpine`. A user's
  `env: 'bun'` on an Alpine distrobox is environmental (likely a bun-backed `npx`/shim), not the package;
  awaiting their box diagnostic to harden whatever it points to. Feature 006 already guards Bun-independence.

## Goals & MVP framing

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront —
  and the customer's own agent owns it afterward. Success is the launch bar, not feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth; don't chase edge
  cases the first run won't hit ([[mvp-then-iterate]]).
- **Honesty is non-negotiable:** never fabricate success; `pass`/"verified"/success only for work
  actually performed and confirmed; unimplemented paths error honestly (features 014/018/020).
- **Empower, don't replace, the agent:** Jolly does deterministic plumbing and orchestrates the official
  CLIs; the customer's agent approves risk, completes human gates, and owns the store after setup.
- **Audience:** terminal users and AI agents are both first-class. Agents drive Jolly via the `--json`
  machine envelope (their explicit opt-in); a human runs the same commands and gets the human-friendly
  default presentation (020). Neither is "the" audience — the homepage offers both paths equally, agent
  no longer assumed.

## Product identity

- Name: Jolly. Tagline: "Ahoy. Go build a store." A CLI by Dmytri Kleiner to set up a Saleor + Vercel +
  Stripe store fast — run it yourself from the terminal, or hand it to your AI agent — not an official
  product of Saleor, Vercel, or Stripe. The pirate voice (Jolly / Ahoy / 🏴‍☠️) is brand charm, kept;
  the homepage no longer *requires* an agent (agent-first hype dialled back to terminal-or-agent, equal).
- Shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.
- **Launch bar:** homepage prompt → real deployed storefront → browsing/cart against Saleor Cloud →
  checkout reaches the Stripe test payment step, every claim verified, nothing fabricated.

## File-placement principle

`features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes.
`AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics bar unavoidable identifiers
like `@dk/jolly`, `JOLLY_*`); all test/harness methodology lives there so QM/Crew always see it. The one
admitted product-spec exception about the verification layer is feature 026's `@property` "no forbidden
double" — the discriminator for what may be a scenario is **testability, not subject**. `CLAUDE.md` is a
thin Claude-Code pointer to `AGENTS.md`.
