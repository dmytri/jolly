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

- Development & CI runtime/package manager: **Node.js >= 23 + npm** (decision 2026-06-13:
  dropped Bun). The published CLI was always Node; making dev/CI Node too gives **dev/prod
  parity** and removes the runtime divergence that hid the 0.1.11/0.2.0 npx breakage — the test
  harness ran under `bun --bun`, where Bun masquerades as `node` and strips TypeScript, so the
  "runs on Node alone" check falsely passed while `npx @dk/jolly` was actually broken. Node >= 23
  runs the TypeScript dev/test sources directly via native type stripping (project files are not
  under `node_modules`); the published artifact is compiled JS (next bullet). Bun is no longer a
  dependency, requirement, or fallback anywhere in the project.
- Published CLI runtime: Node.js >= 23 running a **pre-built JS bundle** compiled from `src/`
  (correction 2026-06-13: NOT raw-`.ts` type stripping — Node disables that under `node_modules`,
  so an npm-installed CLI must run plain JS). The bundle is produced by **esbuild**
  (`esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js`, the
  `build`/`prepack`/`prepublishOnly` scripts); the `bin/jolly` launcher imports `../dist/index.js`
  and never invokes or requires Bun (decision 2026-06-12, feature 006)
- Language: TypeScript
- Module system: ES modules
- Entry point: `src/index.ts`
- CLI distribution target: executable via `npx` with package `@dk/jolly` — the only package name, everywhere (decision 2026-06-12); never mention any `@saleor/...` package, not even as "future/official" — `package.json` `engines` declares the Node requirement and must not require Bun
- CLI surface (decision 2026-06-13, `start` behavior amended 2026-06-14): the command list is unchanged — `login`, `logout`, `auth status`, `init`, `start`, `doctor`, `upgrade`, `skills`, and `create store` / `create app-token` (Saleor Cloud API) plus `create stripe` (writes Stripe keys to `.env`). The separate tool-wrapping subcommands `create deployment`, `deploy`, `create recipe`, and `create storefront` stay **retired**; per the 2026-06-14 "Agent-supervised orchestration" decision, that orchestration now lives **inside `jolly start`**, which spawns the official CLIs (`git`/`pnpm`/`@saleor/configurator`/`npx vercel`) itself rather than handing the agent a playbook (see Product Vision and feature 008)
- Package scripts (Node-native, decision 2026-06-13):
  - `npm start` runs the app (`node src/index.ts`)
  - `npm run dev` runs the app in watch mode (`node --watch src/index.ts`)
  - `npm run build` compiles `src/` to `dist/index.js` via esbuild (the published bundle)

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
- **Product shape:** Homepage + thin CLI + the **Jolly skill** (the end-to-end playbook that teaches the customer's agent how to drive the official CLIs) + the Saleor agent-skills Jolly installs. Two phases: setup (the agent, equipped by the Jolly skill, reaches a working deployed storefront in minutes from one step — `jolly start`) and iteration (agent + Jolly diagnostics + skills for ongoing customization).
- **The Jolly skill (decision 2026-06-13):** Jolly authors and ships a Jolly skill — agent guidance, installed via `npx skills add`, that walks the customer's own agent through the end-to-end setup using the official CLIs (`npx vercel`, `@saleor/configurator`, `git`, `pnpm`) and Jolly's thin helpers, pausing only for the unavoidable human steps. This skill is how "one step: `jolly start`" reaches a live store in minutes without Jolly orchestrating the tools itself. It is a Captain-owned content asset. **The skill carries the smoothness** of the whole product, so the MVP bar is: the *happy path* runs end-to-end (paste → live store with test-mode payment) with the agent directed to `jolly doctor` for recovery at any step. Keep it to that for v1 — exhaustive edge cases, every flag, and deeper recovery iterate once we have a working end-to-end we can really use.
- **Homepage:** Includes a prominent copy box ("copy this to your agent to get started") linking to the Jolly agent setup guide.
- **CLI:** Designed for agents first, not direct human use first. Executable via `npx` without a prior global install.
- **Inspiration:** swamp.club.
- **Core principle:** Jolly exists to empower the customer's own agent, not replace it. The customer's agent remains the primary orchestrator, explainer, and approval manager. Jolly provides capabilities, setup automation, wrappers, diagnostics, and local/project automation that make the agent more effective.
- **SUPERSEDED 2026-06-14 by "Agent-supervised orchestration" below** — the bullet immediately
  following reverses the "the agent runs the tools, not Jolly" stance for `jolly start`. The
  parts that survive (spawn official CLIs only — never raw-API reimplementation; each CLI uses
  its own auth so Jolly holds no new provider token; the deprecated `saleor/cli` stays banned)
  are restated there. Read this bullet as historical context for that decision.
- **Skill-driven, thin CLI — the agent runs the tools, not Jolly (decision 2026-06-13,
  superseding the same-day "Jolly runs the CLIs" drafts):** Jolly does not replace the agent
  and does not orchestrate the official tools itself. Where an official, maintained CLI exists
  for a job, **the customer's own agent runs it**, guided by the **Jolly skill** that Jolly
  installs. Jolly itself **never shells out to** the Vercel CLI or `@saleor/configurator`, never
  reimplements them against raw provider APIs, and holds no provider tokens those CLIs own.
  **Narrow exception — read-only Stripe CLI import (decision 2026-06-13):** `jolly create stripe`
  (no flags) may invoke the **Stripe CLI read-only** (`stripe config --list`) solely to import the
  test-mode keys the human/agent already authorized via `stripe login`, writing them to `.env`.
  This is a read of already-authorized local auth state, not orchestration: Jolly never runs the
  Stripe CLI's `login`/OAuth (that stays the human/agent step), issues no mutating Stripe CLI
  command, makes no network call by importing, and owns no Stripe token beyond the user's own keys
  it places in `.env`. The Vercel CLI and `@saleor/configurator` get no such exception.
  Division of labor:
  - **Jolly (thin, deterministic plumbing only):** acquire Saleor Cloud auth (`jolly login`)
    and app tokens (`jolly create app-token`), provision the Saleor store/environment via the
    Cloud API (`jolly create store`), install skills + write `.mcp.json` + scaffold env
    (`jolly init`), diagnose (`jolly doctor`), and bootstrap + emit the ordered playbook
    (`jolly start`). Jolly safely writes secrets to `.env` and never prints them.
  - **The customer's agent, guided by the Jolly skill, runs the official CLIs:** Vercel
    deployment via the **Vercel CLI** (`npx vercel`, authenticated by its own `vercel login`
    session); Saleor store configuration and recipes via **`@saleor/configurator`**; storefront
    creation via **`git`** + `saleor/storefront`; dependency install via **`pnpm`**; Stripe
    test-key acquisition via the official **Stripe CLI** (`npx @stripe/cli login`, browser OAuth —
    keys are ephemeral test-mode, and the agent swaps them for durable Dashboard keys before the
    ~90-day expiry; decision 2026-06-13).
  - There is **no `JOLLY_VERCEL_TOKEN`**, no Vercel API calls in Jolly's code, and no Jolly
    subcommand wrapping a CLI an agent should run (`create deployment`, `deploy`, `create
    recipe`, `create storefront` are retired — see feature 008).
  The one banned tool is the **deprecated** `saleor/cli` (study-only, never invoked). The
  first-party-host allowlist below governs only Jolly's *own* request-sending code; the CLIs the
  agent runs reach their own services under their own auth and are not Jolly's requests.
- **Agent-supervised orchestration — `jolly start` runs the mechanical steps for the agent
  (decision 2026-06-14, supersedes "the agent runs the tools, not Jolly" for `start`):** The
  evidence from the live acceptance run is that the skill-driven flow *works* and produces a
  real, browsable store, but has one genuinely fiddly, reliability-sensitive seam — the
  `@saleor/configurator` deploy (correct flags, blank-vs-sample environment, destructive-delete
  handling) — where a varied LLM re-improvising the choreography is the weak point. So `jolly
  start` becomes a **resumable end-to-end runner that deterministically executes the mechanical
  setup steps by spawning the official CLIs on the agent's behalf**, for reliability and honesty
  (it runs real CLIs and reports their real results, instead of emitting a playbook and trusting
  the agent re-derived it). Division of responsibility:
  - **Jolly orchestrates the mechanical, no-decision steps** by spawning the official CLIs:
    `git` clone of Paper, `pnpm install`, `@saleor/configurator diff`/`deploy` of the starter
    recipe, and the `npx vercel` deploy + env-var setup — plus its own plumbing (`login`,
    `create store`/`app-token`, the read-only `create stripe` import, `init`, `doctor`).
  - **What survives from the thin-CLI model:** Jolly spawns *official, current* CLIs only — it
    still **never reimplements** them against raw provider APIs. Each spawned CLI uses **its own
    auth session** (`vercel login`, the Saleor app token Jolly manages, the Stripe keys), so
    there is still **no `JOLLY_VERCEL_TOKEN`**, no Vercel token in Jolly's secrets, and
    `api.vercel.com` is still **not** in Jolly's *own* request allowlist (the Vercel CLI makes
    those calls). The deprecated `saleor/cli` stays banned.
  - **Interactive CLI gates = stdio passthrough, continue on exit.** When a spawned CLI needs the
    user (e.g. `vercel login`, `stripe login`), Jolly runs it with the terminal **passed straight
    through** — the user interacts with that CLI exactly as it directs (its own prompts, URL,
    browser-open, polling); Jolly needs zero per-CLI knowledge of the protocol. Jolly just
    **waits for the child to exit**: exit 0 → continue to the next step; non-zero → stop honestly
    (report the real failure, never fabricate success).
  - **Non-CLI human gates = announce and wait.** The steps no CLI can perform — creating an
    account (Saleor/Vercel/Stripe), **configuring Saleor's Stripe app in the Dashboard and
    mapping it to the channel**, or pasting a secret no CLI hands over — Jolly cannot automate.
    It prints the exact instruction/URL (in the feature 020 envelope so the agent can relay it),
    **waits** for the human to complete it, verifies what it can, then resumes.
  - **Agent stays the approval authority.** Before each high-risk Jolly-driven action (`create
    store`, configurator `deploy`, the Vercel deploy) `start` emits the feature 021 `riskContext`
    and **pauses for the agent to approve**, then resumes; an agent pre-authorization flag
    (`--yes`/pre-approve) lets it run straight through when the agent's policy allows. "Agents in
    charge" is preserved at the decision layer (the agent invokes `start`, approves each gate,
    provides credentials, owns all post-setup iteration); Jolly owns only the mechanical
    choreography between gates.
  - **Composable commands stay.** Every stage `start` runs is still available as an independent
    command the agent can call and mediate itself (feature 008 surface, feature 022
    resumability); `start` chains them — it does not replace them.
  - **Stripe — Jolly automates what the APIs allow; the key entry is a guided gate** (verified
    2026-06-14, feature 005). `@saleor/configurator` and the Cloud API cannot touch the Stripe
    app; the Saleor GraphQL `appInstall` mutation CAN install it (HANDLE_PAYMENTS), but no public
    API sets its keys or maps it to a channel — that lives in the app's Dashboard form. So the
    `start` Stripe stage = (1) Jolly installs the app via `appInstall`; (2) the recipe sets the
    channel payment flow; (3) Jolly runs a precise guided walk-through for the keys (deep link +
    "paste this here, assign to the `us` channel", keys by name only) and waits; (4) Jolly probes
    `paymentGatewayInitialize`/checkout to verify. Paper takes no Stripe keys (it reads the
    publishable key from Saleor at runtime); `jolly create stripe` only imports the test keys into
    `.env`.
  This applies to `jolly start` (feature 001/002); the retired `create deployment`/`deploy`/
  `create recipe`/`create storefront` are **not** revived as separate fat commands — the
  orchestration lives **inside `start`**, spawning the official CLIs.
