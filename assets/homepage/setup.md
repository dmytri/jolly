# Jolly Setup Guide

🐙 **Ahoy, agent. I'm Jolly — your eight-armed setup octopus.** Your human wants a
Saleor Cloud storefront. I do the mechanical plumbing; **you stay the captain.** I spawn the
official CLIs (Saleor, Vercel, `git`, `pnpm`), pause for your approval before anything
risky, and wait at the steps only a human can do. I never hold your human's secrets — only the
official tools you authenticate against do.

## How to run this (read first)

You're an installer, not a tour guide. Keep your human's part small and calm:

- **Be terse.** Short lines. No walls of text. Don't narrate what I already do.
- **One question at a time.** Ask, wait, move on — never batch five asks into a paragraph.
- **Offer choices, don't demand essays.** When your tooling has a pick-an-option input, use it
  (`[ Have one ]  [ Sign me up ]`, `[ Approve ]  [ Wait ]`). Never make the human type a long
  answer you could have offered as a button.
- **Let my gates do the gating.** I pause for approval at the stages that genuinely need it
  (creating the store, deploying) and only run with you behind official CLIs — so you don't need
  a risk table or a yes for every step. When I pause at a gate, relay it and get the yes; otherwise
  run the mechanical stages quietly. Speak up only for an approval, a credential, or a human-only step.
- **Stay honest.** Report only what actually happened. A paused or failed stage says so — never
  dressed up as done.

Voice: calm, dry, a little silly. Eight arms, one store.

## What needs your human

Four moments. Stop and ask — one at a time:

- 👩🏾 **New account** — Saleor Cloud / Vercel / Stripe (creation needs a human)
- 👨🏻 **Browser approval** — I sign Vercel in myself; I print a URL, the human approves it
  in a browser, and I continue
- 🧑🏿 **Configure Saleor's Stripe app** — I install the app and the Stripe skill; the human adds the
  test-mode keys and maps it to the `us` channel in the Dashboard (Extensions → Stripe)
- 👩🏼 **A sign-in to approve** — Saleor Cloud sign-in is a device-authorization grant: I print an
  `auth.saleor.io` URL with the code pre-filled, you open it and approve, and I continue — no token
  to paste. Any key can go straight into the gitignored `.env` yourself

Everything else, I do.

## Quick start

**Preview — changes nothing:**

```
npx @dk/jolly start --dry-run --json
```

Prints the whole plan: every CLI I'll run, files written, hosts touched, where I'll pause.
`--dry-run` only previews — it sets nothing up. `--json` gives you the structured envelope
(`status`, `checks`, `nextSteps`) to parse — pass it on every command. Skim the
plan, then run the real command below.

**Run it for real:**

```
npx @dk/jolly start --json
```

This creates real resources on Saleor Cloud, Vercel, and Stripe — run it with your human's
approval. End-to-end setup, pausing for your approval before each create/deploy and waiting at the
human gates. Plan for roughly 10–20 minutes around the human gates. Resumable — re-run and I skip
finished stages, and I leave the cloned storefront + its config in a folder in your working
directory, ready for you to keep building.

**Running autonomously (no human watching each step)?**

```
npx @dk/jolly start --yes --json
```

`--yes` pre-approves the create/deploy stages. I still stop at the true human gates and still
report only what I did. The full run provisions a store, builds the storefront, and deploys —
several minutes. Give it a generous budget or run it in the background and poll; don't cancel it.

On any failure I stop with an actionable message. A failed step is never reported as success.

## Command surface

```
npx @dk/jolly login | logout | auth status   --json
npx @dk/jolly init                 --json     # skills + .mcp.json + scaffold (run by start)
npx @dk/jolly start                --json     # end-to-end setup
npx @dk/jolly create store [--create-environment]  --json
npx @dk/jolly create app-token     --json
npx @dk/jolly doctor               --json     # checks env, store, deploy, MCP health
npx @dk/jolly upgrade              --json     # update skills and config
```

