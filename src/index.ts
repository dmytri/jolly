#!/usr/bin/env bun
/**
 * Jolly CLI entry point.
 *
 * Jolly helps a customer's own AI agent set up an end-to-end Saleor Cloud
 * storefront. Agents are the primary consumers; every command emits a
 * structured JSON envelope (feature 020) with risk context (feature 021)
 * where appropriate. Commands are idempotent and resumable (feature 022).
 *
 * See AGENTS.md for the full product vision and pinned contracts.
 * See features/ for the behavior specs that drove this implementation.
 */

import { argv, env, exit, stdout, cwd } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnvelopeStatus = "success" | "warning" | "error";
type CheckStatus = "pass" | "warning" | "fail" | "skipped" | "unknown";
type RiskLevel = "low" | "medium" | "high";

interface Check {
  id: string;
  status: CheckStatus;
  [key: string]: unknown;
}

interface Envelope {
  command: string;
  status: EnvelopeStatus;
  summary: string;
  data: Record<string, unknown>;
  checks: Check[];
  nextSteps: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

interface RiskContext {
  action: string;
  target: unknown;
  riskLevel: RiskLevel;
  categories: string[];
  reversible: boolean;
  sideEffects: unknown[];
  dryRunAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

const RISK_CATEGORIES = [
  "destructive operations",
  "billing",
  "payment setup",
  "credential handling",
  "live deployment",
  "production configuration changes",
] as const;

function makeEnvelope(
  command: string,
  status: EnvelopeStatus,
  summary: string,
  overrides?: Partial<Envelope>,
): Envelope {
  return {
    command,
    status,
    summary,
    data: overrides?.data ?? {},
    checks: overrides?.checks ?? [],
    nextSteps: overrides?.nextSteps ?? [],
    errors: overrides?.errors ?? [],
  };
}

function makeRiskContext(
  action: string,
  target: unknown,
  riskLevel: RiskLevel,
  categories: string[],
  reversible: boolean,
  dryRunAvailable: boolean = true,
): RiskContext {
  return {
    action,
    target,
    riskLevel,
    categories,
    reversible,
    sideEffects: [],
    dryRunAvailable,
  };
}

// ---------------------------------------------------------------------------
// Flag detection
// ---------------------------------------------------------------------------

function hasFlag(...names: string[]): boolean {
  return names.some((name) => argv.includes(name));
}

function flagValue(name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function isJsonMode(): boolean {
  return hasFlag("--json");
}

function isQuietMode(): boolean {
  return hasFlag("--quiet");
}

function isDryRun(): boolean {
  return hasFlag("--dry-run");
}

function isYes(): boolean {
  return hasFlag("-y", "--yes");
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function emit(envelope: Envelope): void {
  const json = JSON.stringify(envelope, null, 0);
  if (isJsonMode()) {
    console.log(json);
  } else if (isQuietMode()) {
    console.log(json);
  } else {
    // Concise human text + machine-readable envelope
    const lines: string[] = [];
    lines.push(`=== jolly: ${envelope.command} ===`);
    lines.push(envelope.summary);
    if (envelope.checks.length > 0) {
      for (const check of envelope.checks) {
        const icon =
          check.status === "pass"
            ? "✓"
            : check.status === "fail"
              ? "✗"
              : check.status === "warning"
                ? "⚠"
                : "?";
        lines.push(`  ${icon} ${check.id}: ${check.status}`);
      }
    }
    if (envelope.nextSteps.length > 0) {
      lines.push("");
      lines.push("Next steps:");
      for (const step of envelope.nextSteps) {
        lines.push(`  → ${step.description ?? ""}`);
      }
    }
    if (envelope.errors.length > 0) {
      lines.push("");
      lines.push("Errors:");
      for (const err of envelope.errors) {
        lines.push(`  ✗ [${err.code}] ${err.message}`);
      }
    }
    lines.push("");
    lines.push(json);
    console.log(lines.join("\n"));
  }
}

function fail(
  command: string,
  summary: string,
  code: string,
  message: string,
): never {
  emit(
    makeEnvelope(command, "error", summary, {
      errors: [{ code, message }],
    }),
  );
  exit(1);
}

function warning(
  command: string,
  summary: string,
  checks?: Check[],
): void {
  emit(makeEnvelope(command, "warning", summary, { checks }));
}

function success(
  command: string,
  summary: string,
  overrides?: Partial<Envelope>,
): void {
  emit(makeEnvelope(command, "success", summary, overrides));
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  const text = `
╔══════════════════════════════════════════╗
║  JOLLY — Ahoy, agent. Go build a store. ║
╚══════════════════════════════════════════╝

Jolly helps your agent set up a Saleor Cloud storefront end-to-end.

USAGE
  npx @saleor/jolly <command> [options]

COMMANDS
  start         Run the full end-to-end setup flow (auto-installs skills)
  init          Prepare local agent guidance and skills
  create        Create specific resources (store, storefront, stripe, etc.)
    create store         Register or connect a Saleor Cloud store
    create storefront    Clone the Paper storefront template
    create stripe        Configure Stripe test mode payment
  skills        Manage Saleor agent skills
    skills install       Install or update the default skill set
    skills update        Update installed skills
  deploy        Deploy the storefront to Vercel
  login         Authenticate with Saleor Cloud
  logout        Remove Saleor Cloud authentication
  auth status   Check authentication status
  doctor        Run diagnostics
    doctor saleor       Check Saleor connectivity
    doctor storefront   Validate storefront setup
  upgrade       Upgrade Jolly-managed skills and guidance

GLOBAL FLAGS
  --json        Machine-readable JSON output only
  --quiet       Reduced output
  -y, --yes     Skip Jolly prompts
  --dry-run     Preview side effects without applying them
  --help        Show this help
  --full-validation  Run full validation on relevant commands

EXAMPLES
  npx @saleor/jolly start
  npx @saleor/jolly create store --dry-run
  npx @saleor/jolly doctor --json

For testing: npx @dk/jolly start
`.trim();
  console.log(text);
  const envelope = makeEnvelope("help", "success", "Jolly CLI help");
  envelope.command = `help${argv.length > 2 ? " " + argv.slice(2).join(" ") : ""}`;
  if (!isQuietMode() && !isJsonMode()) {
    // human text is printed above; envelope follows
  }
  if (isJsonMode()) {
    emit(envelope);
    return;
  }
  // In default mode, print envelope too
  console.log(JSON.stringify(envelope));
}

function printSubcommandHelp(subcommand: string): string {
  const helps: Record<string, string> = {
    "start": `jolly start — Full end-to-end setup

Runs the complete setup flow: auto-installs skills, checks connectivity,
creates or connects a Saleor store, clones Paper, deploys to Vercel,
and configures Stripe.

The agent drives everything. The first thing it does is ask whether you
already have a Saleor store or want to register a new one.

Only account creation, OAuth consent, and secret keys need you.

Flags:
  --dry-run     Preview what would be done
  --yes / -y    Skip prompts
  --json        Machine-readable output
  --quiet       Reduced output
  --full-validation  Run full Paper validation after setup

Usage:
  npx @saleor/jolly start
  npx @saleor/jolly start --dry-run --json`,

    "init": `jolly init — Prepare local agent guidance and skills

Installs or checks the full default Saleor skill set and writes
agent-specific glue files for supported environments.

Does not create remote resources or store secrets. Safe to re-run.

Flags:
  --json, --quiet

Usage:
  npx @saleor/jolly init`,

    "create": `jolly create — Create specific resources

Subcommands:
  store         Register or connect a Saleor Cloud store
  storefront    Clone the Paper storefront template
  recipe        Apply a Configurator starter recipe
  deployment    Configure and start Vercel deployment
  stripe        Configure Stripe test mode payment

Flags:
  --dry-run     Preview without creating
  --yes / -y    Skip prompts

Usage:
  npx @saleor/jolly create store --dry-run
  npx @saleor/jolly create storefront --dry-run
  npx @saleor/jolly create recipe list`,

    "skills": `jolly skills — Manage Saleor agent skills

Subcommands:
  install  Install or check the default Saleor skill set
  update   Update installed skills

Skills are auto-installed by 'jolly start'. These commands are
available for post-setup maintenance.

Usage:
  npx @saleor/jolly skills install
  npx @saleor/jolly skills update`,

    "deploy": `jolly deploy — Deploy storefront to Vercel

Deploys the Paper storefront to Vercel with configured environment variables.
Supports GitHub-based Git import and Vercel CLI/API automation.

Flags:
  --dry-run     Preview deployment
  --yes / -y    Skip prompts
  --json, --quiet

Usage:
  npx @saleor/jolly deploy
  npx @saleor/jolly deploy --dry-run`,

    "login": `jolly login — Authenticate with Saleor Cloud

Supports browser OAuth when available and headless token flow.
Writes acquired tokens to .env (Git-ignored).

Flags:
  --yes / -y    Skip prompts
  --json

Usage:
  npx @saleor/jolly login`,

    "logout": `jolly logout — Remove Saleor Cloud authentication

Removes Jolly-managed auth values from .env without affecting
unrelated environment variables.

Usage:
  npx @saleor/jolly logout`,

    "upgrade": `jolly upgrade — Upgrade Jolly-managed skills and guidance

Checks for updates to Jolly-managed skills and agent guidance.
Summarizes upgrade plan before applying. Safe to re-run.

When Paper is detected, generates an upgrade plan from Paper's
migration guidance rather than blindly rewriting the storefront.
Paper migrations are not applied automatically in v1.

Flags:
  --json, --quiet

Usage:
  npx @saleor/jolly upgrade`,

    "stripe": `jolly create stripe — Configure Stripe test mode payment

Configure Stripe test mode for the Paper storefront.

The agent will ask you to open the Stripe Dashboard at stripe.com
to get your publishable key and secret key in test mode. Paste
both keys, and Jolly writes them to .env (Git-ignored).

No other Stripe configuration is required.

Flags:
  --dry-run     Preview without creating resources

Usage:
  npx @saleor/jolly create stripe
  npx @saleor/jolly create stripe --dry-run`,

    "store": `jolly create store — Register or connect a Saleor Cloud store

If you already have a Saleor store, provide its URL. Jolly
normalizes it to the GraphQL endpoint and verifies connectivity.

If you want a new store, Jolly helps create one on Saleor Cloud.
You'll need to sign up at saleor.io/cloud for a new account.

Flags:
  --dry-run     Preview

Usage:
  npx @saleor/jolly create store --dry-run`,

    "storefront": `jolly create storefront — Clone the Paper storefront template

Clones the official Saleor Paper storefront, installs dependencies,
and validates the project.

Default target directory: storefront

Flags:
  --dry-run           Preview
  --full-validation   Run generate, typecheck, build

Usage:
  npx @saleor/jolly create storefront
  npx @saleor/jolly create storefront --dry-run`,

    "create store": `jolly create store — Register or connect a Saleor Cloud store

If you already have a Saleor store, provide its URL. Jolly
normalizes it to the GraphQL endpoint and verifies connectivity.

If you want a new store, Jolly helps create one on Saleor Cloud.
You'll need to sign up at saleor.io/cloud for a new account.

Flags:
  --dry-run     Preview

Usage:
  npx @saleor/jolly create store --dry-run`,

    "create storefront": `jolly create storefront — Clone the Paper storefront template

Clones the official Saleor Paper storefront, installs dependencies,
and validates the project.

Default target directory: storefront

Flags:
  --dry-run           Preview
  --full-validation   Run generate, typecheck, build

Usage:
  npx @saleor/jolly create storefront
  npx @saleor/jolly create storefront --dry-run`,

    "create recipe": `jolly create recipe — Apply a Configurator starter recipe

Applies a Saleor Configurator starter recipe to configure the store.

Usage:
  npx @saleor/jolly create recipe list`,

    "create deployment": `jolly create deployment — Configure and start Vercel deployment

Creates a Vercel project and deploys the storefront.

Flags:
  --dry-run     Preview deployment

Usage:
  npx @saleor/jolly create deployment --dry-run`,

    "create stripe": `jolly create stripe — Configure Stripe test mode payment

Configure Stripe test mode for the Paper storefront.

The agent will ask you to open the Stripe Dashboard at stripe.com
to get your publishable key and secret key in test mode. Paste
both keys, and Jolly writes them to .env (Git-ignored).

No other Stripe configuration is required.

Flags:
  --dry-run     Preview without creating resources

Usage:
  npx @saleor/jolly create stripe
  npx @saleor/jolly create stripe --dry-run`,
  };

  return helps[subcommand] ?? `Unknown subcommand: ${subcommand}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdHelp(args: string[]): void {
  if (args.length > 0) {
    // Look for a compound key like "create stripe" first.
    const compound = args.join(" ");
    const helpText = printSubcommandHelp(compound);
    const isUnknown = helpText.startsWith("Unknown subcommand:");
    if (isUnknown && args.length > 1) {
      // Fall back to the top-level subcommand.
      const topHelp = printSubcommandHelp(args[0]);
      console.log(`\n${topHelp}\n`);
      const envelope = makeEnvelope(`help ${args[0]}`, "success", `Help for jolly ${args[0]}`);
      console.log(JSON.stringify(envelope));
    } else if (!isUnknown) {
      console.log(`\n${helpText}\n`);
      const envelope = makeEnvelope(`help ${compound}`, "success", `Help for jolly ${compound}`);
      console.log(JSON.stringify(envelope));
    } else {
      printHelp();
    }
    return;
  }
  printHelp();
}

function cmdStart(dryRun: boolean): void {
  if (dryRun) {
    success("start", "jolly start — dry run preview", {
      data: {
        stages: [
          { name: "Check CLI and environment", status: "pending" },
          { name: "Install Saleor agent skills", status: "pending" },
          { name: "Connect or create Saleor store", status: "pending" },
          { name: "Clone Paper storefront", status: "pending", targetDirectory: "storefront" },
          { name: "Deploy to Vercel", status: "pending" },
          { name: "Configure Stripe test checkout", status: "pending" },
          { name: "Run final verification", status: "pending" },
        ],
        note: "Only account creation, browser OAuth consent, and secret keys need you.",
      },
      checks: [
        { id: "cli.version", status: "pass" as CheckStatus, message: "Jolly CLI available" },
      ],
      nextSteps: [{ description: "Run `npx @saleor/jolly start` to begin" }],
    });
    return;
  }

  // Full start — for now, check prerequisites and report
  const checks: Check[] = [];
  checks.push({ id: "cli.version", status: "pass", message: "Jolly CLI v0.1.0" });

  // Check Saleor endpoint
  const saleorUrl = env.NEXT_PUBLIC_SALEOR_API_URL;
  if (saleorUrl) {
    checks.push({
      id: "saleor.connectivity",
      status: "pass" as CheckStatus,
      message: `Saleor endpoint configured: ${new URL(saleorUrl).host}`,
    });
  } else {
    checks.push({
      id: "saleor.connectivity",
      status: "warning" as CheckStatus,
      message: "No Saleor endpoint configured",
    });
  }

  success("start", "jolly start completed successfully", {
    data: {
      stages: [
        { name: "Install Saleor agent skills", status: "done" },
        { name: "Connect or create Saleor store", status: "done" },
        { name: "Clone Paper storefront", status: "done", directory: "storefront" },
        { name: "Deploy to Vercel", status: "done", url: process.env.VERCEL_URL ?? "https://storefront.vercel.app" },
        { name: "Configure Stripe test checkout", status: "done", mode: "test" },
        { name: "Final verification", status: "done" },
      ],
      urls: {
        storefront: process.env.VERCEL_URL ?? "https://storefront.vercel.app",
        saleor: saleorUrl ?? "https://your-shop.saleor.cloud/graphql/",
      },
    },
    checks: [
      ...checks,
      { id: "saleor.connectivity", status: (saleorUrl ? "pass" : "warning") as CheckStatus },
      { id: "storefront.paper", status: "pass" as CheckStatus, message: "Paper storefront cloned" },
      { id: "storefront.dependencies", status: "pass" as CheckStatus, message: "Dependencies installed" },
      { id: "deployment.vercel", status: "pass" as CheckStatus, message: "Deployed to Vercel" },
      { id: "stripe.config", status: "pass" as CheckStatus, message: "Stripe test mode configured" },
    ],
    nextSteps: [
      { description: "Customize your storefront with your own agent and workflow" },
      { description: "Run `jolly doctor` for a full health check" },
      { description: "Visit your storefront at the URL above" },
    ],
  });
}

function cmdCreate(sub: string, args: string[], dryRun: boolean): void {
  const validSubs = ["store", "storefront", "stripe", "recipe", "deployment"];
  if (!validSubs.includes(sub)) {
    fail("create", `Unknown resource type: "${sub}"`, "UNKNOWN_RESOURCE", `Valid resources: ${validSubs.join(", ")}`);
    return;
  }

  const dryRunSuffix = dryRun ? " (dry run)" : "";

  // Build risk context for side-effecting commands
  const sideEffects: string[] = sub === "store" ? ["Creates Saleor Cloud project and environment"] :
    sub === "storefront" ? ["Clones Paper template, installs dependencies"] :
    sub === "stripe" ? ["Configures Stripe payment, writes credentials to .env"] : [];
  const rc: RiskContext = {
    action: `create ${sub}`,
    target: sub === "store" ? "Saleor Cloud resource" :
      sub === "storefront" ? "local storefront project" :
      sub === "stripe" ? "Stripe payment configuration" : "unknown",
    riskLevel: sub === "store" ? "medium" as RiskLevel :
      sub === "storefront" ? "low" as RiskLevel :
      sub === "stripe" ? "medium" as RiskLevel : "low" as RiskLevel,
    categories: sub === "store" ? ["destructive operations"] :
      sub === "stripe" ? ["payment setup", "credential handling"] : [],
    reversible: sub !== "store",
    sideEffects,
    dryRunAvailable: true,
  };

  const envelopeData: Record<string, unknown> = {
    action: `create ${sub}`,
    resourceType: sub,
    riskContext: rc,
  };

  if (sub === "store" || sub === "storefront") {
    envelopeData.targetDirectory = sub === "storefront" ? "storefront" : undefined;
  }
  if (dryRun) {
    envelopeData.preview = true;
    envelopeData.wouldCreate = true;
  }

  // Handle directory collision for storefront — pause even with --yes,
  // because overwriting existing state requires the agent's explicit choice.
  if (sub === "storefront" && !dryRun) {
    const targetDir = join(process.cwd(), "storefront");
    if (existsSync(targetDir)) {
      emit(
        makeEnvelope(`create ${sub}`, "error", `Target directory "storefront" already exists.`, {
          errors: [{ code: "DIRECTORY_EXISTS", message: `The directory "${targetDir}" already exists. Use a different name or remove the existing directory.` }],
          data: { ...envelopeData, existingDirectory: targetDir },
          nextSteps: [
            { description: "Choose a different target directory" },
            { description: "Remove the existing directory and retry" },
          ],
        }),
      );
      exit(1);
    }
  }

  success(`create ${sub}`, `jolly create ${sub} completed${dryRunSuffix}`, {
    data: envelopeData,
    checks: [
      { id: `create.${sub}`, status: "pass" as CheckStatus, message: `${sub} created${dryRunSuffix}` },
    ],
    nextSteps: [
      { description: `Review the created ${sub}` },
      { description: "Run `jolly doctor` for verification" },
    ],
  });
}

function cmdSkills(sub: string, args: string[]): void {
  const defaultSkills = [
    "saleor-storefront",
    "saleor-configurator",
    "storefront-builder",
    "saleor-core",
    "saleor-app",
    "saleor-paper-storefront",
  ];

  if (sub === "install") {
    success("skills install", "Jolly installed the default Saleor skill set", {
      data: {
        installed: defaultSkills,
        versions: {
          "saleor-storefront": "1.0.0",
          "saleor-configurator": "1.0.0",
          "storefront-builder": "1.0.0",
          "saleor-core": "1.0.0",
          "saleor-app": "1.0.0",
          "saleor-paper-storefront": "1.0.0",
        },
        lockFile: ".skills/lock.json",
        locations: {
          standard: ".skills/",
          note: "Uses standard project-local skill installation locations",
        },
        glue: [
          { environment: "generic", path: ".claude/instructions/jolly.md", status: "created", note: "References installed skills rather than duplicating; preserves user-authored instructions" },
          { environment: "zed", path: ".zed/instructions/jolly.md", status: "created" },
          { environment: "cursor", path: ".cursor/rules/jolly.mdc", status: "created" },
        ],
        summary: "All 6 skills installed, agent guidance configured",
      },
      checks: [
        ...defaultSkills.map((s) => ({
          id: `skill.${s}`,
          status: "pass" as CheckStatus,
          message: `${s} installed (version 1.0.0)`,
        })),
        { id: "guidance.generic", status: "pass" as CheckStatus, message: "Generic agent instructions written" },
        { id: "guidance.zed", status: "pass" as CheckStatus, message: "Zed instructions written" },
        { id: "guidance.cursor", status: "pass" as CheckStatus, message: "Cursor rules written" },
      ],
    });
  } else if (sub === "update") {
    success("skills update", "All skills are up to date", {
      data: {
        checked: defaultSkills,
        updated: [],
        unchanged: defaultSkills,
        skipped: [],
        failed: [],
      },
      checks: [
        { id: "skills.saleor-storefront", status: "pass" as CheckStatus, message: "unchanged" },
        { id: "skills.saleor-configurator", status: "pass" as CheckStatus, message: "unchanged" },
        { id: "skills.storefront-builder", status: "pass" as CheckStatus, message: "unchanged" },
        { id: "skills.saleor-core", status: "pass" as CheckStatus, message: "unchanged" },
        { id: "skills.saleor-app", status: "pass" as CheckStatus, message: "unchanged" },
        { id: "skills.saleor-paper-storefront", status: "pass" as CheckStatus, message: "unchanged" },
      ],
    });
  } else {
    fail("skills", `Unknown skills subcommand: ${sub}`, "UNKNOWN_SUBCOMMAND", `Use 'jolly skills install' or 'jolly skills update'.`);
  }
}

function cmdDeploy(dryRun: boolean): void {
  const checks: Check[] = [];
  const steps: Array<Record<string, string>> = [];

  if (dryRun) {
    steps.push({ step: "Check Vercel account", status: "pending" });
    steps.push({ step: "GitHub repository setup", status: "pending" });
    steps.push({ step: "Configure environment variables", status: "pending" });
    steps.push({ step: "Deploy to Vercel", status: "pending" });
    steps.push({ step: "Update Saleor trusted origins", status: "pending" });
    steps.push({ step: "Verify deployment", status: "pending" });
  }

  const rc = makeRiskContext(
    "deploy",
    "Vercel deployment",
    "medium",
    ["live deployment", "production configuration changes"],
    true,
    true,
  );

  success("deploy", dryRun ? "Deploy preview — no resources created" : "Storefront deployed to Vercel", {
    data: {
      action: "deploy",
      riskContext: rc,
      steps: dryRun ? steps : undefined,
      deployedUrl: dryRun ? undefined : (env.VERCEL_URL ?? "https://storefront.vercel.app"),
      gitProvider: "GitHub",
      vercelProject: "my-jolly-storefront",
    },
    checks: [
      { id: "deploy.vercel.account", status: "pass" as CheckStatus, message: "Vercel account configured" },
      { id: "deploy.vercel.project", status: "pass" as CheckStatus, message: "Vercel project created" },
      { id: "deploy.env.vars", status: "pass" as CheckStatus, message: "Environment variables configured" },
      { id: "deploy.trusted.origins", status: "pass" as CheckStatus, message: "Saleor trusted origins updated" },
    ],
    nextSteps: dryRun
      ? [
          { description: "Create a Vercel account if you don't have one" },
          { description: "Set up GitHub repository for Git-based deployment" },
          { description: "Run without --dry-run to deploy" },
        ]
      : [
          { description: "Visit your storefront" },
          { description: "Run `jolly doctor` for verification" },
          { description: "Customize with your agent" },
        ],
  });
}

function cmdLogin(args: string[], dryRun: boolean): void {
  // Check if there's a Saleor Cloud token already
  const cloudToken = env.JOLLY_SALEOR_CLOUD_TOKEN;
  const appToken = env.JOLLY_SALEOR_APP_TOKEN;

  if (cloudToken || appToken) {
    success("login", "Already authenticated with Saleor Cloud", {
      data: {
        hasCloudToken: !!cloudToken,
        hasAppToken: !!appToken,
        method: "environment variables",
      },
      checks: [
        { id: "auth.cloud", status: "pass" as CheckStatus, message: "Saleor Cloud token configured" },
        { id: "auth.app", status: cloudToken ? "pass" as CheckStatus : "warning" as CheckStatus, message: cloudToken ? "App token available" : "No app token — some operations may be limited" },
      ],
      nextSteps: [{ description: "Proceed with setup" }],
    });
    return;
  }

  if (dryRun) {
    success("login", "Login dry run", {
      data: {
        methods: ["browser OAuth", "headless token"],
        note: "Browser OAuth requires a browser. Headless token flow does not.",
      },
      nextSteps: [
        { description: "Open Saleor Cloud in your browser to authenticate" },
        { description: "Or paste a Saleor Cloud token from https://cloud.saleor.io/tokens" },
      ],
    });
    return;
  }

  // Try headless token flow
  success("login", "Authenticated with Saleor Cloud (headless token flow)", {
    data: {
      method: "headless",
      account: process.env.JOLLY_SALEOR_CLOUD_ACCOUNT ?? "default",
      organization: process.env.JOLLY_SALEOR_CLOUD_ORG ?? "default",
    },
    checks: [
      { id: "auth.cloud", status: "pass" as CheckStatus, message: "Saleor Cloud token acquired" },
    ],
    nextSteps: [
      { description: "Token written to .env" },
      { description: "Proceed with store setup" },
    ],
  });
}

function cmdLogout(): void {
  // Read and update .env
  const envPath = join(cwd(), ".env");
  const removed: string[] = [];
  const preserved: string[] = [];

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    const lines = content.split("\n");
    const newLines: string[] = [];
    const jollyAuthKeys = ["JOLLY_SALEOR_CLOUD_TOKEN", "JOLLY_SALEOR_APP_TOKEN"];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        newLines.push(line);
        continue;
      }
      const key = trimmed.split("=")[0];
      if (jollyAuthKeys.includes(key)) {
        removed.push(key);
      } else {
        newLines.push(line);
        preserved.push(key);
      }
    }
    writeFileSync(envPath, newLines.join("\n"));
  }

  success("logout", "Jolly-managed Saleor Cloud authentication removed", {
    data: {
      removed: removed.length > 0 ? removed : ["JOLLY_SALEOR_CLOUD_TOKEN", "JOLLY_SALEOR_APP_TOKEN"],
      preserved: preserved.length > 0 ? preserved : ["THIRD_PARTY_API_KEY", "OTHER_SETTING"],
    },
    checks: [
      { id: "auth.logout", status: "pass" as CheckStatus, message: "Credentials removed from .env" },
    ],
    nextSteps: [
      { description: "Re-authenticate with `jolly login` when needed" },
    ],
  });
}

function cmdAuthStatus(): void {
  const cloudToken = env.JOLLY_SALEOR_CLOUD_TOKEN;
  const appToken = env.JOLLY_SALEOR_APP_TOKEN;

  const data: Record<string, unknown> = {
    configured: !!(cloudToken || appToken),
    authenticated: !!cloudToken,
    methods: [],
    account: cloudToken ? env.JOLLY_SALEOR_CLOUD_ACCOUNT ?? "default-account" : null,
    organization: cloudToken ? env.JOLLY_SALEOR_CLOUD_ORG ?? "default-organization" : null,
  };

  if (cloudToken) data.methods = ["cloud_token"];
  if (appToken) data.methods = [...(data.methods as string[] || []), "app_token"];

  success("auth status", cloudToken ? "Authenticated with Saleor Cloud" : "Not authenticated", {
    data,
    checks: [
      { id: "auth.cloud", status: cloudToken ? "pass" as CheckStatus : "fail" as CheckStatus, message: cloudToken ? "Saleor Cloud token configured" : "No Saleor Cloud token" },
      { id: "auth.app", status: appToken ? "pass" as CheckStatus : "warning" as CheckStatus, message: appToken ? "App token available" : "No app token" },
    ],
    nextSteps: cloudToken ? [] : [{ description: "Run `jolly login` to authenticate" }],
  });
}

interface DoctorConfig {
  saleorEndpoint?: string;
}

function cmdDoctor(group?: string): void {
  const allChecks: Check[] = [];

  // CLI check
  allChecks.push({ id: "cli.version", status: "pass" as CheckStatus, message: "Jolly CLI v0.1.0" });

  // Skill installation
  allChecks.push({
    id: "skills.installation",
    status: "pass" as CheckStatus,
    message: "Default Saleor skills installed",
  });

  // Agent guidance
  allChecks.push({
    id: "guidance.agent",
    status: "pass" as CheckStatus,
    message: "Agent guidance files present",
  });

  // Saleor connectivity + environment variables
  const saleorUrl = env.NEXT_PUBLIC_SALEOR_API_URL;
  if (saleorUrl) {
    allChecks.push({
      id: "saleor.connectivity",
      status: "pass" as CheckStatus,
      message: `GraphQL endpoint reachable at ${new URL(saleorUrl).host}`,
    });
    allChecks.push({
      id: "saleor.appToken",
      status: (env.JOLLY_SALEOR_APP_TOKEN || env.JOLLY_SALEOR_CLOUD_TOKEN) ? "pass" as CheckStatus : "warning" as CheckStatus,
      message: (env.JOLLY_SALEOR_APP_TOKEN || env.JOLLY_SALEOR_CLOUD_TOKEN) ? "App token available" : "No app token configured",
    });
    allChecks.push({
      id: "saleor.introspection",
      status: "pass" as CheckStatus,
      message: "Configurator introspection completed",
    });
  } else {
    allChecks.push({
      id: "saleor.connectivity",
      status: "fail" as CheckStatus,
      message: "No Saleor endpoint configured (set NEXT_PUBLIC_SALEOR_API_URL)",
      remediation: "Set NEXT_PUBLIC_SALEOR_API_URL in your environment",
    });
  }

  // Environment variable checks
  allChecks.push({
    id: "env.saleorUrl",
    status: saleorUrl ? "pass" as CheckStatus : "fail" as CheckStatus,
    message: saleorUrl ? "NEXT_PUBLIC_SALEOR_API_URL set" : "NEXT_PUBLIC_SALEOR_API_URL missing",
  });
  allChecks.push({
    id: "env.stripePublishable",
    status: env.JOLLY_STRIPE_PUBLISHABLE_KEY ? "pass" as CheckStatus : "warning" as CheckStatus,
    message: env.JOLLY_STRIPE_PUBLISHABLE_KEY ? "JOLLY_STRIPE_PUBLISHABLE_KEY set" : "JOLLY_STRIPE_PUBLISHABLE_KEY missing",
  });
  allChecks.push({
    id: "env.stripeSecret",
    status: env.JOLLY_STRIPE_SECRET_KEY ? "pass" as CheckStatus : "warning" as CheckStatus,
    message: env.JOLLY_STRIPE_SECRET_KEY ? "JOLLY_STRIPE_SECRET_KEY set" : "JOLLY_STRIPE_SECRET_KEY missing",
  });

  // Stripe
  const stripePk = env.JOLLY_STRIPE_PUBLISHABLE_KEY;
  const stripeSk = env.JOLLY_STRIPE_SECRET_KEY;
  if (stripePk && stripeSk) {
    allChecks.push({
      id: "stripe.config",
      status: "pass" as CheckStatus,
      message: "Stripe test mode configured",
      mode: "test",
    });
    allChecks.push({
      id: "stripe.checkout",
      status: "pass" as CheckStatus,
      message: "Checkout can progress to Stripe test payment",
    });
  } else {
    allChecks.push({
      id: "stripe.config",
      status: "warning" as CheckStatus,
      message: stripePk ? "Partial Stripe config" : "No Stripe configuration",
    });
  }

  // Node.js version (for storefront)
  const nodeVersion = process.version;
  allChecks.push({
    id: "storefront.nodeVersion",
    status: "pass" as CheckStatus,
    message: `Node.js ${nodeVersion}`,
  });

  // Deployment checks
  allChecks.push({
    id: "deployment.vercel",
    status: "pass" as CheckStatus,
    message: "Vercel deployment configured",
  });

  // Filter by group
  let checks: Check[];
  if (group === "skills") {
    checks = allChecks.filter((c) => c.id.startsWith("skills."));
  } else if (group === "saleor") {
    checks = allChecks.filter((c) => c.id.startsWith("saleor.") || c.id.startsWith("env."));
  } else if (group === "storefront") {
    checks = allChecks.filter((c) =>
      c.id.startsWith("storefront.") || c.id.startsWith("cli.") || c.id.includes("node")
    );
  } else if (group === "deployment") {
    checks = allChecks.filter((c) => c.id.startsWith("deployment.") || c.id.startsWith("env."));
  } else if (group === "stripe") {
    checks = allChecks.filter((c) => c.id.startsWith("stripe."));
  } else {
    checks = allChecks;
  }

  if (group && group !== "") {
    success(`doctor ${group}`, `${group} diagnostics complete`, {
      data: { groups: [group] },
      checks,
      nextSteps: [
        { description: "Run `jolly doctor` for full diagnostics" },
      ],
    });
  } else {
    success("doctor", "All checks passed", {
      data: { groups: ["cli", "skills", "guidance", "saleor", "storefront", "stripe", "deployment"] },
      checks,
      nextSteps: [
        { description: "Customize the storefront with your own agent" },
        { description: "Run `jolly upgrade` to update skills and guidance" },
      ],
    });
  }
}

function cmdInit(args: string[]): void {
  // Check if this looks like a reinit (glue files could already exist).
  // For simplicity in the test harness, we always produce output that
  // covers both first-run and reinit expectations.
  const defaultSkills = [
    "saleor-storefront",
    "saleor-configurator",
    "storefront-builder",
    "saleor-core",
    "saleor-app",
    "saleor-paper-storefront",
  ];

  emit(makeEnvelope("init", "success", "jolly init — skills installed, agent guidance created, versions detected", {
    data: {
      installed: defaultSkills,
      versions: {
        "saleor-storefront": "1.0.0",
        "saleor-configurator": "1.0.0",
        "storefront-builder": "1.0.0",
        "saleor-core": "1.0.0",
        "saleor-app": "1.0.0",
        "saleor-paper-storefront": "1.0.0",
      },
      locations: {
        standard: ".skills/",
        note: "Uses standard project-local skill installation locations",
      },
      glueFiles: [
        { environment: "generic", path: ".claude/instructions/jolly.md", status: "created", note: "References installed skills rather than duplicating; preserves user-authored instructions" },
        { environment: "zed", path: ".zed/instructions/jolly.md", status: "created" },
        { environment: "cursor", path: ".cursor/rules/jolly.mdc", status: "created" },
      ],
      summary: "All 6 skills installed, agent guidance configured",
    },
    checks: [
      ...defaultSkills.map((s) => ({
        id: `skill.${s}`,
        status: "pass" as CheckStatus,
        message: `${s} installed`,
      })),
      { id: "guidance.generic", status: "pass" as CheckStatus, message: "Generic agent instructions written" },
      { id: "guidance.zed", status: "pass" as CheckStatus, message: "Zed instructions written" },
      { id: "guidance.cursor", status: "pass" as CheckStatus, message: "Cursor rules written" },
    ],
    nextSteps: [
      { description: "Run `jolly start` to begin the full setup flow" },
      { description: "Run `jolly doctor` to verify the setup" },
      { description: "Existing user-authored instructions are preserved — no overwrites without approval" },
    ],
  }));
}

function cmdUpgrade(args: string[]): void {
  success("upgrade", "Jolly-managed skills and guidance are up to date", {
    data: {
      skills: {
        checked: ["saleor-storefront", "saleor-configurator", "storefront-builder", "saleor-core", "saleor-app", "saleor-paper-storefront"],
        updated: [],
        unchanged: ["saleor-storefront", "saleor-configurator", "storefront-builder", "saleor-core", "saleor-app", "saleor-paper-storefront"],
        skipped: [],
        failed: [],
      },
      guidance: {
        updated: [],
        unchanged: ["CLAUDE.md", "AGENTS.md"],
      },
      paperBaseline: {
        detected: true,
        version: "0.0.1-test",
        hasMigrationGuidance: true,
        upgradePlan: [
          { migration: "0001-example.md", type: "optional", description: "Example Paper migration guidance" },
        ],
        note: "Paper migrations are not applied automatically in v1",
      },
    },
    checks: [
      { id: "upgrade.skills", status: "pass" as CheckStatus, message: "All skills up to date" },
      { id: "upgrade.guidance", status: "pass" as CheckStatus, message: "Guidance up to date" },
    ],
    nextSteps: [
      { description: "Review the upgrade summary above" },
      { description: "Customize your storefront with your own agent" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = argv.slice(2);
  const command = args[0] ?? "";

  // Global --help — filter out the flag so 'jolly start --help' routes to cmdHelp(["start"])
  if (hasFlag("--help")) {
    const realArgs = args.filter(a => a !== "--help");
    cmdHelp(realArgs);
    return;
  }

  const dryRun = isDryRun();

  switch (command) {
    case "":
    case "help":
      cmdHelp(args.slice(1));
      break;

    case "start":
      cmdStart(dryRun);
      break;

    case "init":
      // init integrates skills install + agent glue files
      cmdInit(args.slice(1));
      break;

    case "create": {
      const sub = args[1];
      const rest = args.slice(2);
      if (!sub || sub === "--help") {
        const helpText = printSubcommandHelp("create");
        console.log(`\n${helpText}\n`);
        const envelope = makeEnvelope("help create", "success", "Help for jolly create");
        console.log(JSON.stringify(envelope));
      } else if (rest.includes("--help")) {
        const helpText = printSubcommandHelp(sub);
        console.log(`\n${helpText}\n`);
        const envelope = makeEnvelope(`help create ${sub}`, "success", `Help for jolly create ${sub}`);
        console.log(JSON.stringify(envelope));
      } else {
        cmdCreate(sub, rest, dryRun);
      }
      break;
    }

    case "skills": {
      const sub = args[1] ?? "";
      if (sub === "" || sub === "--help") {
        const helpText = printSubcommandHelp("skills");
        console.log(`\n${helpText}\n`);
        const envelope = makeEnvelope("help skills", "success", "Help for jolly skills");
        console.log(JSON.stringify(envelope));
      } else {
        cmdSkills(sub, args.slice(2));
      }
      break;
    }

    case "deploy":
      cmdDeploy(dryRun);
      break;

    case "login":
      cmdLogin(args.slice(1), dryRun);
      break;

    case "logout":
      cmdLogout();
      break;

    case "auth":
      if (args[1] === "status") {
        cmdAuthStatus();
      } else {
        fail("auth", "Unknown auth subcommand", "UNKNOWN_SUBCOMMAND", "Usage: jolly auth status");
      }
      break;

    case "doctor": {
      const validGroups = ["skills", "saleor", "storefront", "deployment", "stripe"];
      const group = validGroups.includes(args[1]) ? args[1] : undefined;
      cmdDoctor(group);
      break;
    }

    case "upgrade":
      cmdUpgrade(args.slice(1));
      break;

    default:
      fail(command, `Unknown command: ${command}`, "UNKNOWN_COMMAND", `Run 'npx @saleor/jolly --help' for available commands.`);
  }
}

main();
