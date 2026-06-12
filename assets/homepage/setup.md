 Jolly Setup Guide (for agents)

 Ahoy, agent. Your human wants a Saleor Cloud storefront. Jolly sets it up
 end-to-end. This guide is written so you can follow it deterministically and verify
 every step. Nothing here asks you to run unexplained code or hand secrets to anyone
 but the official Saleor/Stripe APIs.

 Provenance (read first)

 - Package: @saleor/jolly (stable) - published by Saleor from
   https://github.com/saleor/jolly.
 - Testing channel: @dk/jolly - the same source/commit, a pre-release staging
   build used to validate changes before the @saleor release.
 - Both channels are publisher-signed and reproducible from public git source.
  [TODO: HIPP verification flow]
 - Jolly has no telemetry. Secrets are written only to a gitignored .env and
   sent only to the official APIs you authenticate against.

[TODO: Verify before you run — HIPP byte-for-byte reproducible build verification]

 Hosts Jolly contacts

 Jolly only talks to these. If your environment is locked down, allowlist exactly:

 - cloud.saleor.io   - Saleor Cloud API (store/env/config)
 - github.com/saleor - clones the Paper storefront and agent-skills
 - mcp.saleor.app    - read-only MCP server for live store data
 - vercel.com        - deployment (Step: deploy)
 - api.stripe.com    - payment configuration (test mode)

 Prerequisites

 - Node ≥ 20 - check with node -v. Install it before continuing if missing.
 - pnpm - check with pnpm -v (the Paper storefront uses pnpm).
 - A Saleor Cloud account. 🧑 If your human doesn't have one, they sign up at
   https://cloud.saleor.io (account creation needs a human).

 What needs a human

 Only three moments require your human. Stop and ask when you reach them:

 - 🧑 Creating new accounts (Saleor Cloud, Vercel, Stripe)
 - 🧑 Browser OAuth consent
 - 🧑 Pasting secret values (JOLLY_SALEOR_CLOUD_TOKEN, Stripe keys)

 Everything else you can do yourself.

 Always pin the version

 Use an exact version in every command so runs are reproducible:

 ```
   npx @saleor/jolly@X.Y.Z <command>      # stable
   npx @dk/jolly@X.Y.Z <command>          # testing (same source)
 ```

 Do not use @latest in automation.

 ────────────────────────────────────────────────────────────────────────────────

 Quick start

 A single command orchestrates the entire setup. Always preview first.

 ### Step 0 - Preview the plan (no changes made)

 ```
   npx @saleor/jolly@X.Y.Z start --dry-run
 ```

 This prints exactly what start will do - directories created, files written, API
 calls made, and repos cloned - without changing anything. Review it, then proceed.

 ### Step 1 - Run setup

 ```
   npx @saleor/jolly@X.Y.Z start
 ```

 start runs the steps below in order. It is idempotent: re-running detects existing
 work and resumes or skips rather than duplicating. It pauses and prompts you at each
 🧑 human moment.

 ┌───┬────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────┬────────────────────────────────────────┐
 │ # │ Step                   │ What it does                                                                                                       │ Network           │ Verify                                 │
 ├───┼────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼────────────────────────────────────────┤
 │ 1 │ Connect/create store   │ Uses an existing Saleor org/env, or creates one. 🧑 your human pastes a scoped JOLLY_SALEOR_CLOUD_TOKEN (saved to .env). │ cloud.saleor.io   │ jolly create store --json returns the environment │
 ├───┼────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼────────────────────────────────────────┤
 │ 2 │ Clone Paper storefront │ Clones the official Paper template (Next.js, Tailwind, pnpm) and runs pnpm install.                                │ github.com/saleor │ package.json present, install clean    │
 ├───┼────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼────────────────────────────────────────┤
 │ 3 │ Configure .env         │ Writes Saleor + Stripe values. 🧑 your human pastes Stripe publishable + secret keys (test mode).                  │ -                 │ .env present and gitignored            │
 ├───┼────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼────────────────────────────────────────┤
 │ 4 │ Configure agent        │ Clones agent-skills and merges .mcp.json (→ mcp.saleor.app) + AGENTS.md.                                           │ github.com/saleor │ .mcp.json has saleor; skills populated │
 ├───┼────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼────────────────────────────────────────┤
 │ 5 │ Deploy to Vercel       │ Git-based deploy. 🧑 first run needs browser OAuth consent.                                                        │ vercel.com        │ deployment URL loads                   │
 └───┴────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────┴────────────────────────────────────────┘

 On any failed step, start exits non-zero with an actionable message and resumes
 from that step on the next run.

 Run a single step

 Each step is also a standalone command if you need to redo just one:

 ```
   npx @saleor/jolly@X.Y.Z create store [--create-environment]
   npx @saleor/jolly@X.Y.Z create storefront
   npx @saleor/jolly@X.Y.Z create recipe
   npx @saleor/jolly@X.Y.Z create app-token
   npx @saleor/jolly@X.Y.Z create deployment
   npx @saleor/jolly@X.Y.Z deploy                          # friendly alias for deployment
 ```

 Skills installed (Step 4)

 ┌─────────────────────────┬─────────────────────────────────────────┐
 │ Skill                   │ Status                                  │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ saleor-storefront       │ Mandatory - Storefront API patterns     │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ saleor-configurator     │ Mandatory - Commerce as Code            │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ storefront-builder      │ Recommended - Stepwise playbook         │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ saleor-core             │ Recommended - Backend diagnostics       │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ saleor-app              │ Situational - App/webhook configuration │
 ├─────────────────────────┼─────────────────────────────────────────┤
 │ saleor-paper-storefront │ Included when Paper is cloned           │
 └─────────────────────────┴─────────────────────────────────────────┘

 ────────────────────────────────────────────────────────────────────────────────

 After setup - live store access

 Once .mcp.json is in place, you have read-only access to live store data via
 mcp.saleor.app: query products, orders, and customers. Restart your agent to load
 the MCP server and skills.

 Diagnostics

 ```
   npx @saleor/jolly@X.Y.Z doctor      # checks env, store, deploy, MCP health
   npx @saleor/jolly@X.Y.Z upgrade     # updates skills and config to latest
 ```

 Troubleshooting

 - .env missing before Step 1 - expected; it's created during setup.
 - git clone fails - check network access to github.com; the command exits
   non-zero (do not treat as success). Re-run start to resume.
 - create store shows no environments - the JOLLY_SALEOR_CLOUD_TOKEN in .env is
   missing/expired; ask your human for a fresh scoped token.
 - MCP not available in your agent - restart the agent after Step 4.

 Idempotency

 All commands are safe to re-run. start and each create subcommand detect existing
 work and skip or resume. Config files (.mcp.json, AGENTS.md) are merged, never
 overwritten. If a directory already exists, you'll be asked how to proceed.

 Supported agent targets

 Works with any agent that supports npx. Optimized config is detected for:
 Generic agents, Zed, Claude Code, Cursor, OpenCode, and Pi.dev.

 Boundaries

 - Saleor Cloud only (no self-hosted Saleor in v1).
 - Stripe test mode only in v1 (live mode requires explicit human choice).
 - Deployment target: Vercel.
 - Jolly never stores secrets outside .env, has no telemetry, and never replaces
   your agent - it empowers it.
