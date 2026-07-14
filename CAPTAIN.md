> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Live agenda (2026-07-14, post-restart)

The custody hook is ACTIVE: the guard is on disk and this session loaded it at startup. The bulkhead
is mechanically enforced from here. Two QMs were contaminated and discarded before it landed.

**Ruled by dk this session:**

- **The two bulkhead skeletons PROMOTE.** They pin the plugin's hook, which lives outside this
  project's implementation directories, so no seam here can plank them. That is fine: they are
  verification-only conformance checks with no production seam, so no plank is owed. Promote at the
  harbour review, not before — a promoted scenario with no step definition reds Shipwright's own
  regression on undefined steps. They owe a planted-red proof. They assert hook deny/permit rather
  than search result sets deliberately: a step definition asserting "the notes file is absent from
  this result set" must NAME the notes file, and the guard would then block QM from writing its own
  step definition. Expect that trap.
- **Harbour finishes FIRST.** No feature voyage opens until the inventory is complete.

**Still owed at this harbour:**

1. The planking pass, and `@captain` skeletons for uncovered seams. Shipwright's.
2. **`@eval`'s CREDENTIALED path is unproven at this deck.** The support layer gained the `@eval`
   credential gate this voyage; the standing target proves only the credential-ABSENT path through it.
   The last credentialed `@eval` green predates that change. Harbour's full regression is what answers
   it. Do not let "eval is green" cover both halves.
3. Then the harbour review: promote the skeletons, watchbill them, dispatch QM.

## Deck state (2026-07-14, harbour, mid-flight)

HEAD `062ea63`, tree CLEAN, 19 commits ahead of `origin/main`. npm still at `@dk/jolly@0.12.4`; nothing outbound. Harbour is INCOMPLETE, so no feature voyage opens yet.

**The five heavy reds are CLOSED.** The watchbill that closed them was exactly those five plus two conformance checks; all seven green, focused runs, recorded in the run record. The heavy tier has NOT been re-swept as a tier since; the evidence is per-target, which is what the Verification policy asks for.

Harbour is INCOMPLETE. Do not open a feature voyage. Owed: the planking pass and `@captain` skeletons for uncovered seams, and `@eval`, which has not run this harbour (`coverage/weather/eval.ndjson` is 07-13). No `@shipwright` condemnations stand. One `@captain` skeleton stands in `025` (baseline-agent turn/token budget); it does not block resuming.

Board: `@logic` 177/177 green. `@sandbox` light 15/15 green. `@sandbox` heavy: the five reds now green per target. `typecheck` and `gplint` clean.

## The account, corrected

`.env` carries org `jollystores-organization`. It is **100% cannon fodder** — nothing of dk's lives in it. Cap is **2** environments.

A fresh Saleor account ships with a **pre-provisioned store**. This one arrived with `jollystore's Environment` / `store-hqdxy4uo`, which carried no `jolly-cannon-fodder` namespace, so reclaim rightly refused it, and it squatted a slot forever. Six create-an-environment scenarios starved on `ENVIRONMENT_LIMIT_REACHED`, ~9 minutes each. Deleted 2026-07-14.

**Operational, not a code fix: delete the default store before handing an account to Jolly.** The `jolly-cannon-fodder-` prefix boundary MUST NOT be widened to "delete all but the shared store". That boundary is the suite's only safety property — the thing that makes it safe to point at any account. dk ruled: keep it.

## The five heavy reds — closed 2026-07-14, all verification, none were Jolly

1. **Region-blind URL assertions (3).** CLOSED. The class `[a-z0-9-]+` cannot cross a dot, so `https://…/graphql/` never matched `<label>.eu.saleor.cloud`. Jolly emitted the right URL throughout. Six copies corrected across `002`, `012`, `022`, `027` step definitions. Passed on the old account because its domains had no region segment.
2. **The shared-store cache (2).** CLOSED: `029` recipe and stock both green against a reused shared store. The marker keying was the fault; the cache is now hit. Watch it: if a heavy run starts provisioning a fresh store per invocation again, this is what regressed.

Both were verification-layer faults. No production seam has been touched since `0fd5ce9`.

## Verification economy — first honest data this project has had

The wake was fiction until this harbour. Every per-scenario cost below is measured.

- `@logic`, 664s: the **interactive-start cluster** is ~270s over seven scenarios (36-42s each), 40% of the tier, paid on every inner-loop run. This is the real target.
- The ~5-minute Cloud-error scenario the old notes flagged **does not exist**. Nothing in `@logic` exceeds 42s. The notes were wrong; the record is right.
- `@sandbox` light, 495s: three scenarios are 90% of it (172s, 168s, 108s). The two skill-install scenarios need **no Saleor credentials** by their own admission — they are in the expensive tier by tag inheritance, not need.

## Ruled 2026-07-14

