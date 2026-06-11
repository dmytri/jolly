# Agent Instructions

## Project Stack

- Runtime/package manager: Bun
- Language: TypeScript
- Module system: ES modules
- Entry point: `src/index.ts`
- CLI distribution target: executable via `npx` with package `@saleor/jolly` for production and `@dk/jolly` for testing, with subcommands such as `init`, `create`, and `start`
- Package scripts:
  - `bun run start` runs the app
  - `bun run dev` runs the app in watch mode

## Product Vision

- **Name:** Jolly
- **Tagline:** Ahoy, agent. Go build a store.
- **Purpose:** Jolly, via the customer's own agent, helps people set up a fully operational end-to-end commerce experience on Saleor Cloud.
- **Primary users:** AI agents and agent skills are the primary consumers; human developer DX should remain decent but secondary.
- **Product shape:** Homepage + CLI + agent skills/setup instructions. Two phases: setup (fast automated path to a working storefront) and iteration (agent + Jolly diagnostics + skills for ongoing customization).
- **Homepage:** Includes a prominent copy box ("copy this to your agent to get started") linking to the Jolly agent setup guide.
- **CLI:** Designed for agents first, not direct human use first. Executable via `npx` without a prior global install.
- **Inspiration:** swamp.club.
- **Core principle:** Jolly exists to empower the customer's own agent, not replace it. The customer's agent remains the primary orchestrator, explainer, and approval manager. Jolly provides capabilities, setup automation, wrappers, diagnostics, and local/project automation that make the agent more effective.
- **Zero unnecessary friction:** The path from copying the Jolly homepage prompt to a working deployed storefront requires only the human actions that cannot be automated — new account creation, browser OAuth consent, and providing secret values. Everything else Jolly and the agent handle automatically using safe defaults.
- **Architectural complement:** Jolly is complementary to the Saleor MCP server (mcp.saleor.app). The MCP server is read-only and provides live store data access — products, orders, and customers — for an already-configured store. Jolly handles setup automation, local project scaffolding, deployment orchestration, skill management, and diagnostics. As part of `jolly init`, Jolly should configure mcp-graphql and inform the agent about the MCP server so it has live store access from day one.

## V1 Scope and Boundaries

- Saleor Cloud only; no self-hosted Saleor support in v1.
- Storefront baseline: `saleor/storefront` Paper template (Next.js App Router, React, TypeScript, GraphQL, Tailwind CSS, pnpm).
- Deployment target: Vercel.
- Payment provider: Stripe (test mode for first-run validation; live mode requires explicit customer choice).
- Jolly does not implement Saleor backend features.
- Jolly does not replace Saleor Dashboard.
- Jolly does not depend on the deprecated Saleor CLI; may study it as reference material only.
- No Jolly-owned auth, licensing, telemetry, quotas, paid feature gating, or usage controls in v1.
- Post-setup storefront customization belongs to the customer's own agent and workflow. Jolly supports the iteration phase via `jolly doctor`, `jolly upgrade`, and mcp-graphql config for live store access.
- `jolly start` is optional convenience orchestration; every stage must also be available as composable commands the agent can call independently.
- Canonical homepage/setup-guide URL is deferred; use a placeholder until decided.
- Project-local `.jolly/` artifacts and persistent report files are deferred until CLI design.

## CLI Output Contract

- Every command shares one structured output envelope so agents parse all commands identically. See feature `020-cli-output-contract`.
- Envelope fields: `command`, `status` (`success` | `warning` | `error`), `summary`, `data`, `checks`, `nextSteps`, `errors`.
- `checks[].status` reuses the doctor vocabulary: pass, warning, fail, skipped, unknown.
- With `--json`, stdout contains only the envelope; default mode adds concise human text; `--quiet` trims nonessential human text only.
- Stable `errors[].code` and check-id strings let agents branch programmatically; secrets are never printed and are referenced by name only.
- Field names use camelCase (for example `nextSteps`, `riskLevel`, `dryRunAvailable`), across the envelope and the feature 021 risk context.

