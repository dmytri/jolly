---
name: jolly
description: How to drive Jolly and where it fits among the Saleor skills and official CLIs. Load this when SETTING UP a Saleor Cloud + Vercel + Stripe storefront with Jolly — run and supervise `jolly start`, read its `--json` envelope, gate its risky stages, diagnose with `jolly doctor` — AND when CONTINUING AFTER setup on a Jolly-provisioned store — managing store config and data modelling via `@saleor/configurator`, developing the deployed Saleor Paper storefront, installing a Saleor app, refreshing `SALEOR_TOKEN`, or deciding which sibling Saleor/Stripe skill or official CLI owns a task. Jolly is the thin orchestrator that spawns the official CLIs (git, pnpm, @saleor/configurator, vercel) during setup, then routes you to the right skill for the building that follows.
---

# Using Jolly

**Jolly is a thin orchestrator — not a framework, and not a replacement for you.** It's a CLI
(`@dk/jolly`, by Dmytri Kleiner) that brings a Saleor Cloud storefront into existence by **spawning
the official CLIs** — `git`, `pnpm`, `@saleor/configurator`, `vercel` — and doing the small plumbing
between them (auth, store provisioning, secret/`.env` writing, `.mcp.json`, diagnostics).
It never reimplements a CLI against raw APIs and never fabricates a
step it didn't perform. **You stay in charge:** you approve the risky steps, provide credentials, and
own everything after setup.

Two things Jolly gives you:

1. **One-command setup** — `jolly start` runs the whole flow end-to-end (below).
2. **A working store, a storefront repo, and a shelf of skills** — afterward you keep building with
   the official CLIs and the Saleor/Stripe skills Jolly installed. Jolly stays useful for
   `jolly doctor` and resumable re-runs.

The setup goal: a real, deployed, working storefront (browsing, cart, and checkout to the Stripe test
payment step) with the fewest human interruptions — only the steps no tool can do (new-account
creation, browser sign-in consent, the Dashboard Stripe-app config).

## Where Jolly fits — the other skills and CLIs

Jolly bootstraps; the **official CLIs** and the **sibling skills** carry the real building. Don't ask
Jolly to do what these own — reach for them instead:

**Official CLIs (Jolly drives them during setup; you own them after):**

- `git` + `pnpm` — the cloned Paper storefront repo. Yours to develop, commit, and run
  (`pnpm dev`).
- `@saleor/configurator` — store configuration as code (catalog, channels, settings). After setup,
  manage the recipe/`config.yml` and run `diff`/`deploy` yourself.
- `vercel` — deployment. Re-deploy, set env vars, and manage the project with the Vercel CLI.

**Sibling skills Jolly installs (your ongoing toolkit — reload your agent so they load):**

- **`saleor-storefront`** — Saleor's GraphQL API for storefronts (products, variants, checkout,
  channels, permissions). For querying or debugging the API.
- **`storefront-builder`** — **framework-agnostic** storefront data + UX playbook
  (PLP/PDP/nav/pricing/availability/media, variant selection). The fallback for general patterns,
  not Paper specifics.
- **`saleor-paper-storefront`** — **Paper-specific** architecture, shipped *inside the cloned repo*
  at `storefront/skills/` (not installed by `jolly init`): where Paper's routes, components, design
  tokens, caching, and checkout actually live. **First stop for any change to `storefront/`** — begin
  at `storefront/AGENTS.md`, then this skill; reach for `storefront-builder` only for generic
  patterns it does not cover.
- **`saleor-configurator`** — config-as-code patterns: writing `config.yml`/`recipe.yml`, entity
  identification, the deploy pipeline, debugging sync. Owns the **schema** for product types,
  attributes, channels, and page types — the authority for any data-model change.
- **`saleor-core`** — backend behavior reference (discounts, stock modes, webhook triggers, Dashboard
  rules) for when you hit Saleor internals.
- **`saleor-app`** — building Saleor apps (manifest, webhooks, registration, settings) if you extend
  the Dashboard. Covers the app **protocol**; you install your finished app against the store with the
  Saleor GraphQL `appInstall` mutation — the same call Jolly makes for the Stripe app (stage 7).
