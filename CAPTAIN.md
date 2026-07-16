> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-16)

Fresh VM, fully fitted. **Pushed through `187c114`; `origin/main` is level.** Base for the in-flight
voyage is `4df60f7`. Harbour inventory complete: `@shipwright` = 0, `@captain` = 0, no perturbation.

**Deck is DIRTY by design** — the catalog voyage below is work in flight (Captain's assets + specs,
QM's verification, Crew's `src/index.ts`), uncommitted. Boatswain commits it with the change it orders.
Nothing here is dirt.

Last full regression (at `187c114`, before this voyage): `@logic` 187/187, `@sandbox` light 15/15,
heavy 41/41, `@eval` 3/3. **Superseded by this voyage** — current numbers in IN FLIGHT below.

## THE ONE FACT NO MECHANISM CARRIES ANY MORE

**`deepseek/deepseek-v4-flash` is Jolly's FIXED `@eval` baseline model. An eval red is an affordance
fault, never a model fault.** Never propose a stronger or different eval model; never touch
`HARNESS_EVAL_MODEL`. On any `@eval` red, fix Jolly's affordance (the `assets/skills/jolly` copy or the
`/setup` page) so even this baseline proceeds autonomously. dk has run many successful tests on exactly
this model; framing model capability as the problem is wrong and unwelcome.

This lived in Claude Code auto-memory until 2026-07-16, which is precisely why it had to be deleted —
see the auto-memory vector below. **`CAPTAIN.md` is its only home now, and that is correct: it is
Captain-side guidance, and no other role may see it.** If it ever needs to bind QM, it becomes a
`.feature` scenario, not a note and never a memory.

## Bulkhead vectors — two found on this VM, both closed

**1. `*.md` repo search (closed by machinery).** Shipshape `0.13.28`; the Bash custody hook
(`PreToolUse` → `bash-custody.sh`) is wired and verified. It discarded two QMs last session. Keep seam
hints out of these notes as discipline anyway.

**2. Claude Code AUTO-MEMORY (closed by config, 2026-07-16).**
`~/.claude/projects/-home-exedev-jolly/memory/MEMORY.md` was auto-injected into EVERY session for this
project, role sessions included, ahead of any retrieval. It carried the `@eval` baseline decision plus
rationale and a standing directive ("never suggest changing it, fix the affordance instead" /
"Blaming the model is wrong and unwelcome") — textbook Article-7 contamination: rationale and hidden
instructions crossing Captain→QM by a memory mechanism. **dk ruled GLOBAL, not per-project** (the
vector is the mechanism, so close it for every project on the box): memory files deleted,
`~/.claude/settings.json` = `"autoMemoryEnabled": false`.

**The lesson is WHICH QM caught it.** One QM saw the injection, reasoned "durable baseline fact, not
Captain discovery", declared context clean, and sailed. A later QM saw the same bytes and refused
before its entry retrieval. The first was wrong. **The bulkhead is about the MECHANISM, not about
whether the injected content looks harmless — an injected fact reads as harmless exactly when it is one
you already agree with.** The memory that broke it was true, useful, and already written down in the
right place. That is what made it slip past.

**Fresh-VM fitting-out is manual and git-invisible — five gaps a `git pull` cannot restore:**

0. **`~/.claude/settings.json` = `"autoMemoryEnabled": false`.** Lives OUTSIDE the repo, so **no repo
   change can ever carry it** — un-ignoring `.claude/` would not help and is not the fix. Without it a
   fresh VM re-enables auto-memory and **re-breaks the bulkhead silently**. Set it FIRST on any new VM,
   before dispatching a role. Verify:
   `node -e 'console.log(require("/home/exedev/.claude/settings.json").autoMemoryEnabled)'`
1. `npm ci` (node_modules git-ignored). **Trap:** on an uninstalled tree, `npx cucumber-js` falls
   through to a dependency-confusion **placeholder on public npm that exits 0** — a false GREEN across
   every tier. Always `npm ci` first and confirm `node_modules/.bin/cucumber-js` resolves to
   `@cucumber/cucumber` before trusting any run.
2. `.env` (git-ignored). Needs `JOLLY_SALEOR_CLOUD_TOKEN` (new staff token per VM) +
   `HARNESS_OPENROUTER_API_KEY`. Eval model/provider default fine (`deepseek/deepseek-v4-flash` /
   `openrouter`). Absent creds fail loudly by design (live-by-design), not skip.
