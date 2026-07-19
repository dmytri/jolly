> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## STATE (2026-07-19, close): BATCH SHIPPED — origin/main at 2692ae9. Follow-up watchbill LIVE.

Voyage landed all four rulings: 027 failed-close (was a CRASH to UNEXPECTED_ERROR — Crew fixed
runStartCore), 020 junk-input sweep (caught auth-status fabricating success on junk token —
Crew fixed commandAuthStatus), 006 spawn-surface checker (green; teeth proven by plants),
004 diff-naming (Crew added --plan preview parse; block names deletions + approval). Sweeps
also caught + fixed an error-envelope regression; QM fixed a harness 502-retry gap at
env-factory. Custody 2692ae9 (13 files), pushed. Conformance 66/69.

THE MEASUREMENT (three-lane window, clean box): logic 295.5 (OOM-contaminated), eval 174.8,
sandbox serial 778.7 + parallel 734.9, laned wall ~25.3 min. REAL OOM kill mid-window
(~20GB demand, 7.9GB box) -> workers throttled to 1; quiet logic 269.9 at 222 scenarios.

dk RULED (2026-07-19): (1) INTERIM budget-logic 300 from quiet 269.9 (RIGGING edited); FINAL
values + sum->overlapped-window budget-fit spec edit land from the NEXT batch-close laned
run (self-settled throttled prior). OOM + 028 serialization reds RIDE until that run
replaces the wake records — never launder them with a rerun. (2) 502-resilience PROMOTED:
two @logic @exceptional-double scenarios in 004 (transient-retry success + exhaustion
honesty). (3) Push APPROVED and DONE (2692ae9).

FOLLOW-UP LANDED: both 502 scenarios were RED ON PRODUCTION (no poll retry existed); Crew
built the bounded retry + stable TASK_STATUS_UNCONFIRMED + honest summary (src/lib/cloud-api.ts
pollTaskStatus, src/index.ts cloudErrorEnvelope). Budget-fit green vs 300. Custody e22cca2,
watchbill struck, tree clean, main AHEAD OF ORIGIN BY 1 — push offered to dk at close.
npm publish still PARKED (2FA).

## RESUME AFTER CLEAR (written 2026-07-19 ~17:45 UTC) — WINDOW IN FLIGHT. DO THIS FIRST.