- **`stripe-best-practices`** — Stripe integration knowledge; drive the Stripe app's key/channel
  configuration and any deeper payment work with it.

Rule of thumb: **Jolly brings the store into existence and verifies it; the skills + CLIs build on
it.** When a task is "make the store/storefront/deploy *exist* or *re-verify*", that's Jolly
(`start`/`doctor`). When it's "build, query, configure, or extend", that's a sibling skill driving an
official CLI or the API.

## Driving Jolly — the contract

Every Jolly command emits one structured **envelope** (`command`, `status`, `summary`, `data`,
`checks`, `nextSteps`, `errors`), and before any create/modify/deploy action a **`riskContext`**
(`action`, `target`, `riskLevel`, `categories`, `reversible`, `sideEffects`, `dryRunAvailable`).
Output is human-friendly by default; add **`--json`** for the machine-readable envelope (the only
mode that emits it) and branch on `status`, `data`, `checks`, or stable error `code`s.

- **You decide approvals.** From the `riskContext` and the customer's policies, *you* decide whether
  to seek the human's approval — Jolly never hardcodes that decision.
- **Preview costs nothing.** `--dry-run --json` lists every stage, its effects, and the `riskContext`
  for each side-effecting one.
- **Resumable.** Re-running `jolly start` is safe — it detects what's already done (the clone, the
  store, the deploy) and continues from the first outstanding stage rather than redoing work.
- **`jolly doctor` is your diagnosis.** It names what's wrong and the concrete next action — run it
  whenever you're unsure.
- **Honest by construction.** A stage that's pending, paused for approval, or waiting at a human gate
  is reported as such (status `warning`), never as a completed success.

> Upstream commands and flags (Vercel CLI, `@saleor/configurator`, Paper's `saleor/storefront`)
> change over time. Re-check current `--help`/docs at run time rather than trusting memorized
> invocations. This skill describes the *flow*; the tools own the *specifics*.

## The setup flow — `jolly start`

```
jolly start            # orchestrate end-to-end, pausing at each gate
jolly start --dry-run  # preview the whole plan (stages, effects, riskContexts) — changes nothing
jolly start --yes      # pre-approve the high-risk stages and run straight through
```

`start` pauses for your approval before each high-risk stage (`create store`, the configurator
`deploy`, the Vercel deploy), waits at the human gates (account creation, the Saleor sign-in, the
Vercel sign-in, the Dashboard Stripe-app config), surfaces every sign-in / store / Dashboard URL in
the envelope `data` for you to render as a clickable link, and never makes the human paste a secret
to you they'd rather write into the gitignored `.env` themselves (e.g. `JOLLY_SALEOR_CLOUD_TOKEN` —
Jolly reads `.env`, so you never need to hold the value). It verifies with `jolly doctor` and reports
only the stages it actually performed.

### The stages (each is also a command you can run yourself)

1. **Bootstrap** — `jolly init` (skills + `.mcp.json` + scaffold); `start` then also runs
   `jolly doctor` (standalone `jolly init` does not). Never overwrite Jolly's marked `AGENTS.md`
   section.
2. **Authenticate Saleor Cloud** — `jolly login` (and the `start` auth stage) sign in through the
   Saleor **device authorization grant**. The first call returns an `auth.saleor.io` verification URL
   (user code pre-filled) in the envelope's `nextSteps` (status `warning`, `authorizationPending`) and
   persists the device code — it does NOT block. Surface that URL as a clickable link; once the human
   approves in the browser, **re-run the same command** — Jolly resumes the SAME persisted code and
   stores the session (`JOLLY_SALEOR_ACCESS_TOKEN` + refresh) in `.env` (`jolly doctor` re-verifies).
   There is no token to paste and no token page — never ask the human for a pasted token. (For
   unattended CI only, a `JOLLY_SALEOR_CLOUD_TOKEN` set in the environment is used silently.) For a
   brand-new account, send the human to cloud.saleor.io to sign up, then resume.
