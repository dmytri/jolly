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
  // Bounded retry on connection-level failures (`TypeError: fetch failed`):
  // sandbox verifications run against live Saleor Cloud, where a transient
  // network blip is an environment condition, not a Jolly behavior, and must
  // not flake the suite. HTTP-status rejections (auth, 5xx) are not retried.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok && response.status !== 400) {
        throw new Error(`Saleor GraphQL request failed: HTTP ${response.status}`);
      }
      return (await response.json()) as GraphqlResult;
    } catch (error) {
      lastError = error;
      if (error instanceof TypeError && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