## Agent Risk Context

- Before any create/modify/deploy/delete/expose action, Jolly emits a structured `riskContext` so the customer's agent decides approval; Jolly never hardcodes the decision. See feature `021-agent-risk-context`.
- `riskContext` fields: `action`, `target`, `riskLevel` (low | medium | high), `categories` (from feature 010's high-risk list), `reversible`, `sideEffects`, `dryRunAvailable`.
- `riskContext` is carried inside the feature 020 envelope and is identical for `--dry-run` preview and real execution.

## Idempotency and Resumability

- Re-running any `jolly create` subcommand or `jolly start` is safe and creates no duplicates; commands detect completed work and report it rather than erroring on "already exists". See feature `022-command-idempotency-and-resumability`.
- `jolly start` is resumable: it skips satisfied stages and continues from the first incomplete one; work done by individual subcommands and by `jolly start` is mutually recognized.

## Playwright and Browser OAuth

- `jolly login` (no flags) tries the native browser first (via `open`/`xdg-open`/`start`). If the native browser opens, standard OAuth flow runs. If native fails (headless), checks Playwright. If Playwright is available, automates headlessly. If neither works, directs user to cloud.saleor.io/tokens.
- `jolly login --browser` forces browser-based auth: native browser first, then Playwright fallback, then error with `--token` guidance.
- `jolly login --token <value>` always works regardless of browser availability.
- Playwright is a **headless fallback only** — on a machine with a display, the native browser is always preferred.
- Native browser detection: platform-appropriate open command. Exit code 0 = browser available.
- Playwright detection: import the `playwright` npm package + verify chromium executable exists on disk. Fast synchronous check, no browser launch.
- The `--dry-run` path (`jolly login --browser --dry-run`) shows PKCE material and auth URL without needing a browser or Playwright. This is how the @logic scenario tests the construction logic.
- The `@requires-browser` test tag gates on browser capability: native browser first, Playwright second. Harness checks in that order.
- Saleor Cloud email/password are **one-time login inputs, never persisted**: Jolly prompts on stdin when the Playwright flow needs them, holds them in memory only for the login flow, and stores only the resulting token (`.env` → `JOLLY_SALEOR_CLOUD_TOKEN`) plus the non-secret organization name (`.env` → `JOLLY_SALEOR_ORGANIZATION`). There are no Jolly env vars for email/password, and Jolly never reads them from the environment or files. If the Playwright flow gets no credentials on stdin, it errors with `--token` guidance.
- The test harness supplies Tier 2 credentials by piping `HARNESS_SALEOR_EMAIL` / `HARNESS_SALEOR_PASSWORD` (harness-only knobs, CI secrets — not Jolly settings) into Jolly's stdin prompt; if Playwright is available but these are absent, the scenario skips naming the missing knobs.
- Non-secret auth state lives in `.env` alongside the token: successful login stores the authenticated organization name as `JOLLY_SALEOR_ORGANIZATION`; `jolly auth status` reports it as the account context without a network call, reporting it as unknown (never an error) when absent; `jolly logout` removes it with the tokens.

## Current Workflow

This project is currently in planning mode.

- Write feature/planning files only unless explicitly instructed otherwise.
- Do not implement application code, add dependencies, or change runtime/configuration files without approval.
- Use `.feature` files for behavior and feature planning when possible.
- Discuss implementation plans interactively before making code changes.

## Three-Role Agent Workflow

New agent sessions must be able to continue from repository documents alone. Do not assume access to prior chat history. The durable handoff between roles is the committed project documentation, especially `.feature` files, tests, and this `AGENTS.md`.

Only the Captain converses with humans. The Quartermaster and Crew Mates do not converse with anyone, because conversations are not durable artifacts and instructions buried in past sessions are lost. When they hit something they cannot resolve from the committed specs, they stop, report that they cannot continue, and quit. They must not be given ad hoc instructions to work around the problem. The only way forward is to update the feature files and instructions so that the next run either succeeds or fails the same way — and is then refined again. This keeps every instruction explicit and preserved in source control.

### Captain

The Captain is the product/technical discovery agent that talks with the customer and decision maker.

- The Captain and customer collaboratively "vibe code" feature files and agent instructions only.
- The Captain's durable artifact is the written specification-as-code: `.feature` files and agent instructions containing everything the Quartermaster and Crew Mates need without chat context.
- The Captain must not create or edit tests, step definitions, fixtures, or production code — but it **can and should delete them**. Code is disposable and git preserves history: whenever the Captain changes feature files or instructions, it ruthlessly deletes every test, step definition, fixture, and piece of production code the spec change might have invalidated — **if there is even a small chance an artifact is impacted, delete it**; err on the side of deletion, never on the side of leaving stale artifacts that encode dead requirements. The QM and Crew Mates regenerate the deleted coverage and code from the updated specs on their next run — written fresh from the specs, never restored from git history.
- The Captain should actively ask focused questions, synthesize answers, and document decisions in `.feature` files.
- The Captain should identify assumptions, risks, contradictions, and open questions instead of silently guessing.
- The Captain should keep plans implementation-ready while avoiding implementation until explicitly approved.
- The Captain should update this `AGENTS.md` file when durable workflow, stack, or project-level decisions are made.

### Quartermaster (QM)

The Quartermaster converts the Captain's written specs into executable test coverage and keeps the test inventory aligned with the feature files. The QM's domain is test infrastructure — never spec writing and never (under normal circumstances) production code.

- The QM has no knowledge of the Captain conversation and must rely only on repository feature files, tests, and instructions.
- The QM writes and maintains tests, Cucumber step definitions, fixtures, and test harnesses as durable assets.
- The QM must not write production/application implementation code under normal circumstances.
- **Fallback rule:** If and only if no Crew Mate subagent dispatch mechanism is available (no `/crew` command, no subagent tool), the QM falls through to Crew Mate behavior after writing failing tests, implementing the production code needed to make them pass. This is the only exception to the no-production-code rule.
- The QM must track required feature scenarios and steps, ensure all required steps have corresponding executable coverage, and identify missing coverage.
- When feature steps are changed or deleted, the QM must update or remove obsolete tests, step definitions, fixtures, and related test-only code so stale requirements do not remain.
- When the Captain has deleted tests, step definitions, fixtures, or harness code after a spec change, the QM regenerates that coverage **from the committed specs alone**. It must not restore the deleted files from git history — neither wholesale nor with mechanical fix-ups — because deleted artifacts may encode requirements the spec change retired. Git history is for archaeology, not resurrection; the deletion is the point.
- The QM should preserve traceability between `.feature` scenarios/steps and executable tests.
- The QM does not converse with the Captain, customer, or any human; its only inputs are the committed feature files, tests, and instructions.
- If a requirement is ambiguous, contradictory, missing, or impossible to test from the written specs, the QM must stop, report that it cannot continue, and quit rather than invent product behavior. It must not be steered with ad hoc instructions; the feature files and instructions are updated first, then the QM is re-run.
- The QM tests behavior the specs concretely define. It treats "Open questions" blocks and anything marked "deferred to CLI design" as non-normative and out of scope, not as blockers.
- Missing product implementation is expected, not a blocker: the QM writes failing (red) tests against the specified contract for Crew Mates to satisfy.
- For steps qualified by "where possible", "where APIs allow", or "appropriate", the QM tests the path the sandbox supports and marks environment-dependent branches as conditionally skipped rather than stopping.
- A genuine blocker is a missing or contradictory normative requirement, or a missing harness convention — only then does the QM stop, report, and quit.
- The QM derives its worklist from test status, not from human direction: undefined scenarios (`cucumber-js --dry-run`) need step definitions, failing scenarios need a Crew Mate, green scenarios are done. It should not need to be told which features or scenarios to work on.
- A Crew Mate's durable inputs are the committed tests and specs, not the QM's dispatch prompt; the QM points a Crew Mate at a specific failing scenario/test rather than handing it novel product instructions.
- When a Crew Mate reports it is blocked, the QM does not improvise around it. It stops that work and surfaces the blocker; resolution is updated feature files and instructions, then a re-run.

### Crew Mates

Crew Mates are implementation agents. They do nothing except make specified tests/steps pass according to the written specs.

- Crew Mates must read the relevant feature files, tests, and agent instructions before changing implementation code.
- Crew Mates run tests, choose a failing scenario or step, and implement the minimal production/application code needed to make that step pass.
- Crew Mates must follow the specs exactly and must never choose another approach when the specs prescribe one.
- Crew Mates do not converse with anyone; their only inputs are the committed feature files, tests, and instructions, and their only output is code that makes specified tests pass.
- If a Crew Mate encounters any obstacle, ambiguity, missing detail, contradictory requirement, failing external dependency, impossible test, or uncertainty of any kind, it must stop, report that it cannot continue, and quit. It must not be given ad hoc instructions to work around the problem; the feature files and instructions are updated first, then the Crew Mate is re-run so the next attempt either succeeds or fails the same way.
- Crew Mates must not change feature files, test intent, or acceptance criteria unless explicitly instructed by the Captain/customer through updated specs.
- Crew Mates must not broaden scope, add unrequested behavior, or refactor unrelated code.
- Crew Mate progress is measured by tests passing, not by a separate hand-written checklist.
- Crew Mates are launched by the QM as subagents (or via the `/crew` command) to make a specific failing scenario pass; they read the committed tests and specs, never the dispatch prompt, for product behavior.

## Role session kickoff

Each role can be started in a fresh Claude Code session via a project slash command. Durable role behavior lives in the committed charter above, not in chat.

- `/captain` — discovery: update feature files and instructions; resolve blockers raised by the QM or Crew.
- `/qm` — Quartermaster: build/extend the test harness, write failing tests, and launch Crew Mates to implement them.
- `/crew` — run a single Crew Mate against a named scenario.

The QM launches Crew Mates programmatically using the `crew-mate` subagent (`.claude/agents/crew-mate.md`); `/crew` is the manual entry point for the same role.

## Spec-Driven Development Philosophy

- During discovery, agents should collaboratively "vibe code" feature/spec files only.
- Feature files and tests are the project's core durable assets.
- Application code is considered disposable and may be regenerated by implementation agents from the specs.
- Todo/progress state should be derived from passing or failing tests, not maintained as a separate hand-written checklist.
- Planning agents should write implementation-ready specs for a separate implementation agent to turn into code later.

## Testing Strategy

- Package scripts are Bun-native: logic-tier runner is `bun test`; BDD layer is Cucumber.js invoked through Bun (`bun run test:bdd`). Node >= 23 remains a documented fallback runtime (it strips types on import), never the script default. See feature `023-test-architecture`.
- Feature `023-test-architecture` is the harness charter — already satisfied by `features/support/` and `tests/sandbox.test.ts`. It is tagged `@meta` and excluded from the BDD worklist; do not write Cucumber step definitions for it.
- **Sandbox over mocks:** tests exercise real accounts (Saleor Cloud, Configurator, Vercel, Stripe) rather than mocks. Avoid mocks unless a condition cannot reasonably be produced in a sandbox (for example injected failures or unavailable-capability branches).
- Two test tiers:
  - Logic tier — pure local behavior (output-envelope shaping, flag parsing, URL normalization, risk-context construction). No accounts; always runs. Tagged `@logic`.
  - Sandbox tier — behavior that touches Saleor Cloud, Configurator, Vercel, or Stripe. Real accounts; tagged `@sandbox`.
- **One configuration everywhere:** tests read the same runtime `JOLLY_*` environment variables Jolly itself uses — identical names across dev, test, and production. There is no test-only credential namespace (no `JOLLY_TEST_*`). The accounts behind them are expected to be dedicated test accounts, but that is the customer's choice to make and set; Jolly and the tests never know or check which kind they are. When required `JOLLY_*` credentials are absent, `@sandbox` tests are skipped (not failed) with a clear reason so the suite still runs locally; CI provides the credentials for full coverage. Harness-internal knobs (artifact path overrides, per-run id, runtime selection) are not Jolly settings and use a `HARNESS_*` prefix.
- **Environmental skips beyond credentials:** when a sandbox run is prevented by the
  account's capacity rather than Jolly's behavior — e.g. the Cloud API rejects environment
  creation with the feature 012 `ENVIRONMENT_LIMIT_REACHED` condition — the scenario is
  skipped with a clear reason, not failed. Premises the harness cannot produce harmlessly
  (it never deletes pre-existing resources to manufacture a precondition) are treated the
  same way.
- **Harmless by design:** sandbox tests must be safe to run against any store, including production. They never name-check or refuse a target. They never modify or delete resources the run did not create (read-only, non-mutating queries of pre-existing resources are allowed only where a spec requires verifying live access, as feature 019 does); created resources carry a unique per-run namespace and stay unpublished/inactive where the platform allows; shared-setting changes are allowed only when additive and reverted in teardown (for example trusted origins); payment flows use test card numbers only, so live payment credentials at worst yield a declined card. Teardown is idempotent and best-effort, reporting anything it could not remove; tests stay safe to re-run (leaning on feature 022).
- Layout: step definitions in `features/step_definitions/<feature-slug>.steps.ts`; shared hooks/world/sandbox setup/teardown/credential-gating in `features/support/`; logic-tier unit tests in `tests/`. Each `.feature` maps to a step-definition file of the same slug. The QM creates and maintains the Cucumber configuration and `test` scripts as part of the harness.
- DOM-level checks (homepage, storefront rendering) use happy-dom; prefer happy-dom for DOM behavior and do not duplicate it in lower-level tests.
- Security, authentication, and usage-control behavior must always have enforcement-level tests so enforcement does not depend on frontend behavior.

## Secret and Environment Handling

- Jolly v1 should store local secrets as environment variables in `.env`.
- Jolly workflow credentials should use `JOLLY_*` names, while generated/cloned storefront runtime variables should use the target project's expected names such as Paper's `NEXT_PUBLIC_SALEOR_API_URL` and `SALEOR_APP_TOKEN`.
- Jolly must ensure `.env` is ignored by Git before writing secrets.
- After writing or updating `.env`, Jolly should load the updated values for the current command flow where possible.
- When a parent shell must be updated, Jolly should provide clear source/export guidance rather than pretending it can mutate the parent shell directly.
- Jolly output must not print secret values.

## Saleor Source Repository Boundaries

- Use `saleor/storefront` directly as the first storefront baseline.
- Use `saleor/configurator` directly where Jolly needs Saleor configuration-as-code, introspection, diffing, planning, or deployment of store configuration.
- Use or draw upon `saleor/agent-skills` and `saleor/storefront` embedded skills/instructions for agent guidance.
- Treat `saleor/cli` as deprecated source material only; do not depend on it, require it, shell out to it, or instruct customers to install it.
- Re-check upstream Saleor repositories at implementation time because their commands, branches, and setup flows may change.

## Existing Scaffold

Project config: `package.json`, `tsconfig.json`, `.gitignore`.

The test harness is in place (see Testing Strategy): `cucumber.js`, `features/support/`
(world, hooks, sandbox gating on runtime `JOLLY_*` credentials), one step-definition file
per feature in `features/step_definitions/`, and `tests/` (logic-tier units). Role
commands live under `.claude/`.

`src/index.ts` and `src/lib/` hold the Crew-Mate-built CLI; `homepage/` holds the
homepage and agent setup guide. All of it is disposable and regenerated from the specs
when they change.
