// Logic-tier units for the published-package rules of feature 006 (decision
// 2026-06-12): the published Jolly CLI is a Node.js program. The `engines`
// field must declare the Node.js >= 23 requirement and must not require Bun.
// Dev/CI now also run on native Node >= 23 + npm (decision 2026-06-13, Bun
// dropped for dev/prod parity), so Bun is not a requirement anywhere. The
// launcher's Bun-less execution itself is covered by the feature 006 @logic
// scenario "Npx execution does not require Bun".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as { engines?: Record<string, string>; bin?: Record<string, string> };

describe("published package engines (feature 006 rules)", () => {
  test("declares the Node.js requirement", () => {
    assert.notStrictEqual(pkg.engines?.node, undefined);
    // Minimum is Node >= 23 (native type stripping).
    const match = /(\d+)/.exec(pkg.engines?.node ?? "");
    assert.notStrictEqual(match, null);
    assert.ok(Number(match![1]) >= 23);
  });

  test("does not require Bun", () => {
    assert.strictEqual(pkg.engines?.bun, undefined);
  });

  test("ships the jolly launcher as its bin", () => {
    assert.strictEqual(pkg.bin?.jolly, "bin/jolly");
  });
});
