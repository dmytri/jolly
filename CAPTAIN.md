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

## GOVERNING DESIGN DECISION (dk, 2026-06-15): live-by-design, never mock/fake

**Binding intent.** Jolly's test suite runs against **real services** in a **fully integrated test env that matches production** — the `JOLLY_*` Saleor Cloud / Vercel / Stripe credentials in `.env` ARE that test env. **Never mock or fake** (no fake Stripe/configurator CLIs, no dummy credentials, no `.invalid` endpoints, no simulated responses). **Creating real resources is expected and correct** — that is the point. Safety is **harmless-by-design = namespace every created resource + idempotent teardown + never modify/delete a resource the run did not create** (the existing AGENTS.md rules) — NOT credential-faking. This **supersedes the "012 incident" forced-safe approach** (`logicSafeEnv`/dummy creds): the guard against 012-class harm is the never-touch-what-we-didn't-create rule, not dummies. Scope: **every tier, including `@logic`** — no mock/fake anywhere.

**What this rewrites:**
- **Methodology (AGENTS.md):** "Prefer sandbox over mocks" → "real services always; mocks/fakes forbidden; harmless-by-design = namespace+cleanup." (AGENTS.md is the home of test methodology; flagged for dk's sign-off per the Captain/AGENTS.md boundary.)
- **Spec (feature 025):** the `@eval` "Harmless by design — bounded, no real cloud" rule and its "no real cloud resource created / nothing deployed" assertions INVERT — the eval drives the agent against the real test env and verifies the live result (real namespaced store/deploy/Stripe-test-mode), with teardown.
- **Harness (QM cycle):** rip out `logic-env.ts` (`logicSafeEnv`/`DUMMY`/`.invalid`) from ~19 step files + `dotenv`/`eval`; delete `stripe-cli-fake.ts` + `configurator-cli-fake.ts`; rewire every tier to the real `.env` services with namespace+teardown.

**Operational realities to honor (not optional):**
- **Env limits — cannon fodder (dk):** environments in this test org are disposable. When the org limit is hit (`ENVIRONMENT_LIMIT_REACHED`), the harness reclaims capacity by DELETING `jolly-test`-namespaced environments and proceeds — it is NOT a skip. The `jolly-test-` prefix (`features/support/sandbox.ts:293`, `makeNamespace` → `jolly-test-${runId}`) IS the protection boundary: only `jolly-test-*` envs are deletable cannon fodder; the configured `jolly-store` (the `.env` endpoint) and any future non-test env are never deleted. Sharing one per-run env is allowed as efficiency, not required.
- **Vercel:** live deploy needs a one-time interactive `vercel login` (browser) on the runner; absent it, deploy-touching tests skip-not-fail (capability gate), as `@sandbox` already does for `vercel whoami`.
- **Stripe:** real `@stripe/cli` + real test-mode keys; test cards only (worst case = declined, never a real charge).

**Failure-condition production policy (dk decided 2026-06-15): real where possible; narrow justified double otherwise.**
- **Produce for real** (the majority): every failure reachable from real bad input — empty/garbage token → real auth rejection; non-first-party `--url` → real `NON_FIRST_PARTY_HOST` pre-flight refusal; malformed input → real honest error. No double.
- **Justified-exception double** (enumerated, inline-justified, never the normal path) only for conditions the real test env genuinely cannot produce on demand. Current set: `ENVIRONMENT_LIMIT_REACHED` (org at its env limit) and the **unverifiable-endpoint** "stored, not verified" path (a deliberately unreachable service). If QM finds a real way to trigger these cheaply (e.g. fill-then-reclaim cannon-fodder envs), prefer that.
- **"No fabricated pass" doctor checks (020/014/021/024…):** under real creds these checks now legitimately PASS — so re-aim the assertion at its real intent: real reachable store → assert real `pass`; the never-fabricate invariant is proven by feeding **real junk/bad input** and asserting no success/verify language, not by an unroutable endpoint.

## Current state / next outbound

- **CONSISTENT BASELINE for the next iteration (2026-06-15):** all surfaces synced before the live-by-design harness rewire.
  - **git:** `origin/main` @ `b9b33b9`, synced; deck clean.
  - **npm:** `@dk/jolly@0.6.1` published (registry confirms `0.6.1`) — ships the post-0.6.0 src: v1 worklist impl (`feb52f8`) + `NON_FIRST_PARTY_HOST` pre-flight guard (`7484eb5`). Test-tier live-by-design changes don't affect the published CLI.
  - **homepage:** Vercel production deploy READY; `jolly.cool/setup` live (HTTP 200, current `assets/homepage/setup.md`).
  - **verified pre-publish:** typecheck clean; `-p logic` 94/676 green.
  - **Intended pending state (NOT a regression):** the `@eval` spec is ahead of its harness (4 undefined steps) — that is the QM worklist for the next iteration, by design.
- **Next iteration = the live-by-design QM cycle** (see governing decision above): 4 undefined eval steps + rip `logicSafeEnv`/`.invalid`/`DUMMY` from ~19 step files, delete `stripe-cli-fake.ts` + `configurator-cli-fake.ts`, rewire all tiers to real `.env` (namespace/teardown/cannon-fodder reclaim), apply the failure-production policy. Needs a fresh session → `/qm`.
- **Remaining to v1 ship:** one real paste→live-store acceptance pass to the feature 002 launch bar — deployed URL works, browse/cart against Saleor Cloud, checkout reaches the Stripe test payment step, `jolly doctor` checkout probe passes. Prefer a fresh blank Saleor environment (a non-blank store makes configurator deploy block honestly instead of applying). The `002` deployed-storefront `@sandbox` scenario is defined and skip-not-fail locally until a live deploy exists to point at.
- **Open follow-up (architectural, non-blocking):** the `NON_FIRST_PARTY_HOST` guard sits only at the `graphqlFetch` seam (where the customer `--url` flows). Sibling seams (`cloudFetch`, `pollTaskStatus`, `timedGraphql`) take only internally-derived first-party URLs and are unguarded — no scenario exercises them. If a future scenario lets a customer-supplied host reach them, centralize the predicate at one canonical request choke point rather than spreading `assertFirstPartyUrl`.
- **Deferred past v1:** tracked by the `@iteration` tag in the specs (`cucumber-js -p iteration`); the v1 worklist (002/008/009/012/020) is satisfied. Notable backlog items: `009` multi-agent detection matrix, `006` command-surface/flag-matrix robustness, `007` failed-skill-install surfacing, `017` auto-apply safe skill update, `002` resume-skip, `003` Paper guidance-in-plan.

## File-placement principle

- `features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes. `AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics, bar unavoidable tooling identifiers like `@dk/jolly`, `JOLLY_*`). `CLAUDE.md` = thin Claude-Code-specific pointer to `AGENTS.md`.
- All test/harness methodology lives in `AGENTS.md` so QM/Crew always see it — the tiers, *real services always (never mock/fake)*, *harmless-by-design*, the sandbox provisioning/teardown mechanics, and *specs map to executable steps, no design notes as steps*. There is no harness/`@meta` feature: `features/**` describes how Jolly works, never the harness or test methodology.

