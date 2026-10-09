> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

---

# DECK STATE

**HEAD will move; see commits. Tree CLEAN. PUSHED. RELEASED: `@dk/jolly` 0.13.2 SHIPPED via GitHub Actions (run 37378666297, `+ @dk/jolly@0.13.2`, provenance log-index 3095769529, registry time.modified 2026-10-05T21:54:04Z; `npx @dk/jolly@0.13.2 --help` verified from registry on a clean tmp install). First publish attempt 403ed (E422: package.json `repository.url` empty vs provenance repo) — fixed by adding `repository` block; re-tag `v0.13.2` at `dfae118`. Trusted-publisher binding works; ship line in RIGGING `## Outbound` proven end-to-end.**
Vercel relinked under correct account (dmytri/team_LW0…) — homepage ships work from this box; content owes nothing. Vercel-fitting-out trap: dk-8529 is the WRONG account (hobby, 0 domains); dmytri is correct.
2026-10-09 harbour CLOSED: deps swept to latest (7 pkgs + pi-coding-agent→1.1.0). FULL REGRESSION GREEN ON EVERY CREDDENTIALED TIER: logic 107/107 (889 steps), sandbox-serial 3/3, sandbox 27/27. Two real fixes landed en route: (1) PRODUCT: a blocked store now pauses store-dependent stages — recipe/stock/deploy/stripe stay pending, never awaiting-approval (spec 002:38 + step bound; focused 19/19, approval-gate neighbour green); previously `--yes` spawned a doomed configurator + vercel deploy against a dead store. (2) HARNESS_SECRET: spend-ledger argv redaction at every write surface + render (token flags → `<redacted>`; SHIM_SOURCE_VERSION 4-argv-redaction); caught live when a violation message printed the staff token in cleartext. Shim-template regression (eaten `node:path` import + `ownDir`) broke every npx spawn mid-window — repaired, boot-smoke-proven. eval golden captures HEALED (store + deploy endpoints re-recorded, committed at e159514). QM custody cut mode:"double" dead support (fda9e0a) + dead cold-store module removal (8e17d1e). dk CREDENTIAL ACTIONS: (a) STAFF TOKEN BURNED — the red assertion + pre-redaction ledger printed it in cleartext; revoke `a90f…` in the Saleor dashboard, mint new, paste here (b) eval creds HARNESS_OPENROUTER_API_KEY + HARNESS_EVAL_MODEL absent since the VM reset — @eval leg reds as fitting-out blocker until provided (web-console actions). ENOSPC recurred twice; npm cache/_npx reclaimed. My sacrificial probe leaked env `jolly-store` (deleted 202).

## Last work: publish-via-GitHub refit (harbour, closed 2026-10-04)

dk rulings: tag-push `v*` trigger, NO gate (tag is the gate), npm trusted publishing (no NPM_TOKEN).
- `.github/workflows/publish.yml`: tag `v*` -> npm ci + `npm publish --provenance` (build via prepublishOnly;
  no registry-url — setup-node's `_authToken` line breaks the OIDC exchange without NODE_AUTH_TOKEN).
- RIGGING `## Outbound` npm ship line: `npm version patch` + push main + push `v<version>` tag.
- **OPERATOR PREREQUISITE: npmjs.com trusted-publisher binding for `@dk/jolly`** (repo `dmytri/jolly`,
  workflow `publish.yml`). Until done, the first workflow publish 403s.
- budget-* RIGGING values REMOVED; **plain `budget` KEPT — live reader** (reclamation age gate,
  `fullRegressionBudgetMs` -> cloud.ts/provision.ts/features 026/030). Earlier "vestigial" framing wrong.
- Custody `4d1c382`; evidence chain rerun fresh (planks 379, step-usage 0 orphans, typecheck, gplint green).
- Dispatch deviation: no `shipshape:shipwright`/`shipshape:boatswain` agent types in this runtime's registry
  (task spawn rejected: "Unknown agent"); dispatched generic `task` subagents ordered to load the role skill.

# OUTSTANDING for the next cycle

- **0.13.2 ships via the workflow**: AFTER dk does the npmjs.com binding: `npm version patch` (-> 0.13.2),
  push main, push tag `v0.13.2`. Verify per RIGGING (`npm view @dk/jolly version`, `npx @dk/jolly --help`).
- **PRE-EXISTING RED standing** (unrelated to refit): eval golden captures dead
  (verification-economy "Every endpoint the eval captures record still serves" reds; store day-boundary death).
  Remedy = ONE sandbox @pipeline re-record (~13min, broad-sandbox-serial) at the next full harbour pivot.
  Likely reds @eval until re-recorded. FIRST agenda item next harbour.
- **Harbour full regression DEFERRED** to next full harbour pivot (dk ruled 35min unacceptable 2026-10-04).
- `mode:"double"` branch in 002-…steps.ts ruled DEAD support (no writer sets the mode; cold.harness! nothing
  creates; startColdStoreCloudApi imported-never-called) — QM custody cleanup at next QM dispatch.
- `npm outdated`: 7 behind, report-only (pi-coding-agent 0.81.1->1.0.2 is a MAJOR; proof = next tier run).
- Economy outliers all report-only with reasons (device-auth = real platform latency; 006 pack+install
  amortization is a QM harness edit, not taken; dead-artifact 7.3s freshness is the point).
- **ENOSPC recurring**: root fs hits 100% under npm cache + neighbour agents; reclaim npm cache/~/.npm/_npx
  when it bites. /tmp/jolly-cannon-fodder-pkg-cache 560M is age-gated, leave.
- Vercel device-auth: 3×10-minute code windows lapsed unapproved pre-dk login [dk: wrong account first, wrong-account session cleaned with .vercel/.env.local]. npm/manual-push outbound fine since.

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
