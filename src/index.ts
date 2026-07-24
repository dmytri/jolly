// Jolly — the thin, skill-driven CLI (decision 2026-06-13).
//
// Jolly does not replace the customer's agent. It does deterministic plumbing
// (login/logout/auth status, create store/stripe, init, start,
// doctor, upgrade, skills) and installs the Jolly skill plus the Saleor
// agent-skills; the customer's agent runs the official CLIs (`npx vercel`,
// `@saleor/configurator`, `git`, `pnpm`). Jolly never shells out to the Vercel
// CLI or Configurator and holds no Vercel token.
//
// Every command emits exactly one output envelope (feature 020):
//   { command, status, summary, data, checks, nextSteps, errors }
// Field names are camelCase; checks[].status uses the doctor vocabulary;
// errors[].code is a stable uppercase machine identifier; secrets are
// referenced by name, never printed. Side-effecting actions carry a feature
// 021 riskContext inside the envelope, identical for --dry-run and real runs.
//
// Runtime: ES module TypeScript, run directly under native Node >= 23 (which
// strips types) in dev/test, and as a pre-built JS bundle via bin/jolly in
// production. Only Node built-ins and the project's own src/lib/ helpers are used.

import { existsSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import {
  cloudApiBase,
  listOrganizations,
  listProjects,
  createProject,
  listProjectServices,
  pickService,
  listEnvironments,
  type CloudEnvironment,
  createEnvironment,
  environmentCreationBody,
  pollTaskStatus,
  getEnvironment,
  extractDomainUrl,
  seedRecipeStock,
  assignCollectionProducts,
  assignRecipeCollectionsConcurrent,
  storeHoldsForeignCatalog,
  storeHoldsRecipeCatalog,
  DEFAULT_STOCK_QUANTITY,
  deriveRecipeIdentifiers,
  installStripeApp,
  STRIPE_APP_MANIFEST_URL,
  probeCheckoutPaymentGateway,
  probeChannelPurchasability,
  probeEndpointConnectivity,
  CloudApiError,
  type CloudOrganization,
} from "./lib/cloud-api.ts";
import { loadEnvValues, writeEnvValues } from "./lib/env-file.ts";
import { normalizeSaleorUrl } from "./lib/saleor-url.ts";
import { isFirstPartyHost } from "./lib/hosts.ts";
import { interactiveCloseSummary } from "./lib/start-close.ts";
import { cliMessage } from "./lib/messages.ts";
import {
  requestDeviceCode,
  pollForDeviceTokens,
  refreshAccessToken,
  isJwtExpired,
  DeviceGrantError,
  type DeviceAuthorization,
} from "./lib/device-grant.ts";
import { parse as parseBombArgs } from "@bomb.sh/args";
import { runCompletion } from "./lib/completion.ts";
import {
  intro as clackIntro,
  outro as clackOutro,
  text as clackText,
  confirm as clackConfirm,
  select as clackSelect,
  note as clackNote,
  log as clackLog,
  spinner as clackSpinner,
  isCancel as clackIsCancel,
} from "@clack/prompts";

// The interactive CLI keeps stdout for the RESULT (the human summary emit()
// prints) and routes all Bombshell/@clack chatter — intro, prompts, notes, log,
// outro, and the long-stage progress spinner — to stderr, updating in place, so
// piping stdout stays clean (feature 020 Rule "Output envelope principles").
const CLACK_STDERR = { output: process.stderr } as const;

// ─── Envelope types (mirror features/support/envelope.ts) ─────────────────

type EnvelopeStatus = "success" | "warning" | "error";
type CheckStatus = "pass" | "warning" | "fail" | "skipped" | "unknown";
type RiskLevel = "low" | "medium" | "high";

interface Check {
  id: string;
  status: CheckStatus;
  description?: string;
  command?: string;
  remediation?: string;
  [key: string]: unknown;
}

interface NextStep {
  description: string;
  command?: string;
  [key: string]: unknown;
}

interface ErrorEntry {
  code: string;
  message: string;
  remediation?: string;
  [key: string]: unknown;
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

interface Envelope {
  tool: string;
  command: string;
  status: EnvelopeStatus;
  summary: string;
  data: Record<string, unknown>;
  checks: Check[];
  nextSteps: NextStep[];
  errors: ErrorEntry[];
}

// ─── Argv parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  positionals: string[];
  json: boolean;
  quiet: boolean;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
  options: Record<string, string>;
  flags: Set<string>;
  /** Flags outside the supported surface — rejected, never silently ignored. */
  unknownFlags: string[];
}

// The flag surface every `jolly` invocation may carry. Argument parsing for
// every invocation — agent and human alike — runs through the single Bombshell
// (@bomb.sh/args) typed parser (feature 027); Jolly keeps no second hand-rolled
// parse path. Global boolean flags map to the top-level fields; the extra
// boolean flags and the value flags feed `flags`/`options`. Any flag outside
// this surface is unsupported and is rejected, never silently ignored.
const GLOBAL_BOOLEAN_FLAGS = ["json", "quiet", "yes", "dry-run", "help"] as const;
const EXTRA_BOOLEAN_FLAGS = ["create-environment", "full-validation"] as const;
const VALUE_FLAGS = [
  "url",
  "name",
  "domain-label",
  "region",
  "organization",
  "mock-organizations",
  "mock-environments",
] as const;
// Short aliases resolve to their long flag name before classification.
const FLAG_ALIASES: Record<string, string> = { y: "yes", h: "help" };

/**
 * Whether the process is running inside Shipshape's verification harness.
 * `HARNESS_RUN_ID` is set once, run-wide, by the harness (cucumber.js) for
 * every test invocation; a customer's shipped-CLI environment carries no such
 * variable. The `mock-*` affordances read below fabricate a service response
 * only when this guard is active, so a customer can never reach them.
 * @planks("each should fabricate a service response only when the harness guard is set")
 */
function harnessGuardActive(): boolean {
  return process.env.HARNESS_RUN_ID !== undefined;
}
const KNOWN_FLAGS = new Set<string>([
  ...GLOBAL_BOOLEAN_FLAGS,
  ...EXTRA_BOOLEAN_FLAGS,
  ...VALUE_FLAGS,
]);

/**
 * @planks("the agent runs `jolly auth status --json`")
 * @planks("the agent runs `jolly create store --dry-run --json`")
 * @planks("the agent runs `jolly doctor --json`")
 * @planks("the agent runs `jolly doctor`")
 * @planks("the agent runs `jolly start --dry-run --quiet`")
 * @planks("the agent runs `jolly doctor` with stdout not a terminal")
 * @planks("the agent runs `jolly login --json` with an invalid JOLLY_SALEOR_CLOUD_TOKEN")
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed = parseBombArgs(argv, {
    boolean: [...GLOBAL_BOOLEAN_FLAGS, ...EXTRA_BOOLEAN_FLAGS],
    string: [...VALUE_FLAGS],
    alias: { yes: "y", help: "h" },
  });

  const positionals = parsed._.map((p) => String(p));
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  const unknownFlags: string[] = [];
  let json = false;
  let quiet = false;
  let yes = false;
  let dryRun = false;
  let help = false;

  for (const [rawKey, value] of Object.entries(parsed)) {
    if (rawKey === "_") continue;
    const key = FLAG_ALIASES[rawKey] ?? rawKey;
    if (!KNOWN_FLAGS.has(key)) {
      unknownFlags.push(`--${rawKey}`);
      continue;
    }
    switch (key) {
      case "json":
        json = true;
        break;
      case "quiet":
        quiet = true;
        break;
      case "yes":
        yes = true;
        break;
      case "dry-run":
        dryRun = true;
        break;
      case "help":
        help = true;
        break;
      default:
        if ((VALUE_FLAGS as readonly string[]).includes(key)) {
          options[key] = String(value);
        } else {
          flags.add(key);
        }
    }
  }

  return { positionals, json, quiet, yes, dryRun, help, options, flags, unknownFlags };
}

// ─── Envelope construction helpers ────────────────────────────────────────

/**
 * @planks("stdout should contain a single JSON envelope and nothing else")
 * @planks("the envelope should include a `command` identifier")
 * @planks("the envelope should include a top-level `status` of `success`, `warning`, or `error`")
 * @planks("the envelope should include a human `summary` string")
 * @planks("the envelope should include a command-specific `data` object")
 * @planks("the envelope should include a `checks` array")
 * @planks("the envelope should include a `nextSteps` array")
 * @planks("the envelope should include an `errors` array that is empty on success")
 */
function envelope(
  partial: Partial<Envelope> & { command: string; status: EnvelopeStatus; summary: string },
): Envelope {
  return {
    // The Jolly package name, on every command's output: @dk/jolly is the only
    // name for the Jolly tool (feature 006 Rule "Thin command surface").
    tool: "@dk/jolly",
    command: partial.command,
    status: partial.status,
    summary: partial.summary,
    data: partial.data ?? {},
    checks: partial.checks ?? [],
    nextSteps: partial.nextSteps ?? [],
    errors: partial.errors ?? [],
  };
}

/**
 * @planks("the envelope status should be {string} with the stable code `NON_FIRST_PARTY_HOST`")
 * @planks("each entry in `errors` should include a stable `code`, a `message`, and a `remediation`")
 */
function errorEnvelope(
  command: string,
  summary: string,
  errors: ErrorEntry[],
  extra: Partial<Envelope> = {},
): Envelope {
  return envelope({
    command,
    status: "error",
    summary,
    errors,
    ...extra,
  });
}

// ─── Output rendering ─────────────────────────────────────────────────────

/**
 * @planks("stdout should contain human-readable check results")
 * @planks("the progress should update in place rather than appending one line per update")
 */
function statusGlyph(status: EnvelopeStatus): string {
  if (status === "success") return "ok";
  if (status === "warning") return "warn";
  return "error";
}

/**
 * @planks("each check `status` should be one of pass, warning, fail, skipped, or unknown")
 * @planks("stdout should contain human-readable check results")
 */
function checkGlyph(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return "pass";
    case "warning":
      return "warn";
    case "fail":
      return "fail";
    case "skipped":
      return "skip";
    default:
      return "?";
  }
}

// ANSI SGR colours for the human terminal path. Applied only when stdout is an
// interactive terminal and NO_COLOR is unset; never under --json or --quiet, and
// never when stdout is piped.
const SGR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
} as const;

/**
 * @planks("each check result should carry a restrained status glyph for its pass, warning, fail, or skipped state")
 */
function statusEmoji(status: EnvelopeStatus): string {
  if (status === "success") return "✅";
  if (status === "warning") return "⚠️";
  return "❌";
}

/**
 * @planks("each check result should carry a restrained status glyph for its pass, warning, fail, or skipped state")
 */
function checkEmoji(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return "✅";
    case "warning":
      return "⚠️";
    case "fail":
      return "❌";
    case "skipped":
      return "⏭️";
    default:
      return "❔";
  }
}

/**
 * @planks("stdout should carry ANSI colour codes distinguishing pass, warning, and fail results")
 */
function statusColour(status: EnvelopeStatus): string {
  if (status === "success") return SGR.green;
  if (status === "warning") return SGR.yellow;
  return SGR.red;
}

/**
 * @planks("stdout should carry ANSI colour codes distinguishing pass, warning, and fail results")
 */
function checkColour(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return SGR.green;
    case "warning":
      return SGR.yellow;
    case "fail":
      return SGR.red;
    case "skipped":
      return SGR.dim;
    default:
      return SGR.cyan;
  }
}

/**
 * Render the human-friendly text for an envelope. When `colour` is true the
 * status/check glyphs are wrapped in ANSI SGR codes and restrained emoji are
 * included; when false the same text is plain — no colour, no emoji.
 *
 * @planks("stdout should contain human-readable check results")
 * @planks("stdout should not contain a JSON envelope")
 * @planks("stdout should contain no ANSI colour codes")
 */
