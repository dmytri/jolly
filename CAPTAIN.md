> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## NEW-VM HANDOFF (2026-07-15) — read first

Session was cleared and moved to a fresh VM. All work below was committed and pushed to `origin/main`
before the move, so a `git pull` restores it. Nothing is stranded in the old VM's tree.

**First actions on the new VM:**
1. **Install Shipshape** so the Bash custody hook is present (the bulkhead is only mechanically enforced
   when the plugin is installed — the hook is VM-local, not in the repo). Install lines are in `AGENTS.md`.
   Two QMs were contaminated earlier this session before the hook existed; do not work internal roles
   without it.
2. **`vercel login`** (operator, interactive, browser approval). The new VM has no Vercel session. This
   gates the 6 environmental reds below. No code change fixes them; they go green once the session exists.
3. Then finish harbour: re-run the 6 environmental scenarios to confirm green → full regression green →
   harbour complete. Only then open a feature voyage.

**Harbour work DONE this session (committed + pushed):**
- **npm cache bug** — `packAndInstallJolly` used `--offline`; now `--prefer-offline` (installs the same
  real package, permits a cold-cache fetch). Both `006` targets green.
- **Bulkhead self-enforcing** — 2 custody-hook conformance checks now executable against the real plugin
  hook (`command-custody-hook.steps.ts`), both green. Promoted from skeletons.
- **Plank form corrected** — `methodology-conformance.feature` now pins Shipshape's step-definition
  PATTERN contract; 67 planks migrated to pattern form across 7 files (green, idempotent, typecheck clean).

**The 6 environmental reds (need `vercel login`, not code):** 3 `@logic` PTY Vercel-signin spinners
(020, 027 x2), 2 `@sandbox` doctor `vercel-auth: fail` (014), 1 `@sandbox` heavy deploy `pending`.
Root cause: dead Vercel session on the OLD VM (`npx vercel whoami` hung). Code is correct.

**PENDING VOYAGE — the catalog migration (dk wants this; re-held `@captain`, NOT lost):**
- The `user-facing-copy-from-catalog.feature` `@property` scenario ("Every user-facing string the CLI
  prints resolves through the message catalog") is re-tagged `@captain` because the migration is too big
  to finish while wrapping up. dk RULED "do it now, verbatim lift" — that intent stands; only the timing moved.
- **Real scope: ~170 catalog keys / 94 rewrite sites, ALL in `src/index.ts`.** Every command's `message`,
  `remediation`, and `description` prose. Determinate rule (chosen, no field exemptions — simplest honest
  checker): every `message`/`remediation`/`description` string resolves through `cliMessage`.
- **The site→key mapping is re-derivable** from `src/index.ts` (pushed). Re-run a general-purpose
  extraction: enumerate every string literal on `message`/`remediation`/`description` not already in a
  `cliMessage(...)` call; split conditionals into two entries; represent `${expr}` as `{placeholder}`;
  propose dotted keys by command family (`login.*`, `create.*`, `doctor.*`, ...) extending the existing
  47 keys. The scratchpad mapping from this session is on the OLD VM and gone; re-extract.
- Sequence: Captain authors `cli.json` (asset) + rewrites the scenario to the determinate surface + a
  watchbill entry → QM writes a ts-morph "no inline prose literal" checker → Crew rewires the 94 sites,
  value-matching each literal to its `cli.json` key. Verbatim lift = low conceptual risk, high volume.

## Regression evidence (2026-07-15, pre-watch-work)

Full regression ran COMPLETE. Weather records: `@logic` 174/179, `@sandbox` light 13/15, `@sandbox`
heavy 35/36, `@eval` 3/3. **All 8 reds were environmental, none Jolly:**

- **6 reds = the Vercel session is dead** (`npx vercel whoami` hangs). 3 `@logic` PTY spinners hit
  the 150s ceiling on "approve the Vercel sign-in", 2 `@sandbox` doctor `vercel-auth: fail`, 1 heavy
  deploy `pending`. Fitting-out blocker, operator-run login. GATES the re-run of those 6.
- **2 reds = the npm `--offline` bug.** `packAndInstallJolly` (`006...steps.ts:109`) passes
  `--offline`, reasoning the package has no runtime deps — but `@bomb.sh/args` IS one, so those two
  scenarios pass only on a warm npm cache and red cold with `ENOTCACHED`. Verification debt, QM's.

`@eval`'s credentialed path is now PROVEN at this deck (3/3, live agent). Open question closed.

**Ruled by dk:**

- **The two hook skeletons PROMOTE** (verification-only, no production seam, so no plank owed; promote
  at review; owe a planted-red proof; they assert hook deny/permit deliberately — a step definition
  naming the notes file directly would be blocked by the guard. Expect that trap).
- **Plank form: Shipshape's step-definition PATTERN governs, not feature step text.** This repo's
  `methodology-conformance.feature:46` currently pins the wrong contract (joins against feature step
  TEXT); 402 planks green under it, but 67 violate Shipshape's form, incl. 7 embedding Outline
  placeholders like `<command>` that can never name anything stable. Work, all harbour-scoped:
  1. Captain rewrites `methodology-conformance.feature:46` to join planks against step-definition
     patterns via `step-usage`. (Spec edit — mine.)
  2. QM fixes `features/support/plank-conformance.ts`: the `PLANK_TOKEN = "@planks"` substring sees
     `@planks-provisional` but `stepTextOf` only matches `@planks(`, so a provisional plank is seen-
     and-fails-to-parse. That is why zero provisional planks exist — they are unsatisfiable. QM's
     checker fix unblocks the planking pass. (Blocker 2.)
  3. Crew rewrites the 67 non-conforming planks to the pattern form.
- **Harbour finishes FIRST.** No feature voyage until inventory complete + regression green.

**Corrections to Shipwright's report (verified):** its tier table is stale (regression IS complete,
above); its `025`-skeleton-has-no-tier-tag warning is WRONG — `025` carries `@eval` at FEATURE level
(line 1), so the skeleton inherits it.

**Skeleton dispositions (ruled by dk this session):**
- 2 hook deny/permit (`methodology-conformance.feature`) — PROMOTED + GREEN this session.
- `user-facing-copy-from-catalog.feature` catalog `@property` — dk ruled promote/verbatim-lift, but
  RE-HELD `@captain` for the wrap-up. It is the PENDING VOYAGE in the handoff above (~170 keys/94 sites).
- `005-stripe-checkout-setup.feature` Stripe gate — HELD `@captain`. dk: "for stripe we currently only
  install the app, we don't have any keys." Jolly installs the Stripe app (Saleor `appInstall`); the
  "keys-and-channel gate" is a NEXT-STEP message pointing the human to the Dashboard, not a Jolly action.
  Do not promote a scenario that reads as Jolly handling keys. Its copy is still in-scope for the catalog voyage.
- `025` baseline-agent budget — HELD `@captain`. Needs turn/token ceiling VALUES from dk. Inherits `@eval`.

**Deferred to next harbour (report-only, re-derivable):** 16 orphaned step definitions (002, 006, 012,
027, shared); the PTY verification-economy (3 reds burn ~453s/31% of `@logic` producing nothing; top 12
= 61% of tier); the two generic `` the agent runs `<command>` `` plank attributions on `parseArgs`
(src/index.ts:190) / `projectDir` (:493) — defensible either way, a single representative pattern per
generic seam is a valid smaller alternative.

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
