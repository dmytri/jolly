> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## STATE (2026-07-17 ~21:05): SPEED VOYAGE SHIPPED except npm publish (held on auth)

Speed voyage CLOSED and PUSHED. `origin/main` at `79d7ff2` (voyage = commits `b727087` +
`79d7ff2`). Working tree clean, package.json 0.12.4.

**Delivered:** golden-capture eval (live agent, captured services — eval 9m36->~1m47, 5.4x),
licensed spends + spend-ledger invariants, budgets in RIGGING (ratchet), resume-aware
`jolly start` (`storeHoldsRecipeCatalog` skips satisfied recipe/deploy stages — interactive
completion 5m26->50s), cold-start readiness gate as `@exceptional-double`. Suite ~54m -> ~34m
warm. Full @logic conformance 55/55 green; @sandbox 49/49+6/6; @eval 4/4.

**Budgets (RIGGING ## Tiers), set from measurement:** total 2250, logic 250 (clean 210.5s;
voyage's own +4 @invariant scenarios grew the tier), sandbox 900, sandbox-serial 900, eval 240.
dk's 1200 (20-min) is ASPIRATION, delivered by the overlap voyage, never a bare value edit.

### ⚠️ OPEN — dk action needed: npm publish BLOCKED on auth
`npm publish` of 0.12.5 failed E404 on PUT (`you do not have permission to access @dk/jolly`) —
not authenticated with publish rights to the `@dk` scope. Build + dry-run were CLEAN (dist
257.8kb, 18 files), so this is auth only. HELD per dk's standing rule (auth failure -> hold
publish, push still lands). To ship: `npm login` (or set the @dk publish token), then
`npm version patch` (-> 0.12.5), `npm publish`, `git push origin main --follow-tags`, verify
`npm view @dk/jolly version` = 0.12.5 and `npx @dk/jolly@0.12.5 --help`. Homepage target already
verified serving (200 on / and /setup; assets unchanged, no redeploy).

## NEXT VOYAGE: TIER OVERLAP (dk-ruled, run autonomously; author from a FRESH context)

Goal: full regression <= 1200s by running tier legs CONCURRENTLY. Serial floor is ~34m; the
cut comes only from overlap. dk-ruled design:

1. **Isolation FIRST (the enabling blocker).** Invocation-global reclaim races a live sibling:
   a sweep's BeforeAll reclaim deletes another run's run-namespaced scratch/env. Make reclaim
   RUN-SCOPED (touch only this run's leftovers + age-stale ones, never a live sibling's). Until
   this holds, concurrent invocations corrupt each other. This is harness/verification-support
   work (QM scope), spec'd as a scenario: "two concurrent cucumber invocations do not reclaim
   each other's live resources."
2. **Resource-aware via THE WAKE (dk: "we can/should use the wake for this").** OOM -> rerun ->
   latency. Tier runs record memory pressure (peak RSS, OOM/OOM-kill events) into the weather
   stream ALONGSIDE wall clock (same `<tier>.ndjson`, no new artifact — upstream weather law
   already names pressure signals). The concurrency prior READS the record and backs off on live
   pressure rather than crashing. An OOM is a RED harness-defect finding, never a silent rerun.
   Scenario shape mirrors the existing "tier run writes its wall-clock record" @invariant.
3. **Scope: SAFE PARTIAL FIRST, then tighten (dk-ruled).** Overlap the cheap tiers (logic ||
   eval ~210+157) alongside sandbox first; land ~1400-1500s; then let wake data guide tightening
   toward 1200. NOT max-concurrency-from-the-start (OOM-churn risk on 7.9 GB).
4. **Budgets re-derived UNDER concurrency.** HARD LESSON this session: logic measured 210.5s idle
   vs 306.7s under contention. Serial-derived budgets DO NOT transfer to concurrent operation.
   Every per-tier budget must be re-measured under the overlap it will actually run in; dk
   re-rules the values from that measurement.

Order: author isolation + wake-pressure scenarios -> watchbill -> QM builds run-scoped reclaim +
pressure recording -> prove isolation (concurrent invocations, no cross-reclaim) -> measure
overlapped -> re-derive budgets -> dk rules final values.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly` copy
or the `/setup` page). If it must bind QM, it becomes a `.feature` scenario, never a note.

## Resume-loop mechanics (proven this session — carry until upstream mechanizes it)

Captain hand-carries QM/Crew resume across detached runs: QM launches a tier detached, ends its
turn; Captain waits on the run, SendMessages QM on exit. WAIT CORRECTLY:
- `tail --pid=<EXACT NUMBER>` only. NEVER pgrep in the waiter: node's comm is "MainThread" here
  (so `pgrep -x node` finds nothing), and `pgrep -f cucumber` self-matches the waiter's own
  command line. Both trapped a full HOUR this session.
- Capture the exact wrapper pid in the FOREGROUND first (read it yourself), then background a
  pure `tail --pid=<n>`. A nested Crew mate cannot be signalled through QM — tell QM the run
  exited and to collect/re-run itself rather than wait on a nested child.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- 0.13.29 installed; budget + licensed-spend law proven live this voyage.
- Resume-on-signal machinery is the top work item — hand-carried ~20 times this session, cost an
  hour to waiter bugs. Mechanize: resume a role on its detached run's exit signal.
- Retire stale AGENTS.md local blockers-first addition at next harbour (AGENTS is Shipwright's).

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser) — @sandbox only; eval needs no Vercel session.
4. `gh auth setup-git`. **npm publish also needs `npm login` / @dk publish token (see blocker).**

## Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap 2 environments; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the ONLY safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.
- One licence: `@pipeline` = 002 operational-readiness proof only. Element licence for
  `@creates-env` guard deploys (004). One creation test per seam; different parameters, not
  different sequences.
- Golden captures record against the PERSISTENT shared store + shared deployment (live URLs);
  reject per-run-tainted observations by CONTENT. Harbour re-verifies captures vs live services.

## For next harbour (report-only, re-derivable)

- Stale `@heavy` prose: `AGENTS.md:119,123`; comments in 002/004/029 step files,
  `features/support/fast-forward-deploy.ts`. AGENTS.md eval prose (live Vercel deploy, KEEP_STORE)
  stale vs golden-capture design. All Shipwright's (AGENTS is not Captain's).
- 16 baseline zero-usage step definitions (two at `006-npx-cli-command-surface.steps.ts:502,521`).
- No derived check joining RIGGING `## Dependencies` to `package.json`.
- `report.html`/`report.json` tracked but are wake.
- `vercel login` device-flow children orphan to init and poll ~5-10 min before teardown reaps
  them — reap once the device URL is captured. Resource pressure; overlap-voyage relevant.
- Wake-wipe incident (unverified): out-of-band coverage/ rewrite ~13:03-13:05 this day destroyed
  a ledger+shims; watch for recurrence.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. Trust a set-enumerating check only after verifying it enumerated.
- Never let anything follow a verification run in the same command; the summary line is evidence,
  the exit code is hearsay.
- Kill by exact ps-listed PID, never `pgrep -f` (self-matches). Wait on exact PIDs only.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- A tier's wall clock inflates hard under contention; measure budgets on an IDLE deck (or, for
  overlap, under the concurrency it will actually run in).
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin (role + base commit); hold Captain writes while a role holds the deck.
- Conformance family (@logic @property/@invariant) must be green before custody — it catches
  voyage-introduced drift (stale planks from step renames, marker-window, budget growth) that
  focused watches miss. Include an @logic watch whenever specs/steps are renamed.
