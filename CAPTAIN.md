<!-- ============================================================= -->
<!-- STOP. CAPTAIN ROLE ONLY.                                      -->
<!-- If you are NOT running as the Captain — i.e. you are the      -->
<!-- Quartermaster, Crew Mate, Bosun, or any other role — do NOT   -->
<!-- read past this line. Close this file now. Its contents are    -->
<!-- Captain-only working context and must never enter another     -->
<!-- role's context. You were not given this file by your role.    -->
<!-- ============================================================= -->

> **STOP — CAPTAIN ROLE ONLY.** If you are not the Captain, close this file now. Binding behaviour lives in `features/*.feature` and referenced `assets/**`, never here.

# Captain Notes

Captain-only, **non-binding** working memory. Binding behaviour lives in `features/*.feature` + `assets/**`; history lives in git. These notes carry only what the next cycle needs — current design pointers, in-flight work, and watch items.

> **Captain authors every `.feature` scenario** — follow `SCENARIO_WRITING.md` for each.

## Governing principle: live-by-design, never mock/fake

The suite runs against **real services** in a production-shaped test env (the `JOLLY_*` `.env` credentials), every tier including `@logic`. Never mock/fake (no fake CLIs, dummy creds, `.invalid` endpoints). Creating real resources is expected; safety is **harmless-by-design** — namespace every created resource + idempotent teardown + never touch what the run did not create (AGENTS.md). Produce failures from real bad input. The only doubles are inline `@exceptional-double`s for conditions the real env can't produce on demand (current set: `ENVIRONMENT_LIMIT_REACHED`, the unverifiable-endpoint "stored, not verified" path, and the device-grant human-approve via the local fake auth host). Enforced by 026's `@property` "no forbidden double". A persistently-skipping `@sandbox` scenario is un-verified, not done ([[skip-mask-sandbox-unverified]]).

## In flight — clickable sign-in URLs

The five-defect `jolly start` human-UX cycle (027:148/104/60/270, 002:119, plus 027:113 + 004:93) **shipped in v0.10.3** (`main` + tag, npm `latest`); its `cycle.json` was consumed and removed (`2e02653`). New cycle, opened from dk's feedback that sign-in URLs should be clickable.

**Design (dk, this session).** Jolly emits an OSC 8 clickable hyperlink **itself only on its own interactive (TTY) path** — there it knows the surface is a terminal. On the **agent path** it emits **no** OSC 8 (escape bytes pollute agent logs); instead the **Jolly skill nudges the agent** to render the sign-in/setup URLs — which it already holds from the envelope `data` — as clickable links suited to its own surface ("empower, don't replace, the agent"). dk's reasoning: the agent knows its env better than Jolly, and already has the URL from the envelope.

**Landed (committed `20d1c24`, local — NOT pushed, held to bundle):**
- `002:113` — the Vercel sign-in URL Jolly surfaces on stderr is wrapped in `osc8Hyperlink` (`@sandbox`, real-run green). Plus the `002:81` pnpm step repurposed to the feature's current text.

**Captain artifacts this session (durable, uncommitted — QM pre-cleans via Bosun):**
- `027` new scenario "The jolly login sign-in URL is shown as a clickable terminal hyperlink" — interactive `jolly login` Saleor URL wrapped in OSC 8, parallel to `027:271` for `jolly start`. Reuses 018's interactive-login Given/When + the existing OSC 8 Then. Crew target: wrap the URL at `src/index.ts:659` (`deviceGrantLogin`). **Note for QM:** the existing OSC 8 Then (`027` step:1048) reads `lastRun.stdout` and is worded "interactive start"; generalize it if `jolly login` surfaces the URL on a different stream.
- `assets/skills/jolly/SKILL.md` — added the agent nudge bullet ("Make the URLs clickable for your human"). Pure asset; ships in the tarball, no test.

**Deliberately left plain:** the agent/relay surfaces — `jolly login --json` / `deviceGrantLoginAgent` (`src/index.ts:694`) and the `--json` start path — stay free of OSC 8 bytes; the skill nudge covers them.

**Vercel-browser limitation (flagged to dk):** the delegated `npx vercel login` still auto-opens its own browser; Jolly can't cleanly suppress that without reimplementing the device flow (002 forbids). Clickable OSC 8 URLs are the achievable win; full Vercel no-open is dk's call (left as "prefer a no-open CLI mode where one exists").

**Outbound plan (dk chose "bundle"):** push `main` once the `jolly login` clickable target lands green — Vercel + Saleor + skill together; npm **republish** after the bundle is green ([[outbound-check-npm-publish-not-just-git]]).

## Current design pointers (binding detail in the specs)

