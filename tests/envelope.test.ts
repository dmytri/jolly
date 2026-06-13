// Logic-tier units for the harness envelope/riskContext validators
// (features 020 and 021): JSON extraction from mixed CLI output, envelope
// shape, camelCase fields, doctor check vocabulary, and riskContext shape.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCamelCaseKeys,
  assertEnvelopeShape,
  assertRiskContextShape,
  extractJsonObjects,
  findEnvelope,
  findRiskContexts,
  type Envelope,
} from "../features/support/envelope.ts";

/** Deep-equality membership check (node:assert has no toContainEqual). */
function containsEqual(haystack: unknown[], needle: unknown): boolean {
  return haystack.some((item) => {
    try {
      assert.deepStrictEqual(item, needle);
      return true;
    } catch {
      return false;
    }
  });
}

const validEnvelope: Envelope = {
  command: "doctor",
  status: "success",
  summary: "All checks passed",
  data: {},
  checks: [{ id: "cli.version", status: "pass" }],
  nextSteps: [{ description: "Run jolly start", command: "jolly start" }],
  errors: [],
};

describe("extractJsonObjects", () => {
  test("finds the envelope inside mixed human-readable output", () => {
    const stdout = `Jolly doctor\n  ✓ cli ok\n${JSON.stringify(validEnvelope)}\nDone.\n`;
    const objects = extractJsonObjects(stdout);
    assert.ok(containsEqual(objects, validEnvelope));
  });

  test("handles braces inside JSON strings", () => {
    const tricky = { summary: 'use {"json": true} carefully', command: "x", status: "success" };
    const objects = extractJsonObjects(`note\n${JSON.stringify(tricky)}`);
    assert.ok(containsEqual(objects, tricky));
  });

  test("ignores non-JSON brace blocks", () => {
    assert.deepStrictEqual(extractJsonObjects("if (x) { y(); }"), []);
  });

  test("findEnvelope returns undefined when no envelope is present", () => {
    assert.strictEqual(findEnvelope("plain text only"), undefined);
  });
});

describe("assertEnvelopeShape", () => {
  test("accepts a contract-compliant envelope", () => {
    assert.doesNotThrow(() => assertEnvelopeShape(validEnvelope));
  });

  test("rejects an unknown status", () => {
    assert.throws(
      () => assertEnvelopeShape({ ...validEnvelope, status: "ok" }),
      /status/,
    );
  });

  test("rejects snake_case field names", () => {
    const env = { ...validEnvelope, next_steps: [] } as unknown as Record<string, unknown>;
    assert.throws(() => assertEnvelopeShape(env), /camelCase/);
  });

  test("rejects checks outside the doctor vocabulary", () => {
    assert.throws(
      () =>
        assertEnvelopeShape({
          ...validEnvelope,
          checks: [{ id: "x", status: "green" }],
        }),
      /pass\|warning\|fail\|skipped\|unknown/,
    );
  });

  test("rejects errors without a stable code", () => {
    assert.throws(
      () =>
        assertEnvelopeShape({
          ...validEnvelope,
          errors: [{ message: "boom" }],
        }),
      /code/,
    );
  });

  test("camelCase checker flags kebab-case keys", () => {
    assert.throws(() => assertCamelCaseKeys({ "risk-level": 1 }, "test"), /camelCase/);
  });
});

describe("riskContext (feature 021)", () => {
  const validRiskContext = {
    action: "create store",
    target: { resource: "saleor-cloud-store", scope: "account" },
    riskLevel: "medium",
    categories: ["billing"],
    reversible: true,
    sideEffects: ["creates a store"],
    dryRunAvailable: true,
  };

  test("accepts a contract-compliant riskContext", () => {
    assert.doesNotThrow(() => assertRiskContextShape(validRiskContext));
  });

  test("rejects categories outside the feature 010 high-risk list", () => {
    assert.throws(
      () => assertRiskContextShape({ ...validRiskContext, categories: ["misc"] }),
      /high-risk list/,
    );
  });

  test("rejects a riskLevel outside low|medium|high", () => {
    assert.throws(
      () => assertRiskContextShape({ ...validRiskContext, riskLevel: "extreme" }),
      /riskLevel/,
    );
  });

  test("findRiskContexts locates riskContext inside data and checks", () => {
    const env: Envelope = {
      ...validEnvelope,
      data: { riskContext: validRiskContext },
      checks: [
        { id: "x", status: "pass", riskContext: validRiskContext } as never,
      ],
    };
    assert.strictEqual(findRiskContexts(env).length, 2);
  });

  test("findRiskContexts finds nothing in a plain envelope", () => {
    assert.strictEqual(findRiskContexts(validEnvelope).length, 0);
  });
});
