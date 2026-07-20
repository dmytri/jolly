> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## NEXT SESSION — read this block first, then the STATE block below.

SHIPPED: @dk/jolly@0.13.0 published and VERIFIED (registry reports 0.13.0; `npx
@dk/jolly@0.13.0 --help` runs the published bundle from a clean dir, exit 0). Pushed to
origin/main as e0b007c, tagged v0.13.0. Deck clean, watchbill struck.

0.13.0 is a REAL user-visible change, unlike 0.12.5: Ctrl-C during the unattended stages now
exits honestly instead of killing mid-redraw. Minor bump earned on that basis.

TAG HYGIENE: v0.12.5 was NEVER TAGGED — last session's release skipped it while every other
release back to v0.9.x carries a tag. Left alone deliberately (dk's history to rewrite, not
mine). Also note `git push --follow-tags` does NOT push a lightweight tag; tag with `-a` or
push the tag explicitly, as this session had to.

NPM IS NOW FITTED. `~/.npmrc` carries a granular token WITH 2FA bypass, so plain `npm
publish` works with no env vars and no flags, exactly as RIGGING's `ship:` value declares.
dk was asked to rotate the two tokens pasted in that session; assume they may have.
An E403 naming "bypass 2fa" means the token lacks that capability, not that auth is
misconfigured — regenerate with bypass ticked, `npm config set` the one value, done.

## VOYAGE CLOSED (2026-07-20): CTRL-C COVERAGE. Committed 52959f7, ahead 1, NOT pushed.

dk chose PRODUCT over harbour, then narrowed to Ctrl-C only. dk also ruled mid-turn: KEEP
TESTS FAST FOLLOWING POLICY — that ruling is why both new scenarios are @logic, not @sandbox.

TWO NEW @logic SCENARIOS in 027, both green: "Interrupting the unattended stages leaves the
terminal usable" and "...reports the interrupted stage honestly". 6 files, +528/-32.

THE PTY HARNESS HAD NEVER DELIVERED A CTRL-C. Three pre-existing defects in pty-driver.py,
all surfaced only because we finally asserted something needing a real signal:
1. The driver spawned the child with NO CONTROLLING TERMINAL, so the slave fd was just an
   open file and the line discipline had no process group to signal — 0x03 delivered nothing.
   Fixed with os.setsid() + TIOCSCTTY on both spawn paths. NOTE: start_new_session=True alone
   does NOT do it; Python calls setsid() without TIOCSCTTY. Carry this fact.
2. finish() sampled poll() at PTY EOF, which arrives BEFORE the exiting child is reaped, so a
   CLI that did exit reported as parked. Now waits on the exit EOF announced.
3. QM's first pass had scenario 1 green on an UNINTERRUPTED run: the CLI ignored SIGINT,
   marched to its last stage, and a normal close satisfies "cursor restored, line below rows".
   The When now asserts the run never reached its final `stripe` stage, so a swallowed
   interrupt cannot read as coverage. Crew disproved QM's own signal-delivery claim with a
   three-case probe rather than accepting it — the reason all three defects surfaced.

@sandbox WAS SWEPT and is GREEN against the driver change — this question is CLOSED, do not
re-spend. Serial 3/3 598.65s/900, parallel 51/51 730.12s/900, both exit 0. The driver fix is
behaviourally real for every PTY spawn (TIOCSCTTY alters signal semantics, finish() alters
exit reporting), and 027/020/018 sandbox scenarios drive an interactive terminal, so a
@logic-only green would NOT have covered it. Logic sweep 229/229 308s/375.

THE NOTES' OLD PREMISE WAS REFUTED — do not restore it. The retired claim was "027 carries
26 @logic scenarios that assert what a render function returns; only 3 reach a real
sandbox." FALSE: 027's @logic scenarios drive a REAL kernel PTY via runUnderPty
(features/support/pty-driver.py), so isTTY is genuinely true and real escape sequences are
read back. "More sandbox coverage" was the WRONG LEVER — sandbox is where the 900s budget
lives, and the fix for a TUI gap is a logic-lane PTY run, not a cloud resource.

