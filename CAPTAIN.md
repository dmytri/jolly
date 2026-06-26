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

## In flight — `jolly start` human-UX cycle

Five human-UX defects dk surfaced from the published `npx @dk/jolly start`, specced as one cycle (ordered in `cycle.json`). **5/7 `@logic` targets landed and committed (`184e1dd`, this session); 2 `@sandbox` targets remain.**

**Done (`@logic`, green):**
- `027:148` — live per-stage progress: each setup stage is its own status row, redrawn in place (not one fixed spinner). Replaced the old false-green 020 check.
- `027:104` — interactive close is concise prose, no `[status] check-id` enumeration, no `next:` line.
- `027:60` — plan preview lists only side-effecting stages; omits internal `init`/`auth`.
- `027:270` — Saleor sign-in URL wrapped in an OSC 8 clickable hyperlink.
- `002:119` — missing pnpm → clean `pnpm-available` fail check with install remediation, never a raw spawn ENOENT.

**Remaining (`@sandbox`, undefined — next QM pass):**
- `027:113` — the **completed** interactive close names the live store's Saleor Dashboard URL (carried in envelope `data` from feature 002) + the remaining Stripe Dashboard key step; carries no per-check enumeration; a pre-flight readiness check the run later resolves is not reported as a failure of the completed run. (The dry-run FORM is the `027:104` `@logic` piece; this pins the completed-run CONTENT.) **Readiness gap:** not in `SANDBOX_REQUIREMENTS` → would gate on all groups and skip; QM must add an entry (`saleorEndpoint`/`saleorAppToken`; no Vercel needed) so it runs, not skip-masks.
- `004:93` — recipe stage reported `completed` **only after** Jolly reads the store back and confirms the recipe's declared catalog entities exist (the `featured-products` collection holding its declared products); `recipe-deployed` derives its status from that read-back, so it cannot `pass` while a sibling check reports a declared entity absent. Crew must gate `recipe-deployed` on the read-back, not the configurator's optimistic exit/report.

**Vercel-browser limitation (flagged to dk):** the delegated `npx vercel login` still auto-opens its own browser; Jolly can't cleanly suppress that without reimplementing the device flow (002 forbids). Clickable OSC 8 URLs are the achievable win; full Vercel no-open is dk's call (left as "prefer a no-open CLI mode where one exists").

**Outbound:** the `@logic` work is pushed to `main` (git). An npm **republish** is still pending — behaviour ships in the tarball — and waits until the full cycle lands green ([[outbound-check-npm-publish-not-just-git]]).

## Current design pointers (binding detail in the specs)

- **Auth (018/014/020):** device authorization grant is the only interactive flow (Saleor: Jolly drives it, realm `saleor-cloud`, client `jolly`, JWT sent `Authorization: Bearer`, 300s access + ~12h refresh; Vercel: `npx vercel login`, CLI-driven). Raw staff token only via `JOLLY_SALEOR_CLOUD_TOKEN` (sent `Token`) for env/.env/CI. Scheme chosen by which variable holds the token (`JOLLY_SALEOR_ACCESS_TOKEN`→Bearer, staff→Token); device grant never clobbers the staff token. Allowlist (020) includes `auth.saleor.io`. Fast `@logic` login verified against a local fake auth host via `JOLLY_SALEOR_AUTH_URL` (the `@exceptional-double`).
- **Interactive UX (027/020):** TTY-gated `@clack/prompts` discovery, prompts only for genuine decisions, every prompt defaults so Enter advances (secret-entry the one exception). Human-first default output; machine envelope only under `--json`; progress on stderr, result on stdout. Agent path (`--json`/`--yes`/non-TTY) is byte-for-byte unchanged. Bombshell is the single stack for args (`@bomb.sh/args`), prompts (`@clack/prompts`), completion (`@bomb.sh/tab`) — no hand-rolled duplicates. Human-facing interactive copy lives in the `assets/messages/cli.json` catalog asset, bundled in the tarball, guarded by `006:14` ([[copy-as-catalog-asset]]). PHASE 2 (later): sweep ALL remaining human-facing CLI copy into the catalog, same pattern.
- **Stripe (005/007):** Jolly installs the Saleor Stripe app (`appInstall`) + the `stripe-best-practices` skill; entering keys + mapping the `us` channel is the human Dashboard gate. No Stripe CLI, no keys held.
- **Vercel (002/014):** deploy only via the Vercel CLI under its own session (Jolly holds no token, contacts no `api.vercel.com`). With no session Jolly owns the sign-in (spawns `npx vercel login`, surfaces the device URL on stderr); never hands the agent `vercel login` (doctor `vercel-auth` next step is `jolly start`). `@sandbox`-verified via isolated empty Vercel config.
- **CLIs via `npx`** — configurator/vercel; a missing global binary is not a failure ([[clis-via-npx]]). **pnpm is a prerequisite, not npx-driven.**
- **Published Node floor >=20.12.0 (006)**; dev/CI floor >=23. **Homepage (jolly.cool)** offers Agent + Terminal entry modes (Agent default); human-authored asset, not specced/tested.
- **Resumable stages (008/022):** a completed `create` subcommand's `nextSteps` point back to `jolly start` and recognize stored work; a resumable stage announces an already-satisfied stage as satisfied, never re-gates it.

## Shipped

Latest **0.10.2** (`main` + tag `v0.10.2`, `@dk/jolly` npm `latest`, 2026-06-25): interactive copy renders from the `assets/messages/cli.json` catalog, guarded by `006:14`. Full history in git.

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
