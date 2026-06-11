// Sandbox-first test support: credential gating, per-run isolation, and
// cleanup. See features/023-test-architecture.feature.
//
// One configuration everywhere: tests read the same runtime `JOLLY_*`
// environment variables Jolly itself uses — there is no test-only credential
// namespace. Whether the accounts behind them are dedicated test accounts is
// the customer's choice; the tests never know or check. Safety comes from how
// tests behave (harmless by design), never from detecting or refusing targets.
// Harness-internal knobs use a `HARNESS_*` prefix, never `JOLLY_*`.

export const REQUIRED_SANDBOX_ENV = [
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_VERCEL_TOKEN",
  "JOLLY_STRIPE_SECRET_KEY",
  "JOLLY_STRIPE_PUBLISHABLE_KEY",
] as const;

// Optional sandbox inputs: when absent, only the scenarios that need them are
// conditionally skipped (environment-dependent branches), not the whole tier.
export const OPTIONAL_SANDBOX_ENV = [
  "JOLLY_SALEOR_URL",
  "JOLLY_SALEOR_APP_TOKEN",
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
// can target only this run's resources (feature 022 idempotency). The run id
// override is a harness knob, not a Jolly setting (HARNESS_* prefix).
export function runNamespace(seed = String(process.pid), env: Env = process.env): string {
  const runId = env.HARNESS_RUN_ID ?? Date.now().toString(36);
  return `jolly-test-${runId}-${seed}`;
}

// The runtime `JOLLY_*` variables handed to the CLI under test: the subset of
// recognized names present in the host environment, passed through unchanged
// (cli.ts strips everything else so unrelated host state never leaks in).
const SANDBOX_ENV_NAMES = [...REQUIRED_SANDBOX_ENV, ...OPTIONAL_SANDBOX_ENV];

export function sandboxRuntimeEnv(env: Env = process.env): Record<string, string> {
  const runtime: Record<string, string> = {};
  for (const name of SANDBOX_ENV_NAMES) {
    const value = env[name];
    if (value) runtime[name] = value;
  }
  return runtime;
}

/** All secret values that must never appear in CLI output (URL is not a secret). */
export function sandboxSecretValues(env: Env = process.env): string[] {
  return SANDBOX_ENV_NAMES.filter((name) => name !== "JOLLY_SALEOR_URL")
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
