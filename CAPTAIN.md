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
- **Human CLI DX via Bombshell (027, current iteration).** `jolly start` gains a TTY-gated interactive
  discovery built on `@clack/prompts`: it prompts only for genuine human decisions (org pick when >1,
  env name, project dir), every prompt has a sane default, and Enter always advances to the same config
  `--yes` would reach. Design law: **beautiful but never nagging — less is more**; never ask for what can
  be inferred/defaulted (001/012). The layer is **purely additive**: `--json`, `--yes`, and non-TTY are
  byte-for-byte the agent path (020 firewall holds). Side-effecting stages get a default-proceed confirm
  (human analogue of 021's riskContext); declining stops honestly, no fabrication. Also adopted:
  `@bomb.sh/args` as the single typed argument parser for EVERY invocation — agent and human alike
  (unsupported command/flag errors clearly rather than silently accepted; "agent path unchanged" means
  observable behaviour, reached through Bombshell, not a second parser) — and `@bomb.sh/tab` (`jolly
  completion <shell>` script — the one command exempt from the 020 envelope). **Design law: everything
  Bombshell can serve, Bombshell serves — args (`@bomb.sh/args`), prompts/confirms/masked-entry/spinners
  (`@clack/prompts`), completion (`@bomb.sh/tab`) — with no redundant hand-rolled plumbing, one
  implementation per concern, enforced by a `@property` conformance scenario in the family of 026's
  no-forbidden-double.** All bundled into
  `dist/index.js` so `npx @dk/jolly` stays self-contained. `jolly login`'s interactive token paste
  (018) moves onto the **same** `@clack/prompts` masked password prompt, so every human prompt shares one
  Bombshell stack — full Bombshell human UX, no duplicate prompt mechanism, agent path (token via
  flag/file/stdin/env, non-TTY honest error) byte-for-byte unchanged. Shipped in **v0.9.0**
  (`main` + tag on GitHub, `@dk/jolly` on npm). Homepage unchanged by this CLI-internals release, so not redeployed.
- **Human-friendly output by default (020, current iteration).** Default (no `--json`) output is
  human-first: concise, colourful, restrained emoji, in-place progress (Bombshell `@clack/prompts`
  spinners on stderr) for the long stages in a terminal; plain text when stdout is not a terminal.
  The machine-readable envelope is emitted **only under `--json`** — the agent's explicit opt-in —
  never in default mode. `--quiet` is silent on success, printing only warnings/errors (each with its
  stable `code`) to stderr. The result goes to stdout, progress/chatter to stderr, so piping stdout
  stays clean; colour/emoji are off under `--json`/`--quiet`/non-TTY/`NO_COLOR`. **This retires the old
  "hybrid default (human + envelope)" — agents stay the primary consumer but now opt into the envelope
  with `--json`.** Specs updated (020 primary; 001/006/014/027 reconciled) and **built**: interactive
  `jolly start` routes all Bombshell chatter plus an in-place `@clack/prompts` stage spinner to
  `process.stderr`, the result stays on stdout via `emit()`, so piping stdout stays clean. The agent/
  `--json` path is untouched. Verified by a three-PTY harness mode that captures stdout and stderr
  separately (ONLCR disabled, so a bare CR is a real redraw) — making "on stderr, not stdout" falsifiable.
- **Human interactive start runs end-to-end in one session (027, current iteration — specced, not yet
  built).** The human-path complaint: with no Cloud token, interactive `jolly start` runs bootstrap
  (init+doctor) then closes with the agent's stop-and-report next-steps ("run jolly login", "re-run jolly
  start") — the agent model leaking into the human session. Decision: the **human/TTY** path gathers
  required input **inline** and never hands the human a next command for an input gate. Concretely: when no
  Cloud token is configured, prompt to **paste it inline** (the same `@clack/prompts` masked entry as
  `jolly login`) and continue; the Vercel sign-in already runs inline via the deploy stage's `vercel login`
  stdio passthrough (002:98), reframed in 027 as "run with you"; the run **ends at the one irreducible step
  Jolly cannot do** — pasting the Stripe keys + mapping the `us` channel in the Saleor Dashboard, store
  already live — so the closing output names that Dashboard step, never a re-run. A genuine stage *failure*
  (not a gate) still stops honestly; the **agent path (`--json`/`--yes`/non-TTY) is unchanged** (still
  stop-and-report — correct for agents, 020 firewall). The only new production behaviour is the inline
  token prompt + the human-path closing copy; Vercel-inline already exists. Awaiting QM/Crew.

## Shipped

Through **v0.9.0** (`main`+tag on GitHub, `@dk/jolly` on npm; homepage last redeployed at v0.8.0, unchanged since):
token-only Saleor auth (browser OAuth removed), Stripe = app + skill (Stripe CLI removed), `@dk/jolly`
naming, the `stripe-best-practices` skill in the default set, and (v0.9.0) **Bombshell CLI plumbing
(027)** — `@bomb.sh/args` typed parser, `@bomb.sh/tab` completion, `@clack/prompts` interactive
`jolly start` + masked login, agent path unchanged. The launch bar is met mechanically:
homepage paste → live deployed Paper storefront on Vercel → browsable/stocked store against Saleor
Cloud → checkout reaches the Stripe test step (behind the human Stripe-Dashboard gate). Full history in git.

On `main` ahead of the last release: **human-friendly output by default (020/027)** — interactive `jolly start`
surfaces its resolved decisions in the terminal (names the target org, lists the setup stages, on a decline
reports it stopped before any side-effecting stage), machine plan/config only on `--json`. Plus (local commit
`aa80def`, not yet pushed): **in-place progress on stderr (020:64)** — the last undefined 020 target, now
built and `@logic`-green. Held from release/publish/deploy pending a green sandbox + Paper recovery (below).

## Open / watch

- **Paper `main` build break (watch):** `next build` of cloned Paper `main` fails with
  `EmptyGenerateStaticParamsError` on `/[locale]/[channel]/cart` (Next "Cache Components" needs a non-empty
  `generateStaticParams`). A real `jolly start` hits the same Vercel build failure today. Treated as transient
  upstream — re-verify the sandbox tier once Paper fixes `main`; if it persists, pin Jolly's Paper clone to a
  known-good ref (002/003).
- **Sandbox capacity flakiness:** a busy run can exhaust the test org's environment limit mid-run (env-create
  returns `error`); confirmed transient — creation and the harness's own direct-API create work between runs.
- **Bun report (resolved on our side):** published `@dk/jolly` is bun-free (bin shebang `node`, no bun
  shebang/scripts/engines anywhere) and `npx -y @dk/jolly` runs clean on real `node:23-alpine`. A user's
  `env: 'bun'` on an Alpine distrobox is environmental (likely a bun-backed `npx`/shim), not the package;
  awaiting their box diagnostic to harden whatever it points to. Feature 006 already guards Bun-independence.

## Goals & MVP framing

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront —
  and the customer's own agent owns it afterward. Success is the launch bar, not feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth; don't chase edge
  cases the first run won't hit ([[mvp-then-iterate]]).
- **Honesty is non-negotiable:** never fabricate success; `pass`/"verified"/success only for work
  actually performed and confirmed; unimplemented paths error honestly (features 014/018/020).
- **Empower, don't replace, the agent:** Jolly does deterministic plumbing and orchestrates the official
  CLIs; the customer's agent approves risk, completes human gates, and owns the store after setup.
- **Audience:** AI agents/skills are the primary consumers — they drive Jolly via the `--json`
  machine envelope. The no-flag default presentation is human-friendly (020), but the agent path is
  the structured envelope it opts into, not the default human text.

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
