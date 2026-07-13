// Saleor Cloud API helpers shared by the sandbox harness (provisioning,
// teardown) and the feature 012 environment-creation steps. All access uses
// the same runtime JOLLY_SALEOR_CLOUD_TOKEN Jolly itself reads (feature 023).

export const CLOUD_API = "https://cloud.saleor.io/platform/api";

/**
 * Name prefix for the long-lived, cross-run shared sandbox store (features
 * 023 + 012): each store this harness creates gets PREFIX-<random> (a fixed
 * name alone hit a real DOMAIN_LABEL_TAKEN collision — see provision.ts), and
 * the CURRENT one is protected from reclaim by exact name via the marker
 * file, not by this prefix — an orphaned former shared-store must still be
 * reclaimable, or it would leak silently forever.
 */
export const SHARED_STORE_PREFIX = "jolly-cannon-fodder-shared";

export interface CloudEnvironment {
  org: string;
  key: string;
  name: string;
  domainLabel?: string;
}

/** Transient Cloud-platform statuses: the request is worth repeating as-is. */
function transientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

/** The server's own `Retry-After`, in milliseconds, when it served one. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

const TRANSIENT_RETRIES = 3;

/**
 * `fetch` with a brief bounded retry on a TRANSIENT failure, matching what
 * production's `cloudFetch` (src/lib/cloud-api.ts) rides through: a thrown
 * network fault AND a transient HTTP status (429, 500-504). A harness that
 * retries only the thrown fault reds a tier on a momentary Cloud 502 that
 * production would never have noticed, which is a harness defect, not a product
 * failure. A permanent rejection (authentication, validation, not-found) is
 * returned immediately, so a real defect still surfaces fast.
 */
async function cloudFetchRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (transientStatus(response.status) && attempt < TRANSIENT_RETRIES) {
        // Honour a served Retry-After; otherwise back off exponentially.
        const backoff = retryAfterMs(response) ?? Math.min(500 * 2 ** attempt, 3000);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt < TRANSIENT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 3000)));
        continue;
      }
      throw error;
    }
  }
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
 *
 * `spareNames` exempts specific names by exact match — used to protect the
 * ONE currently-cached shared store (features/support/provision.ts's marker
 * file) without blanket-exempting the whole SHARED_STORE_PREFIX: an earlier
 * design exempted any name matching that prefix, which meant an orphaned
 * shared-store from a stale marker (superseded by self-heal, or a race
 * between overlapping invocations) could never be reclaimed and would
 * silently accumulate — the exact leak this reclaim exists to prevent.
 */
export function leftoverTestEnvironments(
  environments: CloudEnvironment[],
  currentRunNamespace: string,
  spareNames: ReadonlySet<string> = new Set(),
): CloudEnvironment[] {
  return environments.filter(
    (env) =>
      env.name.startsWith("jolly-cannon-fodder-") &&
      !env.name.startsWith(currentRunNamespace) &&
      !spareNames.has(env.name),
  );
}
