// Logic-tier units for local .env secret handling (AGENTS.md "Secret and
// Environment Handling"; features 005 and 018): .env is ensured Git-ignored
// BEFORE secrets are written, values merge without clobbering unrelated
// lines, and the updated values are returned for the current command flow.
//
// Pinned harness seam: src/lib/env-file.ts exports
//   writeEnvValues(projectDir, values) and loadEnvValues(projectDir).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvValues, writeEnvValues } from "../src/lib/env-file.ts";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "jolly-test-envfile-"));
}

describe("writeEnvValues", () => {
  test("ensures .env is Git-ignored before writing secrets", () => {
    const dir = tempProject();
    writeEnvValues(dir, { JOLLY_STRIPE_SECRET_KEY: "sk_test_123" });
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    expect(ignored).toContain(".env");
  });

  test("does not duplicate an existing .env ignore entry", () => {
    const dir = tempProject();
    writeFileSync(join(dir, ".gitignore"), "node_modules\n.env\n");
    writeEnvValues(dir, { JOLLY_SALEOR_APP_TOKEN: "tok" });
    const content = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(content.split("\n").filter((l) => l.trim() === ".env")).toHaveLength(1);
    expect(content).toContain("node_modules");
  });

  test("merges values, preserving unrelated lines and comments", () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, ".env"),
      "# storefront\nNEXT_PUBLIC_SALEOR_API_URL=https://x/graphql/\nOTHER=keep\n",
    );
    const loaded = writeEnvValues(dir, {
      NEXT_PUBLIC_SALEOR_API_URL: "https://y/graphql/",
      JOLLY_VERCEL_TOKEN: "vt",
    });
    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).toContain("# storefront");
    expect(content).toContain("OTHER=keep");
    expect(content).toContain("NEXT_PUBLIC_SALEOR_API_URL=https://y/graphql/");
    expect(content).not.toContain("https://x/graphql/");
    expect(loaded.JOLLY_VERCEL_TOKEN).toBe("vt");
    expect(loaded.OTHER).toBe("keep");
  });

  test("returns the full post-update value map for the current command flow", () => {
    const dir = tempProject();
    writeEnvValues(dir, { A: "1" });
    const loaded = writeEnvValues(dir, { B: "2" });
    expect(loaded).toEqual({ A: "1", B: "2" });
  });
});

describe("loadEnvValues", () => {
  test("returns an empty record when .env is absent", () => {
    expect(loadEnvValues(tempProject())).toEqual({});
  });

  test("parses export-prefixed and spaced assignments", () => {
    const dir = tempProject();
    writeFileSync(join(dir, ".env"), "export JOLLY_SALEOR_CLOUD_TOKEN = abc\n");
    expect(loadEnvValues(dir).JOLLY_SALEOR_CLOUD_TOKEN).toBe("abc");
  });
});
