# Agent Instructions

## Required Shipshape Workflow

This repository uses Shipshape for its three-role, spec-driven agent workflow.

Before doing substantive work, install or load Shipshape for your active agent runtime:

```bash
npx skills add dmytri/shipshape --skill '*'
```

For Claude Code:

```bash
npx skills add dmytri/shipshape --agent claude-code --skill '*'
```

For Zed:

```bash
npx skills add dmytri/shipshape --agent zed --skill '*'
```

For Pi:

```bash
pi install npm:pi-shipshape
```

Then reload/restart the agent runtime if needed.

Substantive work means changing specs, tests, fixtures, harnesses, implementation code, docs that encode product behavior, or agent workflow instructions. Reading files to verify setup is allowed.

If Shipshape is not available and cannot be installed, stop and report that blocker before editing.

Do not recreate `/captain`, `/qm`, `/crew`, `/clearrole`, or generic role prompts locally in this repository. Shipshape owns the workflow. Jolly-specific project constraints live in this file.

## Project Stack

- Development runtime/package manager: Bun (dev environment only — never a customer-facing requirement)
- Published CLI runtime: Node.js >= 23 (native type stripping); the `bin/jolly` launcher runs under Node and never invokes or requires Bun (decision 2026-06-12, feature 006)
- Language: TypeScript
- Module system: ES modules
- Entry point: `src/index.ts`
- CLI distribution target: executable via `npx` with package `@dk/jolly` — the only package name, everywhere (decision 2026-06-12); never mention any `@saleor/...` package, not even as "future/official" — with subcommands such as `init`, `create`, and `start`; `package.json` `engines` declares the Node requirement and must not require Bun
- Package scripts:
  - `bun run start` runs the app
  - `bun run dev` runs the app in watch mode

## Product Vision

- **Name:** Jolly
- **Author and affiliation (decision 2026-06-12):** Jolly is a tool by Dmytri Kleiner
  that helps agents set up a store quickly using Saleor, Vercel and Stripe. It is **not
  an official product of Saleor, Vercel, or Stripe**; all public-facing copy and output
  must make this clear and never imply official status. The package is `@dk/jolly`
  (source: https://github.com/dmytri/jolly).
- **Tagline:** Ahoy, agent. Go build a store.
- **Purpose:** Jolly, via the customer's own agent, helps people set up a fully operational end-to-end commerce experience on Saleor Cloud.
- **Primary users:** AI agents and agent skills are the primary consumers; human developer DX should remain decent but secondary.
- **Product shape:** Homepage + CLI + agent skills/setup instructions. Two phases: setup (fast automated path to a working storefront) and iteration (agent + Jolly diagnostics + skills for ongoing customization).
- **Homepage:** Includes a prominent copy box ("copy this to your agent to get started") linking to the Jolly agent setup guide.
- **CLI:** Designed for agents first, not direct human use first. Executable via `npx` without a prior global install.
- **Inspiration:** swamp.club.
- **Core principle:** Jolly exists to empower the customer's own agent, not replace it. The customer's agent remains the primary orchestrator, explainer, and approval manager. Jolly provides capabilities, setup automation, wrappers, diagnostics, and local/project automation that make the agent more effective.
- **Zero unnecessary friction:** The path from copying the Jolly homepage prompt to a working deployed storefront requires only the human actions that cannot be automated — new account creation, browser OAuth consent, and providing secret values. Everything else Jolly and the agent handle automatically using safe defaults.
- **Architectural complement:** Jolly is complementary to the Saleor MCP server (mcp.saleor.app). The MCP server is read-only and provides live store data access — products, orders, and customers — for an already-configured store. Jolly handles setup automation, local project scaffolding, deployment orchestration, skill management, and diagnostics. As part of `jolly init`, Jolly configures a local mcp-graphql server against the customer's own store endpoint and informs the agent that mcp.saleor.app exists for later use — Jolly itself never connects to mcp.saleor.app.

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
- Canonical homepage URL: **https://jolly.cool** (customer decision, 2026-06-12). The
  agent setup guide is **https://jolly.cool/setup** (served from `homepage/setup.md`
  via a rewrite in `homepage/vercel.json`). The homepage deploys to Vercel from the
  `homepage/` directory (Captain-owned; project link in `homepage/.vercel`).
- Project-local `.jolly/` artifacts and persistent report files are deferred until CLI design.

## CLI Output Contract

- Every command shares one structured output envelope so agents parse all commands identically. See feature `020-cli-output-contract`.
- Envelope fields: `command`, `status` (`success` | `warning` | `error`), `summary`, `data`, `checks`, `nextSteps`, `errors`.
- `checks[].status` reuses the doctor vocabulary: pass, warning, fail, skipped, unknown.
- With `--json`, stdout contains only the envelope; default mode adds concise human text; `--quiet` trims nonessential human text only.
- Stable `errors[].code` and check-id strings let agents branch programmatically; secrets are never printed and are referenced by name only.
- Field names use camelCase (for example `nextSteps`, `riskLevel`, `dryRunAvailable`), across the envelope and the feature 021 risk context.
- **No fabricated success (decision 2026-06-12):** verified/valid/connected/success claims
  and `pass` checks are permitted only for operations actually performed and confirmed in
  the run; storing without verifying is reported as exactly "stored, not verified"; junk
  input never yields success language; unimplemented behavior errors honestly instead of
  simulating (no placeholder tokens, invented ids, or input-pattern guessing). Dry-run
  previews show the real request (host, path, resolved identifiers). See feature 020.

