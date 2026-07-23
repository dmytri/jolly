> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

---

# DECK STATE

**HEAD = `dec62ee`. Tree CLEAN. IN SYNC with origin/main (pushed `77e7bdf..dec62ee`).
`@dk/jolly` 0.13.1 stands — NO republish: this voyage changed only `@planks` docblock comments in
`src`, so the bundle behaviour is byte-identical. Homepage untouched. NO outbound pending.**

## Last voyage: the harbour follow-up — COMPLETE (dk ruled + shipped 2026-07-23 this session)

The 3 deferred `@captain` skeletons + the check-gap ruling were resolved, committed (`dec62ee`), and
pushed. All 4 QM targets fresh green (020, 012, methodology @logic; 004 @sandbox 3m13s); 6 provisional
planks liquidated to real `@planks`.

- **020** colour/glyph → PROMOTED `@logic`.
- **004** stock/collection concurrency → PROMOTED `@sandbox`. FLIPPED from an initial discard once the
  seam's dedicated `Rule:` block (lines 122-136), bounded-concurrency rate-limit mechanism
  (`RECIPE_REQUEST_CONCURRENCY`), and two live call sites (`cloud-api.ts:1033`, `:1298`) surfaced —
  condemning would have ripped out real behaviour and orphaned the Rule. Lesson reinforced: read the
  seam AND its Rule before framing a discard.
