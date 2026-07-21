// Saleor Cloud API client (feature 012 — existing Saleor store connection).
//
// Pinned by the feature 012 Rule "Existing-store automation principles":
// - The Cloud API is at https://cloud.saleor.io/platform/api, optionally
//   overridden by JOLLY_SALEOR_CLOUD_API_URL (feature 018 Rule); every Cloud
//   API request honors the override.
//   Authenticate with `Authorization: Token <token>`.
// - Organizations: GET /platform/api/organizations/ returns a list with slug
//   and environments URL.
// - Projects: POST /platform/api/organizations/{slug}/projects/ with body
//   { name, plan: "dev", region }.
// - Environments: POST /platform/api/organizations/{slug}/environments/ with
//   body { name, project, domain_label, database_population: null (blank —
//   no sample data, decision 2026-06-14), service, region: "us-east-1" }.
//   Returns a task_id.
// - Task status: GET /platform/api/service/task-status/{task_id} until
//   status is "SUCCEEDED".
// - The environment task result contains the domain URL
//   (https://{domain_label}.saleor.cloud/graphql/).
//
// Pinned by the Rule "Environment creation against in-use organizations":
// - When the Cloud API rejects environment creation because the
//   organization's sandbox environment limit is reached, surface the stable
//   error code ENVIRONMENT_LIMIT_REACHED.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isFirstPartyHost } from "./hosts.ts";
import { cliMessage } from "./messages.ts";

const DEFAULT_CLOUD_API_BASE = "https://cloud.saleor.io/platform/api";

/**
 * Pre-flight first-party host guard (feature 020 Rule "First-party hosts only").
 * Refuses — before any fetch — to turn a URL into an outbound request when its
 * host is not first-party (the customer-supplied `--url` is the injection point
 * this guards). Throws CloudApiError with the stable code NON_FIRST_PARTY_HOST,
 * naming the refused host. Reuses the canonical allowlist in hosts.ts.
 * @planks("the agent runs `jolly doctor saleor --json` with no reachable store")
 * @planks("it should validate GraphQL connectivity")
 */
function assertFirstPartyUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new CloudApiError(
      cliMessage("request.error.unparseableUrl", { url }),
      "NON_FIRST_PARTY_HOST",
    );
  }
  if (!isFirstPartyHost(host)) {
    throw new CloudApiError(
      cliMessage("createStore.error.nonFirstPartyHost.message", {
        pastedHost: host,
      }),
      "NON_FIRST_PARTY_HOST",
    );
  }
}

/**
 * The Cloud API base URL for this request: the JOLLY_SALEOR_CLOUD_API_URL
 * override when set (feature 018 Rule — pointing it elsewhere is the
 * customer's explicit choice), otherwise the first-party default.
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export function cloudApiBase(): string {
  const override = process.env["JOLLY_SALEOR_CLOUD_API_URL"];
  if (override && override.trim().length > 0) {
    return override.trim().replace(/\/+$/, "");
  }
  return DEFAULT_CLOUD_API_BASE;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 480_000; // stay under the harness's CLI timeout
// A transient task-status poll answer (429/5xx) is retried within this bounded
// budget before the poll gives up and reports the creation unconfirmed
// (feature 004 Rule "Backend Saleor requests retry a transient failure").
const TASK_STATUS_RETRY_BUDGET_MS = 60_000;

// Positive-integer millisecond env override with a production fallback: unset,
// empty, non-numeric, or non-positive values fall back, so an absent override
// is a no-op (the same contract as the readiness gate's reader in src/index.ts).
function readPositiveIntMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Error from the Cloud API with a stable, branchable code.
 * @planks("the envelope status should be {string} with the stable code `ENVIRONMENT_LIMIT_REACHED`")
 */
export class CloudApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(message: string, code: string, httpStatus?: number) {
    super(message);
    this.name = "CloudApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * The platform-API auth scheme for a token, chosen by which stored variable
 * holds it (feature 018 Rule "The Cloud platform API scheme is chosen by which
 * stored token is used"): a device-grant access token (a Keycloak JWT in
 * `JOLLY_SALEOR_ACCESS_TOKEN`) is sent as `Authorization: Bearer`; a staff token
 * (`JOLLY_SALEOR_CLOUD_TOKEN`) as `Authorization: Token`. The access token, when
 * stored, takes precedence — so a value equal to `JOLLY_SALEOR_ACCESS_TOKEN`
 * authenticates as `Bearer`, everything else as `Token`.
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export function platformAuthScheme(token: string): "Bearer" | "Token" {
  // Decide by the token's SHAPE, not by whether it happens to be mirrored in
  // process.env. A device-grant access token is a JWT (three non-empty
  // dot-separated base64url segments) and the Cloud platform API accepts it as
  // Bearer; a Cloud staff token is opaque (uuid.base58, no dots) and
  // authenticates as Token. The old process.env identity check only held when
  // the token was loaded into process.env (the interactive same-process path),
  // so the agent path — which reads the token back from .env — sent a device
  // JWT as `Token` and the platform API rejected it (401 "Invalid token
  // header"), pushing the agent toward a staff token it should never need.
  const segments = token.split(".");
  const looksLikeJwt = segments.length === 3 && segments.every((s) => s.length > 0);
  return looksLikeJwt ? "Bearer" : "Token";
}

/** The one seam that sends a Saleor Cloud platform API request, under the
 * resolved token and scheme. Every Cloud read and write goes through here,
 * behind the first-party pre-flight (feature 020 Rule "First-party hosts
 * only"): a non-first-party URL is refused before anything is sent.
 * @planks("the envelope `data` should report the resolved organization slug")
 * @planks("each should reach the network only through a seam that applies the first-party host predicate before sending")
 */
async function cloudFetch(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  assertFirstPartyUrl(url);
  const init = {
    ...options,
    headers: {
      Authorization: `${platformAuthScheme(token)} ${token}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  };
  // A momentary Cloud platform-API blip (429/5xx server error, connection
  // reset) under concurrent load must not fail an otherwise-valid request such
  // as the org/environment resolution `create store --url` runs. Retry with a
  // SHORT backoff (~6s total) that stays well within callers' step budgets — a
  // persistent failure still surfaces so the caller reports honestly.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      const transient =
        response.status === 429 || (response.status >= 500 && response.status <= 504);
      if (transient && attempt < TRANSIENT_RETRIES) {
        await sleep(Math.min(500 * 2 ** attempt, 3000));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt < TRANSIENT_RETRIES) {
        await sleep(Math.min(500 * 2 ** attempt, 3000));
        continue;
      }
      throw error;
    }
  }
}

// ── Organizations ────────────────────────────────────────────────────────

export interface CloudOrganization {
  slug: string;
  name?: string;
  [key: string]: unknown;
}

/** GET /platform/api/organizations/
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 * @planks("the agent runs `jolly doctor saleor --json`")
 */
export async function listOrganizations(
  token: string,
): Promise<CloudOrganization[]> {
  const response = await cloudFetch(`${cloudApiBase()}/organizations/`, token);
  if (!response.ok) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.listOrganizations", {
        status: response.status,
        detail: await response.text(),
      }),
      "CLOUD_API_ERROR",
      response.status,
    );
  }
  return (await response.json()) as CloudOrganization[];
}

// ── Projects (create-or-reuse) ───────────────────────────────────────────

export interface CloudProject {
  name: string;
  slug?: string;
  plan?: string;
  region?: string;
  [key: string]: unknown;
}

/** GET /platform/api/organizations/{slug}/projects/
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export async function listProjects(
  token: string,
  organizationSlug: string,
): Promise<CloudProject[]> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/projects/`,
    token,
  );
  if (!response.ok) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.listProjects", {
        status: response.status,
        detail: await response.text(),
      }),
      "CLOUD_API_ERROR",
      response.status,
    );
  }
  return (await response.json()) as CloudProject[];
}

