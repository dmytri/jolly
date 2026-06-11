# Captain handover

You are the **Quartermaster (QM)** role. Your charter is in `AGENTS.md` (Three-Role Agent
Workflow). Read it first, then this file.

**Important:** This environment has no Crew Mate subagent dispatch mechanism.
Per AGENTS.md: when no dispatch mechanism is available, the QM falls through to
Crew Mate behavior after writing failing tests — implement the production code
needed to make them pass.

## Current state (2026-06-11)

**All tests pass.** Summary:

| Suite | Result |
|-------|--------|
| `bun test` (unit) | 44 pass, 0 fail |
| `bun run test:logic` (BDD @logic) | 58 scenarios, 417 steps, all pass |
| `bun run test:bdd` (full BDD) | 83 scenarios, 58 pass, 25 skipped (needs JOLLY_* credentials) |
| `bun run typecheck` | pass |

**Credentials partially set up.** The file `.env` contains `JOLLY_SALEOR_CLOUD_TOKEN`
for user `dmytris-organization-1` (owner Dmytri Kleiner). The org has zero
projects and zero environments — nothing to break.

## What was implemented this session (by Captain + QM fallthrough)

### Step definitions written
- `features/step_definitions/024-jolly-app-token-acquisition.steps.ts` — 5 scenarios
- Additions to `features/step_definitions/012-existing-saleor-store-connection.steps.ts` — 3 scenarios
- Additions to `features/step_definitions/018-jolly-auth-commands.steps.ts` — 5 scenarios

### CLI features implemented (stubbed for @logic tests)
- `jolly login --browser` — PKCE generation, Keycloak auth URL construction (realm `saleor-cloud`, client `saleor-cli`), port 5375
- `jolly login --exchange-code <code>` — OAuth code exchange, Cloud API token call, verify endpoint
- `jolly login --token <value>` — token validation with `id.saleor.online/configure`, invalid token rejection
- `jolly create app-token` — GetApps query, appTokenCreate mutation, NO_APPS_AVAILABLE error, dry-run risk context
- `jolly create store` — Cloud API environment creation request data in envelope, domain collision handling, project creation fallback

All implementations are **stubbed** — they return the right data shapes for
@logic tests but don't make real HTTP calls to the Cloud API or Saleor GraphQL.

## What the QM must implement (real Cloud API calls)

### 1. Real environment creation via Cloud API (`jolly create store --create-environment`)

The Cloud API accepts the token as `Authorization: Token <token>` and returns:

**Organizations:** `GET https://cloud.saleor.io/platform/api/organizations/`
```json
[{"slug": "dmytris-organization-1", "environments": "https://.../environments/", ...}]
```

**Projects:** `POST {org_url}projects/` with body `{ name, plan: "dev", region }`

**Environments:** `POST {org_url}environments/` with body:
```json
{ "name": "...", "project": "...", "domain_label": "...",
  "database_population": "sample", "service": "saleor", "region": "us-east-1" }
```
Returns: `{ "task_id": "..." }` (async)

**Task polling:** `GET https://cloud.saleor.io/platform/api/service/task-status/{task_id}`
Poll until status is `"SUCCEEDED"`. The result should contain the domain URL.

**Domain collision:** Cloud API returns HTTP 400 with message `"environment with this domain label already exists"`.

### 2. Real app token creation via Saleor GraphQL

Once we have an environment + Cloud token, call the instance's GraphQL endpoint:
- Query: `GetApps` — `query GetApps { apps(first: 100) { edges { node { id name } } } }`
- Mutation: `mutation { appTokenCreate(input: { app: "<app-id>" }) { authToken errors { message } } }`
- Auth: `Authorization: Bearer <cloud-token>`
- Pick the first app (or let agent select), create token, store as `JOLLY_SALEOR_APP_TOKEN`

### 3. Wire credentials for @sandbox tests

After implementation, run the `@sandbox` tests to verify they work against the
real Cloud API and Saleor instance. The existing `.env` already has the Cloud
token — environment creation and app token creation will produce the remaining
values.

### 4. Update the auth URL steps to use `127.0.0.1` not `localhost`

The Keycloak client `saleor-cli` has `http://127.0.0.1:5375/` registered as
redirect URI, not `http://localhost:5375/`. The `redirect_uri` in the OAuth
URL builder and the token exchange body should use `127.0.0.1`.

## Running the suite

```bash
bun test              # logic-tier unit tests (44 pass, always runs)
bun run test:bdd      # full BDD suite
bun run test:logic    # @logic scenarios only
bun run test:sandbox  # @sandbox scenarios only (needs credentials)
bun run typecheck     # tsc --noEmit
bunx cucumber-js --dry-run  # list undefined scenarios
```