ALSO ALREADY COVERED, do not re-spend: TTY detection (020:55 "Human output is plain when
stdout is not a terminal", 007:49) and prompt sequencing (the eight Enter-at-every-prompt
scenarios, under that same real PTY). Of the five gaps the old note named, only signal
handling and terminal width were genuinely unspecified.

THE PRODUCTION FACTS BEHIND THIS VOYAGE (observed, not recalled): there is NO SIGINT handler
anywhere in src/. clackIsCancel covers cancel AT A PROMPT (6 call sites, src/index.ts
5163-5284), but the unattended stages are Jolly's own hand-rolled stageProgress display (the
sanctioned Bombshell carve-out, src/index.ts ~5030+), and Ctrl-C there is a raw default kill
mid cursor-up/erase-reprint. src/ contains zero references to terminal width.

STILL UNORDERED, dk's to rule:
- TERMINAL WIDTH. src/ has no width handling; the redraw counts rows to move the cursor back
  and the comment at src/index.ts:5084 ALREADY fears exactly this drift ("shift the cursor-up
  reference down a line and duplicate the first row"). A wrapped row IS that drift. Writable
  as @logic at 40 columns, but pty-driver.py:235 hardcodes 24x80 — making it settable is
  verification support, QM's to build, ordered by the scenario. dk deferred this, not declined.
- CTRL-C MID-STORE-CREATION leaking a real cloud resource. The genuinely harmful case: the
  human interrupts, a Saleor store exists, nobody is told. Needs real creation = @sandbox =
  the 900s budget, which is why it was NOT ordered under the keep-tests-fast ruling.

AGENT-MODE BREADTH IS DECLINED, not deferred. dk 2026-07-20: stick to ONE baseline model.
The @eval lane's 4 scenarios against the fixed deepseek/deepseek-v4-flash baseline are the
intended coverage. Do not propose testing other models. See the FIXED BASELINE fact below.

PUBLISHED-ARTIFACT SMOKE TEST: satisfied this session and worth repeating at each publish —
`npx @dk/jolly@<version> --help` from an empty dir. It is the cheap check that catches a
broken bundle, which a green local tree never will.

## HARBOUR CLOSED 2026-07-20. 12 targets ordered, watchbill live, nothing owed to Shipwright.

Full regression, co-launched laned window, ALL GREEN: window 1437s/2250, eval 183s/240 (4/4),
logic 381s/375 (229/229, BREACH), sandbox serial 657s/900 (3/3) + parallel 780s/900 (51/51).
287 scenarios all passed. This IS the re-ratchet basis; dk ruled HOLD BOTH BUDGETS until the
item-2 placement fix means the check actually enforces what is set. Do not edit a budget value.

DK'S FOUR HARBOUR RULINGS:
1. Budgets: hold both. Re-ratchet from the NEXT window, after placement is fixed.
2. Item 2 = POST-WINDOW GATE. The check's logic is correct; only its placement is wrong.
3. Plank dialect: MIGRATE to verbatim upstream form. Against my recommendation; dk's call.
4. All 10 skeletons promoted.

THE ITEM-2 PROOF, THE CLEANEST ARTEFACT THIS HARBOUR PRODUCED: the identical scenario, same
tree, same 378.0s figure, reported GREEN inside the laned window and RED when run solo after.
The only variable is whether the record it reads had finished being written. A check cannot
judge a window it runs inside: its own lane has no `testRunFinished` yet, so it excludes
itself. This is why the fix is relocation, not a rewrite. Every other reading of the evidence
was compatible with "the check has a bug"; this one is not.

PER-TIER BUDGETS ARE EQUALLY BLIND. The old note called them "the real guard" — REFUTED by the
same run. budget-logic has never been enforced by the run that produces it.

PLANK DIALECT, WHAT I FOUND EDITING IT: the spec ALREADY said "exact string match". The
Given/When/Then dialect lives in the CHECKER, which strips the keyword before comparing. Spec
and implementation have disagreed all along; the migration is therefore a 3-line spec edit that
reds against all 457 planks, and Crew does the mechanical migration. Cost is real: 457
annotations in src/, zero current defects, bought for upstream alignment + retiring the latent
hazard (strip is safe only while no pattern starts with a Gherkin keyword; 0 of 1145, asserted
by nothing until now).

THREE REAL DEFECTS HARBOUR FOUND, all now watchbill targets:
- PROCESS LEAK: `spawnVercelSignIn` (src/index.ts:4286) is detached+unref'd BY DESIGN, reached
  from the DEPLOY stage (:4635), not the interactive path. `loadPendingVercelUrl` reads a
  dotfile under projectDir() = a fresh temp dir per sandbox scenario, so the reuse guard NEVER
  finds the pending URL and a new grant spawns every time. Deploys then succeeded = sign-in was
  never needed. Ledger recorded neither logins nor probes (668 entries, zero matching), so the
  spend check was structurally blind. Every harness `kill` holds a direct child handle; a
  detached unref'd child has none by construction.
- LOGIC-TIER UNRECORDED SPEND: runStorefrontStage ran 12x in the DEFAULT tier; the ledger is
  written for sandbox alone. The tier paid on every inner-loop run records nothing.
  (`vercel whoami` in logic is BY DESIGN: probeVercelSession 48x, spawnVercelSignIn 0x. Dropped.)
- SIDE_EFFECTING written in THREE places; onInterrupt (src/index.ts:5342) applies NO
  side-effecting filter, so a Ctrl-C close names preflight stages the normal close excludes.

ITEM 7 SETTLED, and neither expected answer: src/index.ts:5335 executes 19 times, the
setRawMode(false) call has BRANCH COUNT 0. Never fired, ever, including both PTY Ctrl-C
scenarios driving real clack prompts. Clack restores cooked mode itself. So the line is
unverified in BOTH directions. NOT deleted — reachable-but-unexecuted is unspecified
behaviour, so it got a scenario pinning the STATE the stages need, not the call.

PLANKING CLEAN: 457 planks, 0 stale, 0 unmatched, 0 provisional. Nothing owed.

COVERAGE TRIAGE IS PARTIAL AND SAYS SO: logic tier only, 80.98% stmt / 82.6% branch. Sandbox
instrumented was skipped deliberately (would double a 24-min leg). No module at 0%, so no
coverage skeletons owed. Weakest branch: start-close 60%, device-grant 63%, cloud-api 66% —
understated, since sandbox/eval exercise those paths uninstrumented.

RULE PROSE: dk's agenda item 1. Shipwright's skeletons ADDED ~55 lines of it; I trimmed the
harbour-measurement narration ("Harbour measured X 19 times") out at promotion and kept only
durable rebuild context. The 13 unenforced-and-matters Rule claims are UNRESOLVED — worst: no
scenario asserts a COMPLETED `jolly start` reports success. Next harbour, or order it.

STILL OPEN, dk's to rule:
- DEPENDENCY UPGRADES, unordered: @bomb.sh/tab 0.0.19 -> 0.0.21 (moved past the 0.0.20 in the
  old note) and @cucumber/cucumber 13.1.1 -> 13.2.0 (already inside the declared ^13.1.1 range).
  RIGGING's latest-stable policy calls a held version a defect; both are recorded at their
  sites WITHOUT upgrading, since selection is Captain's. No failing target orders them.
- THREE UNREACHABLE EXPORTS: DEVICE_CLIENT_ID, platformAuthScheme, STRIPE_APP_NAME. Functions
  reachable, exports not. platformAuthScheme carries a feature-018 product rule and a plank,
  but the plank points at a full CLI-spawn scenario, so the Bearer/Token decision is never
  verified through the seam already shaped to expose it. Narrow vs adopt-as-seam = design call.
- SIDE_EFFECTING three-place literal: scenario ordered (watch4), but whether to consolidate to
  one exported constant or one derived surface is Crew's smallest-change call.

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