/** POST /platform/api/organizations/{slug}/projects/ with { name, plan, region }.
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export async function createProject(
  token: string,
  organizationSlug: string,
  body: { name: string; plan: string; region: string },
): Promise<CloudProject> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/projects/`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!response.ok) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.createProject", {
        status: response.status,
        detail: await response.text(),
      }),
      "PROJECT_CREATE_FAILED",
      response.status,
    );
  }
  return (await response.json()) as CloudProject;
}

// ── Services (concrete service identifier for environment creation) ──────

export interface CloudService {
  name: string;
  region?: string;
  service_type?: string;
  [key: string]: unknown;
}

/** GET /platform/api/organizations/{org}/projects/{project}/services/
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export async function listProjectServices(
  token: string,
  organizationSlug: string,
  projectSlug: string,
): Promise<CloudService[]> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/projects/${projectSlug}/services/`,
    token,
  );
  if (!response.ok) return [];
  return (await response.json()) as CloudService[];
}

/**
 * Pick the service identifier for environment creation: prefer a sandbox
 * service in the default region, then any sandbox service, then the first
 * listed; fall back to the spec's "saleor" default when discovery yields
 * nothing.
 * @planks("the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials")
 */
export function pickService(
  services: CloudService[],
  region: string = "us-east-1",
): string {
  const sandbox = services.filter(
    (s) => String(s.service_type ?? "").toUpperCase() === "SANDBOX",
  );
  const inRegion = sandbox.find((s) => s.region === region);
  const chosen = inRegion ?? sandbox[0] ?? services[0];
  return chosen?.name ?? "saleor";
}

// ── Environments ─────────────────────────────────────────────────────────

export interface CloudEnvironment {
  key?: string;
  name?: string;
  domain?: string;
  domain_label?: string;
  task_id?: string;
  [key: string]: unknown;
}

export interface EnvironmentCreationBody {
  name: string;
  project: string;
  domain_label: string;
  database_population: string | null;
  service: string;
  region: string;
}

/**
 * The one place the environment-creation POST body is built, so the `--dry-run`
 * preview reports the very body the real request sends. `database_population`
 * is null: the Saleor Cloud "blank" template (feature 012 Rule "Created
 * environments are provisioned blank").
 * @planks("^there should be exactly one, and both the `--dry-run` preview and the real request should report and send that one body$")
 * @planks("the POST body should include name, project, domain_label, database_population, service, and optional basic-auth credentials")
 * @planks("the prepared request should create a blank environment with no sample data")
 * @planks("the default region should be {string}")
 */
export function environmentCreationBody(opts: {
  name: string;
  project: string;
  domainLabel: string;
  service: string;
  region: string;
}): EnvironmentCreationBody {
  return {
    name: opts.name,
    project: opts.project,
    domain_label: opts.domainLabel,
    database_population: null,
    service: opts.service,
    region: opts.region,
  };
}

/**
 * POST /platform/api/organizations/{slug}/environments/ — returns the
 * environment (with task_id for async provisioning). A rejection caused by
 * the organization's sandbox environment limit surfaces as a CloudApiError
 * with the stable code ENVIRONMENT_LIMIT_REACHED (feature 012 Rule).
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 * @planks("it should create an environment via POST \/platform\/api\/organizations\/\{organization}\/environments\/")
 * @planks("the agent runs `jolly create store --create-environment --json`")
 * @planks("the envelope status should be {string} with the stable code `ENVIRONMENT_LIMIT_REACHED`")
 */
export async function createEnvironment(
  token: string,
  organizationSlug: string,
  body: EnvironmentCreationBody,
): Promise<CloudEnvironment> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/environments/`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!response.ok) {
    const text = await response.text();
    if (
      response.status >= 400 &&
      response.status < 500 &&
      /domain/i.test(text) &&
      /taken|exists|already|unique|in use|duplicate/i.test(text)
    ) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.domainLabelTaken", {
          domainLabel: body.domain_label,
          status: response.status,
        }),
        "DOMAIN_LABEL_TAKEN",
        response.status,
      );
    }
    if (
      response.status >= 400 &&
      response.status < 500 &&
      /limit|quota|exceed/i.test(text)
    ) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.environmentLimitReached"),
        "ENVIRONMENT_LIMIT_REACHED",
        response.status,
      );
    }
    throw new CloudApiError(
      cliMessage("cloudApi.error.createEnvironment", {
        status: response.status,
        detail: text,
      }),
      "ENVIRONMENT_CREATE_FAILED",
      response.status,
    );
  }
  return (await response.json()) as CloudEnvironment;
}

/** GET /platform/api/organizations/{slug}/environments/
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export async function listEnvironments(
  token: string,
  organizationSlug: string,
): Promise<CloudEnvironment[]> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/environments/`,
    token,
  );
  if (!response.ok) return [];
  return (await response.json()) as CloudEnvironment[];
}

/** GET /platform/api/organizations/{slug}/environments/{key}/
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 */
export async function getEnvironment(
  token: string,
  organizationSlug: string,
  environmentKey: string,
): Promise<CloudEnvironment | undefined> {
  const response = await cloudFetch(
    `${cloudApiBase()}/organizations/${organizationSlug}/environments/${environmentKey}/`,
    token,
  );
  if (!response.ok) return undefined;
  return (await response.json()) as CloudEnvironment;
}

// ── Task polling ─────────────────────────────────────────────────────────

export interface TaskStatus {
  status?: string;
  [key: string]: unknown;
}

/** The poll URL for a task: GET /platform/api/service/task-status/{task_id}.
 * @planks("Jolly should poll GET \/platform\/api\/service\/task-status\/\{task_id} until status is {string}")
 */
function taskStatusUrl(taskId: string): string {
  return `${cloudApiBase()}/service/task-status/${taskId}/`;
}

