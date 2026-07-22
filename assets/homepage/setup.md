# Jolly Setup Guide

🐙 **Ahoy, agent. I'm Jolly — your eight-armed setup octopus.** Your human wants a Saleor Cloud
storefront. I do the mechanical plumbing; **you stay the captain.** I spawn the official CLIs
(Vercel, `@saleor/configurator`, `git`, `pnpm`), pause for your approval before anything risky, and
wait at the steps only a human can do. I hold no secrets — they go only to a gitignored `.env` and
the official tools you authenticate against.

## Run it

Run this one command and carry it through to the end:

```
npx @dk/jolly start --yes --json
```

`--yes` pre-approves the create and deploy stages so you don't stop for routine confirmations. Run
the command above for real now — it **is** the whole setup, not a preview, so don't stop to inspect
or plan first; run it and carry it through to the end. The run takes several minutes — give it a
generous budget or background it and poll; don't cancel it. Re-running is safe: I skip the finished
stages and resume where I left off.

A few steps need the human — the Saleor and Vercel sign-ins, creating any missing account, and the
final Stripe keys (see **What needs your human** below). When you reach one: **relay the link (or ask
the question), tell the human to reply "done" once they've handled it, then re-run the command** and
I continue. **Don't try to sign in or approve these yourself** — they happen in the human's own
browser and account, so doing it for them won't work. Surface the Stripe keys step at the very end as
a nextStep, never a mid-run blocker.

On any failure I stop with an actionable message. A paused, pending, or failed stage says so — never
dressed up as done.

## What needs your human

Three kinds of moment surface while I run — I start with `jolly start` and relay each when it comes
up, one at a time. I never pause up front to ask: the account question rides the Saleor sign-in below.

- 👩🏾 **A Saleor Cloud account and sign-in** — when I reach the auth stage I give you an
  `auth.saleor.io` device URL with the code pre-filled; **relay it for the human to click and approve
  in their own browser, tell them to reply "done" when approved**, then re-run and I continue. No
  account yet? Send them to https://cloud.saleor.io to sign up first, then approve the same URL. No
  token to paste. (Vercel and Stripe accounts come up at their own steps — creating any account always
  needs a human.)
- 👨🏻 **Approve the Vercel sign-in** — I start Vercel's device flow and print its URL; **relay it for
  the human to approve, tell them to reply "done"**, then re-run and I deploy.
- 🧑🏿 **Configure the Stripe app** — I install the app and the `stripe-best-practices` skill; the
  human enters the test-mode keys and maps them to the `us` channel in the Saleor Dashboard
  (Extensions → Stripe). That's the one Stripe step no CLI can do.

Everything else, I do.

---

## Reference — read when you need it

### Command surface

`jolly start` does the whole setup. Each stage is also a command you can run yourself if you need to:

```
npx @dk/jolly start    --json     # end-to-end setup (chains the stages below)
npx @dk/jolly login | logout | auth status   --json
npx @dk/jolly init     --json     # skills + .mcp.json + scaffold (run by start)
npx @dk/jolly create store [--create-environment]   --json
npx @dk/jolly doctor   --json     # checks env, store, deploy, Stripe checkout
npx @dk/jolly upgrade  --json     # re-verify managed skills + report Paper baseline (no auto-update)
```

Every command takes `--json` for the structured envelope (`status`, `checks`, `nextSteps`); drop it
for human prose. The installed `jolly` skill carries the full stage-by-stage detail.

### Provenance

- A tool by Dmytri Kleiner. **Not an official product of Saleor, Vercel, or Stripe.**
- `@dk/jolly` on npm; source at https://github.com/dmytri/jolly. Inspect both before running.
- No telemetry. Secrets go only to a gitignored `.env` and the official APIs you authenticate
  against.

### Prerequisites

- Node ≥ 20.12.0 (`node -v`) — Node 20 LTS or newer. pnpm is **not** a prerequisite; I run it via
  `npx`, like the other CLIs.
