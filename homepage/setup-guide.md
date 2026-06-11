# Jolly agent setup guide

These are generic agent instructions: they work for any AI agent. You — the customer's
agent — are the primary interface and orchestrator for all Jolly workflows. Jolly exists
to empower you, not replace you: it provides setup automation, capabilities, wrappers,
and diagnostics, while you stay in charge of the conversation, decisions, and approvals.

Jolly handles setup automation for an end-to-end Saleor Cloud storefront. After setup is
complete, the Saleor MCP server at mcp.saleor.app gives you read-only access to live
store data — you can query products, orders, and customers there; Jolly itself configures
mcp-graphql for you during initialization so you have that live-data access from day one.

> The canonical URL of this guide is still a placeholder
> (https://jolly.example.com/setup-guide) until the final hosting location is decided.

## How to onboard the customer

1. Give the customer a brief welcome.
2. Explain Jolly in one or two concise sentences (for example: "Jolly sets up a complete
   Saleor Cloud storefront — store, configuration, Stripe test checkout, and Vercel
   deployment — driven by me, your agent. After setup we iterate on it together.").
3. Ask whether the customer already has a Saleor store or wants to register one. Offer
   exactly these two choices:
   - "I already have a Saleor store"
   - "I want to register a Saleor store"
   Do not proceed to storefront creation until this branch is known.
4. Identify up front which steps require human action outside the agent (see
   "Human-action steps" below); everything else you and Jolly automate with safe defaults.

## Recommended command sequence

Run Jolly via `npx` — no prior global install is required. The recommended sequence is
`jolly init`, then `jolly skills install`, then `jolly start`:

```sh
# Production invocation examples
npx @saleor/jolly init            # initialize local agent setup, write agent guidance,
                                  # and configure mcp-graphql for live store access
npx @saleor/jolly skills install  # install/manage the Saleor agent skills via the Jolly CLI
npx @saleor/jolly start           # orchestrated end-to-end setup (resumable, idempotent)
```

```sh
# Testing invocation examples (pre-release package)
npx @dk/jolly init
npx @dk/jolly skills install
npx @dk/jolly start
```

Every stage of `jolly start` is also available as composable subcommands (`jolly create
store`, `jolly create storefront`, `jolly deploy`, `jolly doctor`, ...), so you can run
steps independently. All commands support `--json`, `--quiet`, and `--yes`.

## Skills: install and manage through the Jolly CLI

Install and manage skills with `jolly skills install` and `jolly skills update` rather
than manual steps, so Jolly can handle version updates over time. The skills come from
`saleor/agent-skills` (https://github.com/saleor/agent-skills); `jolly skills install`
installs the relevant set for you. Skill tiers:

- **Mandatory** — `saleor-storefront` (Storefront API patterns) and
  `saleor-configurator` (config-as-code workflow). The setup flow depends on these.
- **Recommended** — `storefront-builder` (stepwise storefront playbook) and
  `saleor-core` (backend internals, useful for troubleshooting and doctor follow-ups).
- **Situational** — `saleor-app` (only if you create or configure Saleor apps or
  webhooks), and Paper's embedded `saleor-paper-storefront` skill, which is included
  after the storefront is cloned (it ships inside the Paper repository).

Do not depend on, shell out to, or ask the customer for the deprecated `saleor/cli`
package; Jolly never uses it.

## Supported agent targets

Generic agents are supported first, plus first-class instructions for: Zed, Claude Code,
Cursor, OpenCode, and Pi.dev.

## Human-action steps

Only these steps need a human; tell the customer exactly what you need, then resume
automatically once they provide it:

- **New account creation.** For a new Saleor Cloud account, direct the customer to
  saleor.io/cloud for the browser signup flow, then wait for the resulting store URL.
  Do not try to automate the browser signup itself. The same applies to creating a new
  Vercel account at vercel.com or a Stripe account at stripe.com.
- **Browser OAuth consent.** When a login needs browser OAuth, the customer completes
  the consent in their browser; a headless token flow is available when a browser is not.
- **Providing secret values.** Secret keys (for example Stripe API keys) must be pasted
  by the customer. Jolly writes them to `.env` (Git-ignored) and never prints them.

## Stripe test-mode checkout

V1 uses Stripe test mode only. Tell the customer to open the Stripe Dashboard at
stripe.com and switch to test mode, then ask them to paste the publishable key and the
secret key. Only these two keys are needed — no other Stripe configuration is required
from the customer at this point. Jolly writes both to `.env` (after ensuring `.env` is
ignored by Git) and configures Saleor's Stripe integration from there.

## Vercel deployment

Ask whether the customer already has a Vercel account. If yes, proceed with automated
setup via the Vercel CLI/API; if not, guide them through new Vercel account registration
first. When Git-based deployment is useful, ask whether the customer wants Git repository
setup — GitHub is the default Git provider. Jolly configures the required environment
variables, verifies the deployed storefront can reach Saleor Cloud, and updates Saleor
trusted origins automatically where APIs allow.

## After setup: iteration with live store data

Jolly handles setup automation; the MCP server enables you to query live store data
post-setup. Use mcp.saleor.app (read-only) for products, orders, and customers, and use
`jolly doctor` and `jolly upgrade` for diagnostics and maintenance. Customization of the
storefront belongs to you — the customer's own agent — and the customer's workflow.