function renderHuman(env: Envelope, colour: boolean): string {
  const lines: string[] = [];
  const wrap = (code: string, text: string): string =>
    colour ? `${code}${text}${SGR.reset}` : text;
  const glyph = (emoji: string, label: string): string =>
    colour ? `${emoji} [${label}]` : `[${label}]`;

  lines.push(
    `jolly ${env.command}: ${wrap(
      statusColour(env.status),
      glyph(statusEmoji(env.status), statusGlyph(env.status)),
    )} ${env.summary}`,
  );
  for (const check of env.checks) {
    lines.push(
      `  - ${wrap(
        checkColour(check.status),
        glyph(checkEmoji(check.status), checkGlyph(check.status)),
      )} ${check.id}${check.description ? `: ${check.description}` : ""}`,
    );
  }
  for (const step of env.nextSteps) {
    lines.push(`  next: ${step.description}${step.command ? ` (\`${step.command}\`)` : ""}`);
  }
  for (const err of env.errors) {
    lines.push(
      `  ${wrap(SGR.red, `error[${err.code}]`)}: ${err.message}${err.remediation ? ` — ${err.remediation}` : ""}`,
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Render and emit one envelope, honoring --json / --quiet / default mode
 * (feature 020 Rule "Output envelope principles"). Returns the process exit code
 * (non-zero only for error status).
 *
 * - `--json`: stdout is exactly the JSON envelope and nothing else.
 * - default: human-friendly text only on stdout; the envelope is NOT printed.
 *   Colourful (ANSI + restrained emoji) when stdout is an interactive terminal
 *   and NO_COLOR is unset; plain otherwise.
 * - `--quiet`: silent on a successful run (no stdout, no stderr). On a non-success
 *   run, print ONLY the warnings/errors — each naming its stable `code` and
 *   message — to stderr. Never the envelope, never stdout.
 *
 * @planks("stdout should contain a single JSON envelope and nothing else")
 * @planks("stdout should contain human-readable check results")
 * @planks("stdout should not contain a JSON envelope")
 * @planks("stdout should be empty")
 * @planks("stderr should be empty")
 * @planks("no human text, nor any field of the envelope when one is emitted, should contain the secret value")
 */
function emit(env: Envelope, args: ParsedArgs): number {
  if (args.json) {
    process.stdout.write(JSON.stringify(env) + "\n");
  } else if (args.quiet) {
    if (env.status !== "success") {
      const lines: string[] = [];
      for (const err of env.errors) {
        lines.push(
          `[${err.code}] ${err.message}${err.remediation ? ` — ${err.remediation}` : ""}`,
        );
      }
      for (const check of env.checks) {
        if (check.status === "warning" || check.status === "fail") {
          lines.push(`[${check.id}] ${check.description ?? checkGlyph(check.status)}`);
        }
      }
      if (lines.length === 0) lines.push(`[${env.status}] ${env.summary}`);
      process.stderr.write(lines.join("\n") + "\n");
    }
  } else {
    const colour = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];
    process.stdout.write(renderHuman(env, colour));
  }
  return env.status === "error" ? 1 : 0;
}

// ─── Project directory ────────────────────────────────────────────────────

/**
 * @planks("the agent runs `jolly --help`")
 * @planks("the agent runs `jolly start --json`")
 */
function projectDir(): string {
  return process.env["JOLLY_PROJECT_DIR"] ?? process.cwd();
}

/**
 * @planks(".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token")
 * @planks("^the \.env file Jolly wrote should be readable and writable only by its owner \(mode 600\)$")
 */
function envFilePath(): string {
  return join(projectDir(), ".env");
}

// ─── Shared skill set (features 007/001) ──────────────────────────────────

interface SkillSpec {
  id: string;
  ref: string;
  description: string;
}

const DEFAULT_SKILLS: SkillSpec[] = [
  { id: "jolly", ref: "dmytri/jolly", description: cliMessage("skills.catalog.jolly.description") },
  { id: "saleor-storefront", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-storefront", description: cliMessage("skills.catalog.saleorStorefront.description") },
  { id: "saleor-configurator", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-configurator", description: cliMessage("skills.catalog.saleorConfigurator.description") },
  { id: "storefront-builder", ref: "https://github.com/saleor/agent-skills/tree/main/skills/storefront-builder", description: cliMessage("skills.catalog.storefrontBuilder.description") },
  { id: "saleor-core", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-core", description: cliMessage("skills.catalog.saleorCore.description") },
  { id: "saleor-app", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-app", description: cliMessage("skills.catalog.saleorApp.description") },
  { id: "stripe-best-practices", ref: "stripe/ai@stripe-best-practices", description: cliMessage("skills.catalog.stripeBestPractices.description") },
];

// Universal project-local skill location `npx skills add` (no --agent) writes
// to, read by all supported agents (feature 007).
/**
 * @planks("^the Jolly skill should be installed under `\.agents\/skills\/jolly\/` from the bundled copy$")
 */
function agentsSkillsBaseDir(): string {
  return join(projectDir(), ".agents", "skills");
}

// Legacy per-agent location, kept so already-seeded workspaces still verify.
/**
 * @planks("it installs the default skill set with no network")
 */
function skillsBaseDir(): string {
  return join(projectDir(), ".claude", "skills");
}

/**
 * @planks("it installs the default skill set with no network")
 */
function skillInstalledOnDisk(skill: SkillSpec): boolean {
  // A skill is present when its directory (or SKILL.md) exists under either the
  // universal `.agents/skills/<id>/` or the legacy `.claude/skills/<id>/`.
  for (const base of [agentsSkillsBaseDir(), skillsBaseDir()]) {
    const dir = join(base, skill.id);
    if (existsSync(join(dir, "SKILL.md")) || existsSync(dir)) return true;
  }
  return false;
}

// ─── login / token verification (feature 018) ─────────────────────────────

/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 */
function loginRiskContext(dryRunAvailable = true): RiskContext {
  return {
    action: cliMessage("riskContext.action.login"),
    target: cloudApiBase(),
    riskLevel: "medium",
    categories: ["credential handling"],
    reversible: true,
    sideEffects: [cliMessage("riskContext.sideEffect.login.token")],
    dryRunAvailable,
  };
}


/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("the agent runs `jolly login` in a non-interactive shell")
 * @planks("the agent runs `jolly login`")
 */
async function commandLogin(args: ParsedArgs): Promise<Envelope> {
  const command = "login";
  // Non-interactive supply is the env/.env staff token only (feature 018 Rule
  // "Interactive authentication is the Saleor device authorization grant"):
  // there is no `--token`, `--token-file`, or `--token-stdin` flag and no
  // interactive paste — a secret never reaches Jolly through argv, a file
  // argument, or standard input.
  let token: string | undefined;
  const envRaw = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  if (envRaw !== undefined) {
    const envToken = envRaw.trim();
    if (envToken === "") {
      // Present-but-empty JOLLY_SALEOR_CLOUD_TOKEN: reject honestly naming the
      // empty variable rather than falling through to the no-source path.
      return errorEnvelope(
        command,
        cliMessage("login.summary.emptyToken"),
        [
          {
            code: "EMPTY_TOKEN",
            message: cliMessage("login.error.emptyToken.message"),
            remediation: cliMessage("login.error.emptyToken.remediation"),
          },
        ],
        {
          data: { riskContext: loginRiskContext() },
          nextSteps: [
            {
              description: cliMessage("login.next.runLogin"),
              command: "jolly login",
            },
          ],
        },
      );
    }
    token = envToken;
  }

  // --dry-run: preview only — write nothing and never start the device grant.
  if (args.dryRun) {
    return envelope({
      command,
      status: "success",
      summary: cliMessage("login.summary.previewedOnly"),
      data: { riskContext: loginRiskContext(), dryRun: true },
      nextSteps: [
        {
          description: cliMessage("login.next.runLoginOrSetToken"),
          command: "jolly login",
        },
      ],
    });
  }

  // No staff token configured: sign in through the Saleor device authorization
  // grant (feature 018, Rule "Interactive authentication is the Saleor device
  // authorization grant") — a missing token starts the grant, it never errors
  // merely because no token is configured. An interactive terminal renders the
  // code + URL through Bombshell's prompt UI; an agent-driven (non-interactive)
  // run relays the same user code + verification URL to its human on plain
  // stderr. Both then poll while the human authorizes.
  if (token === undefined && process.stdin.isTTY && !args.json && !args.yes) {
    return await deviceGrantLogin(command);
  }

  if (token === undefined) {
    return await deviceGrantLoginAgent(command, args);
  }

  // Verify the env/.env staff token via an authenticated Token-scheme GET of
  // organizations/.
  let orgs: CloudOrganization[] | undefined;
  let verificationFailure: unknown;
  try {
    orgs = await listOrganizations(token);
  } catch (err) {
    verificationFailure = err;
  }

  if (
    verificationFailure instanceof CloudApiError &&
    (verificationFailure.httpStatus === 401 || verificationFailure.httpStatus === 403)
  ) {
    // Invalid token: write nothing, error honestly.
    return errorEnvelope(
      command,
      cliMessage("login.summary.rejected"),
      [
        {
          code: "INVALID_TOKEN",
          message: cliMessage("login.error.invalidToken.message"),
          remediation: cliMessage("login.error.invalidToken.remediation"),
        },
      ],
      {
        checks: [
          {
            id: "cloud-token-verification",
            status: "fail",
            description: cliMessage("login.check.cloudTokenVerification.fail"),
          },
        ],
        data: { riskContext: loginRiskContext() },
        nextSteps: [
          {
            description: cliMessage("login.next.runLoginAfterRejection"),
            command: "jolly login",
          },
        ],
      },
    );
  }

  if (verificationFailure) {
    // Unreachable / 5xx / timeout: store token, warn "stored, not verified".
    writeEnvValues(projectDir(), { JOLLY_SALEOR_CLOUD_TOKEN: token });
    // A manual CLOUD token is the agent-facing store token (CLOUD wins), so
    // project it into SALEOR_TOKEN; it is long-lived, so no refresh rewrite.
    projectSaleorAgentEnv();
    return envelope({
      command,
      status: "warning",
      summary: cliMessage("login.summary.storedNotVerified"),
      data: {
        cloudTokenStored: true,
        verified: false,
        verification: "stored, not verified",
        riskContext: loginRiskContext(),
      },
      checks: [
        {
          id: "cloud-token-verification",
          status: "unknown",
          description: cliMessage("login.check.cloudTokenVerification.unknown"),
        },
      ],
      nextSteps: [
        {
          description: cliMessage("login.next.reRunWhenReachable"),
          command: "jolly login",
        },
      ],
    });
  }

  // Verified: store token + the real organization name.
  const orgName = resolveOrgName(orgs ?? []);
  const values: Record<string, string> = { JOLLY_SALEOR_CLOUD_TOKEN: token };
  if (orgName) values["JOLLY_SALEOR_ORGANIZATION"] = orgName;
  writeEnvValues(projectDir(), values);
  projectSaleorAgentEnv();

  return envelope({
    command,
    status: "success",
    summary: orgName
      ? cliMessage("login.summary.storedWithOrganization", { orgName })
      : cliMessage("login.summary.stored"),
    data: {
      cloudTokenStored: true,
      verified: true,
      accountContext: orgName ?? "unknown",
      riskContext: loginRiskContext(),
    },
    checks: [
      {
        id: "cloud-token-verification",
        status: "pass",
        description: cliMessage("login.check.cloudTokenVerification.pass"),
      },
    ],
    nextSteps: [
      {
        description: cliMessage("login.next.createStore"),
        command: "jolly create store --create-environment",
      },
    ],
  });
}

// The interactive Saleor sign-in through the device authorization grant — the
// ONE seam the interactive `jolly login` (feature 018) and the inline `jolly
// start` sign-in (feature 027, "the same grant as `jolly login`") share.
// Request a device code, display the user code + the verification URL carrying
// that code as its `user_code` query parameter — wrapped as an OSC 8 hyperlink,
// copy from the message catalog — through Bombshell's prompt UI, then poll the
// token endpoint while the human authorizes (the poll honours the grant's
// interval and backs off on slow_down, src/lib/device-grant.ts). On approval:
// write only the access + refresh variables to .env — never the staff token
// JOLLY_SALEOR_CLOUD_TOKEN (feature 018 scheme rule) — make them live in the
// current process so the same session continues with the acquired credentials,
// and project the agent-facing SALEOR_TOKEN so .env never holds a stale store
// token after a sign-in.
/**
 * @planks("the agent runs `jolly login`")
 * @planks("`jolly start` runs in an interactive terminal")
 * @planks("the interactive output should show the device user code and the verification URL before any setup stage runs")
 * @planks("it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN")
 * @planks("it should store the device-grant refresh token in .env as JOLLY_SALEOR_REFRESH_TOKEN")
 * @planks("the run should continue past the auth stage in the same session")
 */
async function interactiveDeviceGrantSignIn(): Promise<void> {
  const auth = await requestDeviceCode();
  const signInUrl = `${auth.verificationUri}?user_code=${auth.userCode}`;
  clackNote(
    cliMessage("start.note.signInBody", { link: osc8Hyperlink(signInUrl), code: auth.userCode }),
    cliMessage("start.note.signIn"),
    CLACK_STDERR,
  );
  const tokens = await pollForDeviceTokens(auth);
  writeEnvValues(projectDir(), {
    JOLLY_SALEOR_ACCESS_TOKEN: tokens.accessToken,
    JOLLY_SALEOR_REFRESH_TOKEN: tokens.refreshToken,
  });
  process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = tokens.accessToken;
  process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = tokens.refreshToken;
  projectSaleorAgentEnv();
}

// Interactive `jolly login`: the shared device-grant sign-in, closed with the
// login success envelope.
/**
 * @planks("the agent runs `jolly login`")
 */
async function deviceGrantLogin(command: string): Promise<Envelope> {
  await interactiveDeviceGrantSignIn();
  return envelope({
    command,
    status: "success",
    summary: cliMessage("login.summary.success"),
    data: { cloudTokenStored: true, riskContext: loginRiskContext() },
  });
}

// Seconds the agent RE-RUN polls the persisted device code for the human's
// approval. The first agent invocation does NOT poll — it returns the
// verification URL in its envelope (so the agent renders a clickable link) and
// persists the code; the human approves in their browser, then the agent re-runs
// and THIS window polls the SAME code (the approval already happened, so it
// lands quickly). Short by default so a re-run the human has not yet approved
// returns the URL again promptly rather than hanging. The test harness overrides
// it via HARNESS_AGENT_POLL_WINDOW_SECONDS.
const AGENT_RESUME_POLL_DEFAULT_SECONDS = 12;
/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 */
function agentResumePollSeconds(): number {
  const override = harnessGuardActive()
    ? process.env.HARNESS_AGENT_POLL_WINDOW_SECONDS
    : undefined;
  return override ? Number(override) : AGENT_RESUME_POLL_DEFAULT_SECONDS;
}

// The pending device authorization is persisted between agent invocations so the
// re-run RESUMES the same code the human approved out-of-band, instead of
// requesting a new one each run (which would orphan the approval). Lives in the
// project dir; cleared on success or genuine expiry. Feature 018.
const PENDING_DEVICE_AUTH_FILE = ".jolly-pending-auth.json";

/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 */
function pendingDeviceAuthPath(): string {
  return join(projectDir(), PENDING_DEVICE_AUTH_FILE);
}

/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 */
function loadPendingDeviceAuth(): DeviceAuthorization | undefined {
  try {
    const saved = JSON.parse(readFileSync(pendingDeviceAuthPath(), "utf8")) as DeviceAuthorization & {
      savedAt?: number;
    };
    if (!saved.deviceCode) return undefined;
    if (typeof saved.savedAt === "number" && typeof saved.expiresIn === "number") {
      const remaining = saved.expiresIn - (Date.now() - saved.savedAt) / 1000;
      if (remaining <= 1) {
        clearPendingDeviceAuth();
        return undefined;
      }
      saved.expiresIn = Math.floor(remaining); // poll only the REMAINING lifetime
    }
    return saved;
  } catch {
    return undefined;
  }
}

/**
 * @planks("it should persist the pending device authorization for the re-run")
 */
function savePendingDeviceAuth(auth: DeviceAuthorization): void {
  try {
    writeFileSync(pendingDeviceAuthPath(), JSON.stringify({ ...auth, savedAt: Date.now() }));
  } catch {
    /* best-effort: persistence only enables the re-run resume */
  }
}

/**
 * @planks("the persisted pending device authorization should be cleared")
 */
function clearPendingDeviceAuth(): void {
  try {
    rmSync(pendingDeviceAuthPath(), { force: true });
  } catch {
    /* best-effort */
  }
}

// The verification URL the human opens to approve the sign-in. Carried in the
// result envelope (a nextStep) so the agent renders it as a clickable link —
// never buried in stdout/stderr noise (feature 018).
/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 */
function deviceVerificationUrl(auth: DeviceAuthorization): string {
  return auth.verificationUriComplete ?? `${auth.verificationUri}?user_code=${auth.userCode}`;
}

// The nextStep that hands the human the clickable verification URL and tells the
// agent to re-run once approved.
/**
 * @planks("a nextStep should carry the Saleor device verification URL for the human to open and approve")
 */
function deviceAuthNextStep(auth: DeviceAuthorization, command: string): NextStep {
  const url = deviceVerificationUrl(auth);
  return {
    description: cliMessage("login.next", { url, command }),
    url,
    command,
  };
}

type DeviceGrantOutcome =
  | { status: "approved"; tokens: { accessToken: string; refreshToken: string } }
  | { status: "pending"; auth: DeviceAuthorization };

// Drive the agent-path Saleor device grant WITHOUT blocking on the human. First
// call (no persisted code): request a code, persist it, return `pending` with the
// verification URL for the envelope — no polling, since the human has not seen
// the URL yet. Re-run (persisted code present): poll the SAME code for the
// bounded re-run window; on approval return the tokens and clear the persisted
// code, still unapproved return `pending` again with the same URL. Feature 018.
/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("it should persist the pending device authorization for the re-run")
 * @planks("it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN")
 * @planks("the persisted pending device authorization should be cleared")
 */
async function agentDeviceGrant(): Promise<DeviceGrantOutcome> {
  const persisted = loadPendingDeviceAuth();
  if (!persisted) {
    const auth = await requestDeviceCode();
    savePendingDeviceAuth(auth);
    return { status: "pending", auth };
  }
  try {
    const tokens = await pollForDeviceTokens({
      ...persisted,
      expiresIn: Math.min(persisted.expiresIn, agentResumePollSeconds()),
    });
    clearPendingDeviceAuth();
    return { status: "approved", tokens };
  } catch (err) {
    if (err instanceof DeviceGrantError && err.code === "DEVICE_CODE_EXPIRED") {
      // Not approved within the re-run window; keep the persisted code (if its
      // real lifetime remains) so the next re-run resumes it, and hand back the
      // URL again.
      return { status: "pending", auth: loadPendingDeviceAuth() ?? persisted };
    }
    throw err;
  }
}

// Agent-driven sign-in through the Saleor device authorization grant. The first
// call returns the verification URL in the result envelope (a clickable nextStep,
// never stdout/stderr noise) and persists the device code; the human approves in
// their browser and the agent re-runs, which polls the SAME code and, on
// approval, stores the access + refresh tokens (never the staff token) and exits
// successfully. The envelope never carries a token value. Feature 018.
/**
 * @planks("^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("a nextStep should carry the Saleor device verification URL for the human to open and approve")
 */
async function deviceGrantLoginAgent(
  command: string,
  _args: ParsedArgs,
): Promise<Envelope> {
  const outcome = await agentDeviceGrant();
  if (outcome.status === "approved") {
    writeEnvValues(projectDir(), {
      JOLLY_SALEOR_ACCESS_TOKEN: outcome.tokens.accessToken,
      JOLLY_SALEOR_REFRESH_TOKEN: outcome.tokens.refreshToken,
    });
    process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = outcome.tokens.accessToken;
    process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = outcome.tokens.refreshToken;
    // Project the fresh access token into the agent-facing SALEOR_TOKEN.
    projectSaleorAgentEnv();
    return envelope({
      command,
      status: "success",
      summary: cliMessage("login.summary.success"),
      data: { cloudTokenStored: true, riskContext: loginRiskContext() },
    });
  }
  // Pending: hand the human the clickable verification URL in the envelope (the
  // code is persisted). The human approves in their browser, then the agent
  // re-runs `jolly login` to finish — the re-run resumes the SAME code.
  return envelope({
    command,
    status: "warning",
    summary: cliMessage("login.summary.approvalPending"),
    data: {
      authorizationPending: true,
      verificationUrl: deviceVerificationUrl(outcome.auth),
      userCode: outcome.auth.userCode,
      riskContext: loginRiskContext(),
    },
    nextSteps: [deviceAuthNextStep(outcome.auth, "jolly login")],
  });
}

/**
 * @planks("it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION")
 */
function resolveOrgName(orgs: CloudOrganization[]): string | undefined {
  const first = orgs[0];
  if (!first) return undefined;
  const name = first.name ?? first.slug;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// ─── logout (feature 018) ─────────────────────────────────────────────────

const MANAGED_AUTH_VARS = [
  "JOLLY_SALEOR_CLOUD_TOKEN",
  "JOLLY_SALEOR_ACCESS_TOKEN",
  "JOLLY_SALEOR_REFRESH_TOKEN",
  // The agent-facing store token Jolly projects from the internal auth layer.
  // SALEOR_URL / NEXT_PUBLIC_SALEOR_API_URL are non-secret Paper config and are
  // NOT purged (feature 018) — only the secret SALEOR_TOKEN is.
  "SALEOR_TOKEN",
  "JOLLY_SALEOR_ORGANIZATION",
];

/**
 * @planks("the agent runs `jolly logout`")
 * @planks("Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_ACCESS_TOKEN, JOLLY_SALEOR_REFRESH_TOKEN, SALEOR_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env")
 */
function commandLogout(_args: ParsedArgs): Envelope {
  const command = "logout";
  const before = loadEnvValues(projectDir());
  const path = envFilePath();
  const removed: string[] = [];

  if (existsSync(path)) {
    const lineRe = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
    const kept = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => {
        const m = lineRe.exec(line);
        if (m && MANAGED_AUTH_VARS.includes(m[1])) {
          removed.push(m[1]);
          return false;
        }
        return true;
      });
    // Rewrite .env without the managed auth vars, preserving everything else
    // (comments, blank lines, third-party credentials) verbatim.
    let text = kept.join("\n").replace(/\n+$/, "");
    text = text.length > 0 ? text + "\n" : "";
    writeFileSync(path, text);
  }

  return envelope({
    command,
    status: "success",
    summary:
      removed.length > 0
        ? cliMessage("logout.summary.removed", { removed: [...new Set(removed)].join(", ") })
        : cliMessage("logout.summary.nothingPresent"),
    data: {
      removed: [...new Set(removed)],
      preservedOthers: true,
    },
    checks: [
      {
        id: "auth-cleared",
        status: "pass",
        description: cliMessage("logout.check.authCleared.pass"),
      },
    ],
    nextSteps: [
      {
        description: cliMessage("logout.next"),
        command: "jolly login",
      },
    ],
  });
}

// ─── auth status (feature 018) ────────────────────────────────────────────

/**
 * `jolly auth --help`: names auth's subcommand surface in `data.subcommands`,
 * so `status` is auth's subcommand and never a top-level command.
 * @planks("`status` should appear as a subcommand of `auth`, never as a top-level command")
 */
function commandAuthHelp(): Envelope {
  return envelope({
    command: "auth --help",
    status: "success",
    summary: cliMessage("cli.error.unknownAuthSubcommand.message"),
    data: {
      subcommands: [
        {
          name: "status",
          description: cliMessage("cli.next.authStatus"),
        },
      ],
    },
    nextSteps: [
      {
        description: cliMessage("cli.next.authStatus"),
        command: "jolly auth status",
      },
    ],
  });
}

/**
 * @planks("it invokes `jolly auth status`")
 * @planks("Jolly should report whether Saleor Cloud authentication is configured")
 * @planks("the agent runs `jolly auth status --json`")
 * @planks("the envelope status should not be {string}")
 * @planks("no envelope field or human text should affirmatively claim success, a verified store, or an authenticated session")
 */
function commandAuthStatus(_args: ParsedArgs): Envelope {
  const command = "auth status";
  const values = loadEnvValues(projectDir());
  // The cloud token's supply channels, in cloudPlatformToken's staff-leg
  // order: .env first, then the process environment — the documented
  // non-interactive supply (feature 018). Reading only .env would report
  // "not configured" while every other command used the environment token.
  const fileCloudToken = (values["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "").trim();
  const envCloudToken = (process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "").trim();
  const hasCloudToken = fileCloudToken !== "" || envCloudToken !== "";
  const hasSaleorToken = Boolean(values["SALEOR_TOKEN"]);
  const org = values["JOLLY_SALEOR_ORGANIZATION"];
  const accountContext = org && org.length > 0 ? org : cliMessage("auth.value.unknownOrganization");

  const checks: Check[] = [
    {
      id: "cloud-token-configured",
      // Presence is the only fact this command establishes — it performs no
      // verifying operation — so a present token reports configured-ness,
      // never validity. The description names the supply channel it actually
      // observed: the ".env" copy only when .env really holds the token.
      status: hasCloudToken ? "pass" : "warning",
      description:
        fileCloudToken !== ""
          ? cliMessage("checks.check.cloudTokenConfigured.pass")
          : hasCloudToken
            ? cliMessage("auth.status.summary.configured", { accountContext })
            : cliMessage("checks.check.cloudTokenConfigured.warning"),
    },
    {
      id: "saleor-token-configured",
      status: hasSaleorToken ? "pass" : "skipped",
      description: hasSaleorToken
        ? cliMessage("checks.check.saleorTokenConfigured.pass")
        : cliMessage("checks.check.saleorTokenConfigured.skipped"),
    },
  ];

  // A present token is stored, not verified in this run, and junk input
  // must never yield success language (feature 020 Rule "No fabricated
  // success"), so token-present reports "warning", never "success". Each
  // branch passes its status as a literal so the error-envelope enumeration
  // (feature 020) can see that neither builds an error envelope.
  if (hasCloudToken) {
    return envelope({
      command,
      status: "warning",
      summary: cliMessage("auth.status.summary.configured", { accountContext }),
      data: {
        hasCloudToken,
        hasSaleorToken,
        accountContext,
      },
      checks,
      nextSteps: [],
    });
  }
  return envelope({
    command,
    status: "success",
    summary: cliMessage("auth.status.summary.notConfigured"),
    data: {
      hasCloudToken,
      hasSaleorToken,
      accountContext,
    },
    checks,
    nextSteps: [
      {
        description: cliMessage("auth.status.next"),
        command: "jolly login",
      },
    ],
  });
}

// ─── create store (feature 012) ───────────────────────────────────────────

/**
 * @planks("the agent runs `jolly create store --create-environment --dry-run --json`")
 * @planks("the agent runs `jolly create store --create-environment --json`")
 */
function createStoreRiskContext(target: unknown, dryRunAvailable = true): RiskContext {
  return {
    action: cliMessage("riskContext.action.createStore"),
    target,
    riskLevel: "medium",
    categories: ["billing", "production configuration changes"],
    reversible: false,
    sideEffects: [
      cliMessage("riskContext.sideEffect.createStore.project"),
      cliMessage("riskContext.sideEffect.createStore.env"),
    ],
    dryRunAvailable,
  };
}

// The GraphQL host an environment serves, from its `domain` or `domain_label`.
function environmentHost(env: CloudEnvironment): string | undefined {
  if (typeof env.domain === "string" && env.domain) {
    return env.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
  if (typeof env.domain_label === "string" && env.domain_label) {
    return `${env.domain_label}.saleor.cloud`;
  }
  return undefined;
}

// Resolve the Cloud organization + environment a pasted GraphQL endpoint belongs
// to (feature 012): match the endpoint host against the caller's Cloud
// environments and return the resolved organization slug + environment.
// Best-effort — no configured token or no match just omits the inference; it
// never fails the endpoint-store path.
/**
 * @planks("the agent runs `jolly create store --url` on the verified Saleor endpoint with `--json`")
 */
async function inferStoreLocation(
  endpoint: string,
): Promise<{ organization: string; environment: CloudEnvironment } | undefined> {
  const token = cloudPlatformToken(loadEnvValues(projectDir()));
  if (!token) return undefined;
  let host: string;
  try {
    host = new URL(endpoint).host;
  } catch {
    return undefined;
  }
  try {
    for (const org of await listOrganizations(token)) {
      const slug = String(org.slug ?? "");
      if (!slug) continue;
      const match = (await listEnvironments(token, slug)).find(
        (env) => environmentHost(env) === host,
      );
      if (match) return { organization: slug, environment: match };
    }
  } catch {
    // Best-effort; a Cloud API hiccup must not fail the endpoint-store path.
  }
  return undefined;
}

/**
 * @planks("the agent runs `jolly create store --url https:\/\/test-shop.saleor.cloud\/graphql\/`")
 * @planks("a pasted Saleor URL https:\/\/my-shop.saleor.cloud\/dashboard\/")
 * @planks("a pasted Saleor URL https:\/\/my-shop.saleor.cloud")
 * @planks("a pasted Saleor URL https:\/\/my-shop.saleor.cloud\/graphql\/")
 * @planks("the agent runs `jolly create store --url https:\/\/my-shop.saleor.cloud\/dashboard\/ --json`")
 * @planks("the agent runs `jolly create store --url https:\/\/my-shop.saleor.cloud --json`")
 * @planks("the agent runs `jolly create store --url https:\/\/my-shop.saleor.cloud\/graphql\/ --json`")
 * @planks("the agent runs `jolly create store --create-environment --dry-run --json`")
 * @planks("the Cloud token can access organizations {string} and {string}")
 * @planks("the agent runs `jolly create store --create-environment` without `--organization`")
 * @planks("^the agent runs `jolly create store --url https:\/\/evil\.example\.com\/graphql\/ --json`$")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function commandCreateStore(args: ParsedArgs): Promise<Envelope> {
  const command = "create store";
  const url = args.options["url"];

  // Mode 1: write a pasted Saleor URL to .env (feature 012). -------------
  if (url && !args.flags.has("create-environment")) {
    const normalized = normalizeSaleorUrl(url);
    if (!normalized.endpoint) {
      return errorEnvelope(
        command,
        cliMessage("createStore.summary.urlNotNormalizable"),
        [
          {
            code: "INVALID_SALEOR_URL",
            message: normalized.clarification ?? cliMessage("createStore.error.invalidSaleorUrl.message"),
            remediation: cliMessage("createStore.error.invalidSaleorUrl.remediation"),
          },
        ],
        {
          data: { riskContext: createStoreRiskContext(url) },
          nextSteps: [
            {
              description: cliMessage("createStore.next.reRunWithSaleorUrl"),
              command: "jolly create store --url https://<store>.saleor.cloud/graphql/",
            },
          ],
        },
      );
    }

    // First-party-host guard (feature 020): a store endpoint on a non-first-party
    // host is refused up front, writing nothing. Jolly's request layer only ever
    // contacts first-party Saleor hosts, so storing such a URL would only fail
    // later — refuse here with the same stable code the request layer raises.
    const pastedHost = new URL(normalized.endpoint).hostname;
    if (!isFirstPartyHost(pastedHost)) {
      return errorEnvelope(
        command,
        cliMessage("createStore.summary.nonFirstPartyHost", { pastedHost }),
        [
          {
            code: "NON_FIRST_PARTY_HOST",
            message: cliMessage("createStore.error.nonFirstPartyHost.message", { pastedHost }),
            remediation: cliMessage("createStore.error.nonFirstPartyHost.remediation"),
          },
        ],
        {
          data: { riskContext: createStoreRiskContext(normalized.endpoint) },
          nextSteps: [
            {
              description: cliMessage("createStore.next.reRunWithCloudUrl"),
              command: "jolly create store --url https://<store>.saleor.cloud/graphql/",
            },
          ],
        },
      );
    }

    if (args.dryRun) {
      return envelope({
        command,
        status: "success",
        summary: cliMessage("createStore.summary.previewedOnly"),
        data: {
          dryRun: true,
          normalizedUrl: normalized.endpoint,
          riskContext: createStoreRiskContext(normalized.endpoint),
        },
        nextSteps: [
          {
            description: cliMessage("createStore.next.reRunWithoutDryRun"),
            command: `jolly create store --url ${normalized.endpoint}`,
          },
        ],
      });
    }

    // Collision guard (feature 022): if .env already carries a DIFFERENT
    // endpoint Jolly is being asked to overwrite, pause and ask rather than
    // silently replacing state Jolly did not create. The agent decides via
    // the feature 021 riskContext; --yes is its explicit go-ahead.
    const existingEndpoint = loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"];
    if (
      existingEndpoint &&
      existingEndpoint !== normalized.endpoint &&
      !args.flags.has("yes")
    ) {
      return envelope({
        command,
        status: "warning",
        summary: cliMessage("createStore.summary.endpointConflict"),
        data: {
          collision: true,
          existingEndpoint,
          requestedEndpoint: normalized.endpoint,
          riskContext: {
            action: cliMessage("riskContext.action.overwriteEndpoint"),
            target: cliMessage("riskContext.target.overwriteEndpoint"),
            riskLevel: "medium",
            categories: ["destructive operations", "production configuration changes"],
            reversible: false,
            sideEffects: [
              cliMessage("riskContext.sideEffect.overwriteEndpoint.replace", {
                existingEndpoint,
                newEndpoint: normalized.endpoint,
              }),
            ],
            dryRunAvailable: true,
          },
        },
        checks: [
          {
            id: "saleor-endpoint-collision",
            status: "warning",
            description: cliMessage("createStore.check.saleorEndpointCollision.warning"),
          },
        ],
        nextSteps: [
          {
            description: cliMessage("createStore.next.reRunWithYesToOverwrite"),
            command: `jolly create store --url ${normalized.endpoint} --yes`,
          },
        ],
      });
    }

    // Resolve which Cloud organization + environment this endpoint belongs to,
    // when a Cloud token is configured (feature 012). Best-effort: a missing
    // token or no match just stores the endpoint as before.
    const location = await inferStoreLocation(normalized.endpoint);
    writeEnvValues(
      projectDir(),
      { NEXT_PUBLIC_SALEOR_API_URL: normalized.endpoint },
    );
    // Project the agent-facing store surface (SALEOR_URL + the resolved
    // SALEOR_TOKEN) now that the endpoint is known.
    projectSaleorAgentEnv();
    return envelope({
      command,
      status: "success",
      summary: location
        ? cliMessage("createStore.summary.storedWithOrganization", { organization: location.organization })
        : cliMessage("createStore.summary.storedNotVerified"),
      data: {
        stored: true,
        envVar: "NEXT_PUBLIC_SALEOR_API_URL",
        ...(location
          ? { organization: location.organization, environment: location.environment }
          : {}),
        riskContext: createStoreRiskContext(normalized.endpoint),
      },
      checks: [
        {
          id: "saleor-endpoint-stored",
          status: "pass",
          description: cliMessage("createStore.check.saleorEndpointStored.pass"),
        },
      ],
      nextSteps: [
        {
          description: cliMessage("createStore.next.runStartToContinue"),
          command: "jolly start",
        },
      ],
    });
  }

  // Mode 2: provision a Saleor Cloud environment via the Cloud API. ------
  // `.env`-first: a real agent writes the Cloud token to the project `.env`
  // (via `jolly login`/`jolly create store`) and does not export it (feature
  // 008 Rule "Credentials are read from .env").
  const token = cloudPlatformToken(loadEnvValues(projectDir()));
  const region = args.options["region"] ?? "us-east-1";
  const orgOverride = args.options["organization"];
  const name = args.options["name"];
  const domainLabel = args.options["domain-label"];

  if (!token) {
    return errorEnvelope(
      command,
      cliMessage("createStore.summary.noToken"),
      [
        {
          code: "MISSING_CLOUD_TOKEN",
          message: cliMessage("createStore.error.missingCloudToken.message"),
          remediation: cliMessage("createStore.error.missingCloudToken.remediation"),
        },
      ],
      {
        data: {
          riskContext: createStoreRiskContext(`${cloudApiBase()} (organization unresolved)`),
        },
        nextSteps: [
          {
            description: cliMessage("createStore.next.runLoginForToken"),
            command: "jolly login",
          },
        ],
      },
    );
  }

  // Resolve the organization. --mock-organizations injects a deterministic
  // org list for the @logic multi-org warning scenario (no network), only
  // when the harness guard is active — a customer's environment never sets
  // it, so this affordance never fabricates for a customer.
  let orgs: CloudOrganization[];
  const mock = harnessGuardActive()
    ? args.flags.has("mock-organizations")
      ? ""
      : (args.options["mock-organizations"] ?? undefined)
    : undefined;
  if (mock !== undefined) {
    orgs = (mock.length > 0 ? mock.split(",") : ["org-one", "org-two"]).map((slug) => ({
      slug: slug.trim(),
    }));
  } else {
    try {
      orgs = await listOrganizations(token);
    } catch (err) {
      return cloudErrorEnvelope(command, err, createStoreRiskContext(cloudApiBase()));
    }
  }

  let selectedOrg: string;
  let multiOrgWarning = false;
  if (orgOverride) {
    selectedOrg = orgOverride;
  } else if (orgs.length === 0) {
    return errorEnvelope(
      command,
      cliMessage("createStore.summary.noOrganizations"),
      [
        {
          code: "NO_ORGANIZATIONS",
          message: cliMessage("createStore.error.noOrganizations.message"),
          remediation: cliMessage("createStore.error.noOrganizations.remediation"),
        },
      ],
      {
        data: { riskContext: createStoreRiskContext(cloudApiBase()) },
        nextSteps: [
          {
            description: cliMessage("createStore.next.signInWithOrganization"),
            command: "jolly login",
          },
        ],
      },
    );
  } else if (orgs.length === 1) {
    selectedOrg = orgs[0].slug;
  } else {
    selectedOrg = orgs[0].slug;
    multiOrgWarning = true;
  }

  const resolvedTarget = `${cloudApiBase()}/organizations/${selectedOrg}/environments/`;
  const effectiveName = name ?? "jolly-store";
  const effectiveDomainLabel = domainLabel ?? effectiveName;

  // --dry-run: show the real resolved request, write nothing. -----------
  if (args.dryRun) {
    const requestBody = environmentCreationBody({
      name: effectiveName,
      project: effectiveName,
      domainLabel: effectiveDomainLabel,
      service: "saleor",
      region,
    });
    const env = envelope({
      command,
      status: multiOrgWarning ? "warning" : "success",
      summary: multiOrgWarning
        ? cliMessage("createStore.env.summary.warning", { selectedOrg })
        : cliMessage("createStore.env.summary.success", { selectedOrg }),
      data: {
        dryRun: true,
        method: "POST",
        requestPath: `/platform/api/organizations/${selectedOrg}/environments/`,
        requestUrl: resolvedTarget,
        organization: selectedOrg,
        region,
        databaseTemplate: "blank",
        graphqlApiUrl: `https://${effectiveDomainLabel}.saleor.cloud/graphql/`,
        dashboardUrl: `https://${effectiveDomainLabel}.saleor.cloud/dashboard/`,
        requestBody,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      nextSteps: [
        {
          description: cliMessage("createStore.env.next.reRunWithoutDryRun"),
          command: "jolly create store --create-environment",
        },
      ],
    });
    env.data["availableOrganizations"] = orgs.map((o) => o.slug);
    env.data["selectedOrganization"] = selectedOrg;
    return env;
  }

  // Multi-org without --organization (non-dry-run): warn before proceeding
  // so the agent can re-run with the right org (feature 012).
  if (multiOrgWarning) {
    return envelope({
      command,
      status: "warning",
      summary: cliMessage("createStore.summary.multipleOrganizations", { selectedOrg }),
      data: {
        availableOrganizations: orgs.map((o) => o.slug),
        selectedOrganization: selectedOrg,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      checks: [
        {
          id: "organization-selection",
          status: "warning",
          description: cliMessage("createStore.check.organizationSelection.warning", { selectedOrg }),
        },
      ],
      nextSteps: [
        {
          description: cliMessage("createStore.next.reRunWithOrganization", {
            organizations: orgs.map((o) => o.slug).join(", "),
          }),
          command: `jolly create store --create-environment --organization ${selectedOrg}`,
        },
      ],
    });
  }

  // Real provisioning: create-or-reuse project, create env, poll, write .env.
  // provisionStore() itself waits for a freshly-created environment to
  // actually serve before returning (a reused one is already serving) — so
  // this command never claims "ready" for a store that hasn't answered a
  // live probe yet.
  try {
    const result = await provisionStore(token, selectedOrg, {
      name: effectiveName,
      domainLabel: effectiveDomainLabel,
      region,
    });
    return envelope({
      command,
      status: result.readinessTimedOut ? "warning" : "success",
      summary: result.readinessTimedOut
        ? cliMessage("createStore.summary.environmentUnreachable", {
            environmentName: result.environmentName,
            selectedOrg,
          })
        : cliMessage("createStore.summary.environmentReady", { selectedOrg }),
      data: {
        organization: selectedOrg,
        organizationSlug: selectedOrg,
        environmentName: result.environmentName,
        ...(result.environmentKey ? { environmentKey: result.environmentKey } : {}),
        projectCreated: result.projectCreated,
        projectReused: !result.projectCreated,
        environmentCreated: result.environmentCreated,
        graphqlEndpointStored: true,
        graphqlApiUrl: result.graphqlApiUrl,
        dashboardUrl: result.dashboardUrl,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      checks: [
        {
          id: "environment-provisioned",
          status: result.readinessTimedOut ? "fail" : "pass",
          description: result.readinessTimedOut
            ? cliMessage("createStore.check.environmentProvisioned.unreachable")
            : result.environmentCreated
              ? cliMessage("createStore.check.environmentProvisioned.verified")
              : cliMessage("createStore.check.environmentProvisioned.pass"),
          ...(result.readinessTimedOut
            ? { remediation: cliMessage("createStore.remediation") }
            : {}),
        },
      ],
      nextSteps: [
        result.readinessTimedOut
          ? {
              description: cliMessage("createStore.next.reRunDoctorWhenServing"),
              command: "jolly doctor",
            }
          : {
              description: cliMessage("createStore.next.continueBootstrap"),
              command: "jolly start",
            },
      ],
    });
  } catch (err) {
    return cloudErrorEnvelope(command, err, createStoreRiskContext(resolvedTarget));
  }
}

/** The result of provisioning (or reusing) a Saleor Cloud store environment. */
interface StoreProvisionResult {
  graphqlApiUrl: string;
  dashboardUrl: string;
  organization: string;
  environmentName: string;
  environmentKey?: string;
  projectCreated: boolean;
  environmentCreated: boolean;
  /** True when a freshly-created environment never answered a live GraphQL
   * probe within the readiness budget. Only meaningful when
   * environmentCreated is true — a reused environment is already serving.
   * Each caller (jolly start's store stage, jolly create store) translates
   * this into its own envelope shape rather than provisionStore() picking
   * one representation for both. */
  readinessTimedOut: boolean;
}

/**
 * Read a positive-integer millisecond budget from the environment, falling back
 * to `fallback` when the variable is unset, empty, non-numeric, or non-positive.
 * Lets the readiness gate's budget and poll interval be tuned (e.g. squeezed to
 * sub-second in a never-serves test) without changing real behaviour: the
 * defaults are the production values, so an absent/invalid override is a no-op.
 */
function readPositiveIntEnvMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the store stage's readiness budget in milliseconds: 600 seconds by
 * default, overridable via `JOLLY_READINESS_BUDGET_MS`.
 *
 * @planks("the readiness budget is configured to {float} seconds via `JOLLY_READINESS_BUDGET_MS`")
 */
export function resolveReadinessBudgetMs(): number {
  return readPositiveIntEnvMs("JOLLY_READINESS_BUDGET_MS", 600_000);
}

/**
 * Create-or-reuse a Saleor Cloud project + environment via the Cloud API, poll
 * until ready, and write the resulting NEXT_PUBLIC_SALEOR_API_URL + the
 * agent-facing SALEOR_URL/SALEOR_TOKEN to `.env` (and into this process so
 * later in-process stages see them). The shared plumbing behind both
 * `jolly create store --create-environment` and `jolly start`'s auto-provision
 * store stage (feature 002 "Auto-provisioning a store"). Idempotent (feature
 * 022): an existing project/environment matching the name/domain label is reused
 * rather than recreated.
 *
 * @planks("the agent runs `jolly create store --create-environment --json` namespaced with the run's jolly-cannon-fodder identifier")
 * @planks("Jolly should discover the organization from the Cloud API")
 * @planks("it should reuse an existing project when one exists, otherwise create one via POST \/platform\/api\/organizations\/\{organization}\/projects\/ with plan={string}")
 * @planks("it should create an environment via POST \/platform\/api\/organizations\/\{organization}\/environments\/")
 * @planks("Jolly should extract the resulting domain from the task result")
 * @planks("it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain")
 * @planks("it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session")
 */
async function provisionStore(
  token: string,
  selectedOrg: string,
  opts: { name: string; domainLabel: string; region: string },
): Promise<StoreProvisionResult> {
  const { name: effectiveName, domainLabel: effectiveDomainLabel, region } = opts;
  const projects = await listProjects(token, selectedOrg);
  const existingProject = projects.find((p) => p.name === effectiveName) ?? projects[0];
  let project: { name: string; slug?: string };
  let projectCreated: boolean;
  if (existingProject) {
    project = existingProject;
    projectCreated = false;
  } else {
    project = await createProject(token, selectedOrg, {
      name: effectiveName,
      plan: "dev",
      region,
    });
    projectCreated = true;
  }
  const projectSlug = project.slug ?? project.name;

  // Reuse an environment with our domain label if it already exists
  // (idempotency, feature 022).
  const existingEnvs = await listEnvironments(token, selectedOrg);
  const existingEnv = existingEnvs.find(
    (e) => e.domain_label === effectiveDomainLabel || e.name === effectiveName,
  );

  let domainUrl: string;
  let environmentCreated: boolean;
  let environment: { key?: unknown; name?: unknown };
  if (existingEnv) {
    domainUrl = extractDomainUrl(undefined, existingEnv, effectiveDomainLabel);
    environmentCreated = false;
    environment = existingEnv;
  } else {
    const services = await listProjectServices(token, selectedOrg, projectSlug);
    const service = pickService(services, region);
    const created = await createEnvironment(
      token,
      selectedOrg,
      environmentCreationBody({
        name: effectiveName,
        project: projectSlug,
        domainLabel: effectiveDomainLabel,
        service,
        region,
      }),
    );
    const taskId = created.task_id;
    let task = undefined;
    if (taskId) task = await pollTaskStatus(String(taskId));
    const refreshed = created.key
      ? await getEnvironment(token, selectedOrg, String(created.key))
      : created;
    domainUrl = extractDomainUrl(task, refreshed, effectiveDomainLabel);
    environmentCreated = true;
    environment = refreshed ?? created;
  }
  const environmentKey =
    typeof environment.key === "string" ? environment.key : undefined;
  const environmentName =
    typeof environment.name === "string" ? environment.name : effectiveName;

  // The store endpoint is now knowable, so write the agent-facing surface:
  // SALEOR_URL (= the store GraphQL endpoint) and SALEOR_TOKEN (the resolved
  // store token — CLOUD wins, else the device-grant access token), alongside the
  // kept NEXT_PUBLIC_SALEOR_API_URL Paper config. Configurator/curl/MCP read the
  // agent surface; the JOLLY_* vars stay the internal auth layer.
  const values: Record<string, string> = {
    NEXT_PUBLIC_SALEOR_API_URL: domainUrl,
    SALEOR_URL: domainUrl,
  };
  const saleorToken = resolveSaleorToken(loadEnvValues(projectDir()));
  if (saleorToken) values["SALEOR_TOKEN"] = saleorToken;

  writeEnvValues(projectDir(), values);
  // Make the new endpoint/token visible to later in-process reads (the
  // downstream recipe/stock/deploy stages of the same `jolly start` run).
  for (const [k, v] of Object.entries(values)) process.env[k] = v;

  // A freshly-created Saleor environment answers 404/5xx until its store
  // instance stands up — a reused environment is already serving, so only a
  // newly created one needs the wait. Every caller of provisionStore (jolly
  // start's store stage, jolly create store --create-environment) needs this
  // guarantee: neither should claim a store is ready before it actually
  // answers, so the wait lives here once rather than being duplicated (or,
  // as it was, present in one caller and silently absent from the other).
  // 600s: real cold starts have been observed to occasionally exceed both
  // 180s and 300s, especially when several environments are provisioned in
  // quick succession for the same org (AGENTS.md — a recurring cold-start
  // false-failure calls for a longer readiness gate, not a tolerated flake).
  let readinessTimedOut = false;
  if (environmentCreated) {
    // Budget/poll interval default to the production values above and are only
    // overridable via env for tests that must exercise the timeout path without
    // burning the full real budget (a missing/invalid value falls back).
    const readinessBudgetMs = resolveReadinessBudgetMs();
    const readinessPollMs = readPositiveIntEnvMs("JOLLY_READINESS_POLL_MS", 5_000);
    const readinessDeadline = Date.now() + readinessBudgetMs;
    while ((await probeEndpointConnectivity(domainUrl)).kind !== "reachable") {
      if (Date.now() >= readinessDeadline) {
        readinessTimedOut = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, readinessPollMs));
    }
  }

  return {
    graphqlApiUrl: domainUrl,
    dashboardUrl: new URL("/dashboard/", domainUrl).href,
    organization: selectedOrg,
    environmentName,
    environmentKey,
    projectCreated,
    environmentCreated,
    readinessTimedOut,
  };
}

/**
 * The catalog's "Nothing was created." summary is honest for a request the
 * Cloud API rejected outright, but false for TASK_STATUS_UNCONFIRMED: there the
 * creation POST was accepted and only the task-status confirmation kept
 * failing, so the environment may well exist. That branch carries the thrown
 * error's own text (interpolated DATA per the copy-catalog rule) as the
 * summary instead of claiming nothing was created.
 * @planks("the envelope status should be {string} with the stable code `ENVIRONMENT_LIMIT_REACHED`")
 * @planks("the agent runs `jolly create store --create-environment --json`")
 * @planks("each should carry at least one `nextSteps` entry naming what to do next")
 * @planks("the error should not claim that nothing was created")
 */
function cloudErrorEnvelope(command: string, err: unknown, riskContext: RiskContext): Envelope {
  const code = err instanceof CloudApiError ? err.code : "CLOUD_API_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  const remediation =
    code === "ENVIRONMENT_LIMIT_REACHED"
      ? cliMessage("cloudError.remediation.environmentLimitReached")
      : code === "DOMAIN_LABEL_TAKEN"
        ? cliMessage("cloudError.remediation.domainLabelTaken")
        : cliMessage("cloudError.remediation.default");
  return errorEnvelope(
    command,
    code === "TASK_STATUS_UNCONFIRMED" ? message : cliMessage("cloudError.summary.error"),
    [
      {
        code,
        message,
        remediation,
      },
    ],
    {
      data: { riskContext },
      nextSteps:
        code === "ENVIRONMENT_LIMIT_REACHED"
          ? [
              {
                description: cliMessage("cloudError.next.freeEnvironment"),
              },
              {
                description: cliMessage("cloudError.next.upgradePlan"),
              },
            ]
          : [{ description: remediation }],
    },
  );
}

// ─── create dispatcher + help ─────────────────────────────────────────────

const CREATE_SUBCOMMANDS = ["store"] as const;

/**
 * @planks("`jolly create --help` should list only the subcommand `store`")
 */
function commandCreateHelp(): Envelope {
  const command = "create --help";
  return envelope({
    command,
    status: "success",
    summary: cliMessage("create.help.summary.success"),
    data: {
      subcommands: [
        {
          name: "store",
          description: cliMessage("create.help.next.store"),
        },
      ],
      note: "Other setup work is run by your agent via the official CLIs, guided by the Jolly skill.",
    },
    nextSteps: [
      {
        description: cliMessage("create.help.next.createEnvironment"),
        command: "jolly create store --create-environment",
      },
    ],
  });
}

/**
 * @planks("the agent runs `jolly create frobnicate --json`")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function commandCreate(args: ParsedArgs): Promise<Envelope> {
  const sub = args.positionals[1];
  if (!sub || sub === "help") {
    return commandCreateHelp();
  }
  // `jolly create <sub> --help` prints usage for the subcommand, not the flow.
  if (args.help) {
    return commandUsage(args);
  }
  switch (sub) {
    case "store":
      return commandCreateStore(args);
    default:
      return errorEnvelope(
        "create",
        cliMessage("create.summary.error", { sub }),
        [
          {
            code: "UNKNOWN_CREATE_SUBCOMMAND",
            message: cliMessage("create.error.unknownCreateSubcommand.message", {
              sub,
              subcommands: CREATE_SUBCOMMANDS.join(", "),
            }),
            remediation: cliMessage("create.error.unknownCreateSubcommand.remediation"),
          },
        ],
        {
          nextSteps: [
            {
              description: cliMessage("create.next"),
              command: "jolly create --help",
            },
          ],
        },
      );
  }
}

// ─── init (feature 007) ───────────────────────────────────────────────────

/**
 * Resolve Jolly's bundled skill directory (`assets/skills/jolly`) relative to
 * Jolly's own module path — the same scheme as bundledRecipePath(). The Jolly
 * skill ships inside the package, so installing it needs no network and does
 * not depend on the repo being pushed (feature 007 Rule "Jolly skill source").
 * @planks("the agent invokes `jolly init`")
 * @planks("it installs the default skill set with no network")
 */
function bundledJollySkillPath(): string {
  return fileURLToPath(new URL("../assets/skills/jolly", import.meta.url));
}

/**
 * @planks("the agent invokes `jolly init`")
 * @planks("it installs the default skill set with no network")
 */
function installSkill(skill: SkillSpec): { installed: boolean; stderr?: string } {
  // The Jolly skill installs from its bundled local copy (no network); the
  // Saleor skills install from their own refs (feature 007 Rule "Jolly skill
  // source"). Pass the skills CLI's OWN non-interactive flags — `--yes` skips
  // the scope prompt, `--skill '*'` skips the skill picker — and no `--agent`,
  // so it never opens a picker and always writes the universal
  // `.agents/skills/<id>/` location (Rule "Skill installation is
  // non-interactive and agent-agnostic"). Verification is on-disk below.
  const source = skill.id === "jolly" ? bundledJollySkillPath() : skill.ref;
  const result = spawnSync(
    "npx",
    ["--yes", "skills", "add", source, "--yes", "--skill", "*"],
    { cwd: projectDir(), encoding: "utf8", timeout: 60_000 },
  );
  return { installed: result.status === 0, stderr: result.stderr ?? undefined };
}

/**
 * Concurrent form of installSkill: spawn the installer without blocking so the
 * whole default set installs in parallel. Each returned promise resolves when
 * its own `npx skills add` exits, so a later skill's install begins before an
 * earlier one finishes. On-disk verification remains the contract.
 * @planks("Jolly should install or check the full default skill set via `npx skills add`")
 */
function installSkillAsync(skill: SkillSpec): Promise<void> {
  const source = skill.id === "jolly" ? bundledJollySkillPath() : skill.ref;
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "skills", "add", source, "--yes", "--skill", "*"],
      { cwd: projectDir(), stdio: "ignore" },
    );
    child.on("close", () => resolve());
  });
}

/**
 * @planks("the agent invokes `jolly init`")
 * @planks("it should merge, not replace, any existing .mcp.json, adding the Jolly MCP server entry to the existing servers object rather than writing a fresh object")
 * @planks("the agent runs `jolly doctor init --json`")
 */
function mergeMcpJson(): { merged: boolean; warning?: string } {
  const path = join(projectDir(), ".mcp.json");
  const endpoint =
    loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"] ??
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ??
    "https://your-store.saleor.cloud/graphql/";
  const jollyEntry = {
    command: "npx",
    args: ["-y", "mcp-graphql"],
    env: {
      ENDPOINT: endpoint,
      // Live store access uses the agent-facing SALEOR_TOKEN (feature 019).
      // Referenced by env expansion so the MCP client resolves SALEOR_TOKEN at
      // launch — never the literal secret written into the config (feature 007
      // keeps secrets out of the scaffolded files). The store token is sent as a
      // Bearer (never an "App" scheme); MCP is refresh-on-401 — the server
      // captured SALEOR_TOKEN at spawn, so a 401 means re-auth and reload it.
      HEADERS: '{"Authorization":"Bearer ${SALEOR_TOKEN}"}',
    },
  };

  let config: Record<string, unknown> = { mcpServers: {} };
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      // Leave an unparseable file untouched and warn.
      return { merged: false, warning: "Existing .mcp.json is not valid JSON; left untouched." };
    }
  }
  const servers = (
    config["mcpServers"] && typeof config["mcpServers"] === "object"
      ? (config["mcpServers"] as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  // Merge: add our entry without removing user-authored servers.
  servers["saleor-graphql"] = jollyEntry;
  config["mcpServers"] = servers;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return { merged: true };
}

/**
 * @planks("the agent invokes `jolly init`")
 * @planks("it should merge, not replace, any existing AGENTS.md or agent glue file, inserting or updating the Jolly section without removing user-authored content")
 */
function mergeAgentsMd(): void {
  const path = join(projectDir(), "AGENTS.md");
  const begin = "<!-- jolly:begin -->";
  const end = "<!-- jolly:end -->";
  const section = `${begin}
## Jolly

This project uses Jolly to set up a Saleor storefront. Run \`jolly start\` to
bootstrap, then follow the Jolly skill to drive the official CLIs.
${end}`;

  let existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(begin) && existing.includes(end)) {
    existing = existing.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), section);
  } else {
    existing =
      existing.length > 0
        ? `${existing.replace(/\n+$/, "")}\n\n${section}\n`
        : `${section}\n`;
  }
  writeFileSync(path, existing);
}

