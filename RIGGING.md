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
- step-usage: `npx cucumber-js --format usage --tags "not @captain"`
- typecheck: `npm run typecheck`
- lint: `npx gplint "features/*.feature"`

## Tiers

- default: @logic. Fast behaviour tier, run in parallel. Exercises real behaviour against the `.env` test env per the live-by-design policy in `AGENTS.md`. Skips a target when its credential or capability is absent.
- sandbox: @sandbox. Requires `JOLLY_SALEOR_CLOUD_TOKEN` and a Vercel CLI session in the environment. The harness provisions disposable `jolly-test`-namespaced Saleor Cloud and Vercel resources and tears them down.
- eval: @eval. Opt-in model-behaviour evaluation. Requires `HARNESS_OPENROUTER_API_KEY` and `HARNESS_EVAL_MODEL`. Excluded from default and broad runs.

## Dependencies

- policy: locked. Add a new dependency only when a spec requires it.
- yaml: runtime parser for `assets/skills/jolly/recipe.yml`, required by feature `recipe-identifiers-from-asset` (`deriveRecipeIdentifiers`). Version constraint lives in `package.json`.

## Outbound

- policy: verify the published npm package and the deployed homepage, not only the local tree. Release ships `@dk/jolly` to npm and deploys `assets/homepage` to Vercel.

## Known false-failure modes

- A @sandbox failure may be a stale `.env` that points at a deleted `jolly-test` store and returns HTTP 404. Probe store reachability before treating it as a defect.
- After npm publish, verify against the local clean tree. CDN propagation can return a stale or empty tarball for minutes.
- The feature 027 interactive stage-progress scenario can flake under real-service load. Re-run it in isolation before treating red as a defect.