- **Auth (018/014/020):** device authorization grant is the only interactive flow (Saleor: Jolly drives it, realm `saleor-cloud`, client `jolly`, JWT sent `Authorization: Bearer`, 300s access + ~12h refresh; Vercel: `npx vercel login`, CLI-driven). Raw staff token only via `JOLLY_SALEOR_CLOUD_TOKEN` (sent `Token`) for env/.env/CI. Scheme chosen by which variable holds the token (`JOLLY_SALEOR_ACCESS_TOKEN`→Bearer, staff→Token); device grant never clobbers the staff token. Allowlist (020) includes `auth.saleor.io`. Fast `@logic` login verified against a local fake auth host via `JOLLY_SALEOR_AUTH_URL` (the `@exceptional-double`).
- **Interactive UX (027/020):** TTY-gated `@clack/prompts` discovery, prompts only for genuine decisions, every prompt defaults so Enter advances (secret-entry the one exception). Human-first default output; machine envelope only under `--json`; progress on stderr, result on stdout. Agent path (`--json`/`--yes`/non-TTY) is byte-for-byte unchanged. Bombshell is the single stack for args (`@bomb.sh/args`), prompts (`@clack/prompts`), completion (`@bomb.sh/tab`) — no hand-rolled duplicates. Human-facing interactive copy lives in the `assets/messages/cli.json` catalog asset, bundled in the tarball, guarded by `006:14` ([[copy-as-catalog-asset]]). PHASE 2 (later): sweep ALL remaining human-facing CLI copy into the catalog, same pattern.
- **Stripe (005/007):** Jolly installs the Saleor Stripe app (`appInstall`) + the `stripe-best-practices` skill; entering keys + mapping the `us` channel is the human Dashboard gate. No Stripe CLI, no keys held.
- **Vercel (002/014):** deploy only via the Vercel CLI under its own session (Jolly holds no token, contacts no `api.vercel.com`). With no session Jolly owns the sign-in (spawns `npx vercel login`, surfaces the device URL on stderr); never hands the agent `vercel login` (doctor `vercel-auth` next step is `jolly start`). `@sandbox`-verified via isolated empty Vercel config.
- **CLIs via `npx`** — configurator/vercel; a missing global binary is not a failure ([[clis-via-npx]]). **pnpm is a prerequisite, not npx-driven.**
- **Published Node floor >=20.12.0 (006)**; dev/CI floor >=23. **Homepage (jolly.cool)** offers Agent + Terminal entry modes (Agent default); human-authored asset, not specced/tested.
- **Resumable stages (008/022):** a completed `create` subcommand's `nextSteps` point back to `jolly start` and recognize stored work; a resumable stage announces an already-satisfied stage as satisfied, never re-gates it.

## Shipped

Latest **0.10.3** (`main` + tag `v0.10.3`, `@dk/jolly` npm `latest`): honest interactive close (surfaces failures + storefront URL, never fabricated success) + recipe `featured-products` read-back gate (027:113, 004:93, 027 human-UX set). Full history in git.

## Open / watch

- **Paper `main` build break:** `next build` of cloned Paper `main` fails `EmptyGenerateStaticParamsError` on `/[locale]/[channel]/cart`. A real `jolly start` hits the same Vercel build failure. Treated as transient upstream — re-verify once Paper fixes `main`; if it persists, pin Jolly's Paper clone to a known-good ref (002/003).
- **Sandbox capacity flakiness:** a busy run can exhaust the test org's environment limit mid-run (env-create `error`); confirmed transient.
- **027 interactive-PTY `@logic` flakiness:** PTY-driven `jolly start` scenarios fail non-deterministically under parallel `-p logic` (moving target = harness/PTY timing, not a product defect). Re-run serially to confirm before treating as a defect; harden/serialize if it persists ([[logic-parallel-loopback-flakiness]]).
- **Bun report (resolved our side):** published `@dk/jolly` is bun-free; a user's `env: 'bun'` on Alpine distrobox is environmental. 006 guards Bun-independence.

## Goals & identity

- **North star / launch bar:** an agent (or a human in the terminal) takes a customer from a homepage prompt to a real, live, honest storefront — deployed Paper on Vercel, browsable/stocked store on Saleor Cloud, checkout reaching the Stripe test step — every claim verified, nothing fabricated; the customer's own agent owns it afterward.
- **MVP first, then iterate** ([[mvp-then-iterate]]); **honesty non-negotiable** (no fabricated success); **empower, don't replace, the agent**; terminal users and agents are both first-class.
- **Name:** Jolly. Tagline "Ahoy. Go build a store." A CLI by Dmytri Kleiner for Saleor + Vercel + Stripe; not an official product of any. Shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.

## File-placement principle

`features/*.feature` + `assets/**` = binding product intent. `CAPTAIN.md` = non-binding notes. `AGENTS.md` = Shipshape/tooling-generic config (all test/harness methodology, so QM/Crew see it). The one admitted product-spec exception about the verification layer is 026's `@property` "no forbidden double" — testability, not subject, decides what may be a scenario. `CLAUDE.md` is a thin pointer to `AGENTS.md`.
