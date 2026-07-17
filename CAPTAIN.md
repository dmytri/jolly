> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Voyage in flight (2026-07-17), base commit `f55786a`

One voyage carries: the dep upgrade (dk ruled latest-stable; 8 of 9 landed, `happy-dom` removed;
Cucumber 11 -> 13 is a two-major jump with only `discover` proven), the four harbour-ruled spec items
(catalog key join both directions + loud-fail render, 025 Rule rewrite, verification-economy
once-per-run invariant, ARCHITECTURE.md pinning check), and the cut of dead key
`start.vercelSigninIncomplete` (dk ruled cut 2026-07-17; catalog now 331 keys). Watchbill: watch1 =
the four new targets; watch2-4 = @logic, @sandbox, @eval tier sweeps proving the upgrades. QM
dispatched clean-context.

Known red QM inherits through the gate itself: `npm run typecheck`, 12 errors, two step-definition
files (006 steps import the `typescript` compiler API, dead under TS7; verification-economy.steps.ts
TS7022 circular inference). Fix direction is durable in RIGGING.md `## Dependencies`: ts-morph, never
`typescript/unstable/*`. Node strips types unchecked, so every tier can run green while the gate is
red. The gate is the evidence.

ARCHITECTURE.md is untracked and must ride the custody commit WITH its pinning check green: its header
claims the check exists, so committing it without one ships a lie. Shipwright owns its refit at
harbour (dk ruled); AGENTS.md must record that local scope extension in a harbour window.

**Outbound pending after custody: push catalog + harbour + upgrade voyage together (dk ruled).**
`main` is 3 ahead of `origin/main` before this voyage's commit. Push needs dk's word at the
clean-deck report.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a stronger or different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly` copy or
the `/setup` page) so even this baseline proceeds autonomously. dk has run many successful tests on
exactly this model; framing model capability as the problem is wrong and unwelcome. If this ever
needs to bind QM, it becomes a `.feature` scenario, never a note and never a memory.

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false`. Auto-memory is an Article-7 bulkhead
   breach vector; dk ruled it off GLOBALLY. Set FIRST on any new VM, before dispatching a role.
1. `npm ci`, then confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber`. An
   uninstalled tree falls through to a public-npm placeholder that exits 0: a false green.
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` (new staff token per VM) + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser; session lives in Vercel's own store).
4. `gh auth setup-git` (https origin has no credential helper otherwise; push dies without it).

## Held product rules

- Stripe keys stay the human's: Jolly installs the Stripe app and points at the Dashboard, never
  handles keys.
- The `.env` org is 100% cannon fodder; cap is 2 environments. Delete a fresh account's default
  store before handing an account to Jolly: it lacks the namespace, reclaim rightly refuses it, and
  it squats a slot. The `jolly-cannon-fodder-` prefix is the only safety boundary; never widen it.
- Shared-store transient death is real and self-heal handles it on the next invocation. Retry a
  heavy 404 ONCE; a second failure is a real defect.

## For next harbour (report-only, re-derivable from signals)

- Harness defect: the shared store can die MID-RUN and no gate catches it; the health probe runs at
  provisioning only. Harbour's 3 heavy reds (2x shared-store 404, 1x Cloud `fetch failed`) were this.
- 16 orphaned step definitions. `report.html`/`report.json` tracked in git but are wake.
- Fail-fast capacity: at cap with nothing reclaimable, `BeforeAll` should name the squatter fast.
- `AGENTS.md:92` still claims happy-dom (uninstalled, zero refs). Shipwright's to refit.
- RIGGING `runtime: node@20` publishes ONE runtime for TWO: product floors at 20.12, harness needs
  >=23 for type-stripping. A role provisioning to it builds a VM that cannot run the suite.
- Tier cost: measured numbers stand (@logic top 15 = 63% of tier; @sandbox light top 3 = 92%), but
  the "PTY cluster" framing was REFUTED. The common factor is each scenario spawning the 5,914-line
  CLI; test the spawn target (dist vs src) before designing any tier. Do not act on the old framing.
- `src/index.ts` at 5,914 lines / 285 planks: standing, un-perturbed by dk's call.

## Standing rules, learned the hard way

- NEVER quote these notes' content to another role. If a role needs a fact, give it the command that
  answers it, never the note that asserts it. Quoting the notes IS the Article-7 breach.
- Grep is an opinion; run the join (`plank-inventory` x `step-usage`). A check that enumerates a set
  is trusted only after you verify it enumerated the set. Three self-checks were falsely wrong or
  falsely clean last harbour (globstar miss, absent-from-coverage-JSON read as covered, node@20).
- Never let anything follow a verification run in the same command: no `| tail`, no `; echo EXIT`.
  The summary line is the evidence; the exit code is hearsay.
- `pgrep -f` matches its own command line. Kill by task ID, never by a pattern the killer carries.
- Any interactive-path change verifies through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box; 8192 was OOM-killed.
- dk wants live play-by-play while work is in flight. Never poll a dispatched agent; its report is
  the only completion signal.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time. Dispatch thin: role and base commit; the artifacts are the hand-off.
