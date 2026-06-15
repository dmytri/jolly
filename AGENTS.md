# Agent Instructions

## Shipshape Workflow

This repository uses Shipshape for agent workflow. Shipshape owns the generic `/captain`, `/qm`, `/crew`, `/bosun`, and `/clearrole` role prompts; do not recreate them locally.

Install or update Shipshape for the active runtime before substantive work:

```bash
npx skills add dmytri/shipshape --skill '*'
npx skills add dmytri/shipshape --agent claude-code --skill '*'
npx skills add dmytri/shipshape --agent zed --skill '*'
pi install npm:pi-shipshape
```

`AGENTS.md` is agent/tooling configuration only. It is not product intent, a roadmap, or a worklist. Captain-only notes live in `CAPTAIN.md`; only Captain may read or edit that file. QM, Crew, and Bosun must not read `CAPTAIN.md`.

## Project Configuration

| Placeholder | Project value |
|---|---|
| `<spec directory>` | `features/` |
| `<test directory>` | `tests/` plus `features/step_definitions/` and `features/support/` |
| `<implementation directory>` | `src/` |
| `<asset directory>` | `assets/` |
| `<verification discovery command>` | `npx cucumber-js --dry-run` |
| `<test command>` | `npm run test:bdd` |
| `<focused test command>` | `npx cucumber-js <feature>:<line>` or `node --test <test-file>` |
| `<typecheck command>` | `npm run typecheck` |
| `<lint command>` | `N/A` |

## Runtime and Build

- Node.js >= 23 + npm. Bun is not a dependency, requirement, or fallback.
- TypeScript, ES modules.
- Source entry point: `src/index.ts`.
- Published CLI bundle: `dist/index.js`, built with esbuild.
- CLI package name: `@dk/jolly`.
- `bin/jolly` imports `../dist/index.js`; published installs must not rely on raw `.ts` execution under `node_modules`.

Package scripts:

```bash
npm install
npm start
npm run dev
npm run build
npm test
npm run test:bdd
npm run test:logic
npm run test:sandbox
npm run test:eval
npm run typecheck
```

Single target examples:

```bash
npx cucumber-js features/020-cli-output-contract.feature
npx cucumber-js features/020-cli-output-contract.feature:10
npx cucumber-js --dry-run
node --test tests/sandbox.test.ts
```

## Verification Layout

- Feature files live in `features/`.
- Each feature maps to `features/step_definitions/<feature-slug>.steps.ts`.
- Shared hooks, world, sandbox setup/teardown, and credential gating live in `features/support/`.
- Logic-tier unit tests live in `tests/` and run via `node --test`.
- Feature `023-test-architecture` is a `@meta` harness charter and is excluded from the BDD worklist; do not write step definitions for it.
- DOM-level storefront checks use happy-dom.
- The homepage and Jolly skill content under `assets/**` are not covered by the BDD suite.

Test tiers:

- `@logic` — pure local behavior; no accounts; always runs.
- `@sandbox` — real Saleor Cloud, Configurator, Vercel, or Stripe behavior; uses runtime `JOLLY_*` credentials only.
- `@eval` — opt-in skill-affordance evaluation; excluded from default worklist; skips when its agent/model credential is absent; never a green/red gate.
- `@meta` — descriptive harness specs excluded from the BDD worklist.

Prefer fast focused checks and isolated slow checks. If slow checks can run safely in parallel, document and use the command. Cached verification may be used only when project tooling defines it; reports must distinguish fresh results from cache-backed results.

## Role-Specific Configuration

### Captain

- Reads `AGENTS.md` for tooling rules only.
- May read/write `CAPTAIN.md` for non-binding private notes.
- Writes binding product behavior to `features/*.feature` and referenced `assets/**`.
- Must not update `AGENTS.md` as part of feature/spec work.
- May create/update `assets/**` for durable human-approved source material.
- Must not delete `assets/**` unless specs explicitly retire the asset or the human explicitly asks.

### Quartermaster

- Starts from verification discovery: undefined, unimplemented, or failing targets are the worklist.
- Uses scenario/test/step files and adjacent test support for the current target.
- Turns scenario steps into executable verification as written; adds no product behavior or alternate interpretation.
- Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
- Shared hooks/world/sandbox setup live in `features/support/`.
- Logic-tier unit tests live in `tests/`.
- Sandbox tests use runtime `JOLLY_*` credentials only; there is no `JOLLY_TEST_*` namespace.

### Crew Mate

- CLI implementation lives under `src/`.
- Implements the minimal production/application change needed for one named failing target.
- Must not edit specs, tests, step definitions, harness code, or `assets/**`.

### Bosun

- Keeps the spec corpus current-design-only: remove superseded, obsolete, redundant, or purely historical scenarios/rules/steps without changing current behavior.
- Removes stale changed-file-adjacent artifacts only.
- Preserves current behavioral contracts; if a removal would change design or is ambiguous, leave it and raise a Captain blocker.
- After spec pruning, ensure step definitions/tests are not orphaned and verification discovery is clean.
- Stages intended changes only and creates the local commit boundary. Captain handles push/publish/release/deploy decisions.

## Durable Assets

`assets/**` is human/Captain-authored durable material and shipped content:

- `assets/homepage/` — homepage + setup guide deployed at https://jolly.cool.
- `assets/skills/jolly/` — Jolly skill and starter recipe shipped with the CLI.

QM and Crew may read `assets/**` when a scenario references it, but must not edit or delete it. Bosun may remove assets only when specs retire them.

## Secrets and Environment

- Local secrets live in `.env`, which must stay Git-ignored.
- Jolly workflow credentials use `JOLLY_*` names.
- Generated/cloned storefront runtime variables use the target project's expected names, such as `NEXT_PUBLIC_SALEOR_API_URL` and `SALEOR_APP_TOKEN`.
- Harness-only knobs use `HARNESS_*`, never `JOLLY_*`.
- Tests use the same runtime `JOLLY_*` names as Jolly itself; there is no test-only credential namespace.
- Vercel auth is not a Jolly credential. Deployment sandbox checks gate on `npx vercel whoami`, not `JOLLY_VERCEL_TOKEN`.
- Never print secret values.

## Network and Source Boundaries

Jolly's own request-sending code may contact only first-party/current workflow hosts specified by executable specs, including Saleor Cloud/auth, customer `*.saleor.cloud` endpoints, Stripe API, GitHub, and localhost OAuth callbacks. Delegated official CLIs such as Vercel CLI and `@saleor/configurator` contact their own services under their own auth.

- There is no `JOLLY_VERCEL_TOKEN`.
- `api.vercel.com` is reached only by the Vercel CLI, not by Jolly request code.
- `mcp.saleor.app` is informational only; Jolly configures local `mcp-graphql` against the customer's own store endpoint.
- `id.saleor.online` and `api.saleor.cloud` are retired and must not appear in code, output, or specs.
- Treat `saleor/cli` as deprecated source material only; do not depend on it, require it, shell out to it, or instruct customers to install it.
- Re-check upstream Saleor repositories at implementation time because commands, branches, and setup flows may change.
