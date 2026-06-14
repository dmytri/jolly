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
- **Hand you the terminal at interactive CLI logins** — `vercel login`, `stripe login`: `start`
  runs the CLI with stdio passed straight through, the human completes the login as that CLI
  directs (URL/browser/one click), and `start` continues when it exits (exit 0 → next; non-zero →
  it stops honestly).
- **Announce and wait at the human gates no CLI can do** — creating a Saleor/Vercel/Stripe
  account, the **Saleor Dashboard Stripe app** (configure with the keys + map to the `us`
  channel), and pasting a secret no CLI hands over. `start` prints the exact step (in the
  envelope, so you can relay it) and waits, then resumes.
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
2. **Authenticate Saleor Cloud** — `jolly login` (browser OAuth, or a pasted `--token`). Stores
   `JOLLY_SALEOR_CLOUD_TOKEN` in `.env`. For a brand-new account, send the human to
   cloud.saleor.io to sign up, then resume.
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
   (or `SALEOR_URL`/`SALEOR_TOKEN`), with `--fail-on-breaking` on `deploy`. High-risk → approval
   gate; review the diff before the deploy writes. (`deploy` reconciles the store to the recipe; on
   a **blank** environment that is purely additive — Jolly provisions environments blank for
   exactly this.) **After the deploy, `start` seeds stock** — it sets a default quantity (100) for
   every recipe variant in the recipe warehouse via Saleor GraphQL, because `@saleor/configurator`
   cannot set stock or `trackInventory` (it hardcodes `trackInventory: true`). Without this the
   catalog has zero stock and checkout fails with `INSUFFICIENT_STOCK` before reaching payment.
7. **Stripe (test mode)** — `start` installs Saleor's Stripe app for you via the Saleor GraphQL
   `appInstall` mutation (HANDLE_PAYMENTS); the recipe sets the channel payment flow. The keys and
   the channel mapping have **no public API**, so this stage is a guided gate:
   - Get test keys the fast way: `npx @stripe/cli login` (one browser click — if there's no Stripe
     account, sign up at https://dashboard.stripe.com/register first; test mode works immediately).
     Then `jolly create stripe` with no flags imports the keys read-only from the CLI session
     (`stripe config --list` → `.env`, never printed); you never handle the secret. Pass
     `--publishable-key …/--secret-key …` to override with durable Dashboard keys.
   - **These CLI keys expire (~90 days — `test_mode_key_expires_at`).** Flag the date to the human
     now and own the follow-up: before expiry, generate durable Dashboard keys (Developers → API
     keys), re-run `jolly create stripe`, and update the Stripe app config. Don't let checkout
     silently break at the 90-day mark.
   - Then the **Dashboard Stripe app** (human gate `start` waits at): Saleor Dashboard →
     Extensions → the Stripe app, add a configuration with those keys, and **map it to the `us`
     channel**. The app registers its own Stripe webhooks. The configurator does **not** touch
     payments — this is the Saleor-supported path.
8. **Deploy to Vercel** — the official Vercel CLI, spawned by `start`: `npx vercel`. Auth is the
   CLI's own `vercel login` session (if `npx vercel whoami` fails, `start` runs `vercel login`
   with the terminal handed through, then resumes). Set the project env vars
   (`NEXT_PUBLIC_SALEOR_API_URL`, `NEXT_PUBLIC_DEFAULT_CHANNEL=us`) via the CLI, deploy to
   production (`npx vercel --prod`), and capture the URL. High-risk → approval gate. **Vercel
   Deployment Protection is on by default and blocks public access** — `start` surfaces it for the
   human/agent to disable so the store is reachable. No other deployment mechanism.
9. **Wire trusted origins** — add the deployed URL to Saleor's allowed/trusted origins.
10. **Verify** — `jolly doctor` (all groups): Saleor connectivity, storefront env, deployment
    reachability, and checkout reaching the Stripe test payment step. Report the live URL, the
    doctor results, and any remaining manual steps.

## If a step fails or you're unsure

Run `npx @dk/jolly doctor` — it names what is wrong and the concrete next action (a command, a CLI
to authenticate, a value to ask your human for). Fix that, then re-run `jolly start`; it resumes
from the first outstanding stage. Never treat a failed command as success.

## Honesty

Never claim a step succeeded that you did not actually perform and confirm. If a CLI is missing or
unauthenticated, stop and tell the human exactly what to do (e.g. `npx vercel login`) — do not
fabricate success or invent a fallback. Jolly's own commands follow the same rule.
