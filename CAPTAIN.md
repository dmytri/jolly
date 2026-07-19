> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## STATE (2026-07-19, night): ONE-SEAM/ONE-TEST RULING EXECUTED — watchbill live, QM dispatched.

dk's goal restated: reach ONE seam AND ONE test per expensive spend class, then get back
to PRODUCT work. Verification economy is means, not end. 43 of 257 scenarios (17%) are the
project auditing itself; dk is right to want that bounded.

Measurement window closed 19:23 (2225s wall / 2250 budget). Lane walls: logic 322.2s/375,
eval 178.9s, sandbox serial 1364.4s, sandbox parallel 862.9s (49/49 green). 284 scenario-runs.

LEDGER FINDING (the one that mattered): creation lives at ONE seam (single-creation-seam.feature,
ts-morph checker, green) but was tested at FOUR — ~6 real env creations per run across 4
@creates-env scenarios costing ~945s, four of the top six outliers. 028 creates NOTHING
(pure @logic name derivation); earlier claim it did was wrong.

dk RULING: strict one licensed scenario per spend class. EXECUTED as spec edits:
- verification-economy: licence Rule narrowed to "one means one"; NEW @logic @invariant
  "At most one scenario in the corpus holds the licence for an expensive spend class".
- 012 "Jolly creates a Saleor Cloud environment" = the SOLE @creates-env holder.
- 012 reuse + 004 destructive-diff: @creates-env DROPPED, both now assert against the run's
  shared environment. Watch the 012 reuse assertion: the old Given pinned "not yet begun
  serving", which proved reuse keys on the REGISTRY not on serving. Against a serving shared
  store that nuance is weaker. If QM cannot preserve it, it comes back to dk.
- 026 reclamation: @creates-env DROPPED, no longer seeds its own leftovers; asserts the
  reclamation report accounts for whatever stale leftovers stand. VACUITY RISK: a clean org
  means nothing to account for. If it passes vacuously, strengthen or retire it — the cheap
  @logic selection scenario at 026:35 already proves the name-vs-domain-label logic.

REMAINING REDS carried into this watchbill: malformed plank at src/index.ts:1694 (plank
string starts with no Given/When/Then — real drift from tonight's wait-shrink work); wake
reader selects no completed record (worker restore not landing). Budget-fit red is DEFERRED
BY DESIGN: sandbox recorded 1334.4s vs 900s, but that measurement is under broken worker
restore AND before the creation drop. Do not ratchet the value until a window with both
fixed — dk's own "re-ratchet from the next window, never a bare edit".

AFTER this voyage: custody, then BACK TO PRODUCT. Offer push. @bomb.sh/tab 0.0.19->0.0.20
bump rides custody as hygiene. npm publish PARKED (2FA).

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
  its detached run's exit, not discipline. THE GAP, stated whole, because the fix has to be
  designed against it: a verification run can outlast the runtime's foreground command
  budget (Jolly's laned sandbox window is ~37 minutes). Hand-off custody forbids a role
  ending its turn holding live work, so the role launches the run DETACHED and ends its turn
  honestly. Nothing then wakes that role when the run exits. The run finishes, its output
  sits on disk, and the voyage stalls on a completed run nobody read. Hand-off custody also
  forbids the obvious patch — a sleep loop re-checking the process is the busy-wait the
  agreement names, spending the turn to learn what the exit reports for free.
- THE WAITER is the stopgap Captain hand-carries in that gap, and it is scaffolding, not a
  Shipshape concept. `tail --pid=<PID> -f /dev/null` blocks until PID exits and outputs
  nothing: a pure block-until-dead. Captain runs it in the background, the runtime notifies
  on its completion, Captain confirms the PID is gone and SendMessages the role "your run
  exited, collect it". Every lost signal this session was recovered this way. Three edges,
  all of which have bitten:
  - EXACT PID read from `ps` in the FOREGROUND first. Never `pgrep` inside the waiter: it
    self-matches and fires instantly (node's comm is "MainThread" here, so name matching is
    worthless anyway).
  - ARM ON THE CHAIN ROOT (dk 2026-07-19, bit twice this session). A role that launches N
    targets from a generated shell script hands the relay a PROCESS TREE, not a process.
    Arming on the first cucumber PID in `ps` fires at the FIRST target's exit and relays a
    partial watch as if it were complete. Walk the ppid chain to the script
    (`bash /…/watchN.sh`) and wait on THAT.
  - CONFIRM THE PID IS GONE (`ps -p`) before relaying: a cap-fire looks exactly like an exit.
  The upstream fix retires all three: resume the role on its own run's exit and no Captain
  needs to know any of this. Until then it is discipline standing in for machinery, and
  discipline has already been observed to fail here.
- ONE SEAM IS NOT ONE TEST (dk 2026-07-19, the session's main finding; strong upstream
  candidate). A single-creation-seam invariant can be fully green while N scenarios each
  call that one seam for real. Jolly: creation lived at one seam, enforced by a ts-morph
  checker, and was tested at FOUR — ~6 real env creations per run, ~945s, four of the top
  six cost outliers, all structurally conformant. The seam invariant answers "does creation
  live in one place", never "is creation paid for once". Shipshape's Verification agreement
  should name both, because the cheap structural check reads as if it discharged the
  expensive one.
- LICENCE TAGS SHOULD DEFAULT TO CARDINALITY ONE. The agreement requires the licensed set be
  "declared and enumerable, never inferred from prose" — necessary and not sufficient: an
  enumerable set of four is still four full spends per run. Proposed default: at most one
  licensed scenario per spend class, a second reddens, and a genuine second declares itself.
  Jolly now pins this as a @logic @invariant grouping licensed scenarios by class.
- THE SPEND LEDGER OUTPERFORMED PER-SCENARIO DURATION as a harbour economy lens. Duration
  says which scenario is slow; the ledger says WHY by attributing each expensive spend to the
  running scenario, so the four scenarios to change fell out mechanically instead of by
  reading specs. Candidate standing lens beside the cost outliers and the wait-composition
  audit: join ledger to licence tags first, then read durations.
- BUDGETS ARE POST-HOC BY CONSTRUCTION, and the agreement should SAY so (dk 2026-07-19:
  "killing runs means more latency"). A budget reads the wall clock the weather record
  already carries and reddens after the fact; it never aborts a run. Nothing in Jolly kills
  on budget, but the agreement's "ceiling, not advice" phrasing invites a timeout-kill
  implementation that would spend the whole run's work to learn what the record reports free.
- METHODOLOGY-CORPUS RATIO AS A HARBOUR METRIC. Jolly: 43 of 257 scenarios (17%) audit the
  project's own method rather than the product — verification-economy 13, methodology-
  conformance 11, 026 live-by-design 9, single-creation-seam 5, 028 worker isolation 3,
  module-boundary 1, command-surface 1. Individually each is legitimate; nothing surfaces the
  aggregate, and every voyage spent on that 17% is a voyage not spent on the product. Cheap
  to derive from tags, and it makes methodology overhead a number dk can rule on.
- A NO-SEED SCENARIO NEEDS A NON-VACUITY GUARD. Dropping a licence usually means the scenario
  stops seeding its own precondition and asserts against ambient state instead — which passes
  silently when the ambient state is empty. Jolly's 026 reclamation is the live case. The
  reuse-and-share rule should carry the obligation: a scenario that no longer creates its
  precondition states what makes it non-vacuous, or it reddens when it observes nothing.
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