3. `vercel login` (operator, browser; session lives in Vercel's own store, not `.env`).
4. **`gh auth setup-git`.** `gh` is authenticated but `origin` is https with no credential helper, so
   `git push` dies on `could not read Username for 'https://github.com'`. One command fixes it.

## THE CATALOG MIGRATION — spec work COMPLETE, awaiting custody (base `4df60f7`)

**Done (2026-07-16), one voyage, two QM passes.** QM wrote the checker
(`features/support/copy-catalog-conformance.ts`, ts-morph, type-keyed); Crew wired **all 274 sites** in
`src/index.ts`, rendered copy byte-identical. Captain authored **15 keys → catalog 332** for the
condition-selected branches. **Watchbill SPENT, both watches green:** watch1 green; `@logic` swept
**188 scenarios / 1093 steps, all pass** (independently re-confirms watch1). `step-usage` exit 0.
**Next: Boatswain custody.** Boatswain strikes `watchbill.json` with the custody commit.

The "12 conditional-COPY sites" prediction was right and the checker reddened exactly there. Disposal:
**a key per branch, nested via `cliMessage` into the parent's placeholder**. The precedent was already
in the catalog — `start.storefront.check.storefrontPrepared.gitInitExit` = `"git init exited {status}"`;
the clone and install siblings were simply missed. Every value **DERIVED from the AST by script, never
hand-typed**; the script refused to overwrite any existing key; existing values byte-unchanged.

**BEFORE OUTBOUND — two tiers carry NO green evidence at this deck state. This is the gate:**

1. **37 `@sandbox` scenarios are unrun and they assert the exact copy surface this voyage rewrote.**
   QM joined `@planks` through `step-usage`: the touched seams carry 199 plank patterns (0 stale),
   binding 145 scenarios — 108 `@logic` (green), **37 `@sandbox` (unrun)**. Example:
   `027-interactive-cli-experience.feature:A completed interactive start closes by naming the live store
   and the remaining human step`. Outside the watchbill by design, so QM named them rather than running
   them; the watchbill is the only channel that creates QM targets.
2. **`@eval` run-record entries are VOID.** They sit at hash `059fcb947fbb`; the deck moved to
   `20b3185106cd`. Any difference voids an entry — that is the whole invalidation rule. Worse,
   `features/support/eval.ts` and the 025 steps are **touched support**, which per the Planking
   agreement selects that tier's **enumeration sweep**, not a focused re-run.

**The route is HARBOUR, not a bare rerun** — it pairs the full regression with coverage triage and the
economy audit, which is what makes a whole-suite run worth its cost. A copy migration that rewrote 274
user-facing sites, with 37 scenarios asserting that surface unrun, should not ship on `@logic` alone.

**Two checker holes QM found and closed — both were false GREENS. Remember the class:**

1. A **property-only walk misses shorthand.** `{ code, message, remediation }` where `remediation` is a
   local const of conditional prose is inline copy the check cannot see. Three sites hid there,
   including a condition-selected `summary` at `3167` that no enumeration had ever listed.
2. **Prose-vs-data needs the Rule's own discriminator, not a word test.** A template reached through a
   named intermediate (`` `${cloudApiBase()}/organizations/` ``, `` `jolly ${path} [...]` ``) is
   construction and stays in code; a template a condition SELECTS is copy.

Closing hole 1 moved the count UP, 14 → 20. **A check that only ever gets easier to pass is the one to
distrust.**

**Per-site keys stay** over one shared key: identical copy at two sites is often coincidence, and
merging drags one command's future copy edit into another's. **Hand-typing copy corrupts it** — three
values were silently paraphrased that way before a mechanical derivation caught them. Derive values
from the AST; only NAME keys by hand.

## `@captain` skeletons: NONE (both promoted 2026-07-16)

- `user-facing-copy-from-catalog` — promoted; the voyage above.
- `025` baseline-agent budget — **dk confirmed turn 20 / token 400k**; promoted, steps written, green.
  Ceilings are shape-grounded, not measured. QM's `findBudgetBreach` names the TURN that crossed, which
  is the finding the Rule asks for.

## OPEN — needs dk's ruling

**Feature `025`'s Rule "Opt-in, outside the default worklist"** says the eval "never gates normal
green/red CI" and "runs only through an explicit `eval` profile / command, on demand". `AGENTS.md` and
`RIGGING.md` both say the opposite: `@eval` is "a required green/red gate that MUST run and pass; never
skipped". Reconcilable only by reading "CI" as the default profile — the eval IS excluded there and IS
required at the full-tier boundary — but the Rule's wording invites the reading that a red eval is
tolerable, which is exactly what the fixed-baseline-model policy above denies. **The Rule is Captain's
to fix; `AGENTS.md`/`RIGGING.md` are not.** Raised with dk 2026-07-16; not yet ruled.

## Held product rules

**Stripe keys stay the human's.** Jolly only installs the Stripe app and points the human to the
Dashboard for keys — never promote copy reading as Jolly handling keys. (`005:23` was disposed
supersede-and-delete; siblings 13/37/46 bind the Stripe gate.)

## The account

`.env` org is 100% cannon fodder, nothing of dk's. Cap is **2** environments. A fresh Saleor account
ships with a pre-provisioned default store lacking the `jolly-cannon-fodder-` namespace, so reclaim
rightly refuses it and it squats a slot. **Operational: delete the default store before handing an
account to Jolly.** The `jolly-cannon-fodder-` prefix is the suite's only safety boundary — never widen
it to "delete all but the shared store". dk ruled: keep it.

**Shared-store transient death is real and self-heal handles it.** A freshly-provisioned shared store
can pass its readiness probe then die (free-tier infra), 404ing recipe/stock.
`probeEndpointConnectivity` (a real `{ __typename }` query) correctly reads a 404 store as unreachable,
so a re-run deletes the dead marker store and provisions a fresh one. If a heavy run 404s on the shared
store, retry ONCE; it self-heals. A second failure is a real defect.

## Open items (report-only; re-derivable next harbour)

- **16 orphaned step definitions** (`002`, `006`, `012`, `027`, `shared`). Dead verification support.
- **`start.vercelSigninIncomplete`** is the one catalog key of 332 with no reference in `src`/`bin`.
  Pre-existing, not introduced by the migration. Dead asset content: either wire it or cut it at
  harbour. Left standing mid-voyage deliberately — it is not this voyage's work and cutting it would
  add an unverified change to a tree about to take custody.
- **Hunk authorship is unverifiable by command.** The tree yields only the diff against base; nothing
  attributes a hunk to a role. A QM asserted otherwise this voyage, then retracted. If a report claims
  "Crew wrote X", ask which command answered that.
- Tautological assertion in `025` steps: a per-entry loop checks strings its own array produced; the
  `deepEqual` below it is the real proof. Delete the loop, loses nothing. (Unverified read; QM edited
  that file this voyage, so re-locate it rather than trusting a line number.)
- Fail-fast capacity: at cap with nothing reclaimable, `BeforeAll` should name the squatter in seconds,
  not burn scenarios. Not yet engineered.
- `report.html` / `report.json` tracked in git — they are wake, belong in `.gitignore`.
- `happy-dom`: unused devDependency, zero source refs, `locked` policy.
- `src/index.ts` at ~5,900 lines / ~98 functions. Standing, un-perturbed by dk's call.
- Owed to Shipwright: `RIGGING.md` `step-usage` prose says `Measured: 972 step definitions`; re-measure
  at harbour. Cosmetic (parser reads only the backticked command). Captain does not edit RIGGING.
- Verification economy (harbour audit target): `@logic` interactive-start cluster ~270s / 40% of tier;
  `@sandbox` light three scenarios ~90% of tier; the two skill-install scenarios need no Saleor creds
  yet sit in the expensive tier by tag inheritance.

## Standing rules, learned the hard way

- **A check that inspects shape rather than value is not a check.** When you write a guard, ask what
  live counterexample still passes it.
- **Never let anything follow a verification run in the same command.** Not a pipe (`| tail`), and not
  a trailing `; echo "EXIT=$?"` — both report the LAST command's status, not cucumber's. The `echo`
  variant bit a QM on 2026-07-16: the harness announced **exit 0 over a red `@logic` sweep**, and only
  foreknowledge that the target was red caught it. Redirect to a file, run nothing after, read the
  summary line. **The summary line is the evidence; the exit code is hearsay.**
- **Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.**
- **`--max-old-space-size` sits well below physical RAM** (4096 on the 7.9 GB box; 8 GB OOM-killed).
- **dk wants live play-by-play.** A silent background run reads as dark. Narrate what is in flight;
  never poll a dispatched agent to learn whether it has finished — its report is the only signal.
- **One writer at a time**, and **dispatch thin** — role and base commit; the artifacts are the hand-off.
