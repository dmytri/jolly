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

5. **Storefront** — clone the Paper template yourself:
   `git clone https://github.com/saleor/storefront.git ./storefront` (the `main` branch),
   remove the upstream `.git`, run `git init`, `cp .env.example .env`, and `pnpm install`. If the
   local Node version is incompatible with Paper, tell the human (don't switch Node yourself). In
   the storefront's `.env`, set `NEXT_PUBLIC_SALEOR_API_URL` to your store's GraphQL endpoint and
   `NEXT_PUBLIC_DEFAULT_CHANNEL=us` (the channel the starter recipe creates).

6. **Configure the store** — the Jolly starter recipe ships with this skill as `recipe.yml`
   (alongside this `SKILL.md`): a pirate-themed US/USD/English catalog with shipping and the `us`
   channel Paper points at. Copy it into the storefront repo as `saleor-config.yml` (keep it
   version-controlled and reviewable), then apply it with `@saleor/configurator`'s safe
   workflow — `diff` to preview, then `deploy` — passing
   `--url "$NEXT_PUBLIC_SALEOR_API_URL" --token "$JOLLY_SALEOR_APP_TOKEN" --config saleor-config.yml`
   (or set `SALEOR_URL`/`SALEOR_TOKEN`). Add `--fail-on-breaking` on `deploy`. Show the diff and
   seek the customer's approval before deploying writes. Jolly never runs the configurator; you do.

7. **Stripe (test mode)** — get the test keys the fast way, via the official Stripe CLI's
   browser OAuth login (no hunting through the Dashboard):
   - Run `npx @stripe/cli login` — it prints a URL; have the human open it and approve in the
     browser (one click). If they have no Stripe account, send them to
     https://dashboard.stripe.com/register first (test mode works immediately after signup —
     no business details needed). The CLI cannot create the account; that signup is the human's.
   - Read the test-mode keys from the CLI config (`npx @stripe/cli config --list` /
     `~/.config/stripe/config.toml`): `test_mode_pub_key` (`pk_test_…`) and `test_mode_api_key`
     (`sk_test_…`). Pass them to `jolly create stripe --publishable-key … --secret-key …`, which
     writes them to `.env` (never printed). Jolly never runs the Stripe CLI itself — you do.
   - **These CLI-issued keys are test-mode and expire (~90 days — see `test_mode_key_expires_at`).**
     That is the right tradeoff to get started fast, but the expiry is yours to handle: before it
     hits, generate durable keys in the Stripe Dashboard (Developers → API keys), re-run
     `jolly create stripe`, and update the Saleor Stripe app config. Flag the expiry date to the
     human now and own the follow-up — do not let checkout silently break at the 90-day mark.
   - Durable-from-the-start alternative: if the human prefers, skip the CLI and paste standard
     Dashboard keys straight into `jolly create stripe`. Live mode (out of v1 scope) always uses
     Dashboard keys.
   Then configure Saleor's **Stripe app** — the Saleor-supported payment path, *not* the
   configurator (which manages catalog only): in the Saleor Dashboard → Extensions, install or
   open the Stripe app, add a configuration with those keys, and **map it to the `us` channel**.
   The Stripe app registers its own Stripe webhooks automatically. This Dashboard step needs the
   human's click — guide them through it.

8. **Deploy to Vercel** — deploy with the official Vercel CLI: `npx vercel`. Authentication is
   the Vercel CLI's own `vercel login` session — if `npx vercel whoami` fails, pause and have
   the human run `npx vercel login` (browser), then resume. Set the project's env vars
   (`NEXT_PUBLIC_SALEOR_API_URL`, `NEXT_PUBLIC_DEFAULT_CHANNEL=us`) with the Vercel CLI
   (`npx vercel env add …`), deploy to production (`npx vercel --prod`), and capture the deployed
   URL. Do not use any other deployment mechanism.

9. **Wire trusted origins** — update Saleor's allowed/trusted origins to include the deployed
   storefront URL.

10. **Verify** — run `jolly doctor` (all groups) to confirm operational readiness: Saleor
    connectivity, storefront env, deployment reachability, and that checkout reaches the Stripe
    test payment step. Report the live URL, the doctor results, and any remaining manual steps.

## If a step fails or you're unsure

Run `npx @dk/jolly doctor` — it tells you what is wrong and the concrete next action (a
command to run, a CLI to authenticate, a value to ask your human for). Fix that, then
continue. Re-running `jolly start` is safe: Jolly detects what you (and it) already did —
the cloned storefront, the configured store, the deployment — and resumes from the first
outstanding step rather than redoing work. Never treat a failed command as success.

## Honesty

Never claim a step succeeded that you did not actually perform and confirm. If a CLI is missing
or unauthenticated, stop and tell the human exactly what to do (e.g. `npx vercel login`) — do
not fabricate success or invent a fallback. Jolly's own commands follow the same rule.
