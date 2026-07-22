// Local .env secret handling (AGENTS.md "Secret and Environment Handling").
//
// Pinned harness seam (see features/step_definitions/005-stripe-checkout-setup.steps.ts):
//   writeEnvValues(projectDir, values) — ensures .env is ignored by Git BEFORE
//     writing, merges the given values into .env, and returns the full loaded
//     post-update value map so the current command flow can use them.
//   loadEnvValues(projectDir) — parses .env into a name → value record.
//
// The values handled here are secrets: they must never be logged or printed;
// Jolly output references them by name only.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

// Characters that need no shell quoting; any value outside this set is wrapped
// in POSIX single quotes when written so the file stays a valid shell env file.
const SHELL_SAFE = /^[A-Za-z0-9_./:=@%+,-]+$/;

/** Quote a value for a POSIX env file: bare when safe, else single-quoted with
 * embedded single quotes escaped as '\'' so `set -a; . ./.env` round-trips it.
 * @planks("it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session")
 */
function quoteEnvValue(value: string): string {
  if (value !== "" && SHELL_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Reverse quoteEnvValue: unwrap a single-quoted value back to its raw form.
 * @planks("Jolly should load the updated .env values for the current command flow")
 * @planks("Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL")
 */
function unquoteEnvValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/'\\''/g, "'");
  }
  return raw;
}

/** Parse the project's .env into a name → value record (empty when absent).
 * @planks("Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL")
 * @planks("Jolly should load the updated .env values for the current command flow")
 * @planks("it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain")
 * @planks("it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session")
 * @planks("`jolly start` should write that `NEXT_PUBLIC_SALEOR_API_URL` \(mirrored to `SALEOR_URL`) and the resolved `SALEOR_TOKEN` to `.env`")
 */
export function loadEnvValues(projectDir: string): Record<string, string> {
  const path = join(projectDir, ".env");
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = ENV_LINE.exec(line);
    if (match) values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

/** Make sure .gitignore exists and lists `.env` so secrets are never committed.
 * @planks("Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL")
 * @planks("it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session")
 */
function ensureEnvIgnored(projectDir: string): void {
  const path = join(projectDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const alreadyIgnored = existing.split("\n").some((line) => line.trim() === ".env");
  if (alreadyIgnored) return;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? `${existing}\n` : existing;
  writeFileSync(path, `${prefix}.env\n`);
}

/**
 * Merge values into the project's .env, ensuring .env is Git-ignored before
 * any secret touches disk. Existing variables are updated in place, new ones
 * appended, and unrelated lines (comments, other variables) are preserved.
 * Returns the full post-update value map for the current command flow.
 * @planks("the real `JOLLY_SALEOR_CLOUD_TOKEN` is written to the project `.env` but is absent from the spawned process environment")
 * @planks("Jolly should write the URL to .env as NEXT_PUBLIC_SALEOR_API_URL")
 * @planks("it should write NEXT_PUBLIC_SALEOR_API_URL to .env from the resulting domain")
 * @planks("it should write SALEOR_URL and SALEOR_TOKEN to .env from the authenticated session")
 * @planks("it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN")
 * @planks("it should store the device-grant refresh token in .env as JOLLY_SALEOR_REFRESH_TOKEN")
 * @planks("it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN")
 * @planks("it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION")
 * @planks("`jolly start` should write that `NEXT_PUBLIC_SALEOR_API_URL` \(mirrored to `SALEOR_URL`) and the resolved `SALEOR_TOKEN` to `.env`")
 */
export function writeEnvValues(
  projectDir: string,
  values: Record<string, string>,
): Record<string, string> {
  ensureEnvIgnored(projectDir);
  const path = join(projectDir, ".env");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const pending = { ...values };
  const updated = lines.map((line) => {
    const match = ENV_LINE.exec(line);
    if (match && match[1] in pending) {
      const replacement = `${match[1]}=${quoteEnvValue(pending[match[1]])}`;
      delete pending[match[1]];
      return replacement;
    }
    return line;
  });
  for (const [name, value] of Object.entries(pending)) {
    updated.push(`${name}=${quoteEnvValue(value)}`);
  }
  writeFileSync(path, `${updated.join("\n")}\n`);
  // The .env holds credentials: make it readable/writable only by its owner
  // (mode 600). chmod every write, not just creation — writeFileSync's mode
  // option does not re-chmod an existing file.
  chmodSync(path, 0o600);
  return loadEnvValues(projectDir);
}
