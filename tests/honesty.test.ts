// Logic-tier junk-input sweep for feature 020 Rule "No fabricated success"
// (decision 2026-06-12): junk input never yields success language from any
// command — no `pass` verification/validity checks, no authenticated/valid
// claims, no success status for input that was never really verified.
//
// Every run forces an unroutable .invalid Cloud API base and a from-scratch
// environment (no .env leakage, no credentials), so the CLI under test can
// never reach a real account — the 012-incident lesson applied to units.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findEnvelope, type Envelope } from "../features/support/envelope.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");
const UNREACHABLE_API = "https://jolly-honesty-test.invalid/platform/api";

function runCli(args: string[]): { envelope: Envelope; stdout: string; stderr: string } {
  const cwd = mkdtempSync(join(tmpdir(), "jolly-honesty-"));
  try {
    const spawned = spawnSync("bun", [CLI_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // From-scratch credentials so even a CLI ignoring --dry-run cannot
        // reach a real account (012-incident lesson). The unroutable base
        // guarantees verification cannot succeed.
        JOLLY_SALEOR_CLOUD_API_URL: UNREACHABLE_API,
      },
    });
    expect(spawned.error).toBeUndefined();
    const stdout = spawned.stdout ?? "";
    const envelope = findEnvelope(stdout);
    expect(envelope).toBeDefined();
    return { envelope: envelope!, stdout, stderr: spawned.stderr ?? "" };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** No check may claim verification/validity/authentication that never happened. */
function expectNoFabricatedSuccess(envelope: Envelope): void {
  for (const check of envelope.checks) {
    const text = `${check.id} ${String(check.description ?? "")}`;
    if (/verif|valid|authenticat|connect/i.test(text)) {
      expect(`${check.id}=${check.status}`).not.toMatch(/=pass$/);
    }
  }
  expect(envelope.data.authenticated).not.toBe(true);
  expect(envelope.data.valid).not.toBe(true);
}

describe("junk input never yields success language (feature 020 rule)", () => {
  test(
    "a junk token with an unreachable Cloud API is never reported verified",
    () => {
      const { envelope } = runCli([
        "login",
        "--token",
        "jolly-junk-token-honesty",
        "--json",
      ]);
      // Verification did not happen: warning ("stored, not verified") or an
      // honest error are acceptable; success is fabricated.
      expect(envelope.status).not.toBe("success");
      expectNoFabricatedSuccess(envelope);
    },
    35_000,
  );

  test(
    "junk store URLs error honestly instead of being accepted",
    () => {
      for (const junk of ["this is not a url", "ftp://nope.example/store"]) {
        const { envelope } = runCli(["create", "store", "--url", junk, "--json"]);
        expect(envelope.status).toBe("error");
        expectNoFabricatedSuccess(envelope);
      }
    },
    70_000,
  );

  test(
    "auth status from an empty project never claims authentication",
    () => {
      const { envelope } = runCli(["auth", "status", "--json"]);
      // No .env, no credentials: status must report configuration only and
      // must never claim authenticated/verified from a file read.
      expectNoFabricatedSuccess(envelope);
      expect(JSON.stringify(envelope)).not.toMatch(
        /\b(authenticated|logged in|verified)\b/i,
      );
    },
    35_000,
  );

  test(
    "the browser OAuth --dry-run preview claims no exchange, verification, or login",
    () => {
      const { envelope } = runCli(["login", "--browser", "--dry-run", "--json"]);
      // A pure preview: it shows the request material but must never claim the
      // exchange/verification/login happened.
      expectNoFabricatedSuccess(envelope);
      for (const check of envelope.checks) {
        const text = `${check.id} ${String(check.description ?? "")}`;
        if (/exchang/i.test(text)) {
          expect(`${check.id}=${check.status}`).not.toMatch(/=pass$/);
        }
      }
      expect(JSON.stringify(envelope)).not.toMatch(
        /\b(exchanged|succeeded|authenticated|logged in)\b/i,
      );
    },
    35_000,
  );
});
