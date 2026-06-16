// First-party host allowlist (feature 020 Rule "First-party hosts only").
//
// Security contract: Jolly's own request-sending code contacts ONLY first-party
// hosts — the Saleor auth/cloud APIs, the customer's `*.saleor.cloud` store
// domains, GitHub, and the loopback address — plus the host of any
// JOLLY_SALEOR_CLOUD_API_URL override (feature 018 Rule — pointing the Cloud API
// elsewhere is the customer's explicit choice). Vercel's and Stripe's API hosts
// are deliberately absent: each is contacted only by its spawned CLI, never by
// Jolly's own request code. Retired Saleor hosts are likewise excluded.

/**
 * The fixed set of first-party hosts Jolly's request layer may contact. The
 * dynamic `*.saleor.cloud` store domains and the JOLLY_SALEOR_CLOUD_API_URL
 * override host are covered by isFirstPartyHost, not by this fixed list.
 */
export const FIRST_PARTY_HOSTS: readonly string[] = [
  "auth.saleor.io",
  "cloud.saleor.io",
  "github.com",
  "127.0.0.1",
];

/** The hostname of the JOLLY_SALEOR_CLOUD_API_URL override, when set and valid. */
function overrideHost(): string | undefined {
  const override = process.env["JOLLY_SALEOR_CLOUD_API_URL"];
  if (!override || override.trim().length === 0) return undefined;
  try {
    return new URL(override.trim()).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Whether `host` is a first-party host Jolly's request code may contact: any
 * host in FIRST_PARTY_HOSTS, any `*.saleor.cloud` customer store domain, or the
 * host of the JOLLY_SALEOR_CLOUD_API_URL override (read from process.env at call
 * time). Every other host is rejected.
 */
export function isFirstPartyHost(host: string): boolean {
  if (FIRST_PARTY_HOSTS.includes(host)) return true;
  if (host === "saleor.cloud" || host.endsWith(".saleor.cloud")) return true;
  return host === overrideHost();
}
