# Agent Instructions

This is the authoritative **agent/tooling configuration** for this repository, shared by every agent. It is not product intent, a roadmap, or a worklist. Product intent lives in `features/*.feature` and referenced `assets/**`.

Machine-read tooling values for the Shipshape roles live in `RIGGING.md`. Those values are the stack, directories, commands, and tiers. This file holds the longer tooling prose.

This repo is **spec-driven**: `src/` (CLI entry `src/index.ts`) is disposable — built by Crew Mates, driven by failing tests, and regenerated whenever specs change. `assets/**` is human-authored durable material, not specified in `.feature` files, not covered by tests, and never edited by QM or Crew.

## Shipshape Workflow

This repository uses Shipshape for agent workflow. Shipshape owns the generic `/captain`, `/qm`, `/crew`, `/bosun`, `/shipwright`, and `/clearrole` role prompts; do not recreate them locally.

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

**Real services always — never mock or fake.** Every tier (including `@logic`) exercises real behavior against the real, integrated test env — the runtime `JOLLY_*` Saleor Cloud and Vercel credentials, which describe a production-shaped test environment. **No fake CLIs, no dummy credentials, no `.invalid` endpoints, no simulated responses, no in-process service fixtures standing in for the normal path.** Creating real resources is expected and correct — that is the point. Safety is **harmless-by-design** (namespace + teardown + never-touch-what-we-didn't-create, below), never credential-faking. The only admissible exception is a specific failure/edge the real test env genuinely cannot be made to produce on demand (e.g. an org already at its environment limit, or a deliberately unreachable service for the "stored, not verified" path) — a justified-exception double, named and justified inline at the site, never covering the normal path. Ordinary failures producible from real bad input — empty/garbage tokens, malformed or non-first-party URLs — must be produced for real, never doubled. Credentials for every tier are present by fitting-out; the underlying CLIs and API clients read them from the environment. Verification assumes they are present — it never checks, gates, or branches on credential presence. A scenario whose credential or precondition is absent fails as a fitting-out blocker, so the gap is visible and gets fixed. This holds on every feature. This rule is made **executable** by feature 026's `@property` conformance invariant ("no forbidden double"): a suite that is green while still carrying a fake fails there, so the rule self-enforces rather than relying on review. The single admissible double is a scenario tagged **`@exceptional-double`** — an exceptional condition the real test env cannot produce on demand (an org at its environment limit; a deliberately unreachable service for a "stored, not verified" path), justified inline; every other failure is produced from real bad input.

Test tiers:

- `@logic` — fast assertions about behavior and output (envelope/output shape, redaction, host enumeration, pure helpers), run against the real `.env` test env — never dummy or forced-safe credentials. A `@logic` scenario that would create or mutate a real resource belongs in `@sandbox`.
- `@sandbox` — real-account, side-effecting behavior against real services; runtime `JOLLY_*` credentials only; every created resource namespaced and torn down per harmless-by-design.
- `@eval` — skill-affordance evaluation driving the live baseline agent; a **required green/red gate** that MUST run and pass, its agent/model credential present by fitting-out. A persistent eval failure is a real defect to fix, never a tolerated flake and never skipped. Because a live agent varies run to run, the eval verification MAY retry the agent within a bounded budget so a single hiccup does not red the gate; exhausting that budget reds.

**Zero tolerated failures, zero skips — every tier, every run.** The standard is a fully green suite across `@logic`, `@sandbox`, and `@eval`, with no skipped scenarios anywhere. A skipped `@sandbox` or `@eval` scenario is un-verified, and un-verified is a failure, never a pass: verification runs every scenario, and a scenario it cannot run reds as a fitting-out blocker naming what to provide, rather than self-skipping. A recurring "false failure" — a cold-start not-yet-serving store, a leaked environment at the capacity limit, a teardown crash, a parallel timing race — is a harness defect to engineer out (a longer readiness gate, robust reclaim, a retrying teardown, serial isolation), not a documented excuse to re-run past. The suite is not green until it is green with nothing skipped and nothing tolerated.

**Tests that create or mutate real resources must be harmless by design — production-safe — and this applies to every such test (`@sandbox` and the live `@eval`) on every feature.** When you write or run one:

- Never modify or delete a resource the run did not itself create — with one carve-out for this dedicated test org: Saleor Cloud **environments** whose name is `jolly-cannon-fodder`-namespaced are disposable ("cannon fodder") and MAY be deleted to reclaim capacity (see env-limit handling below). The `jolly-cannon-fodder-` prefix IS the protection boundary — anything NOT so namespaced (the store the run's `.env` points at, and any future non-test environment) is never deleted or mutated. Read other pre-existing resources only via read-only, non-mutating queries.
- Namespace every created resource with the unique per-run identifier, and leave it unpublished/inactive where the platform allows, so it is never customer-visible.
- Change a shared setting only when the change is additive and is reverted during teardown.
- Use test card numbers only for payment flows, so the worst case against live payment credentials is a declined transaction, never a real charge.
- Register idempotent, best-effort teardown for everything created; report by namespaced identifier anything it could not remove.
- Do not detect or refuse "production" targets — the customer is trusted to choose the accounts. Safety comes from the rules above, not from target detection.

These rules are the binding work-discipline; they hold regardless of which feature you are working on. This document — not any feature file — is their home.

Sandbox harness mechanics (the machinery in `features/support/`):

- **Provision the shared store — cached across invocations, not just within a run.** Most `@sandbox` scenarios need a live store but do not themselves test store creation; for those, the harness caches ONE environment across cucumber invocations via a persistent marker file (`features/support/provision.ts`) recording the last known-good store's org/key/URL/token — NOT a fixed, human-readable domain label: `*.saleor.cloud` domain labels turned out to be namespaced more broadly than one org's own environment list (a literal `jolly-cannon-fodder-shared` name failed `DOMAIN_LABEL_TAKEN` even with zero environments showing in this org), so every store this harness creates gets a fresh `jolly-cannon-fodder-shared-<random>` name (still exempted from reclaim by that prefix), and the marker remembers THAT specific store to probe and reuse next time. It self-heals by deleting the marker's store and creating a fresh one under a new name if unreachable. It is deliberately never torn down — persisting it is the point, since it cuts the minutes-long create+deploy cost every run that doesn't test creation would otherwise pay again. Scenarios that DO test creation/reclaim itself (`@creates-env`) provision their own disposable, run-namespaced environment and tear it down as before. The Cloud token that drives provisioning is present by fitting-out.
- **Concurrency: one shared store across workers plus a heavy/light phase split.** All parallel workers of a run coordinate (lock + state file keyed on the run id) so exactly one of them provisions or reuses the shared store and the rest adopt its derived values — there is one live shared store per run, not one per worker. Heavy scenarios run serial for ONE reason, and it is LOCAL, not Saleor capacity: this test VM is resource-limited. Each heavy scenario runs a full toolchain (`git clone` Paper, `pnpm install` a whole Next.js app, `@saleor/configurator` deploy, `npx vercel` deploy, node), and two of those at once saturate the VM's CPU, memory, and network — that is where the "unable to connect" errors come from. Two `jolly start` runs do not saturate Saleor Cloud, and a paid Saleor instance would not help; the lever for heavy parallelism is a bigger test-runner VM. Cold start is a SEPARATE problem, not a reason to serialize: a freshly-provisioned Saleor environment answers 404 / 503 until its store instance is serving, and the fix is a readiness gate (poll the provisioned store until it serves before handing off), which works identically in parallel or serial. Therefore the tier is a heavy/light split. HEAVY scenarios (a full `jolly start`, a real deploy, tagged `@heavy`) run SERIAL, since only one toolchain fits the VM. The env-creating scenarios (feature 012 create, feature 026 reclaim, tagged `@creates-env`) also run serial, since they need a slot the shared store's project already partly consumes. Only the light query and check scenarios run in parallel.
- **Leftover handling is proactive and tier-independent.** An unconditional `BeforeAll` (no tag filter, `features/support/hooks.ts`) reclaims stale `jolly-cannon-fodder`-namespaced environments and local scratch dirs from any previous run — crashed, interrupted, or simply a different tier — at the start of EVERY cucumber invocation, not only when the specific tier that leaked them happens to run again; the same reclamation is also runnable standalone via `npm run reclaim` before a verification session even starts. They are this test org's disposable resources, positively identified by the `jolly-cannon-fodder-` prefix; the stable shared-store name is exempted from this reclaim by name, and any resource lacking the prefix is never touched. `@creates-env` scenarios' own disposable environments are still torn down individually as before.
- **A missing credential is a fitting-out blocker.** Credentials for every tier are present by fitting-out; the underlying CLIs and API clients read them from the environment. Verification never inspects, gates, or branches on credential presence. A scenario whose credential or capability is absent fails, naming what fitting-out must provide, so the gap is visible and gets fixed. An actual Saleor API interaction in a test authenticates with the long-lived staff token (`JOLLY_SALEOR_CLOUD_TOKEN`) from the environment. An org environment-limit rejection is reclaimed, not failed: this is a dedicated test org, so the harness deletes `jolly-cannon-fodder`-namespaced environments to free capacity and proceeds.
- **Teardown survives transient network faults.** `deleteEnvironment` and the shared-environment teardown MUST retry a thrown `fetch failed` the same way `cloudFetchRetry` does, so a transient blip during cleanup does not crash `AfterAll`, mask passing scenarios, or leak a `jolly-cannon-fodder` environment. A teardown that still cannot remove a resource reports it by namespaced identifier without aborting the run.
- **Heavy verification is main-loop-tracked or CI, never babysat in a subagent.** A `@sandbox`/`@heavy` run can outlive a single agent turn, so it MUST run under the main loop's tracked-background mechanism (or in CI), waited on by a completion signal — never inside an auto-resuming subagent that re-kicks a fresh run on every wake. Retry a transient failure ONCE (with backoff), then report red and stop. A capacity failure (`ENVIRONMENT_LIMIT_REACHED`) that survives one reclaim is terminal, not a flake: stop and report it as incomplete fitting-out, never retry. Reclaim leftover `jolly-cannon-fodder` capacity before each attempt so a retry never inherits a prior run's leaked environment. Run heavy scenarios serially through the configured `sandboxSerial` profile, not ad-hoc per-scenario invocations that bypass its serialization.
- **Mocks and fakes are forbidden, not a last resort.** Use real services. The only admissible test double injects a specific failure/unavailable-capability condition the real test env genuinely cannot produce on demand — justified inline, never replacing real coverage of the normal path.
- **Eval transcript keeping (opt-in observability).** When `HARNESS_EVAL_TRANSCRIPT_DIR` is set (default unset → throwaway temp dir), the eval harness persists the run's evidence (agent stdout/stderr, the Jolly-invocation trace, the final workspace `.env`) under a per-run namespaced subdir before teardown, scrubbing `HARNESS_OPENROUTER_API_KEY`. Observability only — it never changes pass/fail.

Prefer fast focused checks and isolated slow checks, and run independent checks in parallel for fast worklists/status. The logic tier runs in parallel: `cucumber-js -p logic` (configured in `cucumber.js`). Cached verification may be used only when project tooling defines it; reports must distinguish fresh results from cache-backed results.

A recurring non-product failure is a harness defect to engineer out, not an excuse to tolerate. When a failure is not a product defect, fix the harness so it stops recurring — never re-run past it:

- A `-p logic` (parallel) failure from a PTY/loopback timing race — make the target robust to parallel timing, or isolate it, so it passes in parallel. A target that only passes when re-run serially is not yet fixed.
- A `@sandbox` failure from a stale `.env` pointing at a deleted `jolly-cannon-fodder` store (404) — the harness MUST validate or refresh the store endpoint before the run, so a stale `.env` never reaches a scenario.
- A `@sandbox` cold-start failure (a freshly-provisioned store or fresh Vercel deploy not yet serving within the readiness budget) — the readiness gate MUST poll long enough that the store/deploy reliably serves before the stage completes. A budget too short to ride out a real cold start is the defect.
- A `@sandbox` capacity failure (org at its environment limit from a leaked `jolly-cannon-fodder` env) — reclaim MUST remove every leaked `jolly-cannon-fodder` env before provisioning, so a run never starts against a full org.
- After an outbound publish, verify against the local clean tree while CDN propagation settles, then verify the published artifact — a stale-tarball window is expected and rides through, not a release failure.

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
