# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## HANDOFF (2026-06-14, Captain → QM): build the storefront + Vercel stages (fifth + sixth convergence) and the human-run backup — finish the all-Jolly-executable chain

**Next role: QM in a FRESH/cleared session** (Captain→QM context firewall).

**Branch/trunk note (decision 2026-06-14, customer):** this repo is **trunk-based — work on `main`, never
create feature branches**. The prior `feature/start-stock-seeding` branch was a mistake; it was
fast-forwarded into `main`, pushed, and deleted (local + remote). `main` is the only branch. Commit and
push to `main`.

**The decision (customer 2026-06-14, "get storefront/vercel into the jolly CLI"):** build the two
remaining mechanical stages so `jolly start` reaches a **deployed store end-to-end** — **both in one
cycle** (the customer chose one cycle, not storefront-then-vercel). This is the fifth + sixth
convergence; it completes the all-Jolly-executable chain `create store` → configurator deploy →
stock-seed → **storefront clone/install** → **vercel deploy**. The motivation is that a full mechanical
chain makes `jolly start` **runnable by a human in a plain shell** — the natural way to clear the
interactive gates (`vercel login`, account creation) a non-TTY agent cannot pass. **Human-run is a
BACKUP, not the headline** (homepage stays paste-first, unchanged): when the agent cannot/won't complete
`jolly start` (refuses, or any stage fails, or an interactive gate it can't pass), Jolly's output + the
skill tell the agent to **ask the human to run `jolly start` in a shell**, then start their agent to
iterate (skills already on disk from `init`).

**Specs landed this Captain pass (committed by Bosun next pass):**
- **AGENTS.md** "MVP sequencing" — fifth + sixth convergence (build storefront + vercel together) +
  the "Human-runnable `jolly start` is the BACKUP path" decision.
- **feature 002** — new Rule "Storefront and Vercel deploy are genuinely-executing stages", new Rule
  "Human-runnable `jolly start` is the backup path", and **5 new `@logic` scenarios** (storefront
  preview, storefront no-fabrication, deploy preview, deploy no-fabrication, human-run fallback
  nextStep). Default `cucumber-js --dry-run` now shows **5 undefined scenarios / 18 undefined steps**
  (all feature 002) — the intended QM marker. The existing `@sandbox` "Jolly start creates a deployable
  storefront" / "deploys to Vercel" scenarios already assert spawning.

**QM/Crew worklist:**
1. **Crew — make `jolly start` SPAWN the storefront + deploy stages** (`src/index.ts`, mirroring
   `runRecipeStage`). `runStorefrontStage()`: spawn `git clone --branch main saleor/storefront
   storefront/`, strip `.git`, `git init`, spawn `pnpm install`; non-interactive, read exit codes,
   `completed` only on real success, `blocked`/`failed` honestly, idempotent (skip an existing
   `storefront/`). `runDeployStage()`: spawn `npx vercel` / `npx vercel --prod` under the Vercel CLI's
   own session, set env vars, surface Deployment Protection, update trusted origins; honest exit-code
   reporting; **no `JOLLY_VERCEL_TOKEN`, no api.vercel.com in Jolly's code** (feature 020). Enrich both
   stages' previews in the single `startPlan()` source to name the spawned commands / `storefront`
   target dir / `saleor/storefront` `main` template / the Vercel invariants, with `dryRunAvailable`
   true (021 deep-equality preserved). Wire into the `commandStart` `--yes` path like `recipe`. Fail
   fast / no hang.
2. **Crew — human-run fallback nextStep:** when `jolly start` is `warning` (paused at a gate OR has
   blocked/failed stages — i.e. it could not run to completion), add a feature-020 `nextStep` offering
   the human-run fallback ("ask the human to run `jolly start` in a shell, then start your agent to
   iterate"). Never fabricate that the human-run step happened (integrity rule).
3. **QM — step defs** for the 5 new feature-002 `@logic` scenarios (the deterministic drivers).
   Reuse the shared `jolly start` Givens from `features/step_definitions/004-…steps.ts`. For hermetic
   no-fabrication tests, fake `git`/`pnpm`/`npx vercel` on a scenario-scoped PATH (extend
   `features/support/configurator-cli-fake.ts`'s `writeFakeNpx`, or add sibling shims) so no stage
   hits the network. The `@sandbox` storefront/deploy scenarios assert the real spawn (clone exists +
   fresh git, deps installed, deploy URL reachable) and gate on creds + the Vercel CLI being
   authenticated (`npx vercel whoami` exit 0) — no `JOLLY_VERCEL_TOKEN`.
4. **QM — fix the `@eval` step-def precision bug** (surfaced by a real eval run this Captain pass, 5m,
   model `deepseek/deepseek-v4-flash`): `features/step_definitions/025-…steps.ts` line ~286 asserts
   `status !== "success"` for **every** traced `start` invocation, but the baseline agent runs `jolly
   start --dry-run` whose preview is **legitimately** `success` (feature 001/020). Exclude `--dry-run`
   start invocations from that assertion (the no-fabrication invariant applies to the real run, not the
   preview). Everything else in the eval PASSED — the baseline agent discovered and drove Jolly
   end-to-end from just `https://jolly.cool/setup` (traced: `start --dry-run`, `start`, `start --yes`,
   `doctor --json`; all feature-007 artifacts appeared; doctor emitted the envelope). `@eval` is never a
   green/red gate; this fix just makes the affordance eval pass cleanly.
5. **Verify** — `@logic`/units/typecheck green; default dry-run back to **0 undefined**; `eval` dry-run
   0 undefined; on a creds-present + Vercel-authed VM the `@sandbox` storefront/deploy scenarios reach a
   real deployed store, and a re-run is idempotent. (`@sandbox`/`@eval` are billable — CI/creds-present.)

**Scope guard (MVP-then-iterate):** build storefront + vercel (both) + the human-run fallback nextStep +
the eval step-def fix. Do **not** change the homepage (human-run stays a backup, not a homepage entry).

---

## DONE (2026-06-14, QM+Crew+Bosun — configurator deploy GENUINELY EXECUTES): committed locally, NOT pushed

Iteration 2 / the fourth convergence (the HANDOFF below) is **complete, verified, and committed
locally** (not pushed — pushing is the Captain/customer action). `jolly start` now performs the
recipe deploy itself by SPAWNING `npx @saleor/configurator deploy` — the **first spawned-CLI stage**
to converge. All deterministic tiers green: typecheck clean, units **43/43**, `test:logic` **64/64**
(487 steps), default `--dry-run` **0 undefined**. `@sandbox`/`test:bdd` NOT run locally (billable) —
deferred to a creds-present/CI run.

**What landed:**
- **Crew — `src/index.ts`:** enriched the single-source `startPlan()` recipe-stage riskContext so the
  dry-run preview names the spawned command (`npx @saleor/configurator deploy`), Jolly's bundled
  `recipe.yml`, the store URL + app token by name only (`NEXT_PUBLIC_SALEOR_API_URL` /
  `JOLLY_SALEOR_APP_TOKEN`, values never printed), the `--fail-on-delete`/`--fail-on-breaking` guards,
  and the `--plan` dry-run mechanism (dry-run riskContext stays deep-equal to the real run, 021). Added
  `bundledRecipePath()` (resolves `assets/skills/jolly/recipe.yml` via `import.meta.url` — works in dev
  and the published `dist/` bundle) and `runRecipeStage()` (spawns the configurator non-interactively,
  reads its **exit code**: 0 → `completed`; 6/7 → `blocked` with the destructive-diff/explicit-approval
  remediation; other non-zero or un-spawnable → `blocked` with the real stderr — never a fabricated
  `completed`). Wired into the `commandStart` `--yes` path (runs before the `stock` stage); `store`/
  `deploy` stay `pending` as not-yet-built spawned-CLI stages.
- **QM — `features/step_definitions/004-…steps.ts` + `features/support/`:** the 18 step defs for the 3
  new feature-004 scenarios (the configurator-deploy preview `@logic` was the deterministic target that
  drove Crew; the no-fabrication `@logic` guardrail; the `@sandbox` real spawn). New
  `features/support/configurator-cli-fake.ts` (`writeFakeNpx` hermetic PATH-shim, mirrors
  `stripe-cli-fake.ts`) and a `sandbox.ts` gating entry for the new `@sandbox` scenario.
- **Bosun — hygiene:** reattached the `runStockStage` doc comment that the insertion had orphaned; no
  behavior change.

**Remaining real-world verification (environmental, not a code blocker):** the positive deploy path is
sandbox-only — it truly passes on a creds-present **blank** store (additive apply, exit 0, idempotent
no-op re-run); locally and on non-blank stores it skips/blocks honestly. Confirm on CI / the acceptance
store.
