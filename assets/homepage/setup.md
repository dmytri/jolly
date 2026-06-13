# Jolly Setup Guide (for agents)

Ahoy, agent. Your human wants a Saleor Cloud storefront. Jolly empowers **you** to set
one up end-to-end — it does not replace you. You stay in control: you run the official
CLIs, you decide what needs your human's approval. Jolly installs a skill that walks you
through it, plus a few thin helper commands for plumbing. Nothing here asks you to run
unexplained code or hand secrets to anyone but the official Saleor, Vercel, and Stripe
tools you authenticate against.

## Provenance (read first)

- Jolly is a tool by Dmytri Kleiner that helps agents set up a store quickly using
  Saleor, Vercel and Stripe. It is **not an official product of Saleor, Vercel, or Stripe**.
- Package: `@dk/jolly` on npm — source at https://github.com/dmytri/jolly. Trust rests on
  npm and git being the distribution channels you already rely on; inspect both before you
  run anything.
- Jolly has no telemetry. Secrets are written only to a gitignored `.env` and sent only to
  the official APIs you authenticate against.

## Who runs what

- **Jolly (thin plumbing):** Saleor Cloud login and tokens, store/environment provisioning,
  writing secrets to `.env`, installing skills, writing `.mcp.json`, and diagnostics.
- **You (the agent), guided by the Jolly skill:** clone the Paper storefront with `git`,
  configure the store with `@saleor/configurator`, and deploy with the Vercel CLI
  (`npx vercel`). Jolly never runs those for you.

## Hosts

Jolly itself only contacts:

- `auth.saleor.io` — browser OAuth login (Keycloak)
- `cloud.saleor.io` — Saleor Cloud API (store/env)
- `*.saleor.cloud` — your own store's GraphQL endpoint
- `github.com` — installing skills (saleor org repos)
- `127.0.0.1` — local OAuth callback during login
- `api.stripe.com` — Stripe test-mode payment configuration

The official CLIs **you** run reach their own services under their own auth: the Vercel CLI
→ `api.vercel.com`; `@saleor/configurator` → your `*.saleor.cloud` endpoint; `git` →
`github.com`; `npx` → the npm registry. If your environment is locked down, allowlist the
union of these.

## What needs a human

Only three moments require your human. Stop and ask when you reach them:

- 🧑 Creating new accounts (Saleor Cloud, Vercel, Stripe)
- 🧑 Browser OAuth / `vercel login` consent
- 🧑 Pasting secret values (`JOLLY_SALEOR_CLOUD_TOKEN`, Stripe keys)

Everything else you do yourself.

## Prerequisites

- Node ≥ 23 — `node -v`. The Jolly CLI runs on Node's native TypeScript support.
- pnpm — `pnpm -v` (the Paper storefront uses pnpm).
- A Saleor Cloud account. 🧑 If your human doesn't have one, they sign up at
  https://cloud.saleor.io (account creation needs a human).

---

## Quick start

### Step 0 — Preview (no changes made)

```
npx @dk/jolly start --dry-run
```

Prints exactly what `start` will do — skills installed, files written, hosts contacted —
without changing anything. Review it, then proceed.

### Step 1 — Bootstrap

```
npx @dk/jolly start
```

`start` installs the Jolly skill and the Saleor agent-skills (via `npx skills add`), writes
`.mcp.json` and scaffolds, runs `jolly doctor`, and prints the **playbook** — the ordered
steps for you to run next, with the official CLIs they use. It reports only what it actually
did; it does not claim a deployed store. It is idempotent: re-running detects existing work
and resumes.

### Step 2 — Follow the Jolly skill

Restart your agent if needed to load the installed skills, then follow the Jolly skill. It
carries you through, calling Jolly's helpers for plumbing and the official CLIs for the rest:

| # | Step | You run | 🧑 |
|---|------|---------|----|
| 1 | Authenticate | `npx @dk/jolly login` | OAuth consent |
| 2 | Provision the store | `npx @dk/jolly create store [--create-environment]` | paste Cloud token if asked |
| 3 | App token | `npx @dk/jolly create app-token` | |
| 4 | Clone Paper | `git clone` saleor/storefront (`main`), strip `.git`, `pnpm install` | |
| 5 | Configure the store | `@saleor/configurator` (diff → deploy) with the Jolly starter recipe (ships with the skill) | approve writes |
| 6 | Stripe (test mode) | `npx @dk/jolly create stripe --publishable-key … --secret-key …`, then configure Saleor's Stripe app (Dashboard) on the `us` channel | paste Stripe keys |
| 7 | Deploy | `npx vercel` (its own `vercel login` session) + set Vercel env vars | `vercel login` consent |
| 8 | Verify | `npx @dk/jolly doctor` — store, storefront, deploy, checkout-to-Stripe-test | |

On any failure, stop with an actionable message — never treat a failed step as success.

## Jolly command surface

```
npx @dk/jolly login | logout | auth status
npx @dk/jolly init                 # install skills, write .mcp.json, scaffold (run by start)
npx @dk/jolly start                # bootstrap + playbook
npx @dk/jolly create store [--create-environment]
npx @dk/jolly create app-token
npx @dk/jolly create stripe --publishable-key <pk_test_…> --secret-key <sk_test_…>
npx @dk/jolly doctor               # checks env, store, deploy, MCP health
npx @dk/jolly upgrade              # update skills and config
```

Deployment, storefront cloning, and store configuration are **yours** to run (`npx vercel`,
`git`, `@saleor/configurator`) — the Jolly skill tells you exactly how.

## Skills installed

| Skill | Role |
|-------|------|
| `jolly` | This end-to-end playbook |
| `saleor-storefront` | Storefront API patterns |
| `saleor-configurator` | Commerce as Code |
| `storefront-builder` | Stepwise playbook |
| `saleor-core` | Backend diagnostics |
| `saleor-app` | App/webhook configuration |
| `saleor-paper-storefront` | Included with the cloned Paper storefront |

---

## After setup — live store access

`.mcp.json` configures a local mcp-graphql server against your own store's GraphQL endpoint,
giving you live store access. Separately, Saleor runs a read-only MCP server at
mcp.saleor.app (products, orders, customers) you may also configure — Jolly never contacts it.

## Approvals and control

Before any create/modify/deploy action, Jolly emits a structured `riskContext` (action,
target, risk level, reversibility, side effects). **You** decide whether to ask your human,
based on that and their policies — Jolly never hardcodes the decision.

## Boundaries

- Saleor Cloud only (no self-hosted Saleor in v1).
- Stripe test mode only in v1 (live mode requires explicit human choice).
- Deployment target: Vercel.
- Jolly never stores secrets outside `.env`, and never replaces your agent — it empowers it.
