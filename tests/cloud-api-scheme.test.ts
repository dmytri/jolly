// Logic-tier unit for the Cloud platform API auth scheme (feature 018 Rule "The
// Cloud platform API scheme is chosen by which stored token is used"): a
// device-grant access token (a JWT) authenticates as `Authorization: Bearer`;
// an opaque Cloud staff token as `Authorization: Token`.
//
// Regression guard: the scheme MUST be decided by the token's shape, not by
// whether it happens to be mirrored in process.env. The agent `start` path reads
// the device token back from .env (not process.env), so the old process.env
// identity check sent a device JWT as `Token`, which the platform API rejected
// (401), pushing the agent toward a staff token it should never need.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { platformAuthScheme } from "../src/lib/cloud-api.ts";

// A device-grant access token: a JWT (header.payload.signature), three
// non-empty dot-separated base64url segments.
const DEVICE_JWT =
  "eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJqb2xseSIsImlzcyI6Imh0dHBzOi8vYXV0aC5zYWxlb3IuaW8ifQ.c2lnbmF0dXJlLXBhcnQ";
// A Cloud staff token: opaque uuid.base58, no dots.
const STAFF_TOKEN = "f47ac10b58cc4372a5670e02b2c3d479AbCdEfGhJkLmNpQrStUvWxYz12345";

describe("platformAuthScheme — by token shape, not process.env", () => {
  test("a device-grant JWT authenticates as Bearer even when absent from process.env", () => {
    delete process.env["JOLLY_SALEOR_ACCESS_TOKEN"]; // the agent path: token is in .env, not here
    assert.equal(platformAuthScheme(DEVICE_JWT), "Bearer");
  });

  test("a device-grant JWT authenticates as Bearer when it IS mirrored in process.env (interactive path)", () => {
    process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = DEVICE_JWT;
    try {
      assert.equal(platformAuthScheme(DEVICE_JWT), "Bearer");
    } finally {
      delete process.env["JOLLY_SALEOR_ACCESS_TOKEN"];
    }
  });

  test("an opaque Cloud staff token authenticates as Token", () => {
    assert.equal(platformAuthScheme(STAFF_TOKEN), "Token");
  });
});
