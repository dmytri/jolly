# Rigging

Project tooling values for Shipshape roles. Values only, not procedure.
Procedure lives in the skills. Every role reads this on open.

## Stack

- language: typescript
- runtime: node@20
- packageManager: npm

## Directories

- implementation: src/
- implementation: bin/
- specs: features/
- verification: features/step_definitions/, features/support/
- assets: assets/

## Commands

- discover: `npx cucumber-js --dry-run --tags "not @captain and not @shipwright"`
- focused: `sh -c 'f="$1"; npx cucumber-js "${f%%:*}" --name "^${f#*:}$" --tags "not @captain and not @shipwright"' _ "{scenario}"`
- broad: `npx cucumber-js -p logic --tags "@logic and not @captain and not @shipwright"`
- broad-sandbox: `npx cucumber-js -p sandbox --tags "@sandbox and not @captain and not @shipwright"`
- broad-sandbox-serial: `npx cucumber-js -p sandboxSerial --tags "@sandbox and not @captain and not @shipwright"`
- broad-eval: `npx cucumber-js -p eval --tags "@eval and not @captain and not @shipwright"`
- coverage: `npx c8 --reporter=text --reporter=json -- npx cucumber-js -p logic --tags "@logic and not @captain and not @shipwright"`
- coverage-sandbox: `NODE_OPTIONS=--max-old-space-size=8192 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p sandbox --tags "@sandbox and not @captain and not @shipwright"`
- coverage-sandbox-serial: `NODE_OPTIONS=--max-old-space-size=8192 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p sandboxSerial --tags "@sandbox and not @captain and not @shipwright"`
- coverage-eval: `NODE_OPTIONS=--max-old-space-size=8192 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p eval --tags "@eval and not @captain and not @shipwright"`
- step-usage: `npx cucumber-js --dry-run --format usage-json --tags "not @captain and not @shipwright"`
- reclaim: `npm run reclaim` — standalone preflight that deletes stale `jolly-cannon-fodder`-namespaced leftovers (Cloud environments + local scratch dirs) without running any tier; the same reclamation also runs automatically at the start of every cucumber invocation (BeforeAll, `features/support/hooks.ts`)
- plank-inventory: `grep -rn '@planks' src/ bin/`
- typecheck: `npm run typecheck`
- lint: `npx gplint "features/*.feature"`
- conformance: `npx cucumber-js --profile logic --tags "@logic and @property and not @captain and not @shipwright"` — runs the structural `@property` scenarios (module-layering boundaries, single env-creation seam, single command-surface parser seam for the global output flags, live-by-design) discharged by the ts-morph conformance checker in the verification layer

## Perturbation

- message: `PERTURBATION: consider current durable context; remove when fixed`
- perturb: `throw new Error("PERTURBATION: consider current durable context; remove when fixed");`

## Tiers

- default: @logic. Fast behaviour tier, run in parallel. Exercises real behaviour against the `.env` test env per the live-by-design policy in `AGENTS.md`. Credentials are present by fitting-out; verification reads them from the environment and runs every target. A target whose credential or capability is absent fails as a fitting-out blocker, naming what fitting-out must provide.
- sandbox: @sandbox. Requires `JOLLY_SALEOR_CLOUD_TOKEN` and a Vercel CLI session, both present by fitting-out and read from the environment; verification runs every target and never gates on credential presence. A target whose credential is absent fails as a fitting-out blocker. The harness provisions `jolly-cannon-fodder`-namespaced Saleor Cloud and Vercel resources. Most scenarios share ONE store, deliberately cached across cucumber invocations via a persistent marker file (created once, reused while healthy, self-heals under a freshly-named replacement if unreachable — never torn down); only scenarios that test store/environment creation itself (`@creates-env`) provision their own disposable one and tear it down. Stale leftovers from any run are reclaimed proactively at the start of every invocation (`npm run reclaim` / BeforeAll), not lazily on next same-tier run.
- eval: @eval. Required green/red gate driving the live baseline agent. Requires `HARNESS_OPENROUTER_API_KEY` and `HARNESS_EVAL_MODEL`, present by fitting-out. Runs in the full-tier boundary and MUST pass; never skipped. A single live-agent timeout MAY be absorbed by a bounded in-scenario retry, persistent failure reds. This is the ONLY tier that invokes a model; every other tier reports zero model invocations and zero tokens, per feature `verification-economy`.
- weather: coverage/weather/ — the wake's run record. Each tier run writes its cucumber message stream (`<tier>.ndjson`, carrying per-test-case nanosecond durations) and a `tiers.tsv` roll-up of status and wall-clock. Read as the starting prior for concurrency, and as the per-scenario duration source for the harbour verification-economy audit.

