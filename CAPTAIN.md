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

## Current state / next outbound

- **Remaining outbound work:** publish `@dk/jolly@0.6.1`, then run one real paste→live-store acceptance pass on a clean machine to the feature 002 operational-readiness bar — deployed URL works, browsing/cart against Saleor Cloud, checkout reaches the Stripe test payment step, and `jolly doctor` checkout probe passes. Prefer a fresh blank Saleor environment; a non-blank store makes configurator deploy block honestly instead of applying.
- **In-flight:** a spec/asset/config consistency pass left uncommitted spec rewordings; QM picks up the orphaned step-definition re-sync from `npx cucumber-js --dry-run`. No behavior change intended.

## File-placement principle

- `features/*.feature` + `assets/**` = product intent (binding). `CAPTAIN.md` = non-binding notes. `AGENTS.md` = Shipshape/tooling-generic agent config (no product specifics, bar unavoidable tooling identifiers like `@dk/jolly`, `JOLLY_*`). `CLAUDE.md` = thin Claude-Code-specific pointer to `AGENTS.md`.
- All test/harness methodology lives in `AGENTS.md` so QM/Crew always see it — the tiers, *prefer sandbox over mocks*, *harmless-by-design*, the sandbox provisioning/teardown mechanics, and *specs map to executable steps, no design notes as steps*. There is no harness/`@meta` feature: `features/**` describes how Jolly works, never the harness or test methodology.

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
- `features/017`: exact safety rules for auto-applying Jolly-managed updates.
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
