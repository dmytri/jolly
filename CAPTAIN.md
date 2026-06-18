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

Captain-only notes: product framing, rationale, open questions, and current state. **Non-binding.**

Only Captain may read or edit this file. QM, Crew, and Bosun must not. Binding behavior lives in `features/*.feature` and referenced `assets/**`, never here.

> **Captain authors every `.feature` scenario** — read and follow `SCENARIO_WRITING.md` (the scenario-writing guide) for each one.

History lives in git, not here. These notes describe only the current design and the live worklist; superseded cycle logs are removed (see `git log`).

## GOVERNING DESIGN DECISION (dk, 2026-06-15): live-by-design, never mock/fake

**Binding intent.** Jolly's test suite runs against **real services** in a **fully integrated test env that matches production** — the `JOLLY_*` Saleor Cloud / Vercel / Stripe credentials in `.env` ARE that test env. **Never mock or fake** (no fake Stripe/configurator CLIs, no dummy credentials, no `.invalid` endpoints, no simulated responses). **Creating real resources is expected and correct** — that is the point. Safety is **harmless-by-design = namespace every created resource + idempotent teardown + never modify/delete a resource the run did not create** (the existing AGENTS.md rules) — NOT credential-faking. Scope: **every tier, including `@logic`** — no mock/fake anywhere. Made executable by feature 026's `@property` "no forbidden double" invariant, so a green suite carrying a fake fails there instead of passing silently.

**Failure-condition production policy (dk, 2026-06-15): real where possible; narrow justified double otherwise.**
- **Produce for real** (the majority): every failure reachable from real bad input — empty/garbage token → real auth rejection; non-first-party `--url` → real `NON_FIRST_PARTY_HOST` refusal; malformed input → real honest error. No double.
- **Justified-exception double** (enumerated, inline-justified `@exceptional-double`, never the normal path) only for conditions the real test env cannot produce on demand. Current set: `ENVIRONMENT_LIMIT_REACHED` (org at its env limit) and the **unverifiable-endpoint** "stored, not verified" path (a deliberately unreachable service).
- **Env limits — cannon fodder (dk):** environments in this test org are disposable. The `jolly-test-` prefix (`features/support/sandbox.ts` `makeNamespace`) IS the protection boundary: only `jolly-test-*` envs are deletable; the configured store and any future non-test env are never deleted.
- **Vercel:** live deploy needs a one-time interactive `vercel login`; absent it, deploy-touching tests skip-not-fail. **Stripe:** real `@stripe/cli` + test-mode keys; test cards only.

## DESIGN DECISION (dk, 2026-06-16): browser OAuth is URL-first; all CLIs via npx

- **Browser OAuth is URL-first (feature 018).** `jolly login` / `--browser` generate the Keycloak authorization URL, print it for click/copy-paste, start the localhost callback server, and open a browser only when one is available (convenience). A missing browser is never an error; `--token` is the always-available non-interactive path. Jolly never sees/holds the user's credentials. There is no Playwright tier, no `@requires-browser`, no email/password knobs.
- **All CLIs via npx (tooling).** configurator, vercel, and stripe are all used via `npx`; a missing global binary is NOT a failure. Recorded to memory ([[clis-via-npx]]) and in AGENTS.md (Runtime and Build).

## Current state (2026-06-18)

**Active cycle — second field retrospective (`~/cool/jolly-notes.md`) → specs.** A baseline agent
ran `npx @dk/jolly start` end-to-end on a remote VM (against a REUSED org/env, so most ops were
updates not creates) and reached a live, browsable, stocked storefront — launch bar essentially met
bar the human Stripe gate. dk asked for an assessment, then "proceed" to spec the four real defects.
Triage: the report's doc-structure complaints (ask-one-at-a-time, buried warning) are already
addressed by today's octopus voice pass; the gold was engineering defects. Authored 4 red targets +
`cycle.json` (pass1 honesty/security/blocker, pass2 ergonomics). Dry-run discovery: 4 undefined (the
4 new), features parse, names match `cycle.json`.

