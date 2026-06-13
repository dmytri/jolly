// Logic-tier safety harness (the "012 incident" lesson).
//
// Any @logic step that exercises a side-effecting command path MUST run with
// dummy credentials for every group and an unroutable Cloud API base, so that
// a CLI which ignores `--dry-run` (or has an unimplemented preview path) can
// never reach a real account. We force this by OVERRIDING the real runtime
// JOLLY_* variables (the harness loads `.env` into process.env — see
// support/dotenv.ts — so the real Cloud token may be present) with
// obviously-fake values and pointing every Saleor host at a `.invalid` TLD,
// which is guaranteed never to resolve (RFC 6761).
//
// These overrides are merged over process.env by world.runCli, so they win.

/** An unroutable base — `.invalid` never resolves (RFC 6761). */
export const UNROUTABLE_CLOUD_API = "https://jolly-test.invalid";
export const UNROUTABLE_SALEOR_ENDPOINT =
  "https://jolly-test.invalid/graphql/";

/** Obviously-fake credential values; never match a real account. */
export const DUMMY = {
  cloudToken: "dummy-cloud-token-DO-NOT-VERIFY",
  appToken: "dummy-app-token-DO-NOT-VERIFY",
  stripePublishable: "pk_test_dummyDoNotUse",
  stripeSecret: "sk_test_dummyDoNotUse",
} as const;

/**
 * Environment overrides that make any side-effecting command path harmless in
 * a @logic scenario: dummy credentials for every group plus an unroutable
 * Cloud API base and Saleor endpoint. Pass the result as `runCli`'s `env`
 * (it is merged over process.env, so these override the real `.env`).
 *
 * The returned values include the dummy secrets; track them on the world
 * (`world.trackSecret`) when a scenario asserts secrets are never printed,
 * since they enter the child env after the world snapshotted process.env.
 */
export function logicSafeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    JOLLY_SALEOR_CLOUD_TOKEN: DUMMY.cloudToken,
    JOLLY_SALEOR_APP_TOKEN: DUMMY.appToken,
    NEXT_PUBLIC_SALEOR_API_URL: UNROUTABLE_SALEOR_ENDPOINT,
    JOLLY_SALEOR_CLOUD_API_URL: UNROUTABLE_CLOUD_API,
    JOLLY_STRIPE_PUBLISHABLE_KEY: DUMMY.stripePublishable,
    JOLLY_STRIPE_SECRET_KEY: DUMMY.stripeSecret,
    ...overrides,
  };
}

/** The dummy secret values a scenario may need to track for leak assertions. */
export const DUMMY_SECRETS: string[] = [
  DUMMY.cloudToken,
  DUMMY.appToken,
  DUMMY.stripePublishable,
  DUMMY.stripeSecret,
];