- **Install skills via `npx skills add` (decision 2026-06-13):** Jolly installs every skill —
  the Jolly skill and the Saleor agent-skills — through `npx skills add <ref>`, falling back to
  a Git-based install only for a skill not available that way (e.g. Paper's embedded skill,
  which arrives with the cloned storefront). The **Jolly skill** specifically ships bundled in
  the `@dk/jolly` package (`assets/skills/` is in the package `files`) and is installed from that
  bundled copy by `init`/`start` (resolved relative to Jolly's own module path) — no network, no
  dependency on the skill being pushed to GitHub. Its canonical remote ref, for direct installs,
  is the explicit subpath `npx skills add https://github.com/dmytri/jolly/tree/main/assets/skills/jolly`
  (the bare `dmytri/jolly` also resolves to the single skill, but the explicit ref is preferred).
  The skill stays under `assets/` (Shipshape rule); the repo root is not restructured for it
  (decision 2026-06-13). **Install/verify location (verified 2026-06-14):** `npx skills add`
  with no `--agent` writes to the **universal** `.agents/skills/<id>/` location (read by all
  supported agents — Claude Code, Codex, Zed, Cursor, …), not a single agent's `.claude/skills/`.
  So Jolly verifies an installed skill at `.agents/skills/<id>/` (the on-disk check feature 007
  requires). Hardcoding `.claude/skills/` is the cause of the feature-022 "skills not detected
  after a real install" finding.
- **Zero unnecessary friction:** The path from copying the Jolly homepage prompt to a working deployed storefront requires only the human actions that cannot be automated — new account creation, browser OAuth consent, and providing secret values. Everything else Jolly and the agent handle automatically using safe defaults.
- **Trustworthy first-step handoff (decision 2026-06-13):** The setup instructions the customer
  pastes into their agent (homepage copy box → jolly.cool/setup → the Jolly skill) must read as
  trustworthy to a security-conscious agent and never trip its safety alarms. That means: no
  `curl | bash` or unexplained code; a named, inspectable package (`npx @dk/jolly`); explicit
  provenance and non-affiliation; the exact hosts contacted and that secrets go only to their
  own services; the agent stays in control and decides approvals (features 010/021); and Jolly
  makes no fabricated claims (020). The copy box points the agent at an inspectable URL rather
  than asking it to run anything blind. Trust rests on **npm and git being trustworthy
  distribution channels** (a named package on npm, source on github) — Jolly does **not** use
  npm provenance attestation and specs/docs must not require or claim it (decision 2026-06-13).
  **Both halves are first-class:** the same handoff must
  also be smooth and frictionless from paste to a live store with working test-mode payment —
  minimal human steps, safe defaults, no unnecessary confirmations, the Jolly skill carrying the
  agent through. Trust is what lets the agent proceed confidently; frictionlessness is what makes
  it worth proceeding. Neither is sacrificed for the other.
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
  agent setup guide is **https://jolly.cool/setup** (served from `assets/homepage/setup.md`
  via a rewrite in `assets/homepage/vercel.json`). The homepage deploys to Vercel from the
  `assets/homepage/` directory (Captain-owned; project link in `assets/homepage/.vercel`).
  Vercel's project **root directory** setting must point at `assets/homepage/` (moved there
  2026-06-13; update it before the next deploy).
