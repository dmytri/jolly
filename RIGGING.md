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
- scantlings: none

## Commands

- discover: `npx cucumber-js -p all --dry-run --format message --tags "not @captain and not @shipwright" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=s.split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(m=>m.testStepFinished&&m.testStepFinished.testStepResult.status==="UNDEFINED");if(u.length){console.error("undefined steps: "+u.length);process.exit(1);}});'` — executes nothing (dry-run) and exits non-zero when any step is undefined. The tag-free `all` profile in `cucumber.js` carries no tags, so one invocation enumerates every tier and a tier added later is covered with no further wiring.
- focused: `bash -c 'f="$1"; shift; t=$(mktemp); npx cucumber-js -p all "${f%%:*}" --name "^${f#*:}$" --tags "not @captain and not @shipwright" "$@" 2>&1 | tee "$t"; s=${PIPESTATUS[0]}; grep -q "^0 scenarios" "$t" && { echo "focused: selected no scenario for $f" >&2; rm -f "$t"; exit 1; }; rm -f "$t"; exit $s' _ "{scenario}"`. Runs on the tag-free `all` profile, so a target in ANY configured tier is selectable. Cucumber ANDs a profile's tags with the CLI's, so the default profile's `tags: "not @eval"` silently selected NOTHING for an `@eval` target and exited 0; `all` carries no tags, so a tier added later is covered with no further wiring. Selecting no scenario exits 1, naming the reference, so a mistyped or mis-tiered target reddens instead of reading as a pass.
- broad: `npx cucumber-js -p logic --format message:coverage/weather/logic.ndjson --tags "@logic and not @captain and not @shipwright"`
- broad-sandbox: `npx cucumber-js -p sandbox --format message:coverage/weather/sandbox.ndjson --tags "@sandbox and not @captain and not @shipwright"`
- broad-sandbox-serial: `npx cucumber-js -p sandboxSerial --format message:coverage/weather/sandboxSerial.ndjson --tags "@sandbox and not @captain and not @shipwright"`
- broad-eval: `npx cucumber-js -p eval --format message:coverage/weather/eval.ndjson --tags "@eval and not @captain and not @shipwright"`
- coverage: `npx c8 --reporter=text --reporter=json -- npx cucumber-js -p logic --format message:coverage/weather/logic.ndjson --tags "@logic and not @captain and not @shipwright"`
- coverage-sandbox: `NODE_OPTIONS=--max-old-space-size=4096 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p sandbox --format message:coverage/weather/sandbox.ndjson --tags "@sandbox and not @captain and not @shipwright"`
- coverage-sandbox-serial: `NODE_OPTIONS=--max-old-space-size=4096 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p sandboxSerial --format message:coverage/weather/sandboxSerial.ndjson --tags "@sandbox and not @captain and not @shipwright"`
- coverage-eval: `NODE_OPTIONS=--max-old-space-size=4096 npx c8 --clean=false --reporter=text --reporter=json -- npx cucumber-js -p eval --format message:coverage/weather/eval.ndjson --tags "@eval and not @captain and not @shipwright"`
- step-usage: `npx cucumber-js -p all --dry-run --format usage-json --tags "not @captain and not @shipwright"` — emits one `usage-json` array covering every configured tier. The tag-free `all` profile enumerates every scenario in one invocation, so no tier is missed and no step definition reads as a false-positive orphan. Measured: 972 step definitions, 16 with zero usage.
- reclaim: `npm run reclaim` — standalone preflight that deletes stale `jolly-cannon-fodder`-namespaced leftovers (Cloud environments + local scratch dirs) without running any tier; the same reclamation also runs automatically at the start of every cucumber invocation (BeforeAll, `features/support/hooks.ts`)
- plank-inventory: `rg -n '@planks' src bin` — lists `@planks` and `@planks-provisional` alike across the implementation paths. Recursive `grep` is denied to internal roles by the Shipshape Bash custody hook, because it never reads the ignore artifact that hides the Captain-only notes; `rg` honours it, so this is the runnable form. Presence only: plank FORM and FRESHNESS are observed against the TypeScript AST by the `@logic @invariant` plank checks in feature `methodology-conformance` (`features/support/plank-conformance.ts`), never by this text search.
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
- weather: coverage/weather/ — the wake's weather record. Every `broad-*` and `coverage-*` command carries `--format message:coverage/weather/<tier>.ndjson`, so a tier run writes its own cucumber message stream, carrying per-test-case nanosecond durations, by construction. Read as the starting prior for concurrency, and as the per-scenario duration source for the harbour verification-economy audit. A `<tier>.ndjson` older than the tier's last run is a rigging defect, not a stale file to work around: the tier command owns the write.
- runrecord: coverage/weather/runrecord.ndjson — the wake's voyage run record, one JSON object per fresh green run, git-ignored under `coverage/`.

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

- policy: a recurring non-product failure is a harness defect to engineer out per `AGENTS.md` (readiness budget, robust reclaim, retrying teardown, parallel-robustness), never a tolerated mode to re-run past. The standard is a fully green suite across every tier with zero skips. Each entry below names the defect and how to retire it; strike the entry once it is engineered out. An empty list is the healthy state.