// Agent detection (feature 009, Rule "Agent detection"): inspect the project
// root for a recognized user agent marker and report which agent environment we
// detected. We detect `claude` from a CLAUDE.md / .claude marker; with no
// recognized marker we return null (the generic fallback). Jolly's own
// universal install location `.agents/skills/` is NOT a user agent marker, so a
// bare `.agents/` directory is never a detection signal.
/**
 * @planks("the agent invokes `jolly init`")
 */
function detectAgent(): string | null {
  const root = projectDir();
  if (existsSync(join(root, "CLAUDE.md")) || existsSync(join(root, ".claude"))) {
    return "claude";
  }
  return null;
}

/**
 * @planks("the agent invokes `jolly init`")
 * @planks("the agent invokes `jolly init` in the same directory again")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
function commandInit(_args: ParsedArgs): Envelope {
  const command = "init";
  const checks: Check[] = [];
  const installFailures: string[] = [];

  for (const skill of DEFAULT_SKILLS) {
    const already = skillInstalledOnDisk(skill);
    let installStderr = "";
    if (!already) {
      installStderr = (installSkill(skill).stderr ?? "").trim();
    }
    // Verify on disk — never unconditionally claim success.
    const present = skillInstalledOnDisk(skill);
    checks.push({
      id: `skill-${skill.id}`,
      status: present ? "pass" : "fail",
      description: present
        ? cliMessage(
            already ? "init.check.skill.presentAlreadyInstalled" : "init.check.skill.present",
            { id: skill.id },
          )
        : cliMessage("init.check.skill.unverified", {
            id: skill.id,
            stderr: installStderr ? ` ${installStderr}` : "",
          }),
    });
    if (!present) installFailures.push(skill.id);
  }

  // Merge .mcp.json (local mcp-graphql against the customer endpoint).
  const mcp = mergeMcpJson();
  checks.push({
    id: "mcp-config",
    status: mcp.merged ? "pass" : "warning",
    description: mcp.merged
      ? cliMessage("init.check.mcpConfig.pass")
      : mcp.warning ?? cliMessage("init.check.mcpConfig.warning"),
  });

  // Merge AGENTS.md guidance.
  mergeAgentsMd();
  checks.push({
    id: "agents-md",
    status: "pass",
    description: cliMessage("init.check.agentsMd.pass"),
  });

  if (installFailures.length > 0) {
    return errorEnvelope(
      command,
      cliMessage("init.summary.error", { failures: installFailures.join(", ") }),
      [
        {
          code: "SKILL_INSTALL_FAILED",
          message: cliMessage("init.error.skillInstallFailed.message", {
            failures: installFailures.join(", "),
          }),
          remediation: cliMessage("init.error.skillInstallFailed.remediation"),
        },
      ],
      {
        checks,
        nextSteps: [
          {
            description: cliMessage("init.next.checkNetwork"),
            command: "jolly init",
          },
        ],
      },
    );
  }

  return envelope({
    command,
    status: "success",
    summary: cliMessage("init.summary.success", { length: DEFAULT_SKILLS.length }),
    data: {
      skills: DEFAULT_SKILLS.map((s) => s.id),
      mcpMerged: mcp.merged,
      agentsMdMerged: true,
      detectedAgent: detectAgent(),
    },
    checks,
    nextSteps: [
      {
        description: cliMessage("init.next.restartAgent"),
      },
      {
        description: cliMessage("init.next.runStart"),
        command: "jolly start",
      },
    ],
  });
}

// ─── doctor (feature 014) ─────────────────────────────────────────────────

const DOCTOR_GROUPS = ["skills", "init", "saleor", "storefront", "deployment", "stripe"] as const;

// Read-only predicates for the init-bootstrap artifacts (feature 014 init group).
// Doctor is diagnostics-only — these only read, never write (unlike mergeMcpJson/mergeAgentsMd).
/**
 * @planks("the agent runs `jolly doctor init --json`")
 */
function mcpHasSaleorGraphql(): boolean {
  const path = join(projectDir(), ".mcp.json");
  if (!existsSync(path)) return false;
  try {
    const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const servers = config["mcpServers"];
    return Boolean(
      servers && typeof servers === "object" && "saleor-graphql" in (servers as Record<string, unknown>),
    );
  } catch {
    return false;
  }
}

/**
 * @planks("the agent runs `jolly doctor init --json`")
 */
function agentsMdHasJollyMarker(): boolean {
  const path = join(projectDir(), "AGENTS.md");
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes("<!-- jolly:begin -->");
}

/**
 * The Cloud platform token for a non-doctor stage, preferring a stored
 * device-grant access token (sent as Bearer) over the staff token (sent as
 * Token), per the feature 018 scheme rule. Synchronous — it does not refresh; the
 * refresh-on-expiry path is the doctor's {@link resolvePlatformToken}. A staff-only
 * environment (no access token) resolves the staff token unchanged.
 * @planks("the agent runs `jolly create store --create-environment --json`")
 */
