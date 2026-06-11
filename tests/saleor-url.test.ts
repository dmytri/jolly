// Logic-tier units for Saleor URL normalization (feature 012, "Agent accepts
// a pasted Saleor URL"): Dashboard URL, storefront API/GraphQL URL, and root
// Saleor Cloud URL all normalize to the canonical GraphQL endpoint; anything
// that cannot be normalized safely yields a clarifying question instead.
//
// Pinned harness seam: src/lib/saleor-url.ts exports
//   normalizeSaleorUrl(input) -> { endpoint: string | null; clarification?: string }
import { describe, expect, test } from "bun:test";
import { normalizeSaleorUrl } from "../src/lib/saleor-url.ts";

const ENDPOINT = "https://my-shop.eu.saleor.cloud/graphql/";

describe("normalizeSaleorUrl", () => {
  test("normalizes a root Saleor Cloud URL", () => {
    expect(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud").endpoint).toBe(ENDPOINT);
  });

  test("normalizes a GraphQL URL with trailing slash", () => {
    expect(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/graphql/").endpoint).toBe(ENDPOINT);
  });

  test("normalizes a GraphQL URL without trailing slash", () => {
    expect(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/graphql").endpoint).toBe(ENDPOINT);
  });

  test("normalizes a Saleor Dashboard URL", () => {
    expect(
      normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/dashboard/").endpoint,
    ).toBe(ENDPOINT);
  });

  test("normalizes a Dashboard deep link", () => {
    expect(
      normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/dashboard/products/").endpoint,
    ).toBe(ENDPOINT);
  });

  test("trims surrounding whitespace from pasted input", () => {
    expect(normalizeSaleorUrl("  https://my-shop.eu.saleor.cloud  ").endpoint).toBe(ENDPOINT);
  });

  test("asks a clarifying question for non-URL input", () => {
    const result = normalizeSaleorUrl("my shop");
    expect(result.endpoint).toBeNull();
    expect(result.clarification).toBeTruthy();
  });

  test("asks a clarifying question for unrecognized paths", () => {
    const result = normalizeSaleorUrl("https://example.com/checkout/cart");
    expect(result.endpoint).toBeNull();
    expect(result.clarification).toBeTruthy();
  });

  test("asks a clarifying question for non-http protocols", () => {
    const result = normalizeSaleorUrl("ftp://my-shop.eu.saleor.cloud");
    expect(result.endpoint).toBeNull();
    expect(result.clarification).toBeTruthy();
  });
});
