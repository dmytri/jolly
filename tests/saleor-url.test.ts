// Logic-tier units for Saleor URL normalization (feature 012, "Agent accepts
// a pasted Saleor URL"): Dashboard URL, storefront API/GraphQL URL, and root
// Saleor Cloud URL all normalize to the canonical GraphQL endpoint; anything
// that cannot be normalized safely yields a clarifying question instead.
//
// Pinned harness seam: src/lib/saleor-url.ts exports
//   normalizeSaleorUrl(input) -> { endpoint: string | null; clarification?: string }
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSaleorUrl } from "../src/lib/saleor-url.ts";

const ENDPOINT = "https://my-shop.eu.saleor.cloud/graphql/";

describe("normalizeSaleorUrl", () => {
  test("normalizes a root Saleor Cloud URL", () => {
    assert.strictEqual(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud").endpoint, ENDPOINT);
  });

  test("normalizes a GraphQL URL with trailing slash", () => {
    assert.strictEqual(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/graphql/").endpoint, ENDPOINT);
  });

  test("normalizes a GraphQL URL without trailing slash", () => {
    assert.strictEqual(normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/graphql").endpoint, ENDPOINT);
  });

  test("normalizes a Saleor Dashboard URL", () => {
    assert.strictEqual(
      normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/dashboard/").endpoint,
      ENDPOINT,
    );
  });

  test("normalizes a Dashboard deep link", () => {
    assert.strictEqual(
      normalizeSaleorUrl("https://my-shop.eu.saleor.cloud/dashboard/products/").endpoint,
      ENDPOINT,
    );
  });

  test("trims surrounding whitespace from pasted input", () => {
    assert.strictEqual(normalizeSaleorUrl("  https://my-shop.eu.saleor.cloud  ").endpoint, ENDPOINT);
  });

  test("asks a clarifying question for non-URL input", () => {
    const result = normalizeSaleorUrl("my shop");
    assert.strictEqual(result.endpoint, null);
    assert.ok(result.clarification);
  });

  test("asks a clarifying question for unrecognized paths", () => {
    const result = normalizeSaleorUrl("https://example.com/checkout/cart");
    assert.strictEqual(result.endpoint, null);
    assert.ok(result.clarification);
  });

  test("asks a clarifying question for non-http protocols", () => {
    const result = normalizeSaleorUrl("ftp://my-shop.eu.saleor.cloud");
    assert.strictEqual(result.endpoint, null);
    assert.ok(result.clarification);
  });
});