`start` chains these; each is also a command you can drive yourself. `--json` (shown above) gives
you the structured envelope — `status`, `checks`, `nextSteps` — to parse; drop it
and output is human prose for your captain. The installed `jolly` skill carries the full
stage-by-stage playbook.

---

## Reference — read when you need it

### Provenance

- A tool by Dmytri Kleiner. **Not an official product of Saleor, Vercel, or Stripe.**
- `@dk/jolly` on npm; source at https://github.com/dmytri/jolly. Inspect both before running.
- No telemetry. Secrets go only to a gitignored `.env` and to the official APIs you authenticate
  against.

### Prerequisites

- Node ≥ 20.12.0 (`node -v`) — Node 20 LTS or newer. (pnpm is **not** a prerequisite — Jolly
  runs it via `npx`, like the other CLIs.)
- A Saleor Cloud account — 👨🏽 sign up at https://cloud.saleor.io if there isn't one.

### Hosts I contact

`cloud.saleor.io` (Cloud platform API) · `auth.saleor.io` (Saleor sign-in —
device-authorization + refresh grant) · `*.saleor.cloud` (your store) ·
`github.com` (skills). The
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

Two token shapes, easy to confuse: a **Cloud staff token** (~81 chars, `uuid.base58`) lives in
`JOLLY_SALEOR_CLOUD_TOKEN` (CI/automation only, set in the environment — never minted or pasted in
the normal flow); a **per-store app token** (~30 chars, separator-free) is `JOLLY_SALEOR_APP_TOKEN`
and cannot call the Cloud API.

Don't hand-roll a probe — `jolly login` and `jolly doctor` run the right check and report the real
result. A `401` from a wrong-scheme `curl` is not evidence the token is dead.

### Saleor auth

Saleor sign-in is the device authorization grant, so it works the same on a laptop, a CI runner, or
a remote VM:

1. Run `jolly login` (or `jolly start`). I return an `auth.saleor.io` verification URL (user code
   pre-filled) in the envelope's `nextSteps` — surface it to the human as a clickable link.
2. The human opens the URL and approves. **Re-run the same command** — I resume the same code, store
   the session (`JOLLY_SALEOR_ACCESS_TOKEN` + refresh) in `.env`, and re-verify with `jolly doctor`.
   There is no token to paste and no token page. For unattended CI only, set
   `JOLLY_SALEOR_CLOUD_TOKEN` in the environment and I use it silently.

`jolly start --yes` then runs the create/deploy stages; the Dashboard Stripe app stays a human gate.

### Vercel sign-in

I drive Vercel sign-in for you during `start`: I start Vercel's device flow and return its
verification URL in the envelope's `nextSteps` (a clickable link) while a background `vercel login`
keeps polling. The human approves it in a browser, then **re-run `jolly start --yes`** and I deploy.

### Stripe

I install Saleor's Stripe app in the store and install the `stripe-best-practices` skill for your
agent. The human then adds the account's test-mode keys (Stripe Dashboard → Developers → API keys)
to the app and maps it to the `us` channel (Saleor Dashboard → Extensions → Stripe); the app
registers its own webhooks.

### Skills I install

`jolly` (this playbook) · `saleor-storefront` · `saleor-configurator` · `storefront-builder` ·
`saleor-core` · `saleor-app` · `stripe-best-practices` · `saleor-paper-storefront` (ships with the
cloned Paper storefront).

### After setup

Reload or restart your agent so the skills I installed (the Jolly + Saleor skills and
`stripe-best-practices`) load into its context for ongoing work.

`.mcp.json` wires a local mcp-graphql server to your store's GraphQL endpoint — live store access.
Saleor also runs a read-only MCP server at `mcp.saleor.app` (products, orders, customers) you may
configure too; I never contact it.

### Boundaries

Saleor Cloud only (no self-hosted in v1) · Stripe test mode only (live mode needs an explicit
human choice) · Vercel for deployment · secrets never leave `.env` · I never replace your agent —
I empower it.
