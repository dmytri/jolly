> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## STATE (2026-07-19, evening close): TIMING HARBOUR DONE — rulings executed, watchbill LIVE, session cleared here.

Shipped earlier today: 2692ae9 (four-promotion batch; every promotion caught a real defect)
and e22cca2 (502-retry follow-up), both pushed. Then dk ordered slow-scenario work:
Shipwright ran a selective probe plus the chartered full laned window (17:18-17:54 UTC,
production tree = a0d1ffd): 283 scenario-runs, all green except the riders; window wall
2197s/2250; pressure lines clean, zero OOM. OOM rider RETIRED (verified by focused run).
028 red CONFIRMED as the worker-recovery gap: deriveWorkerCount only ratchets down, nothing
restores parallelism (~10 min/window cost at 1 worker). Licensed greens measured for the
first time: @pipeline 319.1s (the true #1), 004 destructive-diff 159.3, 026 pair 87.6/83.8,
012 pair 81.3/75.9. Wait-composition audit: corpus is signal-ended throughout; the only
true Godot was 002 never-reachable (100% budget exhaustion); 027 never-a-link's 107s is
the REAL Vercel CLI's own retries (accepted as real-dependency cost); 020 serving's old
fixture-debt flag is DISCHARGED (rides the shared deployment).

dk RULINGS, ALL EXECUTED as spec/RIGGING edits — work in flight, uncommitted, riding the
watchbill:
1. 026 reclaim pair MERGED into one scenario seeding both leftover shapes (026 feature).
2. WAIT SHRINKS: 002 never-reachable now pins an 8s budget via the JOLLY_READINESS_BUDGET_MS
   Given; 002 not-yet-serving pins a 5s serve-delay Given; NEW @logic constant-pin scenario
   "The default readiness budget is 600 seconds unless overridden" (002).
3. WORKER RESTORE: verification-economy worker-prior scenario AMENDED — a clean record
   restores toward configured parallelism, and a count held low by a clean record reddens.
   QM implements in features/support/pressure.ts (deriveWorkerCount). Retires the standing
   028 red once a clean window records restored workers.
4. BUDGETS (final, real-world mixed-load basis per dk; contention = normal): logic 375;
   budget 2250 now judged as the LANED WINDOW wall (sum-to-window edit landed in the
   budget-fit scenario); sandbox 900 presumes restored 2 workers. Re-ratchet from the next
   window, never a bare edit.
5. Ceiling-pinned-step @invariant ADOPTED (verification-economy): a step running at its
   declared read ceiling reds; planted-red proof at adoption is QM's.
6. Push at clear APPROVED — notes commits only; production tree unchanged since a0d1ffd.

WATCHBILL LIVE — the fresh session dispatches QM on it (role + base commit + project root,
base = HEAD after the notes push): watch1 @logic targets (constant-pin, worker-restore,
budget-fit re-proof, ceiling rule), watch2 @sandbox targets (026 merged scenario, both
shrunk 002 waits), watch3/4/5 tier lanes = the NEXT measurement window (post-shrink,
post-restore) from which dk re-ratchets values. EXPECTED: watch1/2 red-then-green (new and
edited steps; the ceiling rule owes its planted red); the pressure.ts support edit selects
tier sweeps = exactly watch3-5; 028's standing red retires at the watch5 window provided
the restore lands first (watch order holds that). ARCHITECTURE counts may drift (net +2
scenarios) — custody refits. Supersede debris: the two deleted 026 scenario names orphan
their unshared step defs — QM/custody cleans.

FRESH SESSION OPENING: /captain -> read this file -> dispatch QM. Relay duty: detached-run
and subagent signals route to MAIN, not up the chain — arm `tail --pid=<exact ps PID>`
background waiters, SendMessage the role on exit, and VERIFY a fired waiter's PID is gone
before relaying (cap-fires happen). AFTER voyage + custody: present the new window numbers
to dk (re-ratchet ruling), offer push. npm publish PARKED (2FA). Order the @bomb.sh/tab
0.0.19 -> 0.0.20 bump as custody hygiene with this voyage (latest-stable policy, flagged
by Boatswain).

## Parked findings (harbour and product observations, no action ordered)

- Next harbour: zero-usage defs at 21 (baseline 16); 002's 5 orphaned defs + orchestrator
  re-plank to @composition; stage-timing/riskContext/sign-in-gate orphaned patterns named
  by planks on src start seams (behaviour-stale plank risk); RIGGING prose drift
  (step-usage counts; dependency-audit note); README "Node >= 23" vs engines >=20.12.0;
  usage-json dry-run exits 0 on undefined steps.
- Overlap charter: run-liveness reclamation (age gate cannot tell a dead run's leftovers
  from a live sibling's; org slot headroom above the shared store is ~1, so one young
  leftover starves every creation for a whole leg).
- Product observations, dk's to order or drop: the vercel reuse path costs 111s in 020
  serving confirmation (product efficiency); each deploy-stage walk pays ~46s npx+vercel
  spawn latency (002 URL-reuse); per-stage timings in the closing summary would decompose
  PTY walls the harness cannot see into (027 failed-close, the logic ceiling at 60.1s).
- features/support/tls/ carries a deliberate loopback-only test cert (CN
  jolly-loopback-test; secures nothing real) — durable fixture, not a leak.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly`
copy or the `/setup` page). If it must bind QM, it becomes a `.feature` scenario, never a note.

## Resume-loop mechanics (proven; carry until upstream mechanizes it)

Captain hand-carries role resume across detached runs: role launches detached, ends turn;
Captain waits on the run, SendMessages the role on exit. Many lost signals across sessions;
the Captain-side `tail --pid` fallback waiter saved every one. ALWAYS arm it:
- `tail --pid=<EXACT NUMBER>` only, pid read from `ps` in the FOREGROUND first. NEVER pgrep
  in the waiter (self-matches; node comm is "MainThread" here).
- A nested role cannot be signalled through its parent — tell the parent the run exited and
  to collect/re-run itself. Subagent reports can route to MAIN when the child cannot reach
  its parent by name; Captain relays substance down the chain.
- Confirm a fired waiter's PID is gone (`ps -p`) before relaying: a cap-fire looks like an
  exit.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- Resume-on-signal machinery remains the TOP work item — the harness must resume a role on
  its detached run's exit, not discipline.
- Tier-taxonomy findings (dk 2026-07-18, keep): tiers are execution profiles; lanes are
  tags (@composition adopted). "Primary tier" collapses into licence tags + primaries-first
  order. Eval-gating couples to COMMITTED captures at harbour cadence. Element-spend licence
  gap: pin fixture SOURCE in Givens; @spends-<element> tags if it recurs. Golden-capture
  tiers are the cheap-composite pattern. TS perturb idiom: guard form preserves narrowing.
  Instrumented streams are a SEPARATE wake path by construction.
- Latency findings (dk 2026-07-18, keep): ~4/5 of batch wall was agent latency. Levers:
  concurrent focused groups (ADOPTED), parallel Crew mates (ADOPTED), resume-on-signal,
  event-driven narration (ADOPTED). Proposed, awaiting dk: support-edit selection
  refinement (join-selected recheck; tier sweep only for tier-global files; conformance
  family via its own command).
- Tier-lane overlap as a RIGGING `lanes` value (adopted here 2026-07-19): upstream
  candidate — the Watchbill policy's cheapest-first serial ordering should admit a
  rigging-declared concurrent-lanes override; the laned window doubles as the budget
  measurement, and the window (not the tier sum) is the budget-fit basis.
- Wait-composition audit as a harbour economy lens (adopted here 2026-07-19): decompose
  slow scenarios' walls from the message streams; Godot = success condition IS the timeout.
  Candidate standing lens beside the cost outliers.

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
  they will actually run in; instrumented runs never stand as operational priors. Contention
  from neighbour agents is the NORMAL operating condition per dk 2026-07-19.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin (role + base commit); hold Captain writes while a role
  holds the deck — spec edits NEVER land while a measured sweep is in flight.
- Conformance family (@logic @property/@invariant) must be green before custody, riding reds
  excepted only by an explicit dk ruling.
- A Captain spec edit rides a watchbill entry EVEN during blocker resolution; an edit to a
  scenario QM just made executable orphans the definition.
