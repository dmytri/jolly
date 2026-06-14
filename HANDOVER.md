# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-14): code-complete chain shipped — MVP gate is now `@sandbox` real-world verification

The full `jolly start` chain (`create store` → configurator deploy → stock-seed → storefront
clone/install → Vercel deploy → Stripe app install → `jolly doctor` verify) is **specified, built, and
green at every deterministic tier** — typecheck clean, units 43/43, `test:logic` 69/69, default
`cucumber-js --dry-run` 0 undefined, `eval` dry-run 0 undefined — and pushed to `origin/main` (785a664).
**There is no code worklist left.** All deterministic proof, however, ran against hermetic `git`/`pnpm`/
`vercel` PATH-shim fakes; **nothing has touched real services yet.**

### QM task this session: run `@sandbox` and triage what breaks (the MVP gate)

Per AGENTS.md "MVP and Launch Definition", MVP = the full honest end-to-end against reality. The chain
has never run a real `@saleor/configurator deploy` on a blank store, a real `npx vercel` deploy yielding
a reachable URL, the `appInstall` Stripe step, or the doctor checkout probe. **Credentials are present
this run** (verified 2026-06-14): `.env` carries `JOLLY_SALEOR_CLOUD_TOKEN`, `JOLLY_SALEOR_APP_TOKEN`,
`JOLLY_STRIPE_PUBLISHABLE_KEY/SECRET_KEY`, `NEXT_PUBLIC_SALEOR_API_URL`; the Vercel CLI is authed
(`vercel whoami` → `dmytri`); eval creds (`HARNESS_EVAL_MODEL`, `HARNESS_OPENROUTER_API_KEY`) also
present. So `@sandbox` will execute, not skip.

QM steps:
1. `npm run test:sandbox` — run the real-service tier. Expect real bugs the fakes couldn't surface.
2. Triage each failure: a genuine Jolly-code defect → dispatch a Crew Mate against that one failing
   target; an environmental skip (no blank store for the configurator deploy, capacity limits) → record
   the reason, not a failure.
3. Re-green and report. The configurator-deploy positive path specifically needs a **blank** store
   (`database_population: null`) — without one it blocks honestly rather than passing.

After `@sandbox` is green, the remaining MVP steps (Captain-owned, outbound): one real paste→live-store
acceptance run, then version-bump + `npm run build` + `npm publish` so `npx @dk/jolly` ships the merged
chain (npm currently at 0.5.3, which predates the storefront/deploy stages). Homepage jolly.cool is live.
