> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-14, harbour, mid-flight)

Base commit `0fd5ce9`. npm still at `@dk/jolly@0.12.4`; nothing outbound. Tree is DIRTY with harbour work: `RIGGING.md` refit, spec edits, `watchbill.json`. Uncommitted by design, work in flight.

Harbour is INCOMPLETE. Do not open a feature voyage. Owed: the planking pass and `@captain` skeletons for uncovered seams, and `@eval`, which has not run this harbour. No `@shipwright` condemnations stand.

Board: `@logic` 177/177 green. `@sandbox` light 15/15 green. `@sandbox` heavy 36/41, five red. `typecheck` and `gplint` clean.

## The account, corrected

`.env` carries org `jollystores-organization`. It is **100% cannon fodder** — nothing of dk's lives in it. Cap is **2** environments.

A fresh Saleor account ships with a **pre-provisioned store**. This one arrived with `jollystore's Environment` / `store-hqdxy4uo`, which carried no `jolly-cannon-fodder` namespace, so reclaim rightly refused it, and it squatted a slot forever. Six create-an-environment scenarios starved on `ENVIRONMENT_LIMIT_REACHED`, ~9 minutes each. Deleted 2026-07-14.

**Operational, not a code fix: delete the default store before handing an account to Jolly.** The `jolly-cannon-fodder-` prefix boundary MUST NOT be widened to "delete all but the shared store". That boundary is the suite's only safety property — the thing that makes it safe to point at any account. dk ruled: keep it.

## The five heavy reds — all verification, none are Jolly

1. **Region-blind URL assertions (3).** Five copies of `/https:\/\/[a-z0-9-]+\.saleor\.cloud\/(graphql|dashboard)\//` in `002` and `027` step definitions. The class cannot cross a dot, so it never matches `<label>.eu.saleor.cloud`. Jolly emits the right URL. Passed on the old account because its domains had no region segment.
2. **The shared-store cache does not exist (2).** `AGENTS.md`, `RIGGING.md`, and `provision.ts`'s own comments all promise a store cached across cucumber invocations. The marker path is keyed by `runId()`, which is fresh per invocation, so the cache has NEVER been hit: every run provisions a new store and its `BeforeAll` reclaim deletes the previous run's. It also self-destructs mid-run, which is what 404'd `jolly recipe` and `jolly stock`. Either make the cache real (the Verification agreement's reuse rule favours it, and the docs already promise it) or strike the claim and accept per-run cost. Recommendation: make it real.

## Verification economy — first honest data this project has had

The wake was fiction until this harbour. Every per-scenario cost below is measured.

- `@logic`, 664s: the **interactive-start cluster** is ~270s over seven scenarios (36-42s each), 40% of the tier, paid on every inner-loop run. This is the real target.
- The ~5-minute Cloud-error scenario the old notes flagged **does not exist**. Nothing in `@logic` exceeds 42s. The notes were wrong; the record is right.
- `@sandbox` light, 495s: three scenarios are 90% of it (172s, 168s, 108s). The two skill-install scenarios need **no Saleor credentials** by their own admission — they are in the expensive tier by tag inheritance, not need.

## Open decisions for dk

- Fail-fast capacity blocker: when the org is at cap with nothing reclaimable, `BeforeAll` should say so in seconds and name the squatter, instead of six scenarios burning 45 minutes. Not yet ruled.
- `report.html` / `report.json` are TRACKED in git. They are wake and belong in `.gitignore`.
- `happy-dom`: unused devDependency, zero source references, `locked` policy.
- Tier placement of the two 170s skill-install scenarios.
- `src/index.ts` at 5,867 lines / 98 functions. Standing, un-perturbed by dk's call.

## Standing rules, learned the hard way

- **A check that inspects shape rather than value is not a check.** Six found so far. The latest: the wake-record invariant was green for the life of the project while NO tier wrote a record — it built its own fixture run and read that. When you write a guard, ask what live counterexample still passes it.
- **Never pipe a verification run through `tail`.** The shell reports the pipe's exit code, not cucumber's. Three tier runs this harbour reported "exit 0" while red. Redirect to a file and read `$?`.
- **Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.** 0.12.1 and 0.12.2 both shipped "verified" and both were broken.
- **`--max-old-space-size` must sit well below physical RAM.** The rigging asked for 8 GB on a 7.9 GB box; the OOM killer took the heavy tier. Now 4096.
- **dk wants live play-by-play.** Poll and report each tick; a silent background run reads as running dark.
- **One writer at a time**, and **dispatch thin** — role and base commit; the artifacts are the hand-off.
