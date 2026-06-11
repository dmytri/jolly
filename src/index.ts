#!/usr/bin/env bun
// Jolly CLI entry point.
//
// Implements the agent-first command surface (feature 006), the grouped
// `create` subcommands (feature 008), the shared output envelope
// (feature 020), and the structured riskContext for impactful actions
// (features 010 and 021). Every command emits one envelope; with --json
// stdout carries only the envelope; default mode adds concise human text;
// --quiet trims nonessential human text. Secrets are never printed and are
// referenced by environment-variable name only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncAgentAssets, type AgentAssetSync, type AssetStatus } from "./lib/agent-assets.ts";

const JOLLY_VERSION = "0.1.0";

// --- Output envelope (feature 020) ------------------------------------------

type EnvelopeStatus = "success" | "warning" | "error";
type CheckStatus = "pass" | "warning" | "fail" | "skipped" | "unknown";

interface NextStep {
  description: string;
  command?: string;
}

interface Check {
  id: string;
  status: CheckStatus;
  detail?: string;
  remediation?: string;
}

interface ErrorEntry {
  code: string;
  message: string;
  remediation?: string;
}

interface Envelope {
  command: string;
  status: EnvelopeStatus;
  summary: string;
  data: Record<string, unknown>;
  checks: Check[];
  nextSteps: NextStep[];
  errors: ErrorEntry[];
}

// --- Risk context (features 010 and 021) ------------------------------------

type RiskLevel = "low" | "medium" | "high";

// Feature 010 high-risk category vocabulary.
type RiskCategory =
  | "destructive operations"
  | "billing"
  | "payment setup"
  | "credential handling"
  | "live deployment"
  | "production configuration changes";

interface RiskContext {
  action: string;
  target: { resource: string; scope: string };
  riskLevel: RiskLevel;
  categories: RiskCategory[];
  reversible: boolean;
  sideEffects: string[];
  dryRunAvailable: boolean;
}

// Identical for --dry-run preview and real execution (feature 021).
const RISK_CONTEXTS: Record<string, RiskContext> = {
  store: {
    action: "create store",
    target: { resource: "saleor-cloud-store", scope: "Saleor Cloud account" },
    riskLevel: "medium",
    categories: ["billing"],
    reversible: true,
    sideEffects: ["Creates a new Saleor Cloud store/project/environment in the customer's account"],
    dryRunAvailable: true,
  },
  storefront: {
    action: "create storefront",
    target: { resource: "storefront-directory", scope: "local project directory ./storefront" },
    riskLevel: "low",
    categories: [],
    reversible: true,
    sideEffects: ["Clones the Saleor Paper storefront template into the target directory"],
    dryRunAvailable: true,
  },
  recipe: {
    action: "create recipe",
    target: { resource: "configurator-recipe", scope: "connected Saleor environment" },
    riskLevel: "medium",
    categories: ["production configuration changes"],
    reversible: true,
    sideEffects: ["Applies the Jolly Configurator starter recipe to the store configuration"],
    dryRunAvailable: true,
  },
  deployment: {
    action: "create deployment",
    target: { resource: "vercel-deployment", scope: "Vercel project for the storefront" },
    riskLevel: "high",
    categories: ["live deployment", "credential handling"],
    reversible: true,
    sideEffects: ["Creates a Vercel project and deploys the storefront to a public URL"],
    dryRunAvailable: true,
  },
};

// --- Flag parsing -------------------------------------------------------------

interface Flags {
  json: boolean;
  quiet: boolean;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): { positionals: string[]; flags: Flags } {
  const flags: Flags = { json: false, quiet: false, yes: false, dryRun: false, help: false };
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg === "--json") flags.json = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else positionals.push(arg);
  }
  return { positionals, flags };
}

// --- Output -------------------------------------------------------------------

