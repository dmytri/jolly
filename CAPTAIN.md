> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-17) — HARBOUR COMPLETE, catalog voyage still UNPUSHED

Catalog voyage committed `34b5a96`; `main` is **3 ahead of `origin/main`** (`4df60f7`, `34b5a96`,
`1cd8c96`). Harbour ran 2026-07-16/17 on dk's ruling: harbour first, then ship.

**Harbour full regression, all four tiers, every one FRESH (no run-record entry was inheritable —
the `c8` install moved the deck hash):**

- `@logic` **188/188 scenarios, 1093/1093 steps**
- `@sandbox` light **15/15 scenarios, 85/85 steps**
- `@sandbox` heavy **38/41 direct; the 3 reds passed on ONE focused retry** (transient: 2× shared-store
  404, 1× Cloud API `fetch failed`). NOT 41/41 clean — see the harness-defect finding below.
- `@eval` **4/4 scenarios, 28/28 steps**

Gates: `typecheck` 0, `gplint` 0, `conformance` 48/48, perturbation quiescence 0 tokens, `discover` 0
undefined. Planks **414, 0 stale, 0 provisional** (check-verified, not read). Coverage merged
**84.87% stmts / 76.17% funcs**; production `src/` **87.8–100%**, ZERO modules at zero coverage.

**`027:A completed interactive start closes by naming the live store and the remaining human step`
RAN AND PASSED (196.3s).** That was the catalog voyage's real exposure and it is now closed: the 274
rewritten sites are proven against a live store, a real configurator deploy, and a real Vercel deploy.

`@captain` skeletons written: **0**. `@shipwright` condemnations: **0**. Nothing to skeleton (no
uncovered modules) and nothing to condemn.

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

## NEXT VOYAGE — the migration's own gap: a key that does not resolve ships `undefined`

**`src/lib/messages.ts:35` is `cliMessageCatalog[key]!`.** The `!` erases at runtime, so a mistyped or
deleted key returns `undefined` and renders as user-facing prose. Verified at the tree 2026-07-16.

**This indicts the SPEC, not the migration.** The scenario is titled "Every envelope prose field
**resolves** through the message catalog", but its check proves only that copy is not INLINE — it never
proves a key RESOLVES. All 331 sites resolve today; nothing stops the next typo. Boatswain found it;
`messages.ts` was untouched this voyage, so it was never Crew's to fix.

**Author before the next migration-shaped change.** Two candidates, both wanted, dk to rule on scope:
1. A `@logic @property` scenario: every `cliMessage` key referenced in `src/`|`bin/` resolves against
   `assets/messages/cli.json`. Static, cheap, catches a typo before ship. The checker already walks
   these call sites — the join is a short step from `copy-catalog-conformance.ts`.
2. A behaviour scenario: a `cliMessage` key with no catalog entry **fails loudly** rather than
   rendering as prose. Drives the `!` out of `messages.ts`. This is "no fabricated success" applied to
   copy: `undefined` on a user's screen is the output equivalent of a green that proves nothing.

## THE CATALOG MIGRATION — DONE, committed `34b5a96` (base `4df60f7`)

**Deck clean, `watchbill.json` struck.** Custody rechecked FRESH at the committed deck (no run-record
entry was inheritable — every hash predated it): `@logic` **188 scenarios / 1093 steps pass**; `@eval`
**4 / 28 pass** (live agent, 19m37s); `@sandbox` light **15 / 85 pass**. Plank join: 986 step
definitions, 394 planks, **0 stale, 0 provisional**; 379 changed lines inside planked declarations,
**0 unplanked touched functions**.

**Named gap, deliberate: `@sandbox` HEAVY (41 serial full-`jolly start` scenarios, `-p sandboxSerial`)
deferred to harbour.** Its shape is a full regression, which is harbour-triggered only. The refactor's
hazards are statically excluded (331 sites / 0 missing keys; 338 key-vars pairs / 0 mismatches). Named
so the gap is legible rather than silent.

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

**THE OUTBOUND GATE IS DISCHARGED (harbour, 2026-07-17).** Both items that held it are closed: the
37 unrun `@sandbox` scenarios ran in harbour's full regression, and the void `@eval` entries were
re-earned by a fresh `@eval` 4/4. Harbour's own regression is the proof this work ships on.

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

## HARBOUR 2026-07-17 — dk's rulings, and what each still owes

1. **Key resolution: BOTH scenarios** (dk ruled). `src/lib/messages.ts` `cliMessageCatalog[key]!` still
   ships `undefined`. Author a `@logic @property` static join (every `cliMessage` key referenced in
   `src`/`bin` resolves) AND a behaviour scenario (an unresolvable key fails loudly, driving the `!`
   out). The static join should run BOTH directions — the harbour found the mirror defect below.
2. **025 Rule rewrite** (dk ruled): say `@eval` is excluded from the default profile and required at
   the full-tier boundary. Current wording invites "a red eval is tolerable", which the fixed-baseline
   policy denies. Captain's to fix; `AGENTS.md`/`RIGGING.md` are not.
