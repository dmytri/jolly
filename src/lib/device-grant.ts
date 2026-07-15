// OAuth 2.0 device authorization grant against the saleor-cloud Keycloak realm
// (feature 018, Rule "Interactive authentication is the Saleor device
// authorization grant"). Public client `jolly`, no client secret. Jolly requests
// a device code, shows the user the code and verification URL, and polls the
// token endpoint while the human authorizes in a browser. Every request targets
// the first-party host auth.saleor.io (feature 020 allowlist).
import { isFirstPartyHost } from "./hosts.ts";

const DEFAULT_REALM_BASE = "https://auth.saleor.io/realms/saleor-cloud";

/**
 * The saleor-cloud realm base every device-grant and refresh request targets.
 * An optional JOLLY_SALEOR_AUTH_URL override may redirect it (default the
 * first-party realm) for proxy or self-routing — read at call time so the
 * override applies per process (feature 018 Rule).
 */
function realmBase(): string {
  const override = process.env["JOLLY_SALEOR_AUTH_URL"];
  if (override && override.trim() !== "") return override.trim().replace(/\/+$/, "");
  return DEFAULT_REALM_BASE;
}

const deviceAuthUrl = (): string =>
  `${realmBase()}/protocol/openid-connect/auth/device`;
const deviceTokenUrl = (): string => `${realmBase()}/protocol/openid-connect/token`;
export const DEVICE_CLIENT_ID = "jolly";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * @planks("When ^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("When the user runs `jolly login`")
 * @planks("When the agent runs `jolly doctor saleor --json`")
 */
export class DeviceGrantError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DeviceGrantError";
    this.code = code;
  }
}

/** Refuse — before any fetch — to contact a non-first-party host.
 * @planks("Then ^they should be exactly cloud\.saleor\.io, auth\.saleor\.io, the customer's `\*\.saleor\.cloud` domains, and github\.com, plus any `JOLLY_SALEOR_CLOUD_API_URL` or `JOLLY_SALEOR_AUTH_URL` override$")
 */
function assertFirstParty(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new DeviceGrantError(
      `Refusing to send a request to an unparseable URL: ${url}`,
      "NON_FIRST_PARTY_HOST",
    );
  }
  if (!isFirstPartyHost(host)) {
    throw new DeviceGrantError(
      `Refusing to send a request to non-first-party host ${host}.`,
      "NON_FIRST_PARTY_HOST",
    );
  }
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Minimum seconds between token polls. */
  interval: number;
  /** Seconds until the device code expires. */
  expiresIn: number;
}

/**
 * Start the grant: request a device code with client_id=jolly.
 * @planks("When ^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("When the user runs `jolly login`")
 * @planks("When the agent runs `jolly start --json` in a non-interactive shell")
 */
export async function requestDeviceCode(): Promise<DeviceAuthorization> {
  const url = deviceAuthUrl();
  assertFirstParty(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: DEVICE_CLIENT_ID,
      scope: "openid",
    }).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DeviceGrantError(
      `The Saleor auth host rejected the device-code request (HTTP ${response.status}). ${detail}`,
      "DEVICE_CODE_REQUEST_FAILED",
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  return {
    deviceCode: String(body["device_code"]),
    userCode: String(body["user_code"]),
    verificationUri: String(body["verification_uri"]),
    verificationUriComplete:
      typeof body["verification_uri_complete"] === "string"
        ? body["verification_uri_complete"]
        : undefined,
    interval: typeof body["interval"] === "number" ? body["interval"] : 5,
    expiresIn: typeof body["expires_in"] === "number" ? body["expires_in"] : 600,
  };
}

export interface DeviceTokens {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_GRANT_TYPE = "refresh_token";

/**
 * Mint a fresh access token from a stored refresh token through the refresh
 * grant (`grant_type=refresh_token`, `client_id=jolly`) at the realm token
 * endpoint — used when a short-lived device-grant access token has expired
 * during a long run, rather than re-prompting the human (feature 018 Rule "A
 * long run refreshes the short-lived access token"). Returns the new access
 * token and the (possibly rotated) refresh token. Targets the first-party host
 * auth.saleor.io (feature 020 allowlist).
 * @planks("When the agent runs `jolly doctor saleor --json`")
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<DeviceTokens> {
  const url = deviceTokenUrl();
  assertFirstParty(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: REFRESH_GRANT_TYPE,
      client_id: DEVICE_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || typeof body["access_token"] !== "string") {
    const error = String(body["error"] ?? `HTTP ${response.status}`);
    throw new DeviceGrantError(
      `The refresh grant did not return a fresh access token: ${error}.`,
      error || "REFRESH_GRANT_FAILED",
    );
  }
  return {
    accessToken: String(body["access_token"]),
    // Keycloak may rotate the refresh token; keep the new one when present.
    refreshToken: String(body["refresh_token"] ?? refreshToken),
  };
}

/**
 * Whether a JWT's `exp` claim is in the past (or within a small skew). Decodes
 * the payload without verifying the signature — enough to decide a proactive
 * refresh. A token that cannot be parsed is treated as expired so the caller
 * refreshes rather than sending a stale credential.
 * @planks("When the agent runs `jolly doctor saleor --json`")
 */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const parts = token.split(".");
  if (parts.length < 2) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp !== "number") return true;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the token endpoint until the human authorizes. Honours the grant's
 * `interval`, backs off on `slow_down`, and keeps waiting on
 * `authorization_pending` until the device code expires. Returns the access and
 * refresh tokens once the grant completes.
 * @planks("When ^the agent runs `jolly (?!(?:start|doctor|upgrade) --json`)(login|init|start|doctor|upgrade|skills|create store) (--json|--quiet|--yes)`$")
 * @planks("When the user runs `jolly login`")
 */
export async function pollForDeviceTokens(
  auth: DeviceAuthorization,
): Promise<DeviceTokens> {
  const url = deviceTokenUrl();
  assertFirstParty(url);
  let intervalMs = Math.max(auth.interval, 1) * 1000;
  const deadline = Date.now() + auth.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        client_id: DEVICE_CLIENT_ID,
        device_code: auth.deviceCode,
      }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.ok && typeof body["access_token"] === "string") {
      return {
        accessToken: String(body["access_token"]),
        refreshToken: String(body["refresh_token"] ?? ""),
      };
    }
    const error = String(body["error"] ?? "");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    throw new DeviceGrantError(
      `The device authorization grant did not complete: ${error || `HTTP ${response.status}`}.`,
      error || "DEVICE_GRANT_FAILED",
    );
  }
  throw new DeviceGrantError(
    "The device code expired before it was authorized.",
    "DEVICE_CODE_EXPIRED",
  );
}