3. **Provision the store** — `jolly create store` (creates/reuses the Cloud organization, project,
   and a **blank** environment via the Cloud API). High-risk → approval gate.
4. **Storefront** — clone Paper (`git clone https://github.com/saleor/storefront.git ./storefront`,
   `main`), strip the upstream `.git`, `git init`, approve Paper's native build dependencies, and
   install with pnpm run via `npx` (`npx pnpm install` — no global pnpm prerequisite, like the other
   CLIs). `start` does NOT write a local storefront `.env`: `NEXT_PUBLIC_SALEOR_API_URL` (your GraphQL
   endpoint) and `NEXT_PUBLIC_DEFAULT_CHANNEL=us` (the channel the recipe creates) are injected only
   as Vercel **build env** at the deploy stage (`--build-env`). To run Paper locally with `pnpm dev`,
   `cp .env.example .env` and set those two `NEXT_PUBLIC_*` values in `storefront/.env` yourself. If
   the local Node version is incompatible with Paper, tell the human — don't switch Node yourself.
5. **Configure the store** — the Jolly starter recipe ships beside this file as `recipe.yml` (a
   pirate-themed US/USD/English catalog with shipping and the `us` channel Paper points at). `start`
   writes it to `recipe.yml` in the project working dir and spawns `@saleor/configurator deploy
   --config <projectDir>/recipe.yml --url "$SALEOR_URL" --token "$SALEOR_TOKEN"` (the same
   `SALEOR_URL`/`SALEOR_TOKEN` configurator auto-loads from `.env`). High-risk → approval gate; the gate
   (or `--dry-run`) is the preview. `deploy` reconciles the store to the recipe — it creates the
   recipe's entities and removes the empty placeholders a new Saleor environment ships (a default
   channel, category, and warehouse — never products). **On a store you just created this is safe,
   not data loss:** those placeholders are not your catalog. Over a store that already holds real
   catalog, Jolly passes `--failOnDelete`, so a destructive apply is BLOCKED (exit 6) for your
   explicit approval rather than silently deleting anything. **After the deploy, `start` seeds
   stock** — quantity 100 for every recipe variant in the recipe warehouse via Saleor GraphQL,
   because `@saleor/configurator` cannot set stock (it hardcodes `trackInventory: true`). Without this
   the catalog has zero stock and checkout fails with `INSUFFICIENT_STOCK` before reaching payment.
   MANUAL alternative: copy the recipe into the storefront repo as `saleor-config.yml`
   (version-controlled, reviewable) and run the configurator's `diff`-then-`deploy` workflow yourself
   (the `saleor-configurator` skill covers this).
6. **Deploy to Vercel** — `start` spawns `npx vercel` and performs the Vercel sign-in itself: with no
   session it starts Vercel's device flow and returns the verification URL in the envelope's
   `nextSteps` (a clickable link) while a detached `vercel login` keeps polling. Once the human
   approves in the browser, **re-run `jolly start --yes`** — the session is now established and
   `start` deploys to production (`npx vercel deploy --prod`), injecting the Vercel build env vars
   (`--build-env NEXT_PUBLIC_SALEOR_API_URL`, `--build-env NEXT_PUBLIC_DEFAULT_CHANNEL=us`), and
   captures the URL. Vercel Deployment Protection is on by default; `start` surfaces it so the human
   can turn it off and the store is reachable.
7. **Stripe (test mode)** — `start` installs Saleor's Stripe app via the store's Saleor GraphQL
   `appInstall` mutation (`HANDLE_PAYMENTS`, authenticating with the Cloud staff token — `appInstall`
   is a staff-only mutation) and installs the `stripe-best-practices` skill — **that is Jolly's entire
   payment role.** Configuring the app is a
   human Dashboard gate `start` waits at: in the Saleor Dashboard → Extensions → the Stripe app, add a
   configuration with the account's test-mode **publishable key and a restricted key** (from the
   Stripe Dashboard → Developers → API keys) and **map it to the `us` channel**. The app then
   registers its own Stripe webhooks. The install is idempotent — a re-run reuses the existing
   installation rather than duplicating it. Drive the keys-and-channel step with the
   `stripe-best-practices` skill.
