// Saleor Cloud API helpers shared by the sandbox harness (provisioning,
// teardown) and the feature 012 environment-creation steps. All access uses
// the same runtime JOLLY_SALEOR_CLOUD_TOKEN Jolly itself reads (feature 023).

export const CLOUD_API = "https://cloud.saleor.io/platform/api";

export interface CloudEnvironment {
  org: string;
  key: string;
  name: string;
  domainLabel?: string;
}

/**
 * `fetch` with a brief bounded retry on a TRANSIENT network failure (a thrown
 * `TypeError: fetch failed`), so a momentary blip to cloud.saleor.io does not
 * flake the harness's read-only Cloud-API queries (namespace verification,
 * teardown). HTTP error statuses are returned as-is for the caller to handle.
 */
async function cloudFetchRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
  delayMs = 1_500,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/** Organization slugs the token can access (read-only GET). */
export async function listOrganizations(token: string): Promise<string[]> {
  const orgsResponse = await cloudFetchRetry(`${CLOUD_API}/organizations/`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!orgsResponse.ok) {
    throw new Error(`GET organizations returned HTTP ${orgsResponse.status}`);
  }
  const orgs = (await orgsResponse.json()) as Array<{ slug: string }>;
  return orgs.map((org) => String(org.slug));
}

/** Every environment visible to the token, across all organizations. */
export async function listAllEnvironments(
  token: string,
): Promise<CloudEnvironment[]> {
  const orgsResponse = await cloudFetchRetry(`${CLOUD_API}/organizations/`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!orgsResponse.ok) {
    throw new Error(`GET organizations returned HTTP ${orgsResponse.status}`);
  }
  const orgs = (await orgsResponse.json()) as Array<{ slug: string }>;
  const all: CloudEnvironment[] = [];
  for (const org of orgs) {
    const envsResponse = await cloudFetchRetry(
      `${CLOUD_API}/organizations/${org.slug}/environments/`,
      { headers: { Authorization: `Token ${token}` } },
    );
    if (!envsResponse.ok) {
      throw new Error(
        `GET environments for ${org.slug} returned HTTP ${envsResponse.status}`,
      );
    }
    const envs = (await envsResponse.json()) as Array<{
      key: string;
      name: string;
      domain_label?: string;
    }>;
    for (const env of envs) {
      all.push({
        org: org.slug,
        key: String(env.key),
        name: String(env.name),
        domainLabel:
          env.domain_label !== undefined ? String(env.domain_label) : undefined,
      });
    }
  }
  return all;
}

/**
 * Idempotent environment deletion: 404 = already gone. The platform can
 * reject deletion while provisioning tasks still block the environment, so
 * retry briefly — a creation that timed out mid-poll must still be removable.
 * The DELETE goes through cloudFetchRetry, so a TRANSIENT thrown network fault
 * (`TypeError: fetch failed`) during teardown is retried rather than crashing
 * the AfterAll and masking a run whose scenarios all passed.
 */
export async function deleteEnvironment(
  token: string,
  org: string,
  key: string,
): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 1; ; attempt++) {
    const response = await cloudFetchRetry(
      `${CLOUD_API}/organizations/${org}/environments/${key}/`,
      { method: "DELETE", headers: { Authorization: `Token ${token}` } },
    );
    if (response.ok || response.status === 404) return;
    if (attempt >= maxAttempts) {
      throw new Error(`DELETE environment returned HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

/**
 * Environments left behind by PREVIOUS runs: jolly-cannon-fodder-namespaced names that
 * do not belong to the given run namespace. Feature 012: a leftover blocks
 * creation — non-interactive runs skip, naming it; it is never auto-deleted
 * here because this run cannot positively attribute it to itself.
 */
export function leftoverTestEnvironments(
  environments: CloudEnvironment[],
  currentRunNamespace: string,
): CloudEnvironment[] {
  return environments.filter(
    (env) =>
      env.name.startsWith("jolly-cannon-fodder-") &&
      !env.name.startsWith(currentRunNamespace),
  );
}
