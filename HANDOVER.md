# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-14): all `jolly start` stages execute end-to-end — committed locally, NOT pushed

`jolly start` now performs the full mechanical chain itself — `create store` → configurator deploy →
stock-seed → **storefront clone/install** → **Vercel deploy** — so the whole run is **runnable by a
human in a plain shell**, the natural way to clear the irreducibly-interactive gates (account creation,
browser OAuth, `vercel login`, `stripe login`) a non-TTY agent cannot pass. Human-run is a **backup**,
not the headline: the homepage stays paste-first; when the agent can't clear a gate or a stage fails,
Jolly's `nextSteps` and the skill tell it to ask the human to run `jolly start` in a shell, then start
their agent to iterate (skills already on disk from `init`).

All deterministic tiers green: typecheck clean, units **43/43**, `test:logic` **69/69**, default
`cucumber-js --dry-run` **0 undefined**, `eval` dry-run **0 undefined**. `@sandbox`/`@eval` are billable
and NOT run locally — deferred to a creds-present/CI run.

**What landed (this pass):**
- **`src/index.ts`:** `runStorefrontStage()` spawns `git clone --branch main saleor/storefront` into
  `storefront/`, strips `.git`, `git init`s a fresh repo, spawns `pnpm install`; idempotent (reuses an
  already-prepared `storefront/`); honest exit-code reporting (never a fabricated `completed`).
  `runDeployStage()` spawns `npx vercel` under the Vercel CLI's OWN session, surfaces Deployment
  Protection, honest exit-code reporting — **no `JOLLY_VERCEL_TOKEN`, no `api.vercel.com` in Jolly's
  code** (feature 020). Both stages' previews are enriched in the single `startPlan()` source (storefront
  names the `main` branch; deploy states the no-Vercel-token / no-Vercel-API-request invariant in prose
  with `networkHostsContacted` empty); feature-021 dry-run/real riskContext deep-equality preserved.
  Wired into the `commandStart` `--yes` path (storefront like `stock`; deploy in the high-risk branch).
  Added the human-run fallback `nextStep`.
- **Tests:** 5 new feature-002 `@logic` step defs (storefront/deploy previews, two no-fabrication
  guardrails, human-run fallback); new `features/support/storefront-cli-fake.ts` (hermetic offline
  `git`/`pnpm`/`vercel` PATH shims); feature-004's shared "no real Saleor credentials" Given extended to
  write those shims; feature-025 `@eval` precision fix (the no-`success` assertion now exempts `jolly
  start --dry-run`, whose preview legitimately reports success).

**Remaining real-world verification (environmental, not a code blocker):** the positive storefront/deploy
paths are sandbox-only — they truly pass on a creds-present + Vercel-authed VM (real clone+install,
reachable deploy URL, idempotent re-run); locally and without creds they skip/block honestly. The
configurator deploy positive path likewise needs a blank store. Confirm on CI / the acceptance store.
