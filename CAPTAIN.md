> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-17): upgrade voyage CLOSED at `bed36d0`, deck clean

One voyage carried: the latest-stable dep wave (Cucumber 13, c8 12, TS7 gate green after the 006
ts-morph port), the four harbour-ruled checks (catalog key join both directions, loud-fail render
with the `!` driven out of `src/lib/messages.ts`, once-per-run ambient provisioning, ARCHITECTURE.md
pinned), and the `start.vercelSigninIncomplete` cut (catalog 331). All tiers re-earned fresh on the
new rig. Boatswain custody clean; watchbill struck. Push ordered by dk: catalog + harbour + upgrades
together.

Measured tier times on the new rig: @logic 192 scenarios 3m22s; @sandbox light 15 3m28s; @sandbox
heavy 41 serial 37m20s; @eval 4 9m36s. The once-per-run fix already halved light and eval.

## NEXT: THE SPEED VOYAGE (dk-ruled, author immediately)

dk: a month of stagnation; suite cost kills iteration; full regression MUST fit 20 minutes, 10 the
real target. Budgets are dk's ruling, now upstream skill law (shipshape 0.13.29): budget values in
RIGGING `## Tiers`, breach reds via derived check reading the weather record.

Design, all dk-ruled:
1. **Licensed spend.** The heavy tier's 41 full pipelines violate the Verification agreement's own
   reuse rule. Licence by tag: `@creates-env` keeps its licence; tag the 2 or 3 true end-to-end
   proofs (pick by reading tags: 027 interactive full start, the 002 e2e candidate). Spend recorded
   by PATH-shim ledger (025's idiom) with per-scenario attribution via hook-set env var; a derived
   join reds an unlicensed toolchain spawn, a twice-provisioned resource class, and a missing ledger.
   Planted-red proof at adoption.
2. **Strategy: invariant-first, smallest change.** Do NOT hand-respec 41 scenarios. Author the
   invariant + tags + budgets; QM restructures SUPPORT to satisfy existing scenario text against
   shared once-per-run ambient state (shared store + one shared pipeline's artifacts). Only where
   scenario TEXT itself mandates a fresh full run does Captain respec (state-over-navigation), on
   QM's named blocker.
3. **Golden-capture eval.** Rewrite 025's live-by-design Rule: the agent stays live (fixed baseline
   model, never changed); Jolly's side becomes golden-capture spies recorded mechanically from real
   @sandbox runs, re-verified at harbour; `@exceptional-double` ground three. Real end-to-end proof
   lives only in the licensed pipelines. Eval drops to agent-turns time.
4. **Budgets in RIGGING** under the 0.13.29 shape: plain `budget` 20m for the regression,
   tier-suffixed values sized to the restructured tiers. Captain writes them with dk's numbers
   (write-scope exception, dk ruled 20/10). Target arithmetic: 3.5 + 3.5 + ~9 pipelines + ~4 eval
   is under 20 serial; 10 needs tier overlap, which is hardware, not methodology.

After the speed voyage: PRODUCT voyages only. Methodology gets touched only when it removes cost.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a stronger or different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly` copy or
the `/setup` page). dk has run many successful tests on exactly this model. If this ever needs to
bind QM, it becomes a `.feature` scenario, never a note and never a memory.

## Upstream (~/shipshape, dk: edit directly, no ceremony)

- `0.13.29` committed: Budgets subsection + licensed-spend rule in the Verification agreement,
  `budget`/`budget-<tier>` in the rigging shape, seventh derived check. Skill-only safe; nothing
  plugin-dependent. Constraint standing: skill-only baseline, open-plugin compatible, no agent
  special-casing.
- Open design: resume-on-signal machinery. No portable async primitive in the hook surface; the one
  portable shape is a Stop/SubagentStop hook blocking on a detach-marker file, but it fights hook
  timeouts on 40-minute runs. Own work item in the shipshape repo. This session hand-carried the
  loop six times; the case is made.
- Blockers-first handoff is ALREADY upstream (shipshape SKILL.md Role transitions): retire the stale
  AGENTS.md local addition at next harbour (AGENTS is Shipwright's).
- Boatswain dead-code duty diverges by design (upstream: report and defer to harbour; local: remove).
  dk to rule someday; no urgency.
- Jolly still runs the 0.13.28 install; update via the AGENTS.md install line at the next session
  boundary so the budget shape is in the loaded skills.

## Fresh-VM fitting-out (git-invisible, manual)

0. `~/.claude/settings.json` = `"autoMemoryEnabled": false` (Article-7 vector; dk ruled global).
1. `npm ci`; confirm `node_modules/.bin/cucumber-js` resolves to `@cucumber/cucumber` (public-npm
   placeholder exits 0 = false green).
2. `.env`: `JOLLY_SALEOR_CLOUD_TOKEN` + `HARNESS_OPENROUTER_API_KEY`.
3. `vercel login` (operator, browser).
4. `gh auth setup-git`.

## Held product rules

- Stripe keys stay the human's: Jolly installs the app and points at the Dashboard.
- `.env` org is 100% cannon fodder, cap 2 environments; delete a fresh account's default store.
  `jolly-cannon-fodder-` prefix is the only safety boundary; never widen.
- Shared-store transient death self-heals next invocation; retry a heavy 404 ONCE.

## For next harbour (report-only, re-derivable)

- 16 zero-usage step definitions (two at `006-npx-cli-command-surface.steps.ts:502,521`).
- RIGGING measurement prose drift: 986 -> 1006 step defs, conformance family 48 -> 51 (Shipwright).
- Still no derived check joining RIGGING `## Dependencies` to `package.json` (RIGGING records it).
- `AGENTS.md:92` happy-dom claim stale; `runtime: node@20` publishes one runtime for two.
- `report.html`/`report.json` tracked but are wake.
- Shared-store mid-run death: generation-keyed fixture (QM, this voyage) fixed the follow; the
  AGENTS.md pre-run validate/refresh demand still lacks a mid-run gate.
- Spawn-target test (dist vs src) for the @logic slow cluster: likely moot if the speed voyage's
  budgets hold; measure only if @logic misses its budget.

## Standing rules, learned the hard way

- NEVER quote these notes to another role; give the command that answers, never the note.
- Grep is an opinion; run the join. A check that enumerates a set is trusted only after you verify
  it enumerated the set.
- Never let anything follow a verification run in the same command; the summary line is the
  evidence, the exit code is hearsay.
- `pgrep -f` matches its own command line; kill by task ID.
- Interactive-path changes verify through `features/support/pty.ts` `runUnderPty`.
- `--max-old-space-size=4096` on this 7.9 GB box.
- dk wants live play-by-play; never poll a dispatched agent, resume it on the observed signal.
- Do not let a remedy outrun its measurement; never let an approved plan survive a refuted premise.
- One writer at a time; dispatch thin: role and base commit.
