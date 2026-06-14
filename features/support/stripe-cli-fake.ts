// A harness-fake Stripe CLI, shared by feature 005 (@logic) and feature 025
// (@eval). It stands in for a completed `stripe login`: a small `stripe`
// executable placed first on the child's PATH that answers the one read-only
// command Jolly is allowed to invoke — `stripe config --list` — by printing a
// realistic config dump carrying test-mode keys, and refuses anything else
// (notably `login`/OAuth, which Jolly must never run). It contacts no network.
//
// The emitted format mirrors `stripe config --list` (the saved
// ~/.config/stripe/config.toml): a `[default]` profile table with
// `test_mode_pub_key` / `test_mode_api_key` / `test_mode_key_expires_at`.
// Jolly reads those two keys via the CLI's own interface (it does not parse the
// config file directly). The exact upstream format is re-checked at
// implementation time; the parser should tolerate single/double quotes and the
// `sk_`/`rk_` secret-key forms.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Dummy test-mode keys the fake Stripe CLI session "holds". Distinct from the
 *  logic-safe dummy Stripe values, so a test can prove the keys in `.env` were
 *  IMPORTED from the CLI session (these) rather than seeded or pasted. */
export const FAKE_STRIPE_PUBLISHABLE_KEY = "pk_test_jollyFakeStripeCliPublishable";
export const FAKE_STRIPE_SECRET_KEY = "sk_test_jollyFakeStripeCliSecret";
export const FAKE_STRIPE_KEY_EXPIRES_AT = "2099-01-01T00:00:00Z";

export interface FakeStripeOptions {
  /** Override the publishable key the fake session reports. */
  publishable?: string;
  /** Override the secret key the fake session reports. */
  secret?: string;
  /** When set, the fake appends each invocation's argv (JSON) one line per call. */
  traceFile?: string;
  /**
   * Whether the fake represents a logged-in session holding test-mode keys
   * (default true). When false, `config --list` prints a config with NO
   * test-mode keys — the "Stripe CLI present but not logged in" state, so an
   * import finds nothing and Jolly must error honestly. Shadowing the real
   * `stripe` binary this way keeps scenarios deterministic on machines where a
   * real, possibly-logged-in Stripe CLI is installed.
   */
  loggedIn?: boolean;
}

/**
 * Write an executable fake `stripe` into `dir`. Returns its path. Put `dir`
 * first on the PATH of the process under test so a bare `stripe` resolves here.
 */
export function writeFakeStripeCli(dir: string, opts: FakeStripeOptions = {}): string {
  const pub = opts.publishable ?? FAKE_STRIPE_PUBLISHABLE_KEY;
  const secret = opts.secret ?? FAKE_STRIPE_SECRET_KEY;
  const loggedIn = opts.loggedIn ?? true;
  const traceLine = opts.traceFile
    ? `try { fs.appendFileSync(${JSON.stringify(opts.traceFile)}, JSON.stringify(argv) + "\\n"); } catch {}`
    : "";
  const configLines = loggedIn
    ? [
        '"[default]",',
        `'  device_name = "jolly-test-fake"',`,
        `'  test_mode_pub_key = "${pub}"',`,
        `'  test_mode_api_key = "${secret}"',`,
        `'  test_mode_key_expires_at = "${FAKE_STRIPE_KEY_EXPIRES_AT}"',`,
      ].join("\n    ")
    : ['"[default]",', `'  device_name = "jolly-test-fake"',`].join("\n    ");

  const script = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const argv = process.argv.slice(2);
${traceLine}
// Read-only config listing — stands in for a completed \`stripe login\`.
if (argv[0] === "config" && argv.includes("--list")) {
  const lines = [
    ${configLines}
  ];
  process.stdout.write(lines.join("\\n") + "\\n");
  process.exit(0);
}
// Anything else (including \`login\`/OAuth) is unsupported: the import path must
// be read-only and must never trigger a fresh login.
process.stderr.write("fake stripe: only \`config --list\` is supported (no login/OAuth)\\n");
process.exit(1);
`;

  const path = join(dir, "stripe");
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

/** Parse the fake Stripe CLI's argv trace (one JSON array per invocation). */
export function readStripeTrace(traceFile: string): string[][] {
  if (!existsSync(traceFile)) return [];
  const text = readFileSync(traceFile, "utf8");
  const calls: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const argv = JSON.parse(line);
      if (Array.isArray(argv)) calls.push(argv);
    } catch {
      // ignore a malformed line
    }
  }
  return calls;
}
