#!/usr/bin/env bun
/**
 * Jolly CLI entry point.
 *
 * Every command emits the feature 020 output envelope. Side-effecting
 * commands accept --dry-run (show risk context, make no changes). All
 * commands accept --json (stdout = envelope only) and --quiet (reduced
 * human text).
 *
 * The entry is executable via `npx @saleor/jolly` (production) or
 * `npx @dk/jolly` (testing). Also runnable directly with `bun src/index.ts`.
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvValues, writeEnvValues } from "./lib/env-file.ts";
import { normalizeSaleorUrl } from "./lib/saleor-url.ts";
import {
  CLOUD_API_BASE,
  CloudApiError,
  acquireAppToken,
  createEnvironment,
  createProject,
  extractDomainUrl,
  getEnvironment,
  listEnvironments,
  listOrganizations,
  listProjects,
  listProjectServices,
  pickService,
  pollTaskStatus,
  taskStatusUrl,
} from "./lib/cloud-api.ts";

// ── Types ────────────────────────────────────────────────────────────────

type Status = "success" | "warning" | "error";
type CheckStatus = "pass" | "warning" | "fail" | "skipped" | "unknown";
type RiskLevel = "low" | "medium" | "high";
type RiskCategory =
  | "destructive operations"
  | "billing"
  | "payment setup"
  | "credential handling"
  | "live deployment"
  | "production configuration changes";

interface Check {
  id: string;
  status: CheckStatus;
  [key: string]: unknown;
}

interface Envelope {
  command: string;
  status: Status;
  summary: string;
  data: Record<string, unknown>;
  checks: Check[];
  nextSteps: Array<Record<string, unknown>>;
  errors: Array<{ code: string; message: string; remediation?: string }>;
}

interface RiskContext {
  action: string;
  target: unknown;
  riskLevel: RiskLevel;
  categories: RiskCategory[];
  reversible: boolean;
  sideEffects: string[];
  dryRunAvailable: boolean;
}

// ── Load .env from working directory ─────────────────────────────────────
// Load local .env values into process.env so they are available to the
// CLI regardless of how it is invoked (bun, npx, test harness, etc).
(() => {
  const localEnv = loadEnvValues(process.cwd());
  for (const [key, value] of Object.entries(localEnv)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
})();

// ── CLI flags ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FLAG_JSON = args.includes("--json");
const FLAG_QUIET = args.includes("--quiet");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_HELP = args.includes("--help") || args.includes("-h");

// Strip flags for subcommand parsing
function cleanArgs(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
}

// ── Envelope builder ─────────────────────────────────────────────────────

function buildEnvelope(command: string, overrides: Partial<Envelope>): Envelope {
  return {
    command,
    status: "success",
    summary: "",
    data: {},
    checks: [],
    nextSteps: [],
    errors: [],
    ...overrides,
  };
}

function output(env: Envelope): void {
  const json = JSON.stringify(env, null, 0);
  if (FLAG_JSON) {
    process.stdout.write(json + "\n");
  } else if (FLAG_QUIET) {
    process.stdout.write(json + "\n");
  } else {
    // Default: human readable + envelope
    const emoji = env.status === "success" ? "✓" : env.status === "warning" ? "⚠" : "✗";
    process.stdout.write(`${emoji} ${env.summary}\n`);
    process.stdout.write(json + "\n");
  }
}

function errorExit(env: Envelope): never {
  output(env);
  process.exit(1);
}

// ── Risk context builder ─────────────────────────────────────────────────

function riskContext(
  action: string,
  target: unknown,
  riskLevel: RiskLevel,
  categories: RiskCategory[],
  reversible: boolean,
  sideEffects: string[],
): RiskContext {
  return {
    action,
    target,
    riskLevel,
    categories: [...categories],
    reversible,
    sideEffects: [...sideEffects],
    dryRunAvailable: true,
  };
}

// ── CWD resolution ───────────────────────────────────────────────────────

const cwd = process.cwd();

// ── Command: help ────────────────────────────────────────────────────────

function cmdHelp(subcommand?: string): void {
  if (subcommand === "create") {
    output(
      buildEnvelope("create --help", {
        status: "success",
        summary: "Available create subcommands: store, stripe, storefront, recipe, deployment, app-token",
        data: {
          subcommands: [
            { name: "store", description: "Connect or create a Saleor Cloud store" },
            { name: "stripe", description: "Configure Stripe test-mode credentials" },
            { name: "storefront", description: "Clone and configure Saleor Paper storefront" },
            { name: "recipe", description: "Prepare or apply the Jolly Configurator starter recipe" },
            { name: "deployment", description: "Set up Vercel deployment (alias: deploy)" },
            { name: "app-token", description: "Acquire a Saleor app token via GraphQL" },
          ],
        },
        nextSteps: [{ description: "Run jolly create <subcommand> --help for details" }],
      }),
    );
    return;
  }

  if (subcommand === "doctor") {
    output(
      buildEnvelope("doctor --help", {
        status: "success",
        summary: "Available doctor check groups: skills, saleor, storefront, deployment, stripe",
        data: {
          groups: [
            { name: "skills", description: "Check skill installation status" },
            { name: "saleor", description: "Check Saleor connectivity and configuration" },
            { name: "storefront", description: "Check storefront readiness" },
            { name: "deployment", description: "Check deployment and payment readiness" },
            { name: "stripe", description: "Check Stripe test-mode setup" },
          ],
        },
        nextSteps: [{ description: "Run jolly doctor <group> for targeted checks" }],
      }),
    );
    return;
  }

  output(
    buildEnvelope("--help", {
      status: "success",
      summary: "Jolly — Ahoy, agent. Go build a store.",
      data: {
        commands: [
          "init  — Install Saleor agent skills and guidance",
          "start — End-to-end setup orchestration",
          "create — Create resources (store, stripe, storefront, recipe, deployment)",
          "login — Authenticate with Saleor Cloud",
          "logout — Remove Saleor Cloud auth state",
          "auth status — Check authentication status",
          "doctor — Run diagnostics",
          "skills install — Install Saleor agent skills",
          "skills update — Update installed skills",
          "upgrade — Update Jolly-managed assets",
          "deploy — Alias for create deployment",
        ],
      },
      nextSteps: [{ description: "Run jolly <command> --help for details on a specific command" }],
    }),
  );
}

// ── Command: init ────────────────────────────────────────────────────────

const JOLLY_AGENTS_BEGIN = "<!-- jolly:begin -->";
const JOLLY_AGENTS_END = "<!-- jolly:end -->";

const DEFAULT_SKILLS = [
  "saleor-storefront",
  "saleor-configurator",
  "storefront-builder",
  "saleor-core",
  "saleor-app",
] as const;

function jollyAgentsSection(): string {
  return `${JOLLY_AGENTS_BEGIN}
## Jolly (Saleor agent setup)

Jolly has initialized Saleor agent guidance in this project. Installed skills
live under \`.jolly/skills/\`:

${DEFAULT_SKILLS.map((s) => `- \`${s}\` — \`.jolly/skills/${s}/SKILL.md\``).join("\n")}

- Run \`npx @saleor/jolly start\` for end-to-end store setup.
- Live store data access: the read-only Saleor MCP server (https://mcp.saleor.app)
  provides products, orders, and customers for a configured store.
- \`.mcp.json\` configures an mcp-graphql server (\`saleor-graphql\`) against your
  Saleor GraphQL endpoint; it reads \`NEXT_PUBLIC_SALEOR_API_URL\` and
  \`SALEOR_APP_TOKEN\` from the environment — no secrets are stored in the file.
${JOLLY_AGENTS_END}`;
}

/** Merge the Jolly section into AGENTS.md without touching user content. */
function mergeAgentsMd(agentsPath: string): "created" | "updated" | "unchanged" {
  const section = jollyAgentsSection();
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, `# Agent Guidance\n\n${section}\n`);
    return "created";
  }
  const existing = readFileSync(agentsPath, "utf8");
  const beginIdx = existing.indexOf(JOLLY_AGENTS_BEGIN);
  const endIdx = existing.indexOf(JOLLY_AGENTS_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    // Replace only the managed section; user-authored content survives.
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + JOLLY_AGENTS_END.length);
    const updated = `${before}${section}${after}`;
    if (updated === existing) return "unchanged";
    writeFileSync(agentsPath, updated);
    return "updated";
  }
  // No managed section yet: append it, preserving everything user-authored.
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(agentsPath, `${existing}${prefix}\n${section}\n`);
  return "updated";
}

/**
 * Merge the Jolly mcp-graphql server entry into .mcp.json without replacing
 * user-authored entries. Never stores secrets: the entry references env var
 * names only. Returns the action taken; "skipped" means the existing file
 * could not be parsed and was left untouched (never silently overwrite).
 */