## Network Boundaries (first-party hosts only)

Decision 2026-06-12 (see feature 020 Rule "First-party hosts only"): Jolly's code sends
network requests only to auth.saleor.io (Keycloak, realm saleor-cloud), cloud.saleor.io
(Cloud API + token page), the customer's *.saleor.cloud environment domains,
api.vercel.com, api.stripe.com, github.com (cloning saleor/storefront and skills), and
127.0.0.1 (OAuth callback). "Hosts Jolly contacts" stays exactly equal to the hosts in
Jolly's request-sending code. Secrets travel only to their own service (Saleor tokens →
Saleor hosts; Vercel token → api.vercel.com; Stripe keys → api.stripe.com; nothing to
github.com). `JOLLY_SALEOR_CLOUD_API_URL` optionally overrides the Cloud API base
(default `https://cloud.saleor.io/platform/api`) for proxy/self-routing setups.

Informational mentions are not contacts: mcp.saleor.app (the read-only Saleor MCP
server) is something Jolly *tells the agent about* for later use — Jolly never connects
to it during setup or otherwise. The `.mcp.json` Jolly writes configures a **local
mcp-graphql server against the customer's own store endpoint**, which is the actual
runtime behavior; keep that distinct from the informational mcp.saleor.app mention.

The hosts `id.saleor.online` and `api.saleor.cloud` are **retired** saleor/cli-era
remnants (live probe 2026-06-12: id.saleor.online is a Cloudflare stub; /verify and
/configure return 404) and must not appear in code, output, or specs. Token verification
is a real authenticated GET of the Cloud API organizations endpoint — see feature 018
Rule "Token verification is a real request or it is not verification".

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
- Saleor Cloud email/password are **one-time login inputs, never persisted**: Jolly prompts on stdin when the Playwright flow needs them, holds them in memory only for the login flow, and stores only the resulting token (`.env` → `JOLLY_SALEOR_CLOUD_TOKEN`). There are no Jolly env vars for email/password, and Jolly never reads them from the environment or files. If the Playwright flow gets no credentials on stdin, it errors with `--token` guidance.
- The test harness supplies Tier 2 credentials by piping `HARNESS_SALEOR_EMAIL` / `HARNESS_SALEOR_PASSWORD` (harness-only knobs, CI secrets — not Jolly settings) into Jolly's stdin prompt; if Playwright is available but these are absent, the scenario skips naming the missing knobs.

## Current Workflow

This project is currently in planning mode.

- Write feature/planning files only unless explicitly instructed otherwise.
- Do not implement application code, add dependencies, or change runtime/configuration files without approval.
- Use `.feature` files for behavior and feature planning when possible.
- Discuss implementation plans interactively before making code changes.

## Shipshape Workflow

Shipshape defines the generic Captain → Quartermaster → Crew Mate workflow. This file records only Jolly-specific constraints and project facts.

Do not reimplement generic Shipshape role prompts, slash commands, or workflow rules in this repository.

Jolly-specific role notes:

### Captain

- Jolly is currently in planning mode unless explicitly approved otherwise.
- Product behavior specs live in `features/*.feature`.
- Durable project decisions belong in `AGENTS.md` and relevant feature files.
- Captain may create/update `assets/**` for durable human-approved source material.
- When specs change, Captain may delete generated/derived tests, fixtures, harnesses, and implementation code that may have been invalidated.
- Captain must not delete `assets/**` unless specs explicitly retire the asset.

### Quartermaster

- Read `HANDOVER.md` for current state before deriving work.
- Derive the worklist from verification status:
  - `bunx cucumber-js --dry-run`
  - `bun run test:bdd`
  - `bun test`
  - `bun run typecheck`
- Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
- Shared hooks/world/sandbox setup live in `features/support/`.
- Logic-tier unit tests live in `tests/`.
- Sandbox tests use runtime `JOLLY_*` credentials only; there is no `JOLLY_TEST_*` namespace.

### Crew Mate

- CLI implementation lives under `src/`.
- `homepage/` is a Captain-owned asset — out of Crew Mate scope entirely.
- Implement the minimal production/application change needed to satisfy committed specs and tests.

## Durable Assets

Jolly follows Shipshape's `assets/` policy.

Use root `assets/` for durable human/Captain-authored source material such as approved copy, brand context, style direction, mockups, reference data, and approved fixture-like examples. It is currently empty.

