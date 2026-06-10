// Sandbox-first test support: credential gating, per-run isolation, cleanup,
// and a non-production safety guard. See features/023-test-architecture.feature.

// Test/sandbox credentials use JOLLY_TEST_* names, distinct from runtime JOLLY_*.
export const REQUIRED_SANDBOX_ENV = [
  "JOLLY_TEST_SALEOR_CLOUD_TOKEN",
  "JOLLY_TEST_VERCEL_TOKEN",
  "JOLLY_TEST_STRIPE_SECRET_KEY",
  "JOLLY_TEST_STRIPE_PUBLISHABLE_KEY",
] as const;

type Env = Record<string, string | undefined>;

export function missingSandboxCreds(env: Env = process.env): string[] {
  return REQUIRED_SANDBOX_ENV.filter((key) => !env[key]);
}

export function sandboxCredsAvailable(env: Env = process.env): boolean {
  return missingSandboxCreds(env).length === 0;
}

// Returns a human reason when sandbox tests must be skipped, else null.
export function sandboxSkipReason(env: Env = process.env): string | null {
  const missing = missingSandboxCreds(env);
  return missing.length
    ? `skipped: missing sandbox credentials: ${missing.join(", ")}`
    : null;
}

// Unique per-run prefix so repeated/parallel runs do not collide and teardown
// can target only this run's resources (feature 022 idempotency).
export function runNamespace(seed = String(process.pid), env: Env = process.env): string {
  const runId = env.JOLLY_TEST_RUN_ID ?? Date.now().toString(36);
  return `jolly-test-${runId}-${seed}`;
}

// Refuse destructive sandbox operations against anything not clearly a
// dedicated test/sandbox target.
export function assertSandboxTarget(identifier: string): void {
  if (!/(sandbox|test|staging|dev)/i.test(identifier)) {
    throw new Error(
      `refusing to run sandbox test against non-sandbox target: ${identifier}`,
    );
  }
}

// Optional sandbox inputs: when absent, only the scenarios that need them are
// conditionally skipped (environment-dependent branches), not the whole tier.
export const OPTIONAL_SANDBOX_ENV = [
  "JOLLY_TEST_SALEOR_API_URL",
  "JOLLY_TEST_SALEOR_APP_TOKEN",
] as const;

// Harness convention: sandbox scenarios hand credentials to the CLI under test
// through runtime `JOLLY_*` environment variable names (AGENTS.md secret
// handling; feature 018 open question pins the JOLLY_* prefix). The mapping
// below is the pinned test<->runtime correspondence.
const RUNTIME_ENV_MAP: Record<string, string> = {
  JOLLY_TEST_SALEOR_CLOUD_TOKEN: "JOLLY_SALEOR_CLOUD_TOKEN",
  JOLLY_TEST_VERCEL_TOKEN: "JOLLY_VERCEL_TOKEN",
  JOLLY_TEST_STRIPE_SECRET_KEY: "JOLLY_STRIPE_SECRET_KEY",
  JOLLY_TEST_STRIPE_PUBLISHABLE_KEY: "JOLLY_STRIPE_PUBLISHABLE_KEY",
  JOLLY_TEST_SALEOR_API_URL: "JOLLY_SALEOR_URL",
  JOLLY_TEST_SALEOR_APP_TOKEN: "JOLLY_SALEOR_APP_TOKEN",
};

export function sandboxRuntimeEnv(env: Env = process.env): Record<string, string> {
  const runtime: Record<string, string> = {};
  for (const [testName, runtimeName] of Object.entries(RUNTIME_ENV_MAP)) {
    const value = env[testName];
    if (value) runtime[runtimeName] = value;
  }
  return runtime;
}

/** All secret values that must never appear in CLI output (URL is not a secret). */
export function sandboxSecretValues(env: Env = process.env): string[] {
  return Object.keys(RUNTIME_ENV_MAP)
    .filter((name) => name !== "JOLLY_TEST_SALEOR_API_URL")
    .map((name) => env[name])
    .filter((value): value is string => Boolean(value));
}

// Memo for expensive cross-scenario sandbox work (e.g. one full `jolly start`
// shared by every scenario that asserts on its output). Process-lifetime only.
const runMemo = new Map<string, Promise<unknown>>();

export function memoizedRun<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!runMemo.has(key)) runMemo.set(key, fn());
  return runMemo.get(key) as Promise<T>;
}

export type CleanupFn = () => Promise<void>;

// Best-effort, idempotent teardown registry. Runs LIFO; never throws —
// it returns the labels of resources it could not remove so callers can report.
export class CleanupRegistry {
  private entries: { label: string; fn: CleanupFn }[] = [];

  register(label: string, fn: CleanupFn): void {
    this.entries.push({ label, fn });
  }

  async runAll(): Promise<string[]> {
    const failures: string[] = [];
    for (const { label, fn } of [...this.entries].reverse()) {
      try {
        await fn();
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message}`);
      }
    }
    this.entries = [];
    return failures;
  }
}
