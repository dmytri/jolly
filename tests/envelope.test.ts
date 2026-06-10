// Logic-tier unit tests for the envelope/riskContext validators. See feature 023.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envelopeProblems,
  errorEntryProblems,
  checkProblems,
  riskContextProblems,
  findRiskContexts,
  nonCamelCaseKeys,
  containsSecret,
} from "../features/support/envelope.ts";
import { extractEnvelope } from "../features/support/cli.ts";

const validEnvelope = {
  command: "doctor",
  status: "success",
  summary: "all good",
  data: {},
  checks: [{ id: "cli.version", status: "pass" }],
  nextSteps: [],
  errors: [],
};

test("a valid envelope has no problems", () => {
  assert.deepEqual(envelopeProblems(validEnvelope), []);
});

test("missing required envelope fields are reported", () => {
  const problems = envelopeProblems({ command: "x", status: "success" });
  assert.ok(problems.some((p) => p.includes("`summary`")));
  assert.ok(problems.some((p) => p.includes("`data`")));
  assert.ok(problems.some((p) => p.includes("`nextSteps`")));
  assert.ok(problems.some((p) => p.includes("`errors`")));
});

test("invalid status and check vocabulary are reported", () => {
  assert.ok(envelopeProblems({ ...validEnvelope, status: "ok" }).length > 0);
  assert.ok(checkProblems({ id: "x", status: "green" }).length > 0);
  assert.deepEqual(checkProblems({ id: "x", status: "skipped" }), []);
});

test("error entries need stable code and message", () => {
  assert.deepEqual(errorEntryProblems({ code: "saleor.unreachable", message: "boom" }), []);
  assert.ok(errorEntryProblems({ message: "boom" }).some((p) => p.includes("`code`")));
  assert.ok(errorEntryProblems({ code: "x" }).some((p) => p.includes("`message`")));
});

test("risk context validation enforces feature 021 fields", () => {
  const rc = {
    action: "create store",
    target: "saleor-cloud:env",
    riskLevel: "medium",
    categories: ["billing"],
    reversible: true,
    sideEffects: ["creates environment"],
    dryRunAvailable: true,
  };
  assert.deepEqual(riskContextProblems(rc), []);
  assert.ok(riskContextProblems({ ...rc, riskLevel: "extreme" }).length > 0);
  assert.ok(riskContextProblems({ ...rc, dryRunAvailable: "yes" }).length > 0);
});

test("riskContext is found inside data and checks but nowhere else", () => {
  const rc = { action: "a", target: "t", riskLevel: "low", categories: [], reversible: true, sideEffects: [], dryRunAvailable: true };
  const envelope = {
    ...validEnvelope,
    data: { plan: { riskContext: rc } },
    checks: [{ id: "x", status: "pass", riskContext: rc }],
  };
  assert.equal(findRiskContexts(envelope as never).length, 2);
  assert.equal(findRiskContexts({ ...validEnvelope } as never).length, 0);
});

test("non-camelCase keys are detected deeply", () => {
  assert.deepEqual(nonCamelCaseKeys({ nextSteps: [{ dryRunAvailable: true }] }), []);
  const offenders = nonCamelCaseKeys({ next_steps: [], data: { "Risk-Level": 1 } });
  assert.ok(offenders.some((o) => o.includes("next_steps")));
  assert.ok(offenders.some((o) => o.includes("Risk-Level")));
});

test("extractEnvelope parses pure JSON stdout", () => {
  const envelope = extractEnvelope(JSON.stringify(validEnvelope));
  assert.equal(envelope?.command, "doctor");
});

test("extractEnvelope finds the envelope embedded in human output", () => {
  const stdout = `Setting things up...\n{"note":"not an envelope"}\nDone!\n${JSON.stringify(validEnvelope)}\nBye {curly} text`;
  const envelope = extractEnvelope(stdout);
  assert.equal(envelope?.command, "doctor");
  assert.equal(envelope?.status, "success");
});

test("extractEnvelope returns undefined when no envelope exists", () => {
  assert.equal(extractEnvelope("just text"), undefined);
  assert.equal(extractEnvelope('{"foo": 1}'), undefined);
});

test("containsSecret scans nested values", () => {
  assert.ok(containsSecret({ data: { token: "sk_test_abc" } }, "sk_test_abc"));
  assert.ok(!containsSecret({ data: { token: "JOLLY_SALEOR_TOKEN" } }, "sk_test_abc"));
});
