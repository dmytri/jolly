> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

---

# DECK STATE

**HEAD = `3aa5239`. Tree CLEAN. IN SYNC with origin/main (pushed).
`@dk/jolly` **0.13.1** is the published version. `3aa5239` carries a real production fix
(`runStartCore` remediation) that is pushed to main but **UNPUBLISHED** — dk ruled push-only, batch the
0.13.2 publish with future product work. Homepage untouched. NO outbound pending.**

Commits this batch, all pushed: `dec62ee` (harbour follow-up), `ed947e7` (harbour: budget refit +
capture refresh), `3aa5239` (economy simplification). Notes at `2d1ed2e` were the prior state.

## Last work: the economy-simplification voyage (this session, closed 07-24)

Began as an "economy-check rework" and, after dk's cruft review, became a net simplification:
**verification-economy went from 7 checks to 5, −391 lines** (110 added, 501 removed). Custody `3aa5239`,
`@logic` sweep 107/107 green (399.8s < 500 budget).

- **REMOVED (dk cruft rulings):**
  - **The OOM-reds check + all its machinery.** dk ruled 07-24: *"an OOM is a VM failure, don't try to
    handle it, let it fail."* If the box OOMs, the run dies on its own; no scenario scans dmesg/pressure
    records for OOM kills anymore. **This SUPERSEDES the old "keep the OOM-reds check" kept-against-audit
    note — do not re-add the check.** The sandbox `@pipeline` genuinely DOES OOM this 7.9GB box under
    contention (our own vercel/pnpm build, dmesg-confirmed pid 3471926 at 20GB vm); dk ruled we do NOT
    memory-fix it — let it fail and retry when less contended (the 07-24 re-record succeeded clean on a
    quiet box, 13m24s, 3/3).
  - **The wall-clock/tier-budget check ENTIRELY**, including the rolling-baseline history mechanism this
    same session had briefly built (a `coverage/weather/history/` append + median + tolerance). dk ruled
    it overreach: a wall-clock ceiling on a real-cloud tier fights intrinsic variance, and Shipwright's
    harbour duration audit already reviews slowdowns with judgment. **The RIGGING `budget`/`budget-*`
    values are now VESTIGIAL — no check reads them.** Harbour cleanup candidate for Shipwright.
- **KEPT (5 checks), all now COMPLETION-GATED for a cold wake** (judge only tiers that recorded a
  completed run; an empty/cold wake passes, never false-reds): ambient-setup-once, spend-ledger (the
  load-bearing licence check), read-ceiling, eval-endpoints (the eval-saga guard), eval-captures.
- **pressure.ts:** OOM/pressure-event parts removed; `deriveWorkerCount`/`CONFIGURED_PARALLELISM`
  worker-count derivation KEPT (live, used by cucumber.js + wake-run-scope.ts). Do not touch.
- **002 store-readiness stand-in:** the "store never reachable" negative path now resolves a
  namespaced-unreachable `*.saleor.cloud` stand-in (`@exceptional-double`) instead of provisioning a full
  real store (~57s saved; the shared-store BeforeAll setup dominates the tier, so the saving is modest).
- **Real production fix (ships in 0.13.2 when published):** `runStartCore`'s resolved-endpoint block
  path now emits the honest "store may still be starting up, re-run `jolly start`" remediation instead of
  missing it. Surfaced by the stand-in rewrite. Crew fixed it, two verbatim `@planks`.

## OUTSTANDING for the next cycle

- **0.13.2 is unpublished** (dk push-only). A future publish ships the `runStartCore` remediation fix.
- **Vestigial RIGGING `budget`/`budget-*` values** — no check reads them after the wall-clock removal.
  Shipwright removes at next harbour.
- **Harbour report-only findings, deferred to next harbour coverage triage:**
  - The `mode: "double"` loopback-provisioning branch in `002-…steps.ts` may be behaviour-stale (the only
    path reaching the `configuredStoreName` seam; no current Given sets that mode). Pattern-join can't see
    it.
  - Economy cost outliers NOT acted on (report-only): the sandbox Vercel device-auth cluster (~343s,
    ~27% of the tier), logic `006 package-name` 16.2s (8× peers), the dead-artifact check's 7.3s
    full-suite `step-usage` dry-run (harbour-cadence candidate).

