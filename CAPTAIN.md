> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

---

# DECK STATE

**HEAD = `2e73338`. NOTHING IS COMMITTED.** Everything on the deck is role-advanced work in
flight from the current voyage. It is not lost work; it is a voyage's output awaiting custody.

- `src/index.ts` — Crew's ONE production change: `runStartCore` derived the start envelope's
  `status` from `bootstrapFailed`/`allStagesDone` only, never from the `initEnv`/`doctor` checks it
  folds in, so `jolly start` could report `success` while carrying a `fail` check. Now derives from
  the carried checks. A real honesty defect against Jolly's core promise. Still in the
  inlined-ternary shape an old checker forced; correct and green, readability item for harbour.
- `features/support/eval-spend-ledger.ts`, `features/support/envelope-honesty-conformance.ts` (new)
- `features/support/eval.ts` — capture guard: an uncovered expensive command now FAILS LOUDLY
  naming what is missing, instead of falling through to the real network.
- `features/support/storefront-fixture.ts` — the self-heal fixture fix, verified @sandbox 56/56.
- `features/support/captures/eval-captures.json` — re-recorded, legitimate verification output from
  the licensed run. Do NOT revert it (see LESSONS 6).
- `assets/homepage/setup.md` — dk-ruled --dry-run removal. ALREADY DEPLOYED; live == source,
  verified by curl. Do not deploy again to "sync".
- Spec edits per the simplification below; `RIGGING.md`; `watchbill.json` (untracked).

**Stale unstaged residue from a STOPPED QM**: `features/support/pressure.ts` and
`features/step_definitions/028-sandbox-worker-isolation.steps.ts` were modified and never reported
green. The simplification deletes the pressure derivation outright, so `pressure.ts` is now QM's to
remove. Do not let either ride a custody commit unexamined.

---

# THE SIMPLIFICATION VOYAGE — dk ruled 2026-07-22, EXECUTED

dk ruled the full 54-scenario non-product review and took **all 16 removals**. Method corpus
**54/275 (20%) -> 38/259 (14.7%)**. gplint clean.

