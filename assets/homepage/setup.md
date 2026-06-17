# Jolly Setup Guide (for agents)

Ahoy, agent. Your human wants a Saleor Cloud storefront. Jolly empowers **you** to set
one up end-to-end — it does not replace you. You stay in control: you supervise as Jolly
runs the official CLIs, and you decide what needs your human's approval. Jolly installs a skill that walks you
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

- **Jolly (`jolly start`) runs the mechanical setup for you** — it spawns the official CLIs on
  your behalf for reliability: Saleor login and tokens, store provisioning, cloning the Paper
  storefront (`git`), `pnpm install`, applying the starter recipe (`@saleor/configurator`), and
  deploying (`npx vercel`) — plus writing secrets to `.env`, installing skills, `.mcp.json`, and
  diagnostics. It **pauses for your approval** before each create/deploy and **waits at the steps
  only a human can do**.
- **You (the agent) stay in charge:** you approve each high-risk action (Jolly shows you the risk
  first and never decides for you), you provide credentials when a step asks, and you own
  everything after setup. When a CLI needs a browser login, Jolly runs it and you complete the
  login as that CLI directs; Jolly continues when it finishes.

## Hosts

Jolly itself only contacts:

- `auth.saleor.io` — browser OAuth login (Keycloak)
- `cloud.saleor.io` — Saleor Cloud API (store/env)
- `*.saleor.cloud` — your own store's GraphQL endpoint
- `github.com` — installing skills (saleor org repos)
- `127.0.0.1` — local OAuth callback during login
- `api.stripe.com` — Stripe test-mode payment configuration

The official CLIs Jolly spawns reach their own services under their own auth: the Vercel CLI
→ `api.vercel.com`; `@saleor/configurator` → your `*.saleor.cloud` endpoint; `git` →
`github.com`; `npx` → the npm registry. If your environment is locked down, allowlist the
union of these.

## What needs a human

Only three moments require your human. Stop and ask when you reach them:

- 🧑 Creating new accounts (Saleor Cloud, Vercel, Stripe)
- 🧑 Browser OAuth / `vercel login` consent
- 🧑 Pasting secret values (`JOLLY_SALEOR_CLOUD_TOKEN`, Stripe keys)

Everything else Jolly does for you.

## Saleor Cloud auth — two endpoints, two schemes (read before probing)

Two Saleor surfaces, two auth schemes — mixing them is the most common way an agent talks
itself into a false "dead token":

- **Cloud platform API** — `https://cloud.saleor.io/platform/api` — organizations, projects,
  environments. Auth header is `Authorization: Token <token>` (Django REST `Token`, **not**
  `Bearer`). Validity probe: `GET https://cloud.saleor.io/platform/api/organizations/` → `200`
  with an organization list.
- **Your store's GraphQL API** — `https://<store>.saleor.cloud/graphql/` — catalog, channels,
  checkout. Auth header is `Authorization: Bearer <token>`.

Do **not** probe `https://cloud.saleor.io/graphql/`. That path is the Cloud **web app**
(Next.js), not the API: it returns `200 OK` with an HTML sign-in page even for an authenticated
request — a misleading "success".

Two token kinds, similar shapes:

- **Cloud staff token** — minted at `https://cloud.saleor.io/tokens`, ~81 chars,
  `uuid.base58` with a dot separator. This is `JOLLY_SALEOR_CLOUD_TOKEN`; it authenticates the
  Cloud platform API and store-GraphQL staff actions.
- **Per-store app token** — ~30 chars, separator-free, store-scoped. This is
  `JOLLY_SALEOR_APP_TOKEN`; it cannot call the Cloud platform API.