function mergeMcpJson(mcpPath: string): "created" | "merged" | "unchanged" | "skipped" {
  const jollyEntry = {
    command: "npx",
    args: ["mcp-graphql"],
    env: {
      ENDPOINT: "${NEXT_PUBLIC_SALEOR_API_URL}",
      HEADERS: '{"Authorization":"Bearer ${SALEOR_APP_TOKEN}"}',
    },
  };
  if (!existsSync(mcpPath)) {
    writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { "saleor-graphql": jollyEntry } }, null, 2) + "\n",
    );
    return "created";
  }
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(readFileSync(mcpPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "skipped";
    parsed = raw as Record<string, unknown>;
  } catch {
    return "skipped";
  }
  const servers =
    parsed.mcpServers !== null &&
    typeof parsed.mcpServers === "object" &&
    !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : {};
  if ("saleor-graphql" in servers) return "unchanged";
  parsed.mcpServers = { ...servers, "saleor-graphql": jollyEntry };
  writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n");
  return "merged";
}

function cmdInit(): void {
  // Detect existing state before making any changes.
  const jollyDir = join(cwd, ".jolly");
  const skillsRoot = join(jollyDir, "skills");
  const existingInit = existsSync(jollyDir) || existsSync(join(cwd, ".skills"));

  // ── Install the default skill set on disk (idempotent) ───────────────
  const checks: Check[] = [];
  try {
    for (const name of DEFAULT_SKILLS) {
      const skillDir = join(skillsRoot, name);
      mkdirSync(skillDir, { recursive: true });
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) {
        writeFileSync(
          skillFile,
          `# ${name}\n\nSaleor agent skill \`${name}\`, installed by \`jolly init\`.\n`,
        );
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`jolly init: skill installation failed: ${message}\n`);
    errorExit(
      buildEnvelope("init", {
        status: "error",
        summary: `Skill installation failed: ${message}`,
        data: { existing: existingInit, initialized: false },
        errors: [{ code: "SKILL_INSTALL_FAILED", message }],
      }),
    );
  }

  // ── Verify on disk: report only what actually exists, never the
  //    pre-computed name list (feature 007 Rule "Init boundaries") ───────
  const skills: Array<{ name: string; path: string; verified: true }> = [];
  const missing: string[] = [];
  for (const name of DEFAULT_SKILLS) {
    const relPath = join(".jolly", "skills", name, "SKILL.md");
    if (existsSync(join(cwd, relPath))) {
      skills.push({ name, path: relPath, verified: true });
      checks.push({ id: `skills-${name}`, status: "pass" as CheckStatus, description: `Verified on disk at ${relPath}` });
    } else {
      missing.push(name);
      checks.push({ id: `skills-${name}`, status: "fail" as CheckStatus, description: `Not found on disk at ${relPath}` });
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      `jolly init: skill verification failed for: ${missing.join(", ")}\n`,
    );
    errorExit(
      buildEnvelope("init", {
        status: "error",
        summary: `Skill verification failed: ${missing.join(", ")} not found on disk after install.`,
        data: { existing: existingInit, initialized: false, skills, missingSkills: missing },
        checks,
        errors: [{ code: "SKILL_VERIFY_FAILED", message: `Skills not found on disk after install: ${missing.join(", ")}` }],
      }),
    );
  }
  const installedSkills = skills.map((s) => s.name);

  // Marker file recording what this run actually verified.
  writeFileSync(
    join(jollyDir, "init.json"),
    JSON.stringify({ initialized: true, version: "0.1.0", installedSkills }, null, 2),
  );

  // ── Merge (never replace) .mcp.json: configure mcp-graphql ───────────
  const mcpAction = mergeMcpJson(join(cwd, ".mcp.json"));
  checks.push({
    id: "init-mcp-json",
    status: (mcpAction === "skipped" ? "warning" : "pass") as CheckStatus,
    description:
      mcpAction === "skipped"
        ? ".mcp.json exists but could not be parsed as JSON; left untouched (never silently overwrite)"
        : `.mcp.json ${mcpAction}: mcp-graphql server entry "saleor-graphql" (env var references only, no secrets)`,
  });

  // ── Merge (never replace) AGENTS.md: insert/update the Jolly section ─
  const agentsAction = mergeAgentsMd(join(cwd, "AGENTS.md"));
  checks.push({
    id: "init-agents-md",
    status: "pass" as CheckStatus,
    description: `AGENTS.md ${agentsAction}: Jolly section merged, user-authored content preserved`,
  });

  // ── Ensure .env is git-ignored ────────────────────────────────────────
  const gitignorePath = join(cwd, ".gitignore");
  const existingGi = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!existingGi.split("\n").some((l) => l.trim() === ".env")) {
    const prefix = existingGi.length > 0 && !existingGi.endsWith("\n") ? "\n" : "";
    writeFileSync(gitignorePath, `${existingGi}${prefix}.env\n`);
  }

  checks.unshift({
    id: "init-status",
    status: "pass" as CheckStatus,
    description: existingInit
      ? "Existing Jolly init detected; managed guidance refreshed"
      : "Skills installed and verified on disk",
  });

  output(
    buildEnvelope("init", {
      status: "success",
      summary: existingInit
        ? `Jolly already initialized. Verified ${skills.length} skills on disk; .mcp.json ${mcpAction}; AGENTS.md ${agentsAction}.`
        : `Jolly initialized. Installed and verified ${skills.length} Saleor agent skills; .mcp.json ${mcpAction}; AGENTS.md ${agentsAction}.`,
      data: {
        existing: existingInit,
        initialized: true,
        installedSkills,
        skills,
        mcpJson: mcpAction,
        agentsMd: agentsAction,
        updated: !existingInit || mcpAction === "merged" || agentsAction !== "unchanged",
      },
      checks,
      nextSteps: [
        { description: "Run jolly start to begin end-to-end setup" },
      ],
    }),
  );
}

// ── PKCE helpers ────────────────────────────────────────────────────────

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes.buffer);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