function emit(envelope: Envelope, flags: Flags): void {
  const json = JSON.stringify(envelope, null, 2);
  if (flags.json) {
    // Machine mode: stdout is exactly one JSON envelope and nothing else.
    process.stdout.write(`${json}\n`);
  } else {
    if (!flags.quiet) {
      const lines = [envelope.summary];
      for (const step of envelope.nextSteps) {
        lines.push(`Next: ${step.description}${step.command ? ` — run \`${step.command}\`` : ""}`);
      }
      process.stdout.write(`${lines.join("\n")}\n\n`);
    }
    process.stdout.write(`${json}\n`);
  }
  process.exitCode = envelope.status === "error" ? 1 : 0;
}

// --- Help text ------------------------------------------------------------------

const ROOT_HELP = `Jolly — Saleor's Hydrogen for the agentic age.

Usage: jolly <command> [options]

Commands:
  init         Set up the current project for agent-driven Saleor work
  create       Create Saleor, storefront, and deployment resources (grouped subcommands)
  start        Optional convenience orchestration for the full end-to-end setup flow
  skills       Manage agent skills for the iteration phase
  deploy       Set up and run the Vercel deployment (alias for deployment setup)
  doctor       Run diagnostics and report structured check results
  upgrade      Upgrade Jolly-managed project pieces
  login        Authenticate with Saleor Cloud (browser OAuth or headless token flow)
  logout       Remove stored Saleor Cloud credentials
  auth status  Show authentication status without exposing secret values

Options:
  --json       Print only the machine-readable output envelope
  --quiet      Trim nonessential human-readable text
  --yes, -y    Skip Jolly prompts where the agent environment allows
  --dry-run    Preview side effects without performing them (side-effecting commands)
  --help, -h   Show help
`;

const CREATE_HELP = `Usage: jolly create <subcommand> [options]

Create one specific resource. Each subcommand owns exactly one resource
boundary so agents and humans can act intentionally.

Subcommands:
  store        Create a Saleor Cloud store/project/environment
  storefront   Clone and configure the Saleor Paper storefront (default directory: storefront)
  recipe       Prepare or apply the Jolly Configurator starter recipe
  deployment   Set up the Vercel deployment for the storefront

Options:
  --json       Print only the machine-readable output envelope
  --quiet      Trim nonessential human-readable text
  --yes, -y    Skip Jolly prompts where the agent environment allows
  --dry-run    Preview side effects (including riskContext) without performing them
  --help, -h   Show help
`;

const SKILLS_HELP = `Usage: jolly skills <subcommand> [options]

Manage the Jolly-managed Saleor agent skills. Skills are installed in the
standard project-local skills/ directory; installed versions are recorded in
skills/skills-lock.json so version management stays centralized in Jolly.

Subcommands:
  install      Install or check the default Saleor skill set and agent glue
  update       Update installed Jolly-managed skills to their current versions

Options:
  --json       Print only the machine-readable output envelope
  --quiet      Trim nonessential human-readable text
  --yes, -y    Skip Jolly prompts where the agent environment allows
  --dry-run    Preview what would be installed or updated without writing
  --help, -h   Show help
`;

// --- Environment helpers (values are never printed; names only) ---------------

/** Parse a dotenv-style file into a name → value record (empty when absent). */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/** True when the named variable is set in the process env or the project .env. */
function envPresent(name: string, dotenv: Record<string, string>): boolean {
  return Boolean(process.env[name] ?? dotenv[name]);
}

// --- Commands -------------------------------------------------------------------

// Doctor check groups (feature 014). Check ids are namespaced by group:
// `cli.*` for the doctor's own CLI checks plus the five targetable v1 groups.
const DOCTOR_GROUPS = ["skills", "saleor", "storefront", "deployment", "stripe"] as const;
type DoctorGroup = (typeof DOCTOR_GROUPS)[number];

function cliChecks(): Check[] {
  const runtime = (process.versions as Record<string, string | undefined>).bun
    ? `Bun ${(process.versions as Record<string, string | undefined>).bun}`
    : `Node.js ${process.versions.node}`;
  return [
    {
      id: "cli.version",
      status: "pass",
      detail: `Jolly CLI version ${JOLLY_VERSION} is available (runtime: ${runtime})`,
    },
  ];
}

function skillsChecks(cwd: string): Check[] {
  const skillsInstalled = [".claude/skills", "skills"].some((dir) => existsSync(join(cwd, dir)));
  const guidancePresent = ["AGENTS.md", "CLAUDE.md"].some((file) => existsSync(join(cwd, file)));
  return [
    {
      id: "skills.installed",
      status: skillsInstalled ? "pass" : "warning",
      detail: skillsInstalled
        ? "Jolly agent skills are installed in this project"
        : "No Jolly agent skills are installed in this project",
      ...(skillsInstalled ? {} : { remediation: "Run `jolly init` to install the Jolly agent skills" }),
    },
    {
      id: "skills.agentGuidance",
      status: guidancePresent ? "pass" : "warning",
      detail: guidancePresent
        ? "Supported agent guidance file found (AGENTS.md or CLAUDE.md)"
        : "No supported agent guidance file (AGENTS.md or CLAUDE.md) found in this project",
      ...(guidancePresent ? {} : { remediation: "Run `jolly init` to set up agent guidance for this project" }),
    },
  ];
}

function saleorChecks(dotenv: Record<string, string>): Check[] {
  const endpointConfigured = envPresent("NEXT_PUBLIC_SALEOR_API_URL", dotenv);
  const appTokenPresent = envPresent("JOLLY_SALEOR_APP_TOKEN", dotenv);
  return [
    {
      id: "saleor.connectivity",
      status: endpointConfigured ? "unknown" : "skipped",
      detail: endpointConfigured
        ? "A Saleor GraphQL endpoint is configured (NEXT_PUBLIC_SALEOR_API_URL); live connectivity validation is not implemented yet"
        : "No Saleor GraphQL endpoint is configured (NEXT_PUBLIC_SALEOR_API_URL); connectivity was not checked",
      ...(endpointConfigured ? {} : { remediation: "Run `jolly init` or set NEXT_PUBLIC_SALEOR_API_URL to enable Saleor connectivity checks" }),
    },
    {
      id: "saleor.env",
      status: endpointConfigured ? "pass" : "warning",
      detail: endpointConfigured
        ? "Required Saleor environment variables are present (values are never printed)"
        : "Required Saleor environment variable NEXT_PUBLIC_SALEOR_API_URL is missing",
      ...(endpointConfigured ? {} : { remediation: "Run `jolly init` to configure the Saleor environment variables in .env" }),
    },
    {
      id: "saleor.appToken",
      status: appTokenPresent ? "pass" : "warning",
      detail: appTokenPresent
        ? "App token JOLLY_SALEOR_APP_TOKEN is set (value not printed)"
        : "App token JOLLY_SALEOR_APP_TOKEN is not set",
      ...(appTokenPresent ? {} : { remediation: "Run `jolly login` to acquire Saleor Cloud credentials" }),
    },
    {
      id: "saleor.introspection",
      status: "skipped",
      detail: "Configurator introspection was not run; it compares the live store configuration with the local recipe",
      remediation: "Run Configurator introspection against the connected Saleor environment to verify store configuration",
    },
  ];
}

function storefrontChecks(cwd: string, dotenv: Record<string, string>): Check[] {
  const dir = join(cwd, "storefront");
  const present = existsSync(dir);
  const paperEnvConfigured = envPresent("NEXT_PUBLIC_SALEOR_API_URL", dotenv);
  const recipePresent = present && [".jolly", "recipe.yml", "jolly-recipe.yml"].some((entry) => existsSync(join(dir, entry)));
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const engines = paperNodeRequirement(dir);
  return [
    {
      id: "storefront.present",
      status: present ? "pass" : "warning",
      detail: present
        ? "Storefront directory found in this project"
        : "No storefront directory found in this project",
      ...(present ? {} : { remediation: "Run `jolly create storefront` to scaffold the Saleor Paper storefront" }),
    },
    {
      id: "storefront.env",
      status: !present ? "skipped" : paperEnvConfigured ? "pass" : "fail",
      detail: !present
        ? "No storefront present; Paper environment variables were not checked"
        : paperEnvConfigured
          ? "Required Paper environment variables are present (values are never printed)"
          : "Required Paper environment variable NEXT_PUBLIC_SALEOR_API_URL is missing",
      ...(present && !paperEnvConfigured
        ? { remediation: "Run `jolly init` to configure the Paper storefront environment variables in .env" }
        : {}),
    },
    {
      id: "storefront.nodeVersion",
      status: !present ? "skipped" : engines === undefined ? "unknown" : nodeSatisfies(nodeMajor, engines) ? "pass" : "warning",
      detail: !present
        ? "No storefront present; the Node.js version requirement was not checked"
        : engines === undefined
          ? `Local Node.js major version is ${nodeMajor}; the storefront does not declare a Node.js requirement`
          : `Local Node.js major version is ${nodeMajor}; the storefront requires ${engines}`,
      ...(present && engines !== undefined && !nodeSatisfies(nodeMajor, engines)
        ? { remediation: `Install a Node.js version satisfying ${engines} for the Paper storefront` }
        : {}),
    },
    {
      id: "storefront.recipe",
      status: !present ? "skipped" : recipePresent ? "pass" : "warning",
      detail: !present
        ? "No storefront present; the Jolly starter recipe check was skipped"
        : recipePresent
          ? "The Jolly starter recipe exists in the cloned storefront repository"
          : "The Jolly starter recipe was not found in the cloned storefront repository",
      ...(present && !recipePresent ? { remediation: "Run `jolly create recipe` to prepare the Jolly Configurator starter recipe" } : {}),
    },
    {
      id: "storefront.readiness",
      status: "skipped",
      detail: "Product browsing, cart, and checkout readiness checks require a configured Saleor endpoint and were not performed",
      remediation: "Configure the Saleor endpoint, then re-run `jolly doctor storefront` to check browsing, cart, and checkout readiness",
    },
  ];
}

function paperNodeRequirement(storefrontDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(storefrontDir, "package.json"), "utf8"));
    const node = pkg?.engines?.node;
    return typeof node === "string" ? node : undefined;
  } catch {
    return undefined;
  }
}

function nodeSatisfies(localMajor: number, requirement: string): boolean {
  const match = /(\d+)/.exec(requirement);
  if (!match) return true;
  const requiredMajor = Number.parseInt(match[1], 10);
  return requirement.includes(">=") ? localMajor >= requiredMajor : localMajor === requiredMajor;
}

function deploymentChecks(dotenv: Record<string, string>): Check[] {
  const vercelToken = envPresent("JOLLY_VERCEL_TOKEN", dotenv);
  return [
    {
      id: "deployment.vercel",
      status: vercelToken ? "unknown" : "skipped",
      detail: vercelToken
        ? "Vercel credentials are available (JOLLY_VERCEL_TOKEN); live deployment configuration validation is not implemented yet"
        : "Vercel credentials are not available (JOLLY_VERCEL_TOKEN); deployment configuration was not checked",
      ...(vercelToken ? {} : { remediation: "Set JOLLY_VERCEL_TOKEN to enable Vercel deployment checks" }),
    },
    {
      id: "deployment.env",
      status: vercelToken ? "unknown" : "skipped",
      detail: vercelToken
        ? "Required Vercel environment variable configuration validation is not implemented yet"
        : "Vercel credentials are not available; required Vercel environment variables were not checked",
    },
    {
      id: "deployment.trustedOrigins",
      status: "skipped",
      detail: "Saleor trusted origins were not checked against the deployed storefront URL (no deployment context available)",
      remediation: "Deploy the storefront, then re-run `jolly doctor deployment` to verify Saleor trusted origins",
    },
  ];
}

function stripeChecks(dotenv: Record<string, string>): Check[] {
  const secretKey = process.env.JOLLY_STRIPE_SECRET_KEY ?? dotenv.JOLLY_STRIPE_SECRET_KEY;
  const status: CheckStatus = !secretKey ? "warning" : secretKey.startsWith("sk_test_") ? "pass" : "warning";
  return [
    {
      id: "stripe.testMode",
      status,
      detail: !secretKey
        ? "Stripe credentials are not set (JOLLY_STRIPE_SECRET_KEY); Stripe test-mode setup was not verified"
        : secretKey.startsWith("sk_test_")
          ? "JOLLY_STRIPE_SECRET_KEY is a test-mode key (value not printed)"
          : "JOLLY_STRIPE_SECRET_KEY does not look like a test-mode key; v1 first-run validation expects Stripe test mode",
      remediation: !secretKey
        ? "Set JOLLY_STRIPE_SECRET_KEY to a Stripe test-mode key to enable payment checks"
        : secretKey.startsWith("sk_test_")
          ? undefined
          : "Use a Stripe test-mode key (sk_test_...) for first-run validation",
    },
  ];
}

function runDoctor(group: string | undefined, flags: Flags): void {
  if (group !== undefined && !DOCTOR_GROUPS.includes(group as DoctorGroup)) {
    emit(
      {
        command: "doctor",
        status: "error",
        summary: `Unknown doctor check group "${group}". Supported groups: ${DOCTOR_GROUPS.join(", ")}.`,
        data: { supportedGroups: [...DOCTOR_GROUPS] },
        checks: [],
        nextSteps: [{ description: "Run all diagnostics", command: "jolly doctor" }],
        errors: [
          {
            code: "doctor.unknownGroup",
            message: `Unknown doctor check group "${group}".`,
            remediation: `Use one of the supported check groups: ${DOCTOR_GROUPS.join(", ")} — or run \`jolly doctor\` for all checks.`,
          },
        ],
      },
      flags,
    );
    return;
  }

  const cwd = process.cwd();
  const dotenv = parseEnvFile(join(cwd, ".env"));
  const byGroup: Record<DoctorGroup, () => Check[]> = {
    skills: () => skillsChecks(cwd),
    saleor: () => saleorChecks(dotenv),
    storefront: () => storefrontChecks(cwd, dotenv),
    deployment: () => deploymentChecks(dotenv),
    stripe: () => stripeChecks(dotenv),
  };

  // A named group runs only that group's checks; bare doctor runs everything.
  const checks: Check[] = group
    ? byGroup[group as DoctorGroup]()
    : [...cliChecks(), ...DOCTOR_GROUPS.flatMap((g) => byGroup[g]())];

  const count = (status: CheckStatus) => checks.filter((c) => c.status === status).length;
  const passed = count("pass");
  const warned = count("warning");
  const failed = count("fail");
  const skipped = count("skipped");
  const unknown = count("unknown");

  // Doctor is diagnostics-only: every non-passing check suggests a concrete
  // next command or manual step (deduplicated into nextSteps).
  const nextSteps: NextStep[] = [];
  for (const check of checks) {
    if ((check.status === "fail" || check.status === "warning") && check.remediation) {
      if (!nextSteps.some((step) => step.description === check.remediation)) {
        nextSteps.push({ description: check.remediation });
      }
    }
  }

  emit(
    {
      command: group ? `doctor ${group}` : "doctor",
      status: failed > 0 || warned > 0 ? "warning" : "success",
      summary: `jolly doctor${group ? ` ${group}` : ""} ran ${checks.length} checks: ${passed} passed, ${warned} warnings, ${failed} failed, ${skipped} skipped, ${unknown} unknown.`,
      data: {
        cliVersion: JOLLY_VERSION,
        group: group ?? "all",
        checksTotal: checks.length,
        checksPassed: passed,
        checksWarning: warned,
        checksFailed: failed,
        checksSkipped: skipped,
        checksUnknown: unknown,
      },
      checks,
      nextSteps,
      errors: [],
    },
    flags,
  );
}

