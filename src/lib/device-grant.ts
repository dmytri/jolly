// OAuth 2.0 device authorization grant against the saleor-cloud Keycloak realm
// (feature 018, Rule "Interactive authentication is the Saleor device
// authorization grant"). Public client `jolly`, no client secret. Jolly requests
// a device code, shows the user the code and verification URL, and polls the
// token endpoint while the human authorizes in a browser. Every request targets
// the first-party host auth.saleor.io (feature 020 allowlist).
import { isFirstPartyHost } from "./hosts.ts";

const REALM_BASE =
  "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect";
export const DEVICE_AUTH_URL = `${REALM_BASE}/auth/device`;
export const DEVICE_TOKEN_URL = `${REALM_BASE}/token`;
export const DEVICE_CLIENT_ID = "jolly";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export class DeviceGrantError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DeviceGrantError";
    this.code = code;
  }
}

/** Refuse — before any fetch — to contact a non-first-party host. */
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

/** Start the grant: request a device code with client_id=jolly. */
export async function requestDeviceCode(): Promise<DeviceAuthorization> {
  assertFirstParty(DEVICE_AUTH_URL);
  const response = await fetch(DEVICE_AUTH_URL, {
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the token endpoint until the human authorizes. Honours the grant's
 * `interval`, backs off on `slow_down`, and keeps waiting on
 * `authorization_pending` until the device code expires. Returns the access and
 * refresh tokens once the grant completes.
 */
export async function pollForDeviceTokens(
  auth: DeviceAuthorization,
): Promise<DeviceTokens> {
  assertFirstParty(DEVICE_TOKEN_URL);
  let intervalMs = Math.max(auth.interval, 1) * 1000;
  const deadline = Date.now() + auth.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const response = await fetch(DEVICE_TOKEN_URL, {
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