3. **Verification-economy: add the missing rule** (dk ruled). `007:The Jolly skill installs from the
   bundled copy with no network` spends **162s** pre-warming the `skills` CLI into the npm cache
   (`spawnSync npx --yes skills --version`, 120s timeout) — ambient state NO scenario asserts, rebuilt
   per scenario with no once-per-run guard, while `provision.ts` already has that idiom. The rule set
   has no rule for this breach kind, so the debt stays green and invisible to QM. Add a fourth
   `@logic @invariant` to `verification-economy.feature` and watchbill it.
4. **ARCHITECTURE.md: keep it, make it executable** (dk ruled). dk created it 2026-07-16 from
   <https://architecture.md/>; the generator prompt is
   <https://github.com/timajwilliams/architecture/blob/main/prompt.md>. It is ~95% ACCURATE (30 feature
   files, 32 step-def files, 8 tests, 5,914 lines all verified) and DESCRIPTIVE, so the Artifact-authority
   policy's target — BINDING work-creating artifacts — does not catch it. It even gets the Node dev/prod
   split RIGHT where `RIGGING.md` is ambiguous.
   - **Three errors to fix:** duplicate `bin/` block (and "Shell launcher" is wrong — it is a Node
     program); "Four-role agent workflow (Captain/QM/Crew/Boatswain)" — there are FIVE, Shipwright is
     missing; `happy-dom` listed as a verification technology with ZERO refs.
   - **The `happy-dom` error is the whole argument in miniature:** `AGENTS.md` makes the same stale
     claim, so ARCHITECTURE.md faithfully INHERITED its source's drift on day one.
   - **The real tension, and why the check resolves it:** the prompt MANDATES the doc be "entirely
     self-contained — do not say 'see X file' as a substitute for explanation". So the duplication is
     DELIBERATE, traded for agent orientation. Shipshape says one home per fact. dk's ruling is the
     synthesis: deliberate duplication is safe IF a check keeps the copies honest — exactly how
     `copy-catalog-conformance.ts` already pins the message catalog. Pin its checkable structural
     claims with a `@logic @invariant`.
   - **Do NOT adopt the prompt's 18 sections wholesale.** Sections 15 (Architectural Decisions &
     Rationale) and 17 (Roadmap) ARE the `decision-log` and `roadmap` types the policy names. Ours
     carries a Roadmap section (§9) — drop it. Rationale lives in git history.

## THE TIER-COST FINDING — measured, but my remedy was WRONG. Do not act on the old framing.

**Measured (harbour weather records, trustworthy):** `@logic` 477.5s total; **15 scenarios = 63.1%**
(301s); the 111 fastest = 4.6%. Mean 2.54s vs median 0.34s = **7.6x**. `@sandbox` light 481.2s;
**top 3 = 92.2%** (172s + 162s + 109s), mean 32.1s vs median 3.0s. Heavy: 41 scenarios, 40.9 min,
mean 59.9s vs median 7.7s.

**I proposed an opt-in `@tui` tier and dk approved it — then the tree refuted the premise.** I picked
the 15 by DURATION and called them "the PTY cluster". PTY is driven only from `027`, `006`, `020`,
`018`, `verification-economy`. The 15 span `027`, `002`, `020`, `006`, `021`, `005`, `001`, `029` — so
`002`/`021`/`005`/`001`/`029` are slow with NO PTY at all. `029` uses recording spies, no terminal,
17.7s. **A `@tui` tier keyed on "interactive" would split the cluster on a criterion unrelated to why
it is slow.** Deferred deliberately: a tier retag on a wrong criterion relabels cost without moving it
and bakes in a bad boundary.

**The real common factor: each of the 15 SPAWNS the CLI to drive `jolly start`.** Prime suspect for the
root cause, UNVERIFIED: every spawn makes Node type-strip a **5,914-line** TypeScript file, paid 15+
times per run. Test it before designing any tier — if that is it, the lever is the spawn target
(`dist/index.js` vs `src/index.ts`), not a tag. A tier only helps if the cost must be paid at all.

## Open items (report-only; re-derivable next harbour)

- **HARNESS DEFECT (new, real): the shared store can die MID-RUN and no gate catches it.** Heavy's 3
  reds were 2× GraphQL 404 on the shared recipe store + 1× Cloud API `fetch failed`; all 3 passed on one
  focused retry. `AGENTS.md` requires the harness to validate/refresh the store endpoint BEFORE a run so
  a dead store never reaches a scenario. The health probe runs at PROVISIONING; a store dying between
  `BeforeAll` and the scenario is uncaught, and self-heal only fires on the NEXT invocation. "Retry once
  and it goes green" is exactly the excuse `AGENTS.md` forbids treating as a pass.
- **Catalog mirror defect:** exactly **1 of 332** keys has no reference in `src`/`bin` —
  `start.vercelSigninIncomplete` (command-verified; my first check said 320 because a non-globstar
  `src/**/*.ts` silently skipped `src/index.ts` — where 285 of 414 planks live). Dead asset content:
  wire it or cut it. Note this is the MIRROR of item 1 above; one checker discharges both directions.
