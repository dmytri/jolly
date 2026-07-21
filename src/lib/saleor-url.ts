// Normalizes a pasted Saleor URL to the canonical GraphQL endpoint.
// Contract (see features/step_definitions/012-existing-saleor-store-connection.steps.ts):
//   normalizeSaleorUrl(input) -> { endpoint: string | null; clarification?: string }
// Accepted forms: Saleor Dashboard URL, storefront API (GraphQL) URL with or
// without a trailing slash, and the root Saleor Cloud URL — all normalize to
// `https://<host>/graphql/`. Anything that cannot be normalized safely yields
// `endpoint: null` plus a clarifying question.

import { cliMessage } from "./messages.ts";

export interface NormalizedSaleorUrl {
  endpoint: string | null;
  clarification?: string;
}

/**
 * @planks("the envelope `data` should report the normalized endpoint `https:\/\/my-shop.saleor.cloud\/graphql\/`")
 * @planks("the clarifying question Jolly returns should match the catalog's entry")
 */
export function normalizeSaleorUrl(input: string): NormalizedSaleorUrl {
  const clarification = cliMessage("saleorUrl.clarification");
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { endpoint: null, clarification };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { endpoint: null, clarification };
  }

  const path = url.pathname.replace(/\/+$/, ""); // strip trailing slashes
  const recognized = path === "" || path === "/graphql" || path === "/dashboard" || /^\/dashboard\//.test(url.pathname);
  if (!recognized) {
    return { endpoint: null, clarification };
  }

  return { endpoint: `${url.protocol}//${url.host}/graphql/` };
}