**Let Jolly verify — don't hand-roll a probe.** `jolly login --token <value>` and `jolly
doctor` run the correct authenticated check and report the real result. A `401` from a
hand-written `curl` with the wrong scheme or endpoint is not evidence the token is dead.

## Operating headlessly or on a remote VM

Browser OAuth (`jolly login` with no flags) starts a callback listener at
`http://127.0.0.1:5375/callback` **on the machine running Jolly**. If your agent runs on a
remote or headless VM while the human's browser is on their own laptop, the browser's redirect
reaches the laptop's `127.0.0.1` — where nothing is listening — and the flow cannot complete.
Use token login instead:

1. The human mints a Cloud staff token at `https://cloud.saleor.io/tokens`.
2. Supply it without putting the literal in a command argument:
   `jolly login --token-file <path>` (a mode-600 file), `jolly login --token-stdin` (stdin), or
   `JOLLY_SALEOR_CLOUD_TOKEN=<value> jolly login`. Jolly verifies it before writing it to `.env`.

`jolly start --yes` then runs the create/deploy stages; the Saleor Dashboard Stripe app stays a
human gate.

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

Prints the full end-to-end plan — every CLI it will run, files written, hosts contacted, and
the points where it will pause for your approval or a human step — without changing anything.
Review it, then proceed.

### Step 1 — Run it

```
npx @dk/jolly start
```

**Running autonomously?** If you are an agent the customer asked to set the store up end-to-end
and there is no human watching to approve each step, run it with `--yes`:

```
npx @dk/jolly start --yes
```

`--yes` pre-approves the create/deploy stages so the run proceeds straight through instead of
pausing for per-stage approval. It still stops at the true human gates (account creation, the
Dashboard Stripe app) and still reports only what it actually did. The full run provisions a
store, clones and builds the storefront, and deploys — it takes several minutes, so allow a
generous time budget (or run it in the background and poll) rather than cancelling it.

`start` runs the whole setup end-to-end, **spawning the official CLIs for you** (clone Paper,
`pnpm install`, apply the starter recipe with `@saleor/configurator`, deploy with `npx vercel`)
alongside its own plumbing (login, store, app token, Stripe key import, `.mcp.json`, skills,
`doctor`). It:

- **pauses and shows you a `riskContext`** before each create/deploy so you can approve — or
  pass `--yes` to pre-approve and run straight through;
- **runs interactive logins** (`vercel login`, `stripe login`) with the terminal handed to that
  CLI — you complete the login exactly as it directs, and `start` continues when it exits;
- **stops and waits at the steps only a human can do** (creating accounts; configuring Saleor's
  Stripe app in the Dashboard and mapping it to your channel);
- **reports only what it actually did** — never a deployed store it didn't deploy — and is
  **resumable**: re-run and it skips finished stages.

### Step 2 — The human gates

When `start` pauses for one of these, do it and let `start` continue:

| 🧑 | When |
|----|------|
| Create accounts | Saleor Cloud / Vercel / Stripe, if you don't already have them |
| Approve browser logins | `vercel login`, `stripe login`, Saleor OAuth — `start` runs the CLI; you click through |
| Configure Saleor's Stripe app | Dashboard → Extensions → Stripe, mapped to the `us` channel (no CLI can do this) |
| Paste a secret | only when no CLI can hand it over |

On any failure `start` stops with an actionable message — it never treats a failed step as
success.

## Jolly command surface

```
npx @dk/jolly login | logout | auth status
npx @dk/jolly init                 # install skills, write .mcp.json, scaffold (run by start)
npx @dk/jolly start                # bootstrap + end-to-end setup
npx @dk/jolly create store [--create-environment]
npx @dk/jolly create app-token
npx @dk/jolly create stripe --publishable-key <pk_test_…> --secret-key <sk_test_…>
npx @dk/jolly doctor               # checks env, store, deploy, MCP health
npx @dk/jolly upgrade              # update skills and config
```

`jolly start` runs storefront cloning, store configuration, and deployment for you by spawning
the official CLIs (`git`, `@saleor/configurator`, `npx vercel`) — pausing for your approval and
at human gates. You can also run any of those CLIs yourself; the Jolly skill tells you how.

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