// Jolly-managed Saleor Cloud auth variable names (feature 018). Logout edits
// exactly these in .env; unrelated and third-party variables are untouched.
const SALEOR_AUTH_ENV_NAMES = ["JOLLY_SALEOR_CLOUD_TOKEN", "JOLLY_SALEOR_APP_TOKEN"];

function runAuthStatus(flags: Flags): void {
  const dotenv = parseEnvFile(join(process.cwd(), ".env"));
  const credentialNames = [...SALEOR_AUTH_ENV_NAMES, "JOLLY_STRIPE_SECRET_KEY", "JOLLY_VERCEL_TOKEN"];
  const credentials = credentialNames.map((name) => ({ name, present: envPresent(name, dotenv) }));
  const configured = SALEOR_AUTH_ENV_NAMES.some((name) => envPresent(name, dotenv));
  const configuredNames = SALEOR_AUTH_ENV_NAMES.filter((name) => envPresent(name, dotenv));

  emit(
    {
      command: "auth status",
      status: "success",
      summary: configured
        ? `Saleor Cloud authentication is configured (${configuredNames.join(", ")} set; secret values are never printed).`
        : "Saleor Cloud authentication is not configured: no Jolly-managed Saleor Cloud token is set.",
      data: {
        configured,
        // Account/organization context is reported where safe; resolving it
        // requires a live Saleor Cloud lookup, so it is unknown (null) here.
        account: null,
        organization: null,
        credentials,
      },
      checks: [],
      nextSteps: configured
        ? []
        : [{ description: "Authenticate with Saleor Cloud", command: "jolly login" }],
      errors: [],
    },
    flags,
  );
}

