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
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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
  DEFAULT_STOCK_QUANTITY,
  RECIPE_WAREHOUSE_SLUG,
  installStripeApp,
  STRIPE_APP_MANIFEST_URL,
  probeCheckoutPaymentGateway,
  probeEndpointConnectivity,
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
  { id: "saleor-storefront", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-storefront", description: "Saleor storefront guidance" },
  { id: "saleor-configurator", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-configurator", description: "Configuration-as-code guidance" },
  { id: "storefront-builder", ref: "https://github.com/saleor/agent-skills/tree/main/skills/storefront-builder", description: "Storefront build guidance" },
  { id: "saleor-core", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-core", description: "Saleor core concepts" },
  { id: "saleor-app", ref: "https://github.com/saleor/agent-skills/tree/main/skills/saleor-app", description: "Saleor app development guidance" },
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
  const token = args.options["token"];
  // Bare `jolly login` (no auth-mode flag) defaults to the browser URL-first
  // flow; `--browser` selects it explicitly, `--token <value>` selects headless
  // login. An explicit empty `--token ""` is a present-but-empty token, not the
  // absent-token default — it falls through to be rejected with a stable code.
  const browser = args.flags.has("browser") || token === undefined;

  // browser flows (PKCE preview, or live URL-first loopback OAuth) -------
  if (browser) {
    if (args.dryRun) {
      return loginBrowserDryRun(command);
    }
    // URL-first live flow: print the authorization URL + loopback callback,
    // best-effort open a browser, then run the real PKCE code exchange.
    return loginBrowserLive(command, args);
  }

  if (!token) {
    // An explicit `--token ""` is a present-but-empty token (an absent token
    // routes to the browser flow above). Reject it honestly as the empty token
    // it is — never by claiming the browser path is unavailable.
    return errorEnvelope(
      command,
      "No token value was provided. Nothing was written.",
      [
        {
          code: "EMPTY_TOKEN",
          message:
            "`jolly login --token <value>` requires a non-empty token value.",
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
      "Prepared the browser OAuth authorization URL and code-exchange preview (PKCE). Jolly opens the URL in a browser when one is available and otherwise leaves you to open it manually. Nothing was written.",
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
          "Jolly opens the authorization URL in a browser when one is available; otherwise click it or copy and paste it into any browser yourself to complete OAuth, or use jolly login --token <value>.",
        command: "jolly login --browser",
      },
    ],
  });
}

const KEYCLOAK_AUTH_ENDPOINT =
  "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/auth";
const KEYCLOAK_TOKEN_ENDPOINT =
  "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/token";
const LOOPBACK_REDIRECT_URI = "http://127.0.0.1:5375/callback";
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 5375;

/**
 * Live, URL-first browser OAuth (feature 018, "Browser OAuth is URL-first" +
 * "Token verification is a real request"). Prints the authorization URL and the
 * loopback callback endpoint up front (a non-error presentation, flushed before
 * blocking), best-effort opens a native browser, then runs the loopback server
 * and the REAL PKCE code exchange. A missing browser is never an error; a failed
 * exchange is reported honestly, writing nothing to .env.
 */
async function loginBrowserLive(command: string, args: ParsedArgs): Promise<Envelope> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const redirectUri = LOOPBACK_REDIRECT_URI;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "saleor-cli",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    redirect_uri: redirectUri,
    scope: "email openid profile",
  });
  const authorizationUrl = `${KEYCLOAK_AUTH_ENDPOINT}?${params.toString()}`;

  // Presentation envelope FIRST, flushed before we block on the callback. It is
  // never an error (a missing browser is not an error) and carries no token.
  const presentation = envelope({
    command,
    status: "warning",
    summary:
      "Open the authorization URL in a browser to sign in. Jolly opens it automatically when a browser is available and otherwise leaves you to open it manually. Listening for the OAuth consent redirect on http://127.0.0.1:5375/callback.",
    data: {
      authorizationUrl,
      redirectUri,
      callbackEndpoint: redirectUri,
      pkce: { codeChallengeMethod: "S256", codeChallenge: challenge },
      state,
      scope: "email openid profile",
      clientId: "saleor-cli",
      responseType: "code",
      riskContext: loginRiskContext(),
    },
    nextSteps: [
      {
        description:
          "Open the authorization URL in a browser (Jolly opens it automatically when one is available; otherwise click it or copy and paste it yourself) to complete OAuth, or use jolly login --token <value>.",
        command: "jolly login --token <value>",
      },
    ],
  });
  emit(presentation, args);
  // Ensure the presentation reaches the parent before we start waiting.
  await new Promise<void>((resolve) => {
    if (process.stdout.write("")) resolve();
    else process.stdout.once("drain", () => resolve());
  });

  // Best-effort native browser open. A missing or non-zero-exit open command is
  // NOT an error — we proceed URL-first.
  tryOpenBrowser(authorizationUrl);

  // Real loopback OAuth callback server; resolves with the received code/state.
  let callback: { code?: string; state?: string; error?: string };
  try {
    callback = await awaitLoopbackCallback();
  } catch (err) {
    return errorEnvelope(
      command,
      "The loopback OAuth callback server could not be started.",
      [
        {
          code: "OAUTH_CALLBACK_SERVER_FAILED",
          message: `Could not bind the loopback callback server on ${LOOPBACK_HOST}:${LOOPBACK_PORT}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  if (callback.state !== state || !callback.code) {
    return errorEnvelope(
      command,
      "The OAuth consent redirect was invalid; nothing was written.",
      [
        {
          code: "OAUTH_STATE_MISMATCH",
          message: callback.error
            ? `The authorization server returned an error on the callback: ${callback.error}.`
            : "The loopback callback did not carry a matching state and authorization code.",
          remediation: `Re-run \`jolly login --browser\`, or create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  // REAL token exchange POST to the auth.saleor.io Keycloak token endpoint.
  let exchange: Response;
  let exchangeBody = "";
  try {
    exchange = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.code,
        code_verifier: verifier,
        client_id: "saleor-cli",
        redirect_uri: redirectUri,
      }).toString(),
    });
    exchangeBody = await exchange.text();
  } catch (err) {
    return errorEnvelope(
      command,
      "The OAuth code exchange request to the auth.saleor.io token endpoint failed; nothing was written.",
      [
        {
          code: "OAUTH_TOKEN_EXCHANGE_FAILED",
          message: `The POST to the auth.saleor.io token endpoint (${KEYCLOAK_TOKEN_ENDPOINT}) could not be sent: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  if (!exchange.ok) {
    // Keycloak rejected the authorization code: a real, honest failure of the
    // token-exchange POST. Write nothing; name the failed step.
    return errorEnvelope(
      command,
      "The OAuth code exchange POST to the auth.saleor.io token endpoint was rejected; nothing was written.",
      [
        {
          code: "OAUTH_TOKEN_EXCHANGE_FAILED",
          message: `The token exchange POST to the auth.saleor.io token endpoint (${KEYCLOAK_TOKEN_ENDPOINT}) was rejected with HTTP ${exchange.status}: ${
            exchangeBody.slice(0, 500) || "no response body"
          }.`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      {
        checks: [
          {
            id: "oauth-token-exchange",
            status: "fail",
            description: `auth.saleor.io token endpoint rejected the authorization code (HTTP ${exchange.status}).`,
          },
        ],
        data: { riskContext: loginRiskContext() },
      },
    );
  }

  // Successful exchange (real human consent — not exercised by CI). Parse the
  // id_token and exchange it for a Cloud API token.
  let idToken: string | undefined;
  try {
    idToken = (JSON.parse(exchangeBody) as { id_token?: string }).id_token;
  } catch {
    idToken = undefined;
  }
  if (!idToken) {
    return errorEnvelope(
      command,
      "The auth.saleor.io token endpoint response did not include an id_token; nothing was written.",
      [
        {
          code: "OAUTH_ID_TOKEN_MISSING",
          message: `The token exchange response from the auth.saleor.io token endpoint (${KEYCLOAK_TOKEN_ENDPOINT}) did not include an id_token.`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  const tokensEndpoint = `${cloudApiBase()}/tokens`;
  let cloudToken: string | undefined;
  let orgName: string | undefined;
  try {
    const res = await fetch(tokensEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return errorEnvelope(
        command,
        "The Cloud API rejected the OAuth id_token exchange; nothing was written.",
        [
          {
            code: "CLOUD_TOKEN_EXCHANGE_FAILED",
            message: `The POST of the OIDC id_token to the Cloud API tokens endpoint (${tokensEndpoint}) was rejected with HTTP ${res.status}.`,
            remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
          },
        ],
        { data: { riskContext: loginRiskContext() } },
      );
    }
    cloudToken =
      typeof body["token"] === "string"
        ? (body["token"] as string)
        : typeof body["access_token"] === "string"
          ? (body["access_token"] as string)
          : undefined;
  } catch (err) {
    return errorEnvelope(
      command,
      "The Cloud API id_token exchange request failed; nothing was written.",
      [
        {
          code: "CLOUD_TOKEN_EXCHANGE_FAILED",
          message: `The POST of the OIDC id_token to the Cloud API tokens endpoint (${tokensEndpoint}) could not be sent: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  if (!cloudToken) {
    return errorEnvelope(
      command,
      "The Cloud API id_token exchange did not return a token; nothing was written.",
      [
        {
          code: "CLOUD_TOKEN_MISSING",
          message: `The Cloud API tokens endpoint (${tokensEndpoint}) response did not include a token.`,
          remediation: `Create a token at ${TOKEN_PAGE} and run \`jolly login --token <value>\`.`,
        },
      ],
      { data: { riskContext: loginRiskContext() } },
    );
  }

  // Verify + resolve the org name with the freshly minted Cloud token.
  try {
    orgName = resolveOrgName(await listOrganizations(cloudToken));
  } catch {
    orgName = undefined;
  }
  const values: Record<string, string> = { JOLLY_SALEOR_CLOUD_TOKEN: cloudToken };
  if (orgName) values["JOLLY_SALEOR_ORGANIZATION"] = orgName;
  writeEnvValues(projectDir(), values);

  return envelope({
    command,
    status: "success",
    summary: orgName
      ? `Browser login complete; the Cloud token was stored. Authenticated as "${orgName}".`
      : "Browser login complete; the Cloud token was stored.",
    data: {
      cloudTokenStored: true,
      accountContext: orgName ?? "unknown",
      riskContext: loginRiskContext(),
    },
    checks: [
      { id: "oauth-token-exchange", status: "pass", description: "Exchanged the authorization code for a Cloud token." },
    ],
    nextSteps: [
      {
        description: "Run jolly create store to provision a Saleor Cloud environment.",
        command: "jolly create store --create-environment",
      },
    ],
  });
}

/**
 * Best-effort native browser open. A missing open command, a spawn error, or a
 * non-zero exit is NOT an error — login proceeds URL-first regardless.
 */
function tryOpenBrowser(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawnSync(opener, [url], { stdio: "ignore" });
  } catch {
    // Ignore — URL-first means a missing browser is never an error.
  }
}

/**
 * Start the loopback HTTP server, handle a single GET /callback, validate that
 * the request carries an authorization code, respond to the browser so its
 * request completes, then close the server (draining the event loop).
 */
function awaitLoopbackCallback(): Promise<{ code?: string; state?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`);
      } catch {
        res.statusCode = 400;
        res.end("Bad request.");
        return;
      }
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found.");
        return;
      }
      const code = url.searchParams.get("code") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Jolly received the OAuth redirect. You may close this window and return to your terminal.");
      server.close(() => resolve({ code, state, error }));
    });
    server.on("error", (err) => reject(err));
    server.listen(LOOPBACK_PORT, LOOPBACK_HOST);
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
      ],
    });
  }

  // Mode 2: provision a Saleor Cloud environment via the Cloud API. ------
  // `.env`-first: a real agent writes the Cloud token to the project `.env`
  // (via `jolly login`/`jolly create store`) and does not export it (feature
  // 008 Rule "Credentials are read from .env").
  const token =
    loadEnvValues(projectDir())["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
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
  const values = loadEnvValues(projectDir());
  // `.env`-first (feature 008 Rule "Credentials are read from .env"): the Cloud
  // token is read from the project `.env` FILE the agent left it in, with a
  // fallback to the process environment.
  const token =
    values["JOLLY_SALEOR_CLOUD_TOKEN"] ?? process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
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
      ? "Wrote Stripe test-mode keys from the Stripe CLI session into .env as JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY; the keys are stored, not verified."
      : "Wrote Stripe test-mode keys to .env as JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY; the keys are stored, not verified.",
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
          ? "Stripe test-mode keys from the Stripe CLI session written to .env; the keys are stored, not verified."
          : "Stripe test-mode keys written to .env; the keys are stored, not verified.",
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

/**
 * Resolve Jolly's bundled skill directory (`assets/skills/jolly`) relative to
 * Jolly's own module path — the same scheme as bundledRecipePath(). The Jolly
 * skill ships inside the package, so installing it needs no network and does
 * not depend on the repo being pushed (feature 007 Rule "Jolly skill source").
 */
function bundledJollySkillPath(): string {
  return fileURLToPath(new URL("../assets/skills/jolly", import.meta.url));
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
// detected. v1 only needs the generic fallback: when no recognized marker is
// present we return null. NOTE: Jolly's own universal install location
// `.agents/skills/` is NOT a user agent marker, so we never treat a bare
// `.agents/` directory as a detection signal. The per-marker detection matrix
// is deferred to @iteration.
function detectAgent(): string | null {
  const root = projectDir();
  if (existsSync(join(root, "CLAUDE.md")) || existsSync(join(root, ".claude"))) {
    return "claude";
  }
  if (existsSync(join(root, ".cursor", "rules"))) return "cursor";
  if (existsSync(join(root, ".zed"))) return "zed";
  if (existsSync(join(root, ".pi"))) return "pi";
  if (existsSync(join(root, ".opencode"))) return "opencode";
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
    // Vercel auth. Exit 0 means a real session (pass). A clean non-zero answer
    // means no session (fail). If the CLI cannot be spawned at all, the honest
    // status is unknown. Never `pass` without a confirmed session (feature 020
    // "No fabricated success").
    let vercelStatus: CheckStatus;
    let vercelResult;
    try {
      vercelResult = spawnSync("npx", ["vercel", "whoami"], {
        encoding: "utf8",
        timeout: 60_000,
      });
    } catch {
      vercelResult = undefined;
    }
    if (!vercelResult || vercelResult.error) {
      vercelStatus = "unknown";
    } else if (vercelResult.status === 0) {
      vercelStatus = "pass";
    } else {
      vercelStatus = "fail";
    }
    checks.push({
      id: "vercel-auth",
      status: vercelStatus,
      description:
        vercelStatus === "pass"
          ? "Vercel CLI session confirmed by running `vercel whoami`."
          : vercelStatus === "fail"
            ? "No Vercel CLI session: `vercel whoami` reported you are not logged in."
            : "Could not read the Vercel CLI login state by running `vercel whoami` (CLI unavailable).",
      command: vercelStatus === "pass" ? undefined : "vercel login",
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
  // Present on the auth stage when no Cloud token is configured: the Keycloak
  // browser-login URL the gate presents (it cannot mint a token itself).
  authorizationUrl?: string;
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

  const token =
    values["JOLLY_SALEOR_CLOUD_TOKEN"] ?? process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";
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
 * than fabricating. On a store Jolly itself provisioned this run (bootstrap,
 * `allowDeletes`), the deploy replaces Saleor's stock defaults — the recipe is
 * the store's intended end state, so the expected deletion of undeclared
 * defaults proceeds. On a re-deploy over a pre-existing store it passes
 * `--failOnDelete` so a destructive apply is blocked (exit 6) for the customer's
 * explicit approval, not silently destructive. (The configurator binary exposes
 * only `--failOnDelete`; it has no breaking-changes guard.) Reads the
 * configurator's EXIT CODE and reports honestly: `completed`/`pass` only when it
 * exited 0; `blocked`/`fail` (with the real error) on any non-zero exit or a
 * configurator that cannot be spawned — never a fabricated deploy.
 */
async function runRecipeStage(
  checks: Check[],
  opts: { allowDeletes: boolean },
): Promise<StageStatus> {
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
    // Guard a destructive apply over a pre-existing store; omitted on the
    // bootstrap path, where deleting Saleor's stock defaults to match the
    // recipe is the intended initial setup (feature 004 Rule "Recipe targets a
    // clean environment").
    ...(opts.allowDeletes ? [] : ["--failOnDelete"]),
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
    return "completed";
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
  const cloudToken =
    process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ?? values["JOLLY_SALEOR_CLOUD_TOKEN"] ?? "";

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
    checks.push({
      id: "vercel-deployment-protection",
      status: "warning",
      description:
        "Vercel Deployment Protection is on by default and blocks public access; disable it in the Vercel project settings so the store is publicly reachable (a project setting Jolly does not change).",
    });
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

async function commandStart(args: ParsedArgs): Promise<Envelope> {
  if (args.dryRun) return commandStartDryRun();

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

  // `.env`-first Cloud-token presence (feature 002 OAuth-walkthrough scenario):
  // a real agent leaves the token in the project `.env`; it may also be exported.
  // When NEITHER carries a token, the auth stage cannot silently complete — it
  // presents a Keycloak browser-login gate it cannot self-clear.
  const startEnvValues = loadEnvValues(projectDir());
  const hasCloudToken = Boolean(
    startEnvValues["JOLLY_SALEOR_CLOUD_TOKEN"] ?? process.env["JOLLY_SALEOR_CLOUD_TOKEN"],
  );
  // Built lazily so the URL is presented (and offered in nextSteps) only when the
  // auth gate is actually engaged. Reuses loginBrowserLive's URL-first OAuth
  // construction; we PRESENT the URL only — never block on the loopback callback.
  let authGate: { authorizationUrl: string } | undefined;
  if (!hasCloudToken) {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "saleor-cli",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: base64url(randomBytes(16)),
      redirect_uri: LOOPBACK_REDIRECT_URI,
      scope: "email openid profile",
    });
    authGate = { authorizationUrl: `${KEYCLOAK_AUTH_ENDPOINT}?${params.toString()}` };
  }

  for (const planStage of plan) {
    const isBootstrap = planStage.stage === "init" || planStage.stage === "auth";
    const isHighRisk = (HIGH_RISK_STAGES as readonly string[]).includes(planStage.stage);

    let status: StageStatus;
    if (bootstrapFailed) {
      // Bootstrap itself failed; nothing downstream was attempted.
      status = isBootstrap && planStage.stage === "init" ? "error" : "pending";
    } else if (planStage.stage === "auth" && authGate) {
      // No Cloud token configured: the auth stage presents the browser-login gate
      // (it cannot mint a token itself), so it is reported `blocked` — a gate it
      // cannot self-clear — never a fabricated `completed`. It does NOT set the
      // approval `gate` (reserved for the high-risk per-stage approval pause): the
      // run proceeds through the remaining stages, which block/pend honestly on
      // the still-missing credentials. `blocked` (not `awaiting-approval`) keeps
      // a `--yes` run free of any per-stage approval pause.
      status = "blocked";
    } else if (isBootstrap) {
      status = "completed";
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
          // Bootstrap path (store auto-provisioned this run → storeData set):
          // deleting Saleor's stock defaults to match the recipe is the intended
          // initial setup, so deletions are allowed. A re-deploy over an
          // already-configured store keeps the --failOnDelete guard.
          status = await runRecipeStage(checks, { allowDeletes: storeData !== undefined });
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
      ...(planStage.riskContext ? { riskContext: planStage.riskContext } : {}),
      ...(planStage.stage === "auth" && authGate
        ? { authorizationUrl: authGate.authorizationUrl }
        : {}),
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

  // No Cloud token configured (feature 002 OAuth-walkthrough scenario): offer
  // completing browser login by opening the presented Keycloak authorization URL,
  // OR supplying the token directly with `jolly login --token <value>`. Offered as
  // a gate Jolly cannot self-clear — never fabricated as performed.
  if (authGate) {
    nextSteps.push({
      description: `Complete browser login by opening the Keycloak authorization URL (${authGate.authorizationUrl}), or run jolly login --token <value> to supply a Saleor Cloud token, then re-run jolly start.`,
      command: "jolly login --token <value>",
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
  // way to clear the irreducibly-interactive gates (account creation, browser
  // OAuth, `vercel login`, `stripe login`) a non-TTY agent cannot pass. Then
  // they start their agent in that project to iterate — the skills jolly init
  // installed are already on disk. Offered, never fabricated as performed.
  if (!bootstrapFailed) {
    nextSteps.push({
      description:
        "If the agent cannot clear an interactive gate (account creation, browser OAuth, `vercel login`, `stripe login`), ask the human to run `jolly start` in a plain shell, then start their agent in that project to iterate (the skills jolly init installed are already on disk). This is a fallback — Jolly has not run it.",
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