function cloudPlatformToken(values: Record<string, string>): string | undefined {
  const access = (
    values["JOLLY_SALEOR_ACCESS_TOKEN"] ??
    process.env["JOLLY_SALEOR_ACCESS_TOKEN"] ??
    ""
  ).trim();
  if (access !== "") return access;
  const staff = (
    values["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    ""
  ).trim();
  return staff !== "" ? staff : undefined;
}

/**
 * The agent-facing store token (`SALEOR_TOKEN`) source. CLOUD wins: a CI/dev
 * MANUAL long-lived staff token (`JOLLY_SALEOR_CLOUD_TOKEN`) takes precedence so
 * a device-grant refresh never clobbers the intended store token; otherwise the
 * current device-grant access JWT (`JOLLY_SALEOR_ACCESS_TOKEN`). This is the
 * OPPOSITE precedence of {@link cloudPlatformToken} (which prefers ACCESS for
 * Cloud-platform-API scheme reasons), so it is its own dedicated resolver — do
 * NOT reuse cloudPlatformToken here. Store GraphQL always sends Bearer, so the
 * resolved token rides as Bearer, never an "App" scheme.
 * @planks("the agent runs `jolly doctor saleor --json`")
 */
function resolveSaleorToken(values: Record<string, string>): string | undefined {
  const cloud = (
    values["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    ""
  ).trim();
  if (cloud !== "") return cloud;
  const access = (
    values["JOLLY_SALEOR_ACCESS_TOKEN"] ??
    process.env["JOLLY_SALEOR_ACCESS_TOKEN"] ??
    ""
  ).trim();
  return access !== "" ? access : undefined;
}

/**
 * Project the agent-facing surface (`SALEOR_URL` and `SALEOR_TOKEN`) into .env
 * and `process.env`, so configurator/curl/MCP never read a stale store token.
 * SALEOR_URL is the store GraphQL endpoint (= NEXT_PUBLIC_SALEOR_API_URL) when
 * one is known; SALEOR_TOKEN is {@link resolveSaleorToken}. Called at every
 * device-grant / refresh / login-cloud / provision site. A no-op when neither is
 * resolvable yet (e.g. login before any store endpoint exists still projects
 * SALEOR_TOKEN alone). `extra` lets a caller fold in additional values written in
 * the same pass.
 * @planks("it should store the refreshed access token in .env as JOLLY_SALEOR_ACCESS_TOKEN")
 */
function projectSaleorAgentEnv(extra?: Record<string, string>): void {
  const values = loadEnvValues(projectDir());
  const out: Record<string, string> = { ...(extra ?? {}) };
  const endpoint =
    out["SALEOR_URL"] ??
    values["NEXT_PUBLIC_SALEOR_API_URL"] ??
    process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  if (endpoint) out["SALEOR_URL"] = endpoint;
  const token = resolveSaleorToken(values);
  if (token) out["SALEOR_TOKEN"] = token;
  if (Object.keys(out).length === 0) return;
  writeEnvValues(projectDir(), out);
  for (const [k, v] of Object.entries(out)) process.env[k] = v;
}

/**
 * Resolve the Cloud platform token, preferring a stored device-grant access
 * token (Bearer) over the staff token (Token), per the feature 018 scheme rule.
 * When the access token (a Keycloak JWT) has expired and a refresh token is
 * stored, mints a fresh access token through the refresh grant and persists it
 * to `.env` + `process.env` (so the scheme picker and the read below see it),
 * rather than re-prompting. A refresh failure falls through with the stale token,
 * which the read then reports as rejected.
 * @planks("the agent runs `jolly doctor saleor --json`")
 */
async function resolvePlatformToken(
  values: Record<string, string>,
): Promise<{ token: string; source: "access" | "staff" | "none" }> {
  const read = (key: string): string =>
    String(values[key] ?? process.env[key] ?? "").trim();
  let access = read("JOLLY_SALEOR_ACCESS_TOKEN");
  const refresh = read("JOLLY_SALEOR_REFRESH_TOKEN");
  if (access !== "") {
    if (isJwtExpired(access) && refresh !== "") {
      try {
        const fresh = await refreshAccessToken(refresh);
        writeEnvValues(projectDir(), {
          JOLLY_SALEOR_ACCESS_TOKEN: fresh.accessToken,
          JOLLY_SALEOR_REFRESH_TOKEN: fresh.refreshToken,
        });
        process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = fresh.accessToken;
        process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = fresh.refreshToken;
        access = fresh.accessToken;
        // The store token rode on the old access JWT; reproject SALEOR_TOKEN from
        // the fresh one (when no CLOUD token wins) so .env never keeps a 5-min
        // expired store token that configurator/curl/MCP would 401 on.
        projectSaleorAgentEnv();
      } catch {
        // Leave the stale token; the platform read reports it rejected.
      }
    }
    return { token: access, source: "access" };
  }
  const staff = read("JOLLY_SALEOR_CLOUD_TOKEN");
  if (staff !== "") return { token: staff, source: "staff" };
  return { token: "", source: "none" };
}

/**
 * Refresh the short-lived device-grant access token BEFORE a long-running,
 * token-spending `jolly start` stage runs, so it never sends an expired
 * credential (feature 018 Rule "A long run refreshes the short-lived access
 * token"). The store token (`SALEOR_TOKEN`) and the Cloud platform token both
 * ride on `JOLLY_SALEOR_ACCESS_TOKEN`, a ~5-minute Keycloak JWT; the preceding
 * `storefront` stage clones the storefront and runs `pnpm install`, routinely
 * minutes, so by the time the recipe/stock/stripe stages run the access token
 * has often expired and the store 401s with "Authentication failed". Refresh
 * proactively (with a generous skew so the fresh token comfortably outlives the
 * stage about to spend it, not merely the moment it starts), persist the rotated
 * tokens, and reproject `SALEOR_TOKEN`/`SALEOR_URL` into .env + process.env. A
 * long-lived staff (CLOUD) token needs no refresh and a run with no stored
 * refresh token is left untouched, so the stage still reports any auth failure
 * honestly rather than this masking it.
 * @planks("it should mint a fresh access token through the refresh grant at `https:\/\/auth.saleor.io\/realms\/saleor-cloud\/protocol\/openid-connect\/token`")
 */
async function ensureFreshStoreAuth(): Promise<void> {
  const values = loadEnvValues(projectDir());
  const read = (key: string): string =>
    String(values[key] ?? process.env[key] ?? "").trim();
  const access = read("JOLLY_SALEOR_ACCESS_TOKEN");
  const refresh = read("JOLLY_SALEOR_REFRESH_TOKEN");
  // Nothing to refresh without a device-grant access token and its refresh token
  // (e.g. a staff-only CI/dev environment). The staff token is long-lived.
  if (access === "" || refresh === "") return;
  // 120s skew: refresh whenever the token is within two minutes of expiry, giving
  // the stage that follows a full fresh window rather than the tail of the old one.
  if (!isJwtExpired(access, 120)) return;
  try {
    const fresh = await refreshAccessToken(refresh);
    writeEnvValues(
      projectDir(),
      {
        JOLLY_SALEOR_ACCESS_TOKEN: fresh.accessToken,
        JOLLY_SALEOR_REFRESH_TOKEN: fresh.refreshToken,
      },
    );
    process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = fresh.accessToken;
    process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = fresh.refreshToken;
    // Reproject SALEOR_TOKEN/SALEOR_URL from the fresh access JWT so the stage's
    // own `process.env["SALEOR_TOKEN"]` read (and configurator/curl/MCP) see it.
    projectSaleorAgentEnv();
  } catch {
    // Leave the stored token; the stage reports any resulting auth failure honestly.
  }
}

/**
 * @planks("the agent runs `jolly doctor`")
 * @planks("the agent runs `jolly doctor init --json`")
 * @planks("the agent runs `jolly doctor saleor --json`")
 * @planks("the agent runs `jolly doctor storefront --json`")
 * @planks("the agent runs `jolly doctor deployment --json`")
 * @planks("the agent runs `jolly doctor --json` with no group argument")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 * @planks("the refusal should name the non-first-party host evil.example.com")
 * @planks(`the `us-channel-purchasable` and `checkout-payment-gateway` checks should each report a non-pass status`)
 * @planks("no request should be sent to evil.example.com")
 */
async function commandDoctor(args: ParsedArgs): Promise<Envelope> {
  const group = args.positionals[1];
  const values = loadEnvValues(projectDir());
  const checks: Check[] = [];

  if (
    group &&
    !DOCTOR_GROUPS.includes(group as (typeof DOCTOR_GROUPS)[number])
  ) {
    return errorEnvelope(
      "doctor",
      cliMessage("doctor.summary.error", { group }),
      [
        {
          code: "UNKNOWN_DOCTOR_GROUP",
          message: cliMessage("doctor.error.unknownDoctorGroup.message", {
            group,
            groups: DOCTOR_GROUPS.join(", "),
          }),
          remediation: cliMessage("doctor.error.unknownDoctorGroup.remediation"),
        },
      ],
      {
        nextSteps: [
          {
            description: cliMessage("doctor.next", { groups: DOCTOR_GROUPS.join(", ") }),
            command: "jolly doctor",
          },
        ],
      },
    );
  }

  const wants = (g: string) => !group || group === g;

  // CLI availability (always reportable, read-only).
  if (!group) {
    checks.push({
      id: "cli-available",
      status: "pass",
      description: cliMessage("doctor.check.cliAvailable.pass", { node: process.versions.node }),
    });
  }

  if (wants("skills")) {
    for (const skill of DEFAULT_SKILLS) {
      const present = skillInstalledOnDisk(skill);
      checks.push({
        id: `skill-${skill.id}`,
        status: present ? "pass" : "fail",
        description: cliMessage(
          present ? "doctor.check.skill.present" : "doctor.check.skill.notInstalled",
          { id: skill.id },
        ),
        command: present ? undefined : "jolly init",
      });
    }
  }

  if (wants("init")) {
    const mcpOk = mcpHasSaleorGraphql();
    checks.push({
      id: "mcp-config",
      status: mcpOk ? "pass" : "fail",
      description: mcpOk
        ? cliMessage("doctor.check.mcpConfig.pass")
        : cliMessage("doctor.check.mcpConfig.fail"),
      command: mcpOk ? undefined : "jolly init",
    });
    const agentsOk = agentsMdHasJollyMarker();
    checks.push({
      id: "agents-md",
      status: agentsOk ? "pass" : "fail",
      description: agentsOk
        ? cliMessage("doctor.check.agentsMd.pass")
        : cliMessage("doctor.check.agentsMd.fail"),
      command: agentsOk ? undefined : "jolly init",
    });
  }

  if (wants("saleor")) {
    // Resolve the Cloud platform token, preferring a stored device-grant access
    // token (sent as Bearer) over the staff token (sent as Token), per the
    // feature 018 scheme rule. A short-lived access token that has expired during
    // a long run is refreshed from the stored refresh token and persisted, rather
    // than re-prompting (feature 018 "A long run refreshes the short-lived access
    // token"); the fresh token then authenticates the read below.
    const platform = await resolvePlatformToken(values);
    const cloudToken = platform.token;
    const hasEndpoint = Boolean(
      values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"],
    );
    const hasSaleorToken = Boolean(
      values["SALEOR_TOKEN"] ?? process.env["SALEOR_TOKEN"],
    );
    // The Cloud token is validated, not just detected (feature 014 Rule
    // "Credential checks probe validity, not just presence"): a shape heuristic
    // first, then a real read-only GET of the Cloud API organizations endpoint.
    // A `pass` is reported only from a real authenticated response naming the
    // organization — never from the token's presence alone (feature 020 "No
    // fabricated success").
    const orgEndpoint = `${cloudApiBase()}/organizations/`;
    if (cloudToken === "") {
      checks.push({
        id: "saleor-cloud-token",
        status: "fail",
        description: cliMessage("doctor.check.saleorCloudToken.fail"),
        command: "jolly login",
      });
    } else if (platform.source === "staff" && !cloudToken.includes(".")) {
      // A separator-free staff token has the per-store token shape, not a
      // Cloud staff token (which carries a dot separator). Flag the likely
      // mix-up before the network probe. (A device-grant access JWT
      // always carries dots, so this heuristic applies only to the staff token.)
      checks.push({
        id: "saleor-cloud-token",
        status: "warning",
        description: cliMessage("doctor.check.saleorCloudToken.storeTokenNotStaff"),
        command: "jolly login",
      });
    } else {
      try {
        const orgs = await listOrganizations(cloudToken);
        const slug = orgs
          .map((org) => String(org.slug ?? ""))
          .find((value) => value.length > 0);
        if (slug) {
          checks.push({
            id: "saleor-cloud-token",
            status: "pass",
            description: cliMessage("doctor.check.saleorCloudToken.pass", { orgEndpoint, slug }),
          });
        } else {
          checks.push({
            id: "saleor-cloud-token",
            status: "warning",
            description: cliMessage("doctor.check.saleorCloudToken.noOrganizations", { orgEndpoint }),
            command: "jolly login",
          });
        }
      } catch (error) {
        if (error instanceof CloudApiError && typeof error.httpStatus === "number") {
          checks.push({
            id: "saleor-cloud-token",
            status: "warning",
            description: cliMessage("doctor.check.saleorCloudToken.rejected", {
              orgEndpoint,
              httpStatus: error.httpStatus,
            }),
            command: "jolly login",
          });
        } else {
          checks.push({
            id: "saleor-cloud-token",
            status: "unknown",
            description: cliMessage("doctor.check.saleorCloudToken.unknown", { orgEndpoint }),
          });
        }
      }
    }
    if (!hasEndpoint) {
      checks.push({
        id: "saleor-endpoint",
        status: "fail",
        description: cliMessage("doctor.check.saleorEndpoint.fail"),
        command: "jolly create store --url <graphql-endpoint>",
      });
    } else {
      // Presence is detectable; run a real READ-ONLY live connectivity probe.
      // Reachable GraphQL endpoint → "pass"; configured but unreachable / not a
      // GraphQL endpoint → "unknown" (never a fabricated pass). A non-first-party
      // endpoint is refused PRE-FLIGHT (feature 020 Rule "First-party hosts
      // only"): nothing is sent, and the check reports the refusal naming the
      // host — a definite "fail", not an "unknown".
      const saleorEndpoint = String(
        values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"],
      );
      const outcome = await probeEndpointConnectivity(saleorEndpoint);
      if (outcome.kind === "refused") {
        checks.push({
          id: "saleor-endpoint",
          status: "fail",
          description: cliMessage("createStore.error.nonFirstPartyHost.message", {
            pastedHost: outcome.host,
          }),
          command: "jolly create store --url https://<store>.saleor.cloud/graphql/",
        });
      } else {
        const reachable = outcome.kind === "reachable";
        checks.push({
          id: "saleor-endpoint",
          status: reachable ? "pass" : "unknown",
          description: reachable
            ? cliMessage("doctor.check.saleorEndpoint.pass")
            : cliMessage("doctor.check.saleorEndpoint.unknown"),
        });
      }
    }
    checks.push({
      id: "saleor-token",
      status: hasSaleorToken ? "pass" : "fail",
      description: hasSaleorToken
        ? cliMessage("doctor.check.saleorToken.pass")
        : cliMessage("doctor.check.saleorToken.fail"),
      command: hasSaleorToken ? undefined : "jolly login",
    });
    // `us`-channel purchasability (feature 014): a channel whose products lack a
    // channel listing / availability sells nothing — checkout fails silently
    // before payment. Probe the recipe's `us` channel; pass only when ≥1 product
    // is available for purchase, warning (routing the fix to configurator) when
    // the store is reachable but none is, skipped/unknown when the endpoint or
    // token is absent — never a fabricated pass.
    const purchaseEndpoint = String(
      values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? "",
    );
    if (!purchaseEndpoint || !hasSaleorToken) {
      checks.push({
        id: "us-channel-purchasable",
        status: "skipped",
        description: cliMessage("doctor.check.usChannelPurchasable.skipped"),
      });
    } else {
      const purchasable = await probeChannelPurchasability(
        purchaseEndpoint,
        values["SALEOR_TOKEN"],
        "us",
      );
      if (purchasable.kind === "purchasable") {
        checks.push({
          id: "us-channel-purchasable",
          status: "pass",
          description: cliMessage("doctor.check.usChannelPurchasable.pass", {
            count: purchasable.count,
          }),
        });
      } else if (purchasable.kind === "none-purchasable") {
        checks.push({
          id: "us-channel-purchasable",
          status: "warning",
          description: cliMessage("doctor.check.usChannelPurchasable.warning"),
          command: "npx @saleor/configurator deploy --failOnDelete",
        });
      } else if (purchasable.kind === "refused") {
        // The probe refused the non-first-party endpoint pre-flight: the
        // purchasability read was never attempted (skipped, per the feature 014
        // vocabulary), and the refusal names the host.
        checks.push({
          id: "us-channel-purchasable",
          status: "skipped",
          description: cliMessage("createStore.error.nonFirstPartyHost.message", {
            pastedHost: purchasable.host,
          }),
        });
      } else {
        checks.push({
          id: "us-channel-purchasable",
          status: "unknown",
          description: cliMessage("doctor.check.usChannelPurchasable.unknown"),
        });
      }
    }
  }

  if (wants("storefront")) {
    // The storefront stage runs pnpm via `npx` (like Jolly's other spawned
    // CLIs), so a missing GLOBAL pnpm is not a failure (feature 002). The probe
    // is read-only (`pnpm --version`); it only reports which path will be used,
    // and never fails merely because there is no global install.
    const pnpmProbe = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
    const globalPnpm = !pnpmProbe.error && pnpmProbe.status === 0;
    checks.push({
      id: "pnpm-available",
      status: "pass",
      description: globalPnpm
        ? cliMessage("doctor.check.pnpmAvailable.global", { version: pnpmProbe.stdout.trim() })
        : cliMessage("doctor.check.pnpmAvailable.viaNpx"),
    });

    const storefrontPresent =
      existsSync(join(projectDir(), "storefront", "package.json")) &&
      existsSync(join(projectDir(), "storefront", "src", "app"));
    // Without a verified Paper storefront, report fail/unknown — never pass.
    checks.push({
      id: "storefront-present",
      status: storefrontPresent ? "unknown" : "fail",
      description: storefrontPresent
        ? cliMessage("doctor.check.storefrontPresent.unknown")
        : cliMessage("doctor.check.storefrontPresent.fail"),
      command: storefrontPresent ? undefined : "jolly start",
    });
  }

  if (wants("deployment")) {
    // Deployment is agent-run via the Vercel CLI; Jolly cannot verify it from
    // its own first-party-host code, so report skipped (honest, not fail).
    checks.push({
      id: "deployment-status",
      status: "skipped",
      description: cliMessage("doctor.check.deploymentStatus.skipped"),
      command: "npx vercel",
    });

    // Single readiness oracle (feature 014): read the Vercel login state by
    // delegating to the Vercel CLI's own `vercel whoami` — never reimplement
    // Vercel auth. A real session means `pass`; with no session the Vercel CLI
    // drops into its device-login flow, which the probe detects (and stops, so
    // nothing is left polling) and reports as `fail`. Never `pass` without a
    // confirmed session (feature 020 "No fabricated success"). The next step is
    // `jolly start`, which runs the Vercel sign-in itself — never `vercel login`,
    // because Jolly owns the sign-in (feature 002).
    const probe = await probeVercelSession();
    const vercelStatus: CheckStatus = probe.signedIn ? "pass" : "fail";
    checks.push({
      id: "vercel-auth",
      status: vercelStatus,
      description: probe.signedIn
        ? cliMessage("doctor.check.vercelAuth.signedIn", { account: probe.account })
        : cliMessage("doctor.check.vercelAuth.notSignedIn"),
      command: probe.signedIn ? undefined : "jolly start",
    });
  }

  if (wants("stripe")) {
    // Checkout-readiness probe (feature 005 Rule "Checkout-readiness verify
    // probe"): the authoritative signal that checkout reaches the Stripe test
    // payment step is whether a real `us` checkout is offered the Stripe gateway.
    // There is no public read for the app's channel-config mapping, so Jolly
    // creates a minimal `us` test checkout, inspects its available payment
    // gateways, then reverts (deletes) it (harmless — test mode only, no
    // payment captured). Honest reporting: `pass` only when Stripe is actually
    // offered; `warning` when the store is reachable but it is not; never `pass`
    // when the store/creds are unavailable or the probe cannot run.
    const endpoint =
      values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    const probeToken = resolveSaleorToken(values) ?? cloudPlatformToken(values);
    const gateStep = cliMessage("doctor.check.checkoutPaymentGateway.gateStep");
    if (!endpoint || !probeToken) {
      checks.push({
        id: "checkout-payment-gateway",
        status: "skipped",
        description: cliMessage("doctor.check.checkoutPaymentGateway.skipped"),
        command: "jolly create store --url <graphql-endpoint>",
      });
    } else {
      const outcome = await probeCheckoutPaymentGateway(endpoint, probeToken);
      switch (outcome.kind) {
        case "stripe-offered":
          checks.push({
            id: "checkout-payment-gateway",
            status: "pass",
            description: cliMessage("doctor.check.checkoutPaymentGateway.pass"),
          });
          break;
        case "not-offered":
          checks.push({
            id: "checkout-payment-gateway",
            status: "warning",
            description: cliMessage("doctor.check.checkoutPaymentGateway.warning") + gateStep,
            command: gateStep,
          });
          break;
        case "no-variants":
        case "no-checkout":
          checks.push({
            id: "checkout-payment-gateway",
            status: "unknown",
            description: cliMessage("doctor.check.checkoutPaymentGateway.noBuyableVariant"),
            command: "jolly start",
          });
          break;
        case "unreachable":
        default:
          checks.push({
            id: "checkout-payment-gateway",
            status: "unknown",
            description: cliMessage("doctor.check.checkoutPaymentGateway.endpointUnreachable"),
            command: "jolly doctor saleor",
          });
          break;
      }
    }
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warning");
  const status: EnvelopeStatus = hasFail ? "error" : hasWarn ? "warning" : "success";

  // Gather next steps from actionable checks.
  const nextSteps: NextStep[] = checks
    .filter((c) => (c.status === "fail" || c.status === "warning") && c.command)
    .map((c) => ({
      description: c.description ?? cliMessage("cli.next.addressCheck", { id: c.id }),
      command: c.command,
    }));

  return envelope({
    command: group ? `doctor ${group}` : "doctor",
    status,
    summary:
      status === "success"
        ? cliMessage("doctor.summary.allPassed")
        : status === "warning"
          ? cliMessage("doctor.summary.needsAttention")
          : cliMessage("doctor.summary.failed"),
    data: { group: group ?? "all" },
    checks,
    nextSteps,
    errors: hasFail
      ? [
          {
            code: "DOCTOR_CHECKS_FAILED",
            message: cliMessage("doctor.error.doctorChecksFailed.message"),
            remediation: cliMessage("doctor.error.doctorChecksFailed.remediation"),
          },
        ]
      : [],
  });
}

// ─── skills (feature 006/001) ─────────────────────────────────────────────

/**
 * @planks("Jolly should install or check the full default skill set via `npx skills add`")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function commandSkills(args: ParsedArgs): Promise<Envelope> {
  const command = "skills";
  const sub = args.positionals[1];

  if (sub === "install" || sub === "update") {
    // Install every missing skill concurrently: fire all spawns, then await
    // the whole set so a later install begins before an earlier one finishes.
    if (sub === "install") {
      const missing = DEFAULT_SKILLS.filter((skill) => !skillInstalledOnDisk(skill));
      await Promise.all(missing.map((skill) => installSkillAsync(skill)));
    }
    const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
      const present = skillInstalledOnDisk(skill);
      return {
        id: `skill-${skill.id}`,
        status: present ? "pass" : "fail",
        description: cliMessage(
          present ? "skills.check.skill.present" : "skills.check.skill.notVerified",
          { id: skill.id },
        ),
      };
    });
    const failed = checks.filter((c) => c.status === "fail").map((c) => c.id);
    if (failed.length > 0) {
      // A warning with no action leaves the agent stuck; point it at the
      // installer (the same next step the read-only `skills` listing gives).
      return envelope({
        command: `skills ${sub}`,
        status: "warning",
        summary: cliMessage("skills.summary.warning", { failed: failed.join(", ") }),
        data: { skills: DEFAULT_SKILLS.map((s) => s.id) },
        checks,
        nextSteps: [
          {
            description: cliMessage("skills.next.installMissing"),
            command: "jolly init",
          },
        ],
      });
    }
    return envelope({
      command: `skills ${sub}`,
      status: "success",
      summary: cliMessage(
        sub === "install" ? "skills.summary.installed" : "skills.summary.checked",
      ),
      data: { skills: DEFAULT_SKILLS.map((s) => s.id) },
      checks,
      nextSteps: [],
    });
  }

  // Default: list/inspect the skill set.
  const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
    const present = skillInstalledOnDisk(skill);
    return {
      id: `skill-${skill.id}`,
      status: present ? "pass" : "unknown",
      description: cliMessage(
        present ? "skills.check.skill.installed" : "skills.check.skill.notInstalled",
        { description: skill.description },
      ),
    };
  });

  return envelope({
    command,
    status: "success",
    summary: cliMessage("skills.summary.managed", { length: DEFAULT_SKILLS.length }),
    data: {
      skills: DEFAULT_SKILLS.map((s) => ({ id: s.id, ref: s.ref, description: s.description })),
    },
    checks,
    nextSteps: [
      {
        description: cliMessage("skills.next.installSet"),
        command: "jolly init",
      },
    ],
  });
}

// ─── upgrade (feature 017) ────────────────────────────────────────────────

/**
 * @planks("the agent invokes `jolly upgrade`")
 */
function commandUpgrade(_args: ParsedArgs): Envelope {
  const command = "upgrade";
  const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
    const present = skillInstalledOnDisk(skill);
    return {
      id: `skill-${skill.id}`,
      status: present ? "pass" : "skipped",
      description: cliMessage(
        present ? "skills.check.skill.managed" : "skills.check.skill.notInstalledSkipped",
        { id: skill.id },
      ),
    };
  });

  // Detect a cloned Paper storefront for plan-only baseline guidance, reading
  // the version from its paper-version.json marker (feature 017).
  const paperVersionPath = join(projectDir(), "paper-version.json");
  const paperPresent = existsSync(paperVersionPath);
  let paperVersion: string | undefined;
  if (paperPresent) {
    try {
      const parsed = JSON.parse(readFileSync(paperVersionPath, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") paperVersion = parsed.version;
    } catch {
      // Unreadable/malformed marker: detected, but the version stays unknown.
    }
  }
  checks.push({
    id: "paper-baseline",
    status: paperPresent ? "unknown" : "skipped",
    description: paperPresent
      ? cliMessage("upgrade.check.paperBaseline.unknown", {
          version: paperVersion ?? cliMessage("upgrade.value.unknownVersion"),
        })
      : cliMessage("upgrade.check.paperBaseline.skipped"),
  });

  return envelope({
    command,
    status: "success",
    summary: cliMessage("upgrade.summary.success"),
    data: {
      skillsChecked: DEFAULT_SKILLS.map((s) => s.id),
      paperBaselineDetected: paperPresent,
      paperBaselineVersion: paperVersion,
      paperAutoApply: false,
    },
    checks,
    nextSteps: paperPresent
      ? [{ description: cliMessage("upgrade.next") }]
      : [],
  });
}

// ─── start (features 001/006) ─────────────────────────────────────────────

interface PlanStage {
  stage: string;
  effects: {
    directoriesCreated: string[];
    filesWritten: string[];
    networkHostsContacted: string[];
    repositoriesCloned: string[];
  };
  riskContext?: RiskContext;
}

/** The fixed create-store gate target, built once so the dry-run plan and the
 * real run's awaiting-approval stage carry a deep-equal riskContext.
 * @planks("the preview should name the real Cloud API `organizations\/\{organization\}\/environments\/` request it would send to provision the store")
 */
function createStoreGateTarget(): string {
  return `${cloudApiBase()}/organizations/{organization}/environments/`;
}

/**
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("the data should include a per-stage plan of intended effects: directories created, files written, network hosts contacted, and repositories cloned")
 */
function startPlan(): PlanStage[] {
  return [
    {
      stage: "init",
      effects: {
        directoriesCreated: [".agents/skills"],
        filesWritten: [".mcp.json", "AGENTS.md"],
        networkHostsContacted: ["github.com"],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.init"),
        target: cliMessage("riskContext.target.init"),
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [cliMessage("riskContext.sideEffect.init.writes")],
        dryRunAvailable: true,
      },
    },
    {
      stage: "auth",
      effects: {
        directoriesCreated: [],
        filesWritten: [".env"],
        networkHostsContacted: ["cloud.saleor.io"],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.login"),
        target: cloudApiBase(),
        riskLevel: "medium",
        categories: ["credential handling"],
        reversible: true,
        sideEffects: [cliMessage("riskContext.sideEffect.login.acquire")],
        dryRunAvailable: true,
      },
    },
    {
      stage: "store",
      effects: {
        directoriesCreated: [],
        filesWritten: [".env"],
        networkHostsContacted: ["cloud.saleor.io"],
        repositoriesCloned: [],
      },
      riskContext: createStoreRiskContext(createStoreGateTarget()),
    },
    {
      stage: "storefront",
      effects: {
        directoriesCreated: ["storefront", "storefront/node_modules"],
        filesWritten: ["storefront/pnpm-lock.yaml"],
        networkHostsContacted: ["github.com"],
        repositoriesCloned: ["saleor/storefront"],
      },
      riskContext: {
        action: cliMessage("riskContext.action.storefront"),
        target: cliMessage("riskContext.target.storefront"),
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          cliMessage("riskContext.sideEffect.storefront.clone"),
          cliMessage("riskContext.sideEffect.storefront.install"),
        ],
        dryRunAvailable: true,
      },
    },
    {
      stage: "recipe",
      effects: {
        directoriesCreated: [],
        filesWritten: [],
        networkHostsContacted: ["cloud.saleor.io"],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.recipe"),
        target: cliMessage("riskContext.target.recipe"),
        riskLevel: "high",
        categories: ["production configuration changes"],
        reversible: false,
        sideEffects: [
          cliMessage("riskContext.sideEffect.recipe.deploy"),
          cliMessage("riskContext.sideEffect.recipe.plan"),
        ],
        dryRunAvailable: true,
      },
    },
    {
      stage: "stock",
      effects: {
        directoriesCreated: [],
        filesWritten: [],
        networkHostsContacted: ["cloud.saleor.io"],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.stock"),
        target: cliMessage("riskContext.target.stock"),
        riskLevel: "high",
        categories: ["production configuration changes"],
        reversible: false,
        sideEffects: [cliMessage("riskContext.sideEffect.stock.seed")],
        dryRunAvailable: true,
      },
    },
    {
      stage: "deploy",
      effects: {
        directoriesCreated: [],
        filesWritten: [],
        networkHostsContacted: [],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.deploy"),
        target: cliMessage("riskContext.target.deploy"),
        riskLevel: "high",
        categories: ["live deployment"],
        reversible: true,
        sideEffects: [
          cliMessage("riskContext.sideEffect.deploy.vercel"),
          cliMessage("riskContext.sideEffect.deploy.noToken"),
        ],
        dryRunAvailable: true,
      },
    },
    {
      stage: "stripe",
      effects: {
        directoriesCreated: [],
        filesWritten: [],
        networkHostsContacted: ["cloud.saleor.io"],
        repositoriesCloned: [],
      },
      riskContext: {
        action: cliMessage("riskContext.action.stripe"),
        target: cliMessage("riskContext.target.stripe", {
          manifestUrl: STRIPE_APP_MANIFEST_URL,
        }),
        riskLevel: "high",
        categories: ["payment setup", "production configuration changes"],
        reversible: true,
        sideEffects: [
          cliMessage("riskContext.sideEffect.stripe.appInstall", {
            manifestUrl: STRIPE_APP_MANIFEST_URL,
          }),
          cliMessage("riskContext.sideEffect.stripe.humanGate"),
        ],
        dryRunAvailable: true,
      },
    },
  ];
}

/**
 * The one declared setup-stage surface: each stage name paired with the facets
 * it carries. Every site that names stages — the stage runners, the stage
 * descriptions, the high-risk gate, and the side-effecting close list — derives
 * its set from the stages declared for that site's facet. Every stage takes a
 * description; only the stages `jolly start` runs itself take a runner; `init`
 * and `auth` are progress rows rather than side-effecting work.
 * @planks("the stage surface Jolly declares, naming each stage with the facets it carries")
 */
export const STAGE_SURFACE = {
  init: ["description"],
  auth: ["description"],
  store: ["runner", "description", "highRisk", "sideEffecting"],
  storefront: ["runner", "description", "sideEffecting"],
  recipe: ["runner", "description", "highRisk", "sideEffecting"],
  stock: ["runner", "description", "sideEffecting"],
  deploy: ["runner", "description", "highRisk", "sideEffecting"],
  stripe: ["runner", "description", "sideEffecting"],
} as const;

/**
 * The ordered high-risk stages `jolly start` runs itself and gates on.
 * @planks("the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read")
 */
const HIGH_RISK_STAGES = ["store", "recipe", "deploy"] as const;

// The store URLs derived from an already-configured GraphQL endpoint, so a
// resumed run (the store stage short-circuits because a store is already
// configured) surfaces the same { graphqlApiUrl, dashboardUrl } in `data.store`
// that a fresh provision does (feature 002). The agent needs the Dashboard link
// to hand the human for the remaining Dashboard step (e.g. the Stripe keys gate);
// without it a resumed run leaves the agent unable to produce the link. Returns
// undefined for a malformed endpoint rather than throwing.
/**
 * @planks("the envelope `data` should report the created store's Saleor Dashboard URL ending in `.saleor.cloud\/dashboard\/`")
 */
function storeDataFromEndpoint(
  endpoint: string,
): { graphqlApiUrl: string; dashboardUrl: string } | undefined {
  try {
    return { graphqlApiUrl: endpoint, dashboardUrl: new URL("/dashboard/", endpoint).href };
  } catch {
    return undefined;
  }
}

/**
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("the output envelope data should mark the run as a dry run")
 */
function commandStartDryRun(): Envelope {
  const command = "start";
  const plan = startPlan();
  // When a store endpoint is already configured, the store stage is already
  // satisfied: the preview reports the configured store and skips provisioning,
  // naming no Cloud API create request. Absent a configured endpoint, the store
  // stage keeps its provision plan (createStoreGateTarget).
  const storeEndpoint =
    loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"] ??
    process.env["NEXT_PUBLIC_SALEOR_API_URL"];
  if (storeEndpoint) {
    const store = plan.find((s) => s.stage === "store");
    if (store) {
      store.effects = {
        directoriesCreated: [],
        filesWritten: [],
        networkHostsContacted: [],
        repositoriesCloned: [],
      };
      store.riskContext = {
        action: cliMessage("riskContext.action.skipStore"),
        target: cliMessage("riskContext.target.skipStore", { storeEndpoint }),
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          cliMessage("riskContext.sideEffect.skipStore.satisfied", { storeEndpoint }),
        ],
        dryRunAvailable: true,
      };
    }
  }
  const summary = storeEndpoint
    ? cliMessage("start.summary.previewedPlan.storeSatisfied")
    : cliMessage("start.summary.previewedPlan");
  // Surface the already-configured store's URLs in the preview `data` too, so a
  // resumed run's --dry-run gives the agent the Dashboard link (feature 002/022).
  const storeUrls = storeEndpoint ? storeDataFromEndpoint(storeEndpoint) : undefined;
  return envelope({
    command,
    status: "success",
    summary,
    data: {
      dryRun: true,
      plan,
      ...(storeUrls ? { store: storeUrls } : {}),
    },
    checks: [
      {
        id: "start-dry-run",
        status: "skipped",
        description: cliMessage("start.check.startDryRun.skipped"),
      },
    ],
    nextSteps: [
      {
        description: cliMessage("start.next.runStartForPlaybook"),
        command: "jolly start",
      },
    ],
  });
}

type StageStatus =
  | "completed"
  | "awaiting-approval"
  | "blocked"
  | "pending"
  | "skipped"
  | "error";

interface StartStage {
  stage: string;
  status: StageStatus;
  // The stage's reported start and finish time (epoch ms). On the `--yes` agent
  // path the storefront preparation is launched concurrently with the store
  // stage, so a stage whose reported start precedes another's reported finish
  // ran concurrently with it (feature 002 Rule "Concurrent stage preparation is
  // observable in the run envelope").
  startedAt?: number;
  finishedAt?: number;
  riskContext?: RiskContext;
}

/**
 * The store name + domain label `jolly start`'s auto-provision uses (feature 002
 * Rule "Auto-provisioning a store, and how the store is named"). An OPTIONAL
 * configured store name — a real customer affordance read from project
 * configuration (`JOLLY_STORE_NAME` / `JOLLY_STORE_DOMAIN_LABEL` in `.env` or the
 * environment) — with a sensible default otherwise. This same affordance is the
 * single hook the test harness uses to make provisioned stores `jolly-cannon-fodder`
 * cannon fodder; Jolly bakes no test knowledge into production.
 * @planks("the envelope `data` should include the store's `*.saleor.cloud` GraphQL API URL and its Saleor Dashboard URL ending in `.saleor.cloud\/dashboard\/`")
 */
function configuredStoreName(override?: {
  name?: string;
  domainLabel?: string;
}): { name: string; domainLabel: string } {
  const values = loadEnvValues(projectDir());
  // The name the human typed (interactive prompt) or passed via --name takes
  // precedence over JOLLY_STORE_NAME and the default — otherwise the store
  // stage would ignore the requested name and reuse whatever existing
  // "jolly-store"-named environment the org already holds.
  const cleaned = (v?: string): string | undefined => {
    const t = v?.trim();
    return t && t.length > 0 ? t : undefined;
  };
  const name =
    cleaned(override?.name) ??
    values["JOLLY_STORE_NAME"] ??
    process.env["JOLLY_STORE_NAME"] ??
    "jolly-store";
  const domainLabel =
    cleaned(override?.domainLabel) ??
    values["JOLLY_STORE_DOMAIN_LABEL"] ??
    process.env["JOLLY_STORE_DOMAIN_LABEL"] ??
    name;
  return { name, domainLabel };
}

/** A stage result that can also contribute data to the run envelope. */
interface StageOutcome {
  status: StageStatus;
  data?: Record<string, unknown>;
}

/**
 * Genuinely perform the store stage (feature 002 Rule "Auto-provisioning a
 * store"). When a store endpoint is already configured, the store already
 * exists — `completed`, nothing to provision. Otherwise, with a Cloud token
 * configured, Jolly provisions a Saleor Cloud environment itself via the same
 * Cloud API plumbing as `jolly create store --create-environment`, writes the
 * resulting NEXT_PUBLIC_SALEOR_API_URL + agent-facing SALEOR_URL/SALEOR_TOKEN to
 * `.env` so the downstream recipe/stock/deploy stages have a reachable endpoint
 * and the resolved store token, and surfaces
 * the new store's GraphQL + Dashboard URLs. Reported honestly: `completed` only
 * when an environment was actually created or reused; `blocked` (with an
 * explaining check) when no Cloud token is configured or provisioning failed —
 * never a fabricated completion.
 * @planks("the envelope `data` should include the store's `*.saleor.cloud` GraphQL API URL and its Saleor Dashboard URL ending in `.saleor.cloud\/dashboard\/`")
 * @planks("`jolly start` should write that `NEXT_PUBLIC_SALEOR_API_URL` \(mirrored to `SALEOR_URL`) and the resolved `SALEOR_TOKEN` to `.env`")
 * @planks(`the `store` stage should report "completed" only once the endpoint answers a live GraphQL probe`)
 * @planks(`the `store` stage status should be "blocked", not "completed"`)
 * @planks("the remediation should tell the human the store may still be starting up and to re-run `jolly start`")
 */
async function runStoreStage(
  checks: Check[],
  nameOverride?: { name?: string; domainLabel?: string },
): Promise<StageOutcome> {
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  if (endpoint) {
    checks.push({
      id: "store-provisioned",
      status: "pass",
      description: cliMessage("start.store.check.storeProvisioned.reusedEndpoint"),
    });
    // Reuse must keep the agent-facing surface current: ensure SALEOR_URL and a
    // freshly-resolved SALEOR_TOKEN are projected from the existing endpoint +
    // session, so the downstream recipe/stock/deploy stages (and configurator/
    // curl/MCP) never read a stale or missing store token.
    projectSaleorAgentEnv({ SALEOR_URL: endpoint });
    return { status: "completed" };
  }

  const token = cloudPlatformToken(values) ?? "";
  if (!token) {
    checks.push({
      id: "store-provisioned",
      status: "skipped",
      description: cliMessage("start.store.check.storeProvisioned.skipped"),
    });
    return { status: "blocked" };
  }

  try {
    const orgs = await listOrganizations(token);
    if (orgs.length === 0) {
      checks.push({
        id: "store-provisioned",
        status: "fail",
        description: cliMessage("start.store.check.storeProvisioned.noOrganizations"),
      });
      return { status: "blocked" };
    }
    const selectedOrg = orgs[0].slug;
    const { name, domainLabel } = configuredStoreName(nameOverride);
    const result = await provisionStore(token, selectedOrg, {
      name,
      domainLabel,
      region: "us-east-1",
    });
    // provisionStore() itself waits for a freshly-created environment to
    // actually serve before returning (a reused environment is already
    // serving) — so the recipe/deploy stages that immediately follow this one
    // never run against a cold endpoint (the spawned configurator does not
    // retry, so it would fail its deploy with "unable to connect").
    if (result.readinessTimedOut) {
      checks.push({
        id: "store-provisioned",
        status: "fail",
        description: cliMessage("start.store.check.storeProvisioned.unreachable", {
          environmentName: result.environmentName,
          selectedOrg,
        }),
        remediation: cliMessage("start.store.check.storeProvisioned.fail.remediation"),
      });
      return { status: "blocked" };
    }
    checks.push({
      id: "store-provisioned",
      status: "pass",
      description: cliMessage(
        result.environmentCreated
          ? "start.store.check.storeProvisioned.provisioned"
          : "start.store.check.storeProvisioned.reusedEnvironment",
        { environmentName: result.environmentName, selectedOrg },
      ),
    });
    return {
      status: "completed",
      data: {
        organization: result.organization,
        environmentName: result.environmentName,
        graphqlApiUrl: result.graphqlApiUrl,
        dashboardUrl: result.dashboardUrl,
      },
    };
  } catch (err) {
    checks.push({
      id: "store-provisioned",
      status: "fail",
      description: cliMessage("start.store.check.storeProvisioned.failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    });
    return { status: "blocked" };
  }
}

/**
 * Resolve Jolly's bundled starter recipe (`assets/skills/jolly/recipe.yml`)
 * relative to Jolly's own module path. Works in both dev (`src/index.ts`) and
 * the published bundle (`dist/index.js`): both sit one level under the package
 * root, and `assets/skills/` ships in package `files`.
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("the agent runs `jolly recipe --yes --json` to apply the starter recipe to Saleor Cloud")
 */
function bundledRecipePath(): string {
  return fileURLToPath(new URL("../assets/skills/jolly/recipe.yml", import.meta.url));
}

/**
 * Genuinely perform the configurator-deploy stage (feature 004 Rule
 * "Configurator deploy"). This is the FIRST spawned-CLI `jolly start` stage:
 * Jolly SPAWNS `npx @saleor/configurator@latest deploy` — the official, current
 * CLI — of its bundled starter recipe against the store, never reimplementing
 * it against raw APIs. Resolves the store GraphQL endpoint and SALEOR_TOKEN from
 * .env/process.env (first-party Saleor host only — the same creds Jolly already
 * manages); if either is missing it pushes a skipped check and blocks rather
 * than fabricating. The bootstrap path is decided by the store's STATE, not by
 * which command provisioned it (feature 004 Rule "Recipe targets a clean
 * environment"): a store holding only Saleor's stock defaults (no customer
 * catalog) is the recipe's intended blank canvas — whether `jolly start`
 * auto-provisioned it this run or a prior `jolly create store` recorded it in
 * .env — so the deploy omits `--failOnDelete` and the expected deletion of the
 * undeclared stock defaults proceeds. On a store that already holds customer
 * catalog it passes `--failOnDelete` so a destructive apply is blocked (exit 6)
 * for the customer's explicit approval, not silently destructive — the blocked
 * check names the per-entity deletions read from a `--plan` preview of the same
 * deploy, surfacing the destructive diff. (The
 * configurator binary exposes only `--failOnDelete`; it has no breaking-changes
 * guard.) Reads the configurator's EXIT CODE and its deployment report, and
 * reports honestly: `completed` only when the configurator exited 0 OR its
 * report records success (the bootstrap apply's protected-default deletions
 * yield a spurious exit-5 "partial"), and only after the store read-back
 * confirms the recipe's declared catalog — never from the configurator's
 * optimistic summary counts alone; `blocked`/`fail` (with the real error) on
 * any other non-zero exit or a configurator that cannot be spawned — never a
 * fabricated deploy.
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("the agent runs `jolly recipe --yes --json` to apply the starter recipe to Saleor Cloud")
 * @planks("`jolly start` runs to completion in an interactive terminal")
 * @planks("the blocked report should name the destructive diff the configurator observed, including a deletion it would make")
 */
async function runRecipeStage(
  checks: Check[],
  opts: { resume?: boolean } = {},
): Promise<StageStatus> {
  // The preceding storefront stage (clone + pnpm install) can outlast the ~5-min
  // access JWT SALEOR_TOKEN rides on, so refresh it before the configurator deploy
  // spends it — otherwise the store 401s "Authentication failed" (feature 018).
  await ensureFreshStoreAuth();
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token =
    process.env["SALEOR_TOKEN"] ?? values["SALEOR_TOKEN"] ?? resolveSaleorToken(values) ?? "";

  if (!endpoint || !token) {
    checks.push({
      id: "recipe-deployed",
      status: "skipped",
      description: cliMessage("start.recipe.check.recipeDeployed.skipped"),
      remediation: cliMessage("start.recipe.check.recipeDeployed.skipped.remediation"),
    });
    return "blocked";
  }

  const bundledRecipe = bundledRecipePath();
  if (!existsSync(bundledRecipe)) {
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: cliMessage("start.recipe.check.recipeDeployed.bundledMissing", { bundledRecipe }),
      remediation: cliMessage("start.recipe.check.recipeDeployed.bundledMissing.remediation"),
    });
    return "blocked";
  }

  // `@saleor/configurator` requires --config to live WITHIN its working
  // directory, but Jolly's recipe ships at its install path (outside the user's
  // project). So write the bundled recipe into the project dir first (feature
  // 004: "write the recipe to a file at a named path before deployment") and run
  // the configurator from there — this is also the agent's reviewable copy.
  const recipePath = join(projectDir(), "recipe.yml");
  try {
    writeFileSync(recipePath, readFileSync(bundledRecipe, "utf8"));
  } catch (err) {
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: cliMessage("start.recipe.check.recipeDeployed.writeFailed", {
        recipePath,
        error: err instanceof Error ? err.message : String(err),
      }),
      remediation: cliMessage("start.recipe.check.recipeDeployed.writeFailed.remediation"),
    });
    return "blocked";
  }

  // Idempotency on the resumable `jolly start` path (feature 022): the recipe's
  // completed work is observable remote state — a store that already holds
  // every product the recipe declares. Such a store needs no configurator
  // re-deploy, so the stage is treated as satisfied and continues with the
  // collections read-back it still owns (idempotent, feature 004), keeping the
  // pass grounded in the store's real state. A store whose state cannot be
  // read deploys as before, mirroring the --failOnDelete guard below. The
  // standalone `jolly recipe` command keeps its always-deploy semantics.
  if (opts.resume) {
    let alreadyDeployed = false;
    try {
      const { productSlugs } = deriveRecipeIdentifiers(bundledRecipe);
      alreadyDeployed = await storeHoldsRecipeCatalog(endpoint, token, productSlugs);
    } catch {
      alreadyDeployed = false;
    }
    if (alreadyDeployed) {
      // The collections read-back pushes its own catalog-backed
      // `recipe-collections` check either way, so the stage's evidence is the
      // read-back's real result and no this-run deploy is claimed.
      const collectionsStatus = await assignRecipeCollections(endpoint, token, checks);
      const collectionsFailed =
        collectionsStatus !== "completed" ||
        checks.find((c) => c.id === "recipe-collections")?.status === "fail";
      return collectionsFailed ? "blocked" : "completed";
    }
  }

  // The configurator writes a structured deployment report; we read its own
  // success verdict from it, because the process EXIT CODE alone is unreliable
  // for the bootstrap apply: replacing Saleor's stock defaults yields exit 5
  // ("partial") even when the report records status "success" with zero errors.
  const reportPath = join(projectDir(), ".jolly-configurator-report.json");
  rmSync(reportPath, { force: true });

  // Decide the bootstrap path by the store's STATE (feature 004 Rule "Recipe
  // targets a clean environment"): omit --failOnDelete only when the store holds
  // no product catalog beyond the recipe's own. A blank store (no products) and
  // an idempotent re-run over Jolly's own store (only the recipe's products) both
  // take the bootstrap path, so the re-deploy reconciles cleanly instead of
  // blocking on the lingering protected default channel; a store that already
  // holds the customer's own products keeps the guard so a destructive apply is
  // blocked (exit 6). If the state cannot be read, keep the safe guard.
  let allowDeletes: boolean;
  try {
    const { productSlugs } = deriveRecipeIdentifiers(bundledRecipe);
    allowDeletes = !(await storeHoldsForeignCatalog(endpoint, token, productSlugs));
  } catch {
    allowDeletes = false;
  }

  const deployArgs = [
    "--yes",
    "@saleor/configurator@latest",
    "deploy",
    "--config",
    recipePath,
    "--url",
    endpoint,
    "--token",
    token,
    "--quiet",
    "--reportPath",
    reportPath,
    // Guard a destructive apply over a store that already holds catalog; omitted
    // on the bootstrap path, where deleting Saleor's stock defaults to match the
    // recipe is the intended initial setup (feature 004 Rule "Recipe targets a
    // clean environment").
    ...(allowDeletes ? [] : ["--failOnDelete"]),
  ];
  // A transient Saleor Cloud blip (503, cold instance, connection reset) makes
  // the spawned configurator exit non-zero with a network error in its stderr —
  // not a recipe defect, and not the --failOnDelete block (exit 6). The deploy is
  // idempotent reconciliation, so retry it a bounded few times before treating a
  // non-zero exit as blocked; a persistent failure still surfaces honestly.
  let result = spawnSync("npx", deployArgs, {
    cwd: projectDir(),
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, SALEOR_URL: endpoint, SALEOR_TOKEN: token },
  });
  let reportStatus = readConfiguratorReportStatus(reportPath);
  for (let attempt = 0; attempt < 2; attempt++) {
    const succeeded = result.status === 0 || reportStatus === "success";
    const transient =
      !succeeded &&
      !result.error &&
      result.status !== null &&
      result.status !== 6 &&
      /network error|unable to connect|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|HTTP 50[234]/i.test(
        (result.stderr ?? "").toString(),
      );
    if (!transient) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000 * 2 ** attempt, 12_000)));
    result = spawnSync("npx", deployArgs, {
      cwd: projectDir(),
      encoding: "utf8",
      timeout: 600_000,
      env: { ...process.env, SALEOR_URL: endpoint, SALEOR_TOKEN: token },
    });
    reportStatus = readConfiguratorReportStatus(reportPath);
  }
  rmSync(reportPath, { force: true });

  if (result.error || result.status === null) {
    const reason = result.error
      ? result.error.message
      : cliMessage("start.recipe.check.recipeDeployed.notDeployed.spawnFailed");
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: cliMessage("start.recipe.check.recipeDeployed.notDeployed", { reason }),
      remediation: cliMessage("start.recipe.check.recipeDeployed.notDeployed.remediation"),
    });
    return "blocked";
  }

  // Completed when the configurator exited 0, OR when its own report records the
  // deployment as a success (the catalog was applied; the exit-5 "partial" is the
  // spurious result of the protected-default deletions, not a real failure).
  if (result.status === 0 || reportStatus === "success") {
    // The configurator reported the deploy succeeded, but `recipe-deployed`
    // derives its final status from the store read-back below (feature 004
    // Rule): it must not report `pass` while a declared entity — the featured
    // collection's products — is absent from the store. The configurator cannot
    // populate collection membership in one deploy (its pipeline creates
    // Collections before Products, and the product schema has no `collections`
    // field), so assignRecipeCollections fills it in via GraphQL and verifies
    // every declared product was assigned. Idempotent, so a re-run reconciles.
    const collectionsStatus = await assignRecipeCollections(endpoint, token, checks);
    const collectionsFailed =
      collectionsStatus !== "completed" ||
      checks.find((c) => c.id === "recipe-collections")?.status === "fail";
    checks.push({
      id: "recipe-deployed",
      status: collectionsFailed ? "fail" : "pass",
      description: collectionsFailed
        ? cliMessage("start.recipe.check.recipeDeployed.collectionUnconfirmed")
        : cliMessage("start.recipe.check.recipeDeployed.pass"),
      ...(collectionsFailed
        ? {
            remediation: cliMessage("start.recipe.remediation"),
          }
        : {}),
    });
    return collectionsFailed ? "blocked" : "completed";
  }

  const stderr = (result.stderr ?? "").toString().slice(0, 2000);
  if (result.status === 6) {
    // Surface the destructive diff the guard blocked (feature 004 Rule
    // "Configurator deploy"): the deploy's exit-6 envelope carries only a
    // deletion COUNT, so re-run the same deploy as a `--plan` preview ("preview
    // without changes") and read the per-entity operations from its JSON
    // envelope (auto-activated in a non-TTY spawn). The configurator checks the
    // deletion policy BEFORE plan mode, so the preview omits `--failOnDelete`;
    // it applies nothing either way. The deletions ride the catalog value's
    // `{stderr}` run-value tail ahead of the configurator's own output, so the
    // blocked check names each entity the apply would delete.
    const planResult = spawnSync(
      "npx",
      [
        "--yes",
        "@saleor/configurator@latest",
        "deploy",
        "--config",
        recipePath,
        "--url",
        endpoint,
        "--token",
        token,
        "--quiet",
        "--plan",
      ],
      {
        cwd: projectDir(),
        encoding: "utf8",
        timeout: 600_000,
        env: { ...process.env, SALEOR_URL: endpoint, SALEOR_TOKEN: token },
      },
    );
    // The preview's stdout carries the configurator's banner and raw log lines
    // ahead of the envelope, and log objects contain braces of their own, so
    // anchor on the envelope's opening brace: the envelope is the final output
    // and its `{` is the last one at column 0.
    const planStdout = (planResult.stdout ?? "").toString();
    const envelopeStart = planStdout.lastIndexOf("\n{");
    const planEnvelope = JSON.parse(
      envelopeStart >= 0 ? planStdout.slice(envelopeStart + 1) : planStdout,
    ) as {
      result?: { operations?: Array<{ entity?: string; name?: string; action?: string }> };
    };
    const deletions = (planEnvelope.result?.operations ?? [])
      .filter((op) => op.action === "delete")
      .map((op) => `${op.action} ${op.entity} "${op.name}"`)
      .join(", ");
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: cliMessage("start.recipe.check.recipeDeployed.destructiveDiff", {
        stderr: `${deletions ? ` ${deletions}.` : ""}${stderr ? ` ${stderr}` : ""}`,
      }),
      remediation: cliMessage("start.recipe.check.recipeDeployed.destructiveDiff.remediation"),
    });
    return "blocked";
  }

  checks.push({
    id: "recipe-deployed",
    status: "fail",
    description: cliMessage("start.recipe.check.recipeDeployed.configuratorExit", {
      status: result.status,
      reportStatus: reportStatus
        ? cliMessage("start.recipe.check.recipeDeployed.reportStatusSuffix", { reportStatus })
        : "",
      stderr: stderr ? ` ${stderr}` : "",
    }),
    remediation: cliMessage("start.recipe.check.recipeDeployed.configuratorExit.remediation"),
  });
  return "blocked";
}