- **#1 configurator-deploy false success (headline, honesty).** Recipe's `featured-products`
  collection create FAILED (`CollectionInput.description` is `JSONString`; recipe sent a plain
  sentence) yet the configurator's summary counted "1 created"; Jolly reported the stage completed
  while the collection was absent. **Fix (asset):** dropped the collection `description` line in
  `recipe.yml` (products use plain-string descriptions and deploy fine — collection-specific
  configurator quirk; field not needed by Paper; re-add as editorjs JSON if ever wanted). Also fixed
  a header-comment drift (`--fail-on-breaking` → `--failOnDelete`, matching feature 004). **Spec
  (004):** new `@sandbox` scenario + strengthened "Configurator deploy → Honest reporting" rule —
  `completed` only after Jolly reads the store back and confirms declared entities (esp. the
  collection) exist, never from the configurator's optimistic counts.
- **#3 pnpm build-scripts → Vercel build fails (deploy blocker).** Paper's native deps
  (`sharp`/`esbuild`/`unrs-resolver`) ship build scripts pnpm 10+ ignores unless approved (no
  `--allow-build` flag); without approval `next build` fails on Vercel — the report saw 14+ red
  deploys from this. **Spec (002):** new `@sandbox` scenario + storefront-stage rule clause — the
  stage approves those build scripts so the `npx vercel --prod` build succeeds; framed as build
  config, not a source/theme edit, so scenario-84's "leave Paper unmodified" still holds.
- **#2 `.env` written mode 644 (secret exposure) + #4 `.env` apostrophe breaks `source`.** Both are
  shared-`.env`-writer invariants. **Spec (018):** new "The .env Jolly writes is private and
  shell-safe" rule + two `@logic @property @exceptional-double` scenarios (mode 600; POSIX-sourceable
  round-trip of a space+apostrophe value). They reuse the existing sanctioned "Cloud API unreachable"
  double to write `.env` locally with no network — no new double class.
- **Lower-value / not specced (noted only):** stock seeding wants `productVariantStocksUpdate`
  fallback (skill nit); trusted-origins needs staff `MANAGE_SETTINGS` so it's really a Dashboard
  action (skill overclaims auto-wiring; e2e still works server-side); Vercel Deployment Protection,
  `og:image` localhost, agent-detection `null`, `jollx` typo — noise/out-of-scope (upstream
  configurator counts/deletes are an upstream bug, not ours).
- **cycle.json:** pass1 = 002 build-scripts, 004 collection read-back, 018 `.env` mode-600; pass2 =
  018 `.env` shell-sourceable. **Next role: QM** (fresh context). Crew implements the read-back,
  build-script approval, and `.env` writer hardening.

---