- **`@eval` is GREEN.** 3 scenarios, 3 passed, via the configured `broad-eval`. The one red was verification again: the affordance map joins a turn's commands with `" && "`, then compared that joined string against a *single* trace record — unsatisfiable the moment the agent ran two Jolly commands in one turn, which it did. Fixed in `848dab8`.
- **RIGGING wins over the spec on credential absence.** dk ruled: a tier that skips itself when its credential is absent reports green while proving nothing. Feature `025`'s Rule prose promised SKIP-not-fail for both the eval model key and the Vercel session. Both bullets rewritten to fail loudly as a fitting-out blocker. Prose cannot fail, so the rule is now pinned by a scenario: `methodology-conformance.feature:A credentialed tier fails loudly when its credential is absent` (`@logic @invariant`, no model invoked). QM derives the rest from the spec.
- **Do NOT put a non-eval scenario in feature `025`.** The file carries `@eval` at FEATURE level, so every scenario inherits it. A `@logic` check written there lands in the paid tier it is meant to police. Method checks go in `methodology-conformance.feature`.

## Open decisions for dk

- **RIGGING `focused` cannot select an `@eval` target — a silent false GREEN.** The default profile carries `tags: "not @eval"` (`cucumber.js:29`) and cucumber ANDs profile tags with CLI tags, so `focused` on an `@eval` scenario selects **0 scenarios and exits 0**. QM established it: verbatim `focused` + `--dry-run` → 0 scenarios; with `-p eval` → 1. Any `@eval` target "proven" by `focused` was never run. Shipwright refits `focused` (or adds `focused-eval`). **Highest-value item on the board.**
- **Tautological assertion** left in `025` steps (~line 599): every string the per-entry loop checks was produced by `traceCommandLine` over a record in the same array, so it cannot redden. The `deepEqual` below it is the real proof. Delete it; the step loses nothing. Boatswain's read-judgment, labelled unverified — no derived check reaches it.
- **The bulkhead is NOT mechanically enforced. Two QMs were contaminated today (2026-07-14).** Both were discarded mid-target. The vector is an ordinary repo-wide search over `*.md`: six forms reach this file, and only a bare `rg` is excluded. No ignore-file can close it (GNU grep never reads `.ignore`; a shell glob outranks it). Only Shipshape's Bash custody hook can. **dk ruled: no plugin-cache patch here.** The proven guard and its proof harness are carried to `~/shipshape-shakedown` (`incoming/jolly-bulkhead/`, and a note in that project's `CAPTAIN.md`).
- **Therefore these notes are a live hazard, and that is Captain's to manage.** Until the hook lands: keep seam hints OUT (name the decision, never the file to change), and avoid literal tokens a role would plausibly grep for. The second contamination hit a bullet of mine carrying a credential token verbatim. Two `@captain` skeletons in `methodology-conformance.feature` make the hook's deny/permit executable; they stay unpromoted until the patched hook exists, since QM cannot fix harness config and would be permanently red.
- **Owed to Shipwright at this harbour** (from Boatswain custody, `6975aea`): `RIGGING.md`'s `step-usage` prose still says `Measured: 936 step definitions`; the command now reports **967**. The zero-usage count of 16 is still right. Nothing breaks — the parser reads only the backticked command — but the number misleads a reader. Shipwright's to repair; Captain does not edit `RIGGING.md` for this.
- **16 orphaned step definitions** in `002`, `006`, `012`, `027`, `shared`. Dead verification support, pre-existing. Harbour triage.
- Fail-fast capacity blocker: when the org is at cap with nothing reclaimable, `BeforeAll` should say so in seconds and name the squatter, instead of six scenarios burning 45 minutes. Not yet ruled.
- `report.html` / `report.json` are TRACKED in git. They are wake and belong in `.gitignore`.
- `happy-dom`: unused devDependency, zero source references, `locked` policy.
- Tier placement of the two 170s skill-install scenarios.
- `src/index.ts` at 5,867 lines / 98 functions. Standing, un-perturbed by dk's call.

## Standing rules, learned the hard way

- **A check that inspects shape rather than value is not a check.** Six found so far. The wake-record invariant was green for the life of the project while NO tier wrote a record — it built its own fixture run and read that. CLOSED in `6975aea`: the check now runs a tier command **verbatim from `RIGGING.md`** against a fixture tier, so dropping `--format message:…` from a configured command reddens it. Proven by planting exactly that. When you write a guard, ask what live counterexample still passes it.
- **Never pipe a verification run through `tail`.** The shell reports the pipe's exit code, not cucumber's. Three tier runs this harbour reported "exit 0" while red. Redirect to a file and read `$?`.
- **Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.** 0.12.1 and 0.12.2 both shipped "verified" and both were broken.
- **`--max-old-space-size` must sit well below physical RAM.** The rigging asked for 8 GB on a 7.9 GB box; the OOM killer took the heavy tier. Now 4096.
- **dk wants live play-by-play.** Poll and report each tick; a silent background run reads as running dark.
- **One writer at a time**, and **dispatch thin** — role and base commit; the artifacts are the hand-off.