/**
 * Poll GET /platform/api/service/task-status/{task_id} until status is
 * "SUCCEEDED". Throws on FAILED or on timeout. Returns the final task body
 * so the caller can extract the resulting domain from the task result.
 *
 * A transient poll answer — HTTP 429 or 5xx from a momentarily-busy Cloud API
 * (feature 004 Rule "Backend Saleor requests retry a transient failure") — is
 * retried on a short interval, stopping at the first successful poll rather
 * than a fixed count. The retry is BOUNDED: when the transient failure
 * persists past the budget, the poll gives up with the stable code
 * TASK_STATUS_UNCONFIRMED and a message reporting honestly what is known —
 * the creation task was accepted, but its completion could not be confirmed.
 * A non-transient rejection still fails immediately as TASK_STATUS_FAILED.
 * Budget and interval read JOLLY_TASK_STATUS_RETRY_BUDGET_MS and
 * JOLLY_TASK_STATUS_RETRY_POLL_MS, falling back to the production defaults.
 *
 * Verified against the live Cloud API: the task id is the full job name
 * from the creation response, and the endpoint is anonymous — sending the
 * Cloud `Authorization: Token` header makes the service try (and fail) to
 * decode it as a JWT, returning 401 "Error decoding signature".
 * @planks("Jolly should poll GET \/platform\/api\/service\/task-status\/\{task_id} until status is {string}")
 * @planks("the environment creation should return a task_id for async job polling")
 * @planks("each should reach the network only through a seam that applies the first-party host predicate before sending")
 * @planks("no `errors` entry should carry the code `TASK_STATUS_FAILED`")
 * @planks("the retry should stop at the first successful poll rather than a fixed count")
 * @planks("the envelope status should be {string} after the bounded retry budget is exhausted")
 * @planks("the error should state that the creation task was accepted but its completion could not be confirmed")
 */
export async function pollTaskStatus(
  taskId: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<TaskStatus> {
  const deadline = Date.now() + timeoutMs;
  const url = taskStatusUrl(taskId);
  assertFirstPartyUrl(url);
  const retryBudgetMs = readPositiveIntMs(
    "JOLLY_TASK_STATUS_RETRY_BUDGET_MS",
    TASK_STATUS_RETRY_BUDGET_MS,
  );
  const retryPollMs = readPositiveIntMs(
    "JOLLY_TASK_STATUS_RETRY_POLL_MS",
    POLL_INTERVAL_MS,
  );
  let transientSince: number | undefined;
  for (;;) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const transient =
        response.status === 429 ||
        (response.status >= 500 && response.status <= 504);
      if (!transient) {
        throw new CloudApiError(
          cliMessage("cloudApi.error.taskStatusCheck", {
            status: response.status,
            detail: await response.text(),
          }),
          "TASK_STATUS_FAILED",
          response.status,
        );
      }
      transientSince ??= Date.now();
      if (Date.now() - transientSince >= retryBudgetMs) {
        throw new CloudApiError(
          cliMessage("cloudApi.error.creationConfirmationTimeout", {
            taskId,
            status: response.status,
            seconds: Math.round(retryBudgetMs / 1000),
          }),
          "TASK_STATUS_UNCONFIRMED",
          response.status,
        );
      }
      await sleep(retryPollMs);
      continue;
    }
    transientSince = undefined;
    const task = (await response.json()) as TaskStatus;
    const status = String(task.status ?? "").toUpperCase();
    if (status === "SUCCEEDED") return task;
    if (status === "FAILED" || status === "ERROR") {
      throw new CloudApiError(
        cliMessage("cloudApi.error.provisioningTaskFailed", {
          taskId,
          detail: JSON.stringify(task),
        }),
        "TASK_FAILED",
      );
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.provisioningTaskTimeout", {
          taskId,
          seconds: Math.round(timeoutMs / 1000),
          status: status || cliMessage("cloudApi.status.unknown"),
        }),
        "TASK_TIMEOUT",
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Extract the resulting GraphQL domain URL
 * (https://{domain_label}.saleor.cloud/graphql/) from the task result,
 * falling back to the environment object when the task body does not carry
 * it (the exact task-status shape is verified against the live API).
 * @planks("Jolly should extract the resulting domain from the task result")
 * @planks("the envelope `data` should report the created store's `*.saleor.cloud` GraphQL API URL")
 */
export function extractDomainUrl(
  task: TaskStatus | undefined,
  environment: CloudEnvironment | undefined,
  domainLabel: string,
): string {
  const candidates: unknown[] = [];
  if (task) {
    const result = task.result as Record<string, unknown> | undefined;
    candidates.push(result?.domain, task.domain, environment?.domain);
  } else {
    candidates.push(environment?.domain);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      const domain = candidate.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return `https://${domain}/graphql/`;
    }
  }
  return `https://${domainLabel}.saleor.cloud/graphql/`;
}

// ── Instance GraphQL ──────────────────────────────────────────────────────

// A transient Saleor Cloud condition must not fail an otherwise-successful
// backend request (feature 004 Rule "Backend Saleor requests retry a transient
// failure"): a rate-limit (429), a server error (500/502/503/504 — a
// freshly-provisioned or momentarily-busy instance), or a connection-level
// failure (fetch rejects). Resilience lives at this shared request layer so every
// backend Saleor GraphQL request Jolly sends retries, rather than each caller
// wrapping its own. Bounded to a SHORT ~6s exponential backoff that stays within
// callers' step budgets (a longer backoff turns a slow query into a step
// timeout); a PERSISTENT failure still surfaces honestly so the stage reports
// blocked/fail.
const TRANSIENT_RETRIES = 4;

/**
 * @planks("the agent runs `jolly start --yes --json` and the stock stage runs against that endpoint")
 * @planks("the stock stage should be reported completed, having retried the rate-limited request")
 */
async function graphqlFetch(
  graphqlUrl: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertFirstPartyUrl(graphqlUrl);
  const init = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  };
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(graphqlUrl, init);
      const transient = r.status === 429 || (r.status >= 500 && r.status <= 504);
      if (transient && attempt < TRANSIENT_RETRIES) {
        await sleep(Math.min(500 * 2 ** attempt, 3000));
        continue;
      }
      response = r;
      break;
    } catch (error) {
      if (attempt < TRANSIENT_RETRIES) {
        await sleep(Math.min(500 * 2 ** attempt, 3000));
        continue;
      }
      throw error;
    }
  }
  if (!response.ok) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.instanceGraphqlHttp", {
        status: response.status,
      }),
      "GRAPHQL_HTTP_ERROR",
      response.status,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (body.errors) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.graphqlErrors", {
        detail: JSON.stringify(body.errors),
      }),
      "GRAPHQL_ERROR",
    );
  }
  return (body.data ?? {}) as Record<string, unknown>;
}

/** query GetApps { apps(first: 100) { edges { node { id name } } } }
 * @planks("`jolly stripe` runs the Stripe app-install stage against that store")
 */
export async function queryGetApps(
  graphqlUrl: string,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query GetApps { apps(first: 100) { edges { node { id name } } } }`,
  );
  const apps = data.apps as Record<string, unknown> | undefined;
  const edges = (apps?.edges ?? []) as Array<Record<string, unknown>>;
  return edges.map((edge) => edge.node as { id: string; name: string });
}

/**
 * Whether the store holds product catalog the recipe does NOT declare — i.e.
 * products beyond the recipe's own. Decides the recipe deploy's bootstrap path by
 * the store's STATE (feature 004 Rule "Recipe targets a clean environment"),
 * robustly across both a blank store and an idempotent re-run:
 *
 * - A blank Saleor environment ships the default channel/category/warehouse but
 *   NO products, so the result is empty → bootstrap (omit --failOnDelete; the
 *   undeclared stock defaults are deleted to match the recipe).
 * - A re-run over Jolly's own store holds only the recipe's products → still
 *   empty of FOREIGN catalog → bootstrap, so the re-deploy reconciles cleanly
 *   instead of blocking on the lingering protected default channel.
 * - A store that already holds the customer's own products → foreign catalog
 *   present → keep the --failOnDelete guard so a destructive apply is blocked
 *   (exit 6) for explicit approval, never silently destructive.
 *
 * Checking products (not "any deletion in the diff") avoids both an expensive
 * second configurator introspection and the unreliable job of deciding by name
 * which deletions are Saleor's stock defaults.
 * @planks("the recipe stage should pass `--failOnDelete` to `npx @saleor\/configurator@latest deploy`")
 */
export async function storeHoldsForeignCatalog(
  graphqlUrl: string,
  token: string,
  recipeProductSlugs: readonly string[],
): Promise<boolean> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query { products(first: 100) { edges { node { slug } } } }`,
  );
  const edges = ((data.products as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { slug: string } }>;
  const recipeSlugs = new Set(recipeProductSlugs);
  return edges.some((edge) => !recipeSlugs.has(edge.node.slug));
}