The entire `homepage/` directory (`index.html`, styles, `setup.md`, `vercel.json` —
everything served at https://jolly.cool) is itself a Captain-owned asset:
Captain/human-authored, not specified in `.feature` files, not covered by tests, and never
worked on by Quartermaster or Crew Mate. The Captain edits it in place. The former
`assets/homepage/*` design sources (copy, style, context, setup-guide draft) were retired
on 2026-06-12 once the homepage was built and live — they remain in git history.

Quartermaster and Crew Mate may read `assets/**` and `homepage/**` but must not edit or delete them.

## Testing Strategy

- Package scripts are Bun-native: logic-tier runner is `bun test`; BDD layer is Cucumber.js invoked through Bun (`bun run test:bdd`). Node >= 23 remains a documented fallback runtime for the dev scripts (it strips types on import), never the script default. The published CLI itself targets Node (see Project Stack); tests must cover that the launcher works without Bun. See features `023-test-architecture` and `006`.
- Feature `023-test-architecture` is the harness charter — already satisfied by `features/support/` and `tests/sandbox.test.ts`. It is tagged `@meta` and excluded from the BDD worklist; do not write Cucumber step definitions for it.
- **Sandbox over mocks:** tests exercise real accounts (Saleor Cloud, Configurator, Vercel, Stripe) rather than mocks. Avoid mocks unless a condition cannot reasonably be produced in a sandbox (for example injected failures or unavailable-capability branches).
- Two test tiers:
  - Logic tier — pure local behavior (output-envelope shaping, flag parsing, URL normalization, risk-context construction). No accounts; always runs. Tagged `@logic`.
  - Sandbox tier — behavior that touches Saleor Cloud, Configurator, Vercel, or Stripe. Real accounts; tagged `@sandbox`.
- **One configuration everywhere:** tests read the same runtime `JOLLY_*` environment variables Jolly itself uses — identical names across dev, test, and production. There is no test-only credential namespace (no `JOLLY_TEST_*`). The accounts behind them are expected to be dedicated test accounts, but that is the customer's choice to make and set; Jolly and the tests never know or check which kind they are. When a needed Saleor endpoint or app token is not configured but `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness **provisions** a shared per-run environment and derives the missing values rather than skipping; `@sandbox` tests are skipped (not failed, with a clear reason) only when the needed credentials cannot be derived — the Cloud token itself, or Vercel/Stripe credentials. Harness-internal knobs (artifact path overrides, per-run id, runtime selection) are not Jolly settings and use a `HARNESS_*` prefix.
- **Environmental skips beyond credentials:** when a sandbox run is prevented by the
  account's capacity rather than Jolly's behavior — e.g. the Cloud API rejects environment
  creation with the feature 012 `ENVIRONMENT_LIMIT_REACHED` condition — the scenario is
  skipped with a clear reason, not failed. Premises the harness cannot produce harmlessly
  (it never deletes pre-existing resources to manufacture a precondition) are treated the
  same way.
- **Self-provisioned endpoints:** when `JOLLY_SALEOR_CLOUD_TOKEN` is present and a needed
  Saleor endpoint or app token is not configured, the harness provisions one shared
  environment per run instead of skipping (feature 023), and the feature 012
  environment-creation scenario runs whenever the Cloud token is present. Every
  test-created environment carries the per-run `jolly-test` namespace as its name and
  domain label (via `--name`/`--domain-label`); leftover `jolly-test` environments from
  previous runs block creation (interactive approval may delete them; otherwise skip
  naming the leftover); teardown deletes the created environment right after the run. The
  harness never deletes an environment it cannot positively identify as test-created.
- **Harmless by design:** sandbox tests must be safe to run against any store, including production. They never name-check or refuse a target. They never modify or delete resources the run did not create (read-only, non-mutating queries of pre-existing resources are allowed only where a spec requires verifying live access, as feature 019 does); created resources carry a unique per-run namespace and stay unpublished/inactive where the platform allows; shared-setting changes are allowed only when additive and reverted in teardown (for example trusted origins); payment flows use test card numbers only, so live payment credentials at worst yield a declined card. Teardown is idempotent and best-effort, reporting anything it could not remove; tests stay safe to re-run (leaning on feature 022).
- Layout: step definitions in `features/step_definitions/<feature-slug>.steps.ts`; shared hooks/world/sandbox setup/teardown/credential-gating in `features/support/`; logic-tier unit tests in `tests/`. Each `.feature` maps to a step-definition file of the same slug. The QM creates and maintains the Cucumber configuration and `test` scripts as part of the harness.
- DOM-level checks (storefront rendering) use happy-dom; prefer happy-dom for DOM behavior and do not duplicate it in lower-level tests. The homepage is a Captain-owned asset with no test coverage.
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
per feature in `features/step_definitions/`, and `tests/` (logic-tier units).

`src/index.ts` and `src/lib/` hold the Crew-Mate-built CLI; it is disposable and
regenerated from the specs when they change. `homepage/` holds the homepage and agent
setup guide as a Captain-owned asset (see Durable Assets) — it is not regenerated from
specs and is out of QM/Crew scope.
