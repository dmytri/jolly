// Logic-tier junk-input sweep for feature 020 Rule "No fabricated success"
// (decision 2026-06-12): junk input never yields success language from any
// command — no `pass` verification/validity checks, no authenticated/valid
// claims, no success status for input that was never really verified.
//
// Every run forces an unroutable .invalid Cloud API base and a from-scratch
// environment (no .env leakage, no credentials), so the CLI under test can
// never reach a real account — the 012-incident lesson applied to units.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
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
    // Run the CLI under the genuine Node binary executing the test (Node >= 23
    // strips types for these project files). process.execPath is the real node.
    const spawned = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
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
    assert.strictEqual(spawned.error, undefined);
    const stdout = spawned.stdout ?? "";
    const envelope = findEnvelope(stdout);
    assert.notStrictEqual(envelope, undefined);
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
      assert.doesNotMatch(`${check.id}=${check.status}`, /=pass$/);
    }
  }
  assert.notStrictEqual(envelope.data.authenticated, true);
  assert.notStrictEqual(envelope.data.valid, true);
}

describe("junk input never yields success language (feature 020 rule)", () => {
  test(
    "a junk token with an unreachable Cloud API is never reported verified",
    { timeout: 35_000 },
    () => {
      const { envelope } = runCli([
        "login",
        "--token",
        "jolly-junk-token-honesty",
        "--json",
      ]);
      // Verification did not happen: warning ("stored, not verified") or an
      // honest error are acceptable; success is fabricated.
      assert.notStrictEqual(envelope.status, "success");
      expectNoFabricatedSuccess(envelope);
    },
  );

  test(
    "junk store URLs error honestly instead of being accepted",
    { timeout: 70_000 },
    () => {
      for (const junk of ["this is not a url", "ftp://nope.example/store"]) {
        const { envelope } = runCli(["create", "store", "--url", junk, "--json"]);
        assert.strictEqual(envelope.status, "error");
        expectNoFabricatedSuccess(envelope);
      }
    },
  );

  test(
    "auth status from an empty project never claims authentication",
    { timeout: 35_000 },
    () => {
      const { envelope } = runCli(["auth", "status", "--json"]);
      // No .env, no credentials: status must report configuration only and
      // must never claim authenticated/verified from a file read.
      expectNoFabricatedSuccess(envelope);
      assert.doesNotMatch(
        JSON.stringify(envelope),
        /\b(authenticated|logged in|verified)\b/i,
      );
    },
  );

});
