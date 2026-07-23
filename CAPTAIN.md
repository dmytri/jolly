> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

---

# DECK STATE

**HEAD = `7a15b21`. Tree CLEAN. IN SYNC with origin/main (pushed `bf2ac39..7a15b21`, tag `v0.13.1`).
`@dk/jolly` 0.13.1 PUBLISHED to npm and live. Harbour COMPLETE, 137/137 across four tiers. NO
outbound pending. Batch fully shipped.**

Custody `58c82f6` (harbour), release `1fc8704` (v0.13.1), notes `7a15b21`. Registry confirms 0.13.1;
local `bin/jolly --help` verified. If a fresh cycle wants belt-and-braces: `npx -y @dk/jolly@0.13.1
--help` should now run the published bundle (it was still propagating at ship time — CDN window).

## NEXT VOYAGE: the harbour follow-up (deferred this batch, dk-ruled defer-and-publish 2026-07-23)

See "DEFERRED to a follow-up voyage" below: promote/supersede/discard the 3 `@captain` skeletons
(`004` concurrency, `012` blank-env, `020` colour-glyph), rule the 2 findings (`NPM_CONFIG_LOGLEVEL`,
`agentResumePollSeconds`), and clean the `pressure.ts` dead pair — plus rule whether the dead-artifact
check should catch unreferenced LOCALS (un-export currently evades it).

## The voyage so far (dk ruled check-driven, then harbour, 2026-07-23 this session)

1. Captain authored ONE `@logic @invariant` in `features/methodology-conformance.feature` —
   **"No dead verification-support artifact accumulates"** — guarding orphaned step-def patterns AND
   unreferenced `features/support/` exports, each with a planted-red leg. gplint clean. Watchbill
   `watch1` carried that one target.
2. QM made it executable (`features/support/dead-artifact-conformance.ts`), removed all **507
   orphaned step defs** (4 files deleted outright: 009, 029, command-custody-hook,
   single-creation-seam; rest statement-by-statement across 22 files) and **103 unreferenced
   support exports** (86 un-exported, 17 deleted). Target green in isolation; typecheck clean.

## THE BLOCKER QM SURFACED — the reason this became harbour

Removing scenario-unbound step defs **stranded ~145 production `@planks(...)`** on untouched
`src/`/`bin/` seams that named those orphans, reddening the required check "Every plank names a
current step-definition pattern". The two checks aren't contradictory — the tree carries 145
**behaviour-stale planks** left by the corpus cuts. Verified real: `src/index.ts:583` carries
`@planks("the user runs \`jolly login\`")`; NO scenario binds "the user runs `jolly login`";
scenarios use "the agent runs `jolly login`". A plain misannotation in that case; others may be lost
behaviour. Article 2 + Planking agreement: behaviour-stale plank is **harbour coverage-triage**,
"Harbour's coverage triage is the net" — re-plank / condemn / author-scenario, per-seam product
judgment. Outside QM and Crew scope. dk ruled **harbour now, then publish** (2026-07-23).

## DOCTRINE DEFECT recorded (Captain-authority decision, this session)

Harbour "begins on a clean tree; uncommitted voyage work routes through Boatswain custody first."
But QM's cleanup only reaches green TOGETHER with the plank reconciliation, so it is NOT
green-committable as a standalone voyage. It rides into harbour as role-advanced work-in-flight (not
dirt); Boatswain commits the coherent green result at harbour custody. **Upstream finding: a voyage
can legitimately discover mid-flight that its completion requires harbour, so a voyage may hand
directly to harbour with uncommitted work-in-flight.** The correct completion order is
Shipwright-then-settle: reconcile planks so the removed orphans become truly dead.

## HARBOUR COMPLETE (Shipwright returned; clean regression green after budget fix)

