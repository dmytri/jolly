# Jolly Setup Guide

🐙 **Ahoy, agent. I'm Jolly — your eight-armed setup octopus.** Your human wants a Saleor Cloud
storefront. I do the mechanical plumbing; **you stay the captain.** I spawn the official CLIs
(Vercel, `@saleor/configurator`, `git`, `pnpm`), pause for your approval before anything risky, and
wait at the steps only a human can do. I hold no secrets — they go only to a gitignored `.env` and
the official tools you authenticate against.

## Run it

**Preview first — changes nothing:**

```
npx @dk/jolly start --dry-run --json
```

Prints the whole plan: every CLI I'll spawn, files I'll write, hosts I'll touch, and where I'll
pause. `--json` gives you the structured envelope (`status`, `checks`, `nextSteps`) — pass it on
every command and branch on it. Skim the plan, then run the real command.

**Then run it for real:**

```
npx @dk/jolly start --json
```

End-to-end setup on your human's account — I provision a Saleor Cloud store, build and deploy the
Paper storefront to Vercel, and install Saleor's Stripe app. I pause for your approval before each
create/deploy and wait at the human gates. Roughly 10–20 minutes around those gates. **Resumable:**
re-run and I skip the finished stages, leaving the cloned storefront and its config in your working
directory, ready for you to keep building.

**Running unattended (no human watching each step)?**

```
npx @dk/jolly start --yes --json
```

`--yes` pre-approves the create/deploy stages. I still stop at the true human gates and still report
only what I actually did. The full run takes several minutes — give it a generous budget or
background it and poll; don't cancel it.

On any failure I stop with an actionable message. A paused, pending, or failed stage says so — never
dressed up as done.

## How to run this

You're an installer, not a tour guide. Keep your human's part small and calm:

- **Be terse.** Short lines, no walls of text. Don't narrate what I already do.
- **One question at a time.** Ask, wait, move on — never batch five asks into a paragraph.
- **Offer choices, not essays.** When your tooling has a pick-an-option input, use it
  (`[ Have one ]  [ Sign me up ]`, `[ Approve ]  [ Wait ]`) instead of making the human type a long
  answer.
- **Let my gates do the gating.** I pause at the stages that genuinely need it (creating the store,
  deploying). Relay those, get the yes, and run the mechanical stages quietly. Speak up only for an
  approval, a credential, or a human-only step — no per-step risk table.
- **Stay honest.** Report only what actually happened.

Voice: calm, dry, a little silly. Eight arms, one store.

## What needs your human

Four kinds of moment. Stop and ask — one at a time:

- 👩🏾 **A Saleor Cloud account** — first thing, ask the human whether they have one:
  `[ Have one ]  [ Sign me up ]`. No account? Send them to https://cloud.saleor.io to sign up, then
  carry on. (Vercel and Stripe accounts come up at their own steps — creating any account always
  needs a human.)
- 👩🏼 **Approve the Saleor sign-in** — it's a device-authorization grant: I hand you an
  `auth.saleor.io` URL with the code pre-filled, the human approves in a browser, I continue. No
  token to paste.
- 👨🏻 **Approve the Vercel sign-in** — I start Vercel's device flow and print its URL; the human
  approves, I deploy.
- 🧑🏿 **Configure the Stripe app** — I install the app and the `stripe-best-practices` skill; the
  human enters the test-mode keys and maps them to the `us` channel in the Saleor Dashboard
  (Extensions → Stripe). That's the one Stripe step no CLI can do.

Everything else, I do.

## Command surface

```
npx @dk/jolly start    --json     # end-to-end setup (chains the stages below)
npx @dk/jolly login | logout | auth status   --json
npx @dk/jolly init     --json     # skills + .mcp.json + scaffold (run by start)
npx @dk/jolly create store [--create-environment]   --json
npx @dk/jolly create app-token    --json
npx @dk/jolly doctor   --json     # checks env, store, deploy, Stripe checkout
npx @dk/jolly upgrade  --json     # re-verify managed skills + report Paper baseline (no auto-update)
```

`start` chains these; each is also a command you can drive yourself. `--json` gives you the envelope
(`status`, `checks`, `nextSteps`) to parse; drop it for human prose. The installed `jolly` skill
carries the full stage-by-stage detail and shows how I fit alongside your other skills and CLIs.

---

## Reference — read when you need it

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
install the Stripe app through your store's Saleor GraphQL, so I contact no Stripe host.

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

Two token shapes, easy to confuse: a **Cloud staff token** (~81 chars, `uuid.base58`) in
`JOLLY_SALEOR_CLOUD_TOKEN` (CI/automation only, set in the environment — never minted or pasted in
the normal flow); a **per-store app token** (~30 chars, separator-free) in `JOLLY_SALEOR_APP_TOKEN`
(cannot call the Cloud API).

### Sign-ins — Saleor and Vercel

Both are device-authorization grants, so they work the same on a laptop, a CI runner, or a remote
VM — there's no token to paste:

- **Saleor:** `jolly login` (or `jolly start`) returns an `auth.saleor.io` verification URL (user
  code pre-filled) in the envelope's `nextSteps` — surface it as a clickable link. The human
  approves in the browser, then **re-run the same command**: I resume the same code, store the
  session (`JOLLY_SALEOR_ACCESS_TOKEN` + refresh) in `.env`, and re-verify with `jolly doctor`. For
  unattended CI only, set `JOLLY_SALEOR_CLOUD_TOKEN` in the environment and I use it silently.
- **Vercel:** during `start` I begin Vercel's device flow and return its verification URL in
  `nextSteps` (a clickable link) while a background `vercel login` keeps polling. The human approves,
  then **re-run `jolly start --yes`** and I deploy.

### Stripe (test mode)

My entire payment role is two things: I **install Saleor's Stripe app** in your store (via the
store's Saleor GraphQL `appInstall`) and I **install the `stripe-best-practices` skill** for your
agent. I run no Stripe CLI, contact no Stripe host, and hold no Stripe keys.

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

`.mcp.json` wires a local mcp-graphql server to your store's GraphQL endpoint for live store access.
(Saleor also runs a read-only MCP server at `mcp.saleor.app` you may configure too; I never contact
it.) From here the store and the storefront repo are yours — keep building with the Saleor skills and
the official CLIs above.

### Boundaries

Saleor Cloud only (no self-hosted in v1) · Stripe test mode only (live mode needs an explicit human
choice) · Vercel for deployment · secrets never leave `.env` · I never replace your agent — I empower
it.
