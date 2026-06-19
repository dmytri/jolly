// Sandbox-tier machinery (feature 023): credential gating on the same runtime
// JOLLY_* environment variables Jolly itself uses (there is no test-only
// credential namespace), a unique per-run namespace for every created
// resource, and an idempotent, best-effort, LIFO cleanup registry.
//
// Harness-internal knobs use a HARNESS_* prefix, never JOLLY_*:
//   HARNESS_RUN_ID       — override the generated per-run identifier
//   HARNESS_CLI_RUNTIME  — runtime used to invoke the CLI (default "node",
//                          native Node >= 23 with type stripping)
//
// Vercel is NOT a Jolly credential (decision 2026-06-13): deployment is
// agent-run via the Vercel CLI under its own `vercel login` session, so there
// is no JOLLY_VERCEL_TOKEN. Scenarios touching a Vercel deployment gate on the
// Vercel CLI being authenticated (`npx vercel whoami` exit 0) — a capability,
// not an env var (see requiresVercelCli / vercelCliAuthenticated below).
import { spawnSync } from "node:child_process";

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
  stripe: ["JOLLY_STRIPE_PUBLISHABLE_KEY", "JOLLY_STRIPE_SECRET_KEY"],
} as const;

export type CredentialGroup = keyof typeof CREDENTIAL_GROUPS;

export const ALL_CREDENTIAL_GROUPS = Object.keys(
  CREDENTIAL_GROUPS,
) as CredentialGroup[];

// The end-to-end credential set (Vercel is a separate CLI-session capability,
// not a credential — scenarios in this set also appear in VERCEL_CLI_SCENARIOS).
const FULL_END_TO_END: CredentialGroup[] = [
  "saleorEndpoint",
  "saleorAppToken",
  "stripe",
];

/**
 * Which credential groups each @sandbox scenario needs, keyed by scenario
 * name (scenario names are unique across the suite). An unlisted @sandbox
 * scenario conservatively requires every group, so it can only run in a
 * fully credentialed environment.
 */
