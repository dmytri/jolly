# Captain handover

You are the **Quartermaster (QM)** role. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

**Important:** This environment has no Crew Mate subagent dispatch mechanism.
Per AGENTS.md: when no dispatch mechanism is available, the QM falls through to
Crew Mate behavior after writing failing tests — implement the production code
needed to make them pass.

## Current state (2026-06-11, Captain session)

**Unit tests pass, typecheck passes. Some BDD step definitions deleted.**

| Suite | Result |
|-------|--------|
| `bun test` (unit) | 44 pass, 0 fail |
| `bun run test:logic` (BDD @logic) | — will fail, step defs deleted |
| `bun run test:bdd` (full BDD) | — will fail, step defs deleted |
| `bun run typecheck` | pass |
| `bunx cucumber-js --dry-run` | **9 undefined scenarios, 43 undefined steps** |

The Captain deleted stale step definition files after spec changes. The QM must
regenerate them from the committed feature files.

**Credentials (`.env`):**
```
JOLLY_SALEOR_CLOUD_TOKEN=0ca90999...  (Saleor Cloud auth, dmytris-organization-1)
NEXT_PUBLIC_SALEOR_API_URL=https://jolly-mq9ol7f2.saleor.cloud/graphql/  (live instance)
JOLLY_SALEOR_APP_TOKEN=1wrjqr1u...   (app token for that instance)
```

Bun auto-loads `.env`, so all three are available in `process.env`. The org dev
plan allows 2 sandbox environments. **3 sandbox slots consumed currently** (the
live instance above = 1). You have 1 remaining before hitting the limit.

## Spec changes this session

### Feature 018 (auth commands)
- Added `@requires-browser` tag to the full browser OAuth login flow scenario
- Added "Browser OAuth prerequisites" rule clarifying that the browser flow
  requires a browser-capable runner; headless runners should skip it

### Feature 021 (risk context)
- **Critical change:** Every command that supports `--dry-run` MUST emit a
  `riskContext` in its real execution output, identical to the one produced
  during `--dry-run` preview. Previously this was a "should" — now it's a "MUST".
- The `riskContext` for real execution must be carried inside the output
  envelope (`data` or `checks`), not hidden or omitted.
- Added explicit step: "the real execution output must include a riskContext
  identical to the dry-run preview"

### Steps definition files DELETED by Captain
```
features/step_definitions/021-agent-risk-context.steps.ts
features/step_definitions/024-jolly-app-token-acquisition.steps.ts
```
The QM must rebuild these from the spec files.

## QM worklist

### 1. Rebuild step definitions for feature 021 (4 scenarios, @logic + @sandbox)
Feature: `features/021-agent-risk-context.feature` (4 scenarios)
- 3 @logic scenarios (step defs from `common.steps.ts` handle most steps)
- 1 @sandbox scenario: "Risk context is consistent across preview and execution"
  - This must now verify that **execution also emits riskContext** matching the preview
  - The login command's real execution path doesn't currently emit riskContext;
    the QM/Crew must add it

### 2. Rebuild step definitions for feature 024 (5 scenarios, @logic + @sandbox)
Feature: `features/024-jolly-app-token-acquisition.feature` (5 scenarios)
- 4 @logic scenarios
- 1 @sandbox scenario: "Jolly create app-token acquires a real token from Saleor"
  - The `When` step must actually invoke `jolly create app-token --app-id <id>`
  - The step definitions eliminated previous placeholders

### 3. Implement riskContext in login command's real execution
With the new spec (feature 021), `jolly login --token <value>` must include a
`riskContext` in its output envelope during real execution (not just `--dry-run`).
This requires modifying `cmdLogin()` in `src/index.ts`.

### 4. Verify end-to-end
After rebuilding step defs and implementing changes, run the full suite:
```bash
bun run typecheck
bun run test:logic   # 58 scenarios should pass
bun run test:bdd     # 84 scenarios, 60+ pass, rest skipped
```

## Key files created or modified (previous session)

| File | Change |
|------|--------|
| `src/lib/cloud-api.ts` | **NEW** — Full Cloud API client (organizations, projects, services, environments, app tokens) |
| `src/index.ts` | Added `--create-environment` flag, auto-load `.env`, fix localhost→127.0.0.1 |
| `features/018-jolly-auth-commands.feature` | Added `@requires-browser` tag, browser prereq rules |
| `features/021-agent-risk-context.feature` | MUST emit riskContext on real execution; clarified rules |
| `features/step_definitions/012-existing-saleor-store-connection.steps.ts` | Added 9 @sandbox step definitions |
| `features/step_definitions/018-jolly-auth-commands.steps.ts` | Updated redirect_uri check to accept 127.0.0.1 |
| `features/support/sandbox.ts` | Added SANDBOX_REQUIREMENTS for new scenario, browser OAuth req |

## Running the suite

```bash
bun test              # logic-tier unit tests (44 pass, always runs)
bun run test:logic    # @logic scenarios only
bun run test:bdd      # full BDD suite
bun run test:sandbox  # @sandbox scenarios only (needs credentials)
bun run typecheck     # tsc --noEmit
bunx cucumber-js --dry-run  # list undefined scenarios
```