**Setup-guide voice pass (dk) — octopus installer persona.** dk wanted `setup.md` to have
personality: strong-but-silent voice + a touch of silly **octopus** (dk chose "octopus is the
mascot"), installer-like, very concise, focus on needed input/confirmation, minimal interaction,
ask one question at a time, use pick-an-option inputs over free-text, no walls of spew. Scope dk
set: **`setup.md` only** ("set up only" / "only") — not the Jolly skill, homepage `index.html`, or
features. Rewrote `assets/homepage/setup.md`: Jolly is now 🐙 the eight-armed setup octopus; new
"How to run this" interaction-protocol section (terse / one-question / offer-choices /
confirm-before-risk / surface-only-decisions / honest); human gates now correctly list **four**
moments (added the Dashboard Stripe-app gate that the old "What needs a human" section dropped);
load-bearing reference (provenance, hosts, two-auth-schemes anti-"dead-token", headless-VM, skills,
boundaries) preserved but moved to a scannable "Reference — read when you need it" tail. Asset-only
edit (assets are not spec'd/tested → no QM cycle). **Not yet committed/deployed.**
- **Inconsistency flagged to dk:** homepage `index.html` is still pirate-themed (🏴‍☠️/⚓/🦜); only
  `setup.md` is octopus now. If the octopus mascot should land consistently, `index.html` + the
  Jolly skill would follow — deferred by dk's "set up only".
- **Redeploy needed:** `setup.md` is served at jolly.cool/setup via the homepage Vercel project, so
  the new copy is live only after a homepage redeploy (outbound — needs dk approval).


**Active cycle — real-world agent retrospective → specs.** A baseline agent ran `npx @dk/jolly start` end-to-end on a remote VM and completed the full pipeline (store/recipe/stock/deploy/stripe-app), but needed eight operator interventions; the retrospective (`~/test/jolly-notes.md`, dk-provided) catalogued the friction. Captain converted the Jolly-actionable findings to specs this cycle and routed the agent's own knowledge gaps to `setup.md`. `cycle.json` directs QM through the new red targets (pass1 honesty-critical, pass2 ergonomics).

**Cycle progress (2026-06-18):**
- Specs/assets/cycle.json committed (`af1319d`).
- **pass1 10/10 DONE.** 014 cloud-token validity probe (×3) + 005 live-mode `sk_live_` warning (`c24326b`); 018 login headless token sources (`1341a5c`): `--token-file`, `--token-stdin`, `$JOLLY_SALEOR_CLOUD_TOKEN` + precedence, empty-file honest error (`EMPTY_TOKEN_FILE`, never browser-blame), `@sandbox` file-token verify. Production: a headless token-source resolver on `jolly login` (precedence after `--token`); verify-before-write reuses the existing `listOrganizations` (`Token`-auth org GET) path.
- **Verify:** 018 logic 16 passed / 1 undefined (the pass2 `018:200`); 014+005 logic 23 passed / 1 skipped; tsc clean. The `@sandbox` `018` file-token verify skips local (credential-gated to CI), same as the existing `--token` verify scenario.
- **pass2 → now the live work (4):** 014 Vercel account naming, 018 headless-listener warning, 006 `--help` usage, 002 `start --dry-run` idempotency. **`cycle.json` advanced** — these became `pass1`; the verified former-pass1 was dropped.
- **new-pass1 4/4 DONE — directed cycle complete; `cycle.json` retired.**
  - 014 "Doctor names the authenticated Vercel account" (`da29de3`): `vercel-auth` pass names the account `vercel whoami` reports. Gated `[]` creds + Vercel CLI capability (skip-not-fail without a session).
  - 018 `018:200` headless-listener warning, 006 `--help` usage, 002 `002:58` dry-run store-skip all landed (`2b2845c`):
    - **018:200** — bare `jolly login` (no browser) now warns the OAuth callback `127.0.0.1:5375/callback` is served on the machine running Jolly, that a browser on another machine cannot complete it, and directs to `jolly login --token <value>` for that case (src: login presentation summary + nextSteps).
    - **006:86** — every command/subcommand prints a usage summary on `--help` and exits 0, never entering the flow or aborting (new `commandUsage` + dispatch `--help` interceptor; bare `create --help` keeps its subcommand listing).
    - **002:58** — `jolly start --dry-run` reports an already-configured store as satisfied and skips provisioning, naming no Cloud API create request (src: `commandStartDryRun` branch on `NEXT_PUBLIC_SALEOR_API_URL`; the shared dry-run When now honours `notes.startEnv` so a configured-store starting state can be supplied to the preview).
  - **Verify:** `@logic` profile 120 scenarios — 119 passed, 1 skipped, **0 failed**; tsc clean; `--dry-run` discovery clean (0 undefined).
  - **Verification-layer fix (earlier, `da29de3`, QM):** feature 026 "no forbidden double" RED before that pass — the 018 `.invalid` exceptional-double sat outside the 026 scanner's 3-line window; annotation moved adjacent (comment-only).
  - **Spec-quality, for the next Bosun sweep:** 014 has two live-session `@sandbox` vercel-auth scenarios (mechanism vs. account-naming); distinct observables, both green; consider consolidating.
- **INVESTIGATED — 2 `@sandbox` failures = stale local `.env`, NOT a bug or this cycle (dk asked to investigate before push):** the default-profile run (all tags) shows `002:77` (`saleor-connectivity` not `"pass"`) and `002:66` (whole-flow stages not all `"completed"`) failing. **Root cause:** the local `.env` `NEXT_PUBLIC_SALEOR_API_URL` points at `jolly-test-demo-1781717774.saleor.cloud` — a `jolly-test-` **cannon-fodder demo env from a prior retrospective run, since reclaimed/deleted (HTTP 404)** (the "DEMO RESOURCES (cannon fodder)" note below). So `002:77`'s doctor connectivity honestly reports `unknown` (can't verify a 404'd store) ≠ `pass` — **product is correct**; the scenario expects a live store the stale `.env` lacks. `002:66` runs (a Vercel session + Stripe/Cloud creds exist locally) and fails on a real full-deploy condition. **Not a gating gap** in the strict sense: creds are present, the store was just deleted; the gate checks credential PRESENCE, not store reachability. The `@logic` worklist is unaffected and green. Neither touches the changed dry-run/`--help`/shared-When paths — mechanically not `2b2845c`.
  - **Options for dk:** (a) refresh/clear the stale `.env` store (point at a live store or unset it so `002:77` skip-derives) — simplest; (b) extend `@sandbox` skip-not-fail so a configured-but-unreachable store skips rather than fails (a harness-fidelity item, route via `cycle.json`); (c) leave as-is — local-only noise, CI provisions fresh stores. No spec change either way; this is harness/local-env, not product intent.
- **RELEASED v0.7.1 (dk approved push/deploy/publish, 2026-06-18).** Bumped `0.7.0 → 0.7.1` (`babe6f1`, tag `v0.7.1`) and:
  - **push:** `main` + tag `v0.7.1` → `github.com/dmytri/jolly`.
  - **publish:** `@dk/jolly@0.7.1` → npm (public). prepublishOnly built `dist/index.js`.
  - **deploy:** homepage → Vercel production (project `homepage`), Ready; `/` and `/setup` both HTTP 200.
- **Stale-store fix applied (option a, dk):** removed the dead `NEXT_PUBLIC_SALEOR_API_URL` (`jolly-test-demo-1781717774`, 404) and its paired `JOLLY_SALEOR_APP_TOKEN` from the local `.env`; Cloud token + Stripe keys kept, so `@sandbox` store/app-token now skip-derive (provision fresh) instead of failing on the deleted store. `.env` is git-ignored; no commit. (Backup file was created then deleted — never committed.)
- **Homepage copy fix (dk, retrospective feedback) — `7c20244`, redeployed.** The paste prompt said "...to set up **Jolly**"; the retrospective agent read that as the goal and got confused (Jolly is the helper, not the goal). Now "...to set up **a Saleor store**". Live: `homepage-khaki-eight.vercel.app` serves the new copy. `copyPrompt()` reads `#copyText`, so the HTML span is the single source — no JS duplicate.
- **Next:** the deferred sandbox sweep + `-p eval` run; the 014 two-vercel-auth-scenario consolidation at the next Bosun sweep.

- **Specs authored (this cycle):**
  - **018** — flexible token input: `--token-file`, `--token-stdin`, `$JOLLY_SALEOR_CLOUD_TOKEN` with precedence + verify-before-write (so an agent never hand-writes the secret into `.env` and skips verification); a headless-listener warning (the OAuth callback is on the machine running Jolly, so a remote browser cannot complete it).
  - **014** — doctor probes Cloud-token VALIDITY not presence (real authenticated org GET → `pass` naming the org / `warning` on a real 401 / never a fabricated pass); a per-store-vs-Cloud token fingerprint warning; passing `saleor-cloud-token` + `vercel-auth` checks name the authenticated org slug and Vercel account.
  - **005** — doctor warns on a live-mode Stripe secret key (`sk_live_`); v1 is test mode only.
  - **006** — every subcommand prints usage on `--help`, never "Command aborted".
  - **002** — `jolly start` skips store provisioning when a store endpoint is already configured (idempotency).
- **Assets refined (agent-knowledge gaps, NOT Jolly bugs):** `setup.md` gained "Saleor Cloud auth — two endpoints, two schemes" (Cloud platform API uses `Token`; store GraphQL uses `Bearer`; probe `/platform/api/organizations/`, never `cloud.saleor.io/graphql/`; two similar token shapes) and "Operating headlessly or on a remote VM". Marketing `index.html` left unchanged (less-is-more; it correctly routes to `/setup`) — **flagged to dk in case visible homepage copy was wanted.**
- **NOT a bug — the agent's own missteps** (guessed `Bearer`, probed `/graphql/`, concluded the token dead): these drove the `setup.md` refinements, not code changes. `cloud-api.ts:28`'s `Bearer` comment is *correct* — it is the STORE GraphQL appInstall context, a different endpoint from the Cloud platform API (`Token`, `cloud-api.ts:97`).

**Deferred this cycle (dk's recorded order was item-3-then-seam; the retrospective superseded it — dk approved):**
- **Live `-p eval` run (was "item 3").** Both prior blockers fixed (auth-only seed `54aa9ca`, pre-run reclamation `2b18b17`); `setup.md:97` already steers background+poll. Remaining is an operational run; pi's per-command bash timeout vs the ~8-min `jolly start` is the open risk.
- **Seam-scoping fidelity fix.** `reclaimLeftoverTestEnvironments` deletes ALL `jolly-test-` envs incl. the current run's; feature 025 + the 026 scenario say "previous run". Harmless today (gated; the eval has no current-run env at pre-run time). Clean fix: scope to previous-run leftovers + seed the 026 leftover under a simulated previous-run namespace. No spec change needed; harness-faithfulness QM item. `026:21` passes but does not assert the current-run env survives — strengthen it when worked.

**Report backlog not yet specced (preserved, not lost):**
- Manual-OAuth code-paste path (`--manual-oauth`: print URL, read `code` from stdin) — `@iteration`; `--token`/`--token-file` already cover the headless path for v1.
- JOLLY-010: single source of truth for the Cloud-API `Token`-auth fetch shared by doctor + login (impl preference; Crew may do it when touching the area, not a scenario).
- JOLLY-011: surface `@saleor/configurator --plan` higher in user-facing output.
- **DEMO RESOURCES (cannon fodder):** hand-driven live `jolly-test` envs from the retrospective still standing; the next eval run's pre-run reclamation removes them.

- **Remaining to v1 ship:** the retrospective confirmed the paste→live-store flow works end-to-end in the field — all mechanical stages completed against real Saleor Cloud + Vercel. The launch-bar's "checkout reaches the Stripe test payment step" still depends on the irreducible human Stripe-Dashboard key+channel gate; `jolly doctor`'s checkout probe verifies it once done. The ergonomics gaps the run hit are the specs above.
- **Open follow-up (architectural, non-blocking):** the `NON_FIRST_PARTY_HOST` guard sits only at the `graphqlFetch` seam (where the customer `--url` flows). Sibling seams (`cloudFetch`, `pollTaskStatus`, `timedGraphql`) take only internally-derived first-party URLs and are unguarded — no scenario exercises them. If a future scenario lets a customer-supplied host reach them, centralize the predicate at one canonical request choke point.
- **Deferred past v1:** tracked by the `@iteration` tag (`cucumber-js -p iteration`). Notable backlog: `009` multi-agent detection matrix, `006` command-surface/flag-matrix robustness, `007` failed-skill-install surfacing, `017` auto-apply safe skill update, `002` resume-skip, `003` Paper guidance-in-plan.

## Lessons learned → Shipshape upstream (2026-06-15)

Process lessons from the live-by-design design session. Workflow-generic (not Jolly-specific) — candidates for upstreaming to Shipshape's role prompts / scenario rubric.

1. **Green-suite blindness.** QM derives its worklist only from undefined/failing targets, so a suite that is green *with* forbidden fakes yields an empty worklist — the violation is invisible. *Upstream:* a methodology rule that is not encoded as a failing check is unenforced; the workflow must let conformance be a discoverable target, not only prose in the agent-config doc.

2. **Testability, not subject, is the line for what's specifiable.** The real discriminator is falsifiability: untestable aspiration is banned; a *testable* harness/conformance invariant ("no forbidden double outside tagged sites") is a legitimate `@property` scenario. *Upstream:* state it as "testable ⇒ specifiable, regardless of subject".

3. **Disposability has a granularity prerequisite.** "Specs durable, code disposable" yields clean regeneration only when the disposable unit is modular enough to match what you want to replace. Fix: refactor-to-seam first (behavior-preserving, green-guarded), then dispose/flip surgically. *Upstream:* the regen model needs a modularity precondition, and a behavior-preserving refactor is a distinct cycle shape — green-guarded, human-directed, **not** red-discovered.

4. **The disposable layer is three, not two.** The fakes lived in the *test harness* (step defs + support) — neither spec nor implementation. *Upstream:* name the verification/harness layer explicitly as its own disposable-from-specs layer with its own conformance.

5. **Encode constraints as positive observables, not prohibitions.** The enforceable form of "Jolly shall not call the API directly" is a positive scenario whose observable is the desired behavior ("Jolly invokes the official CLI"). *Upstream:* guide authors to express security/architecture constraints as positive falsifiable observables.

6. **Directed work needs a firewall-safe channel.** Genuinely non-red-discoverable work (refactors, conformance seeding) has no firewall-safe entry except `cycle.json`. *Upstream:* define a sanctioned "directed cycle" handoff — a durable, QM-readable scope artifact.

7. **On a role takeover, the predecessor's flagged blockers are the primary input — the role prompts don't enforce it.** (2026-06-17, observed live.) Captain took over after a QM→Crew→Bosun cycle whose final report listed blockers, but led with the outbound decision and imported a stale `CAPTAIN.md` worklist instead. *Upstream:* every role prompt's opening should make the immediately-preceding role's final-report blockers/open-questions the FIRST agenda item, read verbatim; state that a takeover is often several situations at once (handle all, blockers first); rank the fresh handoff above accumulated notes on conflict. (Local stopgap in `AGENTS.md` → "Role handoffs".)

## File-placement principle

- `features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes. `AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics, bar unavoidable tooling identifiers like `@dk/jolly`, `JOLLY_*`). `CLAUDE.md` = thin Claude-Code-specific pointer to `AGENTS.md`.
- All test/harness methodology lives in `AGENTS.md` so QM/Crew always see it — the tiers, *real services always (never mock/fake)*, *harmless-by-design*, the sandbox provisioning/teardown mechanics. The one admitted exception in `features/**` is a *testable conformance invariant* about the verification layer (feature 026's `@property` "no forbidden double"). The discriminator for what may be a scenario is **testability, not subject**.

## Goals & MVP framing (the real objective)

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront — and the customer's own agent owns it afterward. Success is defined by the launch bar below, not by feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth. Don't over-engineer or chase edge cases the first run won't hit. Setup is v1; the iteration phase (feature 019) comes after.
- **Honesty is non-negotiable:** never fabricate success. "Verified", `pass` checks, and success claims only for work actually performed and confirmed; unverified work says so; unimplemented paths error honestly. This is the trust the whole product rests on (enforced as behavior in features 014/018/020).
- **Empower, don't replace, the agent:** Jolly does deterministic plumbing and orchestrates the official CLIs; the customer's agent stays in charge — approves risk, completes human gates, owns the store after setup.
- **Audience:** AI agents/skills are the primary consumers; human DX stays decent but secondary.

## Product identity (non-binding)

- Name: Jolly. Tagline: "Ahoy, agent. Go build a store."
- A tool by Dmytri Kleiner to help an agent set up a Saleor + Vercel + Stripe store fast. Not an official product of Saleor, Vercel, or Stripe.
- Product shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.
- **Launch bar** (when v1 is good enough to ship): homepage prompt → real deployed storefront → browsing/cart against Saleor Cloud → checkout reaches the Stripe test payment step, every claim verified, nothing fabricated.

## Architecture framing (non-binding; behavior is specified in features 002/008)

- `jolly start` is agent-supervised orchestration: it runs the mechanical stages by spawning the official CLIs and Jolly helpers, pauses for approval/risk context, and waits at human gates. The ordered stages and their contracts are specified in features 002 and 008 — not enumerated here.
- Human-run `jolly start` is the backup path for interactive gates a non-TTY agent cannot complete. The homepage stays paste-to-agent first.

## Open questions (deferred out of features)

- `features/001`: whether Jolly should create project-local durable artifacts such as `.jolly/` reports or state; exact per-environment setup steps for supported agent targets.
- `features/008`: whether `jolly create app-token` should request all available permissions or allow the agent to specify a subset.
- `features/012`: which pasted URL forms Jolly should normalize in v1; exact Saleor API or Dashboard automation path for app-token creation; exact task-status response shape and domain extraction against the live Cloud API.
- `features/019`: mcp-graphql config format for each supported agent environment; whether `jolly doctor --watch` belongs in v1 or v2; upgrade cadence signal for outdated skills.
- `features/020`: envelope schema versioning; canonical registry of stable error codes and check ids.
- `features/021`: whether `riskLevel` is derived deterministically from categories or set per action; optional fields such as estimated cost or affected record counts.
- `features/022`: how Jolly detects completed remote work, and whether resumable state is tracked in local artifacts such as `.jolly/`.
- `features/023`: CI wiring for sandbox credentials.

## Non-binding notes

- The product stack is specified in features, not restated here: Paper storefront + Vercel (002), Saleor Cloud only / no self-hosted (003), the configurator starter recipe (004), Stripe test mode only (005).
- Post-setup customization belongs to the customer's own agent/workflow.
- Homepage/setup-guide copy principle: less is more; avoid junk and duplication.
- Open future item: the npm tarball is large because `assets/skills/jolly/images/` ships product PNGs referenced by the starter recipe — functional, but worth future assets work.
- Forward goal (not built): step-result caching so unchanged verification is not re-run and status returns fast. Caching needs a mechanism + invalidation rules, reporting cache-backed vs fresh, and must never hide a real failure.
- Future plan: extract the scenario-writing rubric into a standalone reusable skill — project-local first, then upstream to Shipshape — and audit ALL existing scenarios against it in one pass.
