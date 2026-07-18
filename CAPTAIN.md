> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## STATE (2026-07-18): OVERLAP VOYAGE IN EXECUTION; npm publish PARKED by dk

Base commit 26e0edf, everything in flight on the tree. QM pass 1 (isolation + pressure +
@logic sweep) and pass 2 (architecture count fix + 026 stale respecification, real reclaim
proofs) both SPENT, green. **Overlapped MEASUREMENT DONE (safe partial: [sandbox ->
sandboxSerial] || logic || eval): wall clock 1584s vs ~2035 serial warm.** Legs: eval 145.3
(4/4), logic 237.6 contended (200/201), sandbox 874.8 (49/49), sandboxSerial 680.3 (6/6,
ran on quiet box). Pressure recorded all lanes, concurrent peaks sum ~6.4GB vs 8.32 ceiling,
ZERO OOM. Sandbox lane (1555s) IS the critical path; logic+eval fully shadowed. Road to
dk's 1200 runs through the sandbox legs (org cap 2 envs binds leg-on-leg overlap — dk rules).

The one measurement red: spend-ledger invariant under overlap — the check read a LIVE
sibling's/own partial ledger ("last run" not run-scoped). Same class OBSERVED on the
budget-fit check: it ran minute ~4 reading sandbox's partial weather record — its green was
unsound. Spec'd the general law (verification-economy Rule "The wake is read run-scoped" +
scenario). QM pass 3 dispatched: watch1 = [run-scoped-read scenario, ledger invariant,
budget-fit invariant].

Voyage sequence: QM pass 3 -> Boatswain custody over the WHOLE voyage -> budget proposal ->
dk RULES values. Custody advanced targets: pass 1's five + 026 domain-label recognition;
pass 2's three; pass 3's three.

**Budget proposal for dk (measured overlapped, ~10% headroom ratchet):** plain budget 1750
as the OVERLAPPED regression wall-clock ceiling (measured 1584); logic 265 (237.6 contended);
sandbox 960 (874.8); sandbox-serial 750 (680.3, ratchet DOWN from 900); eval 160 (145.3,
ratchet DOWN from 240). REQUIRES the pending spec edit: budget-fit's plain-budget assertion
moves from tier-SUM to the overlapped window (sum 2135 exceeds 1750 by design once legs
overlap). Both edits land together on dk's word.

**PENDING SPEC EDIT, rides dk's budget ruling:** verification-economy "Each tier's recorded
wall clock fits its budget" asserts tier records SUMMED fit the plain budget — correct
serial, wrong under overlap (sum > overlapped wall clock). When dk rules post-measurement
values, re-spec the plain-budget assertion to the overlapped regression's wall clock (wake
records give per-leg spans; union window is derivable), then watchbill that scenario.

### npm publish — PARKED by dk (ship on a later outbound)
0.12.4 on npm predates speed-voyage code. Login works; wall is 2FA-at-publish (E403).
To ship: `npm version patch` then `npm publish --otp=<current TOTP>` (run immediately,
~30s expiry) OR granular @dk token with 2FA-bypass; then `git push origin main
--follow-tags`, verify `npm view @dk/jolly version` and `npx @dk/jolly@<v> --help`.
Homepage verified serving; assets unchanged, no redeploy.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an
affordance fault, never a model fault.** Never propose a different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly`
copy or the `/setup` page). If it must bind QM, it becomes a `.feature` scenario, never a note.

## Resume-loop mechanics (proven; carry until upstream mechanizes it)

Captain hand-carries QM/Crew resume across detached runs: QM launches a tier detached, ends its
turn; Captain waits on the run, SendMessages QM on exit. WAIT CORRECTLY:
- `tail --pid=<EXACT NUMBER>` only. NEVER pgrep in the waiter: node's comm is "MainThread"
  (`pgrep -x node` finds nothing) and `pgrep -f cucumber` self-matches the waiter. Both
  trapped a full HOUR once.
- Capture the exact wrapper pid in the FOREGROUND first, then background a pure
  `tail --pid=<n>`. A nested Crew mate cannot be signalled through QM — tell QM the run
  exited and to collect/re-run itself rather than wait on a nested child.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- 0.13.29 installed; budget + licensed-spend law proven live.
- Resume-on-signal machinery is the top work item — mechanize: resume a role on its
  detached run's exit signal.
- Retire stale AGENTS.md local blockers-first addition at next harbour (AGENTS is Shipwright's).

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
- Wake-wipe incident (unverified): out-of-band coverage/ rewrite ~13:03-13:05 on 2026-07-18
  destroyed a ledger+shims; watch for recurrence.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. Trust a set-enumerating check only after verifying it enumerated.
- Never let anything follow a verification run in the same command; the summary line is evidence,
  the exit code is hearsay.
- Kill by exact ps-listed PID, never `pgrep -f` (self-matches). Wait on exact PIDs only.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; resume a dispatched agent on the observed signal, never poll.
- A tier's wall clock inflates hard under contention; measure budgets under the concurrency
  they will actually run in.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin (role + base commit); hold Captain writes while a role holds the deck.
- Conformance family (@logic @property/@invariant) must be green before custody — it catches
  voyage-introduced drift (stale planks from step renames, marker-window, budget growth) that
  focused watches miss. Include an @logic watch whenever specs/steps are renamed.