8. **Verify** — `jolly doctor` (all groups): Saleor connectivity, storefront env, deployment
   reachability, and a `us`-channel checkout actually being offered the Stripe gateway (the closing
   signal that the keys + channel mapping are done). Report the live URL, the doctor results, and any
   remaining manual steps. Then remind the human to reload or restart their agent so the installed
   skills load into its context for the work ahead.

## After setup — what's on disk, and how to keep building

`jolly start` leaves a working store and the files to evolve it. At the close, orient your human:
name each artifact, say what it's for, and point at the skill/CLI that drives it.

| On disk | What it is | Drive it with |
|---|---|---|
| `storefront/` | The cloned Paper storefront (Next.js), a fresh git repo, now live on Vercel. Your code. | **`storefront/AGENTS.md` + the embedded `saleor-paper-storefront` skill** first, `storefront-builder`/`saleor-storefront` for generic patterns; `npx pnpm dev`, `git`, `npx vercel` |
| `recipe.yml` | Your store's catalog, categories, channels, and settings as code — what was deployed to Saleor. | `saleor-configurator` skill; `npx @saleor/configurator diff` / `deploy` |
| `.env` | Secrets (your Saleor session + the store token `SALEOR_TOKEN`). Gitignored — never commit. | Jolly reads it; you add values |
| `.mcp.json` | A local mcp-graphql server wired to your store, for live API access from your agent. | your agent's MCP client |
| `.agents/skills/` | The installed skill toolkit (this skill + the Saleor/Stripe skills). | reload your agent to load them |

References: Paper — https://github.com/saleor/storefront · Configurator —
https://github.com/saleor/configurator · Vercel CLI — https://vercel.com/docs/cli · Saleor docs —
https://docs.saleor.io

**First, have the human reload/restart their agent** — the skills below are on disk under
`.agents/skills/` (and `storefront/skills/`) but only load into the agent's context after a restart.
Until then you cannot route to them.

The pattern for any change: match the task to the skill that **owns the depth**, start at its entry
rule, edit the artifact, preview, then ship. Jolly only routes — it does not carry these specifics.

| You want to… | Lives in | Owned by | Start at |
|---|---|---|---|
| Rename/add catalog, categories, prices | `recipe.yml` | `saleor-configurator` | `rules/config-schema.md` |
| Model new data — product types, attributes, channels, page types | `recipe.yml` | `saleor-configurator` | `rules/config-schema.md` (+ upstream `SCHEMA.md`) |
| Add Paper features, pages, design, checkout | `storefront/` | `saleor-paper-storefront` | `storefront/AGENTS.md` |
| Query or debug the Saleor GraphQL API | — | `saleor-storefront` | `rules/api-*.md` |
| Build a new Saleor app | a new app project | `saleor-app` | `rules/protocol-manifest.md` |

Two worked paths the recipe's happy path doesn't cover — concise pointers; the owning skill carries
the real schema and examples:

- **Extend the data model** (e.g. a new `Book` product type with `author`/`format` attributes, or a
  second `eu`/EUR channel). **Start from your own store as the worked example: `npx @saleor/configurator
  introspect` dumps its live config as valid YAML** — real channels, channel listings, and
  product-type↔attribute wiring, always matching your installed configurator version. Copy that
  shape; the starter `recipe.yml` is only a bootstrap, not a modelling template. For syntax the
  introspected config doesn't already show (attribute `inputType`s, product- vs variant-level
  attributes), open `saleor-configurator`'s `rules/config-schema.md` and the upstream `SCHEMA.md` it
  links. A new channel only sells once each product carries a **channel listing** with price +
  availability there (introspect shows the shape on your existing `us` channel). Preview with
  `npx @saleor/configurator diff`, then apply with `npx @saleor/configurator deploy --failOnDelete`
  so a divergent apply is **blocked** rather than silently deleting catalog. (Jolly passes
  `--failOnDelete` during `start`; your own runs must pass it themselves.)
