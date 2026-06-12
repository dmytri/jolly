// Logic-tier units for the published-package rules of feature 006 (decision
// 2026-06-12): the published Jolly CLI is a Node.js program. The `engines`
// field must declare the Node.js >= 23 requirement and must not require Bun
// (Bun is the dev environment only, never a customer-facing requirement).
// The launcher's Bun-less execution itself is covered by the feature 006
// @logic scenario "Npx execution does not require Bun".
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as { engines?: Record<string, string>; bin?: Record<string, string> };

describe("published package engines (feature 006 rules)", () => {
  test("declares the Node.js requirement", () => {
    expect(pkg.engines?.node).toBeDefined();
    // Minimum is Node >= 23 (native type stripping).
    const match = /(\d+)/.exec(pkg.engines?.node ?? "");
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(23);
  });

  test("does not require Bun", () => {
    expect(pkg.engines?.bun).toBeUndefined();
  });

  test("ships the jolly launcher as its bin", () => {
    expect(pkg.bin?.jolly).toBe("bin/jolly");
  });
});
