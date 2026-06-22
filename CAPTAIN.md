<!-- ============================================================= -->
<!-- STOP. CAPTAIN ROLE ONLY.                                      -->
<!-- If you are NOT running as the Captain — i.e. you are the      -->
<!-- Quartermaster, Crew Mate, Bosun, or any other role — do NOT   -->
<!-- read past this line. Close this file now. Its contents are    -->
<!-- Captain-only working context and must never enter another     -->
<!-- role's context. You were not given this file by your role.    -->
<!-- ============================================================= -->

> **STOP — CAPTAIN ROLE ONLY.** If you are not running as the Captain (you are the Quartermaster, Crew Mate, Bosun, or any other role), **stop reading now and close this file.** Nothing here is input to your role; reading it leaks Captain-only context. Binding behavior lives in `features/*.feature` and referenced `assets/**` — not here.

# Captain Notes

Captain-only notes: product framing and current design. **Non-binding.** Only Captain may read or
edit this file. Binding behavior lives in `features/*.feature` and referenced `assets/**`, never here.
History lives in git — these notes describe only the current design.

> **Captain authors every `.feature` scenario** — read and follow `SCENARIO_WRITING.md` for each one.

## Governing principle: live-by-design, never mock/fake

Jolly's suite runs against **real services** in a fully integrated test env matching production — the
`JOLLY_*` Saleor Cloud / Vercel / Stripe credentials in `.env` ARE that env. **Never mock or fake**
(no fake CLIs, dummy credentials, `.invalid` endpoints, simulated responses). Creating real resources
is expected; safety is **harmless-by-design** = namespace every created resource + idempotent teardown
+ never modify/delete a resource the run did not create (AGENTS.md rules), NOT credential-faking.
Scope: every tier including `@logic`. Made executable by feature 026's `@property` "no forbidden
double" so a green suite carrying a fake fails there.

- **Failures: real where possible.** Produce every failure reachable from real bad input for real
  (empty/garbage token → real auth rejection; non-first-party `--url` → real `NON_FIRST_PARTY_HOST`).
  A justified-exception double (inline `@exceptional-double`, never the normal path) is allowed only
  for conditions the real env cannot produce on demand — current set: `ENVIRONMENT_LIMIT_REACHED`
  and the unverifiable-endpoint "stored, not verified" path.
- **Env limits — cannon fodder.** `jolly-test-`-prefixed environments are disposable; the prefix IS
  the protection boundary (only `jolly-test-*` are deletable; the configured store is never touched).
- A persistently-skipping `@sandbox` scenario is un-verified, not done ([[skip-mask-sandbox-unverified]]).

## Current product design

- **Saleor auth is token-only (018).** `jolly login` takes the Cloud token from
  `--token`/`--token-file`/`--token-stdin`/`$JOLLY_SALEOR_CLOUD_TOKEN`/interactive TTY paste (echo off,
  never via argv/LLM), verifies, and stores it. No token + no TTY → honest error pointing to
  `jolly login --token <value>`. No browser OAuth. Host allowlist (020) excludes `auth.saleor.io`/`127.0.0.1`.
- **Stripe = Saleor Stripe app + skill (005/007).** `jolly start` installs the Saleor Stripe app
  (`appInstall`, HANDLE_PAYMENTS) and the `stripe-best-practices` skill. Entering the keys + mapping the
  `us` channel stays the human Saleor-Dashboard gate. No Stripe CLI, no `JOLLY_STRIPE_*` keys held by Jolly.
- **Vercel: CLI passthrough.** `jolly start` relies on the Vercel CLI's own `vercel login` session
  (interactive gate); Jolly holds no Vercel token and sends no request to `api.vercel.com`.
- **All CLIs via `npx`** — configurator/vercel; a missing global binary is not a failure ([[clis-via-npx]]).
- **Docs describe only current behavior, positively** — no references to removed paths, no "don't do X"
  negatives ([[no-self-defeating-absence-assertions]]).

## Shipped

Through **v0.8.0** (`main`+tag on GitHub, `@dk/jolly` on npm, homepage redeployed to Vercel prod):
token-only Saleor auth (browser OAuth removed), Stripe = app + skill (Stripe CLI removed), `@dk/jolly`
naming, and the `stripe-best-practices` skill in the default set. The launch bar is met mechanically:
homepage paste → live deployed Paper storefront on Vercel → browsable/stocked store against Saleor
Cloud → checkout reaches the Stripe test step (behind the human Stripe-Dashboard gate). Full history in git.

## Goals & MVP framing

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront —
  and the customer's own agent owns it afterward. Success is the launch bar, not feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth; don't chase edge
  cases the first run won't hit ([[mvp-then-iterate]]).
- **Honesty is non-negotiable:** never fabricate success; `pass`/"verified"/success only for work
  actually performed and confirmed; unimplemented paths error honestly (features 014/018/020).
- **Empower, don't replace, the agent:** Jolly does deterministic plumbing and orchestrates the official
  CLIs; the customer's agent approves risk, completes human gates, and owns the store after setup.
- **Audience:** AI agents/skills are the primary consumers; human DX stays decent but secondary.

## Product identity

- Name: Jolly. Tagline: "Ahoy, agent. Go build a store." A tool by Dmytri Kleiner to help an agent set
  up a Saleor + Vercel + Stripe store fast — not an official product of Saleor, Vercel, or Stripe.
- Shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.
- **Launch bar:** homepage prompt → real deployed storefront → browsing/cart against Saleor Cloud →
  checkout reaches the Stripe test payment step, every claim verified, nothing fabricated.

## File-placement principle

`features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes.
`AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics bar unavoidable identifiers
like `@dk/jolly`, `JOLLY_*`); all test/harness methodology lives there so QM/Crew always see it. The one
admitted product-spec exception about the verification layer is feature 026's `@property` "no forbidden
double" — the discriminator for what may be a scenario is **testability, not subject**. `CLAUDE.md` is a
thin Claude-Code pointer to `AGENTS.md`.
