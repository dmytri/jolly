// Pure validators for the feature 020 output envelope and the feature 021
// riskContext. Logic-tier (no accounts); unit-covered in tests/envelope.test.ts.
import type { Envelope } from "./cli.ts";

export const ENVELOPE_FIELDS = [
  "command",
  "status",
  "summary",
  "data",
  "checks",
  "nextSteps",
  "errors",
] as const;

export const ENVELOPE_STATUS = ["success", "warning", "error"] as const;

// Doctor check vocabulary (features 014 and 020).
export const CHECK_STATUS = ["pass", "warning", "fail", "skipped", "unknown"] as const;

export const RISK_LEVELS = ["low", "medium", "high"] as const;

// Feature 010 high-risk category list, referenced by feature 021.
export const RISK_CATEGORIES = [
  "destructive operations",
  "billing",
  "payment setup",
  "credential handling",
  "live deployment",
  "production configuration changes",
] as const;

export const RISK_CONTEXT_FIELDS = [
  "action",
  "target",
  "riskLevel",
  "categories",
  "reversible",
  "sideEffects",
  "dryRunAvailable",
] as const;

export interface RiskContext {
  action: string;
  target: unknown;
  riskLevel: string;
  categories: unknown[];
  reversible: boolean;
  sideEffects: unknown;
  dryRunAvailable: boolean;
  [key: string]: unknown;
}

/** Returns a list of contract violations; empty means the envelope is valid. */
export function envelopeProblems(envelope: unknown): string[] {
  const problems: string[] = [];
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return ["envelope is not a JSON object"];
  }
  const e = envelope as Record<string, unknown>;
  if (typeof e.command !== "string" || e.command.length === 0)
    problems.push("`command` must be a non-empty string");
  if (!ENVELOPE_STATUS.includes(e.status as (typeof ENVELOPE_STATUS)[number]))
    problems.push(`\`status\` must be one of ${ENVELOPE_STATUS.join("|")}, got ${JSON.stringify(e.status)}`);
  if (typeof e.summary !== "string") problems.push("`summary` must be a string");
  if (typeof e.data !== "object" || e.data === null || Array.isArray(e.data))
    problems.push("`data` must be an object");
  if (e.checks !== undefined && !Array.isArray(e.checks)) problems.push("`checks` must be an array");
  if (!Array.isArray(e.nextSteps)) problems.push("`nextSteps` must be an array");
  if (!Array.isArray(e.errors)) problems.push("`errors` must be an array");
  for (const check of Array.isArray(e.checks) ? e.checks : []) {
    problems.push(...checkProblems(check));
  }
  for (const err of Array.isArray(e.errors) ? e.errors : []) {
    problems.push(...errorEntryProblems(err));
  }
  return problems;
}

export function checkProblems(check: unknown): string[] {
  const problems: string[] = [];
  if (typeof check !== "object" || check === null) return ["checks[] entry is not an object"];
  const c = check as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0)
    problems.push("checks[] entry is missing a stable string `id`");
  if (!CHECK_STATUS.includes(c.status as (typeof CHECK_STATUS)[number]))
    problems.push(
      `checks[].status must be one of ${CHECK_STATUS.join("|")}, got ${JSON.stringify(c.status)}`,
    );
  return problems;
}

export function errorEntryProblems(err: unknown): string[] {
  const problems: string[] = [];
  if (typeof err !== "object" || err === null) return ["errors[] entry is not an object"];
  const e = err as Record<string, unknown>;
  if (typeof e.code !== "string" || e.code.length === 0)
    problems.push("errors[] entry is missing a stable string `code`");
  if (typeof e.message !== "string" || e.message.length === 0)
    problems.push("errors[] entry is missing a string `message`");
  if (e.remediation !== undefined && typeof e.remediation !== "string")
    problems.push("errors[].remediation must be a string when present");
  return problems;
}

export function riskContextProblems(rc: unknown): string[] {
  const problems: string[] = [];
  if (typeof rc !== "object" || rc === null) return ["riskContext is not an object"];
  const r = rc as Record<string, unknown>;
  if (typeof r.action !== "string" || r.action.length === 0)
    problems.push("riskContext.action must be a non-empty string");
  if (r.target === undefined) problems.push("riskContext.target is missing");
  if (!RISK_LEVELS.includes(r.riskLevel as (typeof RISK_LEVELS)[number]))
    problems.push(
      `riskContext.riskLevel must be one of ${RISK_LEVELS.join("|")}, got ${JSON.stringify(r.riskLevel)}`,
    );
  if (!Array.isArray(r.categories)) problems.push("riskContext.categories must be an array");
  if (typeof r.reversible !== "boolean") problems.push("riskContext.reversible must be a boolean");
  if (r.sideEffects === undefined) problems.push("riskContext.sideEffects is missing");
  if (typeof r.dryRunAvailable !== "boolean")
    problems.push("riskContext.dryRunAvailable must be a boolean");
  return problems;
}

/**
 * Find every `riskContext` object carried inside the envelope's `data` and/or
 * `checks` (feature 021: inside the envelope, not an ad hoc side channel).
 */
export function findRiskContexts(envelope: Envelope): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.riskContext !== undefined) found.push(record.riskContext);
    for (const child of Object.values(record)) visit(child);
  };
  visit(envelope.data);
  visit(envelope.checks ?? []);
  return found;
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

/** Deep-checks JSON field naming (feature 020: camelCase keys). */
export function nonCamelCaseKeys(value: unknown, path = "$"): string[] {
  const offenders: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => offenders.push(...nonCamelCaseKeys(item, `${path}[${index}]`)));
    return offenders;
  }
  if (typeof value !== "object" || value === null) return offenders;
  for (const [key, child] of Object.entries(value)) {
    if (!CAMEL_CASE.test(key)) offenders.push(`${path}.${key}`);
    offenders.push(...nonCamelCaseKeys(child, `${path}.${key}`));
  }
  return offenders;
}

/** True when the JSON-serialized value contains the given secret anywhere. */
export function containsSecret(value: unknown, secret: string): boolean {
  return JSON.stringify(value ?? "").includes(secret);
}
