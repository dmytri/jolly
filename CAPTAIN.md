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

Captain-only notes: product framing, rationale, open questions, and current state. **Non-binding.**

Only Captain may read or edit this file. QM, Crew, and Bosun must not. Binding behavior lives in `features/*.feature` and referenced `assets/**`, never here.

> **Captain authors every `.feature` scenario** — read and follow `SCENARIO_WRITING.md` (the scenario-writing guide) for each one.

History lives in git, not here. These notes describe only the current design and the live worklist; superseded cycle logs are removed (see `git log`).

## GOVERNING DESIGN DECISION (dk, 2026-06-15): live-by-design, never mock/fake

**Binding intent.** Jolly's test suite runs against **real services** in a **fully integrated test env that matches production** — the `JOLLY_*` Saleor Cloud / Vercel / Stripe credentials in `.env` ARE that test env. **Never mock or fake** (no fake Stripe/configurator CLIs, no dummy credentials, no `.invalid` endpoints, no simulated responses). **Creating real resources is expected and correct** — that is the point. Safety is **harmless-by-design = namespace every created resource + idempotent teardown + never modify/delete a resource the run did not create** (the existing AGENTS.md rules) — NOT credential-faking. Scope: **every tier, including `@logic`** — no mock/fake anywhere. Made executable by feature 026's `@property` "no forbidden double" invariant, so a green suite carrying a fake fails there instead of passing silently.

**Failure-condition production policy (dk, 2026-06-15): real where possible; narrow justified double otherwise.**
- **Produce for real** (the majority): every failure reachable from real bad input — empty/garbage token → real auth rejection; non-first-party `--url` → real `NON_FIRST_PARTY_HOST` refusal; malformed input → real honest error. No double.
- **Justified-exception double** (enumerated, inline-justified `@exceptional-double`, never the normal path) only for conditions the real test env cannot produce on demand. Current set: `ENVIRONMENT_LIMIT_REACHED` (org at its env limit) and the **unverifiable-endpoint** "stored, not verified" path (a deliberately unreachable service).
- **Env limits — cannon fodder (dk):** environments in this test org are disposable. The `jolly-test-` prefix (`features/support/sandbox.ts` `makeNamespace`) IS the protection boundary: only `jolly-test-*` envs are deletable; the configured store and any future non-test env are never deleted.
- **Vercel:** live deploy needs a one-time interactive `vercel login`; absent it, deploy-touching tests skip-not-fail. **Stripe:** real `@stripe/cli` + test-mode keys; test cards only.

## DESIGN DECISION (dk, 2026-06-16): browser OAuth is URL-first; all CLIs via npx

- **Browser OAuth is URL-first (feature 018).** `jolly login` / `--browser` generate the Keycloak authorization URL, print it for click/copy-paste, start the localhost callback server, and open a browser only when one is available (convenience). A missing browser is never an error; `--token` is the always-available non-interactive path. Jolly never sees/holds the user's credentials. There is no Playwright tier, no `@requires-browser`, no email/password knobs.
- **All CLIs via npx (tooling).** configurator, vercel, and stripe are all used via `npx`; a missing global binary is NOT a failure. Recorded to memory ([[clis-via-npx]]) and in AGENTS.md (Runtime and Build).

## Shipped to date (history in git)

