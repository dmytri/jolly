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
- **Human interactive start runs end-to-end in one session (027, current iteration — built, `@logic`-green,
  on `main` ahead of release).** The human/TTY path gathers required input **inline** and never hands the
  human a next command for an input gate. When no Cloud token is configured, interactive `jolly start`
  prompts to **paste it inline** (the same `@clack/prompts` masked entry as `jolly login`, on `stderr` so
  stdout stays clean per 020), persists it, and continues — never closing at a blocked auth stage. The
  Vercel sign-in runs inline via the deploy stage's `vercel login` passthrough (002:98); the preview names
  it as run "with you inline". The run **ends at the one irreducible step Jolly cannot do** — pasting the
  Stripe keys + mapping the `us` channel in the Saleor Dashboard, store already live — named as the **final**
  step, never a re-run. A genuine stage *failure* (not a gate) still stops honestly; the **agent path
  (`--json`/`--yes`/non-TTY) is unchanged**. The masked token prompt is the one prompt with **no sane
  default** — a secret cannot be inferred — so Enter does not auto-advance it; this is the intended
  secret-entry exception to the "every prompt defaults" rule (056), shared with `jolly login` (018).

- **Homepage offers Agent + Terminal modes (current iteration — asset updated, specs reconciled,
  not yet redeployed).** The jolly.cool hero install area is now a two-tab copybox switcher (default
  **Agent**): the Agent tab keeps the existing paste-to-agent copybox with the agent badges below it;
  the **Terminal** tab shows `npx @dk/jolly start` (same copybox style + copy-button), agent badges
  hidden. Hero microcopy: "Use Jolly with your coding agent, or run the setup directly from your
  terminal." Only one copybox shows at a time. Agent-first stays the headline/default; terminal-run
  is now an **offered** entry mode, not merely a failure fallback (002 rule "Human-runnable
  `jolly start` is an offered entry mode" reconciled; the stale "homepage copy box is unchanged"
  narration removed). Homepage stays a human-authored asset (001) — not specced/tested. **Considered
  and dropped:** making `jolly init` an alias for `jolly start` — it reverses 007's bootstrap-only
  contract and makes `start` call itself, so `init` stays bootstrap-only (007 unchanged) and the
  terminal entry command is `jolly start`.
- **Resumable-stage output continuity (current iteration — 008 + `022:48` built; `022:40` @sandbox pending).** Fixes a real
  agent confusion: an agent ran standalone `jolly create store` (CLI printed "Store created
  successfully ✅"), then ran `jolly start`, which re-presented the already-done store as a *pending
  approval gate* with no "already configured" acknowledgement. The contradiction between the CLI's own
  success output and its later gate pushed the agent to reach for `--yes` — bypassing the supervision
  gates. The CLI's `summary`/`nextSteps` ARE the agent's instructions, so the fix is in the copy/
  contract: (008) a completed `create` subcommand's `nextSteps` point back to `jolly start` and state
  it recognizes the work rather than redoing it; (022) a resumable stage presents a 021 approval
  riskContext only for work it would actually perform this run, and announces an already-satisfied
  stage as satisfied — never re-gates it. **008:92 built + @logic-green (`968a28a`, on `main`):** the
  `create store --url` success envelope now carries a `jolly start` nextStep stating start recognizes the
  stored store rather than redoing it. **`022:48` built + @logic-green (`df3f99d`, on `main`):**
  with a store endpoint configured in `.env`, `jolly start --dry-run --json` presents no create-store approval
  gate on the store stage and names it as already satisfied in the `summary` — never re-gates the done work.
  **Still RED/undefined — the last 022 half:** `022:40` (@sandbox, composed standalone→`start`
  agree-on-state). Next credentialed QM cycle takes it. The composed standalone→`start` path is the
  unverified `@sandbox` surface (open watch #1) this defect rode in on.

## Shipped

Through **v0.9.3** (`main`+tag on GitHub, `@dk/jolly` on npm; homepage redeployed at v0.9.3):
token-only Saleor auth (browser OAuth removed), Stripe = app + skill (Stripe CLI removed), `@dk/jolly`
naming, the `stripe-best-practices` skill in the default set, **Bombshell CLI plumbing (027)** —
`@bomb.sh/args` typed parser, `@bomb.sh/tab` completion, `@clack/prompts` interactive `jolly start` +
masked login, agent path unchanged; (v0.9.1) **human-friendly output by default (020/027)** — human-first
default output, machine envelope only under `--json`; and (v0.9.2) **in-place progress on stderr (020:64)**
plus **end-to-end inline human start (027)** — the inline masked Cloud-token paste + the "with you inline"
Vercel / "final step" Stripe gate copy. The launch bar is met mechanically: homepage paste → live deployed
Paper storefront on Vercel → browsable/stocked store against Saleor Cloud → checkout reaches the Stripe test
step (behind the human Stripe-Dashboard gate). Full history in git.

**v0.9.3 shipped** (`b497f49`/tag `v0.9.3`, npm `latest`): `jolly start` now announces an
already-satisfied store stage as satisfied instead of re-presenting it as a pending approval gate
(022:40 — `@sandbox`-verified green + full `@logic` green). Homepage redeployed (`assets/homepage`,
Vercel project `homepage`) so jolly.cool/setup carries the `--json` agent guidance. The earlier
real-services (`@sandbox`) end-to-end caveats — the Paper `main` build break + sandbox-capacity
flakiness (below) — still stand for the broader suite.

## Open / watch

- **Paper `main` build break (watch):** `next build` of cloned Paper `main` fails with
  `EmptyGenerateStaticParamsError` on `/[locale]/[channel]/cart` (Next "Cache Components" needs a non-empty
  `generateStaticParams`). A real `jolly start` hits the same Vercel build failure today. Treated as transient
  upstream — re-verify the sandbox tier once Paper fixes `main`; if it persists, pin Jolly's Paper clone to a
  known-good ref (002/003).
- **Sandbox capacity flakiness:** a busy run can exhaust the test org's environment limit mid-run (env-create
  returns `error`); confirmed transient — creation and the harness's own direct-API create work between runs.
- **Feature 027 interactive-PTY `@logic` flakiness (watch):** the PTY-driven `jolly start` interactive
  scenarios fail non-deterministically under the parallel `-p logic` profile — same tree across three runs:
  parallel run failed 2 scenarios, a re-run was fully green, a serial run failed a *different* scenario.
  The failing target moves between runs = harness/PTY timing, not a product defect (no `src/` path changed
  by `968a28a` is exercised by 027). Risk: an unreliable `@logic` gate masks real regressions. If it
  persists, harden the PTY driver / serialize the 027 scenarios. ([[logic-parallel-loopback-flakiness]])
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
- **Audience:** terminal users and AI agents are both first-class. Agents drive Jolly via the `--json`
  machine envelope (their explicit opt-in); a human runs the same commands and gets the human-friendly
  default presentation (020). Neither is "the" audience — the homepage offers both paths equally, agent
  no longer assumed.

## Product identity

- Name: Jolly. Tagline: "Ahoy. Go build a store." A CLI by Dmytri Kleiner to set up a Saleor + Vercel +
  Stripe store fast — run it yourself from the terminal, or hand it to your AI agent — not an official
  product of Saleor, Vercel, or Stripe. The pirate voice (Jolly / Ahoy / 🏴‍☠️) is brand charm, kept;
  the homepage no longer *requires* an agent (agent-first hype dialled back to terminal-or-agent, equal).
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
