// Sandbox-tier machinery (feature 023): credential gating on the same runtime
// JOLLY_* environment variables Jolly itself uses (there is no test-only
// credential namespace), a unique per-run namespace for every created
// resource, and an idempotent, best-effort, LIFO cleanup registry.
//
// Harness-internal knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_RUN_ID       — override the generated per-run identifier
//   HARNESS_CLI_RUNTIME  — runtime used to invoke the CLI (default "bun";
//                          Node >= 23 is the documented fallback)

/**
 * Runtime configuration groups. The variable names are the ones Jolly itself
 * reads at runtime — identical across dev, test, CI, and prod. Whether they
 * point at dedicated test accounts is the customer's choice; the harness
 * never knows or checks.
 */
export const CREDENTIAL_GROUPS = {
  saleorEndpoint: ["NEXT_PUBLIC_SALEOR_API_URL"],
  saleorAppToken: ["JOLLY_SALEOR_APP_TOKEN"],
  saleorCloud: ["JOLLY_SALEOR_CLOUD_TOKEN"],
  vercel: ["JOLLY_VERCEL_TOKEN"],
  stripe: ["JOLLY_STRIPE_PUBLISHABLE_KEY", "JOLLY_STRIPE_SECRET_KEY"],
} as const;

export type CredentialGroup = keyof typeof CREDENTIAL_GROUPS;

export const ALL_CREDENTIAL_GROUPS = Object.keys(
  CREDENTIAL_GROUPS,
) as CredentialGroup[];

const FULL_END_TO_END: CredentialGroup[] = [
  "saleorEndpoint",
  "saleorAppToken",
  "vercel",
  "stripe",
];

/**
 * Which credential groups each @sandbox scenario needs, keyed by scenario
 * name (scenario names are unique across the suite). An unlisted @sandbox
 * scenario conservatively requires every group, so it can only run in a
 * fully credentialed environment.
 */
export const SANDBOX_REQUIREMENTS: Record<string, CredentialGroup[]> = {
  // 001-agent-first-cli-and-onboarding
  "Jolly start completes successfully": FULL_END_TO_END,
  // 002-v1-end-to-end-saleor-cloud-storefront
  "Agent helps register a new Saleor Cloud store": ["saleorCloud"],
  "Agent connects an existing Saleor store as automatically as possible": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  "Agent creates a deployable storefront from Saleor Paper": ["saleorEndpoint"],
  "Agent deploys to Vercel": ["saleorEndpoint", "vercel"],
  // 003-saleor-source-repositories-and-integration
  "Use Saleor Paper as the storefront baseline": ["saleorEndpoint"],
  "Use Saleor Configurator directly for store configuration": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  // 004-jolly-configurator-starter-recipe
  "Agent prepares the starter recipe": ["saleorEndpoint", "saleorAppToken"],
  "Agent applies the starter recipe safely": ["saleorEndpoint", "saleorAppToken"],
  // 005-stripe-checkout-setup
  "Jolly configures Saleor for Stripe": [
    "saleorEndpoint",
    "saleorAppToken",
    "stripe",
  ],
  "Agent verifies checkout readiness": [
    "saleorEndpoint",
    "saleorAppToken",
    "stripe",
    "vercel",
  ],
  // 012-existing-saleor-store-connection
  "Jolly validates the GraphQL endpoint": ["saleorEndpoint"],
  "Jolly infers Saleor Cloud organization and environment": [
    "saleorEndpoint",
    "saleorCloud",
  ],
  "Jolly acquires the required app token": ["saleorEndpoint", "saleorCloud"],
  // 014-jolly-doctor-diagnostics
  "Doctor checks Saleor connectivity": ["saleorEndpoint"],
  "Doctor checks storefront readiness": ["saleorEndpoint"],
  "Doctor checks deployment and payment readiness": ["vercel", "stripe"],
  "Jolly start runs doctor automatically": FULL_END_TO_END,
  // 018-jolly-auth-commands
  "Agent logs in to Saleor Cloud": ["saleorCloud"],
  // 019-iteration-phase
  "Agent has live store access from day one": ["saleorEndpoint", "saleorAppToken"],
  // 021-agent-risk-context
  "Risk context is consistent across preview and execution": ["saleorEndpoint"],
  // 022-command-idempotency-and-resumability
  "Re-running a create subcommand detects existing work": ["saleorEndpoint"],
  "Jolly start resumes from the first incomplete stage": FULL_END_TO_END,
  "Composed subcommands and start agree on state": FULL_END_TO_END,
};

export function requiredGroups(scenarioName: string): CredentialGroup[] {
  return SANDBOX_REQUIREMENTS[scenarioName] ?? ALL_CREDENTIAL_GROUPS;
}

/**
 * Names of the variables from the given groups that are absent from the
 * provided environment (default: the test process environment). Used by the
 * @sandbox Before hook to skip — never fail — scenarios, with a reason that
 * names exactly these variables.
 */
export function missingCredentials(
  groups: readonly CredentialGroup[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  const missing: string[] = [];
  for (const group of groups) {
    for (const name of CREDENTIAL_GROUPS[group]) {
      const value = env[name];
      if (value === undefined || value.trim() === "") missing.push(name);
    }
  }
  return [...new Set(missing)];
}

let processRunId: string | undefined;

/**
 * The per-run identifier: HARNESS_RUN_ID when set, otherwise generated once
 * per test process. Created resources embed it so repeated and parallel runs
 * never collide and leaked resources are attributable to a run.
 */
export function runId(): string {
  const override = process.env.HARNESS_RUN_ID;
  if (override !== undefined && override.trim() !== "") return override.trim();
  if (processRunId === undefined) {
    processRunId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
  return processRunId;
}

/** Namespace prefix for every resource a test run creates. */
export function makeNamespace(id: string = runId()): string {
  return `jolly-test-${id}`;
}

export interface CleanupFailure {
  description: string;
  error: string;
}

/**
 * LIFO, idempotent, best-effort teardown. Each sandbox creation registers a
 * cleanup; runAll() pops in reverse order, never throws, and returns what it
 * could not remove so the hook can report it by namespaced identifier.
 */
export class CleanupRegistry {
  private entries: Array<{ description: string; fn: () => void | Promise<void> }> =
    [];

  register(description: string, fn: () => void | Promise<void>): void {
    this.entries.push({ description, fn });
  }

  get size(): number {
    return this.entries.length;
  }

  async runAll(): Promise<CleanupFailure[]> {
    const failures: CleanupFailure[] = [];
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      try {
        await entry.fn();
      } catch (error) {
        failures.push({
          description: entry.description,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }
}
