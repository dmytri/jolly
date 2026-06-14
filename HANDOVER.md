# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state (2026-06-14): `@sandbox` MVP gate is GREEN against real services

The full `jolly start` chain (`create store` → configurator deploy → stock-seed → storefront
clone/install → Vercel deploy → Stripe app install → `jolly doctor` verify) is **specified, built, and
green at every tier including `@sandbox`** — typecheck clean, units 43/43, `test:logic` 69/69, and
`npm run test:sandbox` **34 scenarios: 31 passed, 3 skipped, 0 failed** against real Saleor Cloud,
`@saleor/configurator`, Vercel (CLI authed as `dmytri`), and Stripe test mode. **There is no code or
verification worklist left.**

The 3 sandbox skips are spec-sanctioned premise/capacity skips, not failures: the configurator-deploy
positive path needs a **blank** store (`database_population: null`) and skips against the existing
non-blank `jolly-store`; the env-collision corrected-retry skips when the org sandbox env limit is
reached. They re-run green when their premise is producible.

### What this session fixed (first real `@sandbox` run; see git log for the commit)

Two real Jolly defects the PATH-shim fakes had hidden, plus four test/harness robustness fixes:
- **src** — `DEFAULT_SKILLS` Saleor refs pointed at nonexistent repos (`saleor/saleor-core`, …) so
  `skillsInstalled` was never true; corrected to `https://github.com/saleor/agent-skills/tree/main/skills/<id>`
  (the real upstream; bare `owner/repo/subpath` does NOT resolve — the explicit tree-URL does).
- **src** — `doctor` `storefront-present` looked at the project root instead of the `storefront/`
  subdir Paper is cloned into; aligned with every other storefront path.
- **tests/harness** — `saleorGraphql` now retries connection-level (`fetch failed`) blips; real
  env-creating `runCliAsync` calls get the full 540s step budget (the 120s default SIGKILLed slow
  Cloud provisions before they emitted an envelope); the 002 deploy step re-runs `doctor deployment`
  instead of reading a clobbered envelope; the 022 detection scenarios assert via the documented
  `data.stages` contract and place the storefront artifact under `storefront/`.

### Remaining MVP steps (Captain-owned, outbound)

One real paste→live-store acceptance run, then version-bump + `npm run build` + `npm publish` so
`npx @dk/jolly` ships the merged chain (npm currently at 0.5.3, which predates the storefront/deploy
stages). Homepage jolly.cool is live.