- **012** blank-env → PROMOTED lean `@logic`: dry-run `database_population: null` on the
  `environmentCreationBody` seam. Dropped the skeleton's "created store holds no sample data" half as
  third-party (Saleor honouring the request, not Jolly's seam). No `@creates-env` spend added.
- **Findings ruled report-only, CLOSED — do not re-raise:** `NPM_CONFIG_LOGLEVEL` suppression
  (cosmetic, inline in `main()`, not worth a seam extraction); `agentResumePollSeconds` (override is a
  HARNESS_ knob, NOT a JOLLY_* affordance; the resume contract is already covered in 002/018/025/027).
- **Dead-artifact check STRENGTHENED (dk ruled "catch locals"):** `methodology-conformance`'s "No dead
  verification-support artifact accumulates" now flags unreachable non-exported support symbols, not
  just unreferenced exports (`findUnreachableSupportSymbols`, in-file AST reachability). First run
  caught **20 dead symbols + a fully-dead file (`architecture-conformance.ts`)**; QM removed all,
  typecheck clean. Un-export is no longer an accepted evasion.

## OUTSTANDING for the next cycle

- **The verification-economy wake-precondition reds (2-3, KNOWN fragility, NOT a regression).** The
  `@invariant` scenarios at `verification-economy.feature:714` (wall-clock-record) and `:866` (eval
  spend-ledger / eval-capture) red in any isolated run because **no `@eval` tier ran this session**, so
  its `coverage/weather/eval*.ndjson` ledgers are absent. QM AND Boatswain independently diagnosed it
  as environmental; it references none of the voyage's edits. **A full regression clears it by running
  @eval.** Same order-dependence fragility recorded under "Two harness fragilities" below. If a whole
  sweep before the next ship is wanted, route through harbour (pairs the run with coverage triage + the
  economy audit), never a bare rerun.

---

# Two harness fragilities — carry as fragilities, not defects

- **The spend-ledger / wake-record checks are order-dependent.** `@logic` first under cheapest-first
  `order` reads the PREVIOUS run's `@sandbox`/`@eval` ledger; on a fresh/cold box, or a session where a
  dependent tier never ran, they red. This is the OUTSTANDING item above, recurring by design.
- **`027:Interrupting the unattended stages reports honestly` is load-sensitive.** Failed ONCE under
  full-regression load, passed since. "Did not reproduce" is NOT "fixed" — engineer out if it
  resurfaces, never re-run past.

---

# dk's 12 kept-against-audit scenarios (the muster dissents) — do NOT re-cut without a new ruling

030 x2 (foreign agents share this box, age gate stops deleting a live sibling's env),
verification-economy eval-captures-still-serve (dead store presents as agent-timeout, cost a day),
OOM-reds-check (today's OOMs were single-worker), reclaim-on-import (destructive on shared box),
ambient-setup-once (the rule the 15 TS-project OOM broke), 020 doctor-non-first-party (second
injection point, .env not --url), 020 every-request-site (the exhaustiveness check), 012
one-creation-seam-preview-trust, 002 concurrent-storefront-prepare (last product concurrency), 025
spend-ledger (localised the eval cost), methodology plank-names-current (found 8 stale annotations).

---

# THE ONE FACT NO MECHANISM CARRIES

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a different eval model; never touch `HARNESS_EVAL_MODEL`.
On any `@eval` red, fix Jolly's affordance (`assets/skills/jolly` or the `/setup` page). If it must
bind QM, it becomes a `.feature` scenario, never a note. AGENT-MODE BREADTH IS DECLINED, not deferred
(dk 2026-07-20): ONE baseline model, full stop.

**Eval saga root cause (guarded):** the eval red was never affordance — the recorded shared store was
DEAD; golden captures served a 404 domain; `jolly start` correctly polled for readiness; the agent
budget drained; harness reported a timeout. Polling writes no ledger, so cheaper diagnostics missed
it. Guarded by VE "Every endpoint the eval captures record still serves". **Eval diagnostics gap:**
`pi -p` buffers and prints only the final answer, so a timeout kill leaves `agent.stdout.txt` empty —
to see turns, snapshot `/tmp/jolly-cannon-fodder-run-*/session/*.jsonl` DURING the run. The persisted
`.env` token exposure is RULED CLOSED (dk 2026-07-22: cannon-fodder org, no rotation owed) — DO NOT
RAISE AGAIN. `HARNESS_OPENROUTER_API_KEY` is a real paid credential and stays scrubbed.

---

# Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap **2 environments**; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the ONLY safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for `@creates-env`
  guard deploys (004). One creation test per seam. Fixture SOURCE pinned in Givens.
- Golden captures record against the PERSISTENT shared store + shared deployment (live URLs); reject
  per-run-tainted observations by CONTENT. Harbour re-verifies captures vs live services.
- Reclamation is age-gated (feature 030): stale = older than the full-regression budget; a younger
  namespaced resource is a live sibling's. Shared store exempt by name.
- Terminal width KEPT (dk reversed a drop 2026-07-21). In-place multi-stage redraw KEPT — the
  hand-rolled display is the sole live exception to the no-redundant-implementation invariant. Do not
  reopen either without a new ruling.
- **004 concurrency KEPT and now PINNED** (`@sandbox`, this voyage): bounded stock/collection
  concurrency respecting Saleor rate limits. Do not condemn without a new ruling.

---

# Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. Trust a set-enumerating check only after verifying it enumerated —
  a check CAN report green while resolving nothing.
- Never let anything follow a verification run in the same command; the summary line is evidence, the
  exit code is hearsay. (Observed: a failing eval run exited 0.)
- Kill by exact ps-listed PID, never `pgrep -f`. This box also runs FOREIGN agents
  (`shipshape-shakedown`); filter them out of `ps` first.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box. ALL tiers serial; no worker count configured.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- dk wants QUESTIONS AS QUESTIONS: crisp, structured, one decision each.
- A tier's wall clock inflates hard under contention; neighbour-agent contention is the NORMAL
  operating condition. Instrumented runs never stand as operational priors.
- One writer at a time; dispatch thin (role + base commit). A Captain spec edit rides a watchbill entry.
- DISPATCH QM/Boatswain AS SUBAGENTS (`shipshape:qm`, `shipshape:boatswain`), never `/shipshape:qm` in
  the main loop: a slash-invoked role carries no `agent_type`, so the custody hook exits 0 and EVERY
  guard is off.
- A promotion voyage: Captain removes `@captain`, QM authors steps + liquidates `@planks-provisional`
  → real `@planks` via plank-only Crew dispatch. No Shipwright needed when there are no condemnations.
  A support-code edit's blast radius is the WHOLE tier it serves — QM runs the tier's enumeration
  sweep, not just the focused targets.

---

# LESSONS — Captain errors, do not repeat

1. **READ THE TRANSCRIPT BEFORE DIAGNOSING AN EVAL RED.** Diagnosed twice from a one-line command
   list; shipped a wrong `setup.md` edit. Measure the gap; do not theorise it.
2. **DO NOT WRITE WHILE A ROLE HOLDS THE DECK.** A mid-run feature/watchbill/notes edit moves the deck
   hash and voids carried greens. Notes commit AFTER the role returns.
3. **VERIFY A ROLE'S LOAD-BEARING CLAIM BEFORE RULING ON IT.** (This voyage: verified the 004 seam had
   a Rule + live call sites before acting on "discard", and confirmed the src diff was comment-only
   before ruling "no republish".)
4. **DO NOT WRITE A WATCHBILL ENTRY FROM MEMORY.** Grep the actual scenario name.
5. `eval-captures.json` per-run identity is LOAD-BEARING (the eval asserts surfaced == recorded). Do
   NOT revert it as "taint".

---

# Resume-loop mechanics

The runtime's tracked-background mechanism (`run_in_background` / subagent completion notification)
re-invokes on process exit and is the correct route — a real signal, not a poll. Use it for any run
outlasting a foreground budget. Fallback waiter where absent: `tail --pid=<EXACT NUMBER> -f /dev/null`,
PID read from `ps` in the FOREGROUND first, NEVER `pgrep` (self-matches; node's comm is "MainThread").
ARM ON THE CHAIN ROOT (walk ppid to the script/wrapper), not the first cucumber PID. CONFIRM the PID
is gone (`ps -p`) before relaying.

---

# Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`. npm publish needs `~/.npmrc` with a granular token WITH 2FA bypass; plain
   `npm publish` then works. An E403 naming "bypass 2fa" means the token lacks that capability.

---

# Upstream findings (~/shipshape, dk: edit directly, no ceremony)

- **RESUME-ON-SIGNAL** should be named in the agreement as the sanctioned route for a run outlasting a
  foreground budget; the skill text describes no such affordance, so roles hand-carry a waiter.
- **A ROLE RUN IN THE MAIN LOOP HAS NO CUSTODY AT ALL.** `bash-custody.sh` reads role identity from
  `agent_type` and exits 0 when absent. A `/shipshape:qm` slash invocation carries none.
- **GIT DIFF IS AN UNGUARDED READER OF THE NOTES.** Result-set custody enumerates search tools only;
  `git diff`/`git show`/`git log -p` dump CAPTAIN.md while naming nothing. Fix is a guarded form.
- **DEPENDENCIES BELONG TO FITTING OUT, NOT CREW** (dk 2026-07-20) — now upstream doctrine; confirm it
  landed.
- **A STRUCTURAL CHECKER DISCHARGING N SCENARIOS IS N-1 TOO MANY** / **DUPLICATE CHECKS SURVIVE BECAUSE
  NOTHING JOINS FEATURES** / **A METHOD CORPUS GUARDS ITS OWN MACHINERY** — three faces of methodology
  overhead being self-amplifying; worth an Article.
- **THE DEAD-ARTIFACT CHECK NOW CATCHES UNREACHABLE LOCALS, NOT JUST EXPORTS** (dk 2026-07-23). Every
  method mechanism should ask whether its "unreferenced" test is really a reachability test — an
  export-only check let 20 dead symbols + a whole file accumulate behind mere un-export. Worth
  generalising: dead-code conformance is reachability from live entry points, on every stack.
- **A NO-SEED SCENARIO NEEDS A NON-VACUITY GUARD**: dropping a licence usually means the scenario stops
  seeding its precondition and asserts against ambient state, passing silently when empty.