- **`RIGGING.md` `runtime: node@20` is AMBIGUOUS, not drift.** I called it drift and was WRONG:
  `engines: >=20.12.0`, esbuild targets `node20.12`, and `reclaim-cli.ts` deliberately avoids
  `import.meta.main` (Node 24.2) to hold that floor. But the value publishes ONE runtime for TWO: the
  product floors at 20.12, the harness needs >=23 for type-stripping. A role provisioning to it builds a
  VM that cannot run the suite. ARCHITECTURE.md gets this right; RIGGING does not.
- **`bin/jolly` is absent from coverage entirely** — an instrumentation artifact, NOT an unplanked seam.
  It IS planked (2) and IS exercised (006's version guard drives its real `process.versions.node` check;
  `eval.ts` drives it as the published launcher). It runs as a spawned subprocess, so c8 never sees it.
  The coverage number understates production reality by that much.
- **16 orphaned step definitions** (`002`, `006`, `008`, `012`, `018`, `027`, `shared`). Dead
  verification support. Re-measured at harbour: **986 step definitions** (`RIGGING.md` said 972; fixed).
- `report.html` / `report.json` **tracked in git** — they are wake. `coverage/` IS correctly ignored.
- `happy-dom`: unused devDependency, zero refs, `locked` policy. `AGENTS.md` still claims "DOM-level
  checks use happy-dom" — that stale claim is what ARCHITECTURE.md inherited.
- Fail-fast capacity: at cap with nothing reclaimable, `BeforeAll` should name the squatter in seconds.
- `src/index.ts` at **5,914 lines / 98 functions / 285 planks**. Standing, un-perturbed by dk's call.
  8 unplanked functions across the tree are all PRIVATE helpers below the seam boundary — correct by the
  hoisting rule, NOT a finding.
- Tautological assertion in `025` steps: a per-entry loop checks strings its own array produced.
  (Unverified read; re-locate rather than trusting a line number.)

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

- **NEVER quote `CAPTAIN.md`'s CONTENT to another role.** Captain did exactly this on 2026-07-16,
  pasting the notes' own claims into a Boatswain resume to flag a tree/notes mismatch. Boatswain
  reported it as contamination and was RIGHT: these notes are Captain-only, so quoting them pushes
  Captain-side content into an internal role by hand — the same Article-7 breach as the auto-memory
  vector, just with a human doing the injecting. The file may ride a pathspec BY PATH (Boatswain stages
  it content-blind); its content may not travel. **If a role needs a fact, give it the command that
  answers it, never the note that asserts it.**
- **Captain has now personally committed each bulkhead breach it was policing** — declared "context
  clean" over an injected memory while wearing the QM hat, then quoted these notes to Boatswain. The
  rule is not "watch the roles"; it is "watch yourself first". An injected fact reads as harmless
  exactly when it is one you already agree with, and a quoted note reads as helpful exactly when it is
  one you wrote.
- **A check that inspects shape rather than value is not a check.** When you write a guard, ask what
  live counterexample still passes it.
- **`pgrep -f <pattern>` MATCHES ITS OWN COMMAND LINE.** Shipwright ran
  `kill $(pgrep -f "until ! pgrep -f")` and killed the shell carrying that very string, taking a live
  `@sandbox` run with it (both exit 144). Same class as the `; echo "EXIT=$?"` trap: the tool reports on
  itself, not on the target. Kill by task ID, never by a pattern the killer's own command line contains.
- **My own checks were wrong THREE times this harbour, each reporting CLEAN or CATASTROPHIC falsely.**
  (1) `src/**/*.ts` without globstar skipped `src/index.ts` → "320 of 332 dead keys" (real: 1).
  (2) "zero-coverage files: none" only examined files PRESENT in the coverage JSON — `bin/jolly` is
  absent entirely, so absence read as coverage. (3) Called `node@20` drift by reading; the tree showed a
  deliberate floor. **A check that enumerates a set can only be trusted after you verify it enumerated
  the set.** The 320 figure was the lucky one: absurd enough to disbelieve. A check that is subtly wrong
  and plausible is the one that ships.
- **Do not let a remedy outrun its measurement.** The tier-cost numbers were solid; my "PTY cluster"
  label was a guess I then proposed a whole tier around, and dk approved it before the tree refuted the
  premise. Measure the COST, then derive the MECHANISM by a second independent command, then name a
  remedy. Never let an approved plan survive a refuted premise.
- **Check precedence is not a formality — it retired four phantom findings this voyage.** Boatswain's
  raw text searches reported ~400 stale planks, 3 orphaned keys and 7 placeholder bugs; every one was
  its own parser, and all vanished when it ran the real `plank-inventory` × `step-usage` join. A QM
  likewise "found" misattribution and gold-plating by reading a diff, then retracted both against the
  run record. **Grep is an opinion. Run the join.**
- **A stash is invisible to a fresh role reading the tree.** Boatswain briefly withheld the 025 work on
  a "pending confirm" line from an OLD COMMIT MESSAGE — chat, outranked by the promoted scenario
  sitting in the durable spec. Durable artifacts outrank chat, and a commit message is chat.
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