/**
 * Whether the store already holds every product the recipe declares — the
 * observable remote state a completed recipe deploy leaves behind. `jolly
 * start`'s resumable recipe stage reads it to detect already-completed work
 * (feature 022): a store holding the full declared catalog needs no
 * configurator re-deploy. An empty declared list never reads as satisfied.
 * @planks("`jolly start` runs to completion in an interactive terminal")
 */
export async function storeHoldsRecipeCatalog(
  graphqlUrl: string,
  token: string,
  recipeProductSlugs: readonly string[],
): Promise<boolean> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query { products(first: 100) { edges { node { slug } } } }`,
  );
  const edges = ((data.products as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { slug: string } }>;
  const present = new Set(edges.map((edge) => edge.node.slug));
  return (
    recipeProductSlugs.length > 0 &&
    recipeProductSlugs.every((slug) => present.has(slug))
  );
}

// ── Recipe stock seeding (feature 004 Rule "Recipe products need seeded stock")
//
// @saleor/configurator cannot make products buyable (its variant schema has no
// `stocks`/`trackInventory`), so `jolly start`'s stock stage seeds real stock
// itself via Saleor GraphQL — first-party host, the resolved store token
// (SALEOR_TOKEN). For every product variant it sets a default quantity in the recipe
// warehouse (resolved by slug) with `productVariantStocksCreate`, falling back
// to `productVariantStocksUpdate` when a stock entry already exists, so a
// re-run updates in place rather than creating a duplicate (idempotent —
// feature 022).

export const DEFAULT_STOCK_QUANTITY = 100;

/** A recipe collection and its declared member product slugs. */
export interface RecipeCollection {
  slug: string;
  name: string;
  channelSlug: string;
  products: string[];
}

/** The recipe identifiers the post-deploy stages need: the warehouse slug stock
 * seeds into, every declared product slug, and each collection's membership. */
export interface RecipeIdentifiers {
  warehouseSlug: string;
  productSlugs: string[];
  collections: RecipeCollection[];
}

/**
 * Derive the recipe identifiers from the shipped `assets/skills/jolly/recipe.yml`
 * asset at runtime, parsing the YAML so the warehouse slug, product slugs, and
 * collection memberships are the asset's own values rather than a built-in copy
 * that can drift from the deployed recipe (the recipe asset is the single
 * source). The `@saleor/configurator` deploy cannot populate collection
 * membership in one pass (collections precede products in its pipeline), so Jolly
 * assigns it after the deploy from the derived list; {@link storeHoldsForeignCatalog}
 * uses the derived product slugs to tell the recipe's own catalog apart from a
 * customer's; {@link seedRecipeStock} seeds stock into the derived warehouse.
 * @planks("^the cloud-api module derives the recipe identifiers from (?:that asset|it)$")
 * @planks("^the cloud-api module derives the recipe identifiers from (?:that asset|it)$")
 * @planks("the warehouse slug it uses should be {string}")
 * @planks("the product slugs it uses should be {string} and {string}")
 * @planks("the {string} collection it assigns should contain {string}")
 */
export function deriveRecipeIdentifiers(recipeYamlPath: string): RecipeIdentifiers {
  const recipe = parse(readFileSync(recipeYamlPath, "utf8")) as {
    warehouses: Array<{ slug: string }>;
    products: Array<{ slug: string }>;
    collections?: Array<{
      slug: string;
      name: string;
      products?: string[];
      channelListings?: Array<{ channelSlug: string }>;
    }>;
  };
  return {
    warehouseSlug: recipe.warehouses[0].slug,
    productSlugs: recipe.products.map((product) => product.slug),
    collections: (recipe.collections ?? []).map((collection) => ({
      slug: collection.slug,
      name: collection.name,
      channelSlug: collection.channelListings?.[0]?.channelSlug ?? "",
      products: collection.products ?? [],
    })),
  };
}

interface SeedStockResult {
  warehouseId: string;
  variantCount: number;
  seededCount: number;
  stockRequests: RequestInterval[];
}

/** One backend Saleor request's start and finish time in epoch milliseconds.
 * The stock stage reports these so its concurrency is observable directly
 * (feature 004 Rule "Concurrent stock and collection requests are observable in
 * the stage result"): a request whose reported start precedes another request's
 * reported finish ran concurrently with it. */
export interface RequestInterval {
  startedAt: number;
  finishedAt: number;
}

/** The recipe's many independent Saleor round-trips are issued through a bounded
 * worker pool, not one at a time and not an unbounded fan-out, so they overlap
 * while keeping the request rate within Saleor's limits (feature 004 Rule). */
const RECIPE_REQUEST_CONCURRENCY = 8;

/** Run `task` over `items` through a bounded worker pool, recording each item's
 * start and finish time so the caller can report the request timing. The first
 * poolful of requests start together and overlap, the observable seam the
 * concurrency scenario asserts against.
 * @planks("Jolly start runs the stock stage over the recipe's variants and collections")
 * @planks("the stock stage's reported request timing should show a later stock mutation starting before an earlier stock mutation finishes")
 */
async function runRecordedConcurrent<T>(
  items: readonly T[],
  task: (item: T) => Promise<void>,
): Promise<RequestInterval[]> {
  const intervals: RequestInterval[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const startedAt = Date.now();
      await task(items[index]);
      intervals.push({ startedAt, finishedAt: Date.now() });
    }
  };
  const workers = Array.from(
    { length: Math.min(RECIPE_REQUEST_CONCURRENCY, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return intervals;
}

/** Resolve the recipe warehouse id by slug; undefined when it does not exist.
 * @planks("every recipe product variant should have stock in the recipe warehouse")
 */
async function queryWarehouseId(
  graphqlUrl: string,
  token: string,
  slug: string,
): Promise<string | undefined> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query Warehouses { warehouses(first: 100) { edges { node { id slug } } } }`,
  );
  const warehouses = data.warehouses as Record<string, unknown> | undefined;
  const edges = (warehouses?.edges ?? []) as Array<Record<string, unknown>>;
  const match = edges
    .map((edge) => edge.node as { id: string; slug: string })
    .find((node) => node.slug === slug);
  return match?.id;
}

interface StockVariant {
  id: string;
  hasStockInWarehouse: boolean;
}