- **Build and install a Saleor app** (e.g. a webhook-driven loyalty app). The `saleor-app` skill owns
  the protocol — scaffold the project from the canonical starter and implement the manifest + webhook
  handlers + APL auth from its rules, then deploy it anywhere it's reachable (Vercel works — the same
  CLI Jolly used). **To register it you already have everything Jolly provisioned — you don't need a
  Jolly command for this:** `SALEOR_TOKEN` in `.env` is a staff-superuser Bearer token (it can drive
  `MANAGE_APPS`), and `.mcp.json` is already wired to your store's GraphQL. So install the app
  yourself — send the `appInstall` mutation through the `.mcp.json` GraphQL server (or `curl` with
  `SALEOR_TOKEN`):
  `appInstall(input: { appName: "Loyalty Points", manifestUrl: "https://your-app.example.com/api/manifest", permissions: [<the scopes your manifest declares>] })`
  — the same staff-authenticated call Jolly makes for the Stripe app in stage 7. Saleor fetches the
  manifest from your app's host (Jolly never does — first-party hosts only). Confirm it in the
  Dashboard → Extensions.

These are starting points — the owning skills and the docs above carry the specifics.

## Talking to your store after setup

When you query or mutate the store directly — `@saleor/configurator`, a `curl` against the GraphQL
endpoint, or the `.mcp.json` server — only two values matter, and Jolly keeps both in `.env`:

| Var | What it is | How it's used |
|---|---|---|
| `SALEOR_URL` | Your store's GraphQL endpoint (same value as `NEXT_PUBLIC_SALEOR_API_URL`). Non-secret. | `--url "$SALEOR_URL"`; configurator auto-loads it from `.env`. |
| `SALEOR_TOKEN` | The store access token. Secret. | `Authorization: Bearer <token>` — **always `Bearer`, never an `App` scheme.** `--token "$SALEOR_TOKEN"`. |

That's the whole agent-facing surface. The `JOLLY_*` vars (`JOLLY_SALEOR_ACCESS_TOKEN`, refresh,
`JOLLY_SALEOR_CLOUD_TOKEN`) are **Jolly's internal auth layer** — the source `SALEOR_TOKEN` is
projected from. Read `SALEOR_TOKEN`, not the `JOLLY_*` originals.

**`SALEOR_TOKEN` is short-lived.** In the normal device-grant flow it's a ~5-minute staff JWT, so
the value in `.env` goes stale fast. When a request 401s, that's almost always an expired token, not
a missing permission. Refresh it with `jolly doctor saleor` (which mints a fresh access token and
rewrites the `.env` line) or re-run `jolly login`; Jolly rewrites `SALEOR_TOKEN` on every refresh.
(CI sets a long-lived `JOLLY_SALEOR_CLOUD_TOKEN` instead, which doesn't expire on this clock.)

**MCP is refresh-on-401.** The `.mcp.json` server captures `${SALEOR_TOKEN}` at spawn, so it holds
whatever value was current when it started. If a tool call 401s, refresh the token (`jolly doctor
saleor`) and then **reload the MCP server** so it re-reads the fresh `SALEOR_TOKEN` — the running
server won't pick up the new value on its own.

**Decode the errors — don't assume "permission denied":**

- `Couldn't resolve to a node: <id>` means **the ID doesn't exist** (wrong/stale ID, or an entity
  from a different store/channel) — it is **not** a permission error. Check the ID, don't go hunting
  for a missing scope.
- A *real* permission error names the missing permission (e.g. `You need MANAGE_PRODUCTS`). If you
  don't see a named permission, it isn't a permissions problem — suspect an expired `SALEOR_TOKEN`
  (refresh per above) or a wrong ID.

## If a step fails or you're unsure

Run `jolly doctor` — it names what is wrong and the concrete next action (a command, a CLI to
authenticate, a value to ask your human for). Fix that, then re-run `jolly start`; it resumes from
the first outstanding stage. Never treat a failed command as success.

## Honesty

Never claim a step succeeded that you did not actually perform and confirm. If something is missing or
unauthenticated, stop and tell the human exactly what is needed — a credential, or a human-gate
action — and report it honestly rather than fabricating success or inventing a fallback. Jolly's own
commands follow the same rule.
