// Logic-tier units for the harness envelope/riskContext validators
// (features 020 and 021): JSON extraction from mixed CLI output, envelope
// shape, camelCase fields, doctor check vocabulary, and riskContext shape.
import { describe, expect, test } from "bun:test";
import {
  assertCamelCaseKeys,
  assertEnvelopeShape,
  assertRiskContextShape,
  extractJsonObjects,
  findEnvelope,
  findRiskContexts,
  type Envelope,
} from "../features/support/envelope.ts";

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
    expect(objects).toContainEqual(validEnvelope);
  });

  test("handles braces inside JSON strings", () => {
    const tricky = { summary: 'use {"json": true} carefully', command: "x", status: "success" };
    const objects = extractJsonObjects(`note\n${JSON.stringify(tricky)}`);
    expect(objects).toContainEqual(tricky);
  });

  test("ignores non-JSON brace blocks", () => {
    expect(extractJsonObjects("if (x) { y(); }")).toEqual([]);
  });

  test("findEnvelope returns undefined when no envelope is present", () => {
    expect(findEnvelope("plain text only")).toBeUndefined();
  });
});

describe("assertEnvelopeShape", () => {
  test("accepts a contract-compliant envelope", () => {
    expect(() => assertEnvelopeShape(validEnvelope)).not.toThrow();
  });

  test("rejects an unknown status", () => {
    expect(() =>
      assertEnvelopeShape({ ...validEnvelope, status: "ok" }),
    ).toThrow(/status/);
  });

  test("rejects snake_case field names", () => {
    const env = { ...validEnvelope, next_steps: [] } as unknown as Record<string, unknown>;
    expect(() => assertEnvelopeShape(env)).toThrow(/camelCase/);
  });

  test("rejects checks outside the doctor vocabulary", () => {
    expect(() =>
      assertEnvelopeShape({
        ...validEnvelope,
        checks: [{ id: "x", status: "green" }],
      }),
    ).toThrow(/pass\|warning\|fail\|skipped\|unknown/);
  });

  test("rejects errors without a stable code", () => {
    expect(() =>
      assertEnvelopeShape({
        ...validEnvelope,
        errors: [{ message: "boom" }],
      }),
    ).toThrow(/code/);
  });

  test("camelCase checker flags kebab-case keys", () => {
    expect(() => assertCamelCaseKeys({ "risk-level": 1 }, "test")).toThrow(
      /camelCase/,
    );
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
    expect(() => assertRiskContextShape(validRiskContext)).not.toThrow();
  });

  test("rejects categories outside the feature 010 high-risk list", () => {
    expect(() =>
      assertRiskContextShape({ ...validRiskContext, categories: ["misc"] }),
    ).toThrow(/high-risk list/);
  });

  test("rejects a riskLevel outside low|medium|high", () => {
    expect(() =>
      assertRiskContextShape({ ...validRiskContext, riskLevel: "extreme" }),
    ).toThrow(/riskLevel/);
  });

  test("findRiskContexts locates riskContext inside data and checks", () => {
    const env: Envelope = {
      ...validEnvelope,
      data: { riskContext: validRiskContext },
      checks: [
        { id: "x", status: "pass", riskContext: validRiskContext } as never,
      ],
    };
    expect(findRiskContexts(env)).toHaveLength(2);
  });

  test("findRiskContexts finds nothing in a plain envelope", () => {
    expect(findRiskContexts(validEnvelope)).toHaveLength(0);
  });
});