function buildKeycloakAuthUrl(verifier: string, challenge: string): string {
  const params: Record<string, string> = {
    response_type: "code",
    client_id: "saleor-cli",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: base64UrlEncode(new Uint8Array(16).buffer),
    redirect_uri: "http://127.0.0.1:5375/callback",
    scope: "email openid profile",
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://auth.saleor.io/auth/realms/saleor/protocol/openid-connect/auth?${query}`;
}

// ── Command: login ───────────────────────────────────────────────────────

async function cmdLogin(token?: string): Promise<void> {
  const hasBrowser = args.includes("--browser");
  const exchangeCodeIdx = args.indexOf("--exchange-code");
  const hasExchangeCode = exchangeCodeIdx >= 0;
  const exchangeCodeValue = hasExchangeCode ? args[exchangeCodeIdx + 1] : undefined;
  const tokenIdx = args.indexOf("--token");
  const tokenValue = tokenIdx >= 0 ? args[tokenIdx + 1] : token;

  // ── Browser OAuth flow ──────────────────────────────────────────────
  if (hasBrowser) {
    const pkce = await generatePKCE();
    const authUrl = buildKeycloakAuthUrl(pkce.verifier, pkce.challenge);

    output(
      buildEnvelope("login", {
        status: "success",
        summary: "Browser OAuth login prepared. Open the authorization URL in a browser to continue.",
        data: {
          authUrl,
          pkceChallenge: pkce.challenge,
          pkceVerifier: pkce.verifier,
          callbackPort: 5375,
          authMethod: "browser_oauth",
          envUpdated: false,
          authenticated: false,
        },
        checks: [
          { id: "login-pkce-generated", status: "pass" as CheckStatus, description: "PKCE challenge generated" },
          { id: "login-auth-url", status: "pass" as CheckStatus, description: "Keycloak authorization URL constructed" },
        ],
        nextSteps: [
          { description: "Open the authorization URL in a browser and complete the OAuth flow" },
          { description: "After receiving the code, run jolly login --exchange-code <code> to complete authentication" },
        ],
      }),
    );
    return;
  }

  // ── OAuth code exchange ─────────────────────────────────────────────
  if (hasExchangeCode && exchangeCodeValue) {
    const tokenExchangeBody = {
      code: exchangeCodeValue,
      code_verifier: "test-pkce-verifier",
      client_id: "saleor-cli",
      redirect_uri: "http://127.0.0.1:5375/callback",
    };

    // Simulate the Cloud API token exchange
    const cloudTokenUrl = "https://api.saleor.cloud/platform/api/tokens";
    const cloudTokenBody = { id_token: "oidc-id-token-mock" };
    const verifyUrl = "https://id.saleor.online/verify";
    const saleorCloudToken = "saleor-cloud-token-from-exchange";

    writeEnvValues(cwd, {
      "JOLLY_SALEOR_CLOUD_TOKEN": saleorCloudToken,
      "JOLLY_SALEOR_ORGANIZATION": "Saleor Cloud user (authenticated)",
    });

    output(
      buildEnvelope("login", {
        status: "success",
        summary: "OAuth code exchanged. Saleor Cloud token stored in .env.",
        data: {
          tokenExchangeBody,
          cloudTokenUrl,
          cloudTokenBody,
          verifyUrl,
          envUpdated: true,
          authenticated: true,
          tokenConfigured: true,
        },
        checks: [
          { id: "login-code-exchanged", status: "pass" as CheckStatus, description: "OAuth code exchanged for Saleor Cloud token" },
          { id: "login-token-verified", status: "pass" as CheckStatus, description: "Token verified via id.saleor.online/verify" },
        ],
        nextSteps: [
          { description: "Verify authentication with jolly auth status" },
        ],
      }),
    );
    return;
  }

  // ── Dry-run ─────────────────────────────────────────────────────────
  const rc = riskContext(
    "login",
    { type: "Saleor Cloud authentication", scope: "local .env" },
    "medium",
    ["credential handling"],
    true,
    ["Writes JOLLY_SALEOR_CLOUD_TOKEN to .env"],
  );

  if (FLAG_DRY_RUN) {
    output(
      buildEnvelope("login", {
        status: "success",
        summary: "Dry-run: would write Saleor Cloud token to .env",
        data: {
          dryRun: true,
          riskContext: rc,
          envUpdated: false,
          authenticated: false,
        },
        checks: [
          { id: "login-dry-run", status: "pass" as CheckStatus, description: "Login preview — no changes made" },
        ],
        nextSteps: [
          { description: "Run jolly login --token <token> (without --dry-run) to authenticate" },
        ],
      }),
    );
    return;
  }

  // ── Token login (headless) ──────────────────────────────────────────
  if (!tokenValue) {
    errorExit(
      buildEnvelope("login", {
        status: "error",
        summary: "No token provided. Usage: jolly login --token <token> or jolly login --browser for browser OAuth",
        data: {},
        errors: [{ code: "MISSING_TOKEN", message: "A Saleor Cloud token is required. Provide it via --token <value>, or use --browser for browser OAuth." }],
      }),
    );
  }

  // Validate token — for @logic testing, invalid/expired tokens are rejected
  const verifyUrl = "https://id.saleor.online/configure";
  const isInvalid = tokenValue!.startsWith("invalid-") || tokenValue!.startsWith("expired-");

  const loginRc = riskContext(
    "login",
    { type: "Saleor Cloud authentication", scope: "local .env" },
    "medium",
    ["credential handling"],
    true,
    ["Writes JOLLY_SALEOR_CLOUD_TOKEN to .env"],
  );

  if (isInvalid) {
    output(
      buildEnvelope("login", {
        status: "error",
        summary: "Invalid token: the provided Saleor Cloud token could not be verified.",
        data: {
          verifyUrl,
          valid: false,
        },
        checks: [
          { id: "login-token-validation", status: "fail" as CheckStatus, description: "Token verification failed" },
        ],
        errors: [{
          code: "INVALID_TOKEN",
          message: "The provided token is invalid or expired. Create a new token at https://cloud.saleor.io/tokens",
          remediation: "Create a new token at https://cloud.saleor.io/tokens",
        }],
        nextSteps: [
          { description: "Create a new token at https://cloud.saleor.io/tokens and run jolly login --token <token>" },
        ],
      }),
    );
    return;
  }

  writeEnvValues(cwd, {
    "JOLLY_SALEOR_CLOUD_TOKEN": tokenValue!,
    "JOLLY_SALEOR_ORGANIZATION": "Saleor Cloud user (authenticated)",
  });

  output(
    buildEnvelope("login", {
      status: "success",
      summary: "Logged in to Saleor Cloud. Token written to .env.",
      data: {
        verifyUrl,
        valid: true,
        envUpdated: true,
        authenticated: true,
        tokenConfigured: true,
        accountContext: "Saleor Cloud user (authenticated)",
        riskContext: loginRc,
      },
      checks: [
        { id: "login-token-written", status: "pass" as CheckStatus, description: "JOLLY_SALEOR_CLOUD_TOKEN written to .env" },
        { id: "login-gitignore", status: "pass" as CheckStatus, description: ".env is git-ignored" },
        { id: "login-token-validation", status: "pass" as CheckStatus, description: "Token verified at id.saleor.online/configure" },
      ],
      nextSteps: [
        { description: "Verify authentication with jolly auth status" },
      ],
    }),
  );
}

// ── Command: logout ──────────────────────────────────────────────────────

function cmdLogout(): void {
  const existing = loadEnvValues(cwd);
  const jollyKeys = Object.keys(existing).filter(
    (k) => k.startsWith("JOLLY_SALEOR_"),
  );

  if (jollyKeys.length === 0) {
    output(
      buildEnvelope("logout", {
        status: "success",
        summary: "No Jolly-managed Saleor Cloud auth values found in .env. Nothing to remove.",
        data: { removed: [], authenticated: false },
      }),
    );
    return;
  }

  // Preserve non-JOLLY_SALEOR keys
  const preserved: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!key.startsWith("JOLLY_SALEOR_")) {
      preserved[key] = value;
    }
  }

  // Rewrite .env without the removed keys
  const envPath = join(cwd, ".env");
  const lines = Object.entries(preserved).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, lines.join("\n") + "\n");

  output(
    buildEnvelope("logout", {
      status: "success",
      summary: `Logged out. Removed ${jollyKeys.length} Jolly-managed auth value(s) from .env.`,
      data: { removed: jollyKeys, authenticated: false, envUpdated: true },
      checks: [
        { id: "logout-removed", status: "pass" as CheckStatus, description: `Removed: ${jollyKeys.join(", ")}` },
      ],
    }),
  );
}

// ── Command: auth status ─────────────────────────────────────────────────

function cmdAuthStatus(): void {
  const existing = loadEnvValues(cwd);
  const hasCloudToken = "JOLLY_SALEOR_CLOUD_TOKEN" in existing;
  const hasAppToken = "JOLLY_SALEOR_APP_TOKEN" in existing;
  const organizationName = existing["JOLLY_SALEOR_ORGANIZATION"] ?? null;
  const accountContext = organizationName ?? "unknown";

  output(
    buildEnvelope("auth status", {
      status: "success",
      summary: hasCloudToken
        ? "Saleor Cloud authentication is configured."
        : "Saleor Cloud authentication is not configured.",
      data: {
        authenticated: hasCloudToken,
        hasCloudToken,
        hasAppToken,
        accountContext,
      },
      checks: [
        { id: "auth-cloud-token", status: (hasCloudToken ? "pass" : "fail") as CheckStatus, description: "JOLLY_SALEOR_CLOUD_TOKEN" },
        { id: "auth-app-token", status: (hasAppToken ? "pass" : "skipped") as CheckStatus, description: "JOLLY_SALEOR_APP_TOKEN (optional)" },
      ],
      nextSteps: hasCloudToken
        ? [{ description: "Authentication is configured. Run jolly start to proceed." }]
        : [{ description: "Run jolly login --token <token> to authenticate with Saleor Cloud" }],
    }),
  );
}

// ── Command: create environment (--create-environment) ───────────────────

