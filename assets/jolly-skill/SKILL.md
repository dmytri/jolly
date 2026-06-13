---
name: jolly
description: End-to-end playbook for setting up a Saleor Cloud storefront with Jolly — teaches the customer's own agent to drive the official CLIs (Vercel, @saleor/configurator, git, pnpm) plus Jolly's thin helpers, from `jolly start` to a live, deployed store.
---

# Jolly setup playbook

You are the customer's own agent. **Jolly does not replace you** — it gives you a thin CLI
for plumbing (auth, store provisioning, secret writing, diagnostics) and this playbook. You
run the official CLIs yourself. Jolly never shells out to the Vercel CLI or
`@saleor/configurator`; you do.

Reach the goal — a real, deployed, working storefront (browsing, cart, and checkout to the
Stripe test payment step) — in as few human interruptions as possible. Pause only for the
unavoidable human steps: new-account creation, browser OAuth/login consent, and pasting secret
values. Everything else, automate.

> Exact upstream commands and flags (Vercel CLI, `@saleor/configurator`, Paper's
> `saleor/storefront`) change over time. Re-check the current upstream docs/`--help` at run
> time rather than trusting memorized invocations. The Jolly skill describes the *flow*; the
> tools own the *specifics*.

## Before each action

Every Jolly command emits one structured envelope (`command`, `status`, `summary`, `data`,
`checks`, `nextSteps`, `errors`) and, before any create/modify/deploy action, a `riskContext`
(`action`, `target`, `riskLevel`, `categories`, `reversible`, `sideEffects`, `dryRunAvailable`).
**You** decide whether to seek the customer's approval based on that risk context and the
customer's policies — Jolly never hardcodes the decision. Parse `--json` output to branch.

## Stages

1. **Bootstrap** — the customer ran `jolly start` (or you did). It installed this skill and the
   Saleor agent-skills via `npx skills add`, wrote `.mcp.json` (local mcp-graphql against the
   customer's own endpoint), scaffolded, ran `jolly doctor`, and emitted the playbook. Read its
   `data` and `nextSteps`.

2. **Authenticate to Saleor Cloud** — if not already authed, run `jolly login`. It prefers the
   browser OAuth flow and falls back to a pasted token; pause for the human's browser consent.
   The Saleor Cloud token is stored as `JOLLY_SALEOR_CLOUD_TOKEN` in `.env`.

3. **Provision the store** — run `jolly create store` (creates/reuses the Saleor Cloud
   organization, project, and environment via the Cloud API). For a brand-new Saleor account,
   direct the human to sign up at cloud.saleor.io first, then resume with the store URL.

4. **App token** — run `jolly create app-token` to acquire a Saleor app token (all permissions
   in v1) for configuration.

5. **Storefront** — clone the Paper template yourself: `git clone` `saleor/storefront` (the
   `main` branch) into `./storefront`, remove the upstream `.git`, run `git init`, and
   `pnpm install`. Validate the local Node version against Paper's requirement; if incompatible,
   tell the human (don't switch Node yourself). Set Paper's required env (e.g.
   `NEXT_PUBLIC_SALEOR_API_URL`, `NEXT_PUBLIC_DEFAULT_CHANNEL`).

6. **Configure the store** — apply the Jolly starter recipe (a pirate-themed demo catalog, US/
   USD/English, Stripe-ready checkout) using `@saleor/configurator`'s safe workflow
   (validate → diff → plan → deploy), passing the Saleor URL and app token. Show the diff/plan
   and seek approval before deploying writes.

7. **Stripe (test mode)** — ask the human for the Stripe publishable and secret keys from the
   Stripe Dashboard test mode; run `jolly create stripe --publishable-key … --secret-key …` to
   write them to `.env` (never printed). Configure Saleor's Stripe integration via
   `@saleor/configurator`.

8. **Deploy to Vercel** — deploy with the official Vercel CLI: `npx vercel`. Authentication is
   the Vercel CLI's own `vercel login` session — if `npx vercel whoami` fails, pause and have
   the human run `npx vercel login` (browser), then resume. Set the project's env vars with the
   Vercel CLI, deploy, and capture the deployed URL. Do not use any other deployment mechanism.

9. **Wire trusted origins** — update Saleor's allowed/trusted origins to include the deployed
   storefront URL.

10. **Verify** — run `jolly doctor` (all groups) to confirm operational readiness: Saleor
    connectivity, storefront env, deployment reachability, and that checkout reaches the Stripe
    test payment step. Report the live URL, the doctor results, and any remaining manual steps.

## Honesty

Never claim a step succeeded that you did not actually perform and confirm. If a CLI is missing
or unauthenticated, stop and tell the human exactly what to do (e.g. `npx vercel login`) — do
not fabricate success or invent a fallback. Jolly's own commands follow the same rule.