export const SANDBOX_REQUIREMENTS: Record<string, CredentialGroup[]> = {
  // 007-jolly-init-agent-setup
  // The non-interactive skill install reproduces a fresh machine (no agent
  // runtime, no TTY); it touches only `npx skills add` over the network and
  // needs no Saleor credentials.
  "Skills install non-interactively with no agent runtime present": [],
  // The bundled Jolly skill installs from a local path with the network
  // blocked, so it needs no credentials and no reachable host.
  "The Jolly skill installs from the bundled copy with no network": [],
  // 001-agent-first-cli-and-onboarding
  "Jolly start completes successfully": FULL_END_TO_END,
  "Jolly start orchestrates the setup by spawning the official CLIs": FULL_END_TO_END,
  // 002-v1-end-to-end-saleor-cloud-storefront
  "Jolly registers a new Saleor Cloud store via the Cloud API": ["saleorCloud"],
  "Jolly connects an existing Saleor store and verifies connectivity": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  "Jolly start creates a deployable storefront from Saleor Paper": ["saleorEndpoint"],
  "Jolly start deploys to Vercel by spawning the official Vercel CLI": ["saleorEndpoint"],
  // The storefront's native deps (sharp, esbuild) must build so the production
  // build completes. Clone+install is credential-independent; the production
  // build's codegen needs a reachable Saleor schema (saleorEndpoint).
  "Jolly start lets Paper's native dependencies run their build scripts so the Vercel build succeeds":
    ["saleorEndpoint"],
  // Auto-provision: `jolly start --yes` provisions a store itself when none is
  // configured. It needs only the Cloud token; it must NOT pre-derive a store
  // endpoint (the scenario's premise is "no NEXT_PUBLIC_SALEOR_API_URL"), so
  // saleorEndpoint/saleorAppToken are deliberately absent here.
  "jolly start auto-provisions a new store when none is configured": ["saleorCloud"],
  // Whole-flow run from only a `.env`: start auto-provisions the store, deploys
  // the recipe/stock/storefront, and deploys to Vercel. The Cloud token (provision)
  // and Stripe keys are read from the `.env` the scenario writes; the store
  // endpoint/app token are derived by start itself, so they are not required here.
  "One jolly start drives the whole flow from a real agent's starting state": [
    "saleorCloud",
    "stripe",
  ],
  // The live-storefront acceptance check requires an actual deployed storefront
  // URL, which only a full (human-gated) `jolly start` produces — the harness
  // cannot derive it. So it takes NO JOLLY credential group via the hook; the
  // step gates entirely on the harness-provided HARNESS_DEPLOYED_STOREFRONT_URL
  // (+ the served store's NEXT_PUBLIC_SALEOR_API_URL), skipping when absent.
  // This avoids provisioning a throwaway env that would not match the URL.
  "The deployed storefront serves the Saleor catalog and a working cart": [],
  // 003-saleor-source-repositories-and-integration
  "Use Saleor Paper as the storefront baseline": ["saleorEndpoint"],
  "Use Saleor Configurator directly for store configuration": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  // 004-jolly-configurator-starter-recipe
  "Agent prepares the starter recipe": ["saleorEndpoint", "saleorAppToken"],
  "Agent applies the starter recipe safely": ["saleorEndpoint", "saleorAppToken"],
  "Jolly start seeds stock so the recipe catalog is buyable": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  // The configurator-deploy stage spawns `npx @saleor/configurator deploy` of
  // Jolly's bundled recipe against the store URL + app token (derivable from the
  // Cloud token via per-run provisioning). No CLI auth beyond the Saleor app
  // token the configurator uses; no Vercel/Stripe credential.
  "Jolly start deploys the starter recipe with @saleor/configurator": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  // Read-back of the recipe's featured collection against the live store; the
  // store endpoint + app token are derivable from the Cloud token.
  "Jolly start confirms the recipe's featured collection exists before reporting the recipe stage completed":
    ["saleorEndpoint", "saleorAppToken"],
  // Bootstrap path: a blank environment created by a prior `create store`
  // (the harness provisions the shared env through exactly that command), then
  // `jolly start` deploys the recipe over the stock defaults. Read-back of the
  // store's channels needs only the store endpoint + app token (derivable).
  "Jolly start deploys the recipe over the stock defaults of a store created by a prior create-store command":
    ["saleorEndpoint", "saleorAppToken"],
  // 005-stripe-checkout-setup
  // The Stripe-CLI import path writes the session's keys to .env and contacts no
  // Saleor/Stripe service, so it needs NO Jolly credential group. Its premise —
  // a real, logged-in Stripe CLI holding test-mode keys — is a runner CAPABILITY
  // (signup + browser OAuth are human steps, not provisionable), gated in the
  // scenario's Given which skips when no such session is present.
  "Jolly create stripe imports keys from the Stripe CLI session when none are passed": [],
  "Agent configures Saleor for Stripe": [
    "saleorEndpoint",
    "saleorAppToken",
    "stripe",
  ],
  "Agent verifies checkout readiness": [
    "saleorEndpoint",
    "saleorAppToken",
    "stripe",
  ],
  // The Stripe app install is `jolly start`'s own Saleor GraphQL appInstall,
  // authenticated with the Cloud STAFF token (an app token gets
  // PermissionDenied) against the store GraphQL endpoint.
  "Jolly start installs the Stripe app and surfaces the keys and channel gate": [
    "saleorEndpoint",
    "saleorCloud",
  ],
  // `jolly start` runs `stripe login` interactively when the Stripe CLI has no
  // test-mode session. Reaching the Stripe stage needs a store (Cloud token +
  // endpoint); the "Stripe CLI not authenticated" premise and the stdio/TTY
  // requirement are runner capabilities gated in the scenario's Given/When,
  // which skip when they cannot be produced.
  "jolly start runs stripe login interactively when the Stripe CLI is not authenticated": [
    "saleorCloud",
    "saleorEndpoint",
  ],
  // The checkout-readiness probe is Jolly's own Saleor GraphQL (create + revert a
  // `us` test checkout, read availablePaymentGateways) — no CLI spawn, no Vercel.
  // It needs the store endpoint + a token that can create a checkout (app token,
  // derivable from the Cloud token); gateway availability is server-side, so no
  // Stripe credential is required.
  "Jolly doctor verifies the Stripe payment gateway is reachable for checkout": [
    "saleorEndpoint",
    "saleorAppToken",
  ],
  // 012-existing-saleor-store-connection
  "Jolly validates the GraphQL endpoint": ["saleorEndpoint"],
  "Jolly infers Saleor Cloud organization and environment": [
    "saleorEndpoint",
    "saleorCloud",
  ],
  "Jolly acquires the required app token": ["saleorEndpoint", "saleorCloud"],
  // 014-jolly-doctor-diagnostics
  // The Cloud-token validity probe authenticates a read-only GET of the Cloud
  // API organizations endpoint, so it needs only the Cloud staff token.
  "Doctor validates the Saleor Cloud token, not just its presence": ["saleorCloud"],
  "Doctor checks Saleor connectivity": ["saleorEndpoint"],
  "Doctor checks storefront readiness": ["saleorEndpoint"],
  "Doctor checks deployment and payment readiness": ["stripe"],
  // The vercel-auth "logged in" case needs only a real authenticated Vercel CLI
  // session (a capability gated via VERCEL_CLI_SCENARIOS) — no JOLLY_* credential.
  "Doctor confirms the Vercel CLI login state when a session exists": [],
  // The vercel-auth "names the account" case likewise needs only a real
  // authenticated Vercel CLI session (gated via VERCEL_CLI_SCENARIOS).
  "Doctor names the authenticated Vercel account": [],
  "Jolly start runs doctor automatically": FULL_END_TO_END,
  // 018-jolly-auth-commands
  // The failed-exchange and invalid-token scenarios need only outbound
  // network (real requests, really rejected) — no credentials at all.
  "A failed OAuth code exchange is reported honestly": [],
  "Jolly login rejects an invalid token gracefully": [],
  "Jolly login verifies a headless token against the Cloud API": ["saleorCloud"],
  "Jolly login --token-file verifies the file's token against the Cloud API": ["saleorCloud"],
  // 024-jolly-app-token-acquisition
  "Jolly create app-token acquires a real, fully-permissioned token from Saleor": [
    "saleorEndpoint",
    "saleorCloud",
  ],
  // 012-existing-saleor-store-connection
  "Jolly creates a Saleor Cloud environment": ["saleorCloud"],
  "Jolly create store handles domain name collision": ["saleorCloud"],
  // 026-live-by-design-verification
  // The eval's pre-run capacity reclamation drives only the Cloud API (list +
  // delete environments); the Cloud token alone is required.
  "The eval reclaims a leftover jolly-test environment before a run provisions": [
    "saleorCloud",
  ],
  // The @sandbox provisioner's leftover reclamation drives only the Cloud API
  // (list + delete) and Jolly's own create-environment path; the Cloud token
  // alone is required. NOT derivable, so the Before hook does not pre-provision a
  // shared environment before this scenario seeds its leftover.
  "The @sandbox provisioner reclaims a leftover jolly-test environment instead of skipping the run": [
    "saleorCloud",
  ],
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
 * Scenarios that additionally need a Vercel deployment, hence an authenticated
 * Vercel CLI session (`npx vercel whoami` exit 0). Vercel is not a Jolly
 * credential — the agent runs the Vercel CLI under its own `vercel login`
 * session (decision 2026-06-13) — so this is gated as a capability separate
 * from the JOLLY_* credential groups.
 */
export const VERCEL_CLI_SCENARIOS: ReadonlySet<string> = new Set([
  "Jolly start completes successfully",
  "Jolly start orchestrates the setup by spawning the official CLIs",
  "Jolly start deploys to Vercel by spawning the official Vercel CLI",
  // The whole-flow run deploys the storefront to Vercel as its final stage.
  "One jolly start drives the whole flow from a real agent's starting state",
  "Agent verifies checkout readiness",
  "Doctor checks deployment and payment readiness",
  "Doctor confirms the Vercel CLI login state when a session exists",
  "Doctor names the authenticated Vercel account",
  "Jolly start runs doctor automatically",
  "Jolly start resumes from the first incomplete stage",
  "Composed subcommands and start agree on state",
]);

export function requiresVercelCli(scenarioName: string): boolean {
  return VERCEL_CLI_SCENARIOS.has(scenarioName);
}

/**
 * Whether a Vercel CLI session is authenticated, the harness gate for
 * deployment-touching @sandbox scenarios (decision 2026-06-13): `npx vercel
 * whoami` exiting 0. No Jolly env var is involved. Best-effort and harmless —
 * a read-only identity probe; any spawn failure reads as "not authenticated".
 */
export function vercelCliAuthenticated(): boolean {
  try {
    const result = spawnSync("npx", ["vercel", "whoami"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * The logged-in Vercel account reported by `npx vercel whoami` (the last
 * non-empty stdout line, trimmed), or "" when no session. Read-only identity
 * probe, the same spawn as vercelCliAuthenticated; used to assert doctor's
 * vercel-auth check names the real account. Any spawn failure reads as "".
 */
export function vercelWhoamiAccount(): string {
  try {
    const result = spawnSync("npx", ["vercel", "whoami"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return "";
    const lines = (result.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length > 0 ? lines[lines.length - 1]! : "";
  } catch {
    return "";
  }
}

/**
 * Pre-create a `jolly-test`-namespaced Vercel project so the deploy stage's
 * `vercel deploy --project <name>` targets it (the CLI's `--project` requires an
 * existing project). Best-effort and never throws; an already-existing project or
 * an unauthenticated CLI is a no-op. Goes through the official Vercel CLI under
 * its own session — never api.vercel.com.
 */
export function addVercelProject(name: string): void {
  try {
    spawnSync("npx", ["vercel", "project", "add", name], {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // best-effort
  }
}

/**
 * Best-effort teardown of a `jolly-test`-namespaced Vercel project a deploy
 * created (harmless-by-design: every created resource is namespaced and removed,
 * AGENTS.md). `vercel project remove` prompts "Are you sure?" with no skip flag,
 * so answer it via stdin. Goes through the official Vercel CLI under its own
 * session — never api.vercel.com. Idempotent and never throws.
 */
export function removeVercelProject(name: string): void {
  try {
    spawnSync("npx", ["vercel", "project", "remove", name], {
      input: "y\n",
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // best-effort
  }
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

/**
 * Groups whose variables the harness can DERIVE when they are not configured
 * but `JOLLY_SALEOR_CLOUD_TOKEN` is present: it provisions one shared
 * per-run `jolly-test` environment and reads the endpoint URL and app token
 * from it (features 023 + 012). Everything else — the Cloud token itself,
 * Vercel, Stripe — cannot be derived and stays a skip condition.
 */
export const DERIVABLE_GROUPS: readonly CredentialGroup[] = [
  "saleorEndpoint",
  "saleorAppToken",
];

export interface CredentialGate {
  /** Absent and underivable: the scenario skips, naming exactly these. */
  missing: string[];
  /** Absent but derivable by provisioning the shared per-run environment. */
  derivable: string[];
}

/**
 * Split a scenario's absent credentials into underivable (skip) and
 * derivable (provision) sets. Derivation requires `JOLLY_SALEOR_CLOUD_TOKEN`;
 * without it the endpoint/app-token variables are plain skip conditions.
 */
export function classifyCredentials(
  groups: readonly CredentialGroup[],
  env: Record<string, string | undefined> = process.env,
): CredentialGate {
  const cloudPresent = missingCredentials(["saleorCloud"], env).length === 0;
  const missing: string[] = [];
  const derivable: string[] = [];
  for (const group of groups) {
    for (const name of CREDENTIAL_GROUPS[group]) {
      const value = env[name];
      if (value !== undefined && value.trim() !== "") continue;
      if (cloudPresent && DERIVABLE_GROUPS.includes(group)) derivable.push(name);
      else missing.push(name);
    }
  }
  return {
    missing: [...new Set(missing)],
    derivable: [...new Set(derivable)],
  };
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
