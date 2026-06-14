# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Quartermaster**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## TOP PRIORITY (2026-06-14): shipped 0.6.0 is BROKEN on fresh machines — skill install fails silently

`npx @dk/jolly@0.6.0 start` on a fresh machine (real report: Debian distrobox with Cursor
installed) reports **every** skill check `fail` — `init-skill-*` and `doctor-skill-*` for all of
jolly, saleor-storefront, saleor-configurator, storefront-builder, saleor-core, saleor-app — so
`bootstrap.skillsInstalled` is false and the customer starts with no skills on disk. The rest of
bootstrap (`.mcp.json`, AGENTS.md, doctor) is fine.

**Confirmed root cause (reproduced 2026-06-14, Captain discovery).** `installSkill` in `src/index.ts`
runs `spawnSync("npx", ["--yes", "skills", "add", skill.ref])`. The `--yes` there is **npx's** flag;
it is NOT passed to the `skills add` subcommand. Without the skills tool's own `-y`, `skills add`
opens an interactive agent multi-select. When Jolly spawns it non-interactively (piped stdio), the
picker installs **nothing and still exits 0** — a silent failure. Jolly's on-disk check then
correctly reports `fail`. Reproduction (no-agent, non-interactive):
  - `npx --yes skills add dmytri/jolly`        → exit 0, installs nothing (stuck in the picker).
  - `npx --yes skills add dmytri/jolly --yes`  → exit 0, installs `.agents/skills/jolly/SKILL.md`.
So the fix direction is: pass the **skills tool's own** `-y`/`--yes` so it installs deterministically
to the universal `.agents/skills/<id>/` location Jolly verifies, regardless of which agent runtimes
are present. (The tree-URL Saleor refs from the previous fix are correct; they need git+network,
which the reporting machine has.)

**Why the green `@sandbox` gate missed it (the real QM gap).** The feature 007 init/skill-install
verification ran on the CI/VM, where an agent runtime is auto-detected so the picker auto-resolves
and the buggy invocation happens to install. It never exercised the **non-interactive / no-agent**
condition a fresh customer machine actually has. **Verification must reproduce that condition** (e.g.
drive the install with stripped agent context and piped stdio, asserting the skills land on disk and
that a silent exit-0-installs-nothing is caught) so this class of bug cannot ship green again. This
is exactly what the deferred **acceptance run** (real paste→live-store on a clean machine) would have
caught before publish; it remains outstanding.

### QM task this session
1. Add executable coverage that fails against current `src/` (reproduce the non-interactive/no-agent
   install so the silent failure is caught — not just the agent-detected happy path).
2. Drive the minimal Crew fix in `installSkill` (skills' own `-y`), keep deterministic universal
   `.agents/skills/` install, re-green every tier including the new coverage.
3. Possible related check: AGENTS.md says the jolly skill installs from the **bundled copy (no
   network)**, but the impl installs `dmytri/jolly` over the network — confirm whether that gap
   should be closed in the same pass.
4. After Bosun commits, the remaining outbound is a **0.6.1 publish** (Captain-owned) and, before any
   further publish is trusted, the real acceptance run on a clean machine.

Do NOT trust a green skill-install check that ran in an agent-detected environment as proof the
shipped artifact works for customers.

## Earlier state (2026-06-14): `@sandbox` MVP gate is GREEN against real services

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
