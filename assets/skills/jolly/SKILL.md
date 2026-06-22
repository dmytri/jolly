---
name: jolly
description: End-to-end playbook for setting up a Saleor Cloud storefront with Jolly — run `jolly start` and supervise it as it spawns the official CLIs (Vercel, @saleor/configurator, git, pnpm) plus Jolly's own plumbing, from one command to a live, deployed store.
---

# Jolly setup playbook

You are the customer's own agent. **Jolly does not replace you.** The primary path is one
command — **`jolly start`** — a resumable runner that performs the whole setup end-to-end by
**spawning the official CLIs** (`git` clone of Paper, `pnpm install`, `@saleor/configurator
diff`/`deploy`, `npx vercel`) alongside its own plumbing (auth, store/app-token, secret writing,
`.mcp.json`, diagnostics). **You stay in charge:** `start` pauses for *your* approval before each
high-risk action and waits at the human gates; you provide credentials, decide approvals, and own
all post-setup iteration. Jolly owns only the mechanical choreography between gates — and it never
reimplements a CLI against raw APIs, holds no Vercel token, and never fabricates a step it did not
perform.

The goal: a real, deployed, working storefront (browsing, cart, and checkout to the Stripe test
payment step) with the fewest human interruptions — only the steps no tool can do (new-account
creation, browser login consent, the Dashboard Stripe-app config).

> Exact upstream commands and flags (Vercel CLI, `@saleor/configurator`, Paper's
> `saleor/storefront`) change over time. Re-check current upstream docs/`--help` at run time
> rather than trusting memorized invocations. This skill describes the *flow*; the tools own the
> *specifics*.

## Before each action

Every Jolly command emits one structured envelope (`command`, `status`, `summary`, `data`,
`checks`, `nextSteps`, `errors`) and, before any create/modify/deploy action, a `riskContext`
(`action`, `target`, `riskLevel`, `categories`, `reversible`, `sideEffects`, `dryRunAvailable`).
**You** decide whether to seek the customer's approval from that risk context and the customer's
policies — Jolly never hardcodes the decision. Parse `--json` to branch.

## Run it: `jolly start`

```
jolly start            # orchestrate end-to-end, pausing at each gate
jolly start --dry-run   # preview the whole plan (stages, effects, riskContexts) — changes nothing
jolly start --yes       # pre-approve the high-risk stages and run straight through
```

Preview first with `--dry-run --json`: the `data.plan` lists every stage, its effects, and the
`riskContext` for each side-effecting one. Then run `jolly start`. It will:

- **Bootstrap first** — install this skill + the Saleor agent-skills via `npx skills add`, write
  `.mcp.json` (local mcp-graphql against your endpoint), scaffold, and run `jolly doctor`.
- **Pause for your approval before each high-risk stage** — `create store`, the
  `@saleor/configurator deploy`, and the `npx vercel` deploy. `start` emits that stage's
  `riskContext` and waits; you approve (or `--yes` pre-approves the whole run). It never
  self-approves.
- **Sign you in to Vercel** — `start` performs the Vercel sign-in itself: it runs the device flow
  and prints the verification URL for the human to approve in a browser, then continues when the
  CLI exits (exit 0 → next; non-zero → it stops honestly).
- **Announce and wait at the human gates no CLI can do** — creating a Saleor/Vercel/Stripe
  account, the **Saleor Dashboard Stripe app** (configure with the keys + map to the `us`
  channel), and pasting a secret no CLI hands over. `start` prints the exact step (in the
  envelope, so you can relay it) and waits, then resumes.
- **Never make the human paste a secret to you if they would rather not.** Whenever the token must
  come from the human, offer the private path: they can write it into the gitignored `.env`
  themselves under the variable name you give them (the Saleor Cloud token is
  `JOLLY_SALEOR_CLOUD_TOKEN`) and you carry on — Jolly reads `.env`, so you never need to see or
  hold the value. Pasting it to you is only a convenience, never a requirement.
- **Verify and report honestly** — it runs `jolly doctor` automatically and reports only the
  stages it actually performed, with the deployed URL and any remaining manual steps. A stage
  that is pending, paused for approval, or waiting at a human gate is reported as such (envelope
  status `warning`), never as a completed success.

**Resumable:** re-running `jolly start` is safe — it detects what you and it already did (the
cloned storefront, the configured store, the deployment) and continues from the first outstanding
stage rather than redoing work.

## The stages (each is also a command you can run yourself)

`start` chains these; every one is also a composable command, so you can drive any single stage
and mediate it yourself. The order and the load-bearing specifics:

1. **Bootstrap** — `jolly init` (skills + `.mcp.json` + scaffold + doctor). Never overwrite
   Jolly's marked `AGENTS.md` section.
2. **Authenticate Saleor Cloud** — `jolly login` with a Saleor Cloud token. The human mints a token
   at `https://cloud.saleor.io/tokens` and hands it over
   via `--token <value>`, `--token-file <path>`, `--token-stdin`, or `JOLLY_SALEOR_CLOUD_TOKEN` in
   `.env`; at an interactive terminal, plain `jolly login` prompts for a paste with echo off. Jolly
   verifies it, then stores `JOLLY_SALEOR_CLOUD_TOKEN` in `.env` (`jolly doctor` re-verifies). If
   the human prefers not to paste it to you, they set it in `.env` themselves. For a brand-new
   account, send the human to cloud.saleor.io to sign up, then resume.
