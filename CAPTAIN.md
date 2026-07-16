> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-16)

Fresh VM, fully fitted and **full regression GREEN**. Harbour complete. HEAD `98bf2ad`, **2 commits
ahead of `origin/main`, unpushed** (notes `a4280fe` + harbour `98bf2ad`) — pushing is Captain outbound,
not yet approved. Green tiers: `@logic` 187/187, `@sandbox` light 15/15, heavy 41/41, `@eval` 3/3.

Harbour inventory complete: `@shipwright` = 0. Two `@captain` skeletons remain (held, below) — they do
NOT block a feature voyage.

**Eval affordance fixed and shipped (2026-07-16).** The `@eval` gate was flaky because
`assets/homepage/setup.md` told the agent to "first thing, ask the human whether they have [an
account]" — a proactive pre-ask the agent obeyed and then halted on (0 Jolly commands → red). Fixed:
the "What needs your human" section now leads with "I start with `jolly start`... never pause up front
to ask", and the account rides the Saleor sign-in (the only moment Jolly surfaces it). Committed
`98bf2ad`, homepage redeployed to `jolly.cool` (aliased), published `/setup` byte-matches the shipped
file, default `@eval` gate 3/3 green against `jolly.cool/setup`. **deepseek-v4-flash is the fixed
baseline model — an eval red is an affordance fault, never a model fault.**

**Bulkhead now mechanically enforced on this VM.** Shipshape `0.13.28` installed; the Bash custody
hook (`PreToolUse` → `bash-custody.sh`) is wired and verified. The `*.md` repo-search contamination
vector that discarded two QMs last session is closed by the hook. Keep seam hints out of these notes
as discipline anyway.

**Fresh-VM fitting-out is manual and git-invisible — three gaps a `git pull` cannot restore:**
1. `npm ci` (node_modules git-ignored). **Trap:** on an uninstalled tree, `npx cucumber-js` falls
   through to a dependency-confusion **placeholder on public npm that exits 0** — a false GREEN across
   every tier. Always `npm ci` first and confirm `node_modules/.bin/cucumber-js` resolves to
   `@cucumber/cucumber` before trusting any run.
2. `.env` (git-ignored). Needs `JOLLY_SALEOR_CLOUD_TOKEN` (new staff token per VM) +
   `HARNESS_OPENROUTER_API_KEY`. Eval model/provider default fine (`deepseek/deepseek-v4-flash` /
   `openrouter`). Absent creds fail loudly by design (live-by-design), not skip.
3. `vercel login` (operator, browser; session lives in Vercel's own store, not `.env`).

## PENDING VOYAGE — the catalog migration (dk ruled "do now, verbatim lift")

The `user-facing-copy-from-catalog.feature` `@property` skeleton ("Every user-facing string the CLI
prints resolves through the message catalog") is held `@captain` only for timing; the ruling stands.

- **Scope: ~170 catalog keys / 94 rewrite sites, all in `src/index.ts`** — every command's `message`,
  `remediation`, `description` prose. Determinate rule (no field exemptions): each such string resolves
  through `cliMessage`.
- **Re-derivable** from `src/index.ts`: enumerate every string literal on `message`/`remediation`/
  `description` not already in a `cliMessage(...)` call; split conditionals; `${expr}` → `{placeholder}`;
  propose dotted keys by command family extending the existing 47.
- Sequence: Captain authors `cli.json` (asset) + rewrites the scenario to the determinate surface + a
  watchbill entry → QM writes a ts-morph "no inline prose literal" checker → Crew rewires the 94 sites,
  value-matching each literal to its `cli.json` key. Low conceptual risk, high volume.

## Held `@captain` skeletons (need dk input; none block a voyage)

- `user-facing-copy-from-catalog` — the pending voyage above.
- `025` baseline-agent budget (`025:121`) — promotion pending dk's confirmation of the ceilings.
  Captain proposed **turn 20 / token 400k** (generous, to redden a flailing agent, not tight — per the
  scenario's own Rule; healthy run is one orchestrated `jolly start --yes --json` + a handful of turns).
  Exact token usage is not persisted, so the ceilings are shape-grounded, not measured. On confirm:
  write the values, remove `@captain`, promote as its own small voyage (its new steps need QM). Inherits
  `@eval` at feature level — keep method checks in `methodology-conformance.feature`, not here.

`005:23` (keys-and-channel gate) was DISPOSED this session: dk ruled supersede-and-delete (siblings
13/37/46 bind the Stripe gate); removed in `98bf2ad`. The held-copy rule still stands for the catalog
voyage: Jolly only installs the Stripe app and points the human to the Dashboard for keys — never
promote copy reading as Jolly handling keys.

## The account

`.env` org is 100% cannon fodder, nothing of dk's. Cap is **2** environments. A fresh Saleor account
ships with a pre-provisioned default store lacking the `jolly-cannon-fodder-` namespace, so reclaim
rightly refuses it and it squats a slot. **Operational: delete the default store before handing an
account to Jolly.** The `jolly-cannon-fodder-` prefix is the suite's only safety boundary — never widen
it to "delete all but the shared store". dk ruled: keep it.

**Shared-store transient death is real and self-heal handles it.** This session, 029 recipe/stock 404'd
because the freshly-provisioned shared store passed its readiness probe then died (free-tier infra).
`probeEndpointConnectivity` (a real `{ __typename }` query) correctly reads a 404 store as unreachable,
so a re-run deletes the dead marker store and provisions a fresh one. One sanctioned retry → 2/2 green.
If a heavy run 404s on the shared store, retry once; it self-heals.

## Open items (report-only; re-derivable next harbour)

- **16 orphaned step definitions** (`002`, `006`, `012`, `027`, `shared`). Dead verification support.
- Tautological assertion in `025` steps (~line 599): the per-entry loop checks strings its own array
  produced; the `deepEqual` below is the real proof. Delete the loop, loses nothing. (Unverified read.)
- Fail-fast capacity: at cap with nothing reclaimable, `BeforeAll` should name the squatter in seconds,
  not burn scenarios. Not yet engineered.
- `report.html` / `report.json` tracked in git — they are wake, belong in `.gitignore`.
- `happy-dom`: unused devDependency, zero source refs, `locked` policy.
- `src/index.ts` at ~5,900 lines / ~98 functions. Standing, un-perturbed by dk's call.
- Owed to Shipwright: `RIGGING.md` `step-usage` prose says `Measured: 936 step definitions`; command
  now reports ~967. Cosmetic (parser reads only the backticked command). Captain does not edit RIGGING.
- Verification economy (harbour audit target): `@logic` interactive-start cluster ~270s / 40% of tier;
  `@sandbox` light three scenarios ~90% of tier; the two skill-install scenarios need no Saleor creds
  yet sit in the expensive tier by tag inheritance.

## Standing rules, learned the hard way

- **A check that inspects shape rather than value is not a check.** When you write a guard, ask what
  live counterexample still passes it.
- **Never pipe a verification run through `tail`** (or any pipe): the shell reports the pipe's exit
  code, not cucumber's. Redirect to a file, read `$?` and the summary line.
- **Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.**
- **`--max-old-space-size` sits well below physical RAM** (4096 on the 7.9 GB box; 8 GB OOM-killed).
- **dk wants live play-by-play.** Poll and report each tick; a silent background run reads as dark.
- **One writer at a time**, and **dispatch thin** — role and base commit; the artifacts are the hand-off.
