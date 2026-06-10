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
- **Product shape:** Homepage + CLI + agent skills/setup instructions.
- **Homepage:** Includes a prominent copy box ("copy this to your agent to get started") linking to the Jolly agent setup guide.
- **CLI:** Designed for agents first, not direct human use first. Executable via `npx` without a prior global install.
- **Inspiration:** swamp.club.
- **Data model:** Jolly-owned data model is open; Saleor commerce data lives in Saleor Cloud.
- **Core principle:** Jolly exists to empower the customer's own agent, not replace it. The customer's agent remains the primary orchestrator, explainer, and approval manager. Jolly provides capabilities, setup automation, wrappers, diagnostics, and local/project automation that make the agent more effective.
- **Architectural complement:** Jolly is complementary to the Saleor MCP server (mcp.saleor.io). The MCP server provides native tool-based access to Saleor Cloud resource management; Jolly handles local project scaffolding, deployment orchestration, skill management, and diagnostics. Jolly should inform the agent about the MCP server during setup.

## V1 Scope and Boundaries

- Saleor Cloud only; no self-hosted Saleor support in v1.
- Storefront baseline: `saleor/storefront` Paper template (Next.js App Router, React, TypeScript, GraphQL, Tailwind CSS, pnpm).
- Deployment target: Vercel.
- Payment provider: Stripe (test mode for first-run validation; live mode requires explicit customer choice).
- Jolly does not implement Saleor backend features.
- Jolly does not replace Saleor Dashboard.
- Jolly does not depend on the deprecated Saleor CLI; may study it as reference material only.
- No Jolly-owned auth, licensing, telemetry, quotas, paid feature gating, or usage controls in v1.
- No telemetry in v1.
- Post-setup storefront customization belongs to the customer's own agent and workflow.
- `jolly start` is optional convenience orchestration; every stage must also be available as composable commands the agent can call independently.
- Canonical homepage/setup-guide URL is deferred; use a placeholder until decided.
- Project-local `.jolly/` artifacts and persistent report files are deferred until CLI design.

## Current Workflow

This project is currently in planning mode.

- Write feature/planning files only unless explicitly instructed otherwise.
- Do not implement application code, add dependencies, or change runtime/configuration files without approval.
- Use `.feature` files for behavior and feature planning when possible.
- Discuss implementation plans interactively before making code changes.

## Three-Role Agent Workflow

New agent sessions must be able to continue from repository documents alone. Do not assume access to prior chat history. The durable handoff between roles is the committed project documentation, especially `.feature` files, tests, and this `AGENTS.md`.

### Captain

The Captain is the product/technical discovery agent that talks with the customer and decision maker.

- The Captain and customer collaboratively "vibe code" feature files and agent instructions only.
- The Captain must not write tests, application code, dependencies, or runtime/configuration changes unless the customer explicitly changes the project out of planning mode.
- The Captain's durable artifact is the written specification-as-code: `.feature` files and agent instructions containing everything the Quartermaster and Crew Mates need without chat context.
- The Captain should actively ask focused questions, synthesize answers, and document decisions in `.feature` files.
- The Captain should ask discovery questions one at a time, while preserving the broader question backlog and returning to it until all important discovery areas are covered.
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
- If a requirement is ambiguous, contradictory, missing, or impossible to test from the written specs, the QM must stop and ask the Captain/customer for clarification rather than inventing product behavior.

### Crew Mates

Crew Mates are implementation agents. They do nothing except make specified tests/steps pass according to the written specs.

- Crew Mates must read the relevant feature files, tests, and agent instructions before changing implementation code.
- Crew Mates run tests, choose a failing scenario or step, and implement the minimal production/application code needed to make that step pass.
- Crew Mates must follow the specs exactly and must never choose another approach when the specs prescribe one.
- If a Crew Mate encounters any obstacle, ambiguity, missing detail, contradictory requirement, failing external dependency, impossible test, or uncertainty of any kind, it must stop and ask for help/guidance instead of improvising.
- Crew Mates must not change feature files, test intent, or acceptance criteria unless explicitly instructed by the Captain/customer through updated specs.
- Crew Mates must not broaden scope, add unrequested behavior, or refactor unrelated code.
- Crew Mate progress is measured by tests passing, not by a separate hand-written checklist.

## Spec-Driven Development Philosophy

- The project follows a vibe-spec-to-spec-driven-development pattern.
- During discovery, agents should collaboratively "vibe code" feature/spec files only.
- Feature files and tests are the project's core durable assets.
- Application code is considered disposable and may be regenerated by implementation agents from the specs.
- Todo/progress state should be derived from passing or failing tests, not maintained as a separate hand-written checklist.
- Planning agents should write implementation-ready specs for a separate implementation agent to turn into code later.

## Testing Strategy

- Test runner: `bun test`.
- BDD layer: Cucumber.js should be used for Gherkin/spec-driven behavior where appropriate.
- DOM/integration environment: happy-dom.
- Prefer happy-dom integration tests whenever possible.
- Do not duplicate behavior in server tests when it is already covered by happy-dom integration tests.
- Security, authentication, and usage-control behavior must always have server-side tests to ensure enforcement does not depend on frontend behavior.

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
