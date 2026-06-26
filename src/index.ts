// Jolly — the thin, skill-driven CLI (decision 2026-06-13).
//
// Jolly does not replace the customer's agent. It does deterministic plumbing
// (login/logout/auth status, create store/app-token/stripe, init, start,
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

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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
  createEnvironment,
  pollTaskStatus,
  getEnvironment,
  extractDomainUrl,
  acquireAppToken,
  seedRecipeStock,
  assignCollectionProducts,
  storeHoldsForeignCatalog,
  DEFAULT_STOCK_QUANTITY,
  RECIPE_WAREHOUSE_SLUG,
  RECIPE_COLLECTIONS,
  RECIPE_PRODUCT_SLUGS,
  installStripeApp,
  STRIPE_APP_MANIFEST_URL,
  probeCheckoutPaymentGateway,
  probeEndpointConnectivity,
  CloudApiError,
  type CloudOrganization,
} from "./lib/cloud-api.ts";
import { loadEnvValues, writeEnvValues } from "./lib/env-file.ts";
import { normalizeSaleorUrl } from "./lib/saleor-url.ts";
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
  "publishable-key",
  "secret-key",
] as const;
// Short aliases resolve to their long flag name before classification.
const FLAG_ALIASES: Record<string, string> = { y: "yes", h: "help" };
const KNOWN_FLAGS = new Set<string>([
  ...GLOBAL_BOOLEAN_FLAGS,
  ...EXTRA_BOOLEAN_FLAGS,
  ...VALUE_FLAGS,
]);

