# Jolly Agent Setup Guide

Ahoy, agent. Your customer has invited you to set up a Saleor Cloud storefront with Jolly.

## Quick start

Run this command to begin the end-to-end setup:

```
npx @saleor/jolly start
```

**The CLI handles everything automatically**, including installing all Saleor agent skills during the setup flow. There are no separate setup or install steps for you to run — the single `start` command orchestrates everything.

For testing, you can use:

```
npx @dk/jolly start
```

## What Jolly does

Jolly helps you, the agent, set up a fully operational Saleor Cloud storefront end-to-end. It handles:

1. **Connecting or creating a Saleor Cloud store** — If the customer already has one, you'll accept their Saleor URL. If not, Jolly will help create one (the customer signs up at saleor.io/cloud).
2. **Cloning the Paper storefront** — Uses the official Saleor Paper template (Next.js, Tailwind, pnpm).
3. **Configuring environment** — Writes Saleor and Stripe credentials to `.env`.
4. **Deploying to Vercel** — Uses Git-based deployment with GitHub as the default provider.
5. **Configuring Stripe test mode** — On the customer's Stripe Dashboard, get the publishable key and secret key.

Only **three things need the human**:
- New account creation (Saleor Cloud, Vercel, or Stripe if needed)
- Browser OAuth consent
- Pasting secret values (Stripe API keys)

Everything else is automated.

## After setup — live store access

Once the store is deployed, you have read-only access to live store data via the Saleor MCP server at `mcp.saleor.app`. Jolly configures mcp-graphql during setup so you can query products, orders, and customers from day one.

## Supported agent targets

This guide works with any agent. Jolly also provides optimized setup for:

- **Generic agents** — Any agent environment that supports `npx`
- **Zed** — Agent mode
- **Claude Code** — Claude Code CLI
- **Cursor** — Composer agent
- **OpenCode** — Open source agent
- **Pi.dev** — Coding agent

## Skill installation

Jolly automatically installs the full Saleor skill set on `jolly start`:

| Skill | Status |
|-------|--------|
| `saleor-storefront` | Mandatory — Storefront API patterns |
| `saleor-configurator` | Mandatory — Commerce as Code |
| `storefront-builder` | Recommended — Stepwise playbook |
| `saleor-core` | Recommended — Backend diagnostics |
| `saleor-app` | Situational — App/webhook configuration |
| `saleor-paper-storefront` | Included when Paper is cloned |

The `saleor/agent-skills` repository at https://github.com/saleor/agent-skills contains the canonical skill set. Skills are installed using standard project-local skill locations.

## Architecture

- **Jolly** sets up the storefront and provides diagnostics (`jolly doctor`, `jolly upgrade`)
- **Saleor MCP server** (`mcp.saleor.app`) provides read-only access to live store data
- **Your agent** remains the primary orchestrator, explainer, and approval manager
- Jolly never replaces your agent — it empowers it

## Idempotency

All Jolly commands are safe to re-run. Running `jolly start` or any `jolly create` subcommand again detects existing work and skips or resumes rather than duplicating. If a directory already exists, Jolly will ask how to proceed.

## Boundaries

- Saleor Cloud only (no self-hosted Saleor support in v1)
- Stripe test mode only in v1 (live mode requires explicit customer choice)
- Deployment target: Vercel
- Jolly does not implement Saleor backend features or replace Saleor Dashboard
- Jolly does not depend on the deprecated Saleor CLI
- Jolly does not store secrets outside `.env`
- V1 does not include Jolly-owned auth, telemetry, or usage controls
