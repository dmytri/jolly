# Captain handover

You are the **Quartermaster (QM)**. Your job: keep the committed `.feature` specs and the
executable test coverage aligned. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

## Current state (2026-06-11)

**All @logic tests pass (47/47, 343 steps).** The base CLI (`src/index.ts`) is implemented
with real side effects — .env writing, URL normalization, risk context, dry-run support,
doctor diagnostics. The test harness (`features/support/`) is stable.

**24 @sandbox scenarios skip** because no `JOLLY_*` credentials are configured. The
Captain will handle credential setup separately using the functional CLI.

## What changed this session

The Captain studied the deprecated Saleor CLI (`saleor/cli`) to understand how it handled
registration, authentication, environment creation, and app token acquisition. Based on
that research, three sets of scenarios were added:

### 018-jolly-auth-commands.feature — tightened OAuth login scenarios

The old vague `@sandbox` scenario ("Agent logs in to Saleor Cloud with browser OAuth")
was replaced with four concrete `@logic` scenarios plus one stricter `@sandbox`:

| Scenario | Tag | What it verifies |
|----------|-----|-----------------|
| `Jolly login constructs the browser OAuth authorization request` | `@logic` | PKCE challenge generation, Keycloak auth URL construction with all OIDC params, localhost callback server on port 5375 |
| `Jolly login exchanges the OAuth code for a Saleor Cloud token` | `@logic` | Code exchange at Keycloak token endpoint, Cloud API `/tokens` call with OIDC id_token, token verification at `id.saleor.online/verify` |
| `Jolly login validates a headless token against the verify endpoint` | `@logic` | Token POST to `id.saleor.online/configure`, storage in `.env`, account context reporting |
| `Jolly login rejects an invalid token gracefully` | `@logic` | Error message, no `.env` write, redirect to `cloud.saleor.io/tokens` |
| `Agent completes the full browser OAuth login flow` | `@sandbox` | Full end-to-end OAuth PKCE flow + token storage |

Key finding from deprecated CLI: login uses Keycloak at `auth.saleor.io`, OIDC params
with PKCE, a localhost callback on port 5375, then exchanges the OIDC token for a
Saleor Cloud API token via `POST /platform/api/tokens`.

### 012-existing-saleor-store-connection.feature — Cloud API environment creation

Three new `@logic` scenarios:

| Scenario | What it verifies |
|----------|-----------------|
| `Jolly create store builds a Cloud API environment creation request` | POST body shape (name, project, domain_label, database_population, service, region="us-east-1"), async task polling via task status endpoint |
| `Jolly create store handles domain name collision` | 400 error recovery, suggestion of alternative domain, retry |
| `Jolly create store creates a project when none exists` | Project creation via POST to `/projects/` with plan="dev" |

Key finding from deprecated CLI: environments are created via the Cloud API
(`POST /platform/api/organizations/{org}/environments/`) and the creation is async —
returns a `task_id` that must be polled.

### 024-jolly-app-token-acquisition.feature — new feature

| Scenario | Tag | What it verifies |
|----------|-----|-----------------|
| `Jolly create app-token lists available apps via GraphQL` | `@logic` | GetApps query, bearer auth, app list parsing |
| `Jolly create app-token constructs the correct GraphQL mutation` | `@logic` | `appTokenCreate(input: { app: $app })` mutation, all-permissions token, .env write |
| `Jolly create app-token handles missing apps gracefully` | `@logic` | Empty result handling, error code "NO_APPS_AVAILABLE" |
| `Jolly create app-token --dry-run shows risk context` | `@logic` | Dry-run: risk context, no GraphQL mutations |
| `Jolly create app-token acquires a real token from Saleor` | `@sandbox` | Full end-to-end, real token acquisition |

Key finding: app tokens are created via the **Saleor GraphQL API on the instance itself**
(not the Cloud API), using the standard `appTokenCreate` mutation. The deprecated CLI
lists apps via `GetApps`, lets the user pick one, then calls `appTokenCreate` with the
app ID.

### Updates to other files

- `008-jolly-create-subcommands.feature` — `jolly create app-token` added to the V1
  create subcommands rule list.
- `features/support/sandbox.ts` — added credential requirements for the new `@sandbox`
  scenarios.

## What the QM must do

1. **Write step definitions for all new scenarios** in:
   - `features/step_definitions/018-jolly-auth-commands.steps.ts` (4 new `@logic` + 1 `@sandbox`)
   - `features/step_definitions/012-existing-saleor-store-connection.steps.ts` (3 new `@logic`)
   - `features/step_definitions/024-jolly-app-token-acquisition.steps.ts` (4 new `@logic` + 1 `@sandbox`)

2. **Implement the new CLI behavior** in `src/index.ts`:
   - `jolly login --help` should mention browser OAuth and headless modes
   - PKCE challenge generation and Keycloak URL construction
   - Localhost HTTP server for OAuth callback (port 5375)
   - OAuth code exchange with Keycloak token endpoint
   - Cloud API `/tokens` endpoint call
   - Token verification against `id.saleor.online/verify`
   - `jolly create app-token` subcommand with GetApps query and `appTokenCreate` mutation
   - Cloud API environment creation with project fallback and domain collision handling

3. **Dispatch Crew Mates** for any failing scenarios (expected to new CLI features)

Do not restore deleted files from git history. Write everything fresh from the specs.

## Running the suite

```bash
bun test              # logic-tier unit tests (44 pass, always runs)
bun run test:bdd      # full BDD suite
bun run test:logic    # @logic scenarios only
bun run test:sandbox  # @sandbox scenarios only (needs JOLLY_* credentials)
bun run typecheck     # tsc --noEmit
bunx cucumber-js --dry-run  # list undefined scenarios (the QM worklist)
```

## Credentials for @sandbox

The 24 existing `@sandbox` scenarios plus the new ones need these `JOLLY_*` env vars:

| Variable | Where to get it |
|----------|----------------|
| `JOLLY_SALEOR_CLOUD_TOKEN` | https://cloud.saleor.io/tokens |
| `NEXT_PUBLIC_SALEOR_API_URL` | Your Saleor Cloud Dashboard (environment GraphQL endpoint) |
| `JOLLY_SALEOR_APP_TOKEN` | Created via `jolly create app-token` or Saleor Dashboard |
| `JOLLY_VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `JOLLY_STRIPE_PUBLISHABLE_KEY` | https://dashboard.stripe.com/test/apikeys |
| `JOLLY_STRIPE_SECRET_KEY` | https://dashboard.stripe.com/test/apikeys |

The Captain will set these up using the functional Jolly CLI once the new features are
implemented.