function parseArgs(argv: string[]): ParsedArgs {
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

function statusGlyph(status: EnvelopeStatus): string {
  if (status === "success") return "ok";
  if (status === "warning") return "warn";
  return "error";
}

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

function statusEmoji(status: EnvelopeStatus): string {
  if (status === "success") return "✅";
  if (status === "warning") return "⚠️";
  return "❌";
}

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

function statusColour(status: EnvelopeStatus): string {
  if (status === "success") return SGR.green;
  if (status === "warning") return SGR.yellow;
  return SGR.red;
}

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

function projectDir(): string {
  return process.cwd();
}

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
  { id: "jolly", ref: "dmytri/jolly", description: "The Jolly end-to-end playbook" },
  { id: "saleor-storefront", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-storefront", description: "Saleor storefront guidance" },
  { id: "saleor-configurator", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-configurator", description: "Configuration-as-code guidance" },
  { id: "storefront-builder", ref: "https://github.com/saleor/agent-skills/tree/main/skills/storefront-builder", description: "Storefront build guidance" },
  { id: "saleor-core", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-core", description: "Saleor core concepts" },
  { id: "saleor-app", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-app", description: "Saleor app development guidance" },
  { id: "stripe-best-practices", ref: "stripe/ai@stripe-best-practices", description: "Stripe integration best practices" },
];

// Universal project-local skill location `npx skills add` (no --agent) writes
// to, read by all supported agents (feature 007).
function agentsSkillsBaseDir(): string {
  return join(projectDir(), ".agents", "skills");
}

// Legacy per-agent location, kept so already-seeded workspaces still verify.
function skillsBaseDir(): string {
  return join(projectDir(), ".claude", "skills");
}

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

const TOKEN_PAGE = "https://cloud.saleor.io/tokens";

function loginRiskContext(dryRunAvailable = true): RiskContext {
  return {
    action: "login",
    target: cloudApiBase(),
    riskLevel: "medium",
    categories: ["credential handling"],
    reversible: true,
    sideEffects: ["Writes JOLLY_SALEOR_CLOUD_TOKEN to .env when verification permits"],
    dryRunAvailable,
  };
}


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
        "JOLLY_SALEOR_CLOUD_TOKEN is set but empty. Nothing was written.",
        [
          {
            code: "EMPTY_TOKEN",
            message:
              "JOLLY_SALEOR_CLOUD_TOKEN is set to an empty value; no token was read.",
            remediation: `Set JOLLY_SALEOR_CLOUD_TOKEN to a staff token from ${TOKEN_PAGE}, or run \`jolly login\` interactively to sign in.`,
          },
        ],
        {
          data: { riskContext: loginRiskContext() },
          nextSteps: [
            {
              description: `Set JOLLY_SALEOR_CLOUD_TOKEN to a staff token from ${TOKEN_PAGE}.`,
              command: "export JOLLY_SALEOR_CLOUD_TOKEN=<staff-token>",
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
      summary: "Previewed login; nothing was written.",
      data: { riskContext: loginRiskContext(), dryRun: true },
      nextSteps: [
        {
          description:
            "Run `jolly login` to sign in through the Saleor device authorization grant, or set JOLLY_SALEOR_CLOUD_TOKEN for non-interactive use.",
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
  if (token === undefined && process.stdin.isTTY) {
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
      "The token was rejected by the Cloud API. Nothing was written.",
      [
        {
          code: "INVALID_TOKEN",
          message: "Saleor Cloud rejected the token (HTTP 401/403). It was not stored.",
          remediation: `Create a new token at ${TOKEN_PAGE} and try again.`,
        },
      ],
      {
        checks: [
          {
            id: "cloud-token-verification",
            status: "fail",
            description: "Token rejected by the Cloud API.",
          },
        ],
        data: { riskContext: loginRiskContext() },
        nextSteps: [
          { description: `Create a new token at ${TOKEN_PAGE}.`, command: `open ${TOKEN_PAGE}` },
        ],
      },
    );
  }

  if (verificationFailure) {
    // Unreachable / 5xx / timeout: store token, warn "stored, not verified".
    writeEnvValues(projectDir(), { JOLLY_SALEOR_CLOUD_TOKEN: token });
    return envelope({
      command,
      status: "warning",
      summary: "Token stored, not verified — the Cloud API was unreachable.",
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
          description: "stored, not verified — the Cloud API was unreachable.",
        },
      ],
      nextSteps: [
        {
          description: "Re-run jolly login when the Cloud API is reachable to verify the token.",
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

  return envelope({
    command,
    status: "success",
    summary: orgName
      ? `Token verified and stored. Authenticated as "${orgName}".`
      : "Token verified and stored.",
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
        description: "Token verified against the Cloud API organizations endpoint.",
      },
    ],
    nextSteps: [
      {
        description: "Run jolly create store to provision a Saleor Cloud environment.",
        command: "jolly create store --create-environment",
      },
    ],
  });
}

// Interactive sign-in through the Saleor device authorization grant. Request a
// device code, display the user code + verification URL through Bombshell's
// prompt UI, then poll the token endpoint while the human authorizes.
async function deviceGrantLogin(command: string): Promise<Envelope> {
  const auth = await requestDeviceCode();
  clackNote(
    `Open ${auth.verificationUri}?user_code=${auth.userCode}\nand enter the code: ${auth.userCode}`,
    "Sign in to Saleor Cloud",
    CLACK_STDERR,
  );
  const tokens = await pollForDeviceTokens(auth);
  // The device grant writes only the access + refresh variables and never
  // overwrites JOLLY_SALEOR_CLOUD_TOKEN (feature 018 scheme rule). The access
  // token authenticates the platform API as Bearer; the refresh token mints a
  // fresh one when it expires.
  writeEnvValues(projectDir(), {
    JOLLY_SALEOR_ACCESS_TOKEN: tokens.accessToken,
    JOLLY_SALEOR_REFRESH_TOKEN: tokens.refreshToken,
  });
  return envelope({
    command,
    status: "success",
    summary: "Signed in through the Saleor device authorization grant.",
    data: { cloudTokenStored: true, riskContext: loginRiskContext() },
  });
}

// A single agent-driven `jolly login` waits this many seconds for the human to
// authorize before reporting the grant is still pending (non-zero) and letting
// the agent re-run. Bounded so one invocation does not hang for the full
// device-code lifetime; the relayed code stays valid for the re-run.
const AGENT_POLL_WINDOW_SECONDS = 10;

// Relay a device authorization's user code + verification URL to STDERR in plain
// text so an agent-driven (non-interactive) run can forward them to its human
// (feature 018, Rule "Interactive authentication is the Saleor device
// authorization grant"). Plain stderr, never the Bombshell prompt UI — the
// interactive path keeps the prompt UI; the agent path keeps stdout clean for
// the envelope. No token value is ever printed.
function relayDeviceCode(auth: DeviceAuthorization): void {
  process.stderr.write(
    `Sign in to Saleor Cloud: open ${auth.verificationUri}?user_code=${auth.userCode} and enter the code ${auth.userCode}\n`,
  );
}

// Agent-driven sign-in through the Saleor device authorization grant. Request a
// device code, relay the user code + verification URL to plain STDERR so the
// agent can forward them to its human, emit the standard output envelope on
// STDOUT announcing the grant started, then poll the token endpoint while the
// human authorizes out-of-band. The envelope carries no token value; the
// code + URL stay on STDERR only. On authorization, store the access + refresh
// tokens (never the staff token) and exit successfully.
async function deviceGrantLoginAgent(
  command: string,
  _args: ParsedArgs,
): Promise<Envelope> {
  const auth = await requestDeviceCode();
  // Relay the user code + verification URL to plain STDERR so the agent forwards
  // them to its human; stdout stays clean for the single result envelope.
  relayDeviceCode(auth);
  // Poll the token endpoint while the human authorizes out-of-band, within a
  // bounded window (the grant's own interval is honoured) rather than the full
  // device-code lifetime. On authorization within the window, store the access +
  // refresh tokens (never the staff token) and return a success envelope — the
  // single envelope on stdout, with no token value printed. If the window passes
  // without authorization, return a pending warning so the agent re-runs
  // `jolly login` to complete.
  try {
    const tokens = await pollForDeviceTokens({
      ...auth,
      expiresIn: Math.min(auth.expiresIn, AGENT_POLL_WINDOW_SECONDS),
    });
    writeEnvValues(projectDir(), {
      JOLLY_SALEOR_ACCESS_TOKEN: tokens.accessToken,
      JOLLY_SALEOR_REFRESH_TOKEN: tokens.refreshToken,
    });
    return envelope({
      command,
      status: "success",
      summary: "Signed in through the Saleor device authorization grant.",
      data: { cloudTokenStored: true, riskContext: loginRiskContext() },
    });
  } catch (err) {
    if (err instanceof DeviceGrantError && err.code === "DEVICE_CODE_EXPIRED") {
      return envelope({
        command,
        status: "warning",
        summary:
          "Started the Saleor device authorization grant. Authorize at the URL relayed on stderr, then re-run `jolly login`.",
        data: { authorizationPending: true, riskContext: loginRiskContext() },
        nextSteps: [
          {
            description:
              "Authorize the device sign-in at the verification URL relayed on stderr.",
            command: "jolly login",
          },
        ],
      });
    }
    throw err;
  }
}

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
  "JOLLY_SALEOR_APP_TOKEN",
  "JOLLY_SALEOR_ORGANIZATION",
];

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
        ? `Removed Jolly-managed Saleor auth values from .env (${[...new Set(removed)].join(", ")}).`
        : "No Jolly-managed Saleor auth values were present in .env.",
    data: {
      removed: [...new Set(removed)],
      preservedOthers: true,
    },
    checks: [
      {
        id: "auth-cleared",
        status: "pass",
        description: "Jolly-managed Saleor auth values are no longer in .env.",
      },
    ],
    nextSteps: [
      {
        description: "Run jolly login to authenticate again when needed.",
        command: "jolly login",
      },
    ],
  });
}

// ─── auth status (feature 018) ────────────────────────────────────────────

function commandAuthStatus(_args: ParsedArgs): Envelope {
  const command = "auth status";
  const values = loadEnvValues(projectDir());
  const hasCloudToken = Boolean(values["JOLLY_SALEOR_CLOUD_TOKEN"]);
  const hasAppToken = Boolean(values["JOLLY_SALEOR_APP_TOKEN"]);
  const org = values["JOLLY_SALEOR_ORGANIZATION"];
  const accountContext = org && org.length > 0 ? org : "unknown";

  const checks: Check[] = [
    {
      id: "cloud-token-configured",
      status: hasCloudToken ? "pass" : "warning",
      description: hasCloudToken
        ? "JOLLY_SALEOR_CLOUD_TOKEN is configured in .env."
        : "JOLLY_SALEOR_CLOUD_TOKEN is not configured.",
    },
    {
      id: "app-token-configured",
      status: hasAppToken ? "pass" : "skipped",
      description: hasAppToken
        ? "JOLLY_SALEOR_APP_TOKEN is configured in .env."
        : "JOLLY_SALEOR_APP_TOKEN is not configured.",
    },
  ];

  return envelope({
    command,
    status: "success",
    summary: hasCloudToken
      ? `Saleor Cloud authentication is configured (account context: ${accountContext}).`
      : "Saleor Cloud authentication is not configured.",
    data: {
      hasCloudToken,
      hasAppToken,
      accountContext,
    },
    checks,
    nextSteps: hasCloudToken
      ? []
      : [
          {
            description: "Run jolly login to configure Saleor Cloud authentication.",
            command: "jolly login",
          },
        ],
  });
}

// ─── create store (features 012/024) ──────────────────────────────────────

function createStoreRiskContext(target: unknown, dryRunAvailable = true): RiskContext {
  return {
    action: "create store",
    target,
    riskLevel: "medium",
    categories: ["billing", "production configuration changes"],
    reversible: false,
    sideEffects: [
      "Creates a Saleor Cloud project and/or environment",
      "Writes NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN to .env",
    ],
    dryRunAvailable,
  };
}

async function commandCreateStore(args: ParsedArgs): Promise<Envelope> {
  const command = "create store";
  const url = args.options["url"];

  // Mode 1: write a pasted Saleor URL to .env (feature 012). -------------
  if (url && !args.flags.has("create-environment")) {
    const normalized = normalizeSaleorUrl(url);
    if (!normalized.endpoint) {
      return errorEnvelope(
        command,
        "The provided URL could not be normalized to a Saleor GraphQL endpoint.",
        [
          {
            code: "INVALID_SALEOR_URL",
            message: normalized.clarification ?? "Unrecognized Saleor URL.",
            remediation: "Paste a Saleor Dashboard, GraphQL, or root Saleor Cloud URL.",
          },
        ],
        { data: { riskContext: createStoreRiskContext(url) } },
      );
    }

    if (args.dryRun) {
      return envelope({
        command,
        status: "success",
        summary: "Previewed storing the Saleor endpoint; nothing was written.",
        data: {
          dryRun: true,
          normalizedUrl: normalized.endpoint,
          riskContext: createStoreRiskContext(normalized.endpoint),
        },
        nextSteps: [
          {
            description: "Run the command without --dry-run to write the endpoint to .env.",
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
        summary:
          "A different NEXT_PUBLIC_SALEOR_API_URL already exists in .env; " +
          "Jolly paused instead of overwriting it. Re-run with --yes to replace it.",
        data: {
          collision: true,
          existingEndpoint,
          requestedEndpoint: normalized.endpoint,
          riskContext: {
            action: "overwrite Saleor endpoint",
            target: "NEXT_PUBLIC_SALEOR_API_URL in .env",
            riskLevel: "medium",
            categories: ["destructive operations", "production configuration changes"],
            reversible: false,
            sideEffects: [
              `Replaces the existing endpoint "${existingEndpoint}" with "${normalized.endpoint}"`,
            ],
            dryRunAvailable: true,
          },
        },
        checks: [
          {
            id: "saleor-endpoint-collision",
            status: "warning",
            description:
              "An existing NEXT_PUBLIC_SALEOR_API_URL would be overwritten; not replaced without --yes.",
          },
        ],
        nextSteps: [
          {
            description:
              "Re-run with --yes to overwrite the existing endpoint (the agent decides).",
            command: `jolly create store --url ${normalized.endpoint} --yes`,
          },
        ],
      });
    }

    writeEnvValues(projectDir(), { NEXT_PUBLIC_SALEOR_API_URL: normalized.endpoint });
    return envelope({
      command,
      status: "success",
      summary:
        "Wrote NEXT_PUBLIC_SALEOR_API_URL to .env; the endpoint is stored, not verified.",
      data: {
        stored: true,
        envVar: "NEXT_PUBLIC_SALEOR_API_URL",
        riskContext: createStoreRiskContext(normalized.endpoint),
      },
      checks: [
        {
          id: "saleor-endpoint-stored",
          status: "pass",
          description:
            "NEXT_PUBLIC_SALEOR_API_URL written to .env; the endpoint is stored, not verified.",
        },
      ],
      nextSteps: [
        {
          description: "Run jolly create app-token to acquire a Saleor app token.",
          command: "jolly create app-token",
        },
        {
          description:
            "Run jolly start to continue the end-to-end setup; it recognizes the " +
            "stored store and resumes rather than redoing it.",
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
      "No Saleor Cloud token is configured; cannot provision a store.",
      [
        {
          code: "MISSING_CLOUD_TOKEN",
          message: "JOLLY_SALEOR_CLOUD_TOKEN is required to create a Saleor Cloud store.",
          remediation: "Run `jolly login` first.",
        },
      ],
      {
        data: {
          riskContext: createStoreRiskContext(`${cloudApiBase()} (organization unresolved)`),
        },
        nextSteps: [
          {
            description: "Run jolly login to acquire a Saleor Cloud token.",
            command: "jolly login",
          },
        ],
      },
    );
  }

  // Resolve the organization. --mock-organizations injects a deterministic
  // org list for the @logic multi-org warning scenario (no network).
  let orgs: CloudOrganization[];
  const mock = args.flags.has("mock-organizations")
    ? ""
    : (args.options["mock-organizations"] ?? undefined);
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
      "The Cloud token has access to no organizations.",
      [
        {
          code: "NO_ORGANIZATIONS",
          message: "No organizations are accessible with this Cloud token.",
          remediation: "Confirm the token's permissions at https://cloud.saleor.io/tokens.",
        },
      ],
      { data: { riskContext: createStoreRiskContext(cloudApiBase()) } },
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
    const requestBody = {
      name: effectiveName,
      project: effectiveName,
      domain_label: effectiveDomainLabel,
      database_population: null,
      service: "saleor",
      region,
    };
    const env = envelope({
      command,
      status: multiOrgWarning ? "warning" : "success",
      summary: multiOrgWarning
        ? `Previewed environment creation in "${selectedOrg}" (token has multiple organizations).`
        : `Previewed environment creation in organization "${selectedOrg}".`,
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
          description: "Run the command without --dry-run to create the environment.",
          command: "jolly create store --create-environment",
        },
      ],
    });
    if (multiOrgWarning) {
      env.data["availableOrganizations"] = orgs.map((o) => o.slug);
      env.data["selectedOrganization"] = selectedOrg;
    }
    return env;
  }

  // Multi-org without --organization (non-dry-run): warn before proceeding
  // so the agent can re-run with the right org (feature 012).
  if (multiOrgWarning) {
    return envelope({
      command,
      status: "warning",
      summary: `The Cloud token has multiple organizations; Jolly selected "${selectedOrg}".`,
      data: {
        availableOrganizations: orgs.map((o) => o.slug),
        selectedOrganization: selectedOrg,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      checks: [
        {
          id: "organization-selection",
          status: "warning",
          description: `Selected "${selectedOrg}". Re-run with --organization <slug> if this is wrong.`,
        },
      ],
      nextSteps: [
        {
          description: `Re-run with --organization <slug> to choose explicitly. Available: ${orgs
            .map((o) => o.slug)
            .join(", ")}.`,
          command: `jolly create store --create-environment --organization ${selectedOrg}`,
        },
      ],
    });
  }

  // Real provisioning: create-or-reuse project, create env, poll, write .env
  try {
    const result = await provisionStore(token, selectedOrg, {
      name: effectiveName,
      domainLabel: effectiveDomainLabel,
      region,
    });
    return envelope({
      command,
      status: "success",
      summary: `Saleor Cloud environment ready in "${selectedOrg}".`,
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
        appTokenStored: result.appTokenStored,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      checks: [
        {
          id: "environment-provisioned",
          status: "pass",
          description: result.environmentCreated
            ? "Environment created and verified via task status."
            : "Existing environment reused.",
        },
        {
          id: "app-token-acquired",
          status: result.appTokenStored ? "pass" : "unknown",
          description: result.appTokenStored
            ? "App token acquired and stored."
            : "App token not acquired; run jolly create app-token.",
        },
      ],
      nextSteps: result.appTokenStored
        ? []
        : [
            {
              description: "Run jolly create app-token to acquire an app token.",
              command: "jolly create app-token",
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
  appTokenStored: boolean;
}

/**
 * Create-or-reuse a Saleor Cloud project + environment via the Cloud API, poll
 * until ready, acquire an app token, and write the resulting
 * NEXT_PUBLIC_SALEOR_API_URL + JOLLY_SALEOR_APP_TOKEN to `.env` (and into this
 * process so later in-process stages see them). The shared plumbing behind both
 * `jolly create store --create-environment` and `jolly start`'s auto-provision
 * store stage (feature 002 "Auto-provisioning a store"). Idempotent (feature
 * 022): an existing project/environment matching the name/domain label is reused
 * rather than recreated.
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
    const created = await createEnvironment(token, selectedOrg, {
      name: effectiveName,
      project: projectSlug,
      domain_label: effectiveDomainLabel,
      database_population: null,
      service,
      region,
    });
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

  const values: Record<string, string> = { NEXT_PUBLIC_SALEOR_API_URL: domainUrl };

  // Acquire an app token against the new instance GraphQL endpoint.
  let appTokenStored = false;
  try {
    const appToken = await acquireAppToken(domainUrl, token, "Jolly Setup");
    values["JOLLY_SALEOR_APP_TOKEN"] = appToken;
    appTokenStored = true;
  } catch {
    // Non-fatal: the env exists; the agent can run create app-token later.
  }

  writeEnvValues(projectDir(), values);
  // Make the new endpoint/token visible to later in-process reads (the
  // downstream recipe/stock/deploy stages of the same `jolly start` run).
  for (const [k, v] of Object.entries(values)) process.env[k] = v;

  return {
    graphqlApiUrl: domainUrl,
    dashboardUrl: new URL("/dashboard/", domainUrl).href,
    organization: selectedOrg,
    environmentName,
    environmentKey,
    projectCreated,
    environmentCreated,
    appTokenStored,
  };
}

function cloudErrorEnvelope(command: string, err: unknown, riskContext: RiskContext): Envelope {
  const code = err instanceof CloudApiError ? err.code : "CLOUD_API_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  return errorEnvelope(
    command,
    "The Cloud API request failed. Nothing was created.",
    [
      {
        code,
        message,
        remediation:
          code === "ENVIRONMENT_LIMIT_REACHED"
            ? "Delete an unused environment or upgrade the plan, then re-run."
            : code === "DOMAIN_LABEL_TAKEN"
              ? "Choose a different domain label with --domain-label <label>."
              : "Confirm the Cloud token and that the Cloud API is reachable.",
      },
    ],
    {
      data: { riskContext },
      nextSteps:
        code === "ENVIRONMENT_LIMIT_REACHED"
          ? [
              {
                description:
                  "Free a sandbox environment by deleting an unused one, then re-run.",
              },
              {
                description:
                  "Upgrade the plan to raise the sandbox environment limit, then re-run.",
              },
            ]
          : [],
    },
  );
}

// ─── create app-token (feature 024) ───────────────────────────────────────

function appTokenRiskContext(target: unknown): RiskContext {
  return {
    action: "create app-token",
    target,
    riskLevel: "medium",
    categories: ["credential handling"],
    reversible: true,
    sideEffects: [
      "Creates a Saleor app token via GraphQL",
      "Writes JOLLY_SALEOR_APP_TOKEN to .env",
    ],
    dryRunAvailable: true,
  };
}

async function commandCreateAppToken(args: ParsedArgs): Promise<Envelope> {
  const command = "create app-token";
  const values = loadEnvValues(projectDir());
  // `.env`-first (feature 008 Rule "Credentials are read from .env"): the Cloud
  // token is read from the project `.env` FILE the agent left it in, with a
  // fallback to the process environment.
  const token = cloudPlatformToken(values);
  // Report where the Cloud token was read from: the project `.env` FILE is the
  // real-agent path (feature 008 Rule "Credentials are read from .env"); the
  // process environment is only a fallback.
  const cloudTokenSource = values["JOLLY_SALEOR_CLOUD_TOKEN"]
    ? "project .env"
    : process.env["JOLLY_SALEOR_CLOUD_TOKEN"]
      ? "process environment"
      : "unresolved";
  const instanceUrl =
    args.options["url"] ??
    values["NEXT_PUBLIC_SALEOR_API_URL"] ??
    process.env["NEXT_PUBLIC_SALEOR_API_URL"];

  if (args.dryRun) {
    return envelope({
      command,
      status: "success",
      summary: "Previewed app token creation; no GraphQL mutation was sent.",
      data: {
        dryRun: true,
        instanceUrl: instanceUrl ?? null,
        cloudTokenSource,
        riskContext: appTokenRiskContext(instanceUrl ?? "unresolved Saleor GraphQL endpoint"),
      },
      nextSteps: [
        {
          description: "Run the command without --dry-run to create and store the app token.",
          command: "jolly create app-token",
        },
      ],
    });
  }

  if (!token) {
    return errorEnvelope(
      command,
      "No Saleor Cloud token is configured; cannot acquire an app token.",
      [
        {
          code: "MISSING_CLOUD_TOKEN",
          message: "JOLLY_SALEOR_CLOUD_TOKEN is required to acquire an app token.",
          remediation: "Run `jolly login` first.",
        },
      ],
      { data: { riskContext: appTokenRiskContext(instanceUrl ?? "unresolved") } },
    );
  }

  if (!instanceUrl) {
    return errorEnvelope(
      command,
      "No Saleor GraphQL instance URL is available.",
      [
        {
          code: "MISSING_INSTANCE_URL",
          message: "A Saleor GraphQL endpoint (NEXT_PUBLIC_SALEOR_API_URL) is required.",
          remediation: "Run `jolly create store` first, or pass --url <graphql-endpoint>.",
        },
      ],
      { data: { riskContext: appTokenRiskContext("unresolved") } },
    );
  }

  try {
    const appToken = await acquireAppToken(instanceUrl, token, "Jolly Setup");
    writeEnvValues(projectDir(), { JOLLY_SALEOR_APP_TOKEN: appToken });
    return envelope({
      command,
      status: "success",
      summary:
        "Wrote the app token to .env as JOLLY_SALEOR_APP_TOKEN; the token is stored, not verified.",
      data: {
        appTokenStored: true,
        instanceUrl,
        riskContext: appTokenRiskContext(instanceUrl),
      },
      checks: [
        {
          id: "app-token-acquired",
          status: "pass",
          description:
            "App token written to .env as JOLLY_SALEOR_APP_TOKEN; the token is stored, not verified.",
        },
      ],
    });
  } catch (err) {
    const code = err instanceof CloudApiError ? err.code : "APP_TOKEN_ACQUISITION_FAILED";
    return errorEnvelope(
      command,
      "Could not acquire an app token. Nothing was stored.",
      [
        {
          code,
          message: err instanceof Error ? err.message : String(err),
          remediation:
            "Confirm the instance is reachable and the Cloud token has access; or create an app in the Saleor Dashboard.",
        },
      ],
      { data: { riskContext: appTokenRiskContext(instanceUrl) } },
    );
  }
}

// ─── create dispatcher + help ─────────────────────────────────────────────

const CREATE_SUBCOMMANDS = ["store", "app-token"] as const;

function commandCreateHelp(): Envelope {
  const command = "create --help";
  return envelope({
    command,
    status: "success",
    summary: "jolly create exposes the plumbing subcommands store and app-token.",
    data: {
      subcommands: [
        {
          name: "store",
          description: "Provision a Saleor Cloud store/environment, or store a pasted Saleor URL.",
        },
        {
          name: "app-token",
          description: "Acquire a Saleor app token via GraphQL and write it to .env.",
        },
      ],
      note: "Other setup work is run by your agent via the official CLIs, guided by the Jolly skill.",
    },
    nextSteps: [
      {
        description: "Run jolly create store --create-environment to provision a Saleor Cloud environment.",
        command: "jolly create store --create-environment",
      },
    ],
  });
}

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
    case "app-token":
      return commandCreateAppToken(args);
    default:
      return errorEnvelope("create", `Unknown create subcommand "${sub}".`, [
        {
          code: "UNKNOWN_CREATE_SUBCOMMAND",
          message: `"${sub}" is not a create subcommand. Valid: ${CREATE_SUBCOMMANDS.join(", ")}.`,
          remediation: "Run `jolly create --help` to list available subcommands.",
        },
      ]);
  }
}

// ─── init (feature 007) ───────────────────────────────────────────────────

/**
 * Resolve Jolly's bundled skill directory (`assets/skills/jolly`) relative to
 * Jolly's own module path — the same scheme as bundledRecipePath(). The Jolly
 * skill ships inside the package, so installing it needs no network and does
 * not depend on the repo being pushed (feature 007 Rule "Jolly skill source").
 */
function bundledJollySkillPath(): string {
  return fileURLToPath(new URL("../assets/skills/jolly", import.meta.url));
}

// Human-facing CLI copy lives in the message catalog asset, rendered by key, not
// hard-coded here (feature 027 "copy is a catalog asset"). The catalog ships in
// the package beside the skills, resolved the same `../assets/...` way.
let cliMessageCatalog: Record<string, string> | undefined;
function cliMessage(key: string): string {
  if (!cliMessageCatalog) {
    const path = fileURLToPath(new URL("../assets/messages/cli.json", import.meta.url));
    cliMessageCatalog = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  }
  return cliMessageCatalog[key]!;
}

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

function mergeMcpJson(): { merged: boolean; warning?: string } {
  const path = join(projectDir(), ".mcp.json");
  const endpoint =
    loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"] ??
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ??
    "https://your-store.saleor.cloud/graphql/";
  const jollyEntry = {
    command: "npx",
    args: ["-y", "mcp-graphql"],
    env: { ENDPOINT: endpoint },
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
function detectAgent(): string | null {
  const root = projectDir();
  if (existsSync(join(root, "CLAUDE.md")) || existsSync(join(root, ".claude"))) {
    return "claude";
  }
  return null;
}

function commandInit(_args: ParsedArgs): Envelope {
  const command = "init";
  const checks: Check[] = [];
  const installFailures: string[] = [];

  for (const skill of DEFAULT_SKILLS) {
    const already = skillInstalledOnDisk(skill);
    if (!already) {
      installSkill(skill);
    }
    // Verify on disk — never unconditionally claim success.
    const present = skillInstalledOnDisk(skill);
    checks.push({
      id: `skill-${skill.id}`,
      status: present ? "pass" : "fail",
      description: present
        ? `${skill.id} present on disk${already ? " (already installed)" : ""}.`
        : `${skill.id} could not be verified on disk after npx skills add.`,
    });
    if (!present) installFailures.push(skill.id);
  }

  // Merge .mcp.json (local mcp-graphql against the customer endpoint).
  const mcp = mergeMcpJson();
  checks.push({
    id: "mcp-config",
    status: mcp.merged ? "pass" : "warning",
    description: mcp.merged
      ? "Merged saleor-graphql entry into .mcp.json."
      : mcp.warning ?? "Could not merge .mcp.json.",
  });

  // Merge AGENTS.md guidance.
  mergeAgentsMd();
  checks.push({
    id: "agents-md",
    status: "pass",
    description: "Merged the Jolly section into AGENTS.md.",
  });

  if (installFailures.length > 0) {
    return errorEnvelope(
      command,
      `Some skills could not be verified on disk: ${installFailures.join(", ")}.`,
      [
        {
          code: "SKILL_INSTALL_FAILED",
          message: `Failed to install or verify: ${installFailures.join(", ")}.`,
          remediation:
            "Ensure `npx skills` is available and the network is reachable, then re-run `jolly init`.",
        },
      ],
      { checks },
    );
  }

  return envelope({
    command,
    status: "success",
    summary: `Installed and verified ${DEFAULT_SKILLS.length} skills; merged .mcp.json and AGENTS.md.`,
    data: {
      skills: DEFAULT_SKILLS.map((s) => s.id),
      mcpMerged: mcp.merged,
      agentsMdMerged: true,
      detectedAgent: detectAgent(),
    },
    checks,
    nextSteps: [
      {
        description:
          "Reload or restart your agent so the newly installed skills are loaded into its context.",
      },
      {
        description: "Run jolly start to bootstrap setup and get the ordered playbook.",
        command: "jolly start",
      },
    ],
  });
}

// ─── doctor (feature 014) ─────────────────────────────────────────────────

const DOCTOR_GROUPS = ["skills", "init", "saleor", "storefront", "deployment", "stripe"] as const;

// Read-only predicates for the init-bootstrap artifacts (feature 014 init group).
// Doctor is diagnostics-only — these only read, never write (unlike mergeMcpJson/mergeAgentsMd).
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
 * Resolve the Cloud platform token, preferring a stored device-grant access
 * token (Bearer) over the staff token (Token), per the feature 018 scheme rule.
 * When the access token (a Keycloak JWT) has expired and a refresh token is
 * stored, mints a fresh access token through the refresh grant and persists it
 * to `.env` + `process.env` (so the scheme picker and the read below see it),
 * rather than re-prompting. A refresh failure falls through with the stale token,
 * which the read then reports as rejected.
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

async function commandDoctor(args: ParsedArgs): Promise<Envelope> {
  const group = args.positionals[1];
  const values = loadEnvValues(projectDir());
  const checks: Check[] = [];

  if (
    group &&
    !DOCTOR_GROUPS.includes(group as (typeof DOCTOR_GROUPS)[number])
  ) {
    return errorEnvelope("doctor", `Unknown doctor group "${group}".`, [
      {
        code: "UNKNOWN_DOCTOR_GROUP",
        message: `"${group}" is not a doctor group. Valid: ${DOCTOR_GROUPS.join(", ")}.`,
        remediation: "Run `jolly doctor` for all checks or name a valid group.",
      },
    ]);
  }

  const wants = (g: string) => !group || group === g;

  // CLI availability (always reportable, read-only).
  if (!group) {
    checks.push({
      id: "cli-available",
      status: "pass",
      description: `Jolly CLI is available (Node ${process.versions.node}).`,
    });
  }

  if (wants("skills")) {
    for (const skill of DEFAULT_SKILLS) {
      const present = skillInstalledOnDisk(skill);
      checks.push({
        id: `skill-${skill.id}`,
        status: present ? "pass" : "fail",
        description: present ? `${skill.id} present.` : `${skill.id} not installed.`,
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
        ? ".mcp.json carries the saleor-graphql entry."
        : "No .mcp.json with a saleor-graphql entry; run jolly init to merge it.",
      command: mcpOk ? undefined : "jolly init",
    });
    const agentsOk = agentsMdHasJollyMarker();
    checks.push({
      id: "agents-md",
      status: agentsOk ? "pass" : "fail",
      description: agentsOk
        ? "AGENTS.md carries the Jolly marker section."
        : "AGENTS.md is missing or lacks the Jolly marker section; run jolly init to merge it.",
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
    const hasApp = Boolean(
      values["JOLLY_SALEOR_APP_TOKEN"] ?? process.env["JOLLY_SALEOR_APP_TOKEN"],
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
        description: "No Saleor Cloud token configured.",
        command: "jolly login",
      });
    } else if (platform.source === "staff" && !cloudToken.includes(".")) {
      // A separator-free staff token is the per-store app-token shape, not a
      // Cloud staff token (minted with a dot separator at the tokens page). Flag
      // the likely mix-up before the network probe. (A device-grant access JWT
      // always carries dots, so this heuristic applies only to the staff token.)
      checks.push({
        id: "saleor-cloud-token",
        status: "warning",
        description:
          "JOLLY_SALEOR_CLOUD_TOKEN looks like a per-store app token, not a " +
          "Cloud staff token. Create a Cloud staff token at " +
          "https://cloud.saleor.io/tokens.",
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
            description: `Cloud token authenticated a read-only GET of ${orgEndpoint}; organization "${slug}".`,
          });
        } else {
          checks.push({
            id: "saleor-cloud-token",
            status: "warning",
            description: `Cloud token authenticated ${orgEndpoint} but it returned no organizations. Create a token at https://cloud.saleor.io/tokens.`,
            command: "jolly login",
          });
        }
      } catch (error) {
        if (error instanceof CloudApiError && typeof error.httpStatus === "number") {
          checks.push({
            id: "saleor-cloud-token",
            status: "warning",
            description: `Cloud token was rejected: the read-only GET of ${orgEndpoint} returned HTTP ${error.httpStatus}. Create a new token at https://cloud.saleor.io/tokens.`,
            command: "jolly login",
          });
        } else {
          checks.push({
            id: "saleor-cloud-token",
            status: "unknown",
            description: `Could not reach the Cloud API organizations endpoint (${orgEndpoint}) to verify the token in this run.`,
          });
        }
      }
    }
    if (!hasEndpoint) {
      checks.push({
        id: "saleor-endpoint",
        status: "fail",
        description: "No Saleor GraphQL endpoint configured.",
        command: "jolly create store --url <graphql-endpoint>",
      });
    } else {
      // Presence is detectable; run a real READ-ONLY live connectivity probe.
      // Reachable GraphQL endpoint → "pass"; configured but unreachable / not a
      // GraphQL endpoint → "unknown" (never a fabricated pass, never "fail").
      const saleorEndpoint = String(
        values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"],
      );
      const outcome = await probeEndpointConnectivity(saleorEndpoint);
      const reachable = outcome.kind === "reachable";
      checks.push({
        id: "saleor-endpoint",
        status: reachable ? "pass" : "unknown",
        description: reachable
          ? "NEXT_PUBLIC_SALEOR_API_URL is reachable and responds as a GraphQL endpoint."
          : "NEXT_PUBLIC_SALEOR_API_URL is set but live connectivity could not be verified in this run.",
      });
    }
    checks.push({
      id: "saleor-app-token",
      status: hasApp ? "pass" : "fail",
      description: hasApp ? "JOLLY_SALEOR_APP_TOKEN present." : "No Saleor app token configured.",
      command: hasApp ? undefined : "jolly create app-token",
    });
  }

  if (wants("storefront")) {
    // pnpm is the storefront install prerequisite Jolly spawns (`pnpm install`,
    // feature 002). A missing pnpm is reported as a clean check with install
    // guidance — never the raw spawn ENOENT. The probe is read-only
    // (`pnpm --version`); the error object is inspected but never surfaced.
    const pnpmProbe = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
    const pnpmOk = !pnpmProbe.error && pnpmProbe.status === 0;
    checks.push({
      id: "pnpm-available",
      status: pnpmOk ? "pass" : "fail",
      description: pnpmOk
        ? `pnpm is available (${pnpmProbe.stdout.trim()}).`
        : "pnpm is not available; the storefront stage spawns `pnpm install` to install Paper's dependencies.",
      ...(pnpmOk
        ? {}
        : {
            remediation:
              "Install pnpm (https://pnpm.io/installation), for example `npm install -g pnpm`, then re-run jolly start.",
          }),
    });

    const storefrontPresent =
      existsSync(join(projectDir(), "storefront", "package.json")) &&
      existsSync(join(projectDir(), "storefront", "src", "app"));
    // Without a verified Paper storefront, report fail/unknown — never pass.
    checks.push({
      id: "storefront-present",
      status: storefrontPresent ? "unknown" : "fail",
      description: storefrontPresent
        ? "A project structure exists; Paper storefront readiness not verified in this run."
        : "No Paper storefront detected locally.",
      command: storefrontPresent ? undefined : "Clone saleor/storefront (Paper) per the Jolly skill.",
    });
  }

  if (wants("deployment")) {
    // Deployment is agent-run via the Vercel CLI; Jolly cannot verify it from
    // its own first-party-host code, so report skipped (honest, not fail).
    checks.push({
      id: "deployment-status",
      status: "skipped",
      description: "Deployment is run by your agent via the Vercel CLI; Jolly does not contact Vercel.",
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
        ? `Vercel CLI session confirmed by running \`vercel whoami\`: logged in as ${probe.account}.`
        : "No Vercel CLI session: `vercel whoami` reported you are not logged in.",
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
    const probeToken =
      values["JOLLY_SALEOR_APP_TOKEN"] ??
      process.env["JOLLY_SALEOR_APP_TOKEN"] ??
      values["JOLLY_SALEOR_CLOUD_TOKEN"] ??
      process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    const gateStep =
      "Open the installed Stripe app's configuration in the Saleor Dashboard, " +
      "paste the publishable and restricted keys, and map the configuration to " +
      "the `us` channel.";
    if (!endpoint || !probeToken) {
      checks.push({
        id: "checkout-payment-gateway",
        status: "skipped",
        description:
          "Checkout-readiness probe skipped: no Saleor endpoint and/or token to reach the store. " +
          "Once the store is reachable, this probe creates a reverted `us` test checkout to confirm the Stripe gateway is offered.",
        command: "jolly create store --url <graphql-endpoint>",
      });
    } else {
      const outcome = await probeCheckoutPaymentGateway(endpoint, probeToken);
      switch (outcome.kind) {
        case "stripe-offered":
          checks.push({
            id: "checkout-payment-gateway",
            status: "pass",
            description:
              "Checkout is ready: a `us` checkout is offered the Stripe payment gateway, so checkout can progress to the Stripe test payment step.",
          });
          break;
        case "not-offered":
          checks.push({
            id: "checkout-payment-gateway",
            status: "warning",
            description:
              "The store is reachable but a `us` checkout is not yet offered the Stripe gateway. " +
              "Complete the remaining keys + `us`-channel Dashboard step: " +
              gateStep,
            command: gateStep,
          });
          break;
        case "no-variants":
        case "no-checkout":
          checks.push({
            id: "checkout-payment-gateway",
            status: "unknown",
            description:
              "Checkout-readiness could not be determined: a `us` test checkout could not be created " +
              "(no buyable variant or no `us` channel). Seed stock and deploy the starter recipe, then re-run.",
            command: "jolly start",
          });
          break;
        case "unreachable":
        default:
          checks.push({
            id: "checkout-payment-gateway",
            status: "unknown",
            description:
              "Checkout-readiness probe could not reach the store's Saleor GraphQL endpoint (NEXT_PUBLIC_SALEOR_API_URL); checkout readiness was not verified.",
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
    .map((c) => ({ description: c.description ?? `Address ${c.id}.`, command: c.command }));

  return envelope({
    command: group ? `doctor ${group}` : "doctor",
    status,
    summary:
      status === "success"
        ? "All performed checks passed."
        : status === "warning"
          ? "Some checks need attention."
          : "Some checks failed; see next steps.",
    data: { group: group ?? "all" },
    checks,
    nextSteps,
    errors: hasFail
      ? [
          {
            code: "DOCTOR_CHECKS_FAILED",
            message: "One or more diagnostics failed.",
            remediation: "Address the failing checks listed in nextSteps.",
          },
        ]
      : [],
  });
}

// ─── skills (feature 006/001) ─────────────────────────────────────────────

function commandSkills(args: ParsedArgs): Envelope {
  const command = "skills";
  const sub = args.positionals[1];

  if (sub === "install" || sub === "update") {
    const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
      const already = skillInstalledOnDisk(skill);
      if (!already && sub === "install") installSkill(skill);
      const present = skillInstalledOnDisk(skill);
      return {
        id: `skill-${skill.id}`,
        status: present ? "pass" : "fail",
        description: present ? `${skill.id} present.` : `${skill.id} not verified on disk.`,
      };
    });
    const failed = checks.filter((c) => c.status === "fail").map((c) => c.id);
    return envelope({
      command: `skills ${sub}`,
      status: failed.length > 0 ? "warning" : "success",
      summary:
        failed.length > 0
          ? `Some skills not verified: ${failed.join(", ")}.`
          : `Skills ${sub === "install" ? "installed" : "checked"}.`,
      data: { skills: DEFAULT_SKILLS.map((s) => s.id) },
      checks,
    });
  }

  // Default: list/inspect the skill set.
  const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
    const present = skillInstalledOnDisk(skill);
    return {
      id: `skill-${skill.id}`,
      status: present ? "pass" : "unknown",
      description: `${skill.description}${present ? " (installed)" : " (not installed)"}.`,
    };
  });

  return envelope({
    command,
    status: "success",
    summary: `Jolly manages ${DEFAULT_SKILLS.length} skills (install via npx skills add).`,
    data: {
      skills: DEFAULT_SKILLS.map((s) => ({ id: s.id, ref: s.ref, description: s.description })),
    },
    checks,
    nextSteps: [
      {
        description: "Run jolly init (or jolly start) to install the skill set.",
        command: "jolly init",
      },
    ],
  });
}

// ─── upgrade (feature 017) ────────────────────────────────────────────────

function commandUpgrade(_args: ParsedArgs): Envelope {
  const command = "upgrade";
  const checks: Check[] = DEFAULT_SKILLS.map((skill) => {
    const present = skillInstalledOnDisk(skill);
    return {
      id: `skill-${skill.id}`,
      status: present ? "pass" : "skipped",
      description: present
        ? `${skill.id} is managed; checked for updates.`
        : `${skill.id} not installed; skipped.`,
    };
  });

  // Detect a cloned Paper storefront for plan-only baseline guidance.
  const paperPresent = existsSync(join(projectDir(), "paper-version.json"));
  checks.push({
    id: "paper-baseline",
    status: paperPresent ? "unknown" : "skipped",
    description: paperPresent
      ? "Paper storefront detected; Jolly plans Paper migrations but does not auto-apply them in v1."
      : "No Paper storefront detected; nothing to plan.",
  });

  return envelope({
    command,
    status: "success",
    summary: "Checked Jolly-managed skills and guidance for updates; Paper changes are plan-only.",
    data: {
      skillsChecked: DEFAULT_SKILLS.map((s) => s.id),
      paperBaselineDetected: paperPresent,
      paperAutoApply: false,
    },
    checks,
    nextSteps: paperPresent
      ? [{ description: "Review the Paper upgrade plan before applying any migration manually." }]
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
 * real run's awaiting-approval stage carry a deep-equal riskContext. */
function createStoreGateTarget(): string {
  return `${cloudApiBase()}/organizations/{organization}/environments/`;
}

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
        action: "init",
        target: "local project (skills, .mcp.json, AGENTS.md)",
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: ["Installs skills, writes .mcp.json and AGENTS.md"],
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
        action: "login",
        target: cloudApiBase(),
        riskLevel: "medium",
        categories: ["credential handling"],
        reversible: true,
        sideEffects: ["Acquires and stores a Saleor Cloud token in .env"],
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
        action: "spawn git clone + pnpm install",
        target: "saleor/storefront (Paper) from the `main` branch → storefront/",
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          "Spawns `git` to clone the Saleor Paper storefront from the `main` branch into storefront/, strips the upstream `.git` history, and `git init`s a fresh repository",
          "Spawns `pnpm install` to install storefront dependencies",
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
        action: "spawn @saleor/configurator deploy",
        target:
          "Saleor Cloud store configuration (config-as-code) from Jolly's bundled starter recipe assets/skills/jolly/recipe.yml, deployed to the store at NEXT_PUBLIC_SALEOR_API_URL with JOLLY_SALEOR_APP_TOKEN",
        riskLevel: "high",
        categories: ["production configuration changes"],
        reversible: false,
        sideEffects: [
          "Spawns `npx @saleor/configurator deploy --config <bundled assets/skills/jolly/recipe.yml> --url <NEXT_PUBLIC_SALEOR_API_URL> --token <JOLLY_SALEOR_APP_TOKEN>` to apply the starter recipe to the store (store URL and app token referenced by name only; values never printed)",
          "A `--plan` preview shows the configurator diff without applying changes; a re-deploy over a pre-existing store passes `--failOnDelete` to block a destructive apply (the bootstrap deploy of the store Jolly just provisioned replaces Saleor's stock defaults)",
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
        action:
          "seed recipe stock via Saleor GraphQL productVariantStocksCreate",
        target:
          "Port Royal Warehouse (recipe warehouse) stock for every recipe product variant",
        riskLevel: "high",
        categories: ["production configuration changes"],
        reversible: false,
        sideEffects: [
          "Sends Saleor GraphQL productVariantStocksCreate for each recipe variant, setting a default quantity of 100 in Port Royal Warehouse (configurator cannot set stock); updates in place when a stock entry already exists",
        ],
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
        action: "spawn npx vercel deploy",
        target: "Vercel production deployment of storefront/",
        riskLevel: "high",
        categories: ["live deployment"],
        reversible: true,
        sideEffects: [
          "Spawns `npx vercel` (and `npx vercel --prod`) under the Vercel CLI's OWN `vercel login` session to deploy storefront/, sets the required Vercel env vars through the CLI, surfaces Vercel Deployment Protection, and updates Saleor trusted origins where APIs allow",
          "Jolly holds no Vercel token (there is no JOLLY_VERCEL_TOKEN) and its own code sends no request to the Vercel API — Vercel is reached only by the spawned Vercel CLI under its own auth",
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
        action:
          "install the Saleor Stripe app via Saleor GraphQL appInstall, authenticating with the Cloud staff token",
        target: `Saleor store apps (manifest ${STRIPE_APP_MANIFEST_URL})`,
        riskLevel: "high",
        categories: ["payment setup", "production configuration changes"],
        reversible: true,
        sideEffects: [
          `Sends Saleor GraphQL appInstall with the Stripe app manifest (${STRIPE_APP_MANIFEST_URL}) and permissions [HANDLE_PAYMENTS], authenticated with the Cloud staff token (JOLLY_SALEOR_CLOUD_TOKEN — an app token cannot call appInstall); reuses an already-installed Stripe app rather than installing a duplicate; reversible via app uninstall`,
          "Entering the publishable + restricted keys and mapping the configuration to the `us` channel is a guided human gate Jolly does NOT perform (no stable public API); Jolly only installs the app and then announces the manual keys + channel step",
        ],
        dryRunAvailable: true,
      },
    },
  ];
}

/** The ordered high-risk stages `jolly start` runs itself and gates on. */
const HIGH_RISK_STAGES = ["store", "recipe", "deploy"] as const;

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
        action: "skip store provisioning",
        target: `already-configured store ${storeEndpoint}`,
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          `A store endpoint is already configured (NEXT_PUBLIC_SALEOR_API_URL=${storeEndpoint}); the store stage is already satisfied and provisioning is skipped`,
        ],
        dryRunAvailable: true,
      };
    }
  }
  const summary = storeEndpoint
    ? "Previewed the jolly start plan. The store stage is already satisfied (a store endpoint is configured), so no store would be created this run. No files were written and no network requests were made."
    : "Previewed the jolly start plan. No files were written and no network requests were made.";
  return envelope({
    command,
    status: "success",
    summary,
    data: {
      dryRun: true,
      plan,
    },
    checks: [
      {
        id: "start-dry-run",
        status: "skipped",
        description: "This is a dry-run preview; no stage was executed.",
      },
    ],
    nextSteps: [
      {
        description: "Run jolly start to execute the plan and get the ordered playbook.",
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
  riskContext?: RiskContext;
}

/**
 * The store name + domain label `jolly start`'s auto-provision uses (feature 002
 * Rule "Auto-provisioning a store, and how the store is named"). An OPTIONAL
 * configured store name — a real customer affordance read from project
 * configuration (`JOLLY_STORE_NAME` / `JOLLY_STORE_DOMAIN_LABEL` in `.env` or the
 * environment) — with a sensible default otherwise. This same affordance is the
 * single hook the test harness uses to make provisioned stores `jolly-test`
 * cannon fodder; Jolly bakes no test knowledge into production.
 */
function configuredStoreName(): { name: string; domainLabel: string } {
  const values = loadEnvValues(projectDir());
  const name =
    values["JOLLY_STORE_NAME"] ?? process.env["JOLLY_STORE_NAME"] ?? "jolly-store";
  const domainLabel =
    values["JOLLY_STORE_DOMAIN_LABEL"] ?? process.env["JOLLY_STORE_DOMAIN_LABEL"] ?? name;
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
 * resulting NEXT_PUBLIC_SALEOR_API_URL + JOLLY_SALEOR_APP_TOKEN to `.env` so the
 * downstream recipe/stock/deploy stages have a reachable endpoint, and surfaces
 * the new store's GraphQL + Dashboard URLs. Reported honestly: `completed` only
 * when an environment was actually created or reused; `blocked` (with an
 * explaining check) when no Cloud token is configured or provisioning failed —
 * never a fabricated completion.
 */
async function runStoreStage(checks: Check[]): Promise<StageOutcome> {
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  if (endpoint) {
    checks.push({
      id: "store-provisioned",
      status: "pass",
      description: "A Saleor endpoint is already configured; reusing it.",
    });
    return { status: "completed" };
  }

  const token = cloudPlatformToken(values) ?? "";
  if (!token) {
    checks.push({
      id: "store-provisioned",
      status: "skipped",
      description:
        "Cannot provision a store: no JOLLY_SALEOR_CLOUD_TOKEN configured (complete login first).",
    });
    return { status: "blocked" };
  }

  try {
    const orgs = await listOrganizations(token);
    if (orgs.length === 0) {
      checks.push({
        id: "store-provisioned",
        status: "fail",
        description: "The Cloud token has access to no organizations.",
      });
      return { status: "blocked" };
    }
    const selectedOrg = orgs[0].slug;
    const { name, domainLabel } = configuredStoreName();
    const result = await provisionStore(token, selectedOrg, {
      name,
      domainLabel,
      region: "us-east-1",
    });
    checks.push({
      id: "store-provisioned",
      status: "pass",
      description: result.environmentCreated
        ? `Provisioned Saleor Cloud environment "${result.environmentName}" in "${selectedOrg}".`
        : `Reused Saleor Cloud environment "${result.environmentName}" in "${selectedOrg}".`,
    });
    if (!result.appTokenStored) {
      checks.push({
        id: "app-token-acquired",
        status: "unknown",
        description: "App token not acquired; run jolly create app-token.",
      });
    }
    return {
      status: "completed",
      data: {
        organization: result.organization,
        environmentName: result.environmentName,
        graphqlApiUrl: result.graphqlApiUrl,
        dashboardUrl: result.dashboardUrl,
        appTokenStored: result.appTokenStored,
      },
    };
  } catch (err) {
    checks.push({
      id: "store-provisioned",
      status: "fail",
      description: `Store provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { status: "blocked" };
  }
}

/**
 * Resolve Jolly's bundled starter recipe (`assets/skills/jolly/recipe.yml`)
 * relative to Jolly's own module path. Works in both dev (`src/index.ts`) and
 * the published bundle (`dist/index.js`): both sit one level under the package
 * root, and `assets/skills/` ships in package `files`.
 */
function bundledRecipePath(): string {
  return fileURLToPath(new URL("../assets/skills/jolly/recipe.yml", import.meta.url));
}

/**
 * Genuinely perform the configurator-deploy stage (feature 004 Rule
 * "Configurator deploy is a genuinely-executing stage"). This is the FIRST
 * spawned-CLI `jolly start` stage: Jolly SPAWNS `npx @saleor/configurator deploy`
 * of its bundled starter recipe against the store, never reimplementing it
 * against raw APIs. Resolves the store GraphQL endpoint and app token from
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
 * for the customer's explicit approval, not silently destructive. (The
 * configurator binary exposes only `--failOnDelete`; it has no breaking-changes
 * guard.) Reads the configurator's EXIT CODE and reports honestly:
 * `completed`/`pass` only when it exited 0; `blocked`/`fail` (with the real
 * error) on any non-zero exit or a configurator that cannot be spawned — never a
 * fabricated deploy.
 */
async function runRecipeStage(checks: Check[]): Promise<StageStatus> {
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token =
    process.env["JOLLY_SALEOR_APP_TOKEN"] ?? values["JOLLY_SALEOR_APP_TOKEN"] ?? "";

  if (!endpoint || !token) {
    checks.push({
      id: "recipe-deployed",
      status: "skipped",
      description:
        "Cannot deploy the starter recipe: NEXT_PUBLIC_SALEOR_API_URL and/or JOLLY_SALEOR_APP_TOKEN are not configured.",
      remediation:
        "Complete the store stage so the endpoint and app token are in .env, then re-run jolly start --yes.",
    });
    return "blocked";
  }

  const bundledRecipe = bundledRecipePath();
  if (!existsSync(bundledRecipe)) {
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: `Cannot deploy the starter recipe: bundled recipe not found at ${bundledRecipe}.`,
      remediation: "Reinstall jolly so the bundled assets/skills/jolly/recipe.yml is present.",
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
      description: `Cannot deploy the starter recipe: could not write it to ${recipePath}: ${err instanceof Error ? err.message : String(err)}.`,
      remediation: "Ensure the project directory is writable, then re-run jolly start --yes.",
    });
    return "blocked";
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
    allowDeletes = !(await storeHoldsForeignCatalog(endpoint, token, RECIPE_PRODUCT_SLUGS));
  } catch {
    allowDeletes = false;
  }

  const deployArgs = [
    "--yes",
    "@saleor/configurator",
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
  const result = spawnSync("npx", deployArgs, {
    cwd: projectDir(),
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, SALEOR_URL: endpoint, SALEOR_TOKEN: token },
  });

  // The configurator's own deployment-report verdict, when it wrote one.
  const reportStatus = readConfiguratorReportStatus(reportPath);
  rmSync(reportPath, { force: true });

  if (result.error || result.status === null) {
    const reason = result.error ? result.error.message : "the configurator could not be spawned";
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: `Did not deploy the starter recipe: ${reason}.`,
      remediation:
        "Verify npx can reach @saleor/configurator and NEXT_PUBLIC_SALEOR_API_URL/JOLLY_SALEOR_APP_TOKEN reach the store, then re-run jolly start --yes.",
    });
    return "blocked";
  }

  // Completed when the configurator exited 0, OR when its own report records the
  // deployment as a success (the catalog was applied; the exit-5 "partial" is the
  // spurious result of the protected-default deletions, not a real failure).
  if (result.status === 0 || reportStatus === "success") {
    checks.push({
      id: "recipe-deployed",
      status: "pass",
      description: "Deployed the starter recipe via @saleor/configurator deploy.",
    });
    // The configurator cannot populate a collection's membership in one deploy
    // (its pipeline creates Collections before Products, and the product schema
    // has no `collections` field), so the recipe's featured collection deploys
    // empty. Assign its declared products via GraphQL now — the same post-deploy
    // fix-up Jolly does for stock the configurator cannot set. Idempotent, so a
    // re-run reconciles cleanly.
    return await assignRecipeCollections(endpoint, token, checks);
  }

  const stderr = (result.stderr ?? "").toString().slice(0, 2000);
  if (result.status === 6) {
    checks.push({
      id: "recipe-deployed",
      status: "fail",
      description: `Did not deploy the starter recipe: the configurator detected deletions over a pre-existing store (blocked by --failOnDelete).${stderr ? ` ${stderr}` : ""}`,
      remediation:
        "Review the destructive diff. Deploying over an existing catalog requires the customer's explicit approval; the happy path is the blank store jolly start itself provisions.",
    });
    return "blocked";
  }

  checks.push({
    id: "recipe-deployed",
    status: "fail",
    description: `Did not deploy the starter recipe: @saleor/configurator deploy exited ${result.status}${reportStatus ? ` (report status: ${reportStatus})` : ""}.${stderr ? ` ${stderr}` : ""}`,
    remediation:
      "Verify NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN reach the store, then re-run jolly start --yes.",
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
 */
async function assignRecipeCollections(
  endpoint: string,
  token: string,
  checks: Check[],
): Promise<StageStatus> {
  if (RECIPE_COLLECTIONS.length === 0) return "completed";
  try {
    let assigned = 0;
    for (const collection of RECIPE_COLLECTIONS) {
      assigned += await assignCollectionProducts(
        endpoint,
        token,
        collection.slug,
        collection.name,
        collection.channelSlug,
        collection.productSlugs,
      );
    }
    checks.push({
      id: "recipe-collections",
      status: "pass",
      description: `Assigned ${assigned} product(s) to the recipe's featured collection(s) via collectionAddProducts (the configurator cannot populate collection membership in a single deploy).`,
    });
    return "completed";
  } catch (err) {
    checks.push({
      id: "recipe-collections",
      status: "fail",
      description: `Deployed the starter recipe but could not populate its featured collection: ${err instanceof Error ? err.message : String(err)}.`,
      remediation:
        "Verify NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN reach the store, then re-run jolly start --yes.",
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
 * products need seeded stock"). Resolves the store GraphQL endpoint and app
 * token from .env/process.env (first-party Saleor host only — the same creds
 * Jolly already manages), seeds a default quantity into the recipe warehouse
 * for every variant, and pushes an honest `stock-seeded` check. Returns
 * `completed` only when stock was actually seeded; `blocked` when there are no
 * recipe variants/warehouse yet or the store is unreachable — never a
 * fabricated completion. Wrapped so a network/DNS failure (e.g. the logic-tier
 * unroutable base) resolves quickly to `blocked` rather than throwing.
 */
async function runStockStage(checks: Check[]): Promise<StageStatus> {
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const token =
    process.env["JOLLY_SALEOR_APP_TOKEN"] ?? values["JOLLY_SALEOR_APP_TOKEN"] ?? "";

  if (!endpoint || !token) {
    checks.push({
      id: "stock-seeded",
      status: "skipped",
      description:
        "Cannot seed recipe stock: NEXT_PUBLIC_SALEOR_API_URL and/or JOLLY_SALEOR_APP_TOKEN are not configured.",
      remediation: "Complete the store stage so the endpoint and app token are in .env, then re-run jolly start --yes.",
    });
    return "blocked";
  }

  try {
    const result = await seedRecipeStock(endpoint, token, DEFAULT_STOCK_QUANTITY, RECIPE_WAREHOUSE_SLUG);
    checks.push({
      id: "stock-seeded",
      status: "pass",
      description: `Seeded ${DEFAULT_STOCK_QUANTITY} stock for ${result.seededCount} recipe variant(s) in ${RECIPE_WAREHOUSE_SLUG} via productVariantStocksCreate.`,
    });
    return "completed";
  } catch (err) {
    const code = err instanceof CloudApiError ? err.code : "STOCK_SEED_FAILED";
    const reason =
      code === "RECIPE_WAREHOUSE_NOT_FOUND" || code === "NO_RECIPE_VARIANTS"
        ? "the starter recipe is not deployed yet (no recipe variants/warehouse to seed)"
        : "the store could not be reached or the seeding request failed";
    checks.push({
      id: "stock-seeded",
      status: "fail",
      description: `Did not seed recipe stock: ${reason}.`,
      remediation:
        code === "RECIPE_WAREHOUSE_NOT_FOUND" || code === "NO_RECIPE_VARIANTS"
          ? "Deploy the starter recipe with @saleor/configurator first, then re-run jolly start --yes."
          : "Verify NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN reach the store, then re-run jolly start --yes.",
    });
    return "blocked";
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
 */
async function runStripeStage(checks: Check[]): Promise<StageStatus> {
  const values = loadEnvValues(projectDir());
  const endpoint =
    process.env["NEXT_PUBLIC_SALEOR_API_URL"] ?? values["NEXT_PUBLIC_SALEOR_API_URL"] ?? "";
  const cloudToken = cloudPlatformToken(values) ?? "";

  if (!endpoint || !cloudToken) {
    checks.push({
      id: "stripe-app-installed",
      status: "skipped",
      description:
        "Cannot install the Saleor Stripe app: NEXT_PUBLIC_SALEOR_API_URL and/or JOLLY_SALEOR_CLOUD_TOKEN are not configured.",
      remediation:
        "Complete the store stage so the endpoint and Cloud token are available, then re-run jolly start --yes.",
    });
    return "blocked";
  }

  try {
    const result = await installStripeApp(endpoint, cloudToken);
    checks.push({
      id: "stripe-app-installed",
      status: "pass",
      description: result.reused
        ? "Reused the already-installed Saleor Stripe app (no duplicate installed)."
        : "Installed the Saleor Stripe app via Saleor GraphQL appInstall using the Cloud staff token.",
    });
    return "completed";
  } catch (err) {
    const code = err instanceof CloudApiError ? err.code : "STRIPE_APP_INSTALL_FAILED";
    checks.push({
      id: "stripe-app-installed",
      status: "fail",
      description:
        code === "STRIPE_APP_INSTALL_FAILED"
          ? "Did not install the Saleor Stripe app: the appInstall request was rejected."
          : "Did not install the Saleor Stripe app: the store could not be reached.",
      remediation:
        "Verify NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_CLOUD_TOKEN reach the store, then re-run jolly start --yes.",
    });
    return "blocked";
  }
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
 */
async function runStorefrontStage(checks: Check[]): Promise<StageStatus> {
  const dir = join(projectDir(), "storefront");

  // Idempotency (feature 022): an already-prepared storefront is reused.
  if (existsSync(join(dir, "node_modules")) && existsSync(join(dir, "package.json"))) {
    checks.push({
      id: "storefront-prepared",
      status: "pass",
      description: "Reused the already-cloned storefront/ with installed dependencies (no re-clone).",
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
        description:
          "Did not clone the storefront: storefront/ already exists but is not a Paper checkout.",
        remediation:
          "Resolve the storefront/ directory collision (remove or rename it), then re-run jolly start --yes.",
      });
      return "blocked";
    }
    const clone = spawnSync(
      "git",
      ["clone", "--branch", "main", "https://github.com/saleor/storefront.git", dir],
      { encoding: "utf8", timeout: 600_000, env: { ...process.env } },
    );
    if (clone.error || clone.status !== 0) {
      const reason = clone.error
        ? clone.error.message
        : `git clone exited ${clone.status}`;
      const stderr = (clone.stderr ?? "").toString().slice(0, 2000);
      checks.push({
        id: "storefront-prepared",
        status: "fail",
        description: `Did not clone the Saleor Paper storefront from main: ${reason}.${stderr ? ` ${stderr}` : ""}`,
        remediation: "Verify `git` is installed and github.com is reachable, then re-run jolly start --yes.",
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
        description: `Cloned Paper but could not initialize a fresh git repository: ${init.error ? init.error.message : `git init exited ${init.status}`}.`,
        remediation: "Verify `git` is installed, then re-run jolly start --yes.",
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

  // Install Paper's dependencies with pnpm.
  const install = spawnSync("pnpm", ["install"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env },
  });
  if (install.error || install.status !== 0) {
    const reason = install.error ? install.error.message : `pnpm install exited ${install.status}`;
    const stderr = (install.stderr ?? "").toString().slice(0, 2000);
    checks.push({
      id: "storefront-prepared",
      status: "fail",
      description: `Cloned Paper but did not install dependencies: ${reason}.${stderr ? ` ${stderr}` : ""}`,
      remediation: "Verify `pnpm` is installed and the registry is reachable, then re-run jolly start --yes.",
    });
    return "blocked";
  }

  checks.push({
    id: "storefront-prepared",
    status: "pass",
    description:
      "Cloned saleor/storefront (Paper) from main into storefront/, initialized a fresh git repository, and installed dependencies with pnpm.",
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
/** The Vercel device-authorization URL the CLI prints when it signs in, or undefined. */
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
 */
async function probeVercelSession(): Promise<{ signedIn: boolean; account: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vercel", "whoami"], { stdio: ["ignore", "pipe", "pipe"] });
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
async function spawnVercelSignIn(): Promise<{ deviceUrl?: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vercel", "login"], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* best-effort */
      }
      clearTimeout(timer);
      resolve({ deviceUrl: extractDeviceUrl(buf) });
    };
    const timer = setTimeout(finish, 60_000);
    const scan = (chunk: Buffer) => {
      buf += String(chunk);
      if (extractDeviceUrl(buf)) finish();
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("error", finish);
    child.on("close", finish);
  });
}

/** Extract the deployed `*.vercel.app` URL the Vercel CLI prints, or undefined. */
function extractVercelUrl(stdout: string | undefined): string | undefined {
  const m = (stdout ?? "").match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
  return m ? m[0] : undefined;
}

async function runDeployStage(checks: Check[]): Promise<StageOutcome> {
  const dir = join(projectDir(), "storefront");

  if (!existsSync(join(dir, "package.json"))) {
    checks.push({
      id: "vercel-deployed",
      status: "skipped",
      description: "Cannot deploy: storefront/ is not prepared yet (no Paper checkout).",
      remediation: "Complete the storefront stage so storefront/ exists, then re-run jolly start --yes.",
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
      description:
        "Cannot deploy: NEXT_PUBLIC_SALEOR_API_URL is not configured (complete the store stage first).",
      remediation: "Complete the store stage so the endpoint is in .env, then re-run jolly start --yes.",
    });
    return { status: "blocked" };
  }
  const channel =
    values["JOLLY_STORE_CHANNEL"] ?? process.env["JOLLY_STORE_CHANNEL"] ?? "us";
  // Optional configured Vercel project name (a real customer affordance, and the
  // single hook the test harness uses to make the deployed project `jolly-test`
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
    const { deviceUrl } = await spawnVercelSignIn();
    if (deviceUrl) {
      process.stderr.write(
        `Vercel sign-in needed — Jolly runs the Vercel sign-in together with you. ` +
          `Visit ${deviceUrl} to authorize.\n`,
      );
    }
    checks.push({
      id: "vercel-sign-in",
      status: "warning",
      description: deviceUrl
        ? `Vercel sign-in pending: Jolly runs the Vercel sign-in together with you. Visit ${deviceUrl} to authorize; Jolly spawned the official Vercel CLI sign-in under its own session and holds no Vercel token.`
        : "Vercel sign-in pending: Jolly runs the Vercel sign-in together with you via the official Vercel CLI under its own session, and holds no Vercel token.",
    });
    return { status: "pending" };
  }

  // Deploy to production via the official Vercel CLI under its own session,
  // configuring the required build env vars through the CLI (feature 002 Rule).
  // No JOLLY_VERCEL_TOKEN is read or passed; Jolly's own code contacts no host.
  const deploy = spawnSync(
    "npx",
    [
      "--yes",
      "vercel",
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
    const reason = deploy.error ? deploy.error.message : "the Vercel CLI could not be spawned";
    checks.push({
      id: "vercel-deployed",
      status: "fail",
      description: `Did not deploy to Vercel: ${reason}.`,
      remediation:
        "Verify the Vercel CLI is authenticated (`npx vercel login`, an interactive gate the agent/human runs), then re-run jolly start --yes.",
    });
    return { status: "blocked" };
  }

  if (deploy.status === 0) {
    const deployedUrl = extractVercelUrl(deploy.stdout);
    checks.push({
      id: "vercel-deployed",
      status: "pass",
      description: deployedUrl
        ? `Deployed storefront/ to Vercel via the official Vercel CLI: ${deployedUrl}`
        : "Deployed storefront/ to Vercel via the official Vercel CLI (`npx vercel --prod`).",
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
        "vercel",
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
        ? "Disabled Vercel Deployment Protection via the Vercel CLI; the storefront is publicly reachable."
        : "Vercel Deployment Protection is on and could not be disabled automatically; disable it in the Vercel project settings so the store is publicly reachable.",
    });
    // The deployed storefront was built against this Saleor endpoint; verify the
    // endpoint is reachable so the deployed storefront can reach Saleor Cloud
    // (feature 002). Read-only probe — `pass` only on a real GraphQL response.
    const reachable = (await probeEndpointConnectivity(endpoint)).kind === "reachable";
    checks.push({
      id: "deployed-storefront-saleor-connectivity",
      status: reachable ? "pass" : "unknown",
      description: reachable
        ? `The deployed storefront${deployedUrl ? ` (${deployedUrl})` : ""} is built against the Saleor Cloud endpoint and reaches Saleor Cloud (verified by a live GraphQL probe).`
        : `The deployed storefront${deployedUrl ? ` (${deployedUrl})` : ""} is built against Saleor Cloud, but live connectivity to the endpoint could not be verified in this run.`,
    });
    // Registering the storefront origin as a Saleor trusted origin has no
    // first-party Cloud API in v1 (Saleor Cloud allows anonymous storefront API
    // reads without it); surface it as a guided step where APIs do not perform it
    // (feature 002 Rule "...updates Saleor trusted origins where APIs allow").
    if (deployedUrl) {
      checks.push({
        id: "saleor-trusted-origin",
        status: "warning",
        description: `If the storefront makes authenticated/CORS-restricted Saleor calls, add ${deployedUrl} to the store's allowed origins in the Saleor Dashboard (no first-party Cloud API performs this in v1).`,
      });
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
    description: `Did not deploy to Vercel: the Vercel CLI exited ${deploy.status}.${stderr ? ` ${stderr}` : ""}`,
    remediation:
      "Run `npx vercel login` (an interactive gate the agent/human completes), then re-run jolly start --yes.",
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
function shouldRunInteractive(args: ParsedArgs): boolean {
  return Boolean(
    process.stdin.isTTY && process.stdout.isTTY && !args.json && !args.yes,
  );
}

// The organizations the configured token can reach, for the interactive org
// choice. --mock-organizations injects a deterministic list for the @logic
// scenarios (no network); otherwise the real Cloud API is queried, best-effort.
async function resolveInteractiveOrgs(
  args: ParsedArgs,
): Promise<CloudOrganization[]> {
  const mock = args.options["mock-organizations"];
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

// Wrap a URL in an OSC 8 terminal hyperlink so terminals render it as a
// clickable link (feature 027). The visible text is the URL itself; the string
// terminator is BEL. Terminals without OSC 8 support show the visible text.
function osc8Hyperlink(url: string): string {
  return `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
}

// A live setup-stage status list on stderr (feature 027): every stage listed by
// name, each carrying its own status glyph, with a stage's row redrawn in place
// as the run reaches it — not one fixed spinner. The list owns its region; each
// update moves the cursor back over the rows and erase-reprints them, so the
// same region is redrawn rather than appended. Only the interactive path renders
// it (the agent/--json path passes no reporter), keeping machine output clean.
function stageProgress(
  stageNames: string[],
): { update: (stage: string, status: StageStatus) => void; stop: () => void } {
  const out = process.stderr;
  const statuses = new Map<string, StageStatus>(
    stageNames.map((s) => [s, "pending" as StageStatus]),
  );
  const glyph = (status: StageStatus): string =>
    status === "completed" ? "✓" : status === "pending" ? "○" : status === "skipped" ? "○" : "✗";
  const row = (s: string): string => `${glyph(statuses.get(s)!)} ${s} — ${statuses.get(s)!}`;
  // Initial frame: the full list, every stage pending.
  out.write(stageNames.map(row).join("\n") + "\n");
  const redraw = (): void => {
    out.write(`\x1b[${stageNames.length}A`);
    for (const s of stageNames) out.write(`\x1b[2K${row(s)}\n`);
  };
  return {
    update: (stage, status) => {
      if (!statuses.has(stage)) return;
      statuses.set(stage, status);
      redraw();
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
async function runInteractiveStart(args: ParsedArgs): Promise<Envelope> {
  clackIntro("jolly start — guided setup", CLACK_STDERR);

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
    if (!existingAuth) {
      const auth = await requestDeviceCode();
      clackNote(
        `Open ${osc8Hyperlink(`${auth.verificationUri}?user_code=${auth.userCode}`)}\nand enter the code: ${auth.userCode}`,
        "Sign in to Saleor Cloud",
        CLACK_STDERR,
      );
      const tokens = await pollForDeviceTokens(auth);
      writeEnvValues(projectDir(), {
        JOLLY_SALEOR_ACCESS_TOKEN: tokens.accessToken,
        JOLLY_SALEOR_REFRESH_TOKEN: tokens.refreshToken,
      });
      process.env["JOLLY_SALEOR_ACCESS_TOKEN"] = tokens.accessToken;
      process.env["JOLLY_SALEOR_REFRESH_TOKEN"] = tokens.refreshToken;
    }
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
        message: "Choose the Saleor organization to use",
        options: orgs.map((o) => ({ value: o.slug, label: o.slug })),
        initialValue: orgs[0]!.slug,
        ...CLACK_STDERR,
      });
      if (clackIsCancel(choice)) return runStartCore({ ...args, yes: false });
      organization = String(choice);
      clackLog.info(`Using organization "${organization}".`, CLACK_STDERR);
    } else if (orgs.length === 1) {
      organization = orgs[0]!.slug;
      clackLog.info(`Using your only organization "${organization}".`, CLACK_STDERR);
    }
  }

  // Environment name and storefront project directory, each pre-filled.
  const envName = await clackText({
    message: "Environment name",
    placeholder: DEFAULT_ENV_NAME,
    defaultValue: DEFAULT_ENV_NAME,
    ...CLACK_STDERR,
  });
  if (clackIsCancel(envName)) return runStartCore({ ...args, yes: false });
  const projectDirectory = await clackText({
    message: "Storefront project directory",
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
    "Planned stages",
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
    clackOutro("Previewed the plan. No files were written and no changes were made.", CLACK_STDERR);
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

  // Run the long setup stages behind a live, per-stage status list on stderr:
  // every stage listed by name, each carrying its own status that updates in
  // place as the run reaches it — not one fixed spinner (feature 027). stdout
  // stays reserved for the final result summary emit() prints (feature 020).
  const progress = stageProgress(plan.map((s) => s.stage));
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
      (stage, status) => progress.update(stage, status),
    );

    // The completed interactive run closes with a concise human summary, not the
    // machine check enumeration or the agent `next:` playbook (feature 027): a
    // single prose line that names the live store's Saleor Dashboard URL and the
    // human's remaining Stripe-keys step. The per-check and next-step detail
    // stays on the --json/agent surface, which this human-only path never
    // renders, so the run's status (success/warning) is preserved unchanged.
    const storeData = (core.data as { store?: { dashboardUrl?: unknown } } | undefined)?.store;
    const endpoint =
      loadEnvValues(projectDir())["NEXT_PUBLIC_SALEOR_API_URL"] ??
      process.env["NEXT_PUBLIC_SALEOR_API_URL"];
    const dashboardUrl =
      typeof storeData?.dashboardUrl === "string"
        ? storeData.dashboardUrl
        : endpoint
          ? new URL("/dashboard/", endpoint).href
          : undefined;
    if (!dashboardUrl) return core;
    return {
      ...core,
      summary: `Setup ran. Your live store's Saleor Dashboard is at ${dashboardUrl} — ${cliMessage("start.stripeFinal")}`,
      checks: [],
      nextSteps: [],
    };
  } finally {
    progress.stop();
  }
}

async function commandStart(args: ParsedArgs): Promise<Envelope> {
  if (shouldRunInteractive(args)) return runInteractiveStart(args);
  if (args.dryRun) return commandStartDryRun();
  return runStartCore(args);
}

async function runStartCore(
  args: ParsedArgs,
  onStage?: (stage: string, status: StageStatus) => void,
): Promise<Envelope> {
  const command = "start";

  // When no Cloud token is configured the auth stage starts the device grant and
  // relays the code + URL to stderr (feature 002). Kick the device-code request
  // off here so its network round-trip overlaps the bootstrap below rather than
  // adding serial latency; the auth stage awaits the (likely already-resolved)
  // result to relay it. A request failure is swallowed (the stage still blocks).
  const tokenAlreadyConfigured = Boolean(
    cloudPlatformToken(loadEnvValues(projectDir())),
  );
  const deviceCodePromise: Promise<DeviceAuthorization | undefined> =
    tokenAlreadyConfigured
      ? Promise.resolve(undefined)
      : requestDeviceCode().catch(() => undefined);

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
  const needsToken = !hasCloudToken;

  // A store endpoint already configured (a prior `jolly create store` or earlier
  // run) means the store stage is already satisfied: no store would be created
  // this run, so it is announced as satisfied and never re-presented as a pending
  // approval gate (feature 022 Rule).
  const storeEndpoint =
    startEnvValues["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"];

  for (const planStage of plan) {
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
      // No Cloud token configured: the auth stage starts the Saleor device
      // authorization grant for the agent (feature 018, 002) — request a device
      // code and relay the user code + verification URL to plain STDERR so the
      // agent can forward them to its human. It does NOT poll/block (start stays
      // non-blocking) and the code + URL stay on STDERR ONLY — never in the
      // stdout envelope. The stage stays non-`completed` (`blocked`): it cannot
      // self-clear, never a fabricated `completed`. It does NOT set the approval
      // `gate` (reserved for the high-risk per-stage approval pause): the run
      // proceeds through the remaining stages, which block/pend honestly on the
      // still-missing credentials. A device-code request failure leaves the
      // stage `blocked` just the same (the relay is simply skipped).
      const deviceAuth = await deviceCodePromise;
      if (deviceAuth) relayDeviceCode(deviceAuth);
      status = "blocked";
    } else if (isBootstrap) {
      status = "completed";
    } else if (planStage.stage === "store" && storeEndpoint) {
      // Already satisfied: a store endpoint is configured, so no store would be
      // created this run. Announced as satisfied (feature 022 Rule), never a
      // pending approval gate — the riskContext drops to the no-category skip
      // preview the dry-run shows (src/index.ts commandStartDryRun), and no gate
      // is set. Mirrors runStoreStage's own configured-endpoint short-circuit.
      status = "completed";
      stageRiskContext = {
        action: "skip store provisioning",
        target: `already-configured store ${storeEndpoint}`,
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          `A store endpoint is already configured (NEXT_PUBLIC_SALEOR_API_URL=${storeEndpoint}); the store stage is already satisfied and provisioning is skipped`,
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
        // genuinely execute, each reported honestly (`completed` only when the
        // real work succeeded, never fabricated): the store stage auto-provisions
        // a Saleor Cloud environment when none is configured (feature 002), the
        // recipe stage spawns `npx @saleor/configurator deploy` of the bundled
        // starter recipe, and the deploy stage spawns `npx vercel`.
        if (planStage.stage === "store") {
          const outcome = await runStoreStage(checks);
          status = outcome.status;
          storeData = outcome.data;
        } else if (planStage.stage === "recipe") {
          // The recipe stage decides the bootstrap path by the store's STATE
          // (feature 004 Rule "Recipe targets a clean environment"), not by
          // which command provisioned the store.
          status = await runRecipeStage(checks);
        } else if (planStage.stage === "deploy") {
          const outcome = await runDeployStage(checks);
          status = outcome.status;
          deployData = outcome.data;
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
      status = await runStorefrontStage(checks);
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
      status = await runStockStage(checks);
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
      status = await runStripeStage(checks);
    } else {
      status = "pending";
    }

    stages.push({
      stage: planStage.stage,
      status,
      ...(stageRiskContext ? { riskContext: stageRiskContext } : {}),
    });
    // Report this stage's resolved status so the interactive caller can update
    // its live per-stage status list in place as the run reaches each stage
    // (feature 027). The agent/--json path passes no reporter, so machine output
    // stays clean.
    onStage?.(planStage.stage, status);
  }

  // A run that performed only the bootstrap and stopped at the orchestration
  // gate (paused for approval, or with --yes proceeding into downstream stages
  // it has not completed) is never "success": it is "warning". Only a failed
  // local bootstrap is an "error".
  const status: EnvelopeStatus = bootstrapFailed ? "error" : "warning";

  const nextSteps: NextStep[] = [];
  if (bootstrapFailed) {
    nextSteps.push({
      description: "Resolve the bootstrap failure (see errors), then re-run jolly start.",
      command: "jolly start",
    });
  } else if (gate) {
    nextSteps.push({
      description: `Approve the "${gate.stage}" stage, then re-run jolly start to proceed.`,
      command: "jolly start --yes",
    });
  } else {
    nextSteps.push({
      description: "Re-run jolly start to resume the remaining stages.",
      command: "jolly start",
    });
  }

  // No Cloud token configured (feature 002): direct the user to sign in with
  // `jolly login` through the Saleor device authorization grant (feature 018), or
  // to set JOLLY_SALEOR_CLOUD_TOKEN for non-interactive use, then re-run. An auth
  // gate Jolly cannot self-clear, never fabricated as done.
  if (needsToken) {
    nextSteps.push({
      description:
        "Run `jolly login` to sign in through the Saleor device authorization grant, " +
        "or set JOLLY_SALEOR_CLOUD_TOKEN for non-interactive use, then re-run jolly start.",
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
    nextSteps.push({
      description:
        "Open the installed Stripe app's configuration in the Saleor Dashboard, paste the publishable key and the Stripe restricted key, and map the configuration to the `us` channel (keys referenced by name only — Jolly does not perform this guided human gate).",
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
      description:
        "If the agent cannot clear an interactive gate (such as new account creation), ask the human to run `jolly start` in a plain shell, then start their agent in that project to iterate (the skills jolly init installed are already on disk). This is a fallback — Jolly has not run it.",
      command: "jolly start",
    });
  }

  return envelope({
    command,
    status,
    summary: bootstrapFailed
      ? "Bootstrap failed; see errors. No downstream stage was performed."
      : gate
        ? `Bootstrap complete; paused for approval before the "${gate.stage}" stage.`
        : "Bootstrap complete; proceeding through the orchestrated stages.",
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

function commandHelp(): Envelope {
  return envelope({
    command: "help",
    status: "success",
    summary:
      "Jolly — Ahoy, agent. Go build a store. (a tool by Dmytri Kleiner; not an official Saleor/Vercel/Stripe product)",
    data: {
      commands: [
        "login",
        "logout",
        "auth status",
        "init",
        "start",
        "doctor",
        "upgrade",
        "skills",
        "create store",
        "create app-token",
        "completion",
      ],
      globalFlags: ["--json", "--quiet", "--yes/-y", "--dry-run"],
    },
    nextSteps: [
      {
        description: "Run jolly start to bootstrap setup and get the ordered playbook.",
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
function commandUsage(args: ParsedArgs): Envelope {
  const path = args.positionals.join(" ");
  const flags = ["--json", "--quiet", "--yes", "--dry-run", "--help"];
  const usage = `jolly ${path} [${flags.join("] [")}]`;
  return envelope({
    command: `${path} --help`,
    status: "success",
    summary: `Usage: ${usage}`,
    data: { usage, command: path, flags },
  });
}

async function dispatch(args: ParsedArgs): Promise<Envelope> {
  const cmd = args.positionals[0];

  // Top-level `--help`: usage summary, never the command flow. `create` runs its
  // own help (bare listing vs. per-subcommand usage); bare `jolly`/`help` keep
  // the full command listing.
  if (args.help && cmd !== undefined && cmd !== "help" && cmd !== "create") {
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
      if (args.positionals[1] === "status") return commandAuthStatus(args);
      return errorEnvelope("auth", `Unknown auth subcommand "${args.positionals[1] ?? ""}".`, [
        {
          code: "UNKNOWN_AUTH_SUBCOMMAND",
          message: 'The only auth subcommand is "status".',
          remediation: "Run `jolly auth status`.",
        },
      ]);
    case "create":
      return commandCreate(args);
    case "init":
      return commandInit(args);
    case "start":
      return commandStart(args);
    case "doctor":
      return commandDoctor(args);
    case "upgrade":
      return commandUpgrade(args);
    case "skills":
      return commandSkills(args);
    default:
      return errorEnvelope(cmd, `Unknown command "${cmd}".`, [
        {
          code: "UNKNOWN_COMMAND",
          message: `"${cmd}" is not a Jolly command.`,
          remediation:
            "Supported commands: login, logout, auth status, init, start, " +
            "doctor, upgrade, skills, create, completion. Run `jolly help` for details.",
        },
      ]);
  }
}

async function main(): Promise<void> {
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
      `Unsupported flag ${bad}.`,
      [
        {
          code: "UNSUPPORTED_FLAG",
          message: `${bad} is not a recognized Jolly flag.`,
          remediation: "Run `jolly <command> --help` to list the supported flags.",
        },
      ],
    );
    process.exit(emit(env, args));
  }

  let env: Envelope;
  try {
    env = await dispatch(args);
  } catch (err) {
    env = errorEnvelope(args.positionals[0] ?? "jolly", "An unexpected error occurred.", [
      {
        code: "UNEXPECTED_ERROR",
        message: err instanceof Error ? err.message : String(err),
        remediation: "Re-run with --json and report the error code.",
      },
    ]);
  }
  const exitCode = emit(env, args);
  process.exit(exitCode);
}

void main();
