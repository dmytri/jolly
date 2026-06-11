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
}