/**
 * Assign the recipe's declared collection products after a successful deploy
 * (feature 004). The configurator cannot populate collection membership in a
 * single deploy, so a `completed` recipe stage requires Jolly to fill it in via
 * GraphQL. Pushes an honest `recipe-collections` check and returns `completed`
 * only when every recipe collection was populated; `blocked` (never a fabricated
 * completion) when the assignment fails. A no-op `completed` when the recipe
 * declares no collections.
 * @planks("Jolly should spawn `npx @saleor\/configurator@latest deploy` of its bundled starter recipe against the store, never reimplementing it against raw APIs")
 */
async function assignRecipeCollections(
  endpoint: string,
  token: string,
  checks: Check[],
): Promise<StageStatus> {
  const { collections } = deriveRecipeIdentifiers(bundledRecipePath());
  if (collections.length === 0) return "completed";
  try {
    let assigned = 0;
    let declared = 0;
    for (const collection of collections) {
      declared += collection.products.length;
      assigned += await assignCollectionProducts(
        endpoint,
        token,
        collection.slug,
        collection.name,
        collection.channelSlug,
        collection.products,
      );
    }
    if (assigned < declared) {
      // A declared product was reported created by the configurator but is
      // absent from the store read-back, so the featured collection cannot be
      // fully populated — never a fabricated completion (feature 004 Rule).
      checks.push({
        id: "recipe-collections",
        status: "fail",
        description: cliMessage("start.recipe.collections.check.productsAbsent", {
          assigned,
          declared,
          remaining: declared - assigned,
        }),
        remediation: cliMessage("start.recipe.collections.check.productsAbsent.remediation"),
      });
      return "blocked";
    }
    checks.push({
      id: "recipe-collections",
      status: "pass",
      description: cliMessage("start.recipe.collections.check.recipeCollections.pass", {
        assigned,
        declared,
      }),
    });
    return "completed";
  } catch (err) {
    checks.push({
      id: "recipe-collections",
      status: "fail",
      description: cliMessage("start.recipe.collections.check.populateFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
      remediation: cliMessage("start.recipe.collections.check.populateFailed.remediation"),
    });
    return "blocked";
  }
}

/**
 * Read the `summary.status` from a `@saleor/configurator` deployment report
 * file, or undefined when it is absent/unreadable. The configurator's own
 * success verdict is a more reliable completion signal than the process exit
 * code, which reports a spurious "partial" (exit 5) when the bootstrap apply
 * replaces Saleor's protected stock defaults.
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("the stage should be reported completed only when the configurator's deployment report records success")
 */
function readConfiguratorReportStatus(reportPath: string): string | undefined {
  if (!existsSync(reportPath)) return undefined;
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      summary?: { status?: unknown };
    };
    const status = report.summary?.status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Genuinely perform the recipe stock-seeding stage (feature 004 Rule "Recipe
 * products need seeded stock"). Resolves the store GraphQL endpoint and
 * SALEOR_TOKEN from .env/process.env (first-party Saleor host only — the same
 * creds Jolly already manages), seeds a default quantity into the recipe warehouse
 * for every variant, and pushes an honest `stock-seeded` check. Returns
 * `completed` only when stock was actually seeded; `blocked` when there are no
 * recipe variants/warehouse yet or the store is unreachable — never a
 * fabricated completion. Wrapped so a network/DNS failure (e.g. the logic-tier
 * unroutable base) resolves quickly to `blocked` rather than throwing.
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("Jolly start completes the recipe stage")
 * @planks("every recipe product variant should have stock in the recipe warehouse")
 */
async function runStockStage(checks: Check[]): Promise<StageOutcome> {
  // Refresh the short-lived access token before the seeding mutations spend it,
  // for the same reason the recipe stage does (feature 018).
  await ensureFreshStoreAuth();
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token =
    process.env["SALEOR_TOKEN"] ?? values["SALEOR_TOKEN"] ?? resolveSaleorToken(values) ?? "";

  if (!endpoint || !token) {
    checks.push({
      id: "stock-seeded",
      status: "skipped",
      description: cliMessage("start.stock.check.stockSeeded.skipped"),
      remediation: cliMessage("start.stock.check.stockSeeded.skipped.remediation"),
    });
    return { status: "blocked" };
  }

  try {
    const { warehouseSlug, collections } = deriveRecipeIdentifiers(bundledRecipePath());
    const result = await seedRecipeStock(endpoint, token, DEFAULT_STOCK_QUANTITY, warehouseSlug);
    const collectionResult = await assignRecipeCollectionsConcurrent(endpoint, token, collections);
    checks.push({
      id: "stock-seeded",
      status: "pass",
      description: cliMessage("start.stock.check.stockSeeded.pass", {
        DEFAULT_STOCK_QUANTITY,
        seededCount: result.seededCount,
        warehouseSlug,
      }),
    });
    return {
      status: "completed",
      data: {
        stockRequests: result.stockRequests,
        collectionRequests: collectionResult.collectionRequests,
      },
    };
  } catch (err) {
    const code = err instanceof CloudApiError ? err.code : "STOCK_SEED_FAILED";
    const reason =
      code === "RECIPE_WAREHOUSE_NOT_FOUND" || code === "NO_RECIPE_VARIANTS"
        ? cliMessage("start.stock.check.stockSeeded.fail.recipeNotDeployed")
        : cliMessage("start.stock.check.stockSeeded.fail.endpointUnreachable");
    checks.push({
      id: "stock-seeded",
      status: "fail",
      description: cliMessage("start.stock.check.stockSeeded.fail", { reason }),
      remediation:
        code === "RECIPE_WAREHOUSE_NOT_FOUND" || code === "NO_RECIPE_VARIANTS"
          ? cliMessage("start.stock.check.stockSeeded.deployRecipeFirst.remediation")
          : cliMessage("start.stock.check.stockSeeded.endpointUnreachable.remediation"),
    });
    return { status: "blocked" };
  }
}

/**
 * Genuinely perform the Stripe app-install stage (feature 005 Rule "`jolly start`
 * Stripe stage — Jolly installs the app, keys + channel map is a guided gate").
 * This is the SECOND genuinely-executing `jolly start` stage: Jolly's own Saleor
 * GraphQL `appInstall` against the store GraphQL endpoint, authenticated with the
 * Cloud STAFF token (`JOLLY_SALEOR_CLOUD_TOKEN` — an app token gets
 * PermissionDenied). Idempotent (feature 022): an already-installed Stripe app is
 * reused. Returns `completed` only when the app was actually installed/reused;
 * `blocked` (with an honest check) when the endpoint/token is missing or the
 * install failed — never a fabricated install. Wrapped so a network/DNS failure
 * (e.g. the logic-tier unroutable base) resolves quickly to `blocked` rather than
 * throwing. The keys + `us`-channel mapping stay a human gate announced by the
 * caller regardless of the install outcome.
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("`jolly stripe` runs the Stripe app-install stage against that store")
 * @planks("it should install the Saleor Stripe app via Saleor GraphQL `appInstall` using the Cloud staff token and the current Stripe app manifest")
 */
async function runStripeStage(checks: Check[]): Promise<StageStatus> {
  // appInstall authenticates with the Cloud platform token, which also rides on
  // the ~5-min access JWT; refresh it before the last stage spends it (feature 018).
  await ensureFreshStoreAuth();
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const cloudToken = cloudPlatformToken(values) ?? "";

  if (!endpoint || !cloudToken) {
    checks.push({
      id: "stripe-app-installed",
      status: "skipped",
      description: cliMessage("start.stripe.check.stripeAppInstalled.skipped"),
      remediation: cliMessage("start.stripe.check.stripeAppInstalled.skipped.remediation"),
    });
    return "blocked";
  }

  try {
    const result = await installStripeApp(endpoint, cloudToken);
    checks.push({
      id: "stripe-app-installed",
      status: "pass",
      description: result.reused
        ? cliMessage("start.stripe.check.stripeAppInstalled.reused")
        : cliMessage("start.stripe.check.stripeAppInstalled.installed"),
    });
    return "completed";
  } catch (err) {
    const code = err instanceof CloudApiError ? err.code : "STRIPE_APP_INSTALL_FAILED";
    checks.push({
      id: "stripe-app-installed",
      status: "fail",
      description:
        code === "STRIPE_APP_INSTALL_FAILED"
          ? cliMessage("start.stripe.check.stripeAppInstalled.rejected")
          : cliMessage("start.stripe.check.stripeAppInstalled.unreachable"),
      remediation: cliMessage("start.stripe.check.stripeAppInstalled.fail.remediation"),
    });
    return "blocked";
  }
}

/**
 * The keys + `us`-channel Dashboard mapping human gate (feature 005 Rule): once
 * the Stripe stage has been reached (the app install attempted), the human pastes
 * the publishable + restricted keys into the installed Stripe app's Dashboard
 * config and maps the configuration to the recipe's `us` channel — a guided gate
 * Jolly does NOT perform (no stable public API). Keys referenced by name only,
 * never printed. Shared by `jolly start`'s orchestration (runStartCore) and the
 * standalone `jolly stripe` stage command (commandStage) so both announce the
 * SAME gate whenever the Stripe stage runs — the two entry points cannot drift.
 *
 * @planks("it should announce the guided gate to paste the keys and map the configuration to the `us` channel, referencing the keys by name only")
 */
function stripeKeysChannelGateStep(): NextStep {
  return {
    description: cliMessage("start.stripe.next"),
  };
}

/**
 * Genuinely perform the storefront clone+install stage (feature 002 Rule
 * "Storefront and Vercel deploy stages"). Jolly SPAWNS `git` to clone
 * `saleor/storefront` (Paper) from the `main` branch into `storefront/`, strips
 * the upstream `.git` history, `git init`s a fresh repository, and SPAWNS
 * `pnpm install` — never reimplementing them against raw APIs. Idempotent
 * (feature 022): an already-cloned/installed `storefront/` (with node_modules)
 * is detected and the stage is skipped rather than re-cloned. Reads the child
 * EXIT CODES and reports `completed`/`pass` only when the clone + install
 * actually succeeded; `blocked`/`fail` (with the real error) otherwise — never
 * a fabricated completion. Non-interactive.
 * @planks("`jolly start` prepares the storefront project by spawning `git` and `pnpm`")
 * @planks("it should clone Saleor's official `saleor\/storefront` Paper template from `main` by spawning `git`, remove the upstream `.git` history, and initialize a fresh repository")
 * @planks("it should install Paper's dependencies by spawning `pnpm`")
 */
async function runStorefrontStage(checks: Check[]): Promise<StageStatus> {
  const dir = join(projectDir(), "storefront");

  // Idempotency (feature 022): an already-prepared storefront is reused.
  if (existsSync(join(dir, "node_modules")) && existsSync(join(dir, "package.json"))) {
    checks.push({
      id: "storefront-prepared",
      status: "pass",
      description: cliMessage("start.storefront.check.storefrontPrepared.reused"),
    });
    return "completed";
  }

  // Clone Paper from `main` unless storefront/ already holds the sources.
  const alreadyCloned = existsSync(join(dir, "package.json"));
  if (!alreadyCloned) {
    if (existsSync(dir)) {
      checks.push({
        id: "storefront-prepared",
        status: "fail",
        description: cliMessage("start.storefront.check.storefrontPrepared.directoryCollision"),
        remediation: cliMessage(
          "start.storefront.check.storefrontPrepared.directoryCollision.remediation",
        ),
      });
      return "blocked";
    }
    const clone = spawnSync(
      "git",
      // Shallow clone: Jolly strips the upstream `.git` and re-inits a fresh
      // repo immediately, so the history is discarded anyway — `--depth 1`
      // fetches only main's latest commit (faster, less data) for the same result.
      ["clone", "--depth", "1", "--branch", "main", "https://github.com/saleor/storefront.git", dir],
      { encoding: "utf8", timeout: 600_000, env: { ...process.env } },
    );
    if (clone.error || clone.status !== 0) {
      const reason = clone.error
        ? clone.error.message
        : cliMessage("start.storefront.check.storefrontPrepared.cloneExit", {
            status: String(clone.status),
          });
      const stderr = (clone.stderr ?? "").toString().slice(0, 2000);
      checks.push({
        id: "storefront-prepared",
        status: "fail",
        description: cliMessage("start.storefront.check.storefrontPrepared.cloneFailed", {
          reason,
          stderr: stderr ? ` ${stderr}` : "",
        }),
        remediation: cliMessage("start.storefront.check.storefrontPrepared.cloneFailed.remediation"),
      });
      return "blocked";
    }
    // Strip the upstream .git history and initialize a fresh repository.
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    const init = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    if (init.error || init.status !== 0) {
      checks.push({
        id: "storefront-prepared",
        status: "fail",
        description: cliMessage("start.storefront.check.storefrontPrepared.gitInitFailed", {
          error: init.error
            ? init.error.message
            : cliMessage("start.storefront.check.storefrontPrepared.gitInitExit", {
                status: String(init.status),
              }),
        }),
        remediation: cliMessage("start.storefront.check.storefrontPrepared.gitInitFailed.remediation"),
      });
      return "blocked";
    }
  }

  // Approve Paper's native dependency build scripts. pnpm 10+ ignores a
  // dependency's build script unless it is listed in `pnpm.onlyBuiltDependencies`;
  // Paper's native modules (sharp, esbuild, unrs-resolver) must build or the
  // Vercel production build fails on unbuilt native binaries. Persist the
  // approval into storefront/package.json so even a fresh `pnpm install` runs them.
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  const pnpmCfg = (pkg.pnpm ??= {}) as Record<string, unknown>;
  const approved = new Set(
    (Array.isArray(pnpmCfg.onlyBuiltDependencies) ? pnpmCfg.onlyBuiltDependencies : []) as string[],
  );
  for (const dep of ["sharp", "esbuild", "unrs-resolver"]) approved.add(dep);
  pnpmCfg.onlyBuiltDependencies = [...approved];
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // Install Paper's dependencies with pnpm, run via `npx` — like Jolly's other
  // spawned CLIs (`@saleor/configurator`, `vercel`), so no global pnpm install
  // is a prerequisite. `npx --yes pnpm` fetches and runs pnpm (a missing global
  // pnpm is never a failure, feature 002).
  const install = spawnSync("npx", ["--yes", "pnpm", "install"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env },
  });
  if (install.error || install.status !== 0) {
    const reason = install.error
      ? install.error.message
      : cliMessage("start.storefront.check.storefrontPrepared.installExit", {
          status: String(install.status),
        });
    const stderr = (install.stderr ?? "").toString().slice(0, 2000);
    checks.push({
      id: "storefront-prepared",
      status: "fail",
      description: cliMessage("start.storefront.check.storefrontPrepared.installFailed", {
        reason,
        stderr: stderr ? ` ${stderr}` : "",
      }),
      remediation: cliMessage("start.storefront.check.storefrontPrepared.installFailed.remediation"),
    });
    return "blocked";
  }

  checks.push({
    id: "storefront-prepared",
    status: "pass",
    description: cliMessage("start.storefront.check.storefrontPrepared.cloned"),
  });
  return "completed";
}

/**
 * Genuinely perform the Vercel deploy stage (feature 002 Rule "Storefront and
 * Vercel deploy stages"). Jolly SPAWNS the official Vercel CLI (`npx vercel`,
 * then `npx vercel --prod`) under the Vercel CLI's OWN `vercel login` session —
 * never a raw-API reimplementation. The durable Vercel invariants hold: official
 * CLI only, its own auth, NO `JOLLY_VERCEL_TOKEN`, and NO Vercel REST API host
 * in Jolly's own request code (the spawned CLI reaches it under its own auth).
 * `vercel login` is an interactive stdio-passthrough gate; Jolly continues on
 * the child's exit. Reads the child EXIT CODE and reports `completed`/`pass`
 * only on a real exit-0 deploy; `blocked`/`fail` (with the real error) otherwise
 * — never a fabricated deployment. Non-interactive for the deploy itself.
 */
/**
 * The Vercel device-authorization URL the CLI prints when it signs in, or undefined.
 * @planks("Jolly should itself spawn `npx vercel@latest login` and surface its device-authorization URL before attempting any deploy")
 */
function extractDeviceUrl(text: string): string | undefined {
  const m = text.match(/https:\/\/vercel\.com\/oauth\/device\?[^\s]+/i);
  return m ? m[0] : undefined;
}

/**
 * Probe the Vercel CLI session WITHOUT hanging, by delegating to the CLI's own
 * `vercel whoami` (feature 014 single readiness oracle). With a session the CLI
 * prints the account on stdout and exits 0; with NO session the Vercel CLI drops
 * into its device-login flow (printing "No existing credentials" / a device URL
 * on stderr) and waits — so we stream the output and resolve "no session" the
 * moment that marker appears, killing the probe so nothing is left polling.
 * Jolly reads no Vercel token; it only asks the CLI under its own auth.
 * @planks("`jolly start` deploys to Vercel")
 */
async function probeVercelSession(): Promise<{ signedIn: boolean; account: string }> {
  return new Promise((resolve) => {
    // `--yes` as on EVERY other npx spawn: without it, npx stops to ask "Ok to
    // proceed?" before installing the Vercel CLI on a machine that has not cached
    // it. stdin is ignored here, so that prompt can never be answered — npx just
    // blocks and the probe learns nothing until it times out.
    const child = spawn("npx", ["--yes", VERCEL_PKG, "whoami"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const done = (signedIn: boolean) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* best-effort */
      }
      clearTimeout(timer);
      const account =
        out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).at(-1) ?? "";
      resolve({ signedIn, account });
    };
    const timer = setTimeout(() => done(false), 45_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (/no existing credentials|starting login flow|\/oauth\/device/i.test(String(chunk))) {
        done(false);
      }
    });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0 && out.trim().length > 0));
  });
}