function runLogout(flags: Flags): void {
  const envPath = join(process.cwd(), ".env");
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
  const removed: string[] = [];

  const kept = lines.filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && SALEOR_AUTH_ENV_NAMES.includes(match[1])) {
      removed.push(match[1]);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    writeFileSync(envPath, kept.join("\n"));
  }

  emit(
    {
      command: "logout",
      status: "success",
      summary:
        removed.length > 0
          ? `Logged out of Saleor Cloud: removed ${removed.join(", ")} from .env (values are never printed). Unrelated variables were left untouched.`
          : "Already logged out: no Jolly-managed Saleor Cloud auth values were found in .env.",
      data: { removed, envFile: ".env", configured: false },
      checks: [],
      nextSteps: [{ description: "Authenticate with Saleor Cloud again when needed", command: "jolly login" }],
      errors: [],
    },
    flags,
  );
}

/** `jolly create <sub>` and the `jolly deploy` alias for deployment setup. */
function runCreate(commandName: string, subcommand: string, flags: Flags): void {
  const riskContext = RISK_CONTEXTS[subcommand];

  if (flags.dryRun) {
    emit(
      {
        command: commandName,
        status: "success",
        summary: `Dry run: jolly would ${riskContext.action.replace(/^create /, "create the ")} (${riskContext.target.resource}). No changes were made; review riskContext to decide whether approval is needed.`,
        data: { dryRun: true, riskContext },
        checks: [],
        nextSteps: [
          {
            description: "Perform the action after the agent decides approval",
            command: `jolly ${commandName}`,
          },
        ],
        errors: [],
      },
      flags,
    );
    return;
  }

  if (subcommand === "storefront") {
    const targetDirectory = "storefront";
    const targetPath = join(process.cwd(), targetDirectory);
    if (existsSync(targetPath) && readdirSync(targetPath).length > 0) {
      emit(
        {
          command: commandName,
          status: "error",
          summary: `Target directory ./${targetDirectory} already exists and is not empty; nothing was cloned or overwritten.`,
          data: { dryRun: false, targetDirectory, riskContext },
          checks: [],
          nextSteps: [
            {
              description: `Choose a different target directory or empty ./${targetDirectory}, then re-run`,
              command: "jolly create storefront",
            },
          ],
          errors: [
            {
              code: "storefront.targetDirNotEmpty",
              message: `Target directory ./${targetDirectory} already exists and contains files Jolly did not create.`,
              remediation: `Choose a different target directory or empty ./${targetDirectory} before re-running \`jolly create storefront\`.`,
            },
          ],
        },
        flags,
      );
      return;
    }
  }

  emit(
    {
      command: commandName,
      status: "error",
      summary: `jolly ${commandName} execution is not implemented yet; preview it with --dry-run.`,
      data: { dryRun: false, riskContext },
      checks: [],
      nextSteps: [
        {
          description: "Preview the action and its riskContext",
          command: `jolly ${commandName} --dry-run`,
        },
      ],
      errors: [
        {
          code: "jolly.notImplemented",
          message: `jolly ${commandName} execution is not implemented yet.`,
          remediation: `Use \`jolly ${commandName} --dry-run\` to preview the action.`,
        },
      ],
    },
    flags,
  );
}

