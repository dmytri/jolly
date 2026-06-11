// Real Cloud API client for Saleor Cloud (feature 012, feature 024).
//
// The Cloud API is at https://cloud.saleor.io/platform/api.
// Authenticate with `Authorization: Token <token>`.
//
// Environment creation: POST /platform/api/organizations/{orgSlug}/environments/
// Returns the environment with `task_id` for async provisioning and `domain`
// for the resulting domain.
//
// Task tracking: check the environment's `tasks/` endpoint for async status.
//
// App token creation uses the instance's own GraphQL API:
//   POST /graphql/ — GetApps query, appTokenCreate mutation.
//   Auth: Authorization: Bearer <cloud-token>

const CLOUD_API_BASE = "https://cloud.saleor.io/platform/api";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max

/** Fetch wrapper for Cloud API calls. */
async function cloudFetch(
  url: string,
  options: RequestInit = {},
  token: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  return await fetch(url, { ...options, headers });
}

/** Fetch wrapper for GraphQL calls (uses Bearer auth with Cloud token). */
async function graphqlFetch(
  url: string,
  query: string,
  token: string,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(
      `GraphQL request failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (body.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

/** Interface for available services in a project. */
export interface ProjectService {
  name: string;
  display_name: string;
  version: string;
  region: string;
  service_type: string;
}

/**
 * Fetch all organizations accessible with the given token.
 * GET /platform/api/organizations/
 */
export async function listOrganizations(
  token: string,
): Promise<Record<string, unknown>[]> {
  const response = await cloudFetch(
    `${CLOUD_API_BASE}/organizations/`,
    { method: "GET" },
    token,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to list organizations: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as Record<string, unknown>[];
}

/**
 * Create a project within an organization.
 * POST /platform/api/organizations/{orgSlug}/projects/
 */
export async function createProject(
  orgSlug: string,
  body: { name: string; plan: string; region: string },
  token: string,
): Promise<Record<string, unknown>> {
  const response = await cloudFetch(
    `${CLOUD_API_BASE}/organizations/${orgSlug}/projects/`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create project: ${response.status} ${text}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * List projects for an organization.
 * GET /platform/api/organizations/{orgSlug}/projects/
 */
export async function listProjects(
  orgSlug: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  const response = await cloudFetch(
    `${CLOUD_API_BASE}/organizations/${orgSlug}/projects/`,
    { method: "GET" },
    token,
  );
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as Record<string, unknown>[];
}

/**
 * Get available services for a project.
 * GET /platform/api/organizations/{orgSlug}/projects/{projectSlug}/services/
 */
export async function listProjectServices(
  orgSlug: string,
  projectSlug: string,
  token: string,
): Promise<ProjectService[]> {
  const response = await cloudFetch(
    `${CLOUD_API_BASE}/organizations/${orgSlug}/projects/${projectSlug}/services/`,
    { method: "GET" },
    token,
  );
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as ProjectService[];
}

/**
 * Create a Saleor Cloud environment.
 * POST /platform/api/organizations/{orgSlug}/environments/
 *
 * Returns the environment object with task_id for async provisioning.
 * On domain collision, throws with code "DOMAIN_COLLISION".
 */
export async function createEnvironment(
  orgSlug: string,
  body: {
    name: string;
    project: string;
    domain_label: string;
    database_population: string;
    service: string;
    region: string;
  },
  token: string,
): Promise<Record<string, unknown>> {
  const response = await cloudFetch(
    `${CLOUD_API_BASE}/organizations/${orgSlug}/environments/`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
  if (!response.ok) {
    const text = await response.text();
    if (
      response.status === 400 &&
      text.includes("environment with this domain label already exists")
    ) {
      throw Object.assign(
        new Error("environment with this domain label already exists"),
        {
          code: "DOMAIN_COLLISION",
          statusCode: 400,
          domainLabel: body.domain_label,
        },
      );
    }
    throw new Error(`Failed to create environment: ${response.status} ${text}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Poll the environment creation task until it succeeds or fails.
 * The environment's tasks endpoint returns task statuses.
 * GET {environmentTasksUrl}
 */
export async function pollEnvironmentTasks(
  tasksUrl: string,
  token: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await cloudFetch(tasksUrl, { method: "GET" }, token);
    if (!response.ok) {
      throw new Error(
        `Task status check failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    const results = body.results as Array<Record<string, unknown>> | undefined;
    if (!results || results.length === 0) {
      return; // No tasks means done
    }
    const latestTask = results[results.length - 1];
    const status = (latestTask.status as string) ?? "";
    if (status === "SUCCEEDED" || status === "SUCCESS") {
      return;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(
        `Environment creation task failed: ${JSON.stringify(latestTask)}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Environment creation did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
  );
}

/**
 * Run the full end-to-end environment creation flow.
 *
 * Steps:
 * 1. Discover organization from Cloud API
 * 2. List existing projects
 * 3. Create project if none exist
 * 4. Discover available services for the project
 * 5. Create environment with the discovered service
 * 6. Poll environment tasks until complete
 * 7. Extract domain URL
 */
export async function createEnvironmentFullFlow(
  cloudToken: string,
): Promise<{
  organizationSlug: string;
  projectName: string;
  projectSlug: string;
  environmentName: string;
  taskId: string;
  domainUrl: string;
  environmentResponse: Record<string, unknown>;
}> {
  // 1. Discover organization
  const orgs = await listOrganizations(cloudToken);
  if (orgs.length === 0) {
    throw new Error("No organizations found in Saleor Cloud account");
  }
  const org = orgs[0];
  const orgSlug = org.slug as string;
  if (!orgSlug) {
    throw new Error(
      `Organization missing slug: ${JSON.stringify(orgs[0])}`,
    );
  }

  // 2. List existing projects
  const existingProjects = await listProjects(orgSlug, cloudToken);
  let projectSlug: string;
  let projectName: string;

  // 3. Use existing project or create a new one
  if (existingProjects.length > 0) {
    const existing = existingProjects[0];
    projectSlug = (existing.slug as string) ?? (existing.name as string);
    projectName = (existing.name as string) ?? projectSlug;
  } else {
    const ts = Date.now().toString(36);
    projectName = `jolly-project-${ts}`;
    const created = await createProject(
      orgSlug,
      { name: projectName, plan: "dev", region: "us-east-1" },
      cloudToken,
    );
    projectSlug = projectName; // project slug matches name for new projects
  }

  // 4. Discover available services
  const services = await listProjectServices(orgSlug, projectSlug, cloudToken);
  if (services.length === 0) {
    throw new Error(
      `No available services found for project "${projectSlug}". Check that the project has services configured.`,
    );
  }

  // Pick the first sandbox/preferred service
  const service = services[0].name;

  // 5. Create environment
  const ts = Date.now().toString(36);
  const environmentName = `jolly-env-${ts}`;
  const domainLabel = `jolly-${ts}`.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const envResponse = await createEnvironment(
    orgSlug,
    {
      name: environmentName,
      project: projectSlug,
      domain_label: domainLabel,
      database_population: "sample",
      service,
      region: "us-east-1",
    },
    cloudToken,
  );

  const taskId = (envResponse.task_id as string) ?? "";
  const tasksUrl = (envResponse.tasks as string) ?? "";
  const domain = (envResponse.domain as string) ?? "";

  // 6. Poll environment tasks until complete (if there's a tasks URL)
  if (tasksUrl) {
    await pollEnvironmentTasks(tasksUrl, cloudToken);
  }

  // 7. Extract domain URL
  const domainUrl = domain
    ? domain.endsWith("/graphql/")
      ? domain
      : `https://${domain}/graphql/`
    : `https://${domainLabel}.saleor.cloud/graphql/`;

  return {
    organizationSlug: orgSlug,
    projectName,
    projectSlug,
    environmentName,
    taskId,
    domainUrl,
    environmentResponse: envResponse,
  };
}

/**
 * Query the Saleor GraphQL instance for installed apps.
 * query GetApps { apps(first: 100) { edges { node { id name } } } }
 */
export async function queryGetApps(
  graphqlUrl: string,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const query = `query GetApps { apps(first: 100) { edges { node { id name } } } }`;
  const data = (await graphqlFetch(graphqlUrl, query, token)) as Record<
    string,
    unknown
  >;
  const appsData = data.apps as Record<string, unknown>;
  const edges = appsData?.edges as Array<Record<string, unknown>> | undefined;
  if (!edges || edges.length === 0) {
    return [];
  }
  return edges.map(
    (edge: Record<string, unknown>) =>
      edge.node as { id: string; name: string },
  );
}

/**
 * Create an app token via the Saleor GraphQL API.
 * mutation { appTokenCreate(input: { app: "<app-id>" }) { authToken errors { message } } }
 * Uses Bearer auth with the Cloud token.
 */
export async function createAppToken(
  graphqlUrl: string,
  appId: string,
  token: string,
): Promise<{ authToken: string }> {
  const mutation = `mutation { appTokenCreate(input: { app: "${appId}" }) { authToken errors { message } } }`;
  const data = (await graphqlFetch(graphqlUrl, mutation, token)) as Record<
    string,
    unknown
  >;
  const result = data.appTokenCreate as Record<string, unknown>;
  const errors = result?.errors as Array<Record<string, unknown>> | undefined;
  if (errors && errors.length > 0) {
    throw new Error(
      `App token creation failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
  const authToken = result?.authToken as string;
  if (!authToken) {
    throw new Error(
      `App token creation did not return an authToken: ${JSON.stringify(result)}`,
    );
  }
  return { authToken };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