HARBOUR SESSION context: dk ordered a timing probe; Shipwright measured top-5 (the 026
reclaim pair + 004 destructive-diff walls were STARVED-ORG retry budgets, not green costs —
ONE young leaked env starved creations 29 min; org headroom above the shared store = 1
slot). Contention = NORMAL operating condition per dk ruling. Run-liveness reclamation
finding (age gate cannot tell dead-run leftovers from live siblings') routed to overlap
charter.

CHARTERED FULL LANED WINDOW launched 17:18 UTC by Shipwright (harbour), current tree
= a0d1ffd + these notes:
- @eval DONE: 4/4 green, wall 179.4s/240, eval.ndjson REPAIRED (parse-verified). /setup
  scenario finally measured: 100.44s tier max; amortization holds; no eval in top-5 range.
- @logic: lane EXITED (was PID 3289894); collection was queued to Shipwright at clear
  time. Expect 224 scenarios with the 2 riding reds one final time BY CONSTRUCTION (they
  read the PRE-window sandbox record).
- @sandbox: IN FLIGHT at clear, outermost PID 3290051 (serial licensed leg ~15 min, then
  parallel leg at 1 worker — OOM-throttled prior). CHECK `ps -p 3290051` FIRST: gone =
  window complete, signal Shipwright to collect; alive = arm `tail --pid=3290051`
  background waiter (signals route to MAIN; SendMessage the role on exit).
OWED by Shipwright post-window: full collection (per-tier walls, licensed-set durations
incl the @pipeline proof's first-ever green cost, whole-window wall vs 2250, pressure
lines), THEN focused runs of the two rider checks to VERIFY retirement, never infer: OOM
check should retire with the rewritten sandbox.ndjson; 028 MAY PERSIST via the
worker-recovery gap (deriveWorkerCount in features/support/pressure.ts never climbs back
from a throttled prior; 028 requires parallel>=2). A persisting 028 = worker-recovery
design gap -> overlap-charter spec candidate, NOT a launderable flake.
IF the prior Shipwright agent is unreachable from the fresh session: dispatch a fresh
Shipwright (base a0d1ffd, root /home/exedev/jolly, scope: collect the COMPLETED window
from the wake streams — coverage/weather/*.ndjson + runrecord.ndjson — and report as
above). The streams carry everything; nothing depends on lost context.

THEN, in order:
1. Captain writes the dk-RULED spec batch (ALL held until the window closed so no edit
   entered the measured sweep):
   a. 026 MERGE: ONE scenario seeding BOTH leftover shapes (name-namespaced env AND
      domain-label-namespaced), asserting both reclamation selections; supersede DELETES
      the two originals ("...reclaims a leftover jolly-cannon-fodder environment instead
      of skipping the run" and "...reclaims a leaked environment that carries the
      namespace only in its domain label", both
      features/026-live-by-design-verification.feature, @creates-env serial).
   b. WAIT SHRINK (dk-ruled 2026-07-19): 002 "jolly start blocks the store stage when a
      freshly-provisioned store never becomes reachable" and 002 "jolly start waits for a
      not-yet-serving store to serve before completing the store stage" both run their
      real seam with a SHORT harness-knob budget/delay (seconds; the HARNESS_* readiness
      knob family is the real config input — no new double); PLUS a new zero-cost @logic
      assertion pinning the production DEFAULT readiness budget (the constant stays
      specced without wall-clock). Rationale: resolve-on-signal + honest exhaustion are
      the contracts; real cold-start assurance lives with the licensed real-provisioning
      runs (@pipeline rode a real cold start this window). Saves ~6 min/sandbox window.
   Watchbill entries ride every edit.
2. Bring dk the window numbers -> dk rules FINAL budget values + the
   sum->overlapped-window budget-fit spec edit; both ride the same watchbill.
3. QM voyage (merge binding + proofs), custody, OFFER push (per-batch approval).

QUEUED NEXT BATCH: (1) 026 merge supersede (above) + its watchbill entry; (2) @bomb.sh/tab
0.0.19 -> 0.0.20 (latest-stable drift, Boatswain-flagged; mechanical bump +
completion-scenario proof); (3) post-window: dk rules FINAL budget values + sum->window
spec edit from the window's numbers; ALSO the old chartered-close item:
FINAL budget values + sum->overlapped-window budget-fit spec edit from that run (self-settled
throttled prior), which also replaces the OOM/028 wake records and covers the support-hunk
blast radius custody named unverified (shared When + step-def files, @logic and @sandbox
sweeps). Note: features/support/tls/ now carries a deliberate loopback-only test cert
(CN jolly-loopback-test; secures nothing real) — durable fixture, not a leak.

Relay duty for a rehydrated Captain: QM/mate detached-run signals route to MAIN, not up the
chain — arm `tail --pid=<exact ps PID>` background waiters, SendMessage the role on exit
(see Resume-loop mechanics). Boatswain finding for harbour: 21 zero-usage defs (baseline 16);
stage-timing/riskContext/sign-in-gate orphaned patterns named by planks on src start seams =
behaviour-stale plank risk, coverage triage's.

Shipshape updated 0.13.28 -> 0.13.32 this boundary (plugin cache + project skills; tree clean).

Harbour flags standing (next harbour): 002's 5 orphaned defs + orchestrator seam re-plank to
@composition steps; 16 baseline zero-usage defs; RIGGING prose drift (step-usage counts
986/16 -> 1101/22; dependency-audit note calls the landed dependency-join check a "standing
finding"); README "Node >= 23" vs engines >=20.12.0; usage-json dry-run exits 0 on undefined
steps (rigging note candidate). Queued beside them: zero-usage step sweep; retire stale
AGENTS.md local blockers-first addition (AGENTS is Shipwright's).

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly`
copy or the `/setup` page). If it must bind QM, it becomes a `.feature` scenario, never a note.

## Resume-loop mechanics (proven; carry until upstream mechanizes it)

Captain hand-carries role resume across detached runs: role launches detached, ends turn;
Captain waits on the run, SendMessages the role on exit. 5 lost detached-run signals across
recent sessions; the Captain-side `tail --pid` fallback waiter saved every one. ALWAYS arm it:
- `tail --pid=<EXACT NUMBER>` only, pid read from `ps` in the FOREGROUND first. NEVER pgrep
  in the waiter (self-matches; node comm is "MainThread" here).
- A nested role cannot be signalled through its parent — tell the parent the run exited and
  to collect/re-run itself.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- Resume-on-signal machinery remains the TOP work item — the harness must resume a role on
  its detached run's exit, not discipline.
- **Tier-taxonomy findings (dk 2026-07-18, keep):** Tiers are execution profiles; lanes are
  tags. A proof-technique grouping with @logic's profile is a LANE (tag + closing conformance
  invariant), never a tier: @composition adopted here (spy-based launch-order/wiring
  assertions; invariant: every composition-ground spy serves only @composition scenarios).
  "Primary tier" collapses into the licence tags: @pipeline/@creates-env already enumerate
  the primary set; the missing piece was ORDER (primaries-first: licensed serial leg before
  derivative parallel leg — counters shared-store reuse masking a broken creation path).
  Eval-gating boundary: capture-consuming tiers couple to COMMITTED captures at harbour
  cadence, never gated behind this run's primaries. Element-spend licence gap: single
  toolchain ELEMENTS escape the chain/creation ledgers; light fix = pin fixture SOURCE in
  Givens; heavy candidate if it recurs = @spends-<element> tags. Golden-capture tiers are
  the general cheap-composite pattern. Perturbation vs TypeScript: bare head-throw kills
  narrowing; the guard form (`const perturbationStanding: boolean = true; if (...) throw`)
  preserves token + red + typecheck-green — upstream as the TS perturb idiom. Instrumented
  streams are a SEPARATE wake path by construction (harbour coverage runs polluted the
  operational prior once).
- **Latency findings (dk 2026-07-18, keep):** ~4/5 of batch wall clock was agent latency,
  not tests. Levers in leverage order: concurrent focused groups (ADOPTED standing QM
  procedure); parallel Crew mates (ADOPTED); resume-on-signal machinery; event-driven
  narration over fixed-cadence polling (ADOPTED — report on state change, never a status
  cron). Proposed, awaiting dk word: support-edit selection refinement (join-selected
  recheck for joinable support; tier sweep only for tier-global files; conformance family
  via its own command). NEW this batch: tier-lane overlap adopted as a RIGGING `lanes`
  value — upstream candidate: the Watchbill policy's cheapest-first serial ordering should
  admit a rigging-declared concurrent-lanes override.

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`. npm publish also needs `npm login` / @dk publish token (see parked).

## Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap 2 environments; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the ONLY safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for
  `@creates-env` guard deploys (004). One creation test per seam; different parameters, not
  different sequences. Fixture SOURCE pinned in Givens where a template serves (029 deploy).
- Golden captures record against the PERSISTENT shared store + shared deployment (live URLs);
  reject per-run-tainted observations by CONTENT. Harbour re-verifies captures vs live services.
- Reclamation is age-gated (feature 030): stale = older than the full-regression budget; a
  younger namespaced resource is a live sibling's. Shared store exempt by name, as before.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. Trust a set-enumerating check only after verifying it enumerated.
- Never let anything follow a verification run in the same command; the summary line is evidence,
  the exit code is hearsay.
- Kill by exact ps-listed PID, never `pgrep -f` (self-matches). Wait on exact PIDs only.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- dk wants QUESTIONS AS QUESTIONS: crisp, structured, one decision each — the structured
  tool works; keep using it.
- A tier's wall clock inflates hard under contention; measure budgets under the concurrency
  they will actually run in; instrumented runs never stand as operational priors.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin (role + base commit); hold Captain writes while a role holds the deck.
- Conformance family (@logic @property/@invariant) must be green before custody.
- A Captain spec edit rides a watchbill entry EVEN during blocker resolution; an edit to a
  scenario QM just made executable orphans the definition.
