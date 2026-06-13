// Enforcement-level units for feature 020 Rule "First-party hosts only" and
// the feature 006 package-naming rule (decisions 2026-06-12, amended 2026-06-13).
//
// - The retired saleor/cli-era hosts id.saleor.online and api.saleor.cloud
//   must not appear ANYWHERE in Jolly code or output strings.
// - api.vercel.com must not appear in Jolly's own code: Vercel is reached only
//   by the Vercel CLI the agent runs, never by Jolly (decision 2026-06-13).
// - The Jolly package name is @dk/jolly, the only Jolly package name; no
//   alternative Jolly package (e.g. an @saleor/jolly scope) may be mentioned.
//   The @saleor/configurator CLI *is* allowed: it is the official tool the
//   customer's agent runs, named as guidance in the playbook (decision
//   2026-06-13) — it is not a Jolly package.
//
// Scope: the Crew-owned program (src/, bin/) plus package.json. assets/ is
// Captain-owned and outside test coverage.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...listFiles(path));
    else found.push(path);
  }
  return found;
}

const PROGRAM_FILES = [
  ...listFiles(join(REPO_ROOT, "src")),
  join(REPO_ROOT, "bin", "jolly"),
  join(REPO_ROOT, "package.json"),
];

function occurrences(needle: string | RegExp): string[] {
  const hits: string[] = [];
  for (const file of PROGRAM_FILES) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match =
        typeof needle === "string"
          ? lines[i].includes(needle)
          : needle.test(lines[i]);
      if (match) hits.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

describe("first-party hosts only (feature 020 rule)", () => {
  test("the retired host id.saleor.online appears nowhere", () => {
    assert.deepStrictEqual(occurrences("id.saleor.online"), []);
  });

  test("the retired host api.saleor.cloud appears nowhere", () => {
    assert.deepStrictEqual(occurrences("api.saleor.cloud"), []);
  });

  test("api.vercel.com is not in Jolly's own code (Vercel is agent-run, 2026-06-13)", () => {
    assert.deepStrictEqual(occurrences("api.vercel.com"), []);
  });
});

describe("package naming (feature 006 rule)", () => {
  test("no @saleor/ JOLLY package scope is mentioned (configurator is allowed)", () => {
    // The only legitimate @saleor/ mention is the @saleor/configurator CLI the
    // agent runs (playbook guidance). Any @saleor/ token that is NOT
    // configurator — in particular an @saleor/jolly package — is banned.
    const offending = occurrences(/@saleor\/(?!configurator)/);
    assert.deepStrictEqual(offending, []);
  });

  test("@saleor/jolly is never mentioned, not even as future/official", () => {
    assert.deepStrictEqual(occurrences("@saleor/jolly"), []);
  });

  test("the only package name is @dk/jolly", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { name?: string };
    assert.strictEqual(pkg.name, "@dk/jolly");
  });
});
