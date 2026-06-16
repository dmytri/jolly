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
  // (`TypeError: fetch failed`), and HTTP 429 rate-limits — a long serial
  // sandbox run hammers live Saleor Cloud until it asks us to back off. 429 is
  // the server explicitly inviting a retry, so it gets its own generous budget
  // that can ride out a realistic rate-limit window (~40s of exponential
  // backoff, honoring Retry-After when given) — Saleor's limit outlasts the
  // few seconds a connection blip needs, and the backoff only fires on an
  // actual 429, so the normal fast path is untouched. Other HTTP-status
  // rejections (auth, 5xx) are permanent here and not retried.
  let connectionAttempts = 0;
  let rateLimitRetries = 0;
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
