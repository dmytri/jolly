# Agent Instructions

This is the authoritative **agent/tooling configuration** for this repository, shared by every agent. It is not product intent, a roadmap, or a worklist. Product intent lives in `features/*.feature` and referenced `assets/**`.

This repo is **spec-driven**: `src/` (CLI entry `src/index.ts`) is disposable — built by Crew Mates, driven by failing tests, and regenerated whenever specs change. `assets/**` is human-authored durable material, not specified in `.feature` files, not covered by tests, and never edited by QM or Crew.

## Shipshape Workflow

This repository uses Shipshape for agent workflow. Shipshape owns the generic `/captain`, `/qm`, `/crew`, `/bosun`, and `/clearrole` role prompts; do not recreate them locally.

Install or update Shipshape for the active runtime before substantive work:

```bash
npx skills add dmytri/shipshape --skill '*'
npx skills add dmytri/shipshape --agent claude-code --skill '*'
npx skills add dmytri/shipshape --agent zed --skill '*'
pi install npm:pi-shipshape
```

### Role handoffs — the predecessor's flagged blockers are the first agenda item

On any role takeover (QM→Captain, Crew→QM, Bosun→Captain, and so on), the **outgoing role's final-report blockers and open questions are the FIRST agenda item** the incoming role enumerates and addresses — before discovery, spec maintenance, dirty-deck routing, or any outbound/push decision. Read the immediately-preceding role's final report verbatim and treat its blocker/open-question list as the agenda anchor.

- A single takeover is often **several situations at once** (e.g. post-Bosun completed work AND an unresolved blocker report); do not classify it into one bucket and silently drop the rest. Handle the blockers first, then the other applicable paths.
- The **fresh handoff from the immediately-preceding role takes priority over accumulated historical notes** (e.g. older `CAPTAIN.md` worklist entries) whenever they compete for attention or conflict. Do not import stale worklist items as if they were the live handoff.

*(Local addition pending upstream into the canonical Shipshape role prompts — see CAPTAIN.md "Lessons learned → Shipshape upstream".)*

### Working discipline

- **Move faster, fewer passes.** Finish the runnable work of a pass before stopping. Do not bank the easy `@logic` wins and defer the `@sandbox` ones by default — if a target is runnable now (its needed credentials/capability are present), run it. Batch verification/regression runs instead of one-at-a-time round-trips; escalate effort only when something is genuinely unclear.
- **Commit granularity is never a reason to stop.** Do not break flow mid-pass to commit just to keep commits distinct; work through and commit at a natural completion. Distinct history can be reconstructed later with `git cherry-pick`.
- **Deferral is not safety.** Stopping short does not reduce real risk (teardown is registered before creation; flakiness is environmental) — it only adds latency. Reserve a real stop for an actual blocker (missing capability/credential, contradictory spec) and name it plainly, never a manufactured safety rationale. The one legitimate deferral is the Shipshape context-firewall: "clear and continue" via a fresh `/qm`, not "stop".
- **Trunk-based.** Commit and push to `main`; never create feature branches.

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
| `<lint command>` | `npx gplint "features/*.feature"` (gherkin/feature-file lint; config in `.gplintrc`) |

## Runtime and Build

- Node.js >= 23 + npm.
- TypeScript, ES modules.
- **External CLIs are invoked via `npx`** — `@saleor/configurator` and `vercel` are used that way, everywhere (harness gates, step definitions, and `src/`). Never expect a global install: a CLI binary absent from `PATH` (e.g. bare `vercel` exiting 127) is **not** a failure, and auth/session probes use the `npx` form (`npx vercel whoami`). The only exception is a CLI not designed for `npx`. (Stripe is set up by installing the Saleor Stripe app via Saleor GraphQL `appInstall` — feature 005 — so Jolly drives no Stripe CLI.)
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
- DOM-level checks use happy-dom.
- Content under `assets/**` is not covered by the BDD suite.