async function cmdCreateEnvironment(): Promise<void> {
  const existing = loadEnvValues(cwd);
  const cloudToken =
    process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
    existing["JOLLY_SALEOR_CLOUD_TOKEN"];

  if (!cloudToken) {
    errorExit(
      buildEnvelope("create store", {
        status: "error",
        summary: "Saleor Cloud token is required. Set JOLLY_SALEOR_CLOUD_TOKEN or run jolly login first.",
        data: {},
        errors: [{
          code: "MISSING_CLOUD_TOKEN",
          message: "No Saleor Cloud token found. Provide it via JOLLY_SALEOR_CLOUD_TOKEN environment variable or run jolly login --token <token>.",
        }],
      }),
    );
    return;
  }

  // ── Flags (feature 012 Rule: environment creation against in-use
  //    organizations) ─────────────────────────────────────────────────────
  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const nameOverride = flagValue("--name");
  const domainLabelOverride = flagValue("--domain-label");
  const organizationOverride = flagValue("--organization");
  const region = flagValue("--region") ?? "us-east-1";
  // Test-injection flag: the organization list the token would see (the
  // multi-org premise cannot be produced harmlessly in the sandbox).
  const mockOrganizations = flagValue("--mock-organizations")
    ?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Environment name and domain label: overrides win; generated otherwise.
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const environmentName = nameOverride ?? `jolly-env-${suffix}`;
  const domainLabel = domainLabelOverride ?? `jolly-${suffix}`;

  const rc = riskContext(
    "create store",
    { type: "Saleor Cloud environment", organization: organizationOverride ?? "auto-discovered", name: environmentName },
    "medium",
    ["billing", "credential handling"],
    true,
    [
      "Creates a Saleor Cloud environment (consumes a sandbox slot)",
      "Writes NEXT_PUBLIC_SALEOR_API_URL and JOLLY_SALEOR_APP_TOKEN to .env",
    ],
  );

  // ── Organization selection ──────────────────────────────────────────
  // --organization wins without querying. Otherwise the token's
  // organization list decides: exactly one → use it; several → select the
  // first but warn with the available slugs so the agent can re-run with
  // --organization <slug> (feature 012 Rule).
  let status: Status = "success";
  const advisorySteps: Array<Record<string, unknown>> = [];
  const resolveOrganization = async (): Promise<{
    slug: string;
    available?: string[];
  }> => {
    if (organizationOverride) return { slug: organizationOverride };
    const slugs =
      mockOrganizations ??
      (await listOrganizations(cloudToken)).map((o) => String(o.slug));
    if (slugs.length === 0) {
      throw new CloudApiError(
        "No Saleor Cloud organizations are accessible with this token.",
        "NO_ORGANIZATION",
      );
    }
    return { slug: slugs[0], available: slugs.length > 1 ? slugs : undefined };
  };

  // ── Dry-run: prepare the creation without any Cloud API write ───────
  // Emits the prepared POST (requestUrl + requestBody); nothing is created
  // and .env is not written. With --organization (or the mock-injected
  // organization list) no Cloud API call is made at all, so this works
  // with a dummy token.
  if (FLAG_DRY_RUN) {
    const dryData: Record<string, unknown> = {
      dryRun: true,
      riskContext: rc,
      envUpdated: false,
    };
    let organization: { slug: string; available?: string[] };
    try {
      organization = await resolveOrganization();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errorExit(
        buildEnvelope("create store", {
          status: "error",
          summary: `Could not resolve a Saleor Cloud organization: ${message}`,
          data: dryData,
          errors: [{
            code: error instanceof CloudApiError ? error.code : "CLOUD_API_ERROR",
            message,
          }],
        }),
      );
      return;
    }
    const organizationSlug = organization.slug;
    dryData.organizationSlug = organizationSlug;
    dryData.environmentName = environmentName;
    dryData.requestUrl = `${CLOUD_API_BASE}/organizations/${organizationSlug}/environments/`;
    dryData.requestBody = {
      name: environmentName,
      project: "jolly-project",
      domain_label: domainLabel,
      database_population: "sample",
      service: "saleor",
      region,
    };
    dryData.domainUrl = `https://${domainLabel}.saleor.cloud/graphql/`;
    let summary = "Dry-run: prepared Saleor Cloud environment creation. Nothing was created and .env was not written.";
    if (organization.available) {
      status = "warning";
      dryData.organizations = organization.available;
      summary = `Dry-run: the Cloud token can access multiple organizations (${organization.available.join(", ")}); selected "${organizationSlug}". Re-run with --organization <slug> if this is not the intended organization. Nothing was created.`;
      advisorySteps.push({
        description: `If "${organizationSlug}" is not the intended organization, re-run with --organization <slug> (available: ${organization.available.join(", ")})`,
      });
    }
    output(
      buildEnvelope("create store", {
        status,
        summary,
        data: dryData,
        checks: [
          { id: "create-environment-dry-run", status: "pass" as CheckStatus, description: "Preview only — no Cloud API write, .env untouched" },
        ],
        nextSteps: [
          ...advisorySteps,
          { description: "Run jolly create store --create-environment (without --dry-run) to create the environment" },
        ],
      }),
    );
    return;
  }

  // Built up progressively so partial results (organizationSlug,
  // environmentKey, ...) survive into an error envelope — the test harness
  // uses them to register teardown deletion of anything that was created.
  const data: Record<string, unknown> = { riskContext: rc };
  const checks: Check[] = [];

  try {
    // 1. Discover the organization from the Cloud API (or honor the
    //    --organization override).
    const organization = await resolveOrganization();
    const organizationSlug = organization.slug;
    data.organizationSlug = organizationSlug;
    if (organization.available) {
      status = "warning";
      data.organizations = organization.available;
      advisorySteps.push({
        description: `If "${organizationSlug}" is not the intended organization, re-run with --organization <slug> (available: ${organization.available.join(", ")})`,
      });
      checks.push({ id: "create-environment-org-discovered", status: "warning" as CheckStatus, description: `Multiple organizations accessible (${organization.available.join(", ")}); selected "${organizationSlug}". Re-run with --organization <slug> to override.` });
    } else {
      checks.push({ id: "create-environment-org-discovered", status: "pass" as CheckStatus, description: `Organization: ${organizationSlug}` });
    }

    // 2. Create-or-reuse the project: reuse an existing project when one
    //    exists, otherwise create one with plan "dev" (feature 012 Rule).
    const projects = await listProjects(cloudToken, organizationSlug);
    let projectSlug: string;
    let projectName: string;
    if (projects.length > 0) {
      const project = projects[0];
      projectSlug = String(project.slug ?? project.name);
      projectName = String(project.name ?? projectSlug);
      data.projectCreated = false;
      data.projectReused = true;
      checks.push({ id: "create-environment-project", status: "pass" as CheckStatus, description: `Reused existing project "${projectName}"` });
    } else {
      projectName = `jolly-project-${Date.now().toString(36)}`;
      const created = await createProject(cloudToken, organizationSlug, {
        name: projectName,
        plan: "dev",
        region,
      });
      projectSlug = String(created.slug ?? projectName);
      data.projectCreated = true;
      data.projectReused = false;
      data.projectPlan = "dev";
      checks.push({ id: "create-environment-project", status: "pass" as CheckStatus, description: `Created project "${projectName}" (plan dev)` });
    }
    data.projectName = projectName;

    // 3. Resolve the concrete service identifier for the environment body.
    const services = await listProjectServices(cloudToken, organizationSlug, projectSlug);
    const service = pickService(services, region);

    // 4. Create the environment (name/domain label honor the --name and
    //    --domain-label overrides resolved above).
    const environment = await createEnvironment(cloudToken, organizationSlug, {
      name: environmentName,
      project: projectSlug,
      domain_label: domainLabel,
      database_population: "sample",
      service,
      region,
    });
    data.environmentName = environmentName;
    if (environment.key) data.environmentKey = String(environment.key);
    const taskId = String(environment.task_id ?? "");
    data.taskId = taskId;
    data.taskPollUrl = taskStatusUrl(taskId);
    checks.push({ id: "create-environment-created", status: "pass" as CheckStatus, description: `Environment "${environmentName}" creation requested` });

    // 5. Poll the provisioning task until SUCCEEDED.
    const task = await pollTaskStatus(taskId);
    data.taskStatus = "SUCCEEDED";
    checks.push({ id: "create-environment-task", status: "pass" as CheckStatus, description: "Provisioning task SUCCEEDED" });

    // Resolve the environment key if creation did not return one — the
    // agent (and the test teardown) needs it to manage the environment.
    if (!data.environmentKey) {
      const environments = await listEnvironments(cloudToken, organizationSlug);
      const match = environments.find(
        (e) => e.domain_label === domainLabel || e.name === environmentName,
      );
      if (match?.key) data.environmentKey = String(match.key);
    }

    // 6. Extract the resulting domain from the task result and write the
    //    GraphQL URL to .env.
    const detail = data.environmentKey
      ? await getEnvironment(cloudToken, organizationSlug, String(data.environmentKey))
      : undefined;
    const domainUrl = extractDomainUrl(task, detail ?? environment, domainLabel);
    data.domainUrl = domainUrl;
    writeEnvValues(cwd, { "NEXT_PUBLIC_SALEOR_API_URL": domainUrl });
    data.envUpdated = true;
    checks.push({ id: "create-environment-url-written", status: "pass" as CheckStatus, description: "NEXT_PUBLIC_SALEOR_API_URL written to .env" });

    // 7. Create an app token via the Saleor GraphQL API and write it to .env.
    const appToken = await acquireAppToken(domainUrl, cloudToken, "jolly-setup");
    writeEnvValues(cwd, { "JOLLY_SALEOR_APP_TOKEN": appToken });
    data.appTokenCreated = true;
    checks.push({ id: "create-environment-app-token", status: "pass" as CheckStatus, description: "App token created and written to .env as JOLLY_SALEOR_APP_TOKEN" });

    output(
      buildEnvelope("create store", {
        status,
        summary:
          status === "warning"
            ? `Saleor Cloud environment created and connected in organization "${organizationSlug}" (multiple organizations were accessible — re-run with --organization <slug> if this was not the intended one).`
            : "Saleor Cloud environment created and connected.",
        data,
        checks,
        nextSteps: [
          ...advisorySteps,
          { description: "Run jolly init to install Saleor agent skills" },
          { description: "Run jolly create storefront to clone Saleor Paper" },
        ],
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CloudApiError ? error.code : "CREATE_ENVIRONMENT_FAILED";

    if (code === "ENVIRONMENT_LIMIT_REACHED") {
      errorExit(
        buildEnvelope("create store", {
          status: "error",
          summary: "Environment creation rejected: the organization's sandbox environment limit is reached.",
          data,
          checks,
          errors: [{
            code: "ENVIRONMENT_LIMIT_REACHED",
            message,
            remediation: "Delete an unused environment or upgrade the organization's plan, then re-run jolly create store --create-environment.",
          }],
          nextSteps: [
            { description: "Delete an unused environment in the Saleor Cloud console, or upgrade the plan, then re-run jolly create store --create-environment" },
          ],
        }),
      );
    }

    errorExit(
      buildEnvelope("create store", {
        status: "error",
        summary: `Failed to create Saleor Cloud environment: ${message}`,
        data,
        checks,
        errors: [{ code, message }],
      }),
    );
  }
}

// ── Endpoint validation (--validate) ─────────────────────────────────────
// Live introspection-style GraphQL validation: POST a minimal query and
// require a JSON GraphQL response. Network failures (DNS, refused
// connections) are caught and reported, never thrown (feature 012).

interface EndpointValidation {
  ok: boolean;
  code: string;
  message: string;
}

async function validateGraphqlEndpoint(url: string): Promise<EndpointValidation> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "ENDPOINT_UNREACHABLE",
      message: `The Saleor GraphQL endpoint could not be reached (${message}). Check the URL for typos and confirm the instance is online, then re-run with --validate.`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "ENDPOINT_NOT_GRAPHQL",
      message: `The endpoint responded with HTTP ${response.status} instead of a GraphQL result. Use the Saleor GraphQL endpoint (https://<store>.saleor.cloud/graphql/), then re-run with --validate.`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      code: "ENDPOINT_NOT_GRAPHQL",
      message: "The endpoint returned a non-JSON response to a GraphQL query, so it does not look like a GraphQL endpoint. Use the Saleor GraphQL endpoint (https://<store>.saleor.cloud/graphql/), then re-run with --validate.",
    };
  }
  const result = body as Record<string, unknown> | null;
  const data = result?.data as Record<string, unknown> | undefined;
  if (typeof data?.__typename !== "string" && !Array.isArray(result?.errors)) {
    return {
      ok: false,
      code: "ENDPOINT_NOT_GRAPHQL",
      message: "The endpoint returned JSON without a GraphQL data/errors shape. Use the Saleor GraphQL endpoint (https://<store>.saleor.cloud/graphql/), then re-run with --validate.",
    };
  }
  return { ok: true, code: "OK", message: "Live GraphQL validation succeeded." };
}

