# Captain Notes

Captain-only notes for Jolly discovery, product goals, MVP framing, rationale, open questions, current state, and non-binding project context.

Only Captain may read or edit this file. Quartermaster, Crew Mate, and Bosun must not read it or use it as input.

`CAPTAIN.md` does not define product behavior. Binding behavior must be promoted to executable specs or referenced `assets/**` before Quartermaster runs.

## Current Captain State

### Published 0.6.0 skill-install regression

`npx @dk/jolly@0.6.0 start` on a fresh machine installed no skills: every `*-skill-*` check failed. The missing contract was that skill install must be non-interactive and agent-agnostic, verified on disk. That behavior is now specified in `features/007-jolly-init-agent-setup.feature`.

Local follow-up commits already exist:

- `7d2c9c5` — implements feature 007 non-interactive, agent-agnostic, bundled skill install.
- `9d29ee2` — records that feature 007 is done; remaining Captain work is publish `0.6.1` and run the acceptance test.

Remaining Captain/outbound work:

- Publish `@dk/jolly@0.6.1`.
- Run one real paste→live-store acceptance pass on a clean machine to the feature 002 operational-readiness bar: deployed URL works, browsing/cart work against Saleor Cloud, checkout reaches the Stripe test payment step, and `jolly doctor` checkout probe passes.
- Prefer a fresh blank Saleor environment; the existing non-blank `jolly-store` makes configurator deploy block honestly instead of applying.

### Prior state: 0.6.0 release

`@dk/jolly@0.6.0` is live on npm and tag `v0.6.0` exists on `origin/main`. The merged `jolly start` chain shipped: create store → configurator deploy → stock seed → storefront clone/install → Vercel deploy → Stripe app install → `jolly doctor` verify.

The first real `@sandbox` run fixed defects hidden by PATH-shim fakes:

- Saleor skill refs in `DEFAULT_SKILLS` pointed at nonexistent repos; corrected to explicit Saleor agent-skills tree URLs.
- `doctor` `storefront-present` checked the root instead of `storefront/`.
- Harness robustness fixes: retry connection-level GraphQL blips, longer CLI timeout for slow Cloud provisions, deployment doctor re-run, and feature 022 storefront artifact path assertions.

Known future optimization: npm tarball size is large because `assets/skills/jolly/images/` ships product PNGs referenced by the starter recipe. Functional and pre-existing, but worth future Captain/assets work.

## Product Vision

- Name: Jolly.
- Tagline: Ahoy, agent. Go build a store.
- Jolly is a tool by Dmytri Kleiner that helps agents set up a store quickly using Saleor, Vercel, and Stripe. It is not an official product of Saleor, Vercel, or Stripe.
- Primary users are AI agents and agent skills; human developer DX should remain decent but secondary.
- Product shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.
- Jolly empowers the customer's own agent; it does not replace the agent.
- The launch bar is an honest end-to-end store setup: homepage prompt → real deployed storefront → browsing/cart → checkout reaches the Stripe test payment step, with every claim verified and nothing fabricated.

## Product Architecture Notes

`jolly start` is agent-supervised orchestration: it runs mechanical setup stages by spawning official CLIs and Jolly helpers, pauses for approval/risk context, and waits at unavoidable human gates.

Mechanical stages:

1. bootstrap (`init` + `doctor`)
2. auth (`login` / `auth status`)
3. store/app-token via Saleor Cloud API
4. storefront clone/install
5. configurator deploy
6. stock seed
7. Vercel deploy
8. Stripe app install
9. `jolly doctor` verify

Human-run `jolly start` is the backup path for interactive gates a non-TTY agent cannot complete. The homepage remains paste-to-agent first.

## Non-binding Product Notes

- Storefront baseline: `saleor/storefront` Paper template.
- Deployment target: Vercel.
- Payment provider: Stripe test mode for first-run validation.
- Saleor Cloud only in v1.
- Post-setup customization belongs to the customer's own agent/workflow.
- Homepage/setup-guide copy principle: less is more; avoid junk and duplication.
