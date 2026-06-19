# Jolly Setup Guide

🐙 **Ahoy, agent. I'm Jolly — your eight-armed setup octopus.** Your human wants a
Saleor Cloud storefront. I do the mechanical plumbing; **you stay the captain.** I spawn the
official CLIs (Saleor, Vercel, Stripe, `git`, `pnpm`), pause for your approval before anything
risky, and wait at the steps only a human can do. I never hold your human's secrets — only the
official tools you authenticate against do.

## How to run this (read first)

You're an installer, not a tour guide. Keep your human's part small and calm:

- **Be terse.** Short lines. No walls of text. Don't narrate what I already do.
- **One question at a time.** Ask, wait, move on — never batch five asks into a paragraph.
- **Offer choices, don't demand essays.** When your tooling has a pick-an-option input, use it
  (`[ Have one ]  [ Sign me up ]`, `[ Approve ]  [ Wait ]`). Never make the human type a long
  answer you could have offered as a button.
- **Confirm before each risky move.** Name the action, show the risk, get a yes. I hand you a
  `riskContext` for exactly this.
- **Surface only decisions and gates.** Run the mechanical stages quietly; speak up when you need
  an approval, a credential, or a human-only step.
- **Stay honest.** Report only what actually happened. A paused or failed stage says so — never
  dressed up as done.

Voice: calm, dry, a little silly. Eight arms, one store.

## What needs your human

Four moments. Stop and ask — one at a time:

- 🧑 **New account** — Saleor Cloud / Vercel / Stripe (creation needs a human)
- 🧑 **Browser login consent** — Saleor OAuth, `vercel login`, `stripe login`
- 🧑 **Saleor's Stripe app** — Dashboard → Extensions → Stripe, mapped to the `us` channel (no CLI
  can do this)
- 🧑 **A secret to paste** — only when no CLI can hand it over, and only if you want to: you can
  drop any key into the gitignored `.env` yourself instead of pasting it to me

Everything else, I do.

## Quick start

**Preview — changes nothing:**

```
npx @dk/jolly start --dry-run
```

Prints the whole plan: every CLI I'll run, files written, hosts touched, where I'll pause. Skim,
then go.

**Run it:**

```
npx @dk/jolly start
```

End-to-end setup, pausing for your approval before each create/deploy and waiting at the human
gates. Resumable — re-run and I skip finished stages.

**Running autonomously (no human watching each step)?**

```
npx @dk/jolly start --yes
```

`--yes` pre-approves the create/deploy stages. I still stop at the true human gates and still
report only what I did. The full run provisions a store, builds the storefront, and deploys —
several minutes. Give it a generous budget or run it in the background and poll; don't cancel it.

On any failure I stop with an actionable message. A failed step is never reported as success.

## Command surface

```
npx @dk/jolly login | logout | auth status
npx @dk/jolly init                 # skills + .mcp.json + scaffold (run by start)
npx @dk/jolly start                # end-to-end setup
npx @dk/jolly create store [--create-environment]
npx @dk/jolly create app-token
npx @dk/jolly create stripe --publishable-key <pk_test_…> --secret-key <sk_test_…>
npx @dk/jolly doctor               # checks env, store, deploy, MCP health
npx @dk/jolly upgrade              # update skills and config
```

`start` chains these; each is also a command you can drive yourself. The installed `jolly` skill
carries the full stage-by-stage playbook.

---

## Reference — read when you need it

### Provenance

- A tool by Dmytri Kleiner. **Not an official product of Saleor, Vercel, or Stripe.**
- `@dk/jolly` on npm; source at https://github.com/dmytri/jolly. Inspect both before running.
- No telemetry. Secrets go only to a gitignored `.env` and to the official APIs you authenticate
  against.

### Prerequisites

- Node ≥ 23 (`node -v`) — the CLI uses Node's native TypeScript.
- pnpm (`pnpm -v`) — Paper uses it.
- A Saleor Cloud account — 🧑 sign up at https://cloud.saleor.io if there isn't one.

### Hosts I contact

`auth.saleor.io` (OAuth) · `cloud.saleor.io` (Cloud API) · `*.saleor.cloud` (your store) ·
`github.com` (skills) · `127.0.0.1` (OAuth callback) · `api.stripe.com` (Stripe test config). The
CLIs I spawn reach their own services under their own auth: Vercel → `api.vercel.com`;
`@saleor/configurator` → your `*.saleor.cloud`; `git` → `github.com`; `npx` → npm. Locked-down
environment? Allowlist the union.

### Saleor Cloud auth — two endpoints, two schemes

The most common way to fool yourself into a false "dead token":

- **Cloud platform API** — `https://cloud.saleor.io/platform/api` (orgs, projects, environments).
  Header: `Authorization: Token <token>` (**not** `Bearer`). Probe:
  `GET …/platform/api/organizations/` → `200` with a list.
- **Your store's GraphQL** — `https://<store>.saleor.cloud/graphql/`. Header:
  `Authorization: Bearer <token>`.

Don't probe `https://cloud.saleor.io/graphql/` — that's the Cloud web app, and it returns `200`
with an HTML sign-in page even unauthenticated.

Two token shapes, easy to confuse: a **Cloud staff token** (~81 chars, `uuid.base58`, minted at
`https://cloud.saleor.io/tokens`) is `JOLLY_SALEOR_CLOUD_TOKEN`; a **per-store app token**
(~30 chars, separator-free) is `JOLLY_SALEOR_APP_TOKEN` and cannot call the Cloud API.

Don't hand-roll a probe — `jolly login --token <value>` and `jolly doctor` run the right check
and report the real result. A `401` from a wrong-scheme `curl` is not evidence the token is dead.

### Headless or remote VM

Browser OAuth (`jolly login`, no flags) listens at `http://127.0.0.1:5375/callback` **on the
machine running me.** If you're on a remote VM while the human's browser is on their own laptop,
the redirect reaches the laptop's `127.0.0.1` — where nothing is listening — and the flow can't
complete. Use a token instead:

1. The human mints a Cloud staff token at `https://cloud.saleor.io/tokens`.
2. Hand it over without putting the literal in a command argument: `jolly login --token-file <path>`
   (a mode-600 file), `jolly login --token-stdin` (stdin), or
   `JOLLY_SALEOR_CLOUD_TOKEN=<value> jolly login`. I verify it before writing it to `.env`.

`jolly start --yes` then runs the create/deploy stages; the Dashboard Stripe app stays a human
gate.

### Skills I install

`jolly` (this playbook) · `saleor-storefront` · `saleor-configurator` · `storefront-builder` ·
`saleor-core` · `saleor-app` · `saleor-paper-storefront` (ships with the cloned Paper storefront).

### After setup

`.mcp.json` wires a local mcp-graphql server to your store's GraphQL endpoint — live store access.
Saleor also runs a read-only MCP server at `mcp.saleor.app` (products, orders, customers) you may
configure too; I never contact it.

### Boundaries

Saleor Cloud only (no self-hosted in v1) · Stripe test mode only (live mode needs an explicit
human choice) · Vercel for deployment · secrets never leave `.env` · I never replace your agent —
I empower it.