/** Query every product variant and whether it already has a stock entry in the
 * recipe warehouse (so seeding can pick create vs. update).
 * @planks("every recipe product variant should have stock in the recipe warehouse")
 */
async function queryVariantsForStock(
  graphqlUrl: string,
  token: string,
  warehouseSlug: string,
): Promise<StockVariant[]> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query VariantsForStock {
      productVariants(first: 100) {
        edges { node { id stocks { warehouse { slug } } } }
      }
    }`,
  );
  const variants = data.productVariants as Record<string, unknown> | undefined;
  const edges = (variants?.edges ?? []) as Array<Record<string, unknown>>;
  return edges.map((edge) => {
    const node = edge.node as {
      id: string;
      stocks?: Array<{ warehouse?: { slug?: string } }>;
    };
    const hasStockInWarehouse = (node.stocks ?? []).some(
      (stock) => stock.warehouse?.slug === warehouseSlug,
    );
    return { id: node.id, hasStockInWarehouse };
  });
}

/** Set a variant's stock in one warehouse, creating the entry or updating it in
 * place when it already exists. Primary: productVariantStocksCreate; on a
 * payload error (e.g. the entry already exists) falls back to
 * productVariantStocksUpdate for that warehouse/variant.
 * @planks("every recipe product variant should have stock in the recipe warehouse")
 * @planks("re-running the stage should update the quantities idempotently rather than creating duplicate stock")
 */
async function setVariantStock(
  graphqlUrl: string,
  token: string,
  variantId: string,
  warehouseId: string,
  quantity: number,
  preferUpdate: boolean,
): Promise<void> {
  const stocks = [{ warehouse: warehouseId, quantity }];

  const runCreate = async (): Promise<Array<Record<string, unknown>>> => {
    const data = await graphqlFetch(
      graphqlUrl,
      token,
      `mutation StocksCreate($variantId: ID!, $stocks: [StockInput!]!) {
        productVariantStocksCreate(variantId: $variantId, stocks: $stocks) {
          bulkStockErrors { code field index message }
          errors { code field message }
        }
      }`,
      { variantId, stocks },
    );
    const result = data.productVariantStocksCreate as Record<string, unknown> | undefined;
    return [
      ...((result?.bulkStockErrors ?? []) as Array<Record<string, unknown>>),
      ...((result?.errors ?? []) as Array<Record<string, unknown>>),
    ];
  };

  const runUpdate = async (): Promise<Array<Record<string, unknown>>> => {
    const data = await graphqlFetch(
      graphqlUrl,
      token,
      `mutation StocksUpdate($variantId: ID!, $stocks: [StockInput!]!) {
        productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
          bulkStockErrors { code field index message }
          errors { code field message }
        }
      }`,
      { variantId, stocks },
    );
    const result = data.productVariantStocksUpdate as Record<string, unknown> | undefined;
    return [
      ...((result?.bulkStockErrors ?? []) as Array<Record<string, unknown>>),
      ...((result?.errors ?? []) as Array<Record<string, unknown>>),
    ];
  };

  if (preferUpdate) {
    const updateErrors = await runUpdate();
    if (updateErrors.length === 0) return;
    // Fall through to create when the entry did not actually exist.
  }

  const createErrors = await runCreate();
  if (createErrors.length === 0) return;

  // The entry already exists (or create rejected it): update in place.
  const updateErrors = await runUpdate();
  if (updateErrors.length > 0) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.seedStock", {
        variantId,
        detail: JSON.stringify(updateErrors),
      }),
      "STOCK_SEED_FAILED",
    );
  }
}

/**
 * Seed the recipe warehouse stock for every product variant on the store.
 * Resolves the recipe warehouse by slug, then sets `quantity` for each variant
 * (create-or-update-in-place, idempotent). Throws RECIPE_WAREHOUSE_NOT_FOUND
 * when the warehouse is absent and NO_RECIPE_VARIANTS when the store holds no
 * variants — so the caller can report the stage honestly (blocked, not a
 * fabricated completion) instead of claiming success.
 * @planks("Jolly start completes the recipe stage")
 * @planks("every recipe product variant should have stock in the recipe warehouse")
 * @planks("Jolly start runs the stock stage over the recipe's variants and collections")
 * @planks("the stock stage's reported request timing should show a later stock mutation starting before an earlier stock mutation finishes")
 */
export async function seedRecipeStock(
  graphqlUrl: string,
  token: string,
  quantity: number = DEFAULT_STOCK_QUANTITY,
  warehouseSlug: string,
): Promise<SeedStockResult> {
  const warehouseId = await queryWarehouseId(graphqlUrl, token, warehouseSlug);
  if (!warehouseId) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.warehouseNotFound", { warehouseSlug }),
      "RECIPE_WAREHOUSE_NOT_FOUND",
    );
  }
  const variants = await queryVariantsForStock(graphqlUrl, token, warehouseSlug);
  if (variants.length === 0) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.noProductVariants"),
      "NO_RECIPE_VARIANTS",
    );
  }
  const stockRequests = await runRecordedConcurrent(variants, (variant) =>
    setVariantStock(
      graphqlUrl,
      token,
      variant.id,
      warehouseId,
      quantity,
      variant.hasStockInWarehouse,
    ),
  );
  return {
    warehouseId,
    variantCount: variants.length,
    seededCount: variants.length,
    stockRequests,
  };
}

/**
 * Create a recipe collection the configurator deploy left absent, published on
 * its declared channel, and return its id. Resolves the channel id by slug, runs
 * `collectionCreate` (name + slug), then `collectionChannelListingUpdate` to add
 * the channel as published so the storefront renders it. Only invoked when the
 * store read-back shows the slug missing, so it never duplicates an existing
 * collection. Throws COLLECTION_CREATE_FAILED on a payload error.
 * @planks("the recipe's `featured-products` collection should exist in the store holding its declared products")
 */
async function createRecipeCollection(
  graphqlUrl: string,
  token: string,
  collectionSlug: string,
  collectionName: string,
  channelSlug: string,
): Promise<{ id: string; slug: string }> {
  const createData = await graphqlFetch(
    graphqlUrl,
    token,
    `mutation CreateCollection($input: CollectionCreateInput!) {
      collectionCreate(input: $input) {
        collection { id slug }
        errors { code field message }
      }
    }`,
    { input: { name: collectionName, slug: collectionSlug } },
  );
  const createPayload = createData.collectionCreate as
    | { collection?: { id: string; slug: string }; errors?: Array<Record<string, unknown>> }
    | undefined;
  const createErrors = createPayload?.errors ?? [];
  if (createErrors.length > 0 || !createPayload?.collection) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.createCollection", {
        collectionSlug,
        detail: JSON.stringify(createErrors),
      }),
      "COLLECTION_CREATE_FAILED",
    );
  }
  const collection = createPayload.collection;

  const chanData = await graphqlFetch(
    graphqlUrl,
    token,
    `query { channels { id slug } }`,
  );
  const channels = (chanData.channels ?? []) as Array<{ id: string; slug: string }>;
  const channel = channels.find((c) => c.slug === channelSlug);
  if (channel) {
    const listData = await graphqlFetch(
      graphqlUrl,
      token,
      `mutation PublishCollection($id: ID!, $input: CollectionChannelListingUpdateInput!) {
        collectionChannelListingUpdate(id: $id, input: $input) {
          errors { code field message }
        }
      }`,
      {
        id: collection.id,
        input: { addChannels: [{ channelId: channel.id, isPublished: true }] },
      },
    );
    const listPayload = listData.collectionChannelListingUpdate as
      | { errors?: Array<Record<string, unknown>> }
      | undefined;
    const listErrors = listPayload?.errors ?? [];
    if (listErrors.length > 0) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.publishCollection", {
          collectionSlug,
          channelSlug,
          detail: JSON.stringify(listErrors),
        }),
        "COLLECTION_CREATE_FAILED",
      );
    }
  }

  return collection;
}

/**
 * Assign a recipe collection's declared products to it by slug, via GraphQL.
 * The `@saleor/configurator` deploy CANNOT populate a collection's membership in
 * one pass: its pipeline processes Collections (stage 7) BEFORE Products (stage
 * 10) and the product schema has no `collections` field, so a collection's
 * `products:` slugs reference products that do not exist yet and the collection
 * is created empty. The deploy also does not reliably leave the collection
 * itself behind, so Jolly reads the store back and CREATES the collection (with
 * its published channel listing) when it is absent before assigning members —
 * the same post-deploy fix-up reasoning Jolly applies to stock the configurator
 * cannot set. Resolves the collection and product ids by slug, then
 * `collectionAddProducts` (idempotent — re-adding a member is a no-op, and the
 * create runs only when the slug is absent, so a re-run reconciles cleanly).
 * Returns how many products were assigned; throws COLLECTION_ASSIGN_FAILED on a
 * payload error so the caller reports the stage honestly instead of a fabricated
 * completion.
 * @planks("the recipe's `featured-products` collection should exist in the store holding its declared products")
 */
export async function assignCollectionProducts(
  graphqlUrl: string,
  token: string,
  collectionSlug: string,
  collectionName: string,
  channelSlug: string,
  productSlugs: readonly string[],
): Promise<number> {
  const collData = await graphqlFetch(
    graphqlUrl,
    token,
    `query { collections(first: 100) { edges { node { id slug } } } }`,
  );
  const collEdges = ((collData.collections as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { id: string; slug: string } }>;
  const collection =
    collEdges.map((e) => e.node).find((n) => n.slug === collectionSlug) ??
    (await createRecipeCollection(
      graphqlUrl,
      token,
      collectionSlug,
      collectionName,
      channelSlug,
    ));

  const prodData = await graphqlFetch(
    graphqlUrl,
    token,
    `query { products(first: 100) { edges { node { id slug } } } }`,
  );
  const prodEdges = ((prodData.products as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { id: string; slug: string } }>;
  const idBySlug = new Map(prodEdges.map((e) => [e.node.slug, e.node.id]));
  const productIds = productSlugs
    .map((slug) => idBySlug.get(slug))
    .filter((id): id is string => Boolean(id));
  if (productIds.length === 0) return 0;

  const addData = await graphqlFetch(
    graphqlUrl,
    token,
    `mutation AddToCollection($collectionId: ID!, $products: [ID!]!) {
      collectionAddProducts(collectionId: $collectionId, products: $products) {
        collection { id }
        errors { code field message }
      }
    }`,
    { collectionId: collection.id, products: productIds },
  );
  const payload = addData.collectionAddProducts as
    | { errors?: Array<Record<string, unknown>> }
    | undefined;
  const errors = payload?.errors ?? [];
  if (errors.length > 0) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.assignProducts", {
        collectionSlug,
        detail: JSON.stringify(errors),
      }),
      "COLLECTION_ASSIGN_FAILED",
    );
  }
  return productIds.length;
}

/** Add one product to a collection via `collectionAddProducts`; idempotent, a
 * member already present is a no-op. Throws COLLECTION_ASSIGN_FAILED on a payload
 * error so the caller reports the stage honestly.
 * @planks("the recipe's `featured-products` collection should exist in the store holding its declared products")
 * @planks("the stock stage's reported request timing should show a later collection assignment starting before an earlier collection assignment finishes")
 */
async function addProductToCollection(
  graphqlUrl: string,
  token: string,
  collectionId: string,
  productId: string,
): Promise<void> {
  const addData = await graphqlFetch(
    graphqlUrl,
    token,
    `mutation AddToCollection($collectionId: ID!, $products: [ID!]!) {
      collectionAddProducts(collectionId: $collectionId, products: $products) {
        collection { id }
        errors { code field message }
      }
    }`,
    { collectionId, products: [productId] },
  );
  const payload = addData.collectionAddProducts as
    | { errors?: Array<Record<string, unknown>> }
    | undefined;
  const errors = payload?.errors ?? [];
  if (errors.length > 0) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.assignProduct", {
        productId,
        collectionId,
        detail: JSON.stringify(errors),
      }),
      "COLLECTION_ASSIGN_FAILED",
    );
  }
}

/**
 * Assign the recipe's declared collection memberships concurrently, one
 * `collectionAddProducts` request per (collection, product) pair, and report each
 * request's start and finish time (feature 004 Rule "Concurrent stock and
 * collection requests are observable in the stage result"). The recipe stage
 * already created and populated the collections, so this resolves the existing
 * collection and product ids by slug and re-adds members idempotently; a
 * collection or product the store does not hold contributes no request. Returns
 * how many memberships were re-asserted plus each request's timing interval.
 * @planks("Jolly start runs the stock stage over the recipe's variants and collections")
 * @planks("the stock stage's reported request timing should show a later collection assignment starting before an earlier collection assignment finishes")
 */
export async function assignRecipeCollectionsConcurrent(
  graphqlUrl: string,
  token: string,
  collections: readonly RecipeCollection[],
): Promise<{ assignedCount: number; collectionRequests: RequestInterval[] }> {
  const collData = await graphqlFetch(
    graphqlUrl,
    token,
    `query { collections(first: 100) { edges { node { id slug } } } }`,
  );
  const collEdges = ((collData.collections as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { id: string; slug: string } }>;
  const collectionIdBySlug = new Map(collEdges.map((e) => [e.node.slug, e.node.id]));

  const prodData = await graphqlFetch(
    graphqlUrl,
    token,
    `query { products(first: 100) { edges { node { id slug } } } }`,
  );
  const prodEdges = ((prodData.products as { edges?: unknown } | undefined)?.edges ??
    []) as Array<{ node: { id: string; slug: string } }>;
  const productIdBySlug = new Map(prodEdges.map((e) => [e.node.slug, e.node.id]));

  const targets: Array<{ collectionId: string; productId: string }> = [];
  for (const collection of collections) {
    const collectionId = collectionIdBySlug.get(collection.slug);
    if (!collectionId) continue;
    for (const productSlug of collection.products) {
      const productId = productIdBySlug.get(productSlug);
      if (productId) targets.push({ collectionId, productId });
    }
  }

  const collectionRequests = await runRecordedConcurrent(targets, (target) =>
    addProductToCollection(graphqlUrl, token, target.collectionId, target.productId),
  );
  return { assignedCount: targets.length, collectionRequests };
}

// ── Stripe app install (feature 005 Rule "`jolly start` Stripe stage") ─────
//
// The Stripe app INSTALL is the second genuinely-executing `jolly start` stage:
// Jolly's own Saleor GraphQL `appInstall(manifestUrl, appName, permissions:
// [HANDLE_PAYMENTS])` against the customer's `*.saleor.cloud` GraphQL endpoint,
// authenticated with the Cloud STAFF token (`JOLLY_SALEOR_CLOUD_TOKEN`) — an app
// token cannot (PermissionDenied). Idempotent (feature 022): a Stripe app that
// is already installed is reused rather than installing a duplicate. The keys +
// `us`-channel mapping have no stable public API and stay a guided human gate.

export const STRIPE_APP_MANIFEST_URL =
  "https://stripe-v2.saleor.app/api/manifest";
export const STRIPE_APP_NAME = "Stripe";

export interface InstallStripeAppResult {
  /** Whether an existing Stripe app was reused rather than newly installed. */
  reused: boolean;
}

/**
 * Install the Saleor Stripe app via GraphQL `appInstall`, authenticated with the
 * Cloud staff token. Idempotent: first lists installed apps and reuses any whose
 * name matches /stripe/i instead of installing a duplicate. Surfaces GraphQL/
 * payload errors as CloudApiError with a stable code. Fails fast against an
 * unroutable endpoint (the underlying fetch rejects rather than hanging).
 * @planks("`jolly stripe` runs the Stripe app-install stage against that store")
 * @planks("it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest")
 */
export async function installStripeApp(
  graphqlUrl: string,
  cloudToken: string,
  manifestUrl: string = STRIPE_APP_MANIFEST_URL,
  appName: string = STRIPE_APP_NAME,
): Promise<InstallStripeAppResult> {
  // Retry the GetApps idempotency query on transient failures (e.g. a momentary
  // HTTP 429 rate-limit): a transient rate-limit must not degrade an
  // already-installed Stripe app to a false blocked stage.
  const apps = await withRetries(() => queryGetApps(graphqlUrl, cloudToken));
  const existing = apps.find((app) => /stripe/i.test(app.name ?? ""));
  if (existing) {
    return { reused: true };
  }

  const data = await graphqlFetch(
    graphqlUrl,
    cloudToken,
    `mutation AppInstall($input: AppInstallInput!) {
      appInstall(input: $input) {
        appInstallation { id status }
        errors { field message code }
      }
    }`,
    {
      input: {
        appName,
        manifestUrl,
        permissions: ["HANDLE_PAYMENTS"],
      },
    },
  );
  const result = data.appInstall as Record<string, unknown> | undefined;
  const errors = (result?.errors ?? []) as Array<Record<string, unknown>>;
  if (errors.length > 0) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.appInstall", {
        detail: errors.map((e) => e.message).join("; "),
      }),
      "STRIPE_APP_INSTALL_FAILED",
    );
  }
  const installation = result?.appInstallation as Record<string, unknown> | undefined;
  if (!installation) {
    throw new CloudApiError(
      cliMessage("cloudApi.error.appInstallNoInstallation"),
      "STRIPE_APP_INSTALL_FAILED",
    );
  }
  // appInstall enqueues an async installation: the returned appInstallation
  // starts PENDING and a Saleor worker fetches the manifest and creates the App,
  // so the app appears in `apps` only once the job reaches SUCCESS. Gate on that
  // readiness — poll until the Stripe app is present, and fail fast if the
  // installation reports FAILED — so the stage reports completed only once the
  // app is genuinely installed.
  await waitForStripeAppInstalled(
    graphqlUrl,
    cloudToken,
    String(installation.id),
  );
  return { reused: false };
}