**Real services always — never mock or fake.** Every tier (including `@logic`) exercises real behavior against the real, integrated test env — the runtime `JOLLY_*` Saleor Cloud / Vercel / Stripe credentials, which describe a production-shaped test environment. **No fake CLIs, no dummy credentials, no `.invalid` endpoints, no simulated responses, no in-process service fixtures standing in for the normal path.** Creating real resources is expected and correct — that is the point. Safety is **harmless-by-design** (namespace + teardown + never-touch-what-we-didn't-create, below), never credential-faking. The only admissible exception is a specific failure/edge the real test env genuinely cannot be made to produce on demand (e.g. an org already at its environment limit, or a deliberately unreachable service for the "stored, not verified" path) — a justified-exception double, named and justified inline at the site, never covering the normal path. Ordinary failures producible from real bad input — empty/garbage tokens, malformed or non-first-party URLs — must be produced for real, never doubled. Tests are **skipped, not failed** when a needed credential or capability is absent, so the suite always runs; CI supplies credentials. This holds on every feature. This rule is made **executable** by feature 026's `@property` conformance invariant ("no forbidden double"): a suite that is green while still carrying a fake fails there, so the rule self-enforces rather than relying on review. The single admissible double is a scenario tagged **`@exceptional-double`** — an exceptional condition the real test env cannot produce on demand (an org at its environment limit; a deliberately unreachable service for a "stored, not verified" path), justified inline; every other failure is produced from real bad input.

Test tiers:

- `@logic` — fast assertions about behavior and output (envelope/output shape, redaction, host enumeration, pure helpers), run against the real `.env` test env — never dummy or forced-safe credentials. A `@logic` scenario that would create or mutate a real resource belongs in `@sandbox`.
- `@sandbox` — real-account, side-effecting behavior against real services; runtime `JOLLY_*` credentials only; every created resource namespaced and torn down per harmless-by-design.
- `@eval` — opt-in skill-affordance evaluation; excluded from default worklist; skips when its agent/model credential is absent; never a green/red gate.

**Tests that create or mutate real resources must be harmless by design — production-safe — and this applies to every such test (`@sandbox` and the live `@eval`) on every feature.** When you write or run one:

- Never modify or delete a resource the run did not itself create — with one carve-out for this dedicated test org: Saleor Cloud **environments** whose name is `jolly-test`-namespaced are disposable ("cannon fodder") and MAY be deleted to reclaim capacity (see env-limit handling below). The `jolly-test-` prefix IS the protection boundary — anything NOT so namespaced (the store the run's `.env` points at, and any future non-test environment) is never deleted or mutated. Read other pre-existing resources only via read-only, non-mutating queries.
- Namespace every created resource with the unique per-run identifier, and leave it unpublished/inactive where the platform allows, so it is never customer-visible.
- Change a shared setting only when the change is additive and is reverted during teardown.
- Use test card numbers only for payment flows, so the worst case against live payment credentials is a declined transaction, never a real charge.
- Register idempotent, best-effort teardown for everything created; report by namespaced identifier anything it could not remove.
- Do not detect or refuse "production" targets — the customer is trusted to choose the accounts. Safety comes from the rules above, not from target detection.

These rules are the binding work-discipline; they hold regardless of which feature you are working on. This document — not any feature file — is their home.

Sandbox harness mechanics (the machinery in `features/support/`):

- **Provision instead of skip.** When a sandbox run needs a Saleor endpoint or app token that is not configured and `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness provisions one shared environment for the run under the per-run `jolly-test` namespace (passed via the `--name`/`--domain-label` overrides), derives the missing `NEXT_PUBLIC_SALEOR_API_URL`/`JOLLY_SALEOR_APP_TOKEN` from it, and registers its teardown **before** creating — so a run never permanently consumes a sandbox slot even if it times out or crashes.
- **Leftover handling.** Before creating, the harness checks for leftover `jolly-test`-namespaced environments from previous runs and may delete them freely to reclaim capacity — they are this test org's disposable resources, positively identified by the `jolly-test-` prefix. It never deletes an environment lacking that prefix.
- **Skip-not-fail conditions.** Tests are skipped (not failed), with a clear reason, only when needed credentials are absent and cannot be derived (`JOLLY_SALEOR_CLOUD_TOKEN` itself, or third-party Vercel/Stripe credentials), or a needed capability is unavailable (e.g. no `vercel login` session for a live deploy). An org environment-limit rejection is NOT a skip: this is a dedicated test org, so the harness reclaims capacity by deleting `jolly-test`-namespaced environments and proceeds.
- **Mocks and fakes are forbidden, not a last resort.** Use real services. The only admissible test double injects a specific failure/unavailable-capability condition the real test env genuinely cannot produce on demand — justified inline, never replacing real coverage of the normal path.
- **Eval transcript keeping (opt-in observability).** When `HARNESS_EVAL_TRANSCRIPT_DIR` is set (default unset → throwaway temp dir), the eval harness persists the run's evidence (agent stdout/stderr, the Jolly-invocation trace, the final workspace `.env`) under a per-run namespaced subdir before teardown, scrubbing `HARNESS_OPENROUTER_API_KEY`. Observability only — it never changes pass/fail.

Prefer fast focused checks and isolated slow checks, and run independent checks in parallel for fast worklists/status. The logic tier runs in parallel: `cucumber-js -p logic` (configured in `cucumber.js`). Cached verification may be used only when project tooling defines it; reports must distinguish fresh results from cache-backed results.

Before treating a verification failure as a product defect, rule out the known false-failure modes first:

- A `-p logic` (parallel) failure may be a PTY/loopback timing race, not a defect — re-run the target **serially** to confirm before acting (the failing scenario moving between runs is the tell).
- A `@sandbox` failure may be a stale `.env` pointing at a deleted `jolly-test` store (404) — probe store reachability before treating it as a defect.
- After an outbound publish, verify against the local clean tree, not the freshly-published registry tarball — CDN propagation can return an empty or stale tarball for minutes.

## Scenario writing

All `.feature` scenarios and steps must follow the **scenario-writing guide — see `SCENARIO_WRITING.md`.** In short: every scenario describes a real feature testable explicitly (a named command/input + a concrete, falsifiable observable); concrete `Given/When/Then` (a named command in `When`, never a circular trigger); no faux/abstract-subject/actor-asserting/hedge-word steps; behavior lives in steps, not `Rule:` prose; cross-cutting invariants are verified at each concrete site.

## Role-Specific Configuration

### Captain

- Reads `AGENTS.md` for tooling rules only.
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
- **Removes unreachable production code.** `src/` is disposable and exists only to satisfy current specs/tests, so code that no current scenario, test, or step exercises — a path orphaned after a behavior was retired or refactored — is dead and must be removed, so the MVP carries only code a current spec demands. Detect it by following from the current verification surface (grep for unreferenced exports/functions; where practical, a coverage pass over the BDD run flags `src/` lines no test reaches). When it is unclear whether a path is truly unreachable vs. covering live behavior the tests merely under-exercise, leave it and raise a Captain blocker rather than risk removing a real contract. *(Local addition pending upstream into the canonical Shipshape Bosun role.)*
- Preserves current behavioral contracts; if a removal would change design or is ambiguous, leave it and raise a Captain blocker.
- After spec pruning, ensure step definitions/tests are not orphaned and verification discovery is clean.
- Lints the `.feature` corpus with gplint — `npx gplint "features/*.feature"` (config in `.gplintrc`; run via `npx` per the runtime rules, no global install). The flat `features/*.feature` glob is deliberate: gplint (2.5.2) does not expand a quoted `**`, so `"features/**/*.feature"` silently matches zero files — never use it. Treat a non-zero exit as a hygiene blocker: fix pure-formatting violations (trailing spaces, EOF newline, indentation, table alignment) as hygiene edits; flag semantic ones (name length, scenario count, banned tags) to Captain.
- MAY edit `.gplintrc` to fine-tune the gplint rule set as needed — adjust, enable, or relax rules so the linter matches the project's current spec conventions. Rule reference: https://gplint.github.io/docs/rules.
- Stages intended changes only and creates the local commit boundary. Captain handles push/publish/release/deploy decisions.

## Durable Assets

`assets/**` is human-authored durable material. Its boundaries:

- QM and Crew may read `assets/**` when a scenario references it, but must not edit or delete it.
- Bosun may remove assets only when specs retire them.

What lives under `assets/**` and what it contains is product intent — see the relevant `features/*.feature`.

## Secrets and Environment

- Local secrets live in `.env`, which must stay Git-ignored.
- Workflow credentials use `JOLLY_*` names.
- Generated runtime variables use the target project's own expected names.
- Harness-only knobs use `HARNESS_*`, never `JOLLY_*`.
- Tests use the same runtime `JOLLY_*` names as the application itself; there is no test-only credential namespace.
- Never print secret values.