## Fragilities — carry, do not "fix" blindly

- **The wake (`coverage/weather/*.ndjson`) gets WIPED at VM/day boundaries.** It vanished mid-session
  07-23→07-24. This is why the economy checks are completion-gated (cold wake passes). A wiped wake is not
  a defect; the next real tier runs repopulate it.
- **eval-captures go stale when the shared store dies** (day boundary / reclaim). The `eval-endpoints`
  check correctly reds on the 404. Re-record via ONE sandbox `@pipeline` run (`broad-sandbox-serial`,
  ~13min) — it heals the store and rewrites `eval-captures.json`. Its per-run identity is LOAD-BEARING; do
  NOT hand-edit or revert as taint.
- **The sandbox `@pipeline` OOMs the box under neighbour contention.** dk: let it fail, retry on a quiet
  box. No memory cap (that would be "handling" a VM failure).

## dk's kept-against-audit scenarios (muster dissents) — do NOT re-cut without a new ruling

030 x2 (foreign agents share this box), verification-economy eval-captures-still-serve (the guard that
ends the eval saga; earned in blood, used again 07-24), reclaim-on-import (destructive on shared box),
ambient-setup-once, 020 doctor-non-first-party + every-request-site, 012 one-creation-seam-preview-trust,
002 concurrent-storefront-prepare (last product concurrency), 025 spend-ledger, methodology
plank-names-current. **DROPPED from this list 07-24: the OOM-reds check (dk ruled it VM-failure cruft) and
the wall-clock/budget check (dk ruled it overreach).**

---

# THE ONE FACT NO MECHANISM CARRIES

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a different eval model; never touch `HARNESS_EVAL_MODEL`. On
any `@eval` red, fix Jolly's affordance (`assets/skills/jolly` or the `/setup` page). AGENT-MODE BREADTH IS
DECLINED (dk 2026-07-20): ONE baseline model, full stop.

**Eval saga root cause (guarded):** the recorded shared store went DEAD; golden captures served a 404
domain; `jolly start` correctly polled for readiness; the agent budget drained; harness reported a
timeout. Polling writes no ledger, so cheaper diagnostics missed it. Guarded by the eval-endpoints check.
`pi -p` buffers and prints only the final answer, so a timeout kill leaves `agent.stdout.txt` empty — to
see turns, snapshot `/tmp/jolly-cannon-fodder-run-*/session/*.jsonl` DURING the run. `.env` token exposure
RULED CLOSED (dk: cannon-fodder org, no rotation owed). `HARNESS_OPENROUTER_API_KEY` is a real paid
credential and stays scrubbed.

---

# Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap **2 environments**; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the ONLY safety boundary; never widen.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for `@creates-env`
  guard deploys (004). One creation test per seam.
- Golden captures record against the PERSISTENT shared store + shared deployment (live URLs). Harbour /
  a fresh `@pipeline` run re-verifies and re-records them.
- Reclamation is age-gated (feature 030): stale = older than the full-regression budget; shared store
  exempt by name.
- Terminal width KEPT; in-place multi-stage redraw KEPT (sole live exception to no-redundant-impl). 004
  bounded stock/collection concurrency KEPT and PINNED (`@sandbox`). Do not reopen without a new ruling.

---

# Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. A check CAN report green while resolving nothing — verify it
  enumerated. (07-24: the OOM check passed VACUOUSLY once the wake was wiped, hiding that no fix ran.)
- Never let anything follow a verification run in the same command; the summary line is evidence, the
  exit code is hearsay.
- Kill by exact ps-listed PID, never `pgrep -f`. Filter FOREIGN agents (`shipshape-shakedown`) from `ps`.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- Heavy verification is MAIN-LOOP-tracked (`run_in_background`), never babysat in an auto-resuming
  subagent. A sandbox `@pipeline` run outlasts a turn — background it, resume on exit.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- dk wants QUESTIONS AS QUESTIONS: crisp, structured, one decision each. And dk WILL question whether a
  mechanism is worth its cruft — welcome it, answer honestly, do not defend machinery.
