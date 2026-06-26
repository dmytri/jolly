// Logic-tier units for the published-package rules of feature 006: the
// published Jolly CLI is a Node.js program. The `engines` field must declare
// the published Node.js floor — Node.js >= 20.12.0, the floor its dependencies
// require (`@clack/prompts`); the bundle is esbuild-targeted to node20.12 so it
// runs there as plain JS (decision 2026-06-24, "published floor >=20.12.0 with
// the dev/CI >=23 split"). Dev/CI run on native Node >= 23 + npm, but the
// PUBLISHED package must accept the dependency floor and must not require Bun.
// The launcher's Bun-less execution itself is covered by the feature 006 @logic
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
  test("declares the published Node.js floor (>=20.12.0, the dependency floor)", () => {
    assert.notStrictEqual(pkg.engines?.node, undefined);
    // Published floor is Node >= 20.12.0 (the floor its dependencies require;
    // the esbuild bundle targets node20.12). Dev/CI run on >=23, but the
    // PUBLISHED package's engines must accept the dependency floor.
    const match = /(\d+)\.(\d+)/.exec(pkg.engines?.node ?? "");
    assert.notStrictEqual(match, null, `engines.node must declare a version floor; got ${pkg.engines?.node}`);
    const major = Number(match![1]);
    const minor = Number(match![2]);
    assert.ok(
      major > 20 || (major === 20 && minor >= 12),
      `published engines.node must declare the >=20.12.0 floor; got ${pkg.engines?.node}`,
    );
  });

  test("does not require Bun", () => {
    assert.strictEqual(pkg.engines?.bun, undefined);
  });

  test("ships the jolly launcher as its bin", () => {
    assert.strictEqual(pkg.bin?.jolly, "bin/jolly");
  });
});