/**
 * Spawn the Vercel sign-in (`npx vercel login`) and capture its
 * device-authorization URL, WITHOUT waiting for the human to complete it. The
 * Vercel CLI prints the device URL on stderr then blocks polling for
 * authorization; we read until the URL appears, then stop the child — no hang,
 * no leaked waiting process. Returns the captured device URL, or undefined.
 * Jolly holds no Vercel token; the CLI signs in under its own auth.
 */
// The Vercel CLI package Jolly spawns via npx. Unpinned (latest) — version
// pinning to dodge a transitive dep's node-engine warning proved fragile; the
// warning is instead silenced at the npm level (NPM_CONFIG_LOGLEVEL in main()).
const VERCEL_PKG = "vercel";

const VERCEL_SIGNIN_URL_TIMEOUT_MS = 60_000;

// The interactive sign-in WAITS for the human to approve the device grant in
// their browser, polling the Vercel CLI's own session until it appears. Generous
// enough for a human to find the tab, sign in, and approve; bounded so a walked-
// away terminal still finishes the run honestly rather than hanging forever.
const VERCEL_SIGNIN_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const VERCEL_SIGNIN_POLL_INTERVAL_MS = 1_000;

// Spawn the Vercel CLI's own device-login DETACHED so it OUTLIVES this run: it
// keeps polling and stores the Vercel token itself when the human approves, so a
// later `jolly start` re-run sees a signed-in session via `vercel whoami`. We
// capture the device URL by tailing the login's output FILE — a piped stdio
// would break with EPIPE the moment this process exits, killing the login before
// the human approves (the bug the old kill-after-capture version had). Returns
// the captured device URL, or undefined. Jolly holds no Vercel token.
/**
 * @planks("Jolly should itself spawn `npx vercel@latest login` and surface its device-authorization URL before attempting any deploy")
 */