/**
 * Poll until the just-enqueued Stripe app installation observably completes: the
 * Stripe app is present in `apps`. Fail fast on a FAILED installation, and fail
 * with the last observed state when the deadline passes.
 * @planks("`jolly stripe` runs the Stripe app-install stage against that store")
 * @planks("it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest")
 */
async function waitForStripeAppInstalled(
  graphqlUrl: string,
  cloudToken: string,
  installationId: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const apps = await queryGetApps(graphqlUrl, cloudToken);
    if (apps.some((app) => /stripe/i.test(app.name ?? ""))) {
      return;
    }
    const data = await graphqlFetch(
      graphqlUrl,
      cloudToken,
      `query { appsInstallations { id status message } }`,
    );
    const installations = (data.appsInstallations ?? []) as Array<
      Record<string, unknown>
    >;
    const current = installations.find((i) => i.id === installationId);
    if (current && current.status === "FAILED") {
      throw new CloudApiError(
        cliMessage("cloudApi.error.stripeAppInstall", {
          detail: String(current.message ?? "unknown error"),
        }),
        "STRIPE_APP_INSTALL_FAILED",
      );
    }
    if (Date.now() >= deadline) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.stripeAppInstallTimeout", {
          status: String(current?.status ?? "unknown"),
        }),
        "STRIPE_APP_INSTALL_FAILED",
      );
    }
    await sleep(3_000);
  }
}

