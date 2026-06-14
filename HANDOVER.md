# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## TOP PRIORITY: published 0.6.0 is broken on fresh machines — skill install regressed

`npx @dk/jolly@0.6.0 start` on a fresh machine installs no skills (every `*-skill-*` check `fail`).
The current `installSkill` invocation is not non-interactive, so on a machine with no agent
auto-detected the installer's picker no-ops silently. The contract that was missing — skill install
must be **non-interactive and agent-agnostic**, verified on disk — is now specified in
`features/007-jolly-init-agent-setup.feature` (new scenario + Rule). The green `@sandbox` gate missed
this because it ran in an agent-detected environment; the new scenario exercises the
no-agent/non-interactive condition that catches it.

QM: implement feature 007's non-interactive skill-install contract (coverage that fails first, then
the minimal Crew fix), and while there confirm the impl matches the "Jolly skill source" Rule (it
ships bundled, no network — current impl installs `dmytri/jolly` over the network). Then Captain
publishes 0.6.1 and runs the real acceptance run on a clean machine before any further publish is
trusted.

## Earlier this session: `@sandbox` MVP gate green against real services

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

### Published: `@dk/jolly@0.6.0` is live on npm (`latest`)

Version-bumped 0.5.3 → 0.6.0, published, and smoke-tested via `npx @dk/jolly@0.6.0` on a clean
machine — the merged `jolly start` chain now ships. Tag `v0.6.0` is on `origin/main`. Homepage
jolly.cool is live.

### Remaining MVP steps

- **Acceptance run (not yet done):** one real paste→live-store run to the feature 002 operational-
  readiness bar (deployed URL works, browsing/cart work against Saleor Cloud, checkout reaches the
  Stripe test payment step, `jolly doctor` checkout probe `pass`). The customer chose to publish
  before this run; it remains the final honest end-to-end confirmation. Best run against a **fresh
  blank** environment (the existing non-blank `jolly-store` makes the configurator-deploy positive
  path block-honestly rather than deploy).

### Known follow-up (optimization, not a defect)

The npm tarball is ~17.9 MB because `assets/skills/jolly/images/` ships 12 pirate product PNGs
(~1.5–2.2 MB each) the starter `recipe.yml` references. Functional and pre-existing (0.5.3 shipped
them too), but heavy for an `npx`-first CLI. Trimming (compress, or host remotely and reference by
URL in the recipe) is a Captain/assets decision for a future patch.
