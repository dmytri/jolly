// Logic-tier units for local .env secret handling (AGENTS.md "Secret and
// Environment Handling"; features 005 and 018): .env is ensured Git-ignored
// BEFORE secrets are written, values merge without clobbering unrelated
// lines, and the updated values are returned for the current command flow.
//
// Pinned harness seam: src/lib/env-file.ts exports
//   writeEnvValues(projectDir, values) and loadEnvValues(projectDir).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
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
    writeEnvValues(dir, { SALEOR_TOKEN: "tok_test_123" });
    assert.strictEqual(existsSync(join(dir, ".gitignore")), true);
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    assert.ok(ignored.includes(".env"));
  });

  test("does not duplicate an existing .env ignore entry", () => {
    const dir = tempProject();
    writeFileSync(join(dir, ".gitignore"), "node_modules\n.env\n");
    writeEnvValues(dir, { SALEOR_TOKEN: "tok" });
    const content = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.strictEqual(content.split("\n").filter((l) => l.trim() === ".env").length, 1);
    assert.ok(content.includes("node_modules"));
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
    assert.ok(content.includes("# storefront"));
    assert.ok(content.includes("OTHER=keep"));
    assert.ok(content.includes("NEXT_PUBLIC_SALEOR_API_URL=https://y/graphql/"));
    assert.ok(!content.includes("https://x/graphql/"));
    assert.strictEqual(loaded.JOLLY_VERCEL_TOKEN, "vt");
    assert.strictEqual(loaded.OTHER, "keep");
  });

  test("preserves a leading '# ====' header block across a write", () => {
    const dir = tempProject();
    const header =
      "# ==== Jolly / Saleor environment ====\n" +
      "# Managed by Jolly. SALEOR_URL / SALEOR_TOKEN are the agent-facing surface.\n" +
      "# ====================================\n";
    writeFileSync(join(dir, ".env"), `${header}SALEOR_URL=https://x/graphql/\n`);
    writeEnvValues(dir, { SALEOR_TOKEN: "tok_test_123" });
    const content = readFileSync(join(dir, ".env"), "utf8");
    // The whole comment header block survives untouched (it is not an ENV_LINE).
    assert.ok(content.includes("# ==== Jolly / Saleor environment ===="));
    assert.ok(content.includes("# ===================================="));
    assert.ok(content.includes("SALEOR_URL=https://x/graphql/"));
    assert.ok(content.includes("SALEOR_TOKEN=tok_test_123"));
    // The sentinel header line appears exactly once (no duplication on write).
    assert.strictEqual(
      content.split("\n").filter((l) => l === "# ==== Jolly / Saleor environment ====").length,
      1,
    );
  });

  test("returns the full post-update value map for the current command flow", () => {
    const dir = tempProject();
    writeEnvValues(dir, { A: "1" });
    const loaded = writeEnvValues(dir, { B: "2" });
    assert.deepStrictEqual(loaded, { A: "1", B: "2" });
  });
});

describe("loadEnvValues", () => {
  test("returns an empty record when .env is absent", () => {
    assert.deepStrictEqual(loadEnvValues(tempProject()), {});
  });

  test("parses export-prefixed and spaced assignments", () => {
    const dir = tempProject();
    writeFileSync(join(dir, ".env"), "export JOLLY_SALEOR_CLOUD_TOKEN = abc\n");
    assert.strictEqual(loadEnvValues(dir).JOLLY_SALEOR_CLOUD_TOKEN, "abc");
  });
});