// ── Checkout-readiness probe (feature 005 Rule "Checkout-readiness verify probe")
//
// Installing the Stripe app and completing the keys + `us`-channel Dashboard gate
// are necessary but NOT self-verifying — there is no public read for the app's
// channel-config mapping. The authoritative signal is whether a real `us`
// checkout is actually offered the Stripe payment gateway. This probe creates a
// minimal `us` test checkout, inspects availablePaymentGateways, then reverts
// (deletes) the checkout (feature 023 harmless: test mode only, captures no
// payment). It fails fast against an unroutable endpoint via an AbortController
// timeout so the probe never hangs.

const CHECKOUT_PROBE_TIMEOUT_MS = 5_000;

export type CheckoutProbeOutcome =
  | { kind: "stripe-offered" }
  | { kind: "not-offered" }
  | { kind: "unreachable" }
  | { kind: "no-variants" }
  | { kind: "no-checkout" };

/** A single timed GraphQL request that fails fast (AbortController) rather than
 * hanging against an unroutable endpoint. Applies the first-party pre-flight
 * (feature 020 Rule "First-party hosts only") before sending, so every live
 * store probe refuses a non-first-party endpoint unsent. Returns the parsed
 * body or throws.
 * @planks("a checkout-readiness check should be reported in the stripe group")
 * @planks("each should reach the network only through a seam that applies the first-party host predicate before sending")
 * @planks("no request should be sent to evil.example.com")
 */
