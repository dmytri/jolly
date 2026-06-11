// Output-envelope and riskContext validation (features 020 and 021).
//
// Every Jolly command emits one envelope: command, status, summary, data,
// checks, nextSteps, errors. checks[].status uses the doctor vocabulary.
// riskContext (action, target, riskLevel, categories, reversible,
// sideEffects, dryRunAvailable) is carried inside data and/or checks.
// Field names are camelCase. Secrets are referenced by name, never printed.
import assert from "node:assert/strict";

export const ENVELOPE_STATUSES = ["success", "warning", "error"] as const;
export const CHECK_STATUSES = [
  "pass",
  "warning",
  "fail",
  "skipped",
  "unknown",
] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
// Feature 010 high-risk category list, reused verbatim by feature 021.
export const RISK_CATEGORIES = [
  "destructive operations",
  "billing",
  "payment setup",
  "credential handling",
  "live deployment",
  "production configuration changes",
] as const;

export interface Check {
  id: string;
  status: (typeof CHECK_STATUSES)[number];
  [key: string]: unknown;
}

export interface Envelope {
  command: string;
  status: (typeof ENVELOPE_STATUSES)[number];
  summary: string;
  data: Record<string, unknown>;
  checks: Check[];
  nextSteps: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

export interface RiskContext {
  action: string;
  target: unknown;
  riskLevel: (typeof RISK_LEVELS)[number];
  categories: string[];
  reversible: boolean;
  sideEffects: unknown[];
  dryRunAvailable: boolean;
}

/**
 * Scan text for top-level JSON objects (balanced braces, string-aware) and
 * return the ones that parse. Default-mode CLI output mixes human text with
 * the machine-readable envelope; this finds the envelope without pinning
 * where in the output it appears.
 */
export function extractJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            objects.push(JSON.parse(text.slice(start, i + 1)));
          } catch {
            // Not valid JSON (for example a code block in human text); skip.
          }
          start = -1;
        }
      }
    }
  }
  return objects;
}

function looksLikeEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    "status" in value &&
    "summary" in value
  );
}

/** Find the output envelope in CLI stdout (any output mode). */
export function findEnvelope(stdout: string): Envelope | undefined {
  return extractJsonObjects(stdout).filter(looksLikeEnvelope).pop();
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

/** Assert the contract keys of an object are camelCase (feature 020). */
export function assertCamelCaseKeys(
  obj: Record<string, unknown>,
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    assert.match(
      key,
      CAMEL_CASE,
      `${context} field "${key}" must be camelCase`,
    );
  }
}

/** Assert the full envelope shape of feature 020. */
export function assertEnvelopeShape(value: unknown): asserts value is Envelope {
  assert.ok(
    typeof value === "object" && value !== null,
    "envelope must be a JSON object",
  );
  const env = value as Record<string, unknown>;
  assertCamelCaseKeys(env, "envelope");
  assert.equal(typeof env.command, "string", "envelope.command must be a string");
  assert.ok(
    ENVELOPE_STATUSES.includes(env.status as never),
    `envelope.status must be one of ${ENVELOPE_STATUSES.join("|")}, got ${String(env.status)}`,
  );
  assert.equal(typeof env.summary, "string", "envelope.summary must be a string");
  assert.ok(
    typeof env.data === "object" && env.data !== null && !Array.isArray(env.data),
    "envelope.data must be an object",
  );
  assert.ok(Array.isArray(env.checks), "envelope.checks must be an array");
  assert.ok(Array.isArray(env.nextSteps), "envelope.nextSteps must be an array");
  assert.ok(Array.isArray(env.errors), "envelope.errors must be an array");
  for (const check of env.checks as unknown[]) {
    assertCheckShape(check);
  }
  for (const step of env.nextSteps as unknown[]) {
    assert.ok(
      typeof step === "object" && step !== null,
      "nextSteps entries must be objects",
    );
    assertCamelCaseKeys(step as Record<string, unknown>, "nextSteps entry");
    assert.equal(
      typeof (step as Record<string, unknown>).description,
      "string",
      "nextSteps[].description must be a string",
    );
  }
  for (const error of env.errors as unknown[]) {
    assert.ok(
      typeof error === "object" && error !== null,
      "errors entries must be objects",
    );
    const entry = error as Record<string, unknown>;
    assertCamelCaseKeys(entry, "errors entry");
    assert.equal(typeof entry.code, "string", "errors[].code must be a string");
    assert.equal(
      typeof entry.message,
      "string",
      "errors[].message must be a string",
    );
  }
}

/** Assert one checks[] entry: stable id plus the doctor status vocabulary. */
export function assertCheckShape(value: unknown): asserts value is Check {
  assert.ok(
    typeof value === "object" && value !== null,
    "checks entries must be objects",
  );
  const check = value as Record<string, unknown>;
  assertCamelCaseKeys(check, "check");
  assert.equal(typeof check.id, "string", "checks[].id must be a string");
  assert.ok(
    (check.id as string).length > 0,
    "checks[].id must be a non-empty stable identifier",
  );
  assert.ok(
    CHECK_STATUSES.includes(check.status as never),
    `checks[].status must be one of ${CHECK_STATUSES.join("|")}, got ${String(check.status)}`,
  );
}

/** Assert the riskContext shape of feature 021. */
export function assertRiskContextShape(
  value: unknown,
): asserts value is RiskContext {
  assert.ok(
    typeof value === "object" && value !== null,
    "riskContext must be an object",
  );
  const rc = value as Record<string, unknown>;
  assertCamelCaseKeys(rc, "riskContext");
  assert.equal(typeof rc.action, "string", "riskContext.action must be a string");
  assert.ok(rc.target !== undefined && rc.target !== null, "riskContext.target is required");
  assert.ok(
    RISK_LEVELS.includes(rc.riskLevel as never),
    `riskContext.riskLevel must be one of ${RISK_LEVELS.join("|")}, got ${String(rc.riskLevel)}`,
  );
  assert.ok(Array.isArray(rc.categories), "riskContext.categories must be an array");
  for (const category of rc.categories as unknown[]) {
    assert.ok(
      RISK_CATEGORIES.includes(category as never),
      `riskContext category "${String(category)}" is not in the feature 010 high-risk list`,
    );
  }
  assert.equal(
    typeof rc.reversible,
    "boolean",
    "riskContext.reversible must be a boolean",
  );
  assert.ok(Array.isArray(rc.sideEffects), "riskContext.sideEffects must be an array");
  assert.equal(
    typeof rc.dryRunAvailable,
    "boolean",
    "riskContext.dryRunAvailable must be a boolean",
  );
}

/**
 * Find every riskContext carried inside an envelope's data and/or checks
 * (feature 021: never a separate ad hoc format outside the envelope).
 */
export function findRiskContexts(envelope: Envelope): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        if (key === "riskContext" && child !== null && child !== undefined) {
          found.push(child);
        } else {
          visit(child);
        }
      }
    }
  };
  visit(envelope.data);
  visit(envelope.checks);
  return found;
}
