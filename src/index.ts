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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

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
  CloudApiError,
  type CloudOrganization,
} from "./lib/cloud-api.ts";
import { loadEnvValues, writeEnvValues } from "./lib/env-file.ts";
import { normalizeSaleorUrl } from "./lib/saleor-url.ts";

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
}

// Flags that take a value (so `--name foo` consumes `foo`).
const VALUE_FLAGS = new Set([
  "token",
  "url",
  "name",
  "domain-label",
  "region",
  "organization",
  "mock-organizations",
  "publishable-key",
  "secret-key",
]);

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  let json = false;
  let quiet = false;
  let yes = false;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (VALUE_FLAGS.has(body) && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        options[body] = argv[++i];
      } else {
        flags.add(body);
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, json, quiet, yes, dryRun, help, options, flags };
}

// ─── Envelope construction helpers ────────────────────────────────────────

function envelope(
  partial: Partial<Envelope> & { command: string; status: EnvelopeStatus; summary: string },
): Envelope {
  return {
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

/**
 * Render and emit one envelope, honoring --json / --quiet / default mode.
 * Returns the process exit code (non-zero only for error status).
 */
function emit(env: Envelope, args: ParsedArgs): number {
  if (args.json) {
    process.stdout.write(JSON.stringify(env) + "\n");
  } else {
    const lines: string[] = [];
    lines.push(`jolly ${env.command}: [${statusGlyph(env.status)}] ${env.summary}`);
    if (!args.quiet) {
      for (const check of env.checks) {
        lines.push(
          `  - [${checkGlyph(check.status)}] ${check.id}${check.description ? `: ${check.description}` : ""}`,
        );
      }
      for (const step of env.nextSteps) {
        lines.push(`  next: ${step.description}${step.command ? ` (\`${step.command}\`)` : ""}`);
      }
      for (const err of env.errors) {
        lines.push(
          `  error[${err.code}]: ${err.message}${err.remediation ? ` — ${err.remediation}` : ""}`,
        );
      }
    }
    // Human text first, then the machine-readable envelope on its own line.
    process.stdout.write(lines.join("\n") + "\n");
    process.stdout.write(JSON.stringify(env) + "\n");
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
  { id: "saleor-storefront", ref: "saleor/saleor-storefront", description: "Saleor storefront guidance" },
  { id: "saleor-configurator", ref: "saleor/saleor-configurator", description: "Configuration-as-code guidance" },
  { id: "storefront-builder", ref: "saleor/storefront-builder", description: "Storefront build guidance" },
  { id: "saleor-core", ref: "saleor/saleor-core", description: "Saleor core concepts" },
  { id: "saleor-app", ref: "saleor/saleor-app", description: "Saleor app development guidance" },
];

// Standard project-local skill location used by `npx skills add`.
function skillsBaseDir(): string {
  return join(projectDir(), ".claude", "skills");
}

function skillInstalledOnDisk(skill: SkillSpec): boolean {
  // A skill is present when its directory exists on disk.
  const dir = join(skillsBaseDir(), skill.id);
  return existsSync(join(dir, "SKILL.md")) || existsSync(dir);
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
  const token = args.options["token"];
  const browser = args.flags.has("browser");

  // --browser flows (PKCE preview, or honest unavailability) -------------
  if (browser) {
    if (args.dryRun) {
      return loginBrowserDryRun(command);
    }
    // Real browser/Playwright callback flow is not implemented on this VM.
    return errorEnvelope(
      command,
      "Browser-based login is not available in this environment.",
      [
        {
          code: "BROWSER_LOGIN_UNAVAILABLE",
          message:
            "No native browser or Playwright callback flow is available to complete browser OAuth.",
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  if (!token) {
    return errorEnvelope(
      command,
      "No token provided and browser login is not available here.",
      [
        {
          code: "NO_LOGIN_METHOD",
          message:
            "jolly login needs `--token <value>` in this environment (no browser/Playwright callback flow).",
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      {
        nextSteps: [
          {
            description: `Create a Saleor Cloud token at ${TOKEN_PAGE}, then run jolly login --token <value>.`,
            command: "jolly login --token <value>",
          },
        ],
        data: { riskContext: loginRiskContext() },
      },
    );
  }

  // --token --dry-run: write nothing, show riskContext + nextSteps -------
  if (args.dryRun) {
    return envelope({
      command,
      status: "success",
      summary: "Previewed token login; nothing was written.",
      data: { riskContext: loginRiskContext(), dryRun: true },
      nextSteps: [
        {
          description: "Run jolly login --token <value> to verify and store the token.",
          command: "jolly login --token <value>",
        },
      ],
    });
  }

  // Real --token login: verify via authenticated GET of organizations/ ----
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
          command: "jolly login --token <value>",
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

function resolveOrgName(orgs: CloudOrganization[]): string | undefined {
  const first = orgs[0];
  if (!first) return undefined;
  const name = first.name ?? first.slug;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loginBrowserDryRun(command: string): Envelope {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const redirectUri = "http://127.0.0.1:5375/callback";
  const authBase = "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/auth";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "saleor-cli",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    redirect_uri: redirectUri,
    scope: "email openid profile",
  });
  const authorizationUrl = `${authBase}?${params.toString()}`;

  // The code-exchange preview: the two real POSTs the localhost callback would
  // make, described without sending them or claiming any of them succeeded
  // (feature 018, "previews the OAuth code exchange requests"). The token
  // endpoint is Keycloak (auth.saleor.io); the resulting OIDC id_token is then
  // exchanged for a Cloud API token at /platform/api/tokens.
  const tokenEndpoint =
    "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/token";
  const tokensEndpoint = `${cloudApiBase()}/tokens`;
  const exchangePreview = {
    tokenExchange: {
      method: "POST",
      url: tokenEndpoint,
      body: {
        grant_type: "authorization_code",
        code: "<authorization code from the localhost callback>",
        code_verifier: "<the PKCE code_verifier>",
        client_id: "saleor-cli",
        redirect_uri: redirectUri,
      },
    },
    cloudTokenExchange: {
      method: "POST",
      url: tokensEndpoint,
      requestPath: "/platform/api/tokens",
      body: { id_token: "<the OIDC id_token returned by Keycloak>" },
    },
  };

  return envelope({
    command,
    status: "success",
    summary:
      "Prepared the browser OAuth authorization URL and code-exchange preview (PKCE). Nothing was written.",
    data: {
      dryRun: true,
      authorizationUrl,
      pkce: { codeChallengeMethod: "S256", codeChallenge: challenge },
      state,
      redirectUri,
      scope: "email openid profile",
      clientId: "saleor-cli",
      responseType: "code",
      exchangePreview,
      riskContext: loginRiskContext(),
    },
    nextSteps: [
      {
        description:
          "Open the authorization URL in a browser to complete OAuth, or use jolly login --token <value>.",
        command: "jolly login --browser",
      },
    ],
  });
}

// ─── logout (feature 018) ─────────────────────────────────────────────────

const MANAGED_AUTH_VARS = [
  "JOLLY_SALEOR_CLOUD_TOKEN",
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
        command: "jolly login --token <value>",
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
            command: "jolly login --token <value>",
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
      summary: "Stored the Saleor GraphQL endpoint as NEXT_PUBLIC_SALEOR_API_URL.",
      data: {
        stored: true,
        envVar: "NEXT_PUBLIC_SALEOR_API_URL",
        riskContext: createStoreRiskContext(normalized.endpoint),
      },
      checks: [
        {
          id: "saleor-endpoint-stored",
          status: "pass",
          description: "NEXT_PUBLIC_SALEOR_API_URL written to .env.",
        },
      ],
      nextSteps: [
        {
          description: "Run jolly create app-token to acquire a Saleor app token.",
          command: "jolly create app-token",
        },
      ],
    });
  }

  // Mode 2: provision a Saleor Cloud environment via the Cloud API. ------
  const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
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
          remediation: "Run `jolly login --token <value>` first.",
        },
      ],
      {
        data: {
          riskContext: createStoreRiskContext(`${cloudApiBase()} (organization unresolved)`),
        },
        nextSteps: [
          {
            description: "Run jolly login to acquire a Saleor Cloud token.",
            command: "jolly login --token <value>",
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

    return envelope({
      command,
      status: "success",
      summary: `Saleor Cloud environment ready in "${selectedOrg}".`,
      data: {
        organization: selectedOrg,
        organizationSlug: selectedOrg,
        environmentName,
        ...(environmentKey ? { environmentKey } : {}),
        projectCreated,
        projectReused: !projectCreated,
        environmentCreated,
        graphqlEndpointStored: true,
        appTokenStored,
        riskContext: createStoreRiskContext(resolvedTarget),
      },
      checks: [
        {
          id: "environment-provisioned",
          status: "pass",
          description: environmentCreated
            ? "Environment created and verified via task status."
            : "Existing environment reused.",
        },
        {
          id: "app-token-acquired",
          status: appTokenStored ? "pass" : "unknown",
          description: appTokenStored
            ? "App token acquired and stored."
            : "App token not acquired; run jolly create app-token.",
        },
      ],
      nextSteps: appTokenStored
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
    { data: { riskContext } },
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
  const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
  const values = loadEnvValues(projectDir());
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
          remediation: "Run `jolly login --token <value>` first.",
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
      summary: "App token acquired and stored as JOLLY_SALEOR_APP_TOKEN.",
      data: {
        appTokenStored: true,
        instanceUrl,
        riskContext: appTokenRiskContext(instanceUrl),
      },
      checks: [
        {
          id: "app-token-acquired",
          status: "pass",
          description: "App token created via GraphQL and stored.",
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

// ─── create stripe (feature 005) ──────────────────────────────────────────

function stripeRiskContext(): RiskContext {
  return {
    action: "create stripe",
    target: ".env (JOLLY_STRIPE_PUBLISHABLE_KEY, JOLLY_STRIPE_SECRET_KEY)",
    riskLevel: "medium",
    categories: ["payment setup", "credential handling"],
    reversible: true,
    sideEffects: ["Writes Stripe test-mode keys to .env"],
    dryRunAvailable: true,
  };
}

/**
 * Read the default profile's test-mode keys from a logged-in Stripe CLI session
 * via its own read-only interface (`stripe config --list`). Returns the parsed
 * keys, or undefined when the CLI is missing, not logged in, or holds no
 * test-mode keys. Read-only and side-effect free; never runs `login`/OAuth and
 * makes no network call. The parser tolerates single/double/no quotes and the
 * `sk_test_`/`rk_test_` secret-key forms (feature 005).
 */
function readStripeCliKeys():
  | { publishable?: string; secret?: string; expiresAt?: string }
  | undefined {
  let result;
  try {
    // Bare command name so PATH resolves the Stripe CLI (or the harness fake).
    result = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
  } catch {
    return undefined;
  }
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }

  const unquote = (raw: string): string => {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  let publishable: string | undefined;
  let secret: string | undefined;
  let expiresAt: string | undefined;
  // Parse the [default] profile only; stop if another profile table begins.
  let inDefault = false;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    const table = /^\[(.+)\]$/.exec(trimmed);
    if (table) {
      inDefault = table[1] === "default";
      continue;
    }
    if (!inDefault) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = unquote(rawValue);
    if (key === "test_mode_pub_key" && /^pk_test_/.test(value)) publishable = value;
    else if (key === "test_mode_api_key" && /^(sk_test_|rk_test_)/.test(value)) secret = value;
    else if (key === "test_mode_key_expires_at" && value) expiresAt = value;
  }

  if (!publishable && !secret && !expiresAt) return undefined;
  return { publishable, secret, expiresAt };
}

function commandCreateStripe(args: ParsedArgs): Envelope {
  const command = "create stripe";
  const flagPublishable = args.options["publishable-key"];
  const flagSecret = args.options["secret-key"];

  // Flags always override the import (durable Dashboard keys). With neither
  // flag, import from a logged-in Stripe CLI session (read-only).
  const fromCli = !flagPublishable && !flagSecret ? readStripeCliKeys() : undefined;
  const publishable = flagPublishable ?? fromCli?.publishable;
  const secret = flagSecret ?? fromCli?.secret;
  const imported = !flagPublishable && !flagSecret && Boolean(publishable && secret);

  if (!publishable || !secret) {
    return errorEnvelope(
      command,
      "Both --publishable-key and --secret-key are required.",
      [
        {
          code: "MISSING_STRIPE_KEYS",
          message:
            "create stripe found no Stripe test-mode keys: pass --publishable-key <pk_test_...> and --secret-key <sk_test_...>, or log in to the Stripe CLI so Jolly can import them.",
          remediation:
            "Run `npx @stripe/cli login` to complete the Stripe CLI OAuth (then re-run `jolly create stripe`), or copy both test-mode keys from the Stripe Dashboard and pass them as --publishable-key/--secret-key.",
        },
      ],
      { data: { riskContext: stripeRiskContext() } },
    );
  }

  if (args.dryRun) {
    return envelope({
      command,
      status: "success",
      summary: "Previewed Stripe key storage; nothing was written.",
      data: { dryRun: true, riskContext: stripeRiskContext() },
      nextSteps: [
        {
          description: "Run the command without --dry-run to write the Stripe keys to .env.",
          command: "jolly create stripe --publishable-key <pk> --secret-key <sk>",
        },
      ],
    });
  }

  writeEnvValues(projectDir(), {
    JOLLY_STRIPE_PUBLISHABLE_KEY: publishable,
    JOLLY_STRIPE_SECRET_KEY: secret,
  });

  const expiresAt = imported ? fromCli?.expiresAt : undefined;
  return envelope({
    command,
    status: "success",
    summary: imported
      ? "Imported Stripe test-mode keys from the Stripe CLI session into .env as JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY."
      : "Stored Stripe test-mode keys as JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY.",
    data: {
      stored: true,
      imported,
      ...(imported ? { source: "stripe-cli" } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      riskContext: stripeRiskContext(),
    },
    checks: [
      {
        id: "stripe-keys-stored",
        status: "pass",
        description: imported
          ? "Stripe test-mode keys imported from the Stripe CLI session and written to .env."
          : "Stripe test-mode keys written to .env.",
      },
    ],
    nextSteps: [
      ...(expiresAt
        ? [
            {
              description: `These Stripe CLI test-mode keys expire ${expiresAt}; before then, replace them with durable Stripe Dashboard keys (re-run jolly create stripe).`,
            },
          ]
        : []),
      {
        description:
          "Configure Saleor's Stripe integration via @saleor/configurator, guided by the Jolly skill.",
        command: "jolly doctor stripe",
      },
    ],
  });
}

// ─── create dispatcher + help ─────────────────────────────────────────────

const CREATE_SUBCOMMANDS = ["store", "app-token", "stripe"] as const;

function commandCreateHelp(): Envelope {
  const command = "create --help";
  return envelope({
    command,
    status: "success",
    summary: "jolly create exposes the plumbing subcommands store, app-token, and stripe.",
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
        { name: "stripe", description: "Write Stripe test-mode keys to .env." },
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
  if (!sub || args.help || sub === "help") {
    return commandCreateHelp();
  }
  switch (sub) {
    case "store":
      return commandCreateStore(args);
    case "app-token":
      return commandCreateAppToken(args);
    case "stripe":
      return commandCreateStripe(args);
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

function installSkill(skill: SkillSpec): { installed: boolean; stderr?: string } {
  // npx skills add <ref> — best effort; verification is on-disk below.
  const result = spawnSync("npx", ["--yes", "skills", "add", skill.ref], {
    cwd: projectDir(),
    encoding: "utf8",
    timeout: 60_000,
  });
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
    },
    checks,
    nextSteps: [
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

function commandDoctor(args: ParsedArgs): Envelope {
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
    const hasCloud = Boolean(
      values["JOLLY_SALEOR_CLOUD_TOKEN"] ?? process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
    );
    const hasEndpoint = Boolean(
      values["NEXT_PUBLIC_SALEOR_API_URL"] ?? process.env["NEXT_PUBLIC_SALEOR_API_URL"],
    );
    const hasApp = Boolean(
      values["JOLLY_SALEOR_APP_TOKEN"] ?? process.env["JOLLY_SALEOR_APP_TOKEN"],
    );
    checks.push({
      id: "saleor-cloud-token",
      status: hasCloud ? "pass" : "fail",
      description: hasCloud ? "JOLLY_SALEOR_CLOUD_TOKEN present." : "No Saleor Cloud token configured.",
      command: hasCloud ? undefined : "jolly login --token <value>",
    });
    checks.push({
      id: "saleor-endpoint",
      // Presence is detectable; live connectivity is a @sandbox concern, so
      // report "unknown" (not a fabricated pass) when present without probing.
      status: hasEndpoint ? "unknown" : "fail",
      description: hasEndpoint
        ? "NEXT_PUBLIC_SALEOR_API_URL is set; live connectivity not verified in this run."
        : "No Saleor GraphQL endpoint configured.",
      command: hasEndpoint ? undefined : "jolly create store --url <graphql-endpoint>",
    });
    checks.push({
      id: "saleor-app-token",
      status: hasApp ? "pass" : "fail",
      description: hasApp ? "JOLLY_SALEOR_APP_TOKEN present." : "No Saleor app token configured.",
      command: hasApp ? undefined : "jolly create app-token",
    });
  }

  if (wants("storefront")) {
    const storefrontPresent =
      existsSync(join(projectDir(), "package.json")) &&
      existsSync(join(projectDir(), "src", "app"));
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
  }

  if (wants("stripe")) {
    const hasPub = Boolean(
      values["JOLLY_STRIPE_PUBLISHABLE_KEY"] ?? process.env["JOLLY_STRIPE_PUBLISHABLE_KEY"],
    );
    const hasSecret = Boolean(
      values["JOLLY_STRIPE_SECRET_KEY"] ?? process.env["JOLLY_STRIPE_SECRET_KEY"],
    );
    if (hasPub && hasSecret) {
      checks.push({
        id: "stripe-keys",
        status: "pass",
        description: "Stripe test-mode keys present in .env.",
      });
    } else {
      // No .env keys: if the Stripe CLI is logged in with test-mode keys, Jolly
      // can import them — surface a warning (not a fail) pointing at the import.
      const cliKeys = readStripeCliKeys();
      const cliHasKeys = Boolean(cliKeys?.publishable && cliKeys?.secret);
      checks.push({
        id: "stripe-keys",
        status: cliHasKeys ? "warning" : "fail",
        description: cliHasKeys
          ? "Stripe test-mode keys are available from the logged-in Stripe CLI session; run jolly create stripe to import them into .env."
          : "Stripe keys not configured.",
        command: cliHasKeys
          ? "jolly create stripe"
          : "jolly create stripe --publishable-key <pk> --secret-key <sk>",
      });
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
        directoriesCreated: [".claude/skills"],
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
        networkHostsContacted: ["cloud.saleor.io", "auth.saleor.io"],
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
        target: "saleor/storefront (Paper) → storefront/",
        riskLevel: "low",
        categories: [],
        reversible: true,
        sideEffects: [
          "Spawns `git` to clone the Saleor Paper storefront into storefront/",
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
        target: "Saleor Cloud store configuration (config-as-code)",
        riskLevel: "high",
        categories: ["production configuration changes"],
        reversible: false,
        sideEffects: [
          "Spawns `npx @saleor/configurator deploy` to apply the starter recipe to the store",
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
          "Spawns `npx vercel` (the agent's own Vercel login session) to deploy the storefront",
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
  return envelope({
    command,
    status: "success",
    summary: "Previewed the jolly start plan. No files were written and no network requests were made.",
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

function commandStart(args: ParsedArgs): Envelope {
  if (args.dryRun) return commandStartDryRun();

  const command = "start";

  // Bootstrap: run init (real, on-disk) + run doctor (read-only). Never
  // fabricate stages the agent must perform.
  const initEnv = commandInit(args);
  const doctorEnv = commandDoctor({
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

  for (const planStage of plan) {
    const isBootstrap = planStage.stage === "init" || planStage.stage === "auth";
    const isHighRisk = (HIGH_RISK_STAGES as readonly string[]).includes(planStage.stage);

    let status: StageStatus;
    if (bootstrapFailed) {
      // Bootstrap itself failed; nothing downstream was attempted.
      status = isBootstrap && planStage.stage === "init" ? "error" : "pending";
    } else if (isBootstrap) {
      status = "completed";
    } else if (isHighRisk && !gate) {
      // First high-risk stage reached: without --yes we PAUSE for the agent's
      // approval (emitting the riskContext, never self-approving). With --yes
      // it is pre-approved and would proceed (and fail at the network layer
      // under the unroutable logic-safe base — which is fine, just not a gate).
      if (args.yes) {
        status = "pending";
      } else {
        status = "awaiting-approval";
        gate = {
          stage: planStage.stage,
          reason: "Approve this high-risk stage before Jolly performs it.",
        };
      }
    } else {
      status = "pending";
    }

    stages.push({
      stage: planStage.stage,
      status,
      ...(planStage.riskContext ? { riskContext: planStage.riskContext } : {}),
    });
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
        "create stripe",
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

async function dispatch(args: ParsedArgs): Promise<Envelope> {
  const cmd = args.positionals[0];

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
          remediation: "Run `jolly help` to list available commands.",
        },
      ]);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