async function timedGraphql(
  graphqlUrl: string,
  token: string | undefined,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertFirstPartyUrl(graphqlUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECKOUT_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 400) {
      throw new CloudApiError(
        cliMessage("cloudApi.error.graphqlHttp", { status: response.status }),
        "GRAPHQL_HTTP_ERROR",
        response.status,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe whether a `us` checkout is offered the Stripe payment gateway. Creates a
 * minimal `us` checkout with the first product variant, reads
 * availablePaymentGateways, then deletes the checkout (harmless, reverted). Maps
 * every failure mode (no variants, no checkout, unreachable/timed-out endpoint)
 * to a non-throwing outcome so the caller never reports a fabricated pass.
 * @planks("`jolly doctor` probes checkout payment readiness")
 * @planks("the checkout-readiness check should pass only when the Stripe gateway is offered for that checkout")
 */
export async function probeCheckoutPaymentGateway(
  graphqlUrl: string,
  token: string | undefined,
): Promise<CheckoutProbeOutcome> {
  try {
    const variantData = await timedGraphql(
      graphqlUrl,
      token,
      `query { productVariants(first: 1) { edges { node { id } } } }`,
    );
    const variants = (variantData.data as Record<string, unknown> | undefined)
      ?.productVariants as { edges?: Array<{ node?: { id?: string } }> } | undefined;
    const variantId = variants?.edges?.[0]?.node?.id;
    if (!variantId) return { kind: "no-variants" };

    const checkoutData = await timedGraphql(
      graphqlUrl,
      token,
      `mutation($channel: String!, $variantId: ID!) {
         checkoutCreate(input: { channel: $channel, lines: [{ quantity: 1, variantId: $variantId }] }) {
           checkout { id availablePaymentGateways { id name } }
           errors { code }
         }
       }`,
      { channel: "us", variantId },
    );
    const payload = (checkoutData.data as Record<string, unknown> | undefined)
      ?.checkoutCreate as
      | {
          checkout?: {
            id: string;
            availablePaymentGateways?: Array<{ id: string; name: string | null }>;
          };
        }
      | undefined;
    const checkout = payload?.checkout;
    if (!checkout) return { kind: "no-checkout" };

    // Revert: delete the test checkout (capture no payment — feature 023).
    try {
      await timedGraphql(
        graphqlUrl,
        token,
        `mutation($id: ID!) { checkoutDelete(id: $id) { errors { code } } }`,
        { id: checkout.id },
      );
    } catch {
      // Best-effort teardown; do not let a delete failure mask the verdict.
    }

    const gateways = checkout.availablePaymentGateways ?? [];
    const offered = gateways.some(
      (g) => /stripe/i.test(g.id) || /stripe/i.test(g.name ?? ""),
    );
    return offered ? { kind: "stripe-offered" } : { kind: "not-offered" };
  } catch {
    // Network error, timeout (unroutable endpoint), or GraphQL HTTP failure —
    // the store could not be reached. Never a pass.
    return { kind: "unreachable" };
  }
}

export type ChannelPurchasabilityOutcome =
  | { kind: "purchasable"; count: number }
  | { kind: "none-purchasable" }
  | { kind: "unreachable" }
  | { kind: "refused"; host: string };

/**
 * The hostname of `url` when it is outside the first-party allowlist, or the
 * raw `url` when it cannot be parsed; undefined when the host is first-party.
 * Doctor's live store probes consult this pre-flight (feature 020 Rule
 * "First-party hosts only") so a non-first-party endpoint is refused unsent
 * and the refusal names the host.
 * @planks("no request should be sent to evil.example.com")
 * @planks("the refusal should name the non-first-party host evil.example.com")
 */
function refusedNonFirstPartyHost(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  return isFirstPartyHost(host) ? undefined : host;
}

/**
 * Probe whether a channel offers products available for purchase (feature 014 —
 * the `us`-channel purchasability check). Read-only: queries the channel's
 * products and counts those with `isAvailableForPurchase`. A channel whose
 * products lack a channel listing / availability sells nothing — a silent
 * checkout failure this surfaces so the agent can add the listings with the
 * configurator. Returns `unreachable` (never a fabricated pass) on any
 * network/GraphQL failure or when the query did not return a products list.
 * Returns `refused` with the host, sending nothing, when the endpoint is not
 * first-party (feature 020 Rule "First-party hosts only").
 * @planks("`jolly doctor` checks the saleor group")
 * @planks("it should report a `us`-channel purchasability check with a concrete status from a real store query")
 * @planks(`the `us-channel-purchasable` and `checkout-payment-gateway` checks should each report a non-pass status`)
 * @planks("no request should be sent to evil.example.com")
 */
export async function probeChannelPurchasability(
  graphqlUrl: string,
  token: string | undefined,
  channelSlug: string,
): Promise<ChannelPurchasabilityOutcome> {
  const refusedHost = refusedNonFirstPartyHost(graphqlUrl);
  if (refusedHost !== undefined) return { kind: "refused", host: refusedHost };
  try {
    const result = await timedGraphql(
      graphqlUrl,
      token,
      `query($channel: String!) {
         products(first: 20, channel: $channel) {
           edges { node { id isAvailableForPurchase } }
         }
       }`,
      { channel: channelSlug },
    );
    const products = (result.data as Record<string, unknown> | undefined)?.products as
      | { edges?: Array<{ node?: { isAvailableForPurchase?: boolean } }> }
      | undefined;
    // A failed query (bad token, GraphQL error) returns no products list — that is
    // "could not verify" (unreachable), NOT a false "none-purchasable" warning.
    if (!products || !Array.isArray(products.edges)) return { kind: "unreachable" };
    const count = products.edges.filter((e) => e.node?.isAvailableForPurchase === true).length;
    return count > 0 ? { kind: "purchasable", count } : { kind: "none-purchasable" };
  } catch {
    return { kind: "unreachable" };
  }
}

// ── Endpoint connectivity probe (feature 002 — `jolly doctor saleor`) ──────
//
// `doctor`'s `saleor-endpoint` check must report a real, READ-ONLY live
// connectivity verdict, not just presence. This sends a minimal introspection
// query (no token, no mutation, no write) through the same fail-fast machinery
// as the checkout probe, guarded first by the first-party-host check so a
// non-first-party `--url` resolves to a non-pass status rather than throwing.

export type EndpointProbeOutcome =
  | { kind: "reachable" }
  | { kind: "unreachable" }
  | { kind: "refused"; host: string };

/**
 * Probe whether `graphqlUrl` is reachable and responds as a GraphQL endpoint,
 * using a tiny read-only introspection query (`query { __typename }`). Returns
 * `reachable` when the endpoint answers as GraphQL; `refused` with the host,
 * sending nothing, when the endpoint is not first-party or the URL is
 * unparseable (feature 020 Rule "First-party hosts only"); `unreachable` for
 * any other outcome (network error, timeout, or a non-GraphQL response).
 * Never throws and never mutates.
 * @planks("`jolly doctor` checks Saleor")
 * @planks("it should validate GraphQL connectivity")
 * @planks("no request should be sent to evil.example.com")
 * @planks("the refusal should name the non-first-party host evil.example.com")
 */
export async function probeEndpointConnectivity(
  graphqlUrl: string,
): Promise<EndpointProbeOutcome> {
  const refusedHost = refusedNonFirstPartyHost(graphqlUrl);
  if (refusedHost !== undefined) return { kind: "refused", host: refusedHost };
  try {
    const body = await timedGraphql(graphqlUrl, undefined, `query { __typename }`);
    const data = body.data as Record<string, unknown> | undefined;
    if (data && typeof data.__typename === "string") {
      return { kind: "reachable" };
    }
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

/** Retry a transient rate-limited or unavailable Saleor request toward a bounded
 * deadline, so a 429 never reports a false blocked.
 * @planks("the stock stage should be reported completed, having retried the rate-limited request")
 */
async function withRetries<T>(
  fn: () => Promise<T>,
  attempts: number = 5,
  delayMs: number = 5_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
