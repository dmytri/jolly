# Handover

This file is the durable handoff between Shipshape roles. Read Shipshape role
instructions and `AGENTS.md` first, then this file for current project state.

You are the **Captain**.

Crew Mate dispatch: the `.claude/agents/` definition is currently absent, but the
Agent tool works — dispatch a general-purpose subagent under an explicit Crew Mate
charter (read feature + step defs first; minimal src/ change; no spec/test/asset
edits; report blockers). The QM-implements fallback remains a last resort.

## Current state: feature 007 skill-install fix implemented and verified locally

The 0.6.0 fresh-machine skill-install regression is **fixed in the working tree and
committed locally** (`7d2c9c5`), not yet pushed or published. `installSkill` now passes
the skills CLI's own non-interactive flags (`--yes --skill '*'`, no `--agent`) so a
no-agent/non-TTY machine no longer hits the silent picker no-op; the Jolly skill installs
from its bundled local copy (`bundledJollySkillPath`, mirroring `bundledRecipePath`) rather
than the network ref, honoring the "Jolly skill source" Rule.

Coverage (feature 007): two `@sandbox` scenarios, no Saleor creds — one drives the real
installer with no agent runtime / no TTY and asserts every default skill lands on disk with
honest success coupling; one blocks outbound network and proves the Jolly skill installs from
the bundle. Both pass.

Verification at this commit: dry-run 0 undefined, typecheck clean, units 43/43, `test:logic`
69/69, the two new feature-007 `@sandbox` scenarios 2/2. No code or verification worklist left.

### Remaining MVP steps (Captain/outbound)

- **Push + publish 0.6.1.** Push `7d2c9c5` to `origin/main`, version-bump 0.6.0 → 0.6.1,
  publish to npm, tag `v0.6.1`. This is the build that actually carries the fresh-machine fix.
- **Acceptance run (still not done).** One real paste→live-store run to feature 002
  operational-readiness (deployed URL works, browsing/cart work against Saleor Cloud, checkout
  reaches the Stripe test payment step, `jolly doctor` checkout probe `pass`). Best run against
  a **fresh blank** environment (the existing non-blank `jolly-store` makes the
  configurator-deploy positive path block-honestly rather than deploy). The customer chose to
  publish before this run; it remains the final honest end-to-end confirmation.

### Known follow-up (optimization, not a defect)

The npm tarball is ~17.9 MB because `assets/skills/jolly/images/` ships 12 pirate product PNGs
(~1.5–2.2 MB each) the starter `recipe.yml` references. Functional and pre-existing (0.5.3
shipped them too), but heavy for an `npx`-first CLI. Trimming (compress, or host remotely and
reference by URL in the recipe) is a Captain/assets decision for a future patch.
</content>
</invoke>