Cut (9): VE worker-backoff, VE incomplete-window, VE wake-read-run-scoped, VE dependency-join
(duplicate of methodology-conformance's), VE sandbox-no-ledger (sub-case), command-surface
help-vs-unknown (subsumed), the two methodology custody-hook outlines (they test SHIPSHAPE'S hook,
not Jolly), 026 reclamation-by-domain-label @logic (duplicate lane of the @sandbox one).

Merged (7 -> 3): single-creation-seam x5 + module-boundary x1 -> 2 facets (import-boundary,
call-pattern) since one ts-morph checker discharged all six; VE wall-clock + VE pressure -> one
wake-record scenario; VE waits + VE reads -> one observed-signal scenario; VE sandbox-ledger-join +
VE any-tier-ledger -> one join.

**The declared-ceiling blocker is resolved by deletion.** With no pressure-derived backoff there is
no ceiling-vs-backoff distinction to spec: `workers-sandbox: 1` and `workers-logic: 2` are now plain
declared worker counts read as configured. `cucumber.js` must read them, not derive them.

**`lanes` is retired** (adopted 2026-07-19, retired 2026-07-22) and replaced by `order`: one tier at
a time, cheapest first. The window `budget: 2250` went with it; per-tier budgets stay as plain
numbers. Concurrent lanes OOM-killed a sweep and took two sibling lanes down on this 7.9 GB box.
Sequential sums to ~41 min against a laned 37.5 min that was never once achieved. Feature 030
run-scoped isolation STAYS — load-bearing for @logic's 2 workers and for foreign agents on this box.

Kept and worth naming: VE out-of-memory-kill-reds (the OOM was real, twice, dmesg-confirmed) and VE
eval-captures-still-serve (the guard that ends the eval saga below).

---

# THE ONE FACT NO MECHANISM CARRIES

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a different eval model; never touch `HARNESS_EVAL_MODEL`.
On any `@eval` red, fix Jolly's affordance (`assets/skills/jolly` or the `/setup` page). If it must
bind QM, it becomes a `.feature` scenario, never a note.
AGENT-MODE BREADTH IS DECLINED, not deferred (dk 2026-07-20): ONE baseline model, full stop.

---

# THE EVAL SAGA — root-caused, now guarded

The eval red was NEVER an affordance problem. **The recorded shared store was DEAD.** Golden captures
bound to a store returning 404; the capture served Jolly a dead domain; `jolly start` CORRECTLY
polled it for readiness; the agent's 600s budget drained; the harness reported "the baseline agent
timed out". **Polling writes no ledger entry**, which is why every cheaper diagnostic missed it.
Re-recorded via the licensed @pipeline run; eval now green 19/19 in ~43s where it used to time out
at 10m 6s. Guarded by VE "Every endpoint the eval captures record still serves".

Also fixed en route: the eval capture layer's npx shim intercepted only `@dk/jolly` and `vercel`, so
`npx skills add` x8 and a real store-mutating `@saleor/configurator` deploy ran LIVE every eval run.
Feature 025 already specified the configurator deploy as capture-served, so that was an
implementation defect against existing spec.

**Eval diagnostics gap, unfixed:** `HARNESS_EVAL_TRANSCRIPT_DIR` cannot diagnose a timeout, the
eval's only failure mode. `pi -p` BUFFERS and prints only the final answer, so a timeout kill leaves
`agent.stdout.txt` EMPTY by construction. To see the turns: snapshot
`/tmp/jolly-cannon-fodder-run-*/session/*.jsonl` out of the run root DURING the run.
**Also: the persisted `.env` is UNSCRUBBED except for `HARNESS_OPENROUTER_API_KEY`** — it writes live
`JOLLY_SALEOR_CLOUD_TOKEN` and `SALEOR_TOKEN` in plaintext. Captain printed it into a session
transcript on 2026-07-21; dk was told to consider that token disclosed. **Still owed: rotation.**

---

# HARBOUR ITEM: the 12 PTY scenarios are half the logic tier (dk ruled 2026-07-22)

Measured in the first sequential sweep, so you need not re-derive it. @logic: 220 scenarios,
median **0.70s**, mean **5.30s** — mean is 7.6x median, the exact shape verification-economy's own
Rule predicts. Parallelism is already 1.98x at 2 workers, so **no worker change touches this.**

Twelve PTY/interactive scenarios = **569s of 1165.6s scenario time (49%)**:

| s | scenario |
|---|---|
| 79.3 | A failed setup stage closes honestly, naming the stage |
| 67.6 | Progress is shown in place on stderr, never on the result stream |
| 50.8 | Jolly start pauses for agent approval at the first high-risk stage |
| 48.7 | Interactive start signs the human in to Saleor inline |
| 47.3 | A stage description too wide for the terminal is shortened |
| 46.0 | The running stage's description comes from the message catalog |
| 44.8 | The setup-stage progress redraws in place on a narrow terminal |
| 44.6 | Setup-stage progress shows each stage as its own live status |
| 40.8 | Jolly start does not fabricate Stripe stage completion |
| 33.7 | Interrupting the unattended stages reports honestly |
| 33.5 | Ctrl-C reaches the unattended stages as a signal |
| 31.5 | jolly start composes the stage seams in order |

These PASS the merged observed-signal check, so they are not burning guessed delays; the cost is
real terminal work through `runUnderPty`. dk ruled `budget-logic` ratchets 375 -> 650 now and
**re-ratchets DOWN** once this lands. Attack the 569s, not the ceiling.

---

# Open, dk's to rule

- Whether force-reclaim can take the SHARED STORE despite its exemption. If it can, the eval
  captures go stale on a cadence.
- Outbound: npm publish (0.13.0 shipped; this voyage is unshipped) and whether the homepage needs
  anything further. dk has approved nothing yet.

---

# LESSONS — Captain errors, do not repeat

1. **READ THE TRANSCRIPT BEFORE DIAGNOSING AN EVAL RED.** Captain diagnosed it TWICE from a one-line
   traced-command list and shipped a `setup.md` copy edit on the second wrong diagnosis. Reverted.
2. **THREE Captain theories died in one session**: the dry-run latch, reference-block shopping, and
   `pnpm install` being the cost. #3 died hardest — closing the capture hole removed EVERY live spend
   and moved the timeout by FOUR SECONDS. **Measure the gap; do not theorise it.**
3. **DO NOT WRITE WHILE A ROLE HOLDS THE DECK.** Captain edited a feature file and the watchbill
   mid-run, moving the deck hash and voiding carried greens.
4. **VERIFY A ROLE'S LOAD-BEARING CLAIM BEFORE RULING ON IT.** QM reported a skill ref as
   agent-chosen and needing a product ruling; it was Jolly's own DEFAULT_SKILLS entry.
5. **DO NOT WRITE A WATCHBILL ENTRY FROM MEMORY.** Captain invented a scenario name; the tree had a
   different one. Always grep the actual name.
6. `eval-captures.json` per-run identity is LOAD-BEARING (the eval asserts surfaced == recorded). Do
   NOT revert it as "taint" — an earlier Captain did, voided QM's greens, forced a ~40min rerun.

---

# Resume-loop mechanics

The runtime's tracked-background mechanism (`run_in_background`) re-invokes Captain on process exit
and is the correct route: it is a real signal, not a poll. Use it for any run that outlasts a
foreground budget. The hand-carried waiter below is the fallback where that mechanism is absent:
- `tail --pid=<EXACT NUMBER> -f /dev/null` only. PID read from `ps` in the FOREGROUND first.
  NEVER `pgrep` in the waiter (self-matches; node's comm is "MainThread" here).
- **ARM ON THE CHAIN ROOT**, not the first cucumber PID. Walk the ppid chain to the script or its
  detached wrapper. Arming on a leaf fires at the first target's exit and relays a partial watch as
  complete. Bit twice historically.
- **CONFIRM THE PID IS GONE** (`ps -p`) before relaying: a cap-fire looks exactly like an exit.
- This box also runs FOREIGN agents (`shipshape-shakedown`). Filter them out of `ps` first.

---

# Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap **2 environments**; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the ONLY safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for
  `@creates-env` guard deploys (004). One creation test per seam. Fixture SOURCE pinned in Givens.
- Golden captures record against the PERSISTENT shared store + shared deployment (live URLs); reject
  per-run-tainted observations by CONTENT. Harbour re-verifies captures vs live services.
- Reclamation is age-gated (feature 030): stale = older than the full-regression budget; a younger
  namespaced resource is a live sibling's. Shared store exempt by name.
- SUPERSEDED RULINGS, settled: terminal width KEPT (dk reversed a drop on 2026-07-21). "Super basic
  TUI" RAISED AND CLOSED 2026-07-20: keep in-place multi-stage redraw, change nothing. The
  hand-rolled display remains the sole live exception to the no-redundant-implementation invariant.
  Do not reopen either without a new ruling.

---

# Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. Trust a set-enumerating check only after verifying it enumerated
  — a check CAN report green while resolving nothing (QM's envelope checker did exactly that:
  shorthand property nodes carry the property's symbol, not the value's).
- Never let anything follow a verification run in the same command; the summary line is evidence,
  the exit code is hearsay. (Observed: a failing eval run exited 0.)
- Kill by exact ps-listed PID, never `pgrep -f`.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- dk wants QUESTIONS AS QUESTIONS: crisp, structured, one decision each.
- A tier's wall clock inflates hard under contention; contention from neighbour agents is the NORMAL
  operating condition. Instrumented runs never stand as operational priors.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin (role + base commit).
- A Captain spec edit rides a watchbill entry EVEN during blocker resolution.
- DISPATCH QM AS A SUBAGENT (`shipshape:qm`), never `/shipshape:qm` in the main loop: a slash-invoked
  role carries no `agent_type`, so the custody hook exits 0 and EVERY guard is off.
- A verification checker can PRESSURE Crew into contorting correct code to satisfy a text scan.

---

# Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`. npm publish needs `~/.npmrc` with a granular token WITH 2FA bypass; plain
   `npm publish` then works with no env vars. An E403 naming "bypass 2fa" means the token lacks that
   capability — regenerate with bypass ticked.

---

# Upstream findings (~/shipshape, dk: edit directly, no ceremony)

- **RESUME-ON-SIGNAL.** A verification run can outlast the runtime's foreground budget. Hand-off
  custody forbids a role ending its turn holding live work AND forbids the sleep-loop patch. Claude
  Code's tracked-background mechanism DOES solve this and should be named in the agreement as the
  sanctioned route; the gap is that the skill text describes no such affordance, so roles hand-carry
  a waiter instead.
- **A ROLE RUN IN THE MAIN LOOP HAS NO CUSTODY AT ALL.** `hooks/scripts/bash-custody.sh` reads role
  identity from `agent_type` and exits 0 when absent. A `/shipshape:qm` slash invocation carries
  none, so notes guard, write custody, and commit custody are ALL off. The hook is correct; it never
  runs. A rule enforced on one invocation route and not the other is worse than one enforced on
  neither.
- **GIT DIFF IS AN UNGUARDED READER OF THE NOTES.** Result-set custody enumerates search tools only
  (grep/rg/ag/ack). `git diff` reads no ignore artifact and on a dirty tree dumps CAPTAIN.md while
  NAMING nothing, so the mention-based notecheck cannot see it. Same for `git show`, `git log -p`,
  `git stash show -p`. Fix is a guarded form, not a denial.
- **DEPENDENCIES BELONG TO FITTING OUT, NOT CREW** (dk 2026-07-20). Now upstream doctrine; confirm it
  landed.
- **ONE SEAM IS NOT ONE TEST** (dk 2026-07-19). A single-creation-seam invariant can be fully green
  while N scenarios each call that seam for real. The cheap structural check reads as if it
  discharged the expensive one.
- **A STRUCTURAL CHECKER DISCHARGING N SCENARIOS IS N-1 SCENARIOS TOO MANY** (2026-07-22). Six
  scenarios in two features all resolved to one ts-morph checker restating one rule per resource.
  The Scantling agreement names the outline form of this smell but not the across-features form,
  where it is harder to see and grows a scenario per resource forever.
- **DUPLICATE CHECKS SURVIVE BECAUSE NOTHING JOINS FEATURES** (2026-07-22). The dependency-record
  join was implemented TWICE, in two features, with two step definitions. Both green, forever. A
  harbour check for semantically duplicate conformance scenarios would have caught it.
- **A METHOD CORPUS GUARDS ITS OWN MACHINERY** (2026-07-22). 6 of this voyage's 16 removals existed
  only to guard the concurrency subsystem being removed. Methodology overhead is self-amplifying:
  every mechanism added to the method corpus arrives with its own guards. Worth an Article.
- **LICENCE TAGS SHOULD DEFAULT TO CARDINALITY ONE**: an enumerable licensed set of four is still
  four full spends per run.
- **THE SPEND LEDGER OUTPERFORMED PER-SCENARIO DURATION** as an economy lens: duration says which
  scenario is slow, the ledger says WHY by attributing each spend.
- **BUDGETS ARE POST-HOC BY CONSTRUCTION** and the agreement should say so; "ceiling, not advice"
  invites a timeout-kill implementation that spends the whole run to learn what the record reports
  free.
- **METHODOLOGY-CORPUS RATIO AS A HARBOUR METRIC**: cheap to derive from tags, and it makes
  methodology overhead a number dk can rule on. First test complete: 20% -> 14.7% in one voyage.
- **A NO-SEED SCENARIO NEEDS A NON-VACUITY GUARD**: dropping a licence usually means the scenario
  stops seeding its precondition and asserts against ambient state, passing silently when empty.
