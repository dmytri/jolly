# Jolly Setup Guide (for agents)

Ahoy, agent. Your human wants a Saleor Cloud storefront. Jolly sets it up
end-to-end. This guide is written so you can follow it deterministically and verify
every step. Nothing here asks you to run unexplained code or hand secrets to anyone
but the official Saleor, Vercel, and Stripe APIs.

## Provenance (read first)

- Jolly is a tool by Dmytri Kleiner that helps agents set up a store quickly
  using Saleor, Vercel and Stripe. It is **not an official product of Saleor,
  Vercel, or Stripe**.
- Package: `@dk/jolly` — source at https://github.com/dmytri/jolly.
- Jolly has no telemetry. Secrets are written only to a gitignored `.env` and
  sent only to the official APIs you authenticate against.

## Hosts Jolly contacts

Jolly only talks to these. If your environment is locked down, allowlist exactly:

- `auth.saleor.io` — browser OAuth login (Keycloak)
- `cloud.saleor.io` — Saleor Cloud API (store/env/config)
- `*.saleor.cloud` — your own store's GraphQL endpoint
- `github.com` — clones the Paper storefront and agent-skills (saleor org repos)
- `api.vercel.com` — deployment (Step: deploy)
- `api.stripe.com` — payment configuration (test mode)
- `127.0.0.1` — local OAuth callback during login

Jolly never contacts `mcp.saleor.app` — that is a separate read-only MCP server
*you* (the agent) may choose to use after setup; see "After setup" below.

## Prerequisites

- Node ≥ 23 — check with `node -v`. The Jolly CLI runs on Node's native
  TypeScript support; install Node ≥ 23 before continuing if missing.
- pnpm — check with `pnpm -v` (the Paper storefront uses pnpm).
- A Saleor Cloud account. 🧑 If your human doesn't have one, they sign up at
  https://cloud.saleor.io (account creation needs a human).

## What needs a human

Only three moments require your human. Stop and ask when you reach them:

- 🧑 Creating new accounts (Saleor Cloud, Vercel, Stripe)
- 🧑 Browser OAuth consent
- 🧑 Pasting secret values (`JOLLY_SALEOR_CLOUD_TOKEN`, Stripe keys)

Everything else you can do yourself.

---

## Quick start

A single command orchestrates the entire setup. Always preview first.

### Step 0 — Preview the plan (no changes made)

```
npx @dk/jolly start --dry-run
```

This prints exactly what `start` will do — directories created, files written, API
calls made, and repos cloned — without changing anything. Review it, then proceed.

### Step 1 — Run setup

```
npx @dk/jolly start
```

`start` runs the steps below in order. It is idempotent: re-running detects existing
work and resumes or skips rather than duplicating. It pauses and prompts you at each
🧑 human moment.

| # | Step | What it does | Network | Verify |
|---|------|--------------|---------|--------|
| 1 | Connect/create store | Uses an existing Saleor org/env, or creates one. 🧑 your human pastes a scoped `JOLLY_SALEOR_CLOUD_TOKEN` (saved to `.env`). | cloud.saleor.io | `jolly create store --json` returns the environment |
| 2 | Clone Paper storefront | Clones the official Paper template (Next.js, Tailwind, pnpm) and runs `pnpm install`. | github.com/saleor | `package.json` present, install clean |
| 3 | Configure `.env` | Writes Saleor + Stripe values. 🧑 your human pastes Stripe publishable + secret keys (test mode). | — | `.env` present and gitignored |
| 4 | Configure agent | Clones agent-skills and merges `.mcp.json` (local mcp-graphql → your store's GraphQL endpoint) + `AGENTS.md`. | github.com/saleor | `.mcp.json` has saleor-graphql; skills populated |
| 5 | Deploy to Vercel | Git-based deploy. 🧑 first run needs browser OAuth consent. | api.vercel.com | deployment URL loads |

On any failed step, `start` exits non-zero with an actionable message and resumes
from that step on the next run.

## Run a single step

Each step is also a standalone command if you need to redo just one:

```
npx @dk/jolly create store [--create-environment]
npx @dk/jolly create storefront
npx @dk/jolly create recipe
npx @dk/jolly create app-token
npx @dk/jolly create deployment
npx @dk/jolly deploy                          # friendly alias for deployment
```

## Skills installed (Step 4)

| Skill | Status |
|-------|--------|
| `saleor-storefront` | Mandatory — Storefront API patterns |
| `saleor-configurator` | Mandatory — Commerce as Code |
| `storefront-builder` | Recommended — Stepwise playbook |
| `saleor-core` | Recommended — Backend diagnostics |
| `saleor-app` | Situational — App/webhook configuration |
| `saleor-paper-storefront` | Included when Paper is cloned |

---

## After setup — live store access

Once `.mcp.json` is in place, restart your agent to load the skills and the local
mcp-graphql server, which gives you live access to your own store's GraphQL
endpoint. Separately, Saleor runs a read-only MCP server at mcp.saleor.app
(products, orders, customers) that you may also configure — Jolly itself never
contacts it.

## Diagnostics

```
npx @dk/jolly doctor      # checks env, store, deploy, MCP health
npx @dk/jolly upgrade     # updates skills and config to latest
```

## Troubleshooting

- `.env` missing before Step 1 — expected; it's created during setup.
- `git clone` fails — check network access to github.com; the command exits
  non-zero (do not treat as success). Re-run `start` to resume.
- `create store` shows no environments — the `JOLLY_SALEOR_CLOUD_TOKEN` in `.env` is
  missing/expired; ask your human for a fresh scoped token.
- MCP not available in your agent — restart the agent after Step 4.

## Idempotency

All commands are safe to re-run. `start` and each `create` subcommand detect existing
work and skip or resume. Config files (`.mcp.json`, `AGENTS.md`) are merged, never
overwritten. If a directory already exists, you'll be asked how to proceed.

## Supported agent targets

Works with any agent that supports `npx`. Optimized config is detected for:
Generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev.

## Boundaries

- Saleor Cloud only (no self-hosted Saleor in v1).
- Stripe test mode only in v1 (live mode requires explicit human choice).
- Deployment target: Vercel.
- Jolly never stores secrets outside `.env` and never replaces your agent — it
  empowers it.
