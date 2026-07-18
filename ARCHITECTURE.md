# Architecture Overview

Follows the [architecture.md](https://architecture.md/) convention: a self-contained orientation document so an agent can grasp this codebase quickly, without chasing facts across five files.

That self-containment is a deliberate trade. This repository otherwise keeps one home per fact — machine-read tooling values in `RIGGING.md`, tooling prose in `AGENTS.md`, binding behaviour in `features/*.feature` — and a hand-maintained second copy drifts. It drifted on its first day: this document listed `happy-dom` as a verification technology because `AGENTS.md` says so, and neither is true.

So the copies are kept honest by a check, not by discipline. The structural claims below are pinned by a `@logic @invariant` conformance scenario, the same way `assets/messages/cli.json` is pinned by `copy-catalog-conformance.ts`. A claim here that drifts from the tree fails verification. Where a fact is not evident from the repository, this document says so rather than speculating.

Product intent lives in `features/*.feature` and referenced `assets/**` — never here. This document describes; it does not bind. The architecture is specified nowhere but the specs: behaviour lives in `features/`, and `src/` is rebuilt from it. This document is downstream of both — a snapshot of what the tree currently is. When it and the tree disagree, the tree wins and this document is refit.

## 1. Project Structure

```
jolly/
├── assets/                  # Human-authored durable material (not spec-driven)
│   ├── homepage/            # Vercel-deployed homepage (jolly.cool)
│   │   ├── index.html       # Landing page
│   │   ├── setup.md         # Setup guide (served at /setup)
│   │   └── vercel.json      # Vercel config (rewrites /setup -> setup.md)
│   ├── messages/            # CLI message catalog (cli.json)
│   └── skills/jolly/        # Jolly skill (recipe.yml + SKILL.md)
├── bin/
│   └── jolly                # Published CLI launcher: plain CommonJS-compatible JS
│                            # that guards Node >= 20.12 then imports ../dist/index.js
├── dist/
│   └── index.js             # esbuild-bundled CLI (prepublish build)
├── src/                     # CLI implementation (disposable — rebuilt by specs)
│   ├── index.ts             # Single-file CLI entry (~5900 lines, all commands)
│   └── lib/                 # Library modules
│       ├── cloud-api.ts     # Saleor Cloud API client (orgs, projects, environments)
│       ├── completion.ts    # Shell completion logic
│       ├── device-grant.ts  # OAuth device authorization grant flow
│       ├── env-file.ts      # .env file read/write
│       ├── hosts.ts         # First-party host validation
│       ├── messages.ts      # CLI message lookup from catalog
│       ├── saleor-url.ts    # Saleor URL normalization
│       └── start-close.ts   # Interactive close/summary display
├── features/                # BDD specs (Gherkin .feature files)
│   ├── step_definitions/    # Cucumber step definitions (one per feature)
│   │   ├── *.steps.ts       # 33 step-definition files
│   │   └── shared.steps.ts  # Shared step definitions
│   └── support/             # Test harness + shared support
│       ├── hooks.ts         # Cucumber hooks (BeforeAll/AfterAll/Before/After)
│       ├── world.ts         # Custom Cucumber World class
│       ├── sandbox.ts       # Sandbox resource isolation
│       ├── provision.ts     # Shared store provisioning + reclaim
│       ├── cloud.ts         # Saleor Cloud API helpers (harness-side)
│       ├── pty.ts           # PTY/interactive session management
│       ├── envelope.ts      # Output envelope assertion helpers
│       ├── eval.ts          # @eval tier harness (live agent)
│       └── ...              # 25+ additional support files
├── tests/                   # Logic-tier unit tests (node --test)
│       ├── cloud-api-scheme.test.ts
│       ├── env-file.test.ts
│       ├── envelope.test.ts
│       ├── first-party-hosts.test.ts
│       ├── honesty.test.ts
│       ├── node-launcher.test.ts
│       ├── saleor-url.test.ts
│       └── start-close.test.ts
├── assets/                  # (see above)
├── AGENTS.md                # Agent/tooling configuration
├── RIGGING.md               # Machine-readable tooling values (tiers, commands, deps)
├── CAPTAIN.md               # Captain worklist + blockers
├── SCENARIO_WRITING.md      # Scenario writing guide
├── cucumber.js              # Cucumber profile configuration (logic/sandbox/eval/all)
├── package.json             # @dk/jolly — npm package
├── tsconfig.json            # TypeScript config (noEmit, bundler resolution)
├── .gplintrc                # Gherkin feature file linter config
└── ARCHITECTURE.md          # This document
```

## 2. High-Level System Diagram

```
                     ┌──────────────────────────────┐
                     │       Customer's Agent       │
                     │  (Claude Code / Zed / Pi)    │
                     └──────────────────────────────┘
                             │                   │
                             │ npx jolly         │ npx vercel / npx @saleor/
                             │                   │  configurator / git / pnpm
                             ▼                   │
            ┌──────────────────────────┐
            │        Jolly CLI         │
            │      (src/index.ts)      │
            │                          │
            │ Shells out to:           │
            │ • git clone / init       │
            │ • npx pnpm install       │
            │ • npx @saleor/           │
            │   configurator deploy    │
            │ • npx vercel login       │
            │ • npx vercel deploy      │
            │ • npx vercel env ...     │
            │ Installs via:            │
            │ • npx skills add         │
            └──────────────────────────┘
                                                 │
                        HTTPS (fetch)            │
                      ▼                          │
                                                 │
            ┌────────────────────────────────────────┐
            │          Saleor Cloud API              │
            │   (cloud.saleor.io REST + GraphQL)     │
            │                                        │
            │ • Create orgs, projects, envs          │
            │ • Seed recipe (stock, collections)     │
            │ • Install Stripe app via GraphQL       │
            └────────────────────────────────────────┘
                ┌───────────────┼─────────────────┐
                ▼               ▼                 ▼
         ┌────────────┐    ┌────────┐    ┌────────────────┐
         │ Saleor     │    │ Vercel │    │ Stripe         │
         │ Cloud      │    │ (spawn)│    │ (via Saleor    │
         │ Store      │    └────────┘    │  appInstall)   │
         │ (hosted)   │                  └────────────────┘
         └────────────┘
```

**Key:** Within `jolly start`, Jolly orchestrates a multi-stage pipeline —
some stages it performs itself via HTTPS (auth, store provisioning, stock
seeding, Stripe app install), and others by spawning the official CLI
(storefront clone via `git`, dependency install via `npx pnpm`, recipe
deploy via `npx @saleor/configurator`, Vercel deploy via `npx vercel`).
Jolly holds a Saleor Cloud token but no Vercel or Stripe token — each
spawned CLI uses its own independent auth session. Every `npx` spawn
uses `--yes` to suppress npx's confirmation prompt.

## 3. Core Components

### 3.1. CLI (src/index.ts)

**Name:** Jolly CLI

**Description:** Single-file TypeScript CLI (~5900 lines) implementing all commands: `login`, `logout`, `auth status`, `create store` (paste URL or `--create-environment`), `doctor`, `start`, `init`, `upgrade`, `skills`. Every command emits exactly one output envelope `{ tool, command, status, summary, data, checks, nextSteps, errors }` in JSON or human-readable format. Uses `@bomb.sh/args` for argument parsing and `@clack/prompts` for interactive prompts (routed to stderr to keep stdout clean for piping).

The `start` command orchestrates an 8-stage pipeline via `spawn`/`spawnSync`:

| Stage | Jolly action | External CLI spawned |
|---|---|---|
| **init** | Install skills, write config | `npx skills add` |
| **auth** | OAuth device code flow via HTTPS | — |
| **store** | Create Saleor Cloud env via REST | — |
| **storefront** | Clone Paper, init repo, install deps | `git clone`, `git init`, `npx pnpm install` |
| **recipe** | Deploy starter recipe | `npx @saleor/configurator deploy` |
| **stock** | Seed product stock via GraphQL | — |
| **deploy** | Vercel deploy + env vars + protection | `npx vercel whoami`, `login`, `deploy`, `project add`, `project protection disable`, `link`, `env rm`, `env add` |
| **stripe** | Install Stripe app via GraphQL | — |

Jolly never reimplements another tool's API — it spawns the official CLI for
that tool under its own auth. The deprecated `saleor/cli` is never invoked.

**Technologies:** TypeScript, Node.js >= 23 (dev) / >= 20.12 (prod), `@bomb.sh/args`, `@clack/prompts`, `yaml`

**Deployment:** Published as `@dk/jolly` on npm. Built by esbuild into `dist/index.js`.

### 3.2. Library Modules (src/lib/)

| Module | Responsibility |
|---|---|
| `cloud-api.ts` | Saleor Cloud API REST client — organizations, projects, environments, recipe seeding, Stripe app installation |
| `device-grant.ts` | OAuth device authorization grant flow (Saleor Cloud) |
| `env-file.ts` | `.env` file reading/writing (managed auth variables) |
| `hosts.ts` | First-party host validation (Saleor Cloud URL guard) |
| `messages.ts` | CLI message lookup from `assets/messages/cli.json` |
| `saleor-url.ts` | Saleor URL normalization |
| `start-close.ts` | Interactive close/summary display (post-`start` command) |
| `completion.ts` | Shell completion logic |

### 3.3. BDD Verification (features/)

**Name:** Cucumber-based multi-tier verification suite

**Description:** 31 Gherkin feature files covering the full command surface. Three test tiers:
- **`@logic`** — parallel, fast, local behavior checks (output envelope shape, redaction, host enumeration, pure helpers)
- **`@sandbox`** — real-account, side-effecting tests against Saleor Cloud + Vercel; resources are `jolly-cannon-fodder`-namespaced and torn down
- **`@eval`** — opt-in live agent evaluation (requires `HARNESS_OPENROUTER_API_KEY`); required green/red gate

Policies: real services only (no mocks/fakes), harmless-by-design (namespace + teardown), zero tolerated failures/skips.

**Technologies:** TypeScript, `@cucumber/cucumber`, `ts-morph` (structural conformance checkers), `c8` (coverage)

### 3.4. Logic-Tier Unit Tests (tests/)

**Name:** Unit tests

**Description:** 8 files covering pure-logic modules (CLI envelope, env-file, hosts, Saleor URL parsing, etc.). Run via `node --test`.

## 4. Data Stores

### 4.1. Environment Variables / .env

**Name:** Local credential store

**Type:** `.env` file

**Purpose:** All runtime credentials and configuration. Namespace: `JOLLY_*` for Saleor Cloud, `HARNESS_*` for harness-specific knobs. Managed by the CLI itself (`login`, `logout`, `auth status` commands write/read env vars).

**Key Variables:** `JOLLY_SALEOR_CLOUD_TOKEN`, `SALEOR_URL`, `SALEOR_TOKEN` (derived), `HARNESS_OPENROUTER_API_KEY`, `HARNESS_EVAL_MODEL`

### 4.2. Shared Store Marker (Sandbox)

**Name:** Shared sandbox store marker

**Type:** Local file (`features/support/provision.ts` persistent marker)

**Purpose:** Caches the last known-good `jolly-cannon-fodder-shared-<random>` Saleor Cloud environment across cucumber invocations, avoiding the minutes-long create+deploy cost every run.

## 5. External Integrations / APIs

| Service | Purpose | Integration Method |
|---|---|---|
| **Saleor Cloud API** (`cloud.saleor.io`) | Create/manage organizations, projects, environments; install Stripe app; seed recipe data | REST API via HTTPS `fetch` (`cloud-api.ts`) |
| **Saleor GraphQL API** (`*.saleor.cloud/graphql/`) | Probe store endpoints, check payment gateways, channel purchasability | GraphQL via HTTPS `fetch` (`features/support/saleor-graphql.ts`) |
| **Saleor Configurator** (`npx @saleor/configurator`) | Deploy starter recipe to Saleor environment | Spawned via `spawnSync` (feature 004, 019) |
| **Vercel CLI** (`npx vercel`) | `login`, `whoami`, `deploy --prod`, `project add`, `project protection disable`, `link`, `env rm`, `env add` | Spawned via `spawn`/`spawnSync` — Jolly holds no Vercel token |
| **git** | Clone Paper storefront, init new repo | Spawned via `spawnSync` |
| **pnpm** (`npx pnpm`) | Install storefront dependencies | Spawned via `spawnSync` |
| **Stripe** | Payment processing | Installed as Saleor app via Saleor GraphQL `appInstall` (feature 005) — no Stripe API call from Jolly |
| **Vercel (homepage)** | Homepage deployment (jolly.cool) | `npx vercel deploy` from `assets/homepage/` |

## 6. Deployment & Infrastructure

| Aspect | Details |
|---|---|
| **Registry** | npm (`npx @dk/jolly`) |
| **Homepage** | Vercel (jolly.cool) — `assets/homepage/` |
| **CI/CD** | git push to main (trunk-based); npm publish for releases |
| **Node version** | 23+ (dev), 20.12+ (prod) |
| **Build** | esbuild bundles `src/index.ts` → `dist/index.js` |
| **Type checking** | `tsc --noEmit` (strict mode) |
| **Linting** | `gplint "features/*.feature"` (Gherkin lint) |

## 7. Security Considerations

| Aspect | Detail |
|---|---|
| **Authentication** | Saleor Cloud staff token (stored in `.env`); OAuth device grant flow for interactive login |
| **Secrets handling** | Secrets referenced by name in output — never printed. Derived `SALEOR_TOKEN` tracked by harness for output-safety assertions |
| **Token storage** | `.env` file managed by CLI commands; agent-resume mechanism persists pending device auth |
| **First-party guard** | `hosts.ts` validates Saleor Cloud URLs before token injection |
| **Real-service policy** | No test doubles, no fake credentials — safety is harmless-by-design (namespace + teardown), never credential-faking |

## 8. Development & Testing Environment

| Aspect | Detail |
|---|---|
| **Setup** | `npm install`, copy `.env` with `JOLLY_SALEOR_CLOUD_TOKEN`, `npx skills add dmytri/shipshape --skill '*'` |
| **Dev server** | `npm run dev` (node --watch src/index.ts) |
| **Logic tests** | `npm run test:logic` — `cucumber-js -p logic` (parallel, fast) |
| **Sandbox tests** | `npm run test:sandbox` — real Saleor Cloud + Vercel |
| **Eval tests** | `npm run test:eval` — live agent (requires `HARNESS_OPENROUTER_API_KEY`) |
| **Unit tests** | `npm test` — `node --test tests/**/*.test.ts` |
| **Type check** | `npm run typecheck` — `tsc --noEmit` |
| **Lint** | `npx gplint "features/*.feature"` |
| **Coverage** | `npx c8` with logic, sandbox, and eval profiles |
| **Reclaim** | `npm run reclaim` — clean stale `jolly-cannon-fodder` resources |

## 9. Design Invariants

Standing properties of the current design. This section holds no roadmap, backlog, or decision log: planned work lives in `.feature` specs and `watchbill.json`, and rationale lives in git history.

- `src/` is intentionally disposable — rebuilt by Crew Mates when specs change. Currently a single 5,914-line `index.ts` plus eight library modules in `src/lib/`.
- `@eval` is the only model-invoking tier. Every other tier reports zero model invocations and zero tokens; `verification-economy.feature` makes this executable rather than aspirational.

## 10. Project Identification

| Field | Value |
|---|---|
| **Project Name** | Jolly |
| **Package** | `@dk/jolly` |
| **Repository URL** | https://github.com/dmytri/jolly |
| **Homepage** | https://jolly.cool |
| **Primary Contact** | Dmytri Kleiner |

## 11. Glossary / Acronyms

| Term | Definition |
|---|---|
| **CLI output envelope** | Standardized JSON structure every Jolly command emits: `{ tool, command, status, summary, data, checks, nextSteps, errors }` (feature 020) |
| **First-party host** | A `*.saleor.cloud` domain validated by `hosts.ts` to guard against token injection to arbitrary URLs |
| **HARNESS_*** | Namespace for cucumber harness configuration knobs (not `JOLLY_*`) |
| **Harmless-by-design** | Test discipline: namespace every created resource, register idempotent teardown, never touch what the test didn't create |
| **JOLLY_*** | Namespace for production credentials read from `.env` |
| **Live-by-design** | Policy: real services always, no mocks or fakes. Credentials present by fitting-out |
| **Shipshape** | Five-role agent workflow (Captain/QM/Crew/Boatswain/Shipwright) driving spec-first development. Shipwright works in harbour only: code inspection, fitting out, `@planks` annotations, `@captain` scenario skeletons |
| **@heavy** | Cucumber tag for scenarios requiring a full `jolly start`/deploy/provision — run serial |
| **@creates-env** | Cucumber tag for scenarios that test environment creation/reclaim — run serial, self-provisioning |
| **@logic / @sandbox / @eval** | Test tiers: fast behavior, real-service integration, live agent evaluation |
