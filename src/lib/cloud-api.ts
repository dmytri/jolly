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
//
// App token acquisition follows the deprecated CLI's example flow (reference
// material only, feature 012): authenticate to the instance's GraphQL API
// with the Cloud token (Bearer), select an existing local app or create one,
// and create an app token via the Saleor GraphQL API.

const DEFAULT_CLOUD_API_BASE = "https://cloud.saleor.io/platform/api";

/**
 * The Cloud API base URL for this request: the JOLLY_SALEOR_CLOUD_API_URL
 * override when set (feature 018 Rule — pointing it elsewhere is the
 * customer's explicit choice), otherwise the first-party default.
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

/** Error from the Cloud API with a stable, branchable code. */
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

async function cloudFetch(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  return await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
}

// ── Organizations ────────────────────────────────────────────────────────

export interface CloudOrganization {
  slug: string;
  name?: string;
  [key: string]: unknown;
}

/** GET /platform/api/organizations/ */
export async function listOrganizations(
  token: string,
): Promise<CloudOrganization[]> {
  const response = await cloudFetch(`${cloudApiBase()}/organizations/`, token);
  if (!response.ok) {
    throw new CloudApiError(
      `Failed to list organizations: HTTP ${response.status} ${await response.text()}`,
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

/** GET /platform/api/organizations/{slug}/projects/ */
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
      `Failed to list projects: HTTP ${response.status} ${await response.text()}`,
      "CLOUD_API_ERROR",
      response.status,
    );
  }
  return (await response.json()) as CloudProject[];
}

/** POST /platform/api/organizations/{slug}/projects/ with { name, plan, region }. */
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
      `Failed to create project: HTTP ${response.status} ${await response.text()}`,
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

/** GET /platform/api/organizations/{org}/projects/{project}/services/ */
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

/**
 * POST /platform/api/organizations/{slug}/environments/ — returns the
 * environment (with task_id for async provisioning). A rejection caused by
 * the organization's sandbox environment limit surfaces as a CloudApiError
 * with the stable code ENVIRONMENT_LIMIT_REACHED (feature 012 Rule).
 */
export async function createEnvironment(
  token: string,
  organizationSlug: string,
  body: {
    name: string;
    project: string;
    domain_label: string;
    database_population: string | null;
    service: string;
    region: string;
  },
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
        `The Cloud API rejected the environment creation: the domain label ` +
          `"${body.domain_label}" is already taken (HTTP ${response.status}).`,
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
        "The organization's sandbox environment limit is reached. " +
          "Delete an unused environment or upgrade the plan, then re-run " +
          "`jolly create store --create-environment`.",
        "ENVIRONMENT_LIMIT_REACHED",
        response.status,
      );
    }
    throw new CloudApiError(
      `Failed to create environment: HTTP ${response.status} ${text}`,
      "ENVIRONMENT_CREATE_FAILED",
      response.status,
    );
  }
  return (await response.json()) as CloudEnvironment;
}

/** GET /platform/api/organizations/{slug}/environments/ */
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

/** GET /platform/api/organizations/{slug}/environments/{key}/ */
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

/** The poll URL for a task: GET /platform/api/service/task-status/{task_id}. */
export function taskStatusUrl(taskId: string): string {
  return `${cloudApiBase()}/service/task-status/${taskId}/`;
}

/**
 * Poll GET /platform/api/service/task-status/{task_id} until status is
 * "SUCCEEDED". Throws on FAILED or on timeout. Returns the final task body
 * so the caller can extract the resulting domain from the task result.
 *
 * Verified against the live Cloud API: the task id is the full job name
 * from the creation response, and the endpoint is anonymous — sending the
 * Cloud `Authorization: Token` header makes the service try (and fail) to
 * decode it as a JWT, returning 401 "Error decoding signature".
 */
