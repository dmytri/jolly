// Live-by-design credential control (replaces the retired forced-safe harness).
//
// AGENTS.md ("Real services always — never mock or fake") forbids dummy
// credentials and unroutable stand-in endpoints. The "no credentials" condition
// a @logic scenario needs is therefore produced for REAL, by UNSETTING the
// runtime credentials rather than substituting obviously-fake values pointed at
// an unroutable host. Real absence IS real bad input: a side-effecting command
// path run with the credentials genuinely absent cannot reach — let alone mutate
// — a real account, so the old "012 incident" safety is preserved by real
// absence instead of a forced-safe double.
//
// These overrides are merged over process.env by world.runCli; an `undefined`
// value deletes the variable for the child (runCli drops undefined entries), so
// the child process truly runs without the credential.

/**
 * A real-format token used to drive a LOCAL loopback stand-in (a deterministic
 * in-process Cloud API / GraphQL fixture) that does not validate it. It lets the
 * CLI proceed to the request it would send so the preview/resolution path runs;
 * the stand-in answers regardless, so no real account is ever reached. This is
 * bad input to a local server, not a credential for any real service.
 */
export const STAND_IN_TOKEN = "saleor-token-stand-in";

/** The runtime credentials Jolly reads; unset together to produce real absence. */
export const CREDENTIAL_VARS = [
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_SALEOR_APP_TOKEN",
  "JOLLY_SALEOR_CLOUD_API_URL",
  "NEXT_PUBLIC_SALEOR_API_URL",
  "JOLLY_STRIPE_PUBLISHABLE_KEY",
  "JOLLY_STRIPE_SECRET_KEY",
] as const;

/**
 * Environment overrides that genuinely UNSET every runtime credential, so the
 * child runs with the "no credentials" condition produced for real. Pass the
 * result as `runCli`'s `env` (merged over process.env; `undefined` deletes the
 * variable for the child). Per-variable overrides may re-add a real value — e.g.
 * a real but invalid token aimed at the real endpoint to produce a real auth
 * failure.
 */
export function absentCredentialsEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of CREDENTIAL_VARS) env[name] = undefined;
  return { ...env, ...overrides };
}
