# Rigging

Project tooling values for Shipshape roles. Values only, not procedure.
Procedure lives in the skills. Every role reads this on open.

## Stack

- language: typescript
- runtime: node@20
- packageManager: npm

## Directories

- implementation: src/
- specs: features/
- verification: features/step_definitions/, features/support/
- assets: assets/

## Commands

- discover: `npx cucumber-js --dry-run --tags "not @captain"`
- focused: `npx cucumber-js "{scenario}" --tags "not @captain"`
- broad: `npx cucumber-js -p logic --tags "@logic and not @captain"`
- coverage: `npx c8 --reporter=text --reporter=json -- npx cucumber-js -p logic --tags "@logic and not @captain"`
- coverage-sandbox: `NODE_OPTIONS=--max-old-space-size=8192 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p sandbox --tags "@sandbox and not @captain"`
- step-usage: `npx cucumber-js --format usage --tags "not @captain"`
- plank-inventory: `grep -rn '@planks' src/`
- typecheck: `npm run typecheck`
- lint: `npx gplint "features/*.feature"`

## Perturbation

- message: `PERTURBATION: consider current durable context; remove when fixed`
- fail-fast: `throw new Error("PERTURBATION: consider current durable context; remove when fixed");`

## Tiers

- default: @logic. Fast behaviour tier, run in parallel. Exercises real behaviour against the `.env` test env per the live-by-design policy in `AGENTS.md`. Credentials are present by fitting-out; verification reads them from the environment and runs every target. A target whose credential or capability is absent fails as a fitting-out blocker, naming what fitting-out must provide.
- sandbox: @sandbox. Requires `JOLLY_SALEOR_CLOUD_TOKEN` and a Vercel CLI session, both present by fitting-out and read from the environment; verification runs every target and never gates on credential presence. A target whose credential is absent fails as a fitting-out blocker. The harness provisions disposable `jolly-cannon-fodder`-namespaced Saleor Cloud and Vercel resources and tears them down.
- eval: @eval. Opt-in model-behaviour evaluation. Requires `HARNESS_OPENROUTER_API_KEY` and `HARNESS_EVAL_MODEL`. Excluded from default and broad runs.

## Dependencies

- policy: locked. Add a new dependency only when a spec requires it.
- yaml: runtime parser for `assets/skills/jolly/recipe.yml`, required by feature `recipe-identifiers-from-asset` (`deriveRecipeIdentifiers`). Version constraint lives in `package.json`.

## Outbound

- policy: verify the published npm package and the deployed homepage, not only the local tree. Release ships `@dk/jolly` to npm and deploys `assets/homepage` to Vercel.

## Known false-failure modes

- A @sandbox failure may be a stale `.env` that points at a deleted `jolly-cannon-fodder` store and returns HTTP 404. Probe store reachability before treating it as a defect.
- After npm publish, verify against the local clean tree. CDN propagation can return a stale or empty tarball for minutes.
- The feature 027 interactive stage-progress scenario can flake under real-service load. Re-run it in isolation before treating red as a defect.
- The feature 002 cold-start trio (`waits for a freshly-provisioned store to serve`, `The deployed storefront serves the Saleor catalog and a working cart`, `A re-run before Vercel approval reuses the same pending sign-in URL`) can block under serial `@sandbox` contention when a freshly-provisioned Saleor store or a fresh Vercel deploy has not yet started serving within the readiness budget. Reclaim leftover `jolly-cannon-fodder` capacity and re-run each in isolation before treating red as a defect; they pass on retry.