Through **v0.7.1** (released 2026-06-18: push `main`+tag to `github.com/dmytri/jolly`, publish `@dk/jolly@0.7.1` to npm, deploy homepage to Vercel prod). The product reaches the launch bar mechanically: homepage paste → live deployed Paper storefront on Vercel → browsable/stocked store against Saleor Cloud → checkout reaches the Stripe test step (behind the irreducible human Stripe-Dashboard gate). Built across several field-retrospective cycles that converted real remote-VM `jolly start` runs into specs: honesty contracts (configurator deploy read-back, no fabricated success), headless/remote-VM auth (`--token`/`--token-file`/`--token-stdin`/`$JOLLY_SALEOR_CLOUD_TOKEN`, URL-first OAuth, headless-listener warning), doctor validity probes (Cloud token, Vercel account, `sk_live_` warning), `.env` safety (mode 600, shell-sourceable), `--help` usage on every subcommand, `start` idempotency/dry-run, pnpm native-build-script approval for Vercel, and the octopus-voice `setup.md`. The **third retrospective** cycle (post-v0.7.1, **committed but unreleased**) added: recipe bootstrap detection by store STATE not run-locality (004 — recipe deploys over Saleor's stock defaults even on a store from a prior `create store`), and `ENVIRONMENT_LIMIT_REACHED` → actionable `nextSteps` (008).

## Current state (2026-06-18)

- **Deck:** clean, verification green (logic 123 passed / 1 skipped; tsc clean; dry-run 0 undefined). `cycle.json` retired — third-retrospective pass1 complete (008 verified `@logic`; 004 `@sandbox`, CI-gated).
- **Outbound:** 2 commits ahead of `origin/main` (`0678aab` specs + `31f1df0` cycle) — the third retrospective, **held local, unreleased.** Awaiting dk's outbound decision (push only vs. version-bump + npm publish + homepage redeploy vs. hold).
- **Remaining to v1 ship:** the field runs confirm paste→live-store works end-to-end against real Saleor Cloud + Vercel. The launch bar's "checkout reaches the Stripe test payment step" still depends on the irreducible human Stripe-Dashboard key+channel gate; `jolly doctor`'s checkout probe verifies it once done.

## Open / deferred work (not lost)

- **Live `-p eval` run.** Both prior blockers fixed (auth-only seed, pre-run reclamation); `setup.md:97` steers background+poll. Remaining is an operational run; pi's per-command bash timeout vs the ~8-min `jolly start` is the open risk.
- **Seam-scoping fidelity fix (harness).** `reclaimLeftoverTestEnvironments` deletes ALL `jolly-test-` envs incl. the current run's; feature 025 + the 026 scenario say "previous run". Harmless today (gated; the eval has no current-run env at pre-run time). Clean fix: scope to previous-run leftovers + seed the 026 leftover under a simulated previous-run namespace. No spec change; harness-faithfulness QM item. `026:21` passes but does not assert the current-run env survives — strengthen it when worked.
- **014 two-vercel-auth-scenario consolidation.** 014 has two live-session `@sandbox` vercel-auth scenarios (mechanism vs. account-naming); distinct observables, both green; consider consolidating at a Bosun sweep.
- **Report backlog not yet specced:** manual-OAuth code-paste path (`--manual-oauth`: print URL, read `code` from stdin) — `@iteration`; JOLLY-010 single source of truth for the Cloud-API `Token`-auth fetch shared by doctor + login (impl preference, not a scenario); JOLLY-011 surface `@saleor/configurator --plan` higher in user-facing output.
- **Open follow-up (architectural, non-blocking):** the `NON_FIRST_PARTY_HOST` guard sits only at the `graphqlFetch` seam (where the customer `--url` flows). Sibling seams (`cloudFetch`, `pollTaskStatus`, `timedGraphql`) take only internally-derived first-party URLs and are unguarded — no scenario exercises them. If a future scenario lets a customer-supplied host reach them, centralize the predicate at one canonical request choke point.
- **Deferred past v1** (`@iteration` tag; `cucumber-js -p iteration`): `009` multi-agent detection matrix, `006` command-surface/flag-matrix robustness, `007` failed-skill-install surfacing, `017` auto-apply safe skill update, `002` resume-skip, `003` Paper guidance-in-plan.
- **Octopus consistency (deferred by dk):** homepage `index.html` is still pirate-themed; only `setup.md` is octopus. If the mascot should land consistently, `index.html` + the Jolly skill would follow.

## Lessons learned → Shipshape upstream (2026-06-15)

Process lessons from the live-by-design design session. Workflow-generic (not Jolly-specific) — candidates for upstreaming to Shipshape's role prompts / scenario rubric.

1. **Green-suite blindness.** QM derives its worklist only from undefined/failing targets, so a suite that is green *with* forbidden fakes yields an empty worklist — the violation is invisible. *Upstream:* a methodology rule that is not encoded as a failing check is unenforced; the workflow must let conformance be a discoverable target, not only prose in the agent-config doc.

2. **Testability, not subject, is the line for what's specifiable.** The real discriminator is falsifiability: untestable aspiration is banned; a *testable* harness/conformance invariant ("no forbidden double outside tagged sites") is a legitimate `@property` scenario. *Upstream:* state it as "testable ⇒ specifiable, regardless of subject".

3. **Disposability has a granularity prerequisite.** "Specs durable, code disposable" yields clean regeneration only when the disposable unit is modular enough to match what you want to replace. Fix: refactor-to-seam first (behavior-preserving, green-guarded), then dispose/flip surgically. *Upstream:* the regen model needs a modularity precondition, and a behavior-preserving refactor is a distinct cycle shape — green-guarded, human-directed, **not** red-discovered.

4. **The disposable layer is three, not two.** The fakes lived in the *test harness* (step defs + support) — neither spec nor implementation. *Upstream:* name the verification/harness layer explicitly as its own disposable-from-specs layer with its own conformance.

5. **Encode constraints as positive observables, not prohibitions.** The enforceable form of "Jolly shall not call the API directly" is a positive scenario whose observable is the desired behavior ("Jolly invokes the official CLI"). *Upstream:* guide authors to express security/architecture constraints as positive falsifiable observables.

6. **Directed work needs a firewall-safe channel.** Genuinely non-red-discoverable work (refactors, conformance seeding) has no firewall-safe entry except `cycle.json`. *Upstream:* define a sanctioned "directed cycle" handoff — a durable, QM-readable scope artifact.

7. **On a role takeover, the predecessor's flagged blockers are the primary input — the role prompts don't enforce it.** (2026-06-17, observed live.) Captain took over after a QM→Crew→Bosun cycle whose final report listed blockers, but led with the outbound decision and imported a stale `CAPTAIN.md` worklist instead. *Upstream:* every role prompt's opening should make the immediately-preceding role's final-report blockers/open-questions the FIRST agenda item, read verbatim; state that a takeover is often several situations at once (handle all, blockers first); rank the fresh handoff above accumulated notes on conflict. (Local stopgap in `AGENTS.md` → "Role handoffs".)

## File-placement principle

- `features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes. `AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics, bar unavoidable tooling identifiers like `@dk/jolly`, `JOLLY_*`). `CLAUDE.md` = thin Claude-Code-specific pointer to `AGENTS.md`.
- All test/harness methodology lives in `AGENTS.md` so QM/Crew always see it — the tiers, *real services always (never mock/fake)*, *harmless-by-design*, the sandbox provisioning/teardown mechanics. The one admitted exception in `features/**` is a *testable conformance invariant* about the verification layer (feature 026's `@property` "no forbidden double"). The discriminator for what may be a scenario is **testability, not subject**.

## Goals & MVP framing (the real objective)

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront — and the customer's own agent owns it afterward. Success is defined by the launch bar below, not by feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth. Don't over-engineer or chase edge cases the first run won't hit. Setup is v1; the iteration phase (feature 019) comes after.
- **Honesty is non-negotiable:** never fabricate success. "Verified", `pass` checks, and success claims only for work actually performed and confirmed; unverified work says so; unimplemented paths error honestly. This is the trust the whole product rests on (enforced as behavior in features 014/018/020).
- **Empower, don't replace, the agent:** Jolly does deterministic plumbing and orchestrates the official CLIs; the customer's agent stays in charge — approves risk, completes human gates, owns the store after setup.
- **Audience:** AI agents/skills are the primary consumers; human DX stays decent but secondary.

## Product identity (non-binding)

- Name: Jolly. Tagline: "Ahoy, agent. Go build a store."
- A tool by Dmytri Kleiner to help an agent set up a Saleor + Vercel + Stripe store fast. Not an official product of Saleor, Vercel, or Stripe.
- Product shape: homepage + thin CLI + Jolly skill + Saleor agent-skills.
- **Launch bar** (when v1 is good enough to ship): homepage prompt → real deployed storefront → browsing/cart against Saleor Cloud → checkout reaches the Stripe test payment step, every claim verified, nothing fabricated.

## Architecture framing (non-binding; behavior is specified in features 002/008)

- `jolly start` is agent-supervised orchestration: it runs the mechanical stages by spawning the official CLIs and Jolly helpers, pauses for approval/risk context, and waits at human gates. The ordered stages and their contracts are specified in features 002 and 008 — not enumerated here.
- Human-run `jolly start` is the backup path for interactive gates a non-TTY agent cannot complete. The homepage stays paste-to-agent first.

## Open questions (deferred out of features)

- `features/001`: whether Jolly should create project-local durable artifacts such as `.jolly/` reports or state; exact per-environment setup steps for supported agent targets.
- `features/008`: whether `jolly create app-token` should request all available permissions or allow the agent to specify a subset.
- `features/012`: which pasted URL forms Jolly should normalize in v1; exact Saleor API or Dashboard automation path for app-token creation; exact task-status response shape and domain extraction against the live Cloud API.
- `features/019`: mcp-graphql config format for each supported agent environment; whether `jolly doctor --watch` belongs in v1 or v2; upgrade cadence signal for outdated skills.
- `features/020`: envelope schema versioning; canonical registry of stable error codes and check ids.
- `features/021`: whether `riskLevel` is derived deterministically from categories or set per action; optional fields such as estimated cost or affected record counts.
- `features/022`: how Jolly detects completed remote work, and whether resumable state is tracked in local artifacts such as `.jolly/`.
- `features/023`: CI wiring for sandbox credentials.

## Non-binding notes

- The product stack is specified in features, not restated here: Paper storefront + Vercel (002), Saleor Cloud only / no self-hosted (003), the configurator starter recipe (004), Stripe test mode only (005).
- Post-setup customization belongs to the customer's own agent/workflow.
- Homepage/setup-guide copy principle: less is more; avoid junk and duplication.
- Open future item: the npm tarball is large because `assets/skills/jolly/images/` ships product PNGs referenced by the starter recipe — functional, but worth future assets work.
- Forward goal (not built): step-result caching so unchanged verification is not re-run and status returns fast. Caching needs a mechanism + invalidation rules, reporting cache-backed vs fresh, and must never hide a real failure.
- Future plan: extract the scenario-writing rubric into a standalone reusable skill — project-local first, then upstream to Shipshape — and audit ALL existing scenarios against it in one pass.
</content>
</invoke>
