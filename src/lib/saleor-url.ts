// Normalizes a pasted Saleor URL to the canonical GraphQL endpoint.
// Contract (see features/step_definitions/012-existing-saleor-store-connection.steps.ts):
//   normalizeSaleorUrl(input) -> { endpoint: string | null; clarification?: string }
// Accepted forms: Saleor Dashboard URL, storefront API (GraphQL) URL with or
// without a trailing slash, and the root Saleor Cloud URL — all normalize to
// `https://<host>/graphql/`. Anything that cannot be normalized safely yields
// `endpoint: null` plus a clarifying question.

export interface NormalizedSaleorUrl {
  endpoint: string | null;
  clarification?: string;
}

const CLARIFICATION =
  "That doesn't look like a Saleor URL I can use. Could you paste your Saleor Dashboard URL, " +
  "GraphQL API URL, or root Saleor Cloud URL (for example https://your-store.eu.saleor.cloud)?";

export function normalizeSaleorUrl(input: string): NormalizedSaleorUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { endpoint: null, clarification: CLARIFICATION };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { endpoint: null, clarification: CLARIFICATION };
  }

  const path = url.pathname.replace(/\/+$/, ""); // strip trailing slashes
  const recognized = path === "" || path === "/graphql" || path === "/dashboard" || /^\/dashboard\//.test(url.pathname);
  if (!recognized) {
    return { endpoint: null, clarification: CLARIFICATION };
  }

  return { endpoint: `${url.protocol}//${url.host}/graphql/` };
}