/**
 * `jolly init` and `jolly skills install` (features 007 and 009): install or
 * check the default Saleor skill set in the standard project-local skills/
 * location and write agent-specific glue for supported environments. Local
 * agent setup only — no remote Saleor Cloud or Vercel resources, no secrets;
 * safe to re-run (existing assets are detected and reported, user-authored
 * instructions are never overwritten).
 */
function runAgentSetup(commandName: string, flags: Flags): void {
  const sync: AgentAssetSync = syncAgentAssets(process.cwd(), { write: !flags.dryRun });

  const countByStatus = (items: { status: AssetStatus }[]): string => {
    const order: AssetStatus[] = ["installed", "updated", "unchanged", "skipped"];
    return (
      order
        .map((status) => [status, items.filter((item) => item.status === status).length] as const)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${count} ${status}`)
        .join(", ") || "none"
    );
  };

  const summaryCore = `default Saleor skill set checked — skills: ${countByStatus(sync.skills)}; agent guidance: ${countByStatus(sync.guidance)} (versions recorded in ${sync.lockFile}).`;
  const nextSteps: NextStep[] = [
    { description: "Verify skill installation and agent guidance status", command: "jolly doctor skills" },
  ];
  if (commandName === "init") {
    nextSteps.push({ description: "Start the guided end-to-end setup", command: "jolly start" });
  }

  emit(
    {
      command: commandName,
      status: "success",
      summary: flags.dryRun
        ? `Dry run: jolly ${commandName} would install or update local agent assets — ${summaryCore} No files were written.`
        : `jolly ${commandName} completed local agent setup: ${summaryCore}`,
      data: { dryRun: flags.dryRun, ...sync },
      checks: [],
      nextSteps,
      errors: [],
    },
    flags,
  );
}

function runNotImplemented(commandName: string, flags: Flags): void {
  emit(
    {
      command: commandName,
      status: "error",
      summary: `jolly ${commandName} is not implemented yet.`,
      data: {},
      checks: [],
      nextSteps: [{ description: "List available commands", command: "jolly --help" }],
      errors: [
        {
          code: "jolly.notImplemented",
          message: `jolly ${commandName} is not implemented yet.`,
          remediation: "Run `jolly --help` to see available commands.",
        },
      ],
    },
    flags,
  );
}

// --- Entry point ------------------------------------------------------------------

function main(argv: string[]): void {
  const { positionals, flags } = parseArgs(argv);
  const [command, subcommand] = positionals;

  if (!command) {
    process.stdout.write(ROOT_HELP);
    return;
  }

  switch (command) {
    case "init":
      runAgentSetup("init", flags);
      return;
    case "skills":
      if (flags.help || !subcommand) {
        process.stdout.write(SKILLS_HELP);
        return;
      }
      if (subcommand === "install") {
        runAgentSetup("skills install", flags);
        return;
      }
      runNotImplemented(positionals.join(" "), flags);
      return;
    case "doctor":
      runDoctor(subcommand, flags);
      return;
    case "logout":
      runLogout(flags);
      return;
    case "auth":
      if (subcommand === "status") {
        runAuthStatus(flags);
        return;
      }
      runNotImplemented(positionals.join(" "), flags);
      return;
    case "create":
      if (flags.help || !subcommand) {
        process.stdout.write(CREATE_HELP);
        return;
      }
      if (subcommand in RISK_CONTEXTS) {
        runCreate(`create ${subcommand}`, subcommand, flags);
        return;
      }
      runNotImplemented(positionals.join(" "), flags);
      return;
    case "deploy":
      // Friendly top-level alias for deployment setup (feature 008).
      runCreate("deploy", "deployment", flags);
      return;
    default:
      if (flags.help) {
        process.stdout.write(ROOT_HELP);
        return;
      }
      runNotImplemented(positionals.join(" "), flags);
      return;
  }
}

main(process.argv.slice(2));