- Project-local `.jolly/` artifacts and persistent report files are deferred until CLI design.

## MVP and Launch Definition

Launch bar (decision 2026-06-13): the MVP is the **full honest end-to-end** — the
customer's agent goes from the homepage prompt to a **real, deployed, working storefront**,
with every claim verified and nothing fabricated. The acceptance bar mirrors feature 002's
"V1 operational readiness": the deployed URL works, product browsing works against Saleor
Cloud data, cart works, and checkout progresses to the Stripe test payment step.

The flow is **agent-supervised orchestration** (decision 2026-06-14 — see "Agent-supervised
orchestration" above; supersedes the prior "agent-driven playbook" framing of this paragraph):
`jolly start` is a **resumable end-to-end runner** that deterministically executes the mechanical
stages itself by **spawning the official CLIs** (`git`, `pnpm`, `@saleor/configurator`,
`npx vercel`) plus its own plumbing, **pausing for the agent to approve each high-risk action**
(feature 021 `riskContext`) and **announcing-and-waiting at the human gates** (account creation,
OAuth/`vercel login`/`stripe login` — run with stdio passed through to the CLI and continued on
its exit — and the Dashboard Stripe-app step). The agent stays the approval authority and
credential provider; every stage is also a composable command the agent can run itself. Each
side does **real** work and reports only verified results (no fabrication — see the integrity
rule below). The numbered stages below describe the same end-to-end; under this decision stages
5–8 are spawned by `start` (not hand-run by the agent), while remaining agent/human at the
approval and interaction gates:

1. **Bootstrap** — `jolly start` runs `jolly init` (install the Jolly skill + Saleor skills via
   `npx skills add`, write `.mcp.json`, scaffold), acquires auth as needed, runs `jolly doctor`,
   and emits the ordered playbook + next steps. *Currently a simulation stub — must be rebuilt
   to do real bootstrap + playbook, not fake stage completion.*
2. **Auth** — `jolly login` / `auth status` (Jolly plumbing). *Built and sandbox-verified.*
3. **Store/environment** — `jolly create store` / `create environment` via the Cloud API
   (Jolly plumbing). Environments are provisioned **blank** (`database_population: null`, no
   sample data) so the stage-6 recipe deploy is purely additive — see feature 012 Rule "Created
   environments are provisioned blank" (decision 2026-06-14, finding #2). *Built and
   sandbox-verified; blank-provisioning change pending QM/Crew.*
4. **App token** — `jolly create app-token` via Saleor GraphQL (Jolly plumbing, feature 024).
5. **Storefront (agent)** — the agent clones `saleor/storefront` (Paper) from `main` with
   `git`, strips `.git`, fresh `git init`, `pnpm` install, per the Jolly skill (feature 002/003).
6. **Recipe (agent)** — the agent applies the Jolly starter recipe via `@saleor/configurator`'s
   safe workflow, per the skill (feature 004). **Then `jolly start` seeds stock** for every recipe
   variant (default 100 each) into the recipe warehouse via Saleor GraphQL, because configurator
   cannot set stock or `trackInventory` and hardcodes `trackInventory: true` — without this the
   catalog has zero stock and `us` checkout fails with `INSUFFICIENT_STOCK` before payment
   (acceptance-run finding 2026-06-14; see feature 004 Rule "Recipe products need seeded stock").
7. **Deployment (agent)** — the agent deploys with the **Vercel CLI** (`npx vercel`) under its
   own `vercel login` session, sets Vercel env vars, and updates Saleor trusted origins, per the
   skill (feature 002). No Jolly Vercel token, no `api.vercel.com` in Jolly's code.
8. **Stripe** — for 0-friction first-run, the agent obtains test keys via the official **Stripe
   CLI** OAuth login (`npx @stripe/cli login`), after which `jolly create stripe` (no flags)
   imports them by invoking the Stripe CLI **read-only** (`stripe config --list`) and writes them
   to `.env` — the agent never handles the secret. Explicit `--publishable-key`/`--secret-key`
   flags override (durable Dashboard keys). These CLI keys are test-mode and expire (~90 days); the skill
   warns the agent to swap in durable Dashboard keys before expiry, and pasting Dashboard keys is
   the always-supported alternative. The agent then configures the Saleor Stripe app (Dashboard
   Extensions), mapped to the storefront channel, and verifies checkout readiness with
   `jolly doctor` (feature 005). `@saleor/configurator` manages catalog and channels only — it
   does not configure payments. (Decision 2026-06-13; Saleor's acceptance of the CLI-issued
   `sk_test_` key is to be confirmed in the acceptance run — adopt-on-green.)
9. **Verify** — `jolly doctor` confirms operational readiness (feature 014).

**Integrity rule (decision 2026-06-13):** Jolly's own commands report success and `pass` checks
only for work Jolly actually performed and confirmed; unbuilt or unperformable paths **error
honestly** (stable `errors[].code`) and never fabricate. `jolly start` reports what it actually
set up and the playbook it emitted — never a completed deployment it did not perform. The Jolly
skill is real agent guidance, not a Jolly claim of having done the work. This applies feature
020's "No fabricated success" to the surviving create subcommands (feature 008), `jolly start`
(feature 001), and `jolly doctor` (feature 014); testable at `@logic` without credentials, with
real end-to-end verified at `@sandbox`. Under the 2026-06-14 orchestration decision, this
applies per-stage: `jolly start` reports only the stages it actually performed (via the CLIs it
spawned) and their real results — never a deployed store it did not deploy; a stage that was
skipped, paused for approval, or is waiting at a human gate is reported as such, not as passed.

**Launch credentials (as of 2026-06-13):** Jolly's own credentials are `JOLLY_SALEOR_CLOUD_TOKEN`
and `JOLLY_STRIPE_PUBLISHABLE_KEY` / `JOLLY_STRIPE_SECRET_KEY` (Stripe **test mode** only).
**Vercel auth is NOT a Jolly credential** — it lives entirely in the Vercel CLI's own
`vercel login` session, so `JOLLY_VERCEL_TOKEN` is **retired** (remove it from `.env`, harness
gating, and step defs). The deploy `@sandbox` scenarios gate on the Vercel CLI being
authenticated (`npx vercel whoami` exit 0), not on any Jolly env var. Likewise, Configurator
`@sandbox` work uses the Saleor app token Jolly already manages, passed to `@saleor/configurator`.

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

Decision 2026-06-12 (see feature 020 Rule "First-party hosts only"), amended 2026-06-13:
Jolly's code sends network requests only to auth.saleor.io (Keycloak, realm saleor-cloud),
cloud.saleor.io (Cloud API + token page), the customer's *.saleor.cloud environment domains,
api.stripe.com, github.com (cloning saleor/storefront and skills), and 127.0.0.1 (OAuth
callback). "Hosts Jolly contacts" stays exactly equal to the hosts in Jolly's request-sending
code. Secrets travel only to their own service (Saleor tokens → Saleor hosts; Stripe keys →
api.stripe.com; nothing to github.com). `JOLLY_SALEOR_CLOUD_API_URL` optionally overrides the
Cloud API base (default `https://cloud.saleor.io/platform/api`) for proxy/self-routing setups.

Delegated official CLIs are not Jolly's request code (affirmed by the 2026-06-14
"Agent-supervised orchestration" decision above): `jolly start` **spawns** the **Vercel CLI**
(`npx vercel`) and **`@saleor/configurator`**, which contact their own services (api.vercel.com
for Vercel; the customer's Saleor GraphQL endpoint for Configurator) under their own auth. `api.vercel.com` is
therefore **no longer in Jolly's own allowlist** — it is reached by the Vercel CLI Jolly
delegates to, never by Jolly's request-sending code, and there is no Vercel token in Jolly's
secrets. This delegation to *current, official* CLIs is distinct from the ban on the
*deprecated* `saleor/cli`, which Jolly must never invoke. The one CLI Jolly itself invokes —
the **read-only Stripe CLI import** (`stripe config --list`, above) — adds no host to the
allowlist: `config --list` reads local config and makes no network call.

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
  - `npx cucumber-js --dry-run`
  - `npm run test:bdd`
  - `npm test` (logic-tier units via `node --test`)
  - `npm run typecheck`
- Step definitions live in `features/step_definitions/<feature-slug>.steps.ts`.
- Shared hooks/world/sandbox setup live in `features/support/`.
- Logic-tier unit tests live in `tests/`.
- Sandbox tests use runtime `JOLLY_*` credentials only; there is no `JOLLY_TEST_*` namespace.

### Crew Mate

- CLI implementation lives under `src/`.
- `assets/**` (including `assets/homepage/` and `assets/skills/jolly/`) is Captain-owned — out of Crew Mate scope entirely.
- Implement the minimal production/application change needed to satisfy committed specs and tests.

## Durable Assets

Jolly follows Shipshape's `assets/` policy: **all durable Captain/human-owned content lives
under `assets/`** — there are no other Captain-owned top-level folders (decision 2026-06-13).
`assets/` holds both source material (approved copy, brand context, style direction, mockups,
reference data, fixture-like examples) and shipped Captain-authored artifacts. Its current
contents:

- **`assets/homepage/`** — the deployable homepage + agent setup guide (`index.html`,
  `setup.md`, `vercel.json`), served at https://jolly.cool. Captain/human-authored, not
  specified in `.feature` files, not covered by tests; the Captain edits it in place. Vercel
  deploys the site from `assets/homepage/` (project link in `assets/homepage/.vercel`).
- **`assets/skills/jolly/`** — the **Jolly skill** the deliverable Jolly installs (via `npx
  skills add`): `SKILL.md`, the Captain-authored end-to-end playbook that teaches the customer's
  agent to drive the official CLIs plus Jolly's thin helpers, and `recipe.yml`, the Jolly starter
  recipe (a `@saleor/configurator` config — pirate-themed US/USD/English catalog, shipping, and
  the `us` channel Paper points at) that the agent copies into the cloned storefront and applies
  with the configurator (feature 004). Exact CLI invocations and the configurator schema are
  verified against current upstream at implementation time. (This is the product skill Jolly
  ships to customers — distinct from `.claude/skills/`, the Shipshape roles for working on this
  repo, which is git-ignored.)

**Ownership and testing (decision 2026-06-13):** everything under `assets/` is Captain/human-owned
and **not covered by the BDD suite** — including the Jolly skill's content and the homepage. Their
quality is an editorial concern validated by real use, not cucumber. The **CLI plumbing is
QM/Crew-owned and tested** — that is the deterministic, sandbox-verifiable surface. The clean
seam: QM tests that Jolly *installs* the skill correctly (`jolly init` verifies it on disk,
feature 007); QM does **not** test whether the skill's guidance yields a working *deployed* store —
store-correctness stays real-use validation. **The skill's affordance — whether a baseline agent
can discover and drive Jolly from the skill alone — is now covered by an opt-in evaluation tier
(feature 025, decision 2026-06-13, pulling the previously-deferred eval forward).** A baseline
agent (the bundled `pi` agent with a cheap model) is run over the real skill and CLI in a safe,
bounded, per-run workspace with forced safe credentials, and the eval asserts *affordances* — the
agent invoked Jolly's documented commands (PATH-shim trace) and the documented local artifacts
appeared — never a working deployed store. It is tagged `@eval`, excluded from the default
worklist, and skips cleanly when its agent/model credential is absent. The skill's editorial
quality remains Captain-owned and otherwise untested; the eval (its `.feature` and scenarios)
is Captain-authored, QM/Crew make it executable.

Quartermaster and Crew Mate may read `assets/**` but must not edit or delete it.

Homepage/setup-guide copy principle (customer, 2026-06-12): less is more — say only
what the reader needs; do not mention what is assumed or absent (e.g. version
pinning, install steps); no junk, no duplication.

## Testing Strategy

- Package scripts are Node-native (decision 2026-06-13, dropped Bun): the logic-tier runner is `node --test` (using `node:test` + `node:assert`); the BDD layer is Cucumber.js run under Node (`npm run test:bdd` → `cucumber-js`), with TypeScript step definitions and support code loaded via Node >= 23's native type stripping (project files, not under `node_modules`). The published bundle is built with esbuild (`npm run build` → `dist/index.js`). The published CLI targets Node (see Project Stack); the feature 006 npx scenario covers that the *installed* bin runs on Node alone. See features `023-test-architecture` and `006`.
- Feature `023-test-architecture` is the harness charter — already satisfied by `features/support/` and `tests/sandbox.test.ts`. It is tagged `@meta` and excluded from the BDD worklist; do not write Cucumber step definitions for it.
- **Sandbox over mocks:** tests exercise real accounts (Saleor Cloud, Configurator, Vercel, Stripe) rather than mocks. Avoid mocks unless a condition cannot reasonably be produced in a sandbox (for example injected failures or unavailable-capability branches).
- Three test tiers:
  - Logic tier — pure local behavior (output-envelope shaping, flag parsing, URL normalization, risk-context construction). No accounts; always runs. Tagged `@logic`.
  - Sandbox tier — behavior that touches Saleor Cloud, Configurator, Vercel, or Stripe. Real accounts; tagged `@sandbox`.
  - Eval tier — the skill-behavior affordance evaluation (feature 025): a baseline agent driven over the real skill + CLI in a safe, bounded workspace. Non-deterministic, credentialed, slow; tagged `@eval` and **excluded from the default worklist** (runs only via an explicit `eval` profile), skip-not-fail when its agent/model credential is absent. It is never a green/red gate.
- **One configuration everywhere:** tests read the same runtime `JOLLY_*` environment variables Jolly itself uses — identical names across dev, test, and production. There is no test-only credential namespace (no `JOLLY_TEST_*`). The accounts behind them are expected to be dedicated test accounts, but that is the customer's choice to make and set; Jolly and the tests never know or check which kind they are. When a needed Saleor endpoint or app token is not configured but `JOLLY_SALEOR_CLOUD_TOKEN` is present, the harness **provisions** a shared per-run environment and derives the missing values rather than skipping; `@sandbox` tests are skipped (not failed, with a clear reason) only when the needed credentials cannot be derived — the Cloud token itself, or Stripe credentials. Vercel is not a Jolly credential (decision 2026-06-13): deployment is agent-run via the Vercel CLI, so any `@sandbox` step exercising deployment gates on the Vercel CLI being authenticated (`npx vercel whoami` exit 0), never on a Jolly env var; there is no `JOLLY_VERCEL_TOKEN`. Harness-internal knobs (artifact path overrides, per-run id, runtime selection) are not Jolly settings and use a `HARNESS_*` prefix.
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
- DOM-level checks (storefront rendering) use happy-dom; prefer happy-dom for DOM behavior and do not duplicate it in lower-level tests. The homepage (`assets/homepage/`) and the Jolly skill content (`assets/skills/jolly/SKILL.md`) are Captain-owned assets with no test coverage; QM/Crew test only Jolly's CLI behavior, including that `jolly init` installs the skill correctly (feature 007) — not the skill's guidance itself. The `.feature` files specify and test JOLLY's behavior; steps describing the agent's own CLI actions (clone/configure/deploy) are narrative context for the skill, and QM should assert only Jolly's observable contribution (e.g. `jolly doctor` detecting the deployment), not execute the agent's steps.
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

`src/lib/` holds reusable plumbing for the Crew-Mate-built CLI (`src/index.ts` is currently
deleted pending the thin-CLI rebuild); the CLI is disposable and regenerated from the specs
when they change. `assets/` holds all Captain-owned content — `assets/homepage/` (homepage +
agent setup guide) and `assets/skills/jolly/` (the Jolly skill) — not regenerated from specs
and out of QM/Crew scope (see Durable Assets).