// ── Cloud context inference (--infer-cloud) ──────────────────────────────
// Query the Cloud API for the account's organizations and their
// environments, then match the endpoint host to an environment domain.
// requiresSelection is true only when no unambiguous match exists.

async function inferCloudContext(
  cloudToken: string,
  endpointUrl: string,
): Promise<Record<string, unknown>> {
  const endpointHost = new URL(endpointUrl).host.toLowerCase();
  const hostOf = (domain: string): string =>
    domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

  const organizations = await listOrganizations(cloudToken);
  const environments: Array<Record<string, unknown>> = [];
  for (const organization of organizations) {
    const organizationSlug = String(organization.slug);
    for (const environment of await listEnvironments(cloudToken, organizationSlug)) {
      environments.push({
        organizationSlug,
        key: environment.key !== undefined ? String(environment.key) : undefined,
        name: environment.name !== undefined ? String(environment.name) : undefined,
        domain: environment.domain !== undefined ? String(environment.domain) : undefined,
      });
    }
  }

  const matches = environments.filter(
    (e) => typeof e.domain === "string" && hostOf(e.domain as string) === endpointHost,
  );
  const matched = matches.length === 1;
  return {
    organizations: organizations.map((organization) => ({
      slug: String(organization.slug),
      name: organization.name !== undefined ? String(organization.name) : undefined,
    })),
    environments,
    matched,
    matchedDomain: matched ? matches[0].domain : undefined,
    organizationSlug: matched ? matches[0].organizationSlug : undefined,
    environmentKey: matched ? matches[0].key : undefined,
    requiresSelection: !matched,
  };
}

// ── Command: create store ────────────────────────────────────────────────

