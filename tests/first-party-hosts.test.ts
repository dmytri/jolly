// Enforcement-level units for feature 020 Rule "First-party hosts only" and
// the feature 006 package-naming rule (decisions 2026-06-12).
//
// - The retired saleor/cli-era hosts id.saleor.online and api.saleor.cloud
//   must not appear ANYWHERE in Jolly code or output strings.
// - No package name other than @dk/jolly may be mentioned — the @saleor/
//   npm scope is banned from code and output, not even as "future/official".
//
// Scope: the Crew-owned program (src/, bin/) plus package.json. homepage/
// and assets/ are Captain-owned and outside test coverage.
import { describe, expect, test } from "bun:test";
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
    expect(occurrences("id.saleor.online")).toEqual([]);
  });

  test("the retired host api.saleor.cloud appears nowhere", () => {
    expect(occurrences("api.saleor.cloud")).toEqual([]);
  });
});

describe("package naming (feature 006 rule)", () => {
  test("no @saleor/ package scope is mentioned anywhere", () => {
    expect(occurrences("@saleor/")).toEqual([]);
  });

  test("the only package name is @dk/jolly", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { name?: string };
    expect(pkg.name).toBe("@dk/jolly");
  });
});
