> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## VERDICT (2026-07-17 eve): watchbill SPENT; one Captain-owned red — BUDGETS, dk to rule

Measured warm, fresh this session: logic 195.5s (fits 210), sandbox 810.1s (vs 210),
sandbox-serial 835.9s (vs 540), eval 107s (fits 240, was 9m36 live — captures won 5.4x).
Sum ~1948s vs 1200s regression budget. Dominant single scenarios: 002 "jolly start waits
for a freshly-provisioned store to serve" 357.8s (real fresh store + real cold-start wait,
mandated by its text); the licensed chain proof 347.0s (inherent, one per run). dk options:
raise values to measured, respec the fresh-store readiness scenarios (fold cold-start proof
into the shared provisioning seam — biggest lever, ~6 min), or tier overlap (hardware;
invocations currently must stay serial per reclaim races). Do NOT touch values without dk.

Golden-capture layer landed: `features/support/eval-captures.ts` + committed
`captures/eval-captures.json` (no secrets, rg-confirmed), reads pass live / creation served
recorded, endpoint re-verification gates, `@golden-capture` sites name source runs.
Harness defects engineered out: ensureCliBundle drift (missing --external:yaml, stale-mtime
rebuild added); agent workspace escape during the broken-bundle run (cleaned + JOLLY_PROJECT_DIR
pin); one transient Vercel mid-poll auth blip (second heal green, no tolerance recorded).

## Deck state (2026-07-17): SPEED VOYAGE authored and dispatched at base `20d57e0`

All dk-ruled design captured into durable artifacts this pass:

- **Licences (dk re-ruled mid-voyage, one licence)**: `@pipeline` on exactly ONE proof —
  002 "The deployed storefront serves the Saleor catalog and a working cart". dk's principle,
  now in the verification-economy Rule: one creation test per creation seam; a re-run is
  licensed only when it tests creation DIFFERENTLY (parameters), never a different sequence.
  027's interactive completion respecced to resume-over-satisfied-stages, licence dropped.
  `@creates-env` keeps its licence. `@heavy` RETIRED corpus-wide; 028 respecced to
  shared-ambient + licensed-serial. First QM dispatch (2-licence geometry) was stopped
  mid-sweep and superseded; its support work (spend-ledger.ts, wake, provisioning, profiles)
  rides in the tree as role-advanced work in flight.
- **Invariants**: four new `@logic @invariant` scenarios in `verification-economy.feature`
  (unlicensed-spend join, once-per-resource-class, missing-ledger, budget check). Planted-red
  proof at adoption is QM's.
- **Eval**: 025 rewritten to live-agent-over-golden-captures; 026 admits the recorded-capture
  ground (hand-authored fakes stay forbidden) and drops the eval-provisions-for-real clauses.
  Eval needs no Vercel session now.
- **Budgets in RIGGING `## Tiers`** (seconds, dk-ruled 20m hard / 10m target-by-overlap):
  budget 1200, logic 210, sandbox 210, sandbox-serial 540, eval 240. Changing them is dk's
  call only. A budget red is a measured finding to report, never to tolerate.
- **Watchbill (leg 2, after QM's first final report)**: watch1 = 025 /setup capture scenario;
  watch2 @sandbox warm re-measure; watch3 @eval; watch4 = spend-join + budget invariants
  (read the warm records). First leg proved everything else green: sandbox 49/49 + 6/6,
  logic swept (one Crew fix), 027 completion 50s (was 5m26s — Crew made production
  resume-aware: `storeHoldsRecipeCatalog` read-back skips satisfied recipe/deploy stages).

**QM leg-1 rulings made (2026-07-17 late)**: (1) 004 destructive-diff guard is the element
licence — @creates-env may drive ONE toolchain element against its own env where the element
exercised differently is the assertion; never the chain. (2) Eval captures record against the
persistent shared store + shared deployment, so recorded URLs stay live and probes answer for
real. (3) Budgets: dk's values UNTOUCHED; first-pass breaches (sandbox 606/210, serial
822/540, eval 265/240, logic 195.5 fits) were structurally cold (first pipeline through fresh
fixtures, shim regeneration, store adoption after the marker fix). Warm re-measure is the
honest next measurement; if warm still breaches, the numbers go to dk for re-rule — never
quietly raised by Captain.

**Wake-wipe note (QM, unverified)**: something out-of-band rewrote coverage/ ~13:03-13:05
destroying the morning ledger+shims; no current effect after QM's fixes. Watch for recurrence;
harbour item if seen again.

**Respec trigger (dk-ruled)**: do NOT hand-respec former-heavy scenarios. QM restructures
SUPPORT to satisfy existing text against shared once-per-run ambient state (shared store +
one shared pipeline's artifacts). Only where scenario TEXT itself mandates a fresh full run
does Captain respec (state-over-navigation), on QM's NAMED blocker. Expect candidates: 002
concurrent-stage-timing, 022 resume scenarios. Judge each on its text when named.

After this voyage: PRODUCT voyages only. Methodology gets touched only when it removes cost.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a stronger or different eval model;
never touch `HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the
`assets/skills/jolly` copy or the `/setup` page). If this ever needs to bind QM, it becomes
a `.feature` scenario, never a note and never a memory.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- 0.13.29 installed into project skills this session (budget + licensed-spend law loaded).
- Open design: resume-on-signal machinery for 40-minute runs; own work item in the shipshape
  repo. This voyage's sweeps are the next test of hand-carrying the loop.
- Blockers-first handoff is upstream; retire the stale AGENTS.md local addition at next
  harbour (AGENTS is Shipwright's).
- Boatswain dead-code duty diverges by design (upstream: defer to harbour; local: remove).
  dk to rule someday; no urgency.

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber` (public-npm
   placeholder exits 0 = false green).
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — needed for @sandbox only now; eval no longer uses it.
4. `gh auth setup-git`.

## Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap 2 environments; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the only safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.

## For next harbour (report-only, re-derivable)

- AGENTS.md now stale in three places (Shipwright refits; AGENTS is not Captain's): the
  "Sandbox harness mechanics" heavy/light prose (now licensed @pipeline/@creates-env split),
  the eval live-deploy prose (now golden-capture), and the old local blockers-first addition.
- RIGGING measurement prose drift: step-def and conformance-family counts grew again
  (+4 @invariant this voyage).
- 16 zero-usage step definitions (two at `006-npx-cli-command-surface.steps.ts:502,521`).
- Still no derived check joining RIGGING `## Dependencies` to `package.json`.
- `report.html`/`report.json` tracked but are wake.
- Harbour re-verifies the golden captures against live services (026's stated cadence) — new
  standing harbour duty from this voyage.
- Support comments referencing `@sandbox @heavy` (`fast-forward-deploy.ts`,
  `recipe-on-shared.ts`) — QM likely cleans with the restructure; verify gone.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. A check that enumerates a set is trusted only after you
  verify it enumerated the set.
- Never let anything follow a verification run in the same command; the summary line is the
  evidence, the exit code is hearsay.
- `pgrep -f` matches its own command line; kill by task ID.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; never poll a dispatched agent, resume it on the observed signal.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin: role and base commit.