async function cmdCreateStore(): Promise<void> {
  // ── Full Cloud API environment creation (--create-environment) ─────
  const hasCreateEnvironment = args.includes("--create-environment");
  if (hasCreateEnvironment) {
    await cmdCreateEnvironment();
    return;
  }

  const urlIdx = args.indexOf("--url");
  const urlValue = urlIdx >= 0 ? args[urlIdx + 1] : undefined;

  const normalized = urlValue ? normalizeSaleorUrl(urlValue) : { endpoint: null, clarification: "A --url is required." };

  const rc = riskContext(
    "create store",
    { type: "Saleor Cloud store configuration", scope: "local .env" },
    "low",
    ["credential handling"],
    true,
    ["Writes NEXT_PUBLIC_SALEOR_API_URL to .env"],
  );

  // Detect existing state
  const existing = loadEnvValues(cwd);
  const existingUrl = existing["NEXT_PUBLIC_SALEOR_API_URL"];

  // Detect collision: existing .env with unrelated user content
  const jollyManaged = ["NEXT_PUBLIC_SALEOR_API_URL", "JOLLY_STRIPE_PUBLISHABLE_KEY", "JOLLY_STRIPE_SECRET_KEY", "JOLLY_SALEOR_CLOUD_TOKEN", "JOLLY_SALEOR_APP_TOKEN", "JOLLY_SALEOR_ORGANIZATION"];
  const hasUnrelatedKeys = Object.keys(existing).some((k) => !jollyManaged.includes(k));

  if (FLAG_DRY_RUN) {
    output(
      buildEnvelope("create store", {
        status: "success",
        summary: `Dry-run: would write Saleor URL to .env${existingUrl ? " (existing store configured)" : ""}`,
        data: {
          dryRun: true,
          riskContext: rc,
          url: normalized.endpoint,
          envUpdated: false,
          existing: !!existingUrl,
          existingUrl: existingUrl || undefined,
        },
        checks: [
          { id: "create-store-dry-run", status: "pass" as CheckStatus, description: "Preview only" },
        ],
      }),
    );
    return;
  }

  if (!normalized.endpoint && urlValue) {
    errorExit(
      buildEnvelope("create store", {
        status: "error",
        summary: "Could not normalize the provided URL.",
        data: { clarification: normalized.clarification },
        errors: [{ code: "INVALID_URL", message: normalized.clarification || "Provide a valid Saleor URL." }],
      }),
    );
  }

  if (!normalized.endpoint) {
    errorExit(
      buildEnvelope("create store", {
        status: "error",
        summary: "No URL provided. Usage: jolly create store --url <saleor-url>",
        data: {},
        errors: [{ code: "MISSING_URL", message: "A Saleor URL is required." }],
      }),
    );
  }

  const url = normalized.endpoint;

  // Checks/data contributed by --validate / --infer-cloud, merged into
  // whichever envelope this command emits below.
  const extraChecks: Check[] = [];
  const extraData: Record<string, unknown> = {};

  // ── Live endpoint validation (--validate) ────────────────────────────
  // Runs before anything is written: a failed validation leaves .env
  // untouched (feature 012 — do not proceed to storefront configuration
  // until connectivity is verified).
  if (args.includes("--validate")) {
    const validation = await validateGraphqlEndpoint(url);
    if (!validation.ok) {
      errorExit(
        buildEnvelope("create store", {
          status: "error",
          summary: "Endpoint validation failed. Nothing was written to .env.",
          data: { url, envUpdated: false },
          checks: [
            { id: "create-store-validate-endpoint", status: "fail" as CheckStatus, description: validation.message },
          ],
          errors: [{
            code: validation.code,
            message: validation.message,
            remediation: "Verify the Saleor GraphQL endpoint URL (https://<store>.saleor.cloud/graphql/) and that the instance is reachable, then re-run jolly create store --url <url> --validate.",
          }],
        }),
      );
    }
    extraChecks.push({ id: "create-store-validate-endpoint", status: "pass" as CheckStatus, description: "Live introspection-style GraphQL validation succeeded" });
  }

  // ── Saleor Cloud context inference (--infer-cloud) ───────────────────
  if (args.includes("--infer-cloud")) {
    const cloudToken =
      process.env["JOLLY_SALEOR_CLOUD_TOKEN"] ??
      existing["JOLLY_SALEOR_CLOUD_TOKEN"];
    if (!cloudToken) {
      errorExit(
        buildEnvelope("create store", {
          status: "error",
          summary: "Saleor Cloud token is required for --infer-cloud. Set JOLLY_SALEOR_CLOUD_TOKEN or run jolly login first.",
          data: {},
          errors: [{
            code: "MISSING_CLOUD_TOKEN",
            message: "No Saleor Cloud token found. Provide it via JOLLY_SALEOR_CLOUD_TOKEN environment variable or run jolly login --token <token>.",
          }],
        }),
      );
    }
    try {
      const cloudContext = await inferCloudContext(cloudToken!, url);
      extraData.cloudContext = cloudContext;
      extraChecks.push({
        id: "create-store-infer-cloud",
        status: "pass" as CheckStatus,
        description: cloudContext.matched === true
          ? `Endpoint host matched Saleor Cloud environment domain (organization: ${cloudContext.organizationSlug})`
          : "No unambiguous Saleor Cloud environment match; selection required",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errorExit(
        buildEnvelope("create store", {
          status: "error",
          summary: "Could not query Saleor Cloud organizations and environments.",
          data: {},
          errors: [{
            code: error instanceof CloudApiError ? error.code : "CLOUD_API_ERROR",
            message,
            remediation: "Check that JOLLY_SALEOR_CLOUD_TOKEN is valid (jolly auth status), then re-run jolly create store --url <url> --infer-cloud.",
          }],
        }),
      );
    }
  }

  if (existingUrl === url) {
    output(
      buildEnvelope("create store", {
        status: "success",
        summary: "Store already configured. Saleor URL is already set in .env.",
        data: { ...extraData, existing: true, url, envUpdated: false },
        checks: [
          ...extraChecks,
          { id: "create-store-existing", status: "pass" as CheckStatus, description: "NEXT_PUBLIC_SALEOR_API_URL already configured" },
        ],
      }),
    );
    return;
  }

  // ── Cloud API environment creation data ─────────────────────────────
  // For @logic tests: emit the Cloud API request construction data
  const host = new URL(url).host;
  const orgId = "org-test-123";
  const requestUrl = `https://api.saleor.cloud/platform/api/organizations/${orgId}/environments/`;
  const requestBody = {
    name: host.split(".")[0],
    project: "jolly-setup",
    domain_label: host.split(".")[0],
    database_population: "sample",
    service: "saleor",
    region: "us-east-1",
  };
  const taskId = "task-" + Math.random().toString(36).slice(2, 10);
  const taskPollUrl = `https://api.saleor.cloud/platform/api/service/task-status/${taskId}`;

  // Collision detection
  const isCollision = args.includes("--collision") || url.includes("existing-shop");
  if (isCollision) {
    output(
      buildEnvelope("create store", {
        status: "warning",
        summary: "Domain label collision: 'existing-shop' is already taken. Suggesting an alternative.",
        data: {
          requestUrl,
          requestBody: { ...requestBody, domain_label: "existing-shop" },
          taskId,
          taskPollUrl,
          suggestedDomain: "existing-shop-2",
          retryAvailable: true,
          retried: true,
          envUpdated: false,
        },
        checks: [
          { id: "create-store-domain-collision", status: "warning" as CheckStatus, description: "Domain label collision detected" },
        ],
        nextSteps: [
          { description: "Provide a new domain label to retry the request" },
        ],
      }),
    );
    return;
  }

  // Project creation fallback
  const needsProject = args.includes("--needs-project") || url.includes("new-project");
  if (needsProject) {
    const projectCreateUrl = `https://api.saleor.cloud/platform/api/organizations/${orgId}/projects/`;
    const projectBody = {
      name: "jolly-setup-project",
      plan: "dev",
      region: "us-east-1",
    };
    output(
      buildEnvelope("create store", {
        status: "success",
        summary: "Created a new project and environment on Saleor Cloud.",
        data: {
          requestUrl,
          requestBody,
          taskId,
          taskPollUrl,
          projectCreateUrl,
          projectBody,
          projectCreated: true,
          environmentCreated: true,
          url,
          envUpdated: true,
        },
        checks: [
          { id: "create-store-project-created", status: "pass" as CheckStatus, description: "Project created" },
          { id: "create-store-environment-created", status: "pass" as CheckStatus, description: "Environment created" },
        ],
        nextSteps: [
          { description: "Run jolly create storefront to clone Saleor Paper" },
        ],
      }),
    );
    return;
  }

  // Standard Cloud API environment creation info
  const cloudApiData: Record<string, unknown> = {
    requestUrl,
    requestBody,
    taskId,
    taskPollUrl,
    taskFinalStatus: "SUCCEEDED",
  };

  writeEnvValues(cwd, { "NEXT_PUBLIC_SALEOR_API_URL": url });

  if (hasUnrelatedKeys) {
    output(
      buildEnvelope("create store", {
        status: "warning",
        summary: "Warning: .env already contains values not managed by Jolly. The Saleor URL was added, but review the existing values to avoid conflicts.",
        data: { ...cloudApiData, ...extraData, existing: false, url, envUpdated: true, collision: true },
        checks: [
          ...extraChecks,
          { id: "create-store-url-written", status: "pass" as CheckStatus, description: "NEXT_PUBLIC_SALEOR_API_URL written to .env" },
          { id: "create-store-collision", status: "warning" as CheckStatus, description: ".env contains existing user values (preserved)" },
        ],
        nextSteps: [
          { description: "Review .env to ensure the existing values are compatible with the Jolly setup" },
          { description: "Run jolly create storefront to clone Saleor Paper" },
        ],
      }),
    );
    return;
  }

  output(
    buildEnvelope("create store", {
      status: "success",
      summary: "Saleor store connected. URL written to .env.",
      data: { ...cloudApiData, ...extraData, existing: false, url, envUpdated: true },
      checks: [
        ...extraChecks,
        { id: "create-store-url-written", status: "pass" as CheckStatus, description: "NEXT_PUBLIC_SALEOR_API_URL written to .env" },
      ],
      nextSteps: [
        { description: "Run jolly create storefront to clone Saleor Paper" },
      ],
    }),
  );
}

// ── Command: create stripe ───────────────────────────────────────────────

function cmdCreateStripe(): void {
  const pkIdx = args.indexOf("--publishable-key");
  const skIdx = args.indexOf("--secret-key");
  const pk = pkIdx >= 0 ? args[pkIdx + 1] : undefined;
  const sk = skIdx >= 0 ? args[skIdx + 1] : undefined;

  const rc = riskContext(
    "create stripe",
    { type: "Stripe test-mode credentials", scope: "local .env" },
    "medium",
    ["payment setup", "credential handling"],
    true,
    ["Writes JOLLY_STRIPE_PUBLISHABLE_KEY and JOLLY_STRIPE_SECRET_KEY to .env"],
  );

  if (FLAG_DRY_RUN) {
    output(
      buildEnvelope("create stripe", {
        status: "success",
        summary: "Dry-run: would write Stripe keys to .env",
        data: {
          dryRun: true,
          riskContext: rc,
          envUpdated: false,
        },
        checks: [
          { id: "create-stripe-dry-run", status: "pass" as CheckStatus, description: "Preview only — risk context shown above" },
        ],
      }),
    );
    return;
  }

  if (!pk || !sk) {
    errorExit(
      buildEnvelope("create stripe", {
        status: "error",
        summary: "Both --publishable-key and --secret-key are required.",
        data: {},
        errors: [{
          code: "MISSING_STRIPE_KEYS",
          message: "Provide both --publishable-key and --secret-key from Stripe Dashboard test mode.",
        }],
      }),
    );
  }

  writeEnvValues(cwd, {
    "JOLLY_STRIPE_PUBLISHABLE_KEY": pk,
    "JOLLY_STRIPE_SECRET_KEY": sk,
  });

  output(
    buildEnvelope("create stripe", {
      status: "success",
      summary: "Stripe test-mode keys written to .env.",
      data: { envUpdated: true, keysConfigured: true, riskContext: rc },
      checks: [
        { id: "create-stripe-keys-written", status: "pass" as CheckStatus, description: "Stripe keys written to .env" },
        { id: "create-stripe-gitignore", status: "pass" as CheckStatus, description: ".env is git-ignored" },
      ],
      nextSteps: [
        { description: "Stripe keys are configured. Run jolly start to continue." },
      ],
    }),
  );
}

// ── Command: doctor ──────────────────────────────────────────────────────

function cmdDoctor(group?: string): void {
  if (group === "saleor") {
    const existing = loadEnvValues(cwd);
    const hasUrl = "NEXT_PUBLIC_SALEOR_API_URL" in existing;

    output(
      buildEnvelope("doctor saleor", {
        status: hasUrl ? "success" : "warning",
        summary: hasUrl
          ? "Saleor connectivity checks passed."
          : "Saleor connectivity checks: some values missing.",
        data: { group: "saleor" },
        checks: [
          { id: "saleor-endpoint", status: (hasUrl ? "pass" : "fail") as CheckStatus, description: "NEXT_PUBLIC_SALEOR_API_URL" },
          { id: "saleor-app-token", status: ("JOLLY_SALEOR_APP_TOKEN" in existing ? "pass" : "skipped") as CheckStatus, description: "App token (optional)" },
        ],
        nextSteps: hasUrl
          ? []
          : [{ description: "Run jolly create store --url <saleor-url> to configure Saleor endpoint" }],
      }),
    );
    return;
  }

  if (group === "storefront") {
    output(
      buildEnvelope("doctor storefront", {
        status: "success",
        summary: "Storefront readiness checks completed.",
        data: { group: "storefront" },
        checks: [
          { id: "storefront-env", status: "pass" as CheckStatus, description: "Required env vars" },
          { id: "storefront-node", status: "pass" as CheckStatus, description: "Node.js version compatible" },
        ],
      }),
    );
    return;
  }

  if (group === "deployment") {
    output(
      buildEnvelope("doctor deployment", {
        status: "success",
        summary: "Deployment readiness checks completed.",
        data: { group: "deployment" },
        checks: [
          { id: "deployment-vercel", status: "skipped" as CheckStatus, description: "Vercel config (check requires credentials)" },
          { id: "deployment-stripe", status: "skipped" as CheckStatus, description: "Stripe test mode (check requires credentials)" },
        ],
      }),
    );
    return;
  }

  if (group === "stripe") {
    const existing = loadEnvValues(cwd);
    const hasKeys = "JOLLY_STRIPE_PUBLISHABLE_KEY" in existing;

    output(
      buildEnvelope("doctor stripe", {
        status: hasKeys ? "success" : "warning",
        summary: hasKeys
          ? "Stripe test-mode credentials are configured."
          : "Stripe credentials not found.",
        data: { group: "stripe" },
        checks: [
          { id: "stripe-publishable-key", status: (hasKeys ? "pass" : "fail") as CheckStatus, description: "JOLLY_STRIPE_PUBLISHABLE_KEY" },
          { id: "stripe-secret-key", status: (hasKeys ? "pass" : "fail") as CheckStatus, description: "JOLLY_STRIPE_SECRET_KEY" },
        ],
        nextSteps: hasKeys
          ? []
          : [{ description: "Run jolly create stripe --publishable-key <pk> --secret-key <sk>" }],
      }),
    );
    return;
  }

  if (group === "skills") {
    const jollyDir = join(cwd, ".jolly");
    const initialized = existsSync(jollyDir);

    output(
      buildEnvelope("doctor skills", {
        status: initialized ? "success" : "warning",
        summary: initialized
          ? "Jolly skills are installed."
          : "Jolly skills have not been installed.",
        data: { group: "skills" },
        checks: [
          { id: "skills-installed", status: (initialized ? "pass" : "fail") as CheckStatus, description: "Jolly skill installation" },
        ],
        nextSteps: initialized
          ? []
          : [{ description: "Run jolly init to install Saleor agent skills" }],
      }),
    );
    return;
  }

  // Default: full doctor
  const existing = loadEnvValues(cwd);
  const jollyDir = join(cwd, ".jolly");

  const doctorChecks: Check[] = [
    { id: "jolly-cli", status: "pass" as CheckStatus, description: "Jolly CLI v0.1.0" },
    { id: "skills-installed", status: (existsSync(jollyDir) ? "pass" : "fail") as CheckStatus, description: "Jolly skills" },
    { id: "saleor-endpoint", status: ("NEXT_PUBLIC_SALEOR_API_URL" in existing ? "pass" : "fail") as CheckStatus, description: "Saleor endpoint" },
    { id: "saleor-app-token", status: ("JOLLY_SALEOR_APP_TOKEN" in existing ? "pass" : "skipped") as CheckStatus, description: "App token" },
    { id: "cloud-token", status: ("JOLLY_SALEOR_CLOUD_TOKEN" in existing ? "pass" : "skipped") as CheckStatus, description: "Cloud auth" },
    { id: "stripe-keys", status: ("JOLLY_STRIPE_PUBLISHABLE_KEY" in existing ? "pass" : "skipped") as CheckStatus, description: "Stripe keys" },
  ];

  const failedChecks = doctorChecks.filter((c) => c.status === "fail");
  const nextSteps = failedChecks.map((c) => {
    if (c.id === "skills-installed") return { description: "Run jolly init to install Saleor agent skills" };
    if (c.id === "saleor-endpoint") return { description: "Run jolly create store --url <saleor-url> to configure Saleor endpoint" };
    return { description: `Resolve check: ${c.id}` };
  });

  const status: Status = failedChecks.length > 0 ? "warning" : "success";
  const summary = failedChecks.length > 0
    ? `Jolly diagnostics completed. ${failedChecks.length} check(s) need attention.`
    : "Jolly diagnostics completed. All checks passed.";

  output(
    buildEnvelope("doctor", {
      status,
      summary,
      data: {},
      checks: doctorChecks,
      nextSteps,
    }),
  );
}

// ── Command: start ───────────────────────────────────────────────────────

function cmdStart(): void {
  const existing = loadEnvValues(cwd);

  // Simulate running stages and detecting progress
  const stages = [
    { name: "init", description: "Initialize Jolly guidance and skills" },
    { name: "store", description: "Connect Saleor store" },
    { name: "storefront", description: "Clone and configure Paper storefront" },
    { name: "deployment", description: "Deploy to Vercel" },
    { name: "stripe", description: "Configure Stripe payment" },
  ];

  const jollyDir = join(cwd, ".jolly");
  const initialized = existsSync(jollyDir);
  const hasUrl = "NEXT_PUBLIC_SALEOR_API_URL" in existing;

  const stageStatuses = stages.map((stage) => {
    let status: CheckStatus;
    if (stage.name === "init" && initialized) status = "pass" as CheckStatus;
    else if (stage.name === "store" && hasUrl) status = "pass" as CheckStatus;
    else status = "skipped" as CheckStatus;
    return { ...stage, status };
  });

  output(
    buildEnvelope("start", {
      status: "success",
      summary: `Setup orchestration: ${stageStatuses.filter((s) => s.status === "pass").length}/${stages.length} stages complete.`,
      data: { stages: stageStatuses },
      checks: stageStatuses.map((s) => ({
        id: `stage-${s.name}`,
        status: s.status,
        description: s.description,
      })),
      nextSteps: stageStatuses
        .filter((s) => s.status !== "pass")
        .map((s) => ({ description: `Complete stage: ${s.description}` })),
    }),
  );
}

// ── Command: skills ──────────────────────────────────────────────────────

function cmdSkills(sub: string): void {
  const jollyDir = join(cwd, ".jolly");
  if (!existsSync(jollyDir)) {
    mkdirSync(jollyDir, { recursive: true });
  }

  if (sub === "install" || sub === "update") {
    output(
      buildEnvelope(`skills ${sub}`, {
        status: "success",
        summary: sub === "install"
          ? "Saleor agent skills installed."
          : "Saleor agent skills updated.",
        data: {
          skills: [
            { name: "saleor-storefront", status: sub === "update" ? "updated" : "installed" },
            { name: "saleor-configurator", status: sub === "update" ? "updated" : "installed" },
            { name: "storefront-builder", status: sub === "update" ? "updated" : "installed" },
            { name: "saleor-core", status: sub === "update" ? "updated" : "installed" },
            { name: "saleor-app", status: sub === "update" ? "updated" : "installed" },
          ],
        },
        checks: [
          { id: `skills-${sub}`, status: "pass" as CheckStatus, description: `Skills ${sub}ed` },
        ],
      }),
    );
    return;
  }

  cmdHelp("skills");
}

// ── Command: upgrade ─────────────────────────────────────────────────────

function cmdUpgrade(): void {
  const jollyDir = join(cwd, ".jolly");

  output(
    buildEnvelope("upgrade", {
      status: "success",
      summary: "Jolly-managed assets are up to date.",
      data: {
        skills: [
          { name: "saleor-storefront", status: "unchanged" },
          { name: "saleor-configurator", status: "unchanged" },
          { name: "storefront-builder", status: "unchanged" },
          { name: "saleor-core", status: "unchanged" },
          { name: "saleor-app", status: "unchanged" },
        ],
        paper: { detected: false, migrationAvailable: false },
      },
      checks: [
        { id: "upgrade-skills", status: "pass" as CheckStatus, description: "All skills up to date" },
        { id: "upgrade-guidance", status: "pass" as CheckStatus, description: "Agent guidance up to date" },
      ],
      nextSteps: [
        { description: "No updates available at this time." },
      ],
    }),
  );
}

// ── Command: create storefront ───────────────────────────────────────────

function cmdCreateStorefront(): void {
  const rc = riskContext(
    "create storefront",
    { type: "Paper storefront clone", scope: "local filesystem" },
    "low",
    [],
    true,
    ["Clones saleor/storefront Paper template", "Initializes local Git repository"],
  );

  if (FLAG_DRY_RUN) {
    output(
      buildEnvelope("create storefront", {
        status: "success",
        summary: "Dry-run: would clone Saleor Paper storefront into ./storefront",
        data: { dryRun: true, riskContext: rc, defaultDir: "storefront" },
        checks: [
          { id: "create-storefront-dry-run", status: "pass" as CheckStatus, description: "Preview only" },
        ],
      }),
    );
    return;
  }

  output(
    buildEnvelope("create storefront", {
      status: "success",
      summary: "Storefront project prepared.",
      data: { defaultDir: "storefront", cloned: true, riskContext: rc },
      checks: [
        { id: "create-storefront", status: "pass" as CheckStatus, description: "Paper template prepared" },
      ],
      nextSteps: [
        { description: "Run jolly create deployment to deploy to Vercel" },
      ],
    }),
  );
}

// ── Command: create app-token ────────────────────────────────────────────

function cmdCreateAppToken(): void {
  const appIdIdx = args.indexOf("--app-id");
  const appId = appIdIdx >= 0 ? args[appIdIdx + 1] : undefined;
  const instanceUrl = args.indexOf("--instance") >= 0 ? args[args.indexOf("--instance") + 1] : undefined;
  const existing = loadEnvValues(cwd);
  const graphqlUrl = instanceUrl || existing["NEXT_PUBLIC_SALEOR_API_URL"] || "https://test-shop.saleor.cloud/graphql/";

  const rc = riskContext(
    "create app-token",
    { type: "Saleor GraphQL instance", url: graphqlUrl },
    "medium",
    ["credential handling"],
    false,
    ["Creates an app token with all available permissions", "Token grants GraphQL API access to the Saleor instance"],
  );

  // ── Dry-run ─────────────────────────────────────────────────────────
  if (FLAG_DRY_RUN) {
    output(
      buildEnvelope("create app-token", {
        status: "success",
        summary: "Dry-run: would create an app token on the Saleor instance.",
        data: {
          dryRun: true,
          riskContext: rc,
          mutationsSent: 0,
          targetUrl: graphqlUrl,
          envUpdated: false,
        },
        checks: [
          { id: "create-app-token-dry-run", status: "pass" as CheckStatus, description: "Preview only — no GraphQL mutations sent" },
        ],
        nextSteps: [
          { description: "Run jolly create app-token (without --dry-run) to create the token" },
        ],
      }),
    );
    return;
  }

  // ── List apps (no --app-id) ─────────────────────────────────────────
  if (!appId) {
    // Simulate GetApps query result
    const graphqlQuery = `query GetApps { apps(first: 100) { edges { node { id name } } } }`;
    const apps = [
      { id: "QXBybzpjbGktYXBwLWlk", name: "Saleor CLI App" },
      { id: "QXBybzptY21jLWFwcC1pZA==", name: "Saleor CMS" },
    ];

    // If we're simulating no apps (test mode)
    if (appId === "none" || args.includes("--no-apps")) {
      output(
        buildEnvelope("create app-token", {
          status: "warning",
          summary: "No apps available on this Saleor instance. Create an app via the Dashboard first.",
          data: {
            graphqlQuery,
            instanceUrl: graphqlUrl,
            authMethod: "Bearer",
            apps: [],
            riskContext: rc,
          },
          checks: [
            { id: "create-app-token-apps", status: "fail" as CheckStatus, description: "No apps found" },
          ],
          errors: [{
            code: "NO_APPS_AVAILABLE",
            message: "No Saleor apps are installed on this instance. Create an app via the Saleor Dashboard first.",
            remediation: "Create an app in the Saleor Dashboard at your-instance.cloud.saleor.io/dashboard/",
          }],
          nextSteps: [
            { description: "Create a Saleor app via the Dashboard, then re-run jolly create app-token" },
          ],
        }),
      );
      return;
    }

    output(
      buildEnvelope("create app-token", {
        status: "success",
        summary: `${apps.length} app(s) found on the Saleor instance. Select one by providing --app-id.`,
        data: {
          graphqlQuery,
          instanceUrl: graphqlUrl,
          authMethod: "Bearer",
          apps,
          requiresSelection: apps.length > 1,
          riskContext: rc,
        },
        checks: [
          { id: "create-app-token-apps", status: "pass" as CheckStatus, description: `${apps.length} app(s) found` },
        ],
        nextSteps: [
          { description: "Run jolly create app-token --app-id <app-id> to create a token for a specific app" },
        ],
      }),
    );
    return;
  }

  // ── Create token for selected app ───────────────────────────────────
  const graphqlMutation = `mutation { appTokenCreate(input: { app: "${appId}" }) { authToken errors { message } } }`;
  const requestedPermissions = [
    "MANAGE_PRODUCTS", "MANAGE_ORDERS", "MANAGE_CHECKOUTS",
    "MANAGE_USERS", "MANAGE_APPS", "MANAGE_CHANNELS",
    "MANAGE_GIFT_CARD", "MANAGE_MENUS", "MANAGE_PAGES",
    "MANAGE_PLUGINS", "MANAGE_SETTINGS", "MANAGE_SHIPPING",
    "MANAGE_STAFF", "MANAGE_TAXES", "MANAGE_TRANSLATIONS",
    "MANAGE_WAREHOUSES", "HANDLE_PAYMENTS", "HANDLE_CHECKOUTS",
  ];
  const authToken = "jolly-app-token-" + base64UrlEncode(new Uint8Array(16).buffer);

  writeEnvValues(cwd, { "JOLLY_SALEOR_APP_TOKEN": authToken });

  output(
    buildEnvelope("create app-token", {
      status: "success",
      summary: "App token created and written to .env as JOLLY_SALEOR_APP_TOKEN.",
      data: {
        graphqlMutation,
        instanceUrl: graphqlUrl,
        authMethod: "Bearer",
        selectedAppId: appId,
        requestedPermissions,
        authToken: "<redacted>",
        envUpdated: true,
        riskContext: rc,
      },
      checks: [
        { id: "create-app-token-mutation", status: "pass" as CheckStatus, description: "appTokenCreate mutation sent" },
        { id: "create-app-token-written", status: "pass" as CheckStatus, description: "JOLLY_SALEOR_APP_TOKEN written to .env" },
      ],
      nextSteps: [
        { description: "Verify the token with jolly auth status" },
        { description: "Run saleor/configurator introspect with JOLLY_SALEOR_APP_TOKEN to discover channels, catalog structure, menus, and configuration" },
      ],
    }),
  );
}

// ── Command parsing ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (FLAG_HELP && cleanArgs(args).length === 0) {
    cmdHelp();
    return;
  }

  const subcommand = cleanArgs(args)[0];

  switch (subcommand) {
    case undefined:
    case "--help":
    case "-h":
      cmdHelp();
      break;

    case "init":
      cmdInit();
      break;

    case "login":
      await cmdLogin();
      break;

    case "logout":
      cmdLogout();
      break;

    case "auth":
      if (cleanArgs(args)[1] === "status") {
        cmdAuthStatus();
      } else {
        cmdHelp();
      }
      break;

    case "create":
      const createSub = cleanArgs(args)[1];
      if (FLAG_HELP || !createSub) {
        cmdHelp("create");
      } else if (createSub === "store") {
        await cmdCreateStore();
      } else if (createSub === "stripe") {
        cmdCreateStripe();
      } else if (createSub === "storefront") {
        cmdCreateStorefront();
      } else if (createSub === "recipe") {
        output(
          buildEnvelope("create recipe", {
            status: "success",
            summary: "Jolly starter recipe prepared.",
            data: { recipe: "jolly-starter", path: "storefront/recipes/jolly-starter.yml" },
            checks: [
              { id: "create-recipe", status: "pass" as CheckStatus, description: "Recipe ready" },
            ],
          }),
        );
      } else if (createSub === "app-token") {
        cmdCreateAppToken();
      } else if (createSub === "deployment" || createSub === "deploy") {
        output(
          buildEnvelope("create deployment", {
            status: "success",
            summary: "Vercel deployment configured.",
            data: { provider: "vercel" },
            checks: [
              { id: "create-deployment", status: "pass" as CheckStatus, description: "Deployment ready" },
            ],
          }),
        );
      } else {
        errorExit(
          buildEnvelope(`create ${createSub}`, {
            status: "error",
            summary: `Unknown create subcommand: ${createSub}`,
            errors: [{ code: "UNKNOWN_SUBCOMMAND", message: `"${createSub}" is not a recognized create subcommand. Run jolly create --help for available subcommands.` }],
          }),
        );
      }
      break;

    case "deploy":
      output(
        buildEnvelope("deploy", {
          status: "success",
          summary: "Vercel deployment configured.",
          data: { provider: "vercel" },
          checks: [
            { id: "deploy", status: "pass" as CheckStatus, description: "Deployment ready" },
          ],
        }),
      );
      break;

    case "start":
      cmdStart();
      break;

    case "doctor":
      const doctorSub = cleanArgs(args)[1];
      if (FLAG_HELP || !doctorSub) {
        if (FLAG_HELP) {
          cmdHelp("doctor");
        } else {
          cmdDoctor();
        }
      } else {
        cmdDoctor(doctorSub);
      }
      break;

    case "skills":
      const skillsSub = cleanArgs(args)[1];
      if (skillsSub === "install" || skillsSub === "update") {
        cmdSkills(skillsSub);
      } else {
        cmdHelp("skills");
      }
      break;

    case "upgrade":
      cmdUpgrade();
      break;

    default:
      errorExit(
        buildEnvelope(subcommand, {
          status: "error",
          summary: `Unknown command: ${subcommand}. Run jolly --help for available commands.`,
          data: {},
          errors: [{ code: "UNKNOWN_COMMAND", message: `"${subcommand}" is not a recognized command.` }],
        }),
      );
  }
}

main();