3. **Provision the store** — `jolly create store` (creates/reuses the Cloud organization,
   project, and a **blank** environment via the Cloud API). High-risk → approval gate.
4. **App token** — `jolly create app-token` (full v1 permissions, for configuration).
5. **Storefront** — clone Paper (`git clone https://github.com/saleor/storefront.git ./storefront`,
   `main`), strip the upstream `.git`, `git init`, `cp .env.example .env`, `pnpm install`. If the
   local Node version is incompatible with Paper, tell the human (don't switch Node yourself). In
   the storefront `.env` set `NEXT_PUBLIC_SALEOR_API_URL` to your GraphQL endpoint and
   `NEXT_PUBLIC_DEFAULT_CHANNEL=us` (the channel the recipe creates).
6. **Configure the store** — the Jolly starter recipe ships beside this file as `recipe.yml` (a
   pirate-themed US/USD/English catalog with shipping and the `us` channel Paper points at). Copy
   it into the storefront repo as `saleor-config.yml` (version-controlled, reviewable), then apply
   with `@saleor/configurator`'s safe workflow — `diff` to preview, then `deploy` — passing
   `--url "$NEXT_PUBLIC_SALEOR_API_URL" --token "$JOLLY_SALEOR_APP_TOKEN" --config saleor-config.yml`
   (or `SALEOR_URL`/`SALEOR_TOKEN`). High-risk → approval gate; review the diff before the deploy
   writes. `deploy` reconciles the store to the recipe: it creates the recipe's entities and removes
   the empty stock placeholders a new Saleor environment ships (a default channel, category, and
   warehouse — never products). **On a store you just created this is safe, not data loss: those
   placeholders are not your catalog, and a fresh environment has no products to delete.** A Saleor
   environment can't be provisioned with zero entities — the placeholders always ship — so the
   recipe replaces them. Jolly gates this by the store's STATE: over a store that already holds real
   catalog it passes `--failOnDelete`, so a destructive apply is BLOCKED (exit 6) for your explicit
   approval rather than silently deleting anything. **After the deploy, `start` seeds stock** — it sets a default quantity (100) for
   every recipe variant in the recipe warehouse via Saleor GraphQL, because `@saleor/configurator`
   cannot set stock or `trackInventory` (it hardcodes `trackInventory: true`). Without this the
   catalog has zero stock and checkout fails with `INSUFFICIENT_STOCK` before reaching payment.
7. **Stripe (test mode)** — `start` installs Saleor's Stripe app in the store via the Saleor GraphQL
   `appInstall` mutation (HANDLE_PAYMENTS) and installs the `stripe-best-practices` skill so your
   agent has the Stripe knowledge for the rest; the recipe sets the channel payment flow.
   Configuring the app is a human Dashboard gate `start` waits at: in the Saleor Dashboard →
   Extensions → the Stripe app, add a configuration with the account's test-mode keys (from the
   Stripe Dashboard → Developers → API keys) and **map it to the `us` channel**. The app then
   registers its own Stripe webhooks. The configurator manages catalog, not payments — the Stripe
   app is the Saleor-supported payment path, and your agent drives this step with the Stripe skill.
8. **Deploy to Vercel** — `start` spawns the official Vercel CLI (`npx vercel`) and performs the
   Vercel sign-in itself: when there is no session it runs Vercel's device flow and prints a
   verification URL for the human to approve in a browser, then resumes when the CLI exits. It sets
   the project env vars (`NEXT_PUBLIC_SALEOR_API_URL`, `NEXT_PUBLIC_DEFAULT_CHANNEL=us`), deploys to
   production (`npx vercel --prod`), and captures the URL. High-risk → approval gate. Vercel
   Deployment Protection is on by default; `start` surfaces it so the human can turn it off and the
   store is reachable.
9. **Wire trusted origins** — add the deployed URL to Saleor's allowed/trusted origins.
10. **Verify** — `jolly doctor` (all groups): Saleor connectivity, storefront env, deployment
    reachability, and checkout reaching the Stripe test payment step. Report the live URL, the
    doctor results, and any remaining manual steps. Then remind the human to reload or restart their
    agent so the installed skills (the Jolly + Saleor skills and `stripe-best-practices`) load into
    its context for the work ahead.

## If a step fails or you're unsure

Run `jolly doctor` — it names what is wrong and the concrete next action (a command, a CLI
to authenticate, a value to ask your human for). Fix that, then re-run `jolly start`; it resumes
from the first outstanding stage. Never treat a failed command as success.

## Honesty

Never claim a step succeeded that you did not actually perform and confirm. If something is missing
or unauthenticated, stop and tell the human exactly what is needed — a credential, or a human-gate
action — and report it honestly rather than fabricating success or inventing a fallback. Jolly's
own commands follow the same rule.
