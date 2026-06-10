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
- **Tagline:** Saleor's Hydrogen for the agentic age.
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
- The Captain should actively ask focused questions, synthesize answers, and document decisions in `.feature` files.
- The Captain should identify assumptions, risks, contradictions, and open questions instead of silently guessing.
- The Captain should keep plans implementation-ready while avoiding implementation until explicitly approved.
- The Captain should update this `AGENTS.md` file when durable workflow, stack, or project-level decisions are made.

### Quartermaster (QM)

The Quartermaster converts the Captain's written specs into executable test coverage and keeps the test inventory aligned with the feature files.

- The QM has no knowledge of the Captain conversation and must rely only on repository feature files, tests, and instructions.
- The QM writes and maintains tests, Cucumber step definitions, fixtures, and test harnesses as durable assets.
- The QM must not write production/application implementation code.
- The QM must track required feature scenarios and steps, ensure all required steps have corresponding executable coverage, and identify missing coverage.
- When feature steps are changed or deleted, the QM must update or remove obsolete tests, step definitions, fixtures, and related test-only code so stale requirements do not remain.
- The QM should preserve traceability between `.feature` scenarios/steps and executable tests.
- The QM does not converse with the Captain, customer, or any human; its only inputs are the committed feature files, tests, and instructions.
- If a requirement is ambiguous, contradictory, missing, or impossible to test from the written specs, the QM must stop, report that it cannot continue, and quit rather than invent product behavior. It must not be steered with ad hoc instructions; the feature files and instructions are updated first, then the QM is re-run.
- The QM tests behavior the specs concretely define. It treats "Open questions" blocks and anything marked "deferred to CLI design" as non-normative and out of scope, not as blockers.
- Missing product implementation is expected, not a blocker: the QM writes failing (red) tests against the specified contract for Crew Mates to satisfy.
- For steps qualified by "where possible", "where APIs allow", or "appropriate", the QM tests the path the sandbox supports and marks environment-dependent branches as conditionally skipped rather than stopping.
- A genuine blocker is a missing or contradictory normative requirement, or a missing harness convention — only then does the QM stop, report, and quit.

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

## Spec-Driven Development Philosophy

- During discovery, agents should collaboratively "vibe code" feature/spec files only.
- Feature files and tests are the project's core durable assets.
- Application code is considered disposable and may be regenerated by implementation agents from the specs.
- Todo/progress state should be derived from passing or failing tests, not maintained as a separate hand-written checklist.
- Planning agents should write implementation-ready specs for a separate implementation agent to turn into code later.

## Testing Strategy

- Test runner: `bun test`. BDD layer: Cucumber.js for Gherkin/spec-driven behavior. See feature `023-test-architecture`.
- **Sandbox over mocks:** tests exercise real dedicated test/sandbox accounts (Saleor Cloud, Configurator, Vercel, Stripe test mode) rather than mocks. Avoid mocks unless a condition cannot reasonably be produced in a sandbox (for example injected failures or unavailable-capability branches).
- Two test tiers:
  - Logic tier — pure local behavior (output-envelope shaping, flag parsing, URL normalization, risk-context construction). No accounts; always runs. Tagged `@logic`.
  - Sandbox tier — behavior that touches Saleor Cloud, Configurator, Vercel, or Stripe. Real test accounts; tagged `@sandbox`.
- Test/sandbox credentials use `JOLLY_TEST_*` environment variable names, distinct from runtime `JOLLY_*` names. When they are absent, `@sandbox` tests are skipped (not failed) with a clear reason so the suite still runs locally; CI provides the credentials for full coverage.
- Sandbox tests isolate and clean up: namespace created resources with a unique per-run id, tear them down idempotently, stay safe to re-run (leaning on feature 022), and refuse to target any non-sandbox/customer/production account.
- Layout: step definitions in `features/step_definitions/<feature-slug>.steps.ts`; shared hooks/world/sandbox setup/teardown/credential-gating in `features/support/`. Each `.feature` maps to a step-definition file of the same slug. The QM creates and maintains the Cucumber configuration and `test` scripts as part of the harness.
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

The initial minimal Bun scaffold has been left in place:

- `package.json`
- `tsconfig.json`
- `.gitignore`

`src/index.ts` has not been created yet.