- A Saleor Cloud account — 👨🏽 sign up at https://cloud.saleor.io if there isn't one.

### Hosts I contact

`cloud.saleor.io` (Cloud platform API) · `auth.saleor.io` (Saleor sign-in — device-authorization +
refresh grant) · `*.saleor.cloud` (your store) · `github.com` (skills). The CLIs I spawn reach their
own services under their own auth: Vercel → `api.vercel.com`; `@saleor/configurator` → your
`*.saleor.cloud`; `git` → `github.com`; `npx` → npm. Locked-down environment? Allowlist the union. I
install the Stripe app through your store's Saleor GraphQL.

### Saleor Cloud auth — two endpoints, two schemes

The most common way to fool yourself into a false "dead token":

- **Cloud platform API** — `https://cloud.saleor.io/platform/api` (orgs, projects, environments).
  Header `Authorization: Token <token>` (**not** `Bearer`). Probe:
  `GET …/platform/api/organizations/` → `200` with a list.
- **Your store's GraphQL** — `https://<store>.saleor.cloud/graphql/`. Header
  `Authorization: Bearer <token>`.

Don't probe `https://cloud.saleor.io/graphql/` — that's the Cloud web app, and it returns `200` with
an HTML sign-in page even unauthenticated. And don't hand-roll a probe at all: `jolly login` and
`jolly doctor` run the right check and report the real result. A `401` from a wrong-scheme `curl` is
not evidence the token is dead.

After setup, the surface you use to talk to the store is just two values in `.env`: `SALEOR_URL`
(your GraphQL endpoint) and `SALEOR_TOKEN` (the store access token, sent `Authorization: Bearer` —
short-lived in the normal flow; refresh it with `jolly doctor saleor` or re-run `jolly login`). The
`JOLLY_*` vars are my internal auth layer that `SALEOR_TOKEN` is projected from. For unattended CI
only, a long-lived **Cloud staff token** (~81 chars, `uuid.base58`) set as `JOLLY_SALEOR_CLOUD_TOKEN`
in the environment is used silently — never minted or pasted in the normal flow.

### Stripe (test mode)

My entire payment role is two things: I **install Saleor's Stripe app** in your store (via the
store's Saleor GraphQL `appInstall`) and I **install the `stripe-best-practices` skill** for your
agent.

Configuring the app is a human Dashboard gate I wait at: in the Saleor Dashboard → Extensions → the
Stripe app, add a configuration with the account's test-mode **publishable key and a restricted
key** (from the Stripe Dashboard → Developers → API keys), and **map it to the `us` channel**. The
app then talks to Stripe and registers its own webhooks. `jolly doctor` confirms a `us`-channel
checkout is actually offered the Stripe gateway — I never call checkout ready on the install alone.

### Skills I install

`jolly` (how to drive me and where I fit) · `saleor-storefront` · `saleor-configurator` ·
`storefront-builder` · `saleor-core` · `saleor-app` · `stripe-best-practices` ·
`saleor-paper-storefront` (ships with the cloned Paper storefront). These are your toolkit for the
building that continues after setup. You add none of them by hand — the `jolly` skill ships inside
the CLI and installs itself; the rest arrive via `npx skills add`, all of it during `jolly init`
(run by `start`).

### After setup

Ask your human to reload or restart your agent so the skills I installed load into its context for
ongoing work — that restart is theirs to do, not yours.

`jolly start` leaves you two things to build on: the `storefront/` repo (your Paper storefront, now
live on Vercel) and `recipe.yml` (your store's catalog, categories, and config as code). The
installed `jolly` skill explains both — and which skill/CLI drives each, with examples — so your
agent can take it from there.

`.mcp.json` wires a local mcp-graphql server to your store's GraphQL endpoint for live store access.
(Saleor also runs a read-only MCP server at `mcp.saleor.app` you may configure too; I never contact
it.) From here the store and the storefront repo are yours — keep building with the Saleor skills and
the official CLIs above.