## Goals & MVP framing (the real objective)

- **North star:** an agent takes a customer from a homepage prompt to a real, live, honest storefront — and the customer's own agent owns it afterward. Success is defined by the launch bar below, not by feature count.
- **MVP first, then iterate:** ship one clean, honest end-to-end path before breadth. Don't over-engineer or chase edge cases the first run won't hit — get paste→live-store working, then iterate. Setup is v1; the iteration phase (feature 019) comes after.
- **Honesty is non-negotiable:** never fabricate success. "Verified", `pass` checks, and success claims only for work actually performed and confirmed; unverified work says so; unimplemented paths error honestly. This is the trust the whole product rests on (enforced as behavior in features 018/020).
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
- Forward goal (not built): step-result caching so unchanged verification is not re-run and status returns fast. The logic tier already runs in parallel (`cucumber.js`); caching needs a mechanism + invalidation rules, reporting cache-backed vs fresh, and must never hide a real failure.
- Future plan: extract the AGENTS.md "Scenario-writing rubric" (currently a faked-skill section — concrete-not-abstract, no faux steps, assert the system not the actor, verify invariants per-site, affordances via `pi`) into a standalone reusable scenario-writing skill — project-local first, then upstream to Shipshape — and use it to audit ALL existing scenarios against the rubric in one pass. That audit absorbs the still-open items: distributing per-mutation idempotency out of feature 022, the ~87 faux/weak step defs, and the vague-subject scenarios.
