// Minimal Saleor GraphQL client for sandbox scenarios that must verify live
// access with the customer's configured credentials (feature 019). Reads of
// pre-existing resources are read-only, non-mutating queries; any mutation
// made through this helper must create only namespaced resources and
// register their teardown (feature 023, harmless by design).

export interface GraphqlResult {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

export async function saleorGraphql(
  endpoint: string,
  token: string | undefined,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphqlResult> {
  // Bounded retry on transient environment conditions that are not a Jolly
  // behavior and must not flake the suite: connection-level failures
  // (`TypeError: fetch failed`), HTTP 429 rate-limits, and the transient
  // unavailability a live Saleor Cloud instance produces on demand — a
  // freshly-provisioned environment answers 404 (its endpoint is not yet
  // serving) or 5xx (502/503/504 gateway/unavailable) for a spell before it
  // settles, and a busy shared store 503s under a parallel run's load. Both are
  // real-env warmup/transient conditions, not a Jolly defect, so they get a
  // bounded cold-instance budget (~90s exponential backoff). 429 keeps its own
  // generous budget honoring Retry-After. Permanent rejections stay permanent:
  // auth (401/403) and 400 are not retried, so real defects still fail fast.
  const TRANSIENT_STATUSES = new Set([404, 502, 503, 504]);
  let connectionAttempts = 0;
  let rateLimitRetries = 0;
  let transientRetries = 0;
  while (true) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (response.status === 429 && rateLimitRetries < 6) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : Math.min(2000 * 2 ** rateLimitRetries, 10_000);
        rateLimitRetries++;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      if (TRANSIENT_STATUSES.has(response.status) && transientRetries < 4) {
        transientRetries++;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500 * 2 ** (transientRetries - 1), 3000)),
        );
        continue;
      }
      if (!response.ok && response.status !== 400) {
        throw new Error(`Saleor GraphQL request failed: HTTP ${response.status}`);
      }
      return (await response.json()) as GraphqlResult;
    } catch (error) {
      if (error instanceof TypeError && connectionAttempts < 2) {
        connectionAttempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000 * connectionAttempts));
        continue;
      }
      throw error;
    }
  }
}
