> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## SPEED VOYAGE — custody HALTED on 2 conformance reds, fix leg running (2026-07-17 ~20:05)

Boatswain (a3bc1ed478dd4136c) refused to commit — foul deck, 2 `@logic` conformance reds, both
voyage-caused drift my leg-3 watchbill missed (no @logic watch, so QM never re-ran conformance
after the respec renamed a step). Comment-only fixes, no runtime behaviour change, so @sandbox
49/49+6/6 and @eval 4/4 greens HOLD; only @logic conformance needs re-greening. Fix-leg
watchbill: the two red conformance scenarios + @logic. Base stays `b727087`.
- **Red 2 (QM in place): DONE** — `cold-store-cloud-api.ts` marker compressed back within the
  6-line window; check green under the full @logic sweep (196: 195 pass, only red 1 left).
- **Red 1 (Crew): CAPTAIN OVERRULED QM's harbour deferral.** QM deferred the stale plank
  `src/index.ts:3271` to harbour ("seam not in src diff"). Overruled: the Planking agreement says
  harbour is "never where a fault THIS VOYAGE INTRODUCED is parked," and the respec's step rename
  (feature 002:45, IN the diff) is what staled it. Voyage-introduced → Crew now, not harbour.
  Fix: correct the plank at 3271 from the concrete-line copy ("the new store's …URL") to the
  CURRENT step-definition pattern (Crew reads step-usage for the exact pattern; a pattern, not a
  concrete-line copy, per the agreement). Crew dispatched directly (Captain blocker-resolution;
  QM abdicated to harbour and harbour can't run without blocking the close).
**RESOLVED — conformance 55/55 green, Boatswain re-dispatched.** Crew fixed the plank
(src/index.ts:3271, names current pattern now). Then the budget check surfaced a THIRD issue:
logic recorded 306.7s (contention) then 210.5s clean — the voyage's own +4 @invariant scenarios
grew logic from ~202 to 210.5s, past the 210 budget I'd set from the old count. Raised
budget-logic 210->250 (clean 210.5 + headroom). KEY LESSON for overlap voyage: a tier's wall
clock inflates hard under contention (logic 210.5 idle vs 306.7 contended) — serial-derived
budgets DO NOT transfer to concurrent operation; overlap voyage must re-derive under load, which
is why it instruments memory/pressure into the wake. @sandbox 49/49+6/6 and @eval 4/4 hold from
QM leg 3 (all changes since were comment/plank/budget only, no runtime behaviour). Next:
Boatswain commit -> push+publish (dk approved) -> overlap voyage. dk signed off; autonomous.

Closing leg (QM a9b7dc44afdfa6abe): watch1 respec GREEN; @sandbox 49/49 + 6/6 GREEN; @eval 4/4
GREEN; budget check GREEN after Captain corrected an under-set value (below).

HONEST MEASUREMENT (warm, this leg): logic ~195s, sandbox 824s, sandbox-serial 843s, eval 157s
= ~2019s (~34 min). Down from ~54 min pre-voyage (~37% cut). NOT the 1200 aspiration — that is
the overlap voyage. Budgets in RIGGING set to measurement + ~10% headroom (total 2250, sandbox
900). **Captain error corrected transparently**: I first set budget-sandbox=480 and total=1830,
both BELOW the measured sandbox parallel leg (~824s — it carries the one-time recipe-on-shared
provisioning). QM's budget check reddened on it; I raised the values to measurement per dk's
"budgets from measurement" ruling. No product effect; only the ceiling value was wrong.

Two real defects QM fixed this leg: (1) golden-capture corruption — a per-run deploy overwrote
the stable `jolly-cannon-fodder-shared-deploy` family; `eval-captures.ts` now rejects
per-run-tainted observations by CONTENT (argv+stdout), capture reverted to base and proven
byte-clean across serial+eval reruns. (2) capture not byte-stable across runs (earlier fold bug).

DK RULINGS (2026-07-17, before sign-off):
- Speed voyage OUTBOUND: **PUSH NOW** — after Boatswain, push `main` + npm publish (resume-aware
  `jolly start` + this voyage's product changes) + verify the published bundle. Homepage assets
  unchanged this voyage; verify current homepage still serves, no redeploy needed.
- Overlap voyage: **run AUTONOMOUSLY overnight**, Captain carrying the loop, reporting here.
- Overlap scope: **safe partial first, then tighten** — instrument memory into the wake, prove
  run-scoped isolation, overlap cheap tiers (logic+eval) alongside sandbox to land ~1400-1500s,
  then let wake data guide tightening toward 1200. Low OOM-churn risk over the aggressive path.

Report-only finding (self-cleared, for the overlap voyage): during a serial leg, `vercel login`
device-flow children orphaned to init and polled ~5-10 min before teardown reaped them — reap
the login child once its device URL is captured. Direct evidence for the resource-awareness work.

## Deck state (2026-07-17 eve): speed voyage COMMITTED at `b727087`, closing leg in flight

Custody clean at `b727087` (36 files, 1 ahead of origin — push pending dk at voyage close).
Measured warm: logic 195.5s, sandbox 810.1s, sandbox-serial 835.9s, eval 107s (was 9m36 —
captures won 5.4x; interactive completion 50s, was 5m26). Suite ~54m -> ~32.5m.

Closing leg (QM leg 3, dispatched after `b727087`): 002 fresh-store readiness RESPECCED per
dk ruling — `@exceptional-double` cold-start window over store-stage gating; real cold-start
proof lives at the shared provisioning seam (first build + self-heal); 026's admissible list
gained that ground. Budgets set from measurement per dk's respec ruling: total 1830, logic
210, sandbox 480, sandbox-serial 900, eval 240. dk's 1200 stands as ASPIRATION in the budget
prose, delivered by the overlap voyage, never by value edits. Watchbill: respec target,
@sandbox re-measure, @eval (closes Boatswain's labelled residual: eval-captures.ts last write
postdates the eval run), budget target last.

## NEXT VOYAGE: TIER OVERLAP (dk-ruled 2026-07-17, author after this closes, fresh context)

Goal: full regression <= 1200s by running tier legs CONCURRENTLY. Arithmetic: logic 195 ||
eval 107 || sandbox-light ~450 alongside serial ~840 -> ~15 min wall clock.

dk-ruled design constraints:
1. **Isolation first.** Invocation-global reclaim races a live sibling (QM-named: a sweep's
   reclaim deletes a live run's run-namespaced scratch state). Becomes run-scoped
   reclaim/isolation so concurrent invocations are safe by construction.
2. **Resource-aware via THE WAKE (dk: "we can/should use the wake for this").** OOM causes
   reruns, reruns are latency. Tier runs record memory pressure (peak RSS, OOM events) into
   the weather stream alongside wall clock; the concurrency prior READS the record and backs
   off on live pressure rather than crashing. An OOM is a red harness defect finding, never
   a silent rerun. No new artifact type — upstream weather law already names pressure
   signals; this voyage makes them executable on the 7.9 GB VM.
3. Budgets then tighten toward 1200 from the overlap measurement, dk to re-rule values.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a stronger or different eval model;
never touch `HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the
`assets/skills/jolly` copy or the `/setup` page). If this ever needs to bind QM, it becomes
a `.feature` scenario, never a note and never a memory.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- 0.13.29 installed to project skills; budget + licensed-spend law live and proven this voyage.
- Resume-on-signal machinery: this voyage hand-carried the loop ~15 times (waiter on exit +
  signal-only SendMessage worked cleanly every time — the pattern is proven; mechanize it).
- Blockers-first handoff upstream; retire stale AGENTS.md local addition at next harbour.
- Boatswain dead-code divergence stands; no urgency.

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`.

## Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap 2 environments; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the only safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for
  `@creates-env` guard deploys. One creation test per seam; different parameters, not
  different sequences.

## For next harbour (report-only, re-derivable)

- Stale `@heavy` prose: `AGENTS.md:119,123`; comments in 002/004/029 step files and
  `features/support/fast-forward-deploy.ts` (Boatswain refreshed recipe-on-shared.ts only).
- AGENTS.md eval prose (live Vercel deploy, KEEP_STORE) stale vs golden-capture design.
- 16 baseline zero-usage step definitions (two at `006-npx-cli-command-surface.steps.ts:502,521`).
- Still no derived check joining RIGGING `## Dependencies` to `package.json`.
- `report.html`/`report.json` tracked but are wake.
- Harbour re-verifies golden captures against live services (026's stated cadence) — standing
  duty from this voyage.
- Wake-wipe incident (unverified, QM leg 1): out-of-band coverage/ rewrite ~13:03-13:05
  destroyed morning ledger+shims; watch for recurrence.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. A check that enumerates a set is trusted only after you
  verify it enumerated the set.
- Never let anything follow a verification run in the same command; the summary line is the
  evidence, the exit code is hearsay.
- `pgrep -f` matches its own command line; kill by task ID (or exact ps-listed PID).
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; never poll a dispatched agent, resume it on the observed signal
  (waiter-on-exit + signal-only SendMessage, proven this voyage).
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin: role and base commit. Hold ALL Captain writes while
  Boatswain holds the deck.
