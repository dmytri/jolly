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
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

// --- Commands -------------------------------------------------------------------

function runDoctor(flags: Flags): void {
  const cwd = process.cwd();
  const runtime = (process.versions as Record<string, string | undefined>).bun
    ? `Bun ${(process.versions as Record<string, string | undefined>).bun}`
    : `Node.js ${process.versions.node}`;

  const storefrontPresent = existsSync(join(cwd, "storefront"));
  const envFilePresent = existsSync(join(cwd, ".env"));

  const checks: Check[] = [
    {
      id: "runtime.version",
      status: "pass",
      detail: `JavaScript runtime detected: ${runtime}`,
    },
    {
      id: "project.storefront",
      status: storefrontPresent ? "pass" : "skipped",
      detail: storefrontPresent
        ? "Storefront directory found in this project"
        : "No storefront directory found in this project; storefront checks were skipped",
      ...(storefrontPresent
        ? {}
        : { remediation: "Run `jolly create storefront` to scaffold the Saleor Paper storefront" }),
    },
    {
      id: "env.file",
      status: envFilePresent ? "pass" : "skipped",
      detail: envFilePresent
        ? ".env file found (values are never printed; secrets are referenced by name only)"
        : "No .env file found; environment checks were skipped",
      ...(envFilePresent
        ? {}
        : { remediation: "Run `jolly init` to set up the project, including its .env file" }),
    },
  ];

  const passed = checks.filter((c) => c.status === "pass").length;
  const skipped = checks.filter((c) => c.status === "skipped").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  const nextSteps: NextStep[] = [];
  if (!storefrontPresent) {
    nextSteps.push({
      description: "Scaffold the Saleor Paper storefront",
      command: "jolly create storefront",
    });
  }

  emit(
    {
      command: "doctor",
      status: failed > 0 ? "warning" : "success",
      summary: `jolly doctor ran ${checks.length} checks: ${passed} passed, ${skipped} skipped, ${failed} failed.`,
      data: { checksTotal: checks.length, checksPassed: passed, checksSkipped: skipped, checksFailed: failed },
      checks,
      nextSteps,
      errors: [],
    },
    flags,
  );
}

function runAuthStatus(flags: Flags): void {
  const credentialNames = ["JOLLY_SALEOR_APP_TOKEN", "JOLLY_STRIPE_SECRET_KEY", "JOLLY_VERCEL_TOKEN"];
  const credentials = credentialNames.map((name) => ({
    name,
    present: Boolean(process.env[name]),
  }));
  const loggedIn = Boolean(process.env.JOLLY_SALEOR_APP_TOKEN);

  emit(
    {
      command: "auth status",
      status: "success",
      summary: loggedIn
        ? "Saleor Cloud: authenticated (credential JOLLY_SALEOR_APP_TOKEN is set). Secret values are never printed; credentials are referenced by name only."
        : "Saleor Cloud: not authenticated. Secret values are never printed; credentials are referenced by name only.",
      data: { loggedIn, credentials },
      checks: [],
      nextSteps: loggedIn
        ? []
        : [{ description: "Authenticate with Saleor Cloud", command: "jolly login" }],
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
    case "doctor":
      runDoctor(flags);
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