Shipwright reconciled all ~145 stranded planks (367 planks, 0 stranded, 0 condemnations, typecheck +
gplint clean) and wrote 3 `@captain` skeletons. THEN the regression went sideways: TWO detached runs
(Shipwright's + a reconciliation fork's) collided, corrupting the shared store and filling the org's
2-env cap with two shared stores. Captain killed both by exact PID, and — dk-authorized, foreign
agent confirmed off this Saleor org — deleted the ORPHAN duplicate shared store (kept the
marker's current `...mrx8nopo`), freeing a slot. One clean tracked regression then ran:

- **sandbox-serial 3/3, sandbox 26/26, eval 2/2, logic 106/107.** The 4 cold-box reds warmed away.
- The one logic red was the budget-fit check: sandbox recorded 1123.3s vs its 1050s budget under
  neighbour-agent contention (26/26 green, same scenarios as the 896s baseline — contention, not
  slowdown). **dk ruled: raise `budget-sandbox` 1050 -> 1200** (and `budget` 2540 -> 2690). Budget-fit
  scenario RE-PROVEN green against 1200. Harbour now 137/137.

## dk ruled 2026-07-23: DEFER skeletons, PUBLISH NOW — DONE

Boatswain custody `58c82f6` committed the whole harbour diff and struck the watchbill. Version bumped
`1fc8704` (tag v0.13.1). `npm publish` succeeded (`+ @dk/jolly@0.13.1`, dist built, 18 files, no
2FA-bypass snag). Registry confirms 0.13.1; local `bin/jolly --help` runs; published-bundle npx run
was still `jolly: not found` seconds after publish (CDN propagation, expected, rides through — RE-VERIFY
`npx -y @dk/jolly@0.13.1 --help` once settled). Homepage untouched (live == source), no deploy owed.
REMAINING: `git push origin main --tags` (dk's explicit outbound call).

## DEFERRED to a follow-up voyage (do NOT lose these)

- **3 `@captain` skeletons** Shipwright wrote, real behaviours the cuts dropped, byte-exact
  `@planks-provisional` replanks in place: `004:Jolly start runs the stock and collection requests
  concurrently` (check supersede-into-002 vs promote); `012:Jolly provisions a blank environment with
  no sample data` (needs `@creates-env` licence + one-creation-per-seam if promoted);
  `020:Human terminal output carries colour and a restrained status glyph per check` (cheap @logic,
  matches kept terminal-UX prefs).
- **2 Shipwright findings**, dropped behaviours unverified: `main` NPM_CONFIG_LOGLEVEL suppression;
  `agentResumePollSeconds` JOLLY_* affordance plank.
- **`pressure.ts` dead pair + a CHECK GAP.** `tierWorkerCeiling` / `readTierWorkerCeilings` /
  `WORKER_CEILING_LINE` (~lines 118-146) are never called; QM UN-EXPORTED them (not deleted), so the
  new dead-artifact check — which only sees unreferenced EXPORTS — cannot see them. Harmless dead
  SUPPORT code. QM should delete them; and dk should rule whether the check should also catch
  unreferenced LOCALS in support modules, or whether un-export is an accepted evasion to close.
  `deriveWorkerCount` and `CONFIGURED_PARALLELISM` in the same file ARE live (wake-run-scope,
  cucumber.js) — do not touch them.

## Two harness FINDINGS, carry as fragilities not defects

- **The spend-ledger check is order-dependent.** `@logic` first under cheapest-first `order` reads
  the PREVIOUS run's `@sandbox` ledger; on a fresh/cold box with no ledger it reds. Real fragility.
- **`027:Interrupting the unattended stages reports honestly` is load-sensitive.** Failed ONCE under
  full-regression load, passed since. "Did not reproduce" is NOT "fixed" — engineer out if it
  resurfaces, never re-run past.

## dk's 12 kept-against-audit scenarios (the muster dissents) — do NOT re-cut without a new ruling

030 x2 (foreign agents share this box, age gate stops deleting a live sibling's env),
verification-economy eval-captures-still-serve (dead store presents as agent-timeout, cost a day),
OOM-reds-check (today's OOMs were single-worker), reclaim-on-import (destructive on shared box),
ambient-setup-once (the rule the 15 TS-project OOM broke), 020 doctor-non-first-party (second
injection point, .env not --url), 020 every-request-site (the exhaustiveness check), 012
one-creation-seam-preview-trust, 002 concurrent-storefront-prepare (last product concurrency), 025
spend-ledger (localised the eval cost), methodology plank-names-current (found 8 stale annotations).

---

# SUPERSEDED — earlier deck state, kept only for the eval saga and lessons below

**HEAD = `90b1285`. Harbour COMPLETE. A post-harbour voyage is IN FLIGHT, uncommitted.**

Harbour done: 3 skeletons promoted (stage-surface-consistency, completion copy, riskContext prose),
1 condemned and removed (the `.env` `SALEOR_ENV_HEADER`, dk 2026-07-22 — no scenario ever pinned it;
`ensureEnvHeader` went with it). Full regression 3078s/3640s, all four tiers. pi-coding-agent
0.80.10 -> 0.81.1.

**In flight, NOT committed** (Boatswain refused custody once already, correctly):
- Both first-party perturbations PLANTED and DISCHARGED. `assertFirstPartyUrl` (cloud-api) and
  `assertFirstParty` (device-grant) audited by Crew and consolidated. `rg PERTURBATION src bin`
  reports none.
- Budget-check defect FIXED by QM in `wake.ts` (`operationalRecordPaths`): the check keyed on
  BASENAME, so `instrumented/logic.ndjson` resolved to tier `logic` and its c8-inflated 662.1s was
  judged as the tier's own clock. Operational is 491.8s against a 650 ceiling. **`budget-logic` was
  NOT moved** — ratcheting to absorb c8 overhead would bake instrumentation into a production
  ceiling.
- 8 provisional planks liquidated to real `@planks` by Crew; `STAGE_SURFACE` added to `src/index.ts`.
- **`assets/messages/cli.json` 362 -> 413 entries** (Captain, this session): 17 completion clauses +
  34 riskContext entries, wording VERBATIM. Template-literal fragments merged into ONE entry with a
  `{name}` placeholder per the feature's interpolation Rule; repeated clauses (`login` action,
  the whole `skip store provisioning` group) carry one entry referenced from every site.
  Watchbill carries the two catalog targets PLUS `Every referenced message key resolves and every
  catalog entry is referenced` — that third one is the guard against an unreferenced entry of mine.

## Open, dk's to rule

- **`AGENTS.md` "Boatswain" section is STALE against upstream doctrine**: it instructs Boatswain to
  remove unreachable production code; the current Articles defer that to harbour and forbid it.
  Boatswain followed the Articles and reported it. Captain may not edit `AGENTS.md` for spec work
  without dk's word.
- **`AGENTS.md` `## Jolly` section** written by `mergeAgentsMd` is the sibling of the condemned
  `.env` header and is still uncovered copy. dk ruled on `.env` ONLY; this was deliberately not
  extended.
- **`src/index.ts:5854` `SIDE_EFFECTING_STAGES`** is a FIFTH stage site. The stage-surface scenario
  names four, and scenario text is law, so the checker reads four. Carried, unrouted.
- **`bin/` has no coverage at all** — spawned as a separate process, so harbour triage is blind there.
- **Unpinned boundary**: `src/lib` modules import only the sinks `messages.ts` and `hosts.ts`, never
  each other. Holds today by accident, enforced by nothing.
- 30 orphaned step definitions stand (`RIGGING.md` records 1175/30). `command-custody-hook.steps.ts`
  is dead in full, 127 lines, its feature removed this voyage.

Shipped in `40f1436`: the 16-removal simplification, five re-derived budgets, three harness defects
engineered out, and ONE production line — `runStartCore` no longer reports `success` while carrying
a failed check (a real honesty defect against Jolly's core promise). Still in the inlined-ternary
shape an old checker forced; correct and green, readability item for harbour.

**Pending outbound: npm 0.13.1 is UNSHIPPED.** Local and published are both `0.13.0`, so shipping
needs a bump. dk approved nothing; harbour work rides the next outbound with harbour's own full
regression as its proof. The homepage needs NOTHING: live == source, verified by curl.

## Carried into harbour

- **24 orphaned step definitions.** THREE sites this voyage's cuts created, QM scope to delete:
  `command-custody-hook.steps.ts` (DEAD IN FULL, 126 lines, all 5 defs zero-usage),
  `026-live-by-design-verification.steps.ts` (3 defs), `command-surface-consistency.steps.ts` (1).
  Plus 21 pre-existing across 002/004/005/006/008/012/018/027/shared. **Nine of the 21 are patterns
  `runStartCore` planks against**, so the plank join stays GREEN while no runnable scenario binds
  them — the behaviour-stale case the join cannot see. Worth a harbour lens of its own.
- **`report.html` and `report.json` are TRACKED at repo root** — generated cucumber formatter
  output, unchanged since `06f1a60`, referenced by no config. Wake committed into canon, against
  the Transient output policy. Untrack them.
- The 12 PTY scenarios (below).
- Two orphan `run-start` entries in `coverage/weather/eval-spend-ledger.ndjson` (10:53:37,
  12:07:35), both pre-dating the fix, outside every current leg window, harmless. Deliberately NOT
  hand-edited: editing evidence to make a check pass is what the check exists to prevent.

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
The persisted `.env` is UNSCRUBBED except for `HARNESS_OPENROUTER_API_KEY` — it writes live
`JOLLY_SALEOR_CLOUD_TOKEN` and `SALEOR_TOKEN` in plaintext. **RULED CLOSED, dk 2026-07-22: "I don't
care about these environments or tokens, it's all cannon fodder."** The `.env` org is a dedicated
disposable test org, so Saleor token exposure there is not a security item and no rotation is owed.
DO NOT RAISE IT AGAIN. The rule that still binds is the namespace boundary, not the tokens:
`jolly-cannon-fodder-` is the only protection, never widen it. `HARNESS_OPENROUTER_API_KEY` is a
different matter — it is a real paid credential and stays scrubbed.

---

# THE GREAT SIMPLIFICATION — dk ruled 2026-07-22, EXECUTED IN ONE PASS

**262 -> 186 scenarios (-29%). 32 -> 27 feature files. Method corpus 54 -> 31.** gplint clean.
Derived from a four-way parallel audit of every scenario in the corpus; each cut named the fault
class it surrendered before it was taken.

**Five feature files retired**, each with its one surviving clause rescued:
- `029-composable-stage-commands` -> its 5 stage scenarios re-asserted stage outcomes already
  pinned in 002/004/005. Kept "composes the stage seams in order" + the Rule, both now in 002.
- `003-saleor-source-repositories` -> 3 dry-run plan facts already asserted elsewhere. **Its
  research notes are NOT lost: they are `assets/research/saleor-sources.md`.**
- `019-iteration-phase` -> doctor/upgrade covered by 014/017. Kept the `.mcp.json` mcp-graphql
  assertion, now in 007.
- `010-agent-decided-approval-model` -> its single scenario WAS 021's gate scenario.
- `028-sandbox-worker-isolation` -> guarded worker-id collisions impossible at 1 worker. Kept the
  "cucumber.js worker count equals the rigging's declared count" clause, folded into
  methodology-conformance's tier-command scenario.

**027 went 35 -> 22**: nine scenarios were read-only observations of the SAME happy-path PTY
transcript and three were satellites of the one Ctrl-C session. Their assertions were folded into
the host scenarios, not dropped. This is the 569s cost centre; ~12 real PTY spawns gone.

**ALL PARALLELISM IS NOW GONE.** `workers-logic` 2 -> 1 joins `workers-sandbox: 1`; `lanes` and the
pressure auto-tuner were already retired. The premise that justified logic parallelism ("light
enough never to exhaust this box") was refuted twice by the kernel on 2026-07-22.

**STANDING FIX, not yet done**: `features/support/plank-conformance.ts` and
`features/support/composition-lane-conformance.ts` each spawn a full nested
`cucumber-js -p all --dry-run` with the SAME command and tags, differing only in `--format`. That is
the OOM cause. Share one cached dry-run. QM's, and it does not require losing either guard.

**Judgment calls made, so a later role does not relitigate them:**
- KEPT `verification-economy:A step that runs pinned at its declared read ceiling` despite looking
  like a duplicate of the observed-signal scenario. Different faults: one proves the wait's FORM,
  the other proves it FIRED. A read that times out at its ceiling looks green while asserting nothing.
- SPLIT the architecture check: dropped the file-COUNTS clause, kept the module listing. The counts
  reddened twice in one day from routine file additions; a check that cries wolf on routine work
  trains its reader to ignore it.

**QM inherits a large orphan sweep**: 76 scenarios were removed or merged, so many step definitions
are now unused. That is expected work, not a fault.

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