async function spawnVercelSignIn(): Promise<{ deviceUrl?: string; logPath?: string }> {
  const logPath = join(tmpdir(), `jolly-vercel-login-${process.pid}-${Date.now()}.log`);
  let fd: number;
  try {
    fd = openSync(logPath, "a+");
  } catch {
    return {};
  }
  try {
    // `--yes` is LOAD-BEARING: without it, npx stops to ask "Ok to proceed?"
    // before installing the Vercel CLI on a machine that has not cached it. stdin
    // is ignored and the output goes to a file, so that prompt is both invisible
    // and unanswerable — npx blocks forever, `vercel login` never runs, no device
    // URL is ever printed, and the human is told sign-in failed having been shown
    // nothing at all. Every other npx spawn in this file already passes it.
    const child = spawn("npx", ["--yes", VERCEL_PKG, "login"], {
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child.unref(); // do not keep this process alive on the detached login
    closeSync(fd); // the child holds its own dup of the fd and keeps writing
    const deadline = Date.now() + VERCEL_SIGNIN_URL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const deviceUrl = extractDeviceUrl(readVercelSignInLog(logPath));
      // The logPath rides along so an interactive caller can keep tailing THIS
      // login's output to see the human approve it (the child polls Vercel and
      // persists the credentials itself).
      if (deviceUrl) return { deviceUrl, logPath };
    }
    return { logPath };
  } catch {
    return {};
  }
}

/** Read the detached sign-in's output file; "" until the login has written. */
function readVercelSignInLog(logPath: string): string {
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

// Verdict markers the Vercel CLI's own device-login prints into its output file.
// SUCCESS is printed immediately AFTER the CLI persists its auth config, so
// seeing it means the session is on disk and `vercel` commands are authenticated.
// (Verified against the shipped Vercel CLI bundle, not guessed.)
const VERCEL_SIGNIN_SUCCESS = /congratulations!|you are now signed in/i;
const VERCEL_SIGNIN_FAILED = /timed out waiting for authentication|failed to authenticate/i;

// The pending Vercel device URL is persisted between agent invocations so a
// re-run that is still unapproved shows the SAME URL (the detached login spawned
// earlier is still polling) instead of spawning another login with a fresh URL.
const PENDING_VERCEL_FILE = ".jolly-pending-vercel.json";
const VERCEL_SIGNIN_LIFETIME_SECONDS = 600;

function pendingVercelPath(): string {
  return join(projectDir(), PENDING_VERCEL_FILE);
}

/**
 * @planks("the agent runs `jolly deploy` again while the sign-in URL is within its lifetime")
 */
function loadPendingVercelUrl(): string | undefined {
  try {
    const saved = JSON.parse(readFileSync(pendingVercelPath(), "utf8")) as {
      deviceUrl?: string;
      savedAt?: number;
    };
    if (typeof saved.deviceUrl !== "string" || saved.deviceUrl.length === 0) return undefined;
    if (
      typeof saved.savedAt === "number" &&
      (Date.now() - saved.savedAt) / 1000 > VERCEL_SIGNIN_LIFETIME_SECONDS
    ) {
      clearPendingVercel(); // the device code is past its lifetime; spawn fresh
      return undefined;
    }
    return saved.deviceUrl;
  } catch {
    return undefined;
  }
}

/**
 * @planks('the nextStep should instruct the human to open the URL, approve it, reply "done", and re-run `jolly deploy` to continue, the same pause-and-resume contract as the Saleor sign-in gate')
 */
function savePendingVercel(deviceUrl: string): void {
  try {
    writeFileSync(pendingVercelPath(), JSON.stringify({ deviceUrl, savedAt: Date.now() }));
  } catch {
    /* best-effort */
  }
}

/**
 * @planks("`jolly start` deploys to Vercel")
 */
function clearPendingVercel(): void {
  try {
    rmSync(pendingVercelPath(), { force: true });
  } catch {
    /* best-effort */
  }
}

// The nextStep that hands the human the clickable Vercel verification URL and
// tells the agent to re-run once approved (feature 002).
/**
 * @planks("the agent runs `jolly deploy` without `--dry-run`")
 * @planks('the nextStep should instruct the human to open the URL, approve it, reply "done", and re-run `jolly deploy` to continue, the same pause-and-resume contract as the Saleor sign-in gate')
 * @planks('the nextStep should instruct the human to open the URL, approve it, reply "done", and re-run `jolly deploy` to continue, the same pause-and-resume contract as the Saleor sign-in gate')
 */
function vercelSignInNextStep(deviceUrl: string, resumeCommand: string): NextStep {
  return {
    description: cliMessage("start.deploy.next", { deviceUrl, resumeCommand }),
    url: deviceUrl,
    command: resumeCommand,
  };
}

/**
 * Extract the deployed `*.vercel.app` URL the Vercel CLI prints, or undefined.
 * @planks("the envelope `data` should report the deployed storefront URL captured from the Vercel CLI's deploy output, not a fabricated or guessed value")
 */
function extractVercelUrl(stdout: string | undefined): string | undefined {
  const m = (stdout ?? "").match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
  return m ? m[0] : undefined;
}

/**
 * The newest READY production deployment's https URL from `npx vercel ls
 * --format json` output — the official Vercel CLI under its own session, never
 * a raw Vercel API call. Returns undefined when the listing shows none or
 * cannot be read, which sends the resumable deploy stage down its normal
 * deploying path.
 * @planks("`jolly start` runs to completion in an interactive terminal")
 */
function listedReadyProductionUrl(stdout: string | undefined): string | undefined {
  const text = stdout ?? "";
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  try {
    const listing = JSON.parse(text.slice(start)) as {
      deployments?: Array<{ url?: unknown; state?: unknown; target?: unknown }>;
    };
    const ready = (listing.deployments ?? []).find(
      (deployment) =>
        typeof deployment.url === "string" &&
        deployment.state === "READY" &&
        deployment.target === "production",
    );
    return ready ? `https://${ready.url as string}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the Vercel sign-in for the INTERACTIVE human path (feature 027 Rule
 * "Interactive start runs end-to-end in one session"): the human approves the
 * device grant in their browser and the CLI's session is established before the
 * unattended deploy stage, all in this one run.
 *
 * The two modes differ only in WHO waits, never in whose UX the human sees:
 * - AGENT mode ({@link spawnVercelSignIn} + {@link vercelSignInNextStep}): capture
 *   the URL, hand it back as a pending nextStep, and let the agent's human approve
 *   it between invocations; a re-run resumes.
 * - TERMINAL mode (here): capture the URL and POLL to completion in-process, the
 *   way the Vercel CLI itself normally would, then carry straight on.
 *
 * In BOTH modes the spawned CLI's own output NEVER surfaces — the login writes to
 * a file, and the human sees only Jolly's own TUI (a clack note + spinner).
 *
 * A sign-in that does NOT complete reports the REASON it did not, and surfaces the
 * Vercel CLI's own captured output. A bare "sign-in didn't complete" collapses four
 * genuinely different failures — the CLI could not be launched, it printed no
 * device URL (its error is in that output), the code was declined/expired, or the
 * human never approved — into one message that leaves the human no way forward.
 * Jolly holds no Vercel token; the CLI signs in under its own auth.
 */
type VercelSignInOutcome =
  | { ok: true; account: string }
  | { ok: false; message: string };

/**
 * Run the Vercel sign-in for the INTERACTIVE human path: show the device URL in
 * Jolly's own TUI and WAIT for the human to approve it, so the session exists for
 * the unattended deploy stage. A sign-in that does not complete reports the REASON
 * and surfaces the Vercel CLI's captured output. See the type above for the modes.
 * @planks("the interactive output should show a Vercel device-authorization URL")
 * @planks("the run should still be waiting for that sign-in to be approved, not continuing signed-out")
 * @planks("the interactive output should name the reason the Vercel sign-in did not complete")
 * @planks("the interactive output should surface the captured Vercel CLI output for the human to read")
 */
async function runInteractiveVercelSignIn(): Promise<VercelSignInOutcome> {
  // Do NOT hand the terminal to `vercel login` (the old `stdio: "inherit"`
  // spawn). Under an interactive `jolly start` — itself usually launched through
  // `npx`, with @clack having had stdin in raw mode — the Vercel CLI's own device
  // prompt never renders and the child exits immediately: the human sees no CLI
  // at all and nothing ever waits for their click, so the run sails on with no
  // session. Reuse the DETACHED device-grant spawn the agent path already proves
  // out (it survives this process and stores the token itself once approved), and
  // keep its output off the terminal so only Jolly's TUI speaks to the human.
  const { deviceUrl, logPath } = await spawnVercelSignIn();

  if (!deviceUrl) {
    // The CLI never printed a sign-in link. Its OWN output says why (a network or
    // proxy failure reaching vercel.com, a wedged/half-written auth config, a
    // broken npx cache) — surface it, because without it the human is stuck.
    //
    // Read the VERDICT from the login's own log, never from `vercel whoami`: signed
    // out, whoami does not exit (it starts its own device login and blocks), so
    // probing here would stall the human a further ~45s just to be told it failed.
    // A login that signed straight in from a cached grant prints the success marker
    // without ever printing a URL, so the log answers both questions.
    const log = logPath ? readVercelSignInLog(logPath) : "";
    if (VERCEL_SIGNIN_SUCCESS.test(log)) {
      const session = await probeVercelSession(); // fast: a real session answers at once
      return { ok: true, account: session.account };
    }
    // Only when the login could not even be spawned (no output file at all) is there
    // nothing to point the human at. Otherwise ALWAYS name the log: an empty file is
    // itself the diagnosis (the CLI never ran), and the human must be able to read
    // the raw output rather than take Jolly's word for it.
    if (!logPath) {
      return { ok: false, message: cliMessage("start.vercelSignin.failSpawn") };
    }
    return {
      ok: false,
      message: cliMessage("start.vercelSignin.failNoUrl", {
        detail: tailVercelSignInLog(logPath) || cliMessage("start.vercelSignin.noOutput"),
        logPath,
      }),
    };
  }

  // Show the link, then WAIT by tailing the detached login's own output. We do
  // NOT poll `vercel whoami` here: signed out, whoami does not exit — it starts
  // its OWN device login and blocks — so polling it would stall for its whole
  // timeout each tick AND race a second device grant against this one.
  clackNote(deviceUrl, cliMessage("start.note.vercelSignin"), CLACK_STDERR);
  const spin = clackSpinner(CLACK_STDERR);
  spin.start(cliMessage("start.vercelSigninWaiting"));
  const deadline = Date.now() + VERCEL_SIGNIN_APPROVAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, VERCEL_SIGNIN_POLL_INTERVAL_MS));
    const log = readVercelSignInLog(logPath!);
    if (VERCEL_SIGNIN_SUCCESS.test(log)) {
      // The CLI persists its auth config immediately BEFORE printing this, so the
      // session is on disk; confirm the account for the human.
      const session = await probeVercelSession();
      spin.stop(cliMessage("start.vercelSigninDone", { account: session.account }));
      return { ok: true, account: session.account };
    }
    if (VERCEL_SIGNIN_FAILED.test(log)) {
      spin.stop(cliMessage("start.vercelSigninTimeout"));
      return {
        ok: false,
        message: cliMessage("start.vercelSignin.failRejected", {
          detail: tailVercelSignInLog(logPath!),
          logPath: logPath!,
        }),
      };
    }
  }
  spin.stop(cliMessage("start.vercelSigninTimeout"));
  return { ok: false, message: cliMessage("start.vercelSignin.failNotApproved", { logPath: logPath! }) };
}

// The last few lines of the sign-in's captured output — enough to carry the Vercel
// CLI's own error to the human without dumping an install log at them.
function tailVercelSignInLog(logPath: string, lines = 6): string {
  const text = readVercelSignInLog(logPath)
    .split("\n")
    .map((l) => l.trimEnd())
    // npm's install chatter is noise, not the CLI's verdict.
    .filter((l) => l.trim() !== "" && !/^npm (warn|notice|http)/i.test(l))
    .slice(-lines);
  return text.join("\n");
}

/**
 * @planks("`jolly start` deploys to Vercel")
 * @planks("the envelope `data` should report the deployed storefront URL captured from the Vercel CLI's deploy output, not a fabricated or guessed value")
 * @planks("it should configure the required environment variables on the Vercel project through the Vercel CLI")
 * @planks("`jolly start` runs to completion in an interactive terminal")
 * @planks("each should reach the network only through a seam that applies the first-party host predicate before sending")
 */
async function runDeployStage(
  checks: Check[],
  opts: { resume?: boolean } = {},
): Promise<StageOutcome> {
  const dir = join(projectDir(), "storefront");

  if (!existsSync(join(dir, "package.json"))) {
    checks.push({
      id: "vercel-deployed",
      status: "skipped",
      description: cliMessage("start.deploy.check.vercelDeployed.noStorefront"),
      remediation: cliMessage("start.deploy.check.vercelDeployed.noStorefront.remediation"),
    });
    return { status: "blocked" };
  }

  // The Paper storefront needs its NEXT_PUBLIC_* config at BUILD time, so the
  // Vercel build fails without them. Resolve the store endpoint (.env-first) and
  // the recipe's `us` channel (feature 004 Rule: the recipe `us` channel slug is
  // the storefront's NEXT_PUBLIC_DEFAULT_CHANNEL).
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  if (!endpoint) {
    checks.push({
      id: "vercel-deployed",
      status: "skipped",
      description: cliMessage("start.deploy.check.vercelDeployed.noEndpoint"),
      remediation: cliMessage("start.deploy.check.vercelDeployed.noEndpoint.remediation"),
    });
    return { status: "blocked" };
  }
  const channel =
    values["JOLLY_STORE_CHANNEL"] ?? process.env["JOLLY_STORE_CHANNEL"] ?? "us";
  // Optional configured Vercel project name (a real customer affordance, and the
  // single hook the test harness uses to make the deployed project `jolly-cannon-fodder`
  // cannon fodder it can tear down). Default: let the Vercel CLI infer it from
  // the storefront/ directory, so a real customer gets a sensibly named project.
  const vercelProject =
    values["JOLLY_VERCEL_PROJECT"] ?? process.env["JOLLY_VERCEL_PROJECT"];

  // Vercel sign-in is Jolly's to run (feature 002): with no Vercel CLI session,
  // Jolly itself spawns the sign-in and surfaces its device-authorization URL on
  // stderr, then reports a PENDING sign-in gate — never a deploy `fail`/`blocked`
  // for the missing sign-in, and never telling the agent to run `vercel login`.
  const session = await probeVercelSession();
  if (!session.signedIn) {
    // No Vercel session. Reuse the URL of a detached login already spawned by a
    // prior run if one is still within its lifetime (it is still polling);
    // otherwise spawn a fresh DETACHED `vercel login` that keeps polling and
    // stores the token itself, and persist its URL. The verification URL is
    // carried in the run's nextSteps (a clickable envelope link), never on
    // stdout/stderr — the human approves then re-runs `jolly start --yes`.
    let deviceUrl = loadPendingVercelUrl();
    if (!deviceUrl) {
      deviceUrl = (await spawnVercelSignIn()).deviceUrl;
      if (deviceUrl) savePendingVercel(deviceUrl);
    }
    checks.push({
      id: "vercel-sign-in",
      status: "warning",
      description: deviceUrl
        ? cliMessage("start.deploy.check.vercelSignIn.pendingWithUrl")
        : cliMessage("start.deploy.check.vercelSignIn.pending"),
    });
    return { status: "pending", data: deviceUrl ? { vercelSignInUrl: deviceUrl } : {} };
  }
  // Signed in: a prior run's pending sign-in (if any) completed.
  clearPendingVercel();

  // Idempotency on the resumable `jolly start` path (feature 022): a completed
  // earlier deploy leaves the storefront LINKED to its Vercel project
  // (`.vercel/project.json`), and the deployment itself is observable remote
  // state. When the linked project already serves a READY production
  // deployment, the deploy stage is satisfied: reuse the live deployment
  // rather than deploying again. Detection asks the official Vercel CLI under
  // its own session (`npx vercel ls`) — never a raw Vercel API call — and
  // trusts the listed URL only once it actually serves; anything short of that
  // falls through to a real deploy. The standalone `jolly deploy` command
  // keeps its always-deploy semantics.
  if (opts.resume && existsSync(join(dir, ".vercel", "project.json"))) {
    const listed = spawnSync(
      "npx",
      [
        "--yes",
        VERCEL_PKG,
        "ls",
        "--format",
        "json",
        "--environment",
        "production",
        "--status",
        "READY",
        "--yes",
      ],
      { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env } },
    );
    const liveUrl = listed.error ? undefined : listedReadyProductionUrl(listed.stdout);
    // Pre-flight before probing (feature 020 Rule "First-party hosts only"):
    // the serving probe contacts only the captured `*.vercel.app` deployment
    // URL the Vercel CLI reported, or a first-party host; anything else is
    // refused unsent, falling through to a real deploy.
    const liveHost = liveUrl ? new URL(liveUrl).hostname : "";
    if (liveUrl && (liveHost.endsWith(".vercel.app") || isFirstPartyHost(liveHost))) {
      const reuseDeadline = Date.now() + 90_000;
      let alreadyServing = false;
      while (Date.now() < reuseDeadline) {
        try {
          const response = await fetch(liveUrl, { method: "GET", redirect: "follow" });
          if (response.status < 400) {
            alreadyServing = true;
            break;
          }
        } catch {
          // Not reachable yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (alreadyServing) {
        // The check reports the fact this path verified — the live deployment
        // answers a real HTTP probe — through the catalog copy that owns it.
        checks.push({
          id: "deployed-storefront-serving",
          status: "pass",
          description: cliMessage("start.deploy.check.deployedStorefrontServing.pass", {
            deployedUrl: liveUrl,
          }),
        });
        return { status: "completed", data: { deploymentUrl: liveUrl, storefrontUrl: liveUrl } };
      }
    }
  }

  // Pin the Next.js framework so Vercel serves the storefront. Vercel auto-detects
  // the framework only when it creates the project during deploy; deploying into a
  // pre-existing project (e.g. a named `--project` target) uses that project's
  // framework preset, which is null/Other on a bare project and overrides
  // detection — producing a built-but-unrouted NOT_FOUND deployment. A vercel.json
  // framework pin forces the Next.js build regardless of the project preset
  // (feature 002). Paper ships no vercel.json, so this never clobbers user config.
  const vercelConfigPath = join(dir, "vercel.json");
  if (!existsSync(vercelConfigPath)) {
    writeFileSync(vercelConfigPath, JSON.stringify({ framework: "nextjs" }, null, 2) + "\n");
  }

  // `vercel deploy --project <name>` requires an ALREADY-EXISTING project —
  // it looks the name up in the account scope and fails "not found" rather
  // than creating one, unlike a plain `vercel deploy` (no --project), which
  // auto-creates a project from the directory name. So a configured name that
  // does not yet exist as a Vercel project must be created first via
  // `vercel project add`, which is idempotent (exit 0, "Success! ... added"
  // even when the project already exists) — safe to call unconditionally
  // rather than probing existence first.
  if (vercelProject) {
    spawnSync("npx", ["--yes", VERCEL_PKG, "project", "add", vercelProject], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env },
    });
  }

  // Deploy to production via the official Vercel CLI under its own session,
  // configuring the required build env vars through the CLI (feature 002 Rule).
  // No JOLLY_VERCEL_TOKEN is read or passed; Jolly's own code contacts no host.
  const deploy = spawnSync(
    "npx",
    [
      "--yes",
      VERCEL_PKG,
      "deploy",
      "--prod",
      "--yes",
      ...(vercelProject ? ["--project", vercelProject] : []),
      "--build-env",
      `NEXT_PUBLIC_SALEOR_API_URL=${endpoint}`,
      "--build-env",
      `NEXT_PUBLIC_DEFAULT_CHANNEL=${channel}`,
    ],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 600_000,
      env: { ...process.env },
    },
  );

  if (deploy.error || deploy.status === null) {
    const reason = deploy.error
      ? deploy.error.message
      : cliMessage("start.deploy.check.vercelDeployed.reason.spawnFailed");
    checks.push({
      id: "vercel-deployed",
      status: "fail",
      description: cliMessage("start.deploy.check.vercelDeployed.reason", { reason }),
      remediation: cliMessage("start.deploy.check.vercelDeployed.reason.remediation"),
    });
    return { status: "blocked" };
  }

  if (deploy.status === 0) {
    const deployedUrl = extractVercelUrl(deploy.stdout);
    checks.push({
      id: "vercel-deployed",
      status: "pass",
      description: deployedUrl
        ? cliMessage("start.deploy.check.vercelDeployed.withUrl", { deployedUrl })
        : cliMessage("start.deploy.check.vercelDeployed.withoutUrl"),
    });
    // Make the store publicly reachable: Vercel Deployment Protection (SSO /
    // "Vercel Authentication") is on by default and 401s anonymous visitors.
    // Disable it via the Vercel CLI under its OWN session — no direct Vercel
    // API request from Jolly's code. Best-effort: a plan/permission that
    // disallows it falls back to a guided step.
    const protection = spawnSync(
      "npx",
      [
        "--yes",
        VERCEL_PKG,
        "project",
        "protection",
        "disable",
        ...(vercelProject ? [vercelProject] : []),
        "--sso",
      ],
      { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env } },
    );
    const protectionDisabled = !protection.error && protection.status === 0;
    checks.push({
      id: "vercel-deployment-protection",
      status: protectionDisabled ? "pass" : "warning",
      description: protectionDisabled
        ? cliMessage("start.deploy.check.vercelDeploymentProtection.pass")
        : cliMessage("start.deploy.check.vercelDeploymentProtection.warning"),
    });
    // The deployed storefront was built against this Saleor endpoint; verify the
    // endpoint is reachable so the deployed storefront can reach Saleor Cloud
    // (feature 002). Read-only probe — `pass` only on a real GraphQL response.
    const reachable = (await probeEndpointConnectivity(endpoint)).kind === "reachable";
    checks.push({
      id: "deployed-storefront-saleor-connectivity",
      status: reachable ? "pass" : "unknown",
      description: reachable
        ? deployedUrl
          ? cliMessage("start.deploy.check.storefrontLive.withUrl", { deployedUrl })
          : cliMessage("start.deploy.check.storefrontLive")
        : deployedUrl
          ? cliMessage("start.deploy.check.storefrontLive.unreachableWithUrl", { deployedUrl })
          : cliMessage("start.deploy.check.storefrontLive.unreachable"),
    });
    // Link storefront/ to the project so the env commands operate on it: a
    // `vercel deploy --project <name>` targets the project but does NOT link the
    // working dir, and `vercel env add`/`ls` require a linked project. Link it
    // now so persistence lands and a plain `npx vercel deploy` re-deploy uses it.
    if (vercelProject) {
      spawnSync(
        "npx",
        ["--yes", VERCEL_PKG, "link", "--yes", "--project", vercelProject],
        { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env } },
      );
    }
    // Persist the build-time env vars on the Vercel PROJECT through the Vercel
    // CLI (not only `--build-env` at deploy time), so a plain `npx vercel deploy`
    // re-deploy builds them too (feature 029). Replace any existing value first so
    // a re-deploy stays idempotent; `vercel env add` reads the value from stdin.
    for (const [name, value] of [
      ["NEXT_PUBLIC_SALEOR_API_URL", endpoint],
      ["NEXT_PUBLIC_DEFAULT_CHANNEL", channel],
    ] as const) {
      spawnSync(
        "npx",
        ["--yes", VERCEL_PKG, "env", "rm", name, "production", "--yes"],
        { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env } },
      );
      spawnSync(
        "npx",
        ["--yes", VERCEL_PKG, "env", "add", name, "production"],
        { cwd: dir, encoding: "utf8", timeout: 120_000, input: value, env: { ...process.env } },
      );
    }
    // Write the store channel to the project `.env` so the local storefront and a
    // re-deploy read NEXT_PUBLIC_DEFAULT_CHANNEL with no key juggling (feature 029).
    writeEnvValues(projectDir(), { NEXT_PUBLIC_DEFAULT_CHANNEL: channel });
    // Confirm the deployed storefront actually serves before reporting completed
    // (mirrors the store readiness gate): a fresh production deployment can take a
    // moment to route. Poll the deployed URL, following the root redirect to the
    // channel home, until it answers within a budget; report the deployment as
    // still propagating otherwise, never a fabricated completion (feature 002).
    // Pre-flight before probing (feature 020 Rule "First-party hosts only"):
    // the GET goes only to the captured `*.vercel.app` URL from the Vercel
    // CLI's own output, or a first-party host; anything else is refused unsent.
    const deployedHost = deployedUrl ? new URL(deployedUrl).hostname : "";
    if (deployedUrl && (deployedHost.endsWith(".vercel.app") || isFirstPartyHost(deployedHost))) {
      const readinessDeadline = Date.now() + 180_000;
      let serving = false;
      while (Date.now() < readinessDeadline) {
        try {
          const response = await fetch(deployedUrl, { method: "GET", redirect: "follow" });
          if (response.status < 400) {
            serving = true;
            break;
          }
        } catch {
          // Not reachable yet; the deployment is still propagating.
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      checks.push({
        id: "deployed-storefront-serving",
        status: serving ? "pass" : "warning",
        description: cliMessage(
          serving
            ? "start.deploy.check.deployedStorefrontServing.pass"
            : "start.deploy.check.deployedStorefrontServing.warning",
          { deployedUrl },
        ),
      });
      if (!serving) {
        return {
          status: "blocked",
          data: { deploymentUrl: deployedUrl, storefrontUrl: deployedUrl },
        };
      }
    }
    return {
      status: "completed",
      data: deployedUrl ? { deploymentUrl: deployedUrl, storefrontUrl: deployedUrl } : {},
    };
  }

  const stderr = (deploy.stderr ?? "").toString().slice(0, 2000);
  checks.push({
    id: "vercel-deployed",
    status: "fail",
    description: cliMessage("start.deploy.check.vercelDeployed.cliExit", {
      status: deploy.status,
      stderr: stderr ? ` ${stderr}` : "",
    }),
    remediation: cliMessage("start.deploy.check.vercelDeployed.cliExit.remediation"),
  });
  return { status: "blocked" };
}

// Sane defaults for the interactive prompts, so pressing Enter always advances
// (feature 027). The storefront directory matches the storefront stage's clone
// target; the environment name is a stable jolly-namespaced default.
const DEFAULT_STOREFRONT_DIR = "storefront";
const DEFAULT_ENV_NAME = "jolly-store";

// Interactive discovery is TTY-gated and additive (feature 027): it runs only
// when stdin AND stdout are an interactive terminal and neither --json nor
// --yes/-y is set. With --json, --yes, or no TTY (the agent-driven subprocess),
// `jolly start` behaves exactly as the agent-first command does — no prompt, no
// blocking — so the agent path is unchanged.
/**
 * @planks("the user presses Enter at every prompt")
 * @planks("`jolly start --dry-run --yes` runs in an interactive terminal and receives no input")
 */
function shouldRunInteractive(args: ParsedArgs): boolean {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      !args.json &&
      !args.yes &&
      !args.quiet,
  );
}

// The organizations the configured token can reach, for the interactive org
// choice. --mock-organizations injects a deterministic list for the @logic
// scenarios (no network); otherwise the real Cloud API is queried, best-effort.
/**
 * @planks("the user presses Enter at every prompt")
 * @planks("each should fabricate a service response only when the harness guard is set")
 */
async function resolveInteractiveOrgs(
  args: ParsedArgs,
): Promise<CloudOrganization[]> {
  const mock = harnessGuardActive() ? args.options["mock-organizations"] : undefined;
  if (mock !== undefined) {
    const slugs = mock.length > 0 ? mock.split(",") : ["org-one", "org-two"];
    return slugs.map((slug) => ({ slug: slug.trim() }));
  }
  const token = cloudPlatformToken(loadEnvValues(projectDir()));
  if (!token) return [];
  try {
    return await listOrganizations(token);
  } catch {
    return [];
  }
}

// The organization's existing Saleor environments, for the interactive
// reuse-or-create store choice (feature 027). --mock-environments injects a
// deterministic comma-separated list for the @logic tier. Best-effort: no token
// / no org / a network error just yields an empty list (no picker, plain create).
/**
 * @planks("the user presses Enter at every prompt")
 * @planks("each should fabricate a service response only when the harness guard is set")
 */
async function resolveInteractiveEnvironments(
  args: ParsedArgs,
  organization: string | undefined,
): Promise<CloudEnvironment[]> {
  const mock = harnessGuardActive() ? args.options["mock-environments"] : undefined;
  if (mock !== undefined) {
    const names = mock.length > 0 ? mock.split(",") : [];
    return names.map((n) => ({ name: n.trim(), domain_label: n.trim() }));
  }
  if (!organization) return [];
  const token = cloudPlatformToken(loadEnvValues(projectDir()));
  if (!token) return [];
  try {
    return await listEnvironments(token, organization);
  } catch {
    return [];
  }
}

// Wrap a URL in an OSC 8 terminal hyperlink so terminals render it as a
// clickable link (feature 027). The visible text is the URL itself; the string
// terminator is BEL. Terminals without OSC 8 support show the visible text.
/**
 * @planks("the verification URL should be shown as a clickable terminal hyperlink, never a pasted-token prompt")
 */
function osc8Hyperlink(url: string): string {
  return `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
}

// A live setup-stage status list on stderr (feature 027): every stage listed by
// name, each carrying its own status glyph, with a stage's row redrawn in place
// as the run reaches it — not one fixed spinner. The list owns its region; each
// update moves the cursor back over the rows and erase-reprints them, so the
// same region is redrawn rather than appended. Only the interactive path renders
// it (the agent/--json path passes no reporter), keeping machine output clean.
// Plain-language descriptions shown beside the CURRENTLY-RUNNING stage so the
// progress says what it is doing (not a bare stage name), especially for the slow
// store/recipe/deploy stages (feature 027).
/**
 * @planks("the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read")
 */
const STAGE_DESCRIPTIONS: Record<string, string> = {
  init: cliMessage("start.stage.init"),
  auth: cliMessage("start.stage.auth"),
  store: cliMessage("start.stage.store"),
  storefront: cliMessage("start.stage.storefront"),
  recipe: cliMessage("start.stage.recipe"),
  stock: cliMessage("start.stage.stock"),
  deploy: cliMessage("start.stage.deploy"),
  stripe: cliMessage("start.stage.stripe"),
};

/**
 * @planks("the progress should redraw the same region in place rather than appending one line per update")
 * @planks("the interactive output should name the setup stage that was interrupted")
 * @planks("each setup stage should appear exactly once in the progress region")
 * @planks("no stage row should appear twice on screen")
 */
function stageProgress(
  stageNames: string[],
  descriptions: Record<string, string> = STAGE_DESCRIPTIONS,
): {
  start: (stage: string) => void;
  update: (stage: string, status: StageStatus) => void;
  interrupt: (stage: string) => void;
  stop: () => void;
} {
  const out = process.stderr;
  const colour = Boolean(out.isTTY) && !process.env["NO_COLOR"];
  const paint = (code: string, s: string): string => (colour ? `${code}${s}${SGR.reset}` : s);
  // The stages run via blocking spawnSync, so the event loop is frozen during a
  // stage's work — a spinner would not animate. Instead, the CURRENT stage shows
  // a static `▸ running` glyph (set before it executes), then ✓/✗ when it
  // resolves: an honest "here's where the run is" cursor, no fake animation.
  type StageVis = StageStatus | "running" | "interrupted";
  const statuses = new Map<string, StageVis>(stageNames.map((s) => [s, "pending" as StageVis]));
  const glyph = (status: StageVis): string => {
    switch (status) {
      case "completed":
        return paint(SGR.green, "✓");
      case "running":
        return paint(SGR.cyan, "▸");
      case "awaiting-approval":
        return paint(SGR.yellow, "◌");
      case "skipped":
        return paint(SGR.dim, "·");
      case "pending":
        return paint(SGR.dim, "○");
      default:
        return paint(SGR.red, "✗"); // blocked / error
    }
  };
  // The glyph already conveys completed/running/pending/skipped; only a wait or
  // a problem names itself, so the list reads as a clean checklist.
  const label = (s: string, status: StageVis): string => {
    if (status === "running" && descriptions[s]) return paint(SGR.dim, ` — ${descriptions[s]}`);
    if (status === "awaiting-approval") return paint(SGR.yellow, " — awaiting approval");
    if (status === "blocked" || status === "error" || status === "interrupted")
      return paint(SGR.red, ` — ${status}`);
    return "";
  };
  const row = (s: string): string => {
    const status = statuses.get(s)!;
    return `${glyph(status)} ${status === "pending" ? paint(SGR.dim, s) : s}${label(s, status)}`;
  };
  // Render lazily: write the initial frame on the FIRST update, not now. Any
  // bootstrap output (init/doctor) emitted before the first stage then PRECEDES
  // the frame instead of landing between it and the first redraw — which would
  // shift the cursor-up reference down a line and duplicate the first row. Once
  // the frame is drawn, per-stage subprocesses run captured, so nothing
  // interleaves and the in-place redraw stays anchored.
  let drawn = false;
  // A row wider than the terminal soft-wraps onto a second physical line, so the
  // cursor-up count runs short and the erase leaves the wrap remnant on screen.
  // Shorten each row to the terminal's own width instead, counting only the
  // glyphs that occupy a column: the SGR sequences carry colour, not width. One
  // column is left free because a row filling the last column advances the
  // cursor to the next line on its own, which the trailing newline then doubles.
  const fit = (s: string): string => {
    const width = (out.columns ?? 80) - 1;
    let visible = 0;
    let taken = "";
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === "\x1b") {
        const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(s.slice(i));
        if (match) {
          taken += match[0];
          i += match[0].length - 1;
          continue;
        }
      }
      if (visible >= width) return taken + SGR.reset;
      taken += s[i];
      visible += 1;
    }
    return taken;
  };
  const render = (): void => {
    if (!drawn) {
      // Start the region at column 0: whatever printed last may have left the
      // cursor mid-line, and a row begun there runs past the terminal's width
      // and wraps however short the row itself is.
      for (const s of stageNames) out.write(`\r${fit(row(s))}\r\n`);
      drawn = true;
      return;
    }
    out.write(`\x1b[${stageNames.length}A`);
    for (const s of stageNames) out.write(`\r\x1b[2K${fit(row(s))}\n`);
  };
  return {
    start: (stage) => {
      // Mark the stage running only while it is still pending (don't override a
      // resolved status, e.g. an already-satisfied skip).
      if (statuses.get(stage) === "pending") {
        statuses.set(stage, "running");
        render();
      }
    },
    update: (stage, status) => {
      if (!statuses.has(stage)) return;
      statuses.set(stage, status);
      render();
    },
    // The human interrupted this stage mid-run: redraw its row in place so the
    // stage that was running is named on the screen the human is left with, and
    // leave every later stage untouched (they never ran).
    interrupt: (stage) => {
      if (!statuses.has(stage)) return;
      statuses.set(stage, "interrupted");
      render();
    },
    stop: () => {},
  };
}

// The human-facing interactive `jolly start` (feature 027). Walks the human
// through only the decisions that cannot be safely inferred — each pre-filled
// with a default so Enter advances — previews the plan, announces the
// irreducible human gates, and confirms before any side-effecting stage. Built
// on Bombshell (@clack/prompts). Declining stops honestly: it runs the core with
// approval withheld, so downstream stages are pending/blocked, never fabricated.
/**
 * @planks("`jolly start --dry-run` runs in an interactive terminal with no flag beyond `--dry-run`")
 * @planks("`jolly start --dry-run` runs in an interactive terminal")
 * @planks("`jolly start` runs in an interactive terminal")
 * @planks("the user presses Enter at every prompt")
 * @planks("the user presses Ctrl-C while a setup stage is running")
 * @planks("the interactive output should state that setup was interrupted and did not complete")
 * @planks("the exit code should be non-zero")
 */
async function runInteractiveStart(args: ParsedArgs): Promise<Envelope> {
  clackIntro(cliMessage("start.intro"), CLACK_STDERR);

  // No Saleor Cloud authentication configured (feature 027 Rule "runs
  // end-to-end in one session" + feature 018): sign in inline through the Saleor
  // device authorization grant — the same grant as `jolly login`, never a pasted
  // secret — showing the user code + verification URL and continuing with the
  // acquired credentials, rather than reporting a blocked authentication stage
  // and exiting. Skipped under --dry-run (preview only; nothing is gathered or
  // written). A configured staff token or a stored device-grant access token
  // already satisfies auth, so the grant is skipped.
  if (!args.dryRun) {
    const env = loadEnvValues(projectDir());
    const existingAuth =
      env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
      process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
      env["JOLLY_SALEOR_ACCESS_TOKEN"] ??
      process.env["JOLLY_SALEOR_ACCESS_TOKEN"];
    if (!existingAuth) await interactiveDeviceGrantSignIn();
  }

  // Organization: prompt only when the token resolves more than one (feature
  // 012). With exactly one, use it without asking.
  const orgs = await resolveInteractiveOrgs(args);
  const availableOrganizations = orgs.map((o) => o.slug);
  let organization = args.options["organization"];
  let organizationPrompted = false;
  if (organization === undefined) {
    if (orgs.length > 1) {
      organizationPrompted = true;
      const choice = await clackSelect({
        message: cliMessage("start.prompt.organization"),
        options: orgs.map((o) => ({ value: o.slug, label: o.slug })),
        initialValue: orgs[0]!.slug,
        ...CLACK_STDERR,
      });
      if (clackIsCancel(choice)) return runStartCore({ ...args, yes: false });
      organization = String(choice);
      clackLog.info(cliMessage("start.usingOrg", { organization }), CLACK_STDERR);
    } else if (orgs.length === 1) {
      organization = orgs[0]!.slug;
      clackLog.info(cliMessage("start.usingOnlyOrg", { organization }), CLACK_STDERR);
    }
  }

  // Environment name and storefront project directory, each pre-filled. When a
  // store is already configured (a re-run resuming the remaining stages), the
  // store is reused — don't re-ask for an environment name that won't be used
  // (feature 027); just announce the reuse.
  const configuredStore = loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"];
  let envName: string | symbol = DEFAULT_ENV_NAME;
  if (configuredStore) {
    clackLog.info(
      cliMessage("start.reusingConfiguredStore", { storeUrl: configuredStore }),
      CLACK_STDERR,
    );
  } else {
    // Offer to reuse an existing store or create a new one. When the org already
    // holds environments — especially at the env limit, where a new one cannot be
    // created — the human picks from a list rather than getting a silent
    // name-match or a hard failure (feature 027).
    const existingEnvs = (await resolveInteractiveEnvironments(args, organization)).filter((e) =>
      environmentHost(e),
    );
    let reuseEndpoint: string | undefined;
    if (existingEnvs.length > 0) {
      const choice = await clackSelect({
        message: cliMessage("start.prompt.store"),
        options: [
          { value: "__new__", label: cliMessage("start.option.createStore") },
          ...existingEnvs.map((e) => ({
            value: environmentHost(e)!,
            label: cliMessage("start.option.reuseStore", {
              name: e.name ?? e.domain_label,
              url: environmentHost(e)!,
            }),
          })),
        ],
        initialValue: "__new__",
        ...CLACK_STDERR,
      });
      if (clackIsCancel(choice)) return runStartCore({ ...args, yes: false });
      if (choice !== "__new__") reuseEndpoint = `https://${String(choice)}/graphql/`;
    }
    if (reuseEndpoint) {
      // Record the reuse so the store stage reuses it (real runs only — a
      // dry-run previews the choice but writes nothing, feature 027).
      if (!args.dryRun) {
        writeEnvValues(
          projectDir(),
          { NEXT_PUBLIC_SALEOR_API_URL: reuseEndpoint },
        );
        // The store endpoint is now known: project the agent-facing surface.
        projectSaleorAgentEnv({ SALEOR_URL: reuseEndpoint });
      }
      clackLog.info(cliMessage("start.reusingStore", { storeUrl: reuseEndpoint }), CLACK_STDERR);
    } else {
      envName = await clackText({
        message: cliMessage("start.prompt.envName"),
        placeholder: DEFAULT_ENV_NAME,
        defaultValue: DEFAULT_ENV_NAME,
        ...CLACK_STDERR,
      });
      if (clackIsCancel(envName)) return runStartCore({ ...args, yes: false });
    }
  }
  const projectDirectory = await clackText({
    message: cliMessage("start.prompt.projectDir"),
    placeholder: DEFAULT_STOREFRONT_DIR,
    defaultValue: DEFAULT_STOREFRONT_DIR,
    ...CLACK_STDERR,
  });
  if (clackIsCancel(projectDirectory)) return runStartCore({ ...args, yes: false });

  // Preview the plan and announce the irreducible human gates Jolly cannot pass
  // for the user (feature 027 Rule).
  const plan = startPlan();
  // Preview only the side-effecting stages the human is approving; the internal
  // bootstrap stages (init, auth) are not human decisions, so they are omitted
  // from the plan note (feature 027).
  clackNote(
    plan
      .filter((s) => s.stage !== "init" && s.stage !== "auth")
      .map((s) => `${s.stage}: ${s.riskContext?.action ?? s.stage}`)
      .join("\n"),
    cliMessage("start.note.plannedStages"),
    CLACK_STDERR,
  );
  clackLog.info(cliMessage("start.vercelSignin"), CLACK_STDERR);
  clackLog.info(cliMessage("start.stripeFinal"), CLACK_STDERR);

  const resolved = {
    organization,
    availableOrganizations,
    organizationPrompted,
    environmentName: String(envName),
    projectDir: String(projectDirectory),
  };

  if (args.dryRun) {
    clackOutro(cliMessage("start.previewedPlan"), CLACK_STDERR);
    const preview = commandStartDryRun();
    // The interactive close is a concise human summary, not the machine check
    // enumeration or the agent `next:` playbook (feature 027): the prose summary
    // line stands alone. The per-check and next-step detail stays on the
    // --json/agent surface, which this human-only path never renders.
    return { ...preview, checks: [], nextSteps: [], data: { ...preview.data, resolved } };
  }

  // Each side-effecting stage is confirmed before it runs; the default is to
  // proceed, so Enter advances. Declining stops honestly.
  const proceed = await clackConfirm({
    message: cliMessage("start.proceed"),
    initialValue: true,
    ...CLACK_STDERR,
  });
  if (clackIsCancel(proceed) || proceed === false) {
    clackOutro(cliMessage("start.declined"), CLACK_STDERR);
    return runStartCore({ ...args, yes: false });
  }

  // Vercel sign-in is a human gate Jolly gathers up front (feature 027 Rule
  // "Interactive start runs end-to-end in one session"): with no Vercel CLI
  // session, run `npx vercel login` inline with the terminal passed through so
  // the human completes the device grant here and lets the CLI's session
  // establish — then the deploy stage proceeds unattended.
  const vercelSession = await probeVercelSession();
  if (!vercelSession.signedIn) {
    // Shows the device URL and WAITS for the human to approve it, so the deploy
    // stage that follows runs under a real session. A sign-in that never lands is
    // reported with the REASON it did not — never a bare "didn't complete" that
    // leaves the human with nothing to act on; the run continues and the deploy
    // stage surfaces a fresh clickable sign-in link.
    const signIn = await runInteractiveVercelSignIn();
    if (!signIn.ok) {
      clackLog.warn(signIn.message, CLACK_STDERR);
    }
  }

  // Run the long setup stages behind a live, per-stage status list on stderr:
  // every stage listed by name, each carrying its own status that updates in
  // place as the run reaches it — not one fixed spinner (feature 027). stdout
  // stays reserved for the final result summary emit() prints (feature 020).
  const progress = stageProgress(plan.map((s) => s.stage));

  // Ctrl-C during the unattended stages (feature 027). @clack puts the terminal
  // in raw mode to read its prompts, and raw mode disables the driver's signal
  // characters, so a Ctrl-C after the last prompt arrives as a stray byte and the
  // run carries on to its last stage as if nothing happened. The prompts are done
  // here, so hand the terminal back to cooked mode and the driver turns Ctrl-C
  // into SIGINT for this process again.
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  const resolvedStages = new Map<string, StageStatus>();
  let runningStage: string | undefined;
  const onInterrupt = (): void => {
    if (runningStage) progress.interrupt(runningStage);
    // The stages that never finished, so the close names them rather than
    // claiming a run that stopped part-way through completed.
    const unfinished = plan
      .map((s) => s.stage)
      .filter((s) => {
        const status = resolvedStages.get(s);
        return status !== "completed" && status !== "skipped";
      });
    // The prompt and progress regions hide the cursor while they redraw; restore
    // it before exiting, or the human's shell is left with an invisible cursor.
    process.stderr.write("\x1b[?25h");
    process.stderr.write(
      cliMessage("start.close.notFinished", {
        stages: unfinished.join(", "),
        stageWord:
          unfinished.length > 1
            ? cliMessage("start.close.stageWord.plural")
            : cliMessage("start.close.stageWord.singular"),
        reasons: "",
      }) + "\n",
    );
    // 128 + SIGINT, the shell convention for a process killed by Ctrl-C.
    process.exit(130);
  };
  process.on("SIGINT", onInterrupt);

  try {
    const core = await runStartCore(
      {
        ...args,
        yes: true,
        options: {
          ...args.options,
          ...(organization ? { organization } : {}),
          name: resolved.environmentName,
          "domain-label": resolved.environmentName,
        },
      },
      (stage, status) => {
        resolvedStages.set(stage, status);
        if (runningStage === stage) runningStage = undefined;
        progress.update(stage, status);
      },
      (stage) => {
        runningStage = stage;
        progress.start(stage);
      },
    );

    // The completed interactive run closes with a concise human summary, not the
    // machine check enumeration or the agent `next:` playbook (feature 027): a
    // single prose line that names the live store's Saleor Dashboard and
    // deployed storefront URLs plus the human's remaining Stripe-keys step, OR,
    // when a side-effecting stage genuinely failed, reports that failure
    // honestly rather than fabricating success. The per-check and next-step
    // detail stays on the --json/agent surface, which this human-only path never
    // renders, so the run's status (success/warning) is preserved unchanged.
    const endpoint =
      loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"] ??
      process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    return interactiveCloseSummary(core, {
      endpoint,
      stripeStep: cliMessage("start.stripeFinal"),
      // The interactive close is a TTY; make the store URLs clickable (OSC 8),
      // matching the sign-in link. Plain text when not a TTY or NO_COLOR is set.
      link: process.stderr.isTTY && !process.env["NO_COLOR"] ? osc8Hyperlink : undefined,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    progress.stop();
  }
}

/**
 * @planks("the agent runs `jolly start --json` with no store URL")
 * @planks("running `jolly start --yes` should pre-approve and proceed through the high-risk stages without per-stage pauses, still emitting each `riskContext` for the record")
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("`jolly start --dry-run` runs in an interactive terminal with no flag beyond `--dry-run`")
 * @planks("`jolly start --dry-run` runs in an interactive terminal")
 * @planks("`jolly start` runs in an interactive terminal")
 */
async function commandStart(args: ParsedArgs): Promise<Envelope> {
  if (shouldRunInteractive(args)) return runInteractiveStart(args);
  if (args.dryRun) return commandStartDryRun();
  return runStartCore(args);
}

/**
 * A start stage's executor. `jolly start` composes these — the same seams the
 * narrow `jolly <stage>` commands run. Injectable so the orchestration's
 * composition (call order, gates, state hand-off) is verifiable with recording
 * spies, without running the real heavy stages (feature 029): the stages'
 * behaviour is proven by their own command scenarios.
 */
export type StageRunner = (checks: Check[], args: ParsedArgs) => Promise<StageOutcome>;

/**
 * @planks("the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read")
 */
const DEFAULT_STAGE_RUNNERS: Record<string, StageRunner> = {
  store: (checks, args) => {
    const nameOpt = args.options["name"];
    const domainOpt = args.options["domain-label"];
    return runStoreStage(checks, {
      name: typeof nameOpt === "string" ? nameOpt : undefined,
      domainLabel: typeof domainOpt === "string" ? domainOpt : undefined,
    });
  },
  // `jolly start` is resumable (feature 022): its recipe and deploy stages
  // detect already-completed work and skip it, while the standalone commands
  // keep their always-execute semantics.
  recipe: (checks) => runRecipeStage(checks, { resume: true }).then((status) => ({ status })),
  stock: (checks) => runStockStage(checks),
  storefront: (checks) => runStorefrontStage(checks).then((status) => ({ status })),
  stripe: (checks) => runStripeStage(checks).then((status) => ({ status })),
  deploy: (checks) => runDeployStage(checks, { resume: true }),
};

/**
 * Orchestrate `jolly start`: run each stage in order, report only the stages
 * actually performed, and carry the per-stage plan of intended effects.
 *
 * @planks("the agent runs `jolly start --json` with no store URL")
 * @planks("running `jolly start --yes` should pre-approve and proceed through the high-risk stages without per-stage pauses, still emitting each `riskContext` for the record")
 * @planks("the agent runs `jolly start --dry-run --json`")
 * @planks("it should perform and report only the stages it actually completed \(the local bootstrap — skills, scaffold, doctor)")
 * @planks("the data should include a per-stage plan of intended effects: directories created, files written, network hosts contacted, and repositories cloned")
 * @planks("the agent runs `jolly start` again")
 * @planks("the run should report only outcomes it actually achieved, stopping honestly at any remaining human gate without fabricating success")
 * @planks("the composition of the store, recipe, and storefront stages is observed")
 * @planks(`the `store` stage should report "completed" only once the endpoint answers a live GraphQL probe`)
 * @planks(`the `store` stage status should be "blocked", not "completed"`)
 * @planks("the remediation should tell the human the store may still be starting up and to re-run `jolly start`")
 * @planks("the storefront preparation should be launched before the store stage completes")
 * @planks("the deploy stage should be launched only after both the storefront preparation and the recipe stage complete")
 * @planks("each side-effecting stage in the plan should carry a feature {int} riskContext")
 * @planks("the closing summary on stdout should name the storefront stage as failed")
 */
export async function runStartCore(
  args: ParsedArgs,
  onStage?: (stage: string, status: StageStatus) => void,
  onStageStart?: (stage: string) => void,
  stageRunners: Record<string, StageRunner> = DEFAULT_STAGE_RUNNERS,
): Promise<Envelope> {
  const command = "start";

  // Bootstrap: run init (real, on-disk) + run doctor (read-only). Never
  // fabricate stages the agent must perform.
  const initEnv = commandInit(args);
  const doctorEnv = await commandDoctor({
    ...args,
    positionals: ["doctor"],
    json: true,
    dryRun: false,
  });

  const checks: Check[] = [
    ...initEnv.checks.map((c) => ({ ...c, id: `init-${c.id}` })),
    ...doctorEnv.checks.map((c) => ({ ...c, id: `doctor-${c.id}` })),
  ];

  // Bootstrap is best-effort: the local scaffold (mcp-graphql config, AGENTS.md
  // guidance) is what start must produce to proceed. Skill installs go over the
  // network via `npx skills add` and may not be reachable in every environment;
  // a skill-install failure is surfaced as a check, not a fatal bootstrap error
  // that would block the agent at the orchestration gate. Bootstrap is only
  // "failed" when the local scaffold itself could not be written.
  const localScaffoldOk =
    initEnv.checks.find((c) => c.id === "mcp-config")?.status === "pass" &&
    initEnv.checks.find((c) => c.id === "agents-md")?.status === "pass";
  const bootstrapFailed = !localScaffoldOk;

  // The orchestrated stage list, built from the single plan source so each
  // stage's riskContext is identical to its --dry-run preview. Bootstrap-class
  // stages (init, auth) Jolly actually performed are "completed"; downstream
  // stages are never "completed" unless actually performed.
  const plan = startPlan();
  const stages: StartStage[] = [];
  let gate: { stage: string; reason: string } | undefined;
  // The provisioned store's URLs (graphql/dashboard), surfaced into the run
  // envelope `data` when the store stage auto-provisioned (feature 002).
  let storeData: Record<string, unknown> | undefined;
  // The deployed storefront URL, surfaced into `data` when the Vercel deploy
  // stage completed (feature 002).
  let deployData: Record<string, unknown> | undefined;
  // Set once the run reaches (executes) the Stripe stage, so the keys + channel
  // human gate is announced regardless of whether appInstall succeeded.
  let stripeStageReached = false;

  // `.env`-first Cloud-token presence (feature 002): a real agent leaves the
  // token in the project `.env`; it may also be exported. When NEITHER carries a
  // token, the auth stage cannot silently complete — it reports the token is
  // needed (a gate it cannot self-clear), token-only with no browser flow.
  const startEnvValues = loadEnvValues(projectDir());
  const hasCloudToken = Boolean(cloudPlatformToken(startEnvValues));
  let needsToken = !hasCloudToken;
  // When the agent device grant is pending, the clickable verification URL the
  // human must approve, surfaced in the run's nextSteps (feature 018).
  let authPendingStep: NextStep | undefined;
  // When the Vercel sign-in is pending, the clickable verification URL the human
  // must approve, surfaced in the run's nextSteps (feature 002).
  let deployPendingStep: NextStep | undefined;
  // The credential-independent storefront preparation (spawned `git` clone +
  // `pnpm` install) is launched concurrently with the slow Saleor Cloud store
  // stage on the `--yes` agent path, then joined at its own plan position, so it
  // overlaps the store cold-start rather than serializing behind it (feature 002
  // Rule "Concurrent stage preparation is observable in the run envelope").
  let storefrontPromise: Promise<StageOutcome> | undefined;
  let storefrontStartedAt: number | undefined;
  let storefrontFinishedAt: number | undefined;

  // A store endpoint already configured (a prior `jolly create store` or earlier
  // run) means the store stage is already satisfied: no store would be created
  // this run, so it is announced as satisfied and never re-presented as a pending
  // approval gate (feature 022 Rule).
  const storeEndpoint =
    startEnvValues["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"];

  for (const planStage of plan) {
    // Mark the stage running before it executes, so the interactive progress
    // shows where the run currently is (the stage's resolved status follows).
    onStageStart?.(planStage.stage);
    // The reported start time of this stage's execution (epoch ms). The
    // storefront stage overrides it below with the earlier time it was launched
    // concurrently with the store stage.
    let stageStartedAt = Date.now();
    const isBootstrap = planStage.stage === "init" || planStage.stage === "auth";
    const isHighRisk = (HIGH_RISK_STAGES as readonly string[]).includes(planStage.stage);
    // The riskContext surfaced for this stage; rewritten below for an
    // already-satisfied store so it carries no high-risk approval categories.
    let stageRiskContext = planStage.riskContext;

    let status: StageStatus;
    if (bootstrapFailed) {
      // Bootstrap itself failed; nothing downstream was attempted.
      status = isBootstrap && planStage.stage === "init" ? "error" : "pending";
    } else if (planStage.stage === "auth" && needsToken) {
      // No Cloud token configured: the auth stage drives the Saleor device
      // authorization grant for the agent (feature 018, 002). It relays the URL
      // to STDERR and blocks polling until the human authorizes in their browser,
      // so this same run continues authenticated. The code + URL stay on STDERR
      // ONLY — never in the stdout envelope.
      //   - approved → store the session and mark `completed`;
      //   - lifetime elapsed without approval → `blocked` (re-run jolly start) —
      //     never a fabricated `completed`, and never the high-risk approval gate.
      // A device-code request failure leaves the stage `blocked` just the same.
      const outcome = await agentDeviceGrant().catch(() => undefined);
      if (outcome?.status === "approved") {
        writeEnvValues(projectDir(), {
          JOLLY_SALEOR_ACCESS_TOKEN: outcome.tokens.accessToken,
          JOLLY_SALEOR_REFRESH_TOKEN: outcome.tokens.refreshToken,
        });
        // Mirror into process.env so the downstream store/recipe/deploy stages
        // of THIS run read the fresh session (matching the interactive path).
        process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = outcome.tokens.accessToken;
        process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = outcome.tokens.refreshToken;
        // Project the fresh access token into the agent-facing SALEOR_TOKEN.
        projectSaleorAgentEnv();
        needsToken = false;
        status = "completed";
      } else {
        // Pending (or a device-code request failure): the stage is blocked. When
        // pending, carry the clickable verification URL to the run's nextSteps so
        // the agent can hand it to the human, who approves then re-runs.
        status = "blocked";
        if (outcome?.status === "pending") {
          authPendingStep = deviceAuthNextStep(outcome.auth, "jolly start");
        }
      }
    } else if (isBootstrap) {
      status = "completed";
    } else if (planStage.stage === "store" && storeEndpoint) {
      // Already satisfied: a store endpoint is configured, so no store would be
      // created this run. The gate keys on the endpoint + a usable session, not
      // on any per-store token — so this always takes the lightweight skip. It
      // still reprojects the agent-facing surface (SALEOR_URL + a freshly
      // resolved SALEOR_TOKEN) so the resume's downstream recipe/stock stages and
      // configurator/curl/MCP never read a stale or missing store token.
      //
      // A resolved store can still be inside its cold-start window (e.g. it was
      // provisioned moments ago and recorded in .env), answering 404/5xx/refused
      // until its instance stands up. The stage reports `completed` only once
      // the endpoint answers a live GraphQL readiness probe (feature 002) — the
      // same bounded gate a fresh provision waits on in provisionStore, with the
      // same env-tunable budget/poll — so the downstream recipe/stock stages
      // never run against a cold endpoint. An endpoint that never answers within
      // the budget leaves the stage `blocked` honestly, never a fabricated
      // completion.
      const readinessBudgetMs = resolveReadinessBudgetMs();
      const readinessPollMs = readPositiveIntEnvMs("JOLLY_READINESS_POLL_MS", 5_000);
      const readinessDeadline = Date.now() + readinessBudgetMs;
      let endpointAnswered = true;
      while ((await probeEndpointConnectivity(storeEndpoint)).kind !== "reachable") {
        if (Date.now() >= readinessDeadline) {
          endpointAnswered = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, readinessPollMs));
      }
      if (endpointAnswered) {
        projectSaleorAgentEnv({ SALEOR_URL: storeEndpoint });
        // Announced as satisfied (feature 022 Rule), never a pending approval gate —
        // the riskContext drops to the no-category skip preview the dry-run shows
        // (commandStartDryRun), and no gate is set.
        status = "completed";
        // Surface the configured store's URLs in `data.store` (feature 002/022) so a
        // resumed run still hands the agent the Saleor Dashboard link for the
        // remaining human Dashboard step — same shape a fresh provision emits.
        storeData = storeDataFromEndpoint(storeEndpoint);
      } else {
        // The resolved endpoint never answered within the readiness budget: it
        // may still be inside its cold-start window. Block honestly and carry
        // the same store-provisioned remediation a fresh provision emits when
        // its endpoint times out (runStoreStage) — telling the human the store
        // may still be starting up and to re-run `jolly start`, never a
        // fabricated completion.
        checks.push({
          id: "store-provisioned",
          status: "fail",
          description: cliMessage("doctor.check.saleorEndpoint.unknown"),
          remediation: cliMessage("start.store.check.storeProvisioned.fail.remediation"),
        });
        status = "blocked";
      }
      stageRiskContext = {
        action: cliMessage("riskContext.action.skipStore"),
        target: cliMessage("riskContext.target.skipStore", { storeEndpoint }),
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          cliMessage("riskContext.sideEffect.skipStore.satisfied", { storeEndpoint }),
        ],
        dryRunAvailable: true,
      };
    } else if (isHighRisk && !gate) {
      // First high-risk stage reached: without --yes we PAUSE for the agent's
      // approval (emitting the riskContext, never self-approving). With --yes
      // it is pre-approved and would proceed (and fail at the network layer
      // under the unroutable logic-safe base — which is fine, just not a gate).
      if (args.yes) {
        // With --yes (pre-approved) and the gate unset, the high-risk stages
        // genuinely execute through their seam runner, each reported honestly
        // (`completed` only when the real work succeeded, never fabricated): the
        // store stage auto-provisions a Saleor Cloud environment when none is
        // configured (feature 002), the recipe stage spawns `npx @saleor/configurator
        // deploy` of the starter recipe, and the deploy stage spawns `npx vercel`.
        const runner = stageRunners[planStage.stage];
        if (runner) {
          // Launch the store stage first so it yields at its first Cloud API
          // await, then kick off the credential-independent storefront
          // preparation concurrently, so the spawned `git` clone + `pnpm`
          // install overlap the slow store cold-start rather than serializing
          // behind it (feature 002 Rule "Concurrent stage preparation").
          const runnerPromise = runner(checks, args);
          if (
            planStage.stage === "store" &&
            !storefrontPromise &&
            stageRunners["storefront"]
          ) {
            storefrontStartedAt = Date.now();
            storefrontPromise = stageRunners["storefront"](checks, args).then((outcome) => {
              storefrontFinishedAt = Date.now();
              return outcome;
            });
          }
          const outcome = await runnerPromise;
          status = outcome.status;
          if (planStage.stage === "store") {
            storeData = outcome.data;
          } else if (planStage.stage === "deploy") {
            deployData = outcome.data;
            const vercelUrl = outcome.data?.["vercelSignInUrl"];
            if (typeof vercelUrl === "string" && vercelUrl.length > 0) {
              deployPendingStep = vercelSignInNextStep(vercelUrl, "jolly start --yes");
            }
          }
        } else {
          status = "pending";
        }
      } else {
        status = "awaiting-approval";
        gate = {
          stage: planStage.stage,
          reason: "Approve this high-risk stage before Jolly performs it.",
        };
      }
    } else if (planStage.stage === "storefront" && !gate) {
      // The storefront stage genuinely executes (fifth convergence): Jolly
      // spawns `git` to clone Paper from `main` into storefront/, strips the
      // upstream `.git`, `git init`s a fresh repo, and spawns `pnpm install`.
      // It is not high-risk (like stock) — it executes when the run reaches it
      // (gate unset, i.e. the store gate before it was pre-approved with --yes).
      // Reported honestly: `completed` only on a real clone+install; `blocked`
      // otherwise — never a fabricated completion. Idempotent (feature 022).
      // On the `--yes` path it was already launched concurrently with the store
      // stage; join that in-flight preparation here and report its real start
      // and finish time so the overlap is observable in the run envelope
      // (feature 002 Rule "Concurrent stage preparation").
      //
      // An unexpected storefront-stage throw (e.g. a malformed
      // storefront/package.json) is a genuine stage failure: the run records it
      // honestly as an `error` stage, with the thrown message as its failing
      // check, and carries on to the honest close naming the stage — never a
      // crash past the close (feature 027 "A failed setup stage closes
      // honestly"). The narrow `jolly storefront` command path keeps the raw
      // throw — feature 020 pins its top-level UNEXPECTED_ERROR envelope.
      try {
        status = (await (storefrontPromise ?? stageRunners["storefront"](checks, args))).status;
      } catch (err) {
        status = "error";
        checks.push({
          id: "storefront-prepared",
          status: "fail",
          description: err instanceof Error ? err.message : String(err),
        });
      }
      if (storefrontStartedAt !== undefined) {
        stageStartedAt = storefrontStartedAt;
      }
    } else if (planStage.stage === "stock" && !gate) {
      // The stock stage is the FIRST genuinely-executing `jolly start` stage
      // (decision 2026-06-14, MVP sequencing): @saleor/configurator cannot make
      // products buyable, so Jolly seeds real stock itself via Saleor GraphQL.
      // It only EXECUTES when the run actually reaches it (gate unset — i.e.
      // the high-risk stages before it were pre-approved with --yes); otherwise
      // it stays pending behind the gate. Reported honestly: `completed` only
      // when stock was actually seeded against real recipe variants; `blocked`
      // (with an explaining check) when there are no variants/warehouse yet or
      // the store is unreachable — never a fabricated completion.
      status = (await stageRunners["stock"](checks, args)).status;
    } else if (planStage.stage === "stripe" && !gate) {
      // The Stripe app-install stage is the SECOND genuinely-executing `jolly
      // start` stage (decision 2026-06-14, MVP sequencing): Jolly's own Saleor
      // GraphQL appInstall, authenticated with the Cloud staff token. It only
      // EXECUTES when the run actually reaches it (gate unset — the high-risk
      // stages before it were pre-approved with --yes); otherwise it stays
      // pending behind the gate. Reported honestly: `completed` only when the
      // app was actually installed/reused; `blocked` (with an explaining check)
      // when the endpoint/token is missing or the install failed — never a
      // fabricated install. The keys + `us`-channel mapping stay a human gate
      // announced below whenever the stage was reached.
      stripeStageReached = true;
      status = (await stageRunners["stripe"](checks, args)).status;
    } else {
      status = "pending";
    }

    // The storefront stage reports the real completion time of its concurrently
    // launched preparation; every other stage finishes when its execution
    // returns here.
    const stageFinishedAt =
      planStage.stage === "storefront" && storefrontFinishedAt !== undefined
        ? storefrontFinishedAt
        : Date.now();
    stages.push({
      stage: planStage.stage,
      status,
      startedAt: stageStartedAt,
      finishedAt: stageFinishedAt,
      ...(stageRiskContext ? { riskContext: stageRiskContext } : {}),
    });
    // Report this stage's resolved status so the interactive caller can update
    // its live per-stage status list in place as the run reaches each stage
    // (feature 027). The agent/--json path passes no reporter, so machine output
    // stays clean.
    onStage?.(planStage.stage, status);
  }

  // The store stage may have just written NEXT_PUBLIC_SALEOR_API_URL. Re-merge
  // .mcp.json so its mcp-graphql ENDPOINT points at the provisioned store on
  // THIS pass — `commandInit` merged it during bootstrap (before the store
  // stage), so without this the entry keeps the init-time placeholder until a
  // re-run (feature 019 "live store access from the moment setup completes").
  const postStageEnvValues = loadEnvValues(projectDir());
  if (postStageEnvValues["NEXT_PUBLIC_SALEOR_API_URL"]) {
    mergeMcpJson();
  }

  // A run that drove every side-effecting stage to completion — the store is
  // provisioned, configured, and DEPLOYED (live) — is a SUCCESS, even though
  // the human's remaining Stripe-keys Dashboard step is surfaced as a nextStep
  // (a known human gate, not a failure). A failed local bootstrap is "error";
  // anything paused at a gate or with a blocked/pending side-effecting stage is
  // "warning" — never a fabricated success.
  const SIDE_EFFECTING_STAGES = ["store", "storefront", "recipe", "stock", "deploy", "stripe"];
  const allStagesDone = stages.every(
    (s) => !SIDE_EFFECTING_STAGES.includes(s.stage) || s.status === "completed",
  );

  // Doctor ran during bootstrap, before any stage executed, so its checks
  // (store endpoint/token, storefront presence, deployment status, and so on)
  // describe pre-provisioning state. Re-run it now that the stages have
  // executed and replace the stale `doctor-*` checks with the fresh read, so a
  // completed run's checks never contradict the run's own success with a
  // check that describes state from before the run created it (feature
  // 001/020 no-fabrication invariant applies both ways: no fabricated
  // success, no stale failure either). This only matters for a run that is
  // about to report `success` (`allStagesDone`) — a paused/blocked/pending run
  // never claims success, so its bootstrap-time doctor checks are not stale in
  // a way that contradicts the envelope. Skipping the re-probe otherwise avoids
  // piling a second full live-network doctor sweep (Cloud API, Saleor
  // connectivity/purchasability, Vercel `whoami`, a live Stripe checkout
  // probe) onto every mid-flow re-run (e.g. one still waiting on a human
  // sign-in gate), which could push an already-long real end-to-end run past
  // its time budget for no observable benefit.
  if (allStagesDone && !bootstrapFailed) {
    const finalDoctorEnv = await commandDoctor({
      ...args,
      positionals: ["doctor"],
      json: true,
      dryRun: false,
    });
    const nonDoctorChecks = checks.filter((c) => !c.id.startsWith("doctor-"));
    checks.length = 0;
    checks.push(
      ...nonDoctorChecks,
      ...finalDoctorEnv.checks.map((c) => ({ ...c, id: `doctor-${c.id}` })),
    );
  }
  const status: EnvelopeStatus = bootstrapFailed
    ? "error"
    : allStagesDone && !checks.some((c) => c.status === "fail")
      ? "success"
      : "warning";

  const nextSteps: NextStep[] = [];
  if (authPendingStep) {
    // Lead with the clickable sign-in URL (the real blocker the human clears
    // first); the gate/resume step below is still added so the run's gate stays
    // named.
    nextSteps.push(authPendingStep);
  } else if (deployPendingStep) {
    // Vercel sign-in is the blocker: lead with the clickable Vercel URL.
    nextSteps.push(deployPendingStep);
  }
  if (bootstrapFailed) {
    nextSteps.push({
      description: cliMessage("start.next.resolveBootstrapFailure"),
      command: "jolly start",
    });
  } else if (gate) {
    nextSteps.push({
      description: cliMessage("start.next.approveStage", { stage: gate.stage }),
      command: "jolly start --yes",
    });
  } else if (nextSteps.length === 0) {
    nextSteps.push({
      description: cliMessage("start.next.resumeStages"),
      command: "jolly start",
    });
  }

  // No Cloud token configured (feature 002): direct the user to sign in with
  // `jolly login` through the Saleor device authorization grant (feature 018), or
  // to set JOLLY_SALEOR_CLOUD_TOKEN for non-interactive use, then re-run. An auth
  // gate Jolly cannot self-clear, never fabricated as done.
  if (needsToken && !authPendingStep) {
    nextSteps.push({
      description: cliMessage("start.next.runLoginOrSetToken"),
      command: "jolly login",
    });
  }

  // Whenever the Stripe stage was reached (executed) — regardless of whether
  // appInstall succeeded — announce the keys + `us`-channel mapping human gate
  // (feature 005 Rule): paste the publishable + restricted keys into the
  // installed Stripe app's Dashboard config and map the configuration to the
  // `us` channel. Keys referenced by name only — never printed. This step has
  // no stable public API, so it stays a guided human gate Jolly does not perform.
  if (stripeStageReached) {
    nextSteps.push(stripeKeysChannelGateStep());
  }

  // On a fully completed run, orient the agent to what setup left on disk so it
  // can hand the human a clear "keep building" map (feature 002): the
  // `storefront/` repo and `recipe.yml`, each with the skill/CLI that drives it,
  // and reference links. Success-only — these artifacts exist once every
  // side-effecting stage actually ran, so it never fires on a paused/blocked run.
  if (allStagesDone && !bootstrapFailed) {
    nextSteps.push({
      description: cliMessage("start.next.keepBuilding"),
    });
  }

  // Human-run FALLBACK (feature 002 Rule "Human-runnable `jolly start` is the
  // backup path"): whenever this run could not run to completion (status
  // `warning` — paused at a gate, or with blocked/failed downstream stages),
  // offer to ask the human to run `jolly start` in a plain shell, the natural
  // way to clear the irreducibly-interactive gate (new account creation) a
  // non-TTY agent cannot pass — the Vercel sign-in is Jolly's own to run. Then
  // they start their agent in that project to iterate — the skills jolly init
  // installed are already on disk. Offered, never fabricated as performed.
  if (!bootstrapFailed) {
    nextSteps.push({
      description: cliMessage("start.next.interactiveGateFallback"),
      command: "jolly start",
    });
  }

  // On a fully completed run, LEAD the nextSteps with a strong, unmissable
  // restart directive (unshifted to the front): the installed skills only
  // register on a fresh agent session, and Jolly's own exit guidance drifts out
  // of context as work continues — so a restart is required, not optional, for
  // everything else to take effect. Success-only — these artifacts and skills
  // exist once every side-effecting stage ran.
  if (allStagesDone && !bootstrapFailed) {
    nextSteps.unshift({
      description: cliMessage("start.next.restartAgent"),
    });
  }

  const firstBlockedStage = stages.find((s) => s.status === "blocked")?.stage;
  return envelope({
    command,
    status,
    summary: bootstrapFailed
      ? cliMessage("start.summary.bootstrapFailed")
      : gate
        ? cliMessage("start.summary.pausedForApproval", { stage: gate.stage })
        : firstBlockedStage
          ? cliMessage("start.summary.blockedAtStage", { firstBlockedStage })
          : cliMessage("start.summary.proceeding"),
    data: {
      bootstrap: {
        skillsInstalled: initEnv.checks
          .filter((c) => c.id.startsWith("skill-"))
          .every((c) => c.status === "pass"),
        mcpMerged: initEnv.checks.find((c) => c.id === "mcp-config")?.status === "pass",
        agentsMdMerged: initEnv.checks.find((c) => c.id === "agents-md")?.status === "pass",
        doctorRan: true,
      },
      stages,
      ...(storeData ? { store: storeData } : {}),
      ...(deployData ? { deploy: deployData } : {}),
      // The ordered playbook of the orchestrated stages (the official CLIs
      // Jolly spawns and the gates it waits at), for agents/readers that want a
      // flat narrative alongside the structured stage list.
      playbook: plan.map((s) => {
        const rc = s.riskContext;
        return rc ? `${s.stage}: ${rc.action}` : s.stage;
      }),
      ...(gate ? { gate } : {}),
    },
    checks,
    nextSteps,
    errors: bootstrapFailed ? initEnv.errors : [],
  });
}

// ─── top-level help ───────────────────────────────────────────────────────

// The one declared top-level command surface every command site derives from
// (feature command-surface-consistency): the completion registration, the help
// command data, the dispatch cases, and the unknown-command remediation are each
// joined against this declaration by the structural conformance check. It names
// every top-level command a user may invoke, the feature 029 stage commands
// included; the no-argument default and `complete` stay off it.
/**
 * @planks("the command surface Jolly declares")
 */
export const COMMAND_SURFACE = [
  "help",
  "login",
  "logout",
  "auth",
  "init",
  "start",
  "create",
  "storefront",
  "recipe",
  "stock",
  "stripe",
  "deploy",
  "doctor",
  "upgrade",
  "skills",
  "completion",
] as const;

/**
 * @planks("the agent inspects `jolly --help`")
 * @planks("the agent runs `jolly --help`")
 */
function commandHelp(): Envelope {
  return envelope({
    command: "help",
    status: "success",
    summary: cliMessage("help.summary.success"),
    data: {
      commands: [
        "help",
        "login",
        "logout",
        "auth",
        "init",
        "start",
        "create",
        "storefront",
        "recipe",
        "stock",
        "stripe",
        "deploy",
        "doctor",
        "upgrade",
        "skills",
        "completion",
      ],
      globalFlags: ["--json", "--quiet", "--yes/-y", "--dry-run"],
    },
    nextSteps: [
      {
        description: cliMessage("help.next"),
        command: "jolly start",
      },
    ],
  });
}

// ─── dispatch ─────────────────────────────────────────────────────────────

// `--help` for any command/subcommand prints a usage summary naming the command
// and its flags and exits successfully — never entering the command's flow. Bare
// `jolly --help`/`jolly help` keep the full command listing (commandHelp); bare
// `jolly create --help` keeps its subcommand listing (handled in commandCreate).
/**
 * @planks("^the agent runs `jolly (.+) --help`$")
 */
function commandUsage(args: ParsedArgs): Envelope {
  const path = args.positionals.join(" ");
  const flags = ["--json", "--quiet", "--yes", "--dry-run", "--help"];
  const usage = `jolly ${path} [${flags.join("] [")}]`;
  return envelope({
    command: `${path} --help`,
    status: "success",
    summary: cliMessage("cli.usage.summary.success", { usage }),
    data: { usage, command: path, flags },
  });
}

// ─── Composable stage commands (feature 029) ────────────────────────────────

// Run exactly one side-effecting stage as its own first-class `jolly` command,
// against already-prepared preconditions, never the `jolly start` pipeline.
// Calls the stage seam directly, so it bypasses the orchestrator and its
// approval gate, and emits an envelope whose `data.stages` holds exactly the one
// {stage, status} the command ran. `jolly start` still composes these same seams
// in order and is unchanged.
/**
 * @planks("the agent runs `jolly recipe --yes --json` to apply the starter recipe to Saleor Cloud")
 * @planks("the agent runs `jolly deploy` without `--dry-run`")
 * @planks("Jolly should itself spawn `npx vercel@latest login` and surface its device-authorization URL before attempting any deploy")
 * @planks('the nextStep should instruct the human to open the URL, approve it, reply "done", and re-run `jolly deploy` to continue, the same pause-and-resume contract as the Saleor sign-in gate')
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function commandStage(
  stage: string,
  run: (checks: Check[]) => Promise<StageOutcome>,
): Promise<Envelope> {
  const checks: Check[] = [];
  const outcome = await run(checks);
  const status: EnvelopeStatus =
    outcome.status === "completed"
      ? "success"
      : outcome.status === "error"
        ? "error"
        : "warning";
  // Whenever the Stripe stage runs — via `jolly stripe` here or `jolly start`'s
  // orchestration — the run announces the keys + `us`-channel Dashboard gate the
  // human must clear (feature 005 Rule; shared with runStartCore so the two entry
  // points cannot drift). Announced whether the install completed or blocked: the
  // gate is the stage's remaining human step, not contingent on the install.
  const nextSteps: NextStep[] = stage === "stripe" ? [stripeKeysChannelGateStep()] : [];
  // The composable `jolly deploy` command reaches the same Vercel sign-in gate as
  // `jolly start`'s deploy stage (feature 002): with no Vercel session Jolly spawns
  // the sign-in itself and surfaces its device URL. Since `jolly deploy` is the
  // command that reached the gate, its pending sign-in nextStep resumes by
  // re-running `jolly deploy`, never `jolly start`.
  if (stage === "deploy") {
    const vercelUrl = outcome.data?.["vercelSignInUrl"];
    if (typeof vercelUrl === "string" && vercelUrl.length > 0) {
      nextSteps.push(vercelSignInNextStep(vercelUrl, "jolly deploy"));
    }
  }
  // An error envelope carries its own recovery (feature 020): a failed stage
  // names re-running itself once its preconditions are met.
  if (status === "error" && nextSteps.length === 0) {
    nextSteps.push({
      description: cliMessage("start.next.stageFailed", { stage }),
      command: `jolly ${stage}`,
    });
  }
  return envelope({
    command: stage,
    status,
    summary: cliMessage("start.summary", { stage, status: outcome.status }),
    data: {
      stages: [{ stage, status: outcome.status }],
      ...(stage === "deploy" && outcome.data ? { deploy: outcome.data } : {}),
      ...(stage === "stock" && outcome.data ? { stock: outcome.data } : {}),
    },
    checks,
    nextSteps,
  });
}

/**
 * Route a parsed invocation to its command handler. Owns the top-level `--help`
 * routing, the unknown-command error that names the supported surface, and the
 * unknown auth-subcommand error.
 *
 * @planks("the agent runs `jolly completion bash`")
 * @planks("the agent runs `jolly auth frobnicate --json`")
 * @planks(`the envelope status should be "error" with the stable code `UNKNOWN_AUTH_SUBCOMMAND``)
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function dispatch(args: ParsedArgs): Promise<Envelope> {
  const cmd = args.positionals[0];

  // Top-level `--help`: usage summary, never the command flow. `create` runs its
  // own help (bare listing vs. per-subcommand usage); bare `jolly`/`help` keep
  // the full command listing.
  if (
    args.help &&
    cmd !== undefined &&
    cmd !== "help" &&
    cmd !== "create" &&
    cmd !== "auth"
  ) {
    return commandUsage(args);
  }

  switch (cmd) {
    case undefined:
    case "help":
      return commandHelp();
    case "login":
      return commandLogin(args);
    case "logout":
      return commandLogout(args);
    case "auth":
      if (args.positionals[1] === "status") {
        // `jolly auth status --help` prints usage; bare `jolly auth status` runs.
        return args.help ? commandUsage(args) : commandAuthStatus(args);
      }
      // `jolly auth --help` names auth's subcommand surface (status).
      if (args.help) return commandAuthHelp();
      return errorEnvelope(
        "auth",
        cliMessage("cli.summary.unknownAuthSubcommand", { sub: args.positionals[1] ?? "" }),
        [
          {
            code: "UNKNOWN_AUTH_SUBCOMMAND",
            message: cliMessage("cli.error.unknownAuthSubcommand.message"),
            remediation: cliMessage("cli.error.unknownAuthSubcommand.remediation"),
          },
        ],
        {
          nextSteps: [
            {
              description: cliMessage("cli.next.authStatus"),
              command: "jolly auth status",
            },
          ],
        },
      );
    case "create":
      return commandCreate(args);
    case "init":
      return commandInit(args);
    case "start":
      return commandStart(args);
    case "storefront":
      return commandStage("storefront", (checks) =>
        runStorefrontStage(checks).then((s) => ({ status: s })));
    case "recipe":
      return commandStage("recipe", (checks) =>
        runRecipeStage(checks).then((s) => ({ status: s })));
    case "stock":
      return commandStage("stock", (checks) => runStockStage(checks));
    case "stripe":
      return commandStage("stripe", (checks) =>
        runStripeStage(checks).then((s) => ({ status: s })));
    case "deploy":
      return commandStage("deploy", (checks) => runDeployStage(checks));
    case "doctor":
      return commandDoctor(args);
    case "upgrade":
      return commandUpgrade(args);
    case "skills":
      return commandSkills(args);
    case "completion":
      // `completion` and `complete` are intercepted in main() before arg parsing
      // (their args carry raw shell words and `--`), so this case names
      // completion on the dispatch surface and delegates if ever reached directly.
      process.exit(runCompletion(args.positionals));
    default:
      return errorEnvelope(
        cmd,
        cliMessage("cli.summary.unknownCommand", { cmd }),
        [
          {
            code: "UNKNOWN_COMMAND",
            message: cliMessage("cli.error.unknownCommand.message", { cmd }),
            remediation: cliMessage("cli.error.unknownCommand.remediation"),
          },
        ],
        {
          nextSteps: [
            {
              description: cliMessage("cli.next.listCommands"),
              command: "jolly help",
            },
          ],
        },
      );
  }
}

/**
 * @planks("the agent runs `jolly start --frobnicate --json`")
 * @planks("stdout should carry the JSON envelope rather than a raw stack trace")
 * @planks(`each should carry at least one `nextSteps` entry naming what to do next`)
 */
async function main(): Promise<void> {
  // Quiet npm's install-time warnings (e.g. EBADENGINE from a transitive dep of
  // the Vercel CLI on Node 26) for every `npx` Jolly spawns — they are noise, not
  // a Jolly problem, and chasing CLI versions to dodge them is fragile. Errors
  // still surface (this only hides the `warn` level). Respects an explicit override.
  if (!process.env["NPM_CONFIG_LOGLEVEL"] && !process.env["npm_config_loglevel"]) {
    process.env["NPM_CONFIG_LOGLEVEL"] = "error";
  }
  const argv = process.argv.slice(2);

  // `completion`/`complete` are exempt from the feature 020 envelope and from
  // flag typing: their stdout is a shell script / candidate list (feature 027).
  if (argv[0] === "completion" || argv[0] === "complete") {
    process.exit(runCompletion(argv));
  }

  const args = parseArgs(process.argv.slice(2));

  // An unsupported flag fails clearly on every path, never silently ignored
  // (feature 027). Named explicitly so the agent can correct it.
  if (args.unknownFlags.length > 0) {
    const bad = args.unknownFlags[0];
    const env = errorEnvelope(
      args.positionals[0] ?? "jolly",
      cliMessage("createStore.env.summary.error", { bad }),
      [
        {
          code: "UNSUPPORTED_FLAG",
          message: cliMessage("createStore.env.error.unsupportedFlag.message", { bad }),
          remediation: cliMessage("createStore.env.error.unsupportedFlag.remediation"),
        },
      ],
      {
        nextSteps: [
          {
            description: cliMessage("cli.next.listSupportedFlags", { bad }),
            command: `jolly ${args.positionals[0] ?? "help"} --help`,
          },
        ],
      },
    );
    process.exit(emit(env, args));
  }

  let env: Envelope;
  try {
    env = await dispatch(args);
  } catch (err) {
    env = errorEnvelope(
      args.positionals[0] ?? "jolly",
      cliMessage("cli.summary.error"),
      [
        {
          code: "UNEXPECTED_ERROR",
          message: err instanceof Error ? err.message : String(err),
          remediation: cliMessage("cli.error.unexpectedError.remediation"),
        },
      ],
      {
        nextSteps: [
          {
            description: cliMessage("cli.next.reRunWithJson"),
            command: `jolly ${args.positionals[0] ?? "help"} --json`,
          },
        ],
      },
    );
  }
  const exitCode = emit(env, args);
  process.exit(exitCode);
}

// Run the CLI when invoked as a program. Suppressed under JOLLY_NO_MAIN so the
// module can be imported to drive runStartCore in-process for the composition
// test without executing the CLI against the importer argv.
if (!process.env["JOLLY_NO_MAIN"]) void main();