- One writer at a time; dispatch thin (role + base commit). The Shipshape dispatch guard REJECTS a verbose
  Captain→QM/Boatswain dispatch — QM re-derives failures from the watchbill + tree + AGENTS.md itself.
- DISPATCH QM/Boatswain AS SUBAGENTS (`shipshape:qm`, `shipshape:boatswain`), never `/shipshape:qm` in the
  main loop: a slash-invoked role carries no `agent_type`, so custody guards are all off.
- A support-code edit's blast radius is the WHOLE tier it serves — QM/Boatswain run the tier's
  enumeration sweep, not just focused targets.
- A voyage can legitimately discover mid-flight that closing needs a heavy run (sandbox re-record) or
  even harbour; hand directly on with uncommitted work-in-flight rather than force a bad close.
- Use Yoink (`npx @dk/yoink`) for noninteractive shell whose output is collected; use the Bash tool's
  `run_in_background` for long tracked runs (Yoink is not for backgrounding).

---

# LESSONS — Captain errors, do not repeat

1. **READ THE TRANSCRIPT / RUN THE COMMAND BEFORE DIAGNOSING.** Measure the gap; do not theorise it.
2. **DO NOT WRITE WHILE A ROLE HOLDS THE DECK.** A mid-run edit moves the deck hash and voids carried
   greens. Notes commit AFTER the role returns.
3. **VERIFY A ROLE'S LOAD-BEARING CLAIM BEFORE RULING.** 07-24: QM reported the OOM check "green
   throughout"; running it showed the wake was WIPED and the green was vacuous — the fix never ran.
4. **DO NOT WRITE A WATCHBILL ENTRY FROM MEMORY.** Grep the actual scenario name.
5. **NEVER LET AN APPROVED PLAN SURVIVE A REFUTED PREMISE.** dk approved "fix the OOM now" on the premise
   the red was visible/fixable; when the wake-wipe refuted it, going back to dk was correct — and led to
   the far better "remove the check as cruft" ruling.
6. `eval-captures.json` per-run identity is LOAD-BEARING. Do NOT revert it as taint.

---

# Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`. npm publish needs `~/.npmrc` with a granular token WITH 2FA bypass.

---

# Upstream findings (~/shipshape, dk: edit directly, no ceremony)

- **RESUME-ON-SIGNAL** should be the named sanctioned route for a run outlasting a foreground budget.
- **A ROLE RUN IN THE MAIN LOOP HAS NO CUSTODY** — `bash-custody.sh` reads `agent_type`, exits 0 when
  absent; a `/shipshape:qm` slash invocation carries none.
- **GIT DIFF/SHOW/LOG -p ARE UNGUARDED READERS OF THE NOTES** — result-set custody enumerates search
  tools only. Fix is a guarded form.
- **DEPENDENCIES BELONG TO FITTING OUT, NOT CREW** (dk 2026-07-20) — confirm it landed upstream.
- **METHODOLOGY OVERHEAD IS SELF-AMPLIFYING** — a method corpus guards its own machinery; structural
  checkers discharge N scenarios where 1 belongs; duplicate checks survive because nothing joins
  features. 07-24 reinforced: an economy-check family accretes checks (OOM, wall-clock) that read the
  wake and then fight cold-wake/variance/VM-failure edge cases; periodically ask per check "is this worth
  its cruft" — dk did, and two checks came out.
- **THE DEAD-ARTIFACT CHECK CATCHES UNREACHABLE LOCALS, NOT JUST EXPORTS** (dk 2026-07-23) — dead-code
  conformance is reachability from live entry points. But it does NOT catch a REACHABLE recorder whose
  output nothing reads (a write-only `armWallClockHistory`); that stays a human/QM verification-debt
  judgment.
- **A NO-SEED / COLD-WAKE SCENARIO NEEDS A NON-VACUITY GUARD** — a wake-reading check passes vacuously on
  an empty wake, which both hides real state (the OOM) and is the correct cold-start behaviour; the line
  between them is whether the tier actually ran, hence completion-gating.