## Dependencies

- policy: locked. Add a new dependency only when a spec requires it.
- yaml: runtime parser for `assets/skills/jolly/recipe.yml`, required by feature `recipe-identifiers-from-asset` (`deriveRecipeIdentifiers`). Version constraint lives in `package.json`.
- @earendil-works/pi-coding-agent: dev-only baseline coding agent for the `@eval` tier, required by feature `025-agent-skill-affordance-eval`. It is SPAWNED as a binary (`node_modules/.bin/pi`), never imported, so the module graph cannot see it and a dead-code analyzer reports it unused. It is not unused. It is also the source of record for verification economy: it writes its own per-turn `usage` (model invocations, prompt and completion tokens) to its session JSONL, read via `--session-dir`, per feature `verification-economy`.
- ts-morph: dev-only TypeScript-AST library backing the verification layer's structural conformance checker, required by features `module-boundary-conformance`, `single-creation-seam`, and feature 006's global-output-flags `@property` scenario. The checker (verification support) walks the source with ts-morph to enforce the module-layering import boundaries (resolution-accurate, via resolved import source files), the single env-creation seam (the `create store --create-environment` CLI-spawn call pattern that a module-graph tool cannot see), and the single command-surface parser seam (the global output flags `--json`/`--quiet`/`--yes` are declared once in `GLOBAL_BOOLEAN_FLAGS` and reach every command through the one `@bomb.sh/args` parser call in `src/index.ts`). Not a runtime dependency of the shipped CLI.

## Outbound

- target: npm - ship `npm publish` (the `prepublishOnly` script builds `dist/index.js` first); verify `npm view @dk/jolly version` reports the released version and the installed `npx @dk/jolly --help` runs the published bundle
- target: vercel-homepage - ship `cd assets/homepage && npx vercel deploy --prod --yes` (Vercel project `homepage`, linked via `assets/homepage/.vercel/project.json`); verify the deployed `*.vercel.app` homepage serves and its `/setup` rewrite matches the shipped `assets/homepage/setup.md`
- policy: verify the published artifact and the deployed homepage, not only the local tree. After npm publish, verify against the local clean tree while CDN propagation settles (a stale-tarball window is expected and rides through), then verify the published package.

## Known false-failure modes

- none. A recurring non-product failure is a harness defect to engineer out per `AGENTS.md` (readiness budget, robust reclaim, retrying teardown, parallel-robustness), never a tolerated mode to re-run past. The standard is a fully green suite across every tier with zero skips.
- mode: the harness's read-only Cloud API queries (`features/support/cloud.ts` `cloudFetchRetry`, used by namespace verification, capacity reclaim, and teardown) retry a THROWN network fault but return an HTTP error status as-is. A transient Saleor Cloud 502 therefore reds a tier that production rides straight through: production's `cloudFetch` retries 429 and 500-504. Observed reddening `@eval` at the 2026-07-13 harbour regression, green on immediate re-run. Engineer it out by matching production's transient-status retry, then strike this entry.
- mode: `plank-inventory` is text-search-derived (`grep`), so it reports plank PRESENCE only. It cannot see plank FORM: a `@planks` token in a docblock attached to the wrong declaration — a type alias sitting between the docblock and the seam it describes — counts as present and reads as planked. A misplaced plank therefore passes silently. The plank-form and stale-plank checks in `features/methodology-conformance.feature` are the real guards; they run against the TypeScript AST, not the text. Until they are executable, a grep-clean plank inventory is not evidence that planks are well-formed.