export async function pollTaskStatus(
  taskId: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<TaskStatus> {
  const deadline = Date.now() + timeoutMs;
  const url = taskStatusUrl(taskId);
  for (;;) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new CloudApiError(
        `Task status check failed: HTTP ${response.status} ${await response.text()}`,
        "TASK_STATUS_FAILED",
        response.status,
      );
    }
    const task = (await response.json()) as TaskStatus;
    const status = String(task.status ?? "").toUpperCase();
    if (status === "SUCCEEDED") return task;
    if (status === "FAILED" || status === "ERROR") {
      throw new CloudApiError(
        `Environment provisioning task ${taskId} failed: ${JSON.stringify(task)}`,
        "TASK_FAILED",
      );
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw new CloudApiError(
        `Environment provisioning task ${taskId} did not reach SUCCEEDED within ${Math.round(timeoutMs / 1000)}s (last status: ${status || "unknown"})`,
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

// ── Instance GraphQL: app token acquisition ──────────────────────────────

async function graphqlFetch(
  graphqlUrl: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  if (!response.ok) {
    throw new CloudApiError(
      `GraphQL request to the Saleor instance failed: HTTP ${response.status}`,
      "GRAPHQL_HTTP_ERROR",
      response.status,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (body.errors) {
    throw new CloudApiError(
      `GraphQL errors: ${JSON.stringify(body.errors)}`,
      "GRAPHQL_ERROR",
    );
  }
  return (body.data ?? {}) as Record<string, unknown>;
}

/** query GetApps { apps(first: 100) { edges { node { id name } } } } */
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

/** All PermissionEnum values supported by the instance. */
async function queryPermissionEnum(
  graphqlUrl: string,
  token: string,
): Promise<string[]> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `query { __type(name: "PermissionEnum") { enumValues { name } } }`,
  );
  const type = data.__type as Record<string, unknown> | undefined;
  const values = (type?.enumValues ?? []) as Array<Record<string, unknown>>;
  return values.map((value) => String(value.name));
}

/** mutation appTokenCreate — create a token for an existing local app. */
export async function createAppToken(
  graphqlUrl: string,
  token: string,
  appId: string,
): Promise<{ authToken: string }> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `mutation AppTokenCreate($app: ID!) {
      appTokenCreate(input: { app: $app }) {
        authToken
        errors { field message }
      }
    }`,
    { app: appId },
  );
  const result = data.appTokenCreate as Record<string, unknown> | undefined;
  const errors = (result?.errors ?? []) as Array<Record<string, unknown>>;
  if (errors.length > 0) {
    throw new CloudApiError(
      `appTokenCreate failed: ${errors.map((e) => e.message).join("; ")}`,
      "APP_TOKEN_CREATE_FAILED",
    );
  }
  const authToken = result?.authToken;
  if (typeof authToken !== "string" || authToken.length === 0) {
    throw new CloudApiError(
      "appTokenCreate did not return an authToken",
      "APP_TOKEN_CREATE_FAILED",
    );
  }
  return { authToken };
}

/** mutation appCreate — create a local app; returns its auth token directly. */
export async function createLocalApp(
  graphqlUrl: string,
  token: string,
  name: string,
  permissions: string[],
): Promise<{ appId: string; authToken: string }> {
  const data = await graphqlFetch(
    graphqlUrl,
    token,
    `mutation AppCreate($input: AppInput!) {
      appCreate(input: $input) {
        authToken
        app { id name }
        errors { field message }
      }
    }`,
    { input: { name, permissions } },
  );
  const result = data.appCreate as Record<string, unknown> | undefined;
  const errors = (result?.errors ?? []) as Array<Record<string, unknown>>;
  if (errors.length > 0) {
    throw new CloudApiError(
      `appCreate failed: ${errors.map((e) => e.message).join("; ")}`,
      "APP_CREATE_FAILED",
    );
  }
  const app = result?.app as Record<string, unknown> | undefined;
  const authToken = result?.authToken;
  if (typeof authToken !== "string" || authToken.length === 0) {
    throw new CloudApiError(
      "appCreate did not return an authToken",
      "APP_CREATE_FAILED",
    );
  }
  return { appId: String(app?.id ?? ""), authToken };
}

/**
 * Acquire the workflow app token from a dedicated app Jolly owns, named
 * `appName` (the caller passes "Jolly Setup"). Looks for an existing app whose
 * name exactly matches: if found, mints a fresh token for that app via
 * appTokenCreate (idempotent — no duplicate app); if absent, creates the
 * dedicated app with the full v1 permission set via appCreate, which returns
 * its token directly. Jolly never mints a token for an unrelated pre-existing
 * app. Retries the GetApps query on transient failures: a freshly provisioned
 * environment can take a moment to serve GraphQL.
 */
export async function acquireAppToken(
  graphqlUrl: string,
  token: string,
  appName: string,
): Promise<string> {
  const apps = await withRetries(() => queryGetApps(graphqlUrl, token));
  const existing = apps.find((app) => app.name === appName);
  if (existing) {
    const { authToken } = await createAppToken(graphqlUrl, token, existing.id);
    return authToken;
  }
  const permissions = await queryPermissionEnum(graphqlUrl, token);
  const { authToken } = await createLocalApp(
    graphqlUrl,
    token,
    appName,
    permissions,
  );
  return authToken;
}

// ── Recipe stock seeding (feature 004 Rule "Recipe products need seeded stock")
//
// @saleor/configurator cannot make products buyable (its variant schema has no
// `stocks`/`trackInventory`), so `jolly start`'s stock stage seeds real stock
// itself via Saleor GraphQL — first-party host, the app token Jolly already
// manages. For every product variant it sets a default quantity in the recipe
// warehouse (resolved by slug) with `productVariantStocksCreate`, falling back
// to `productVariantStocksUpdate` when a stock entry already exists, so a
// re-run updates in place rather than creating a duplicate (idempotent —
// feature 022).

export const RECIPE_WAREHOUSE_SLUG = "port-royal";
export const DEFAULT_STOCK_QUANTITY = 100;

interface SeedStockResult {
  warehouseId: string;
  variantCount: number;
  seededCount: number;
}

/** Resolve the recipe warehouse id by slug; undefined when it does not exist. */
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
 * recipe warehouse (so seeding can pick create vs. update). */
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
 * productVariantStocksUpdate for that warehouse/variant. */
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
      `Failed to seed stock for variant ${variantId}: ${JSON.stringify(updateErrors)}`,
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
 */
export async function seedRecipeStock(
  graphqlUrl: string,
  token: string,
  quantity: number = DEFAULT_STOCK_QUANTITY,
  warehouseSlug: string = RECIPE_WAREHOUSE_SLUG,
): Promise<SeedStockResult> {
  const warehouseId = await queryWarehouseId(graphqlUrl, token, warehouseSlug);
  if (!warehouseId) {
    throw new CloudApiError(
      `Recipe warehouse "${warehouseSlug}" not found; the starter recipe is not deployed`,
      "RECIPE_WAREHOUSE_NOT_FOUND",
    );
  }
  const variants = await queryVariantsForStock(graphqlUrl, token, warehouseSlug);
  if (variants.length === 0) {
    throw new CloudApiError(
      "No product variants found; the starter recipe is not deployed",
      "NO_RECIPE_VARIANTS",
    );
  }
  for (const variant of variants) {
    await setVariantStock(
      graphqlUrl,
      token,
      variant.id,
      warehouseId,
      quantity,
      variant.hasStockInWarehouse,
    );
  }
  return {
    warehouseId,
    variantCount: variants.length,
    seededCount: variants.length,
  };
}

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
