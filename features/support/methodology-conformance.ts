// Verification support for the methodology-conformance feature. Three derived
// checks that make Shipshape methodology rules executable:
//   - the perturbation-quiescence scan: the implementation directories carry no
//     standing perturbation token,
//   - the watchbill-shape validator: watchbill.json's fixed shape (ordered
//     watchN keys, each holding only a "scenarios" array of references or tier
//     tags), and
//   - the spec-comment check: no feature file carries a bare `#` comment line.
// Both are QM-owned verification support, not production code. This module
// lives in the verification layer (features/support), which the
// perturbation-quiescence scan does not read; only the implementation
// directories src/ and bin/ are scanned.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface TokenMatch {
  /** Repo-root-relative path of the file carrying the token. */
  file: string;
  /** 1-based line number of the match. */
  line: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan the given repo-root-relative directories for the token, reporting one
 * match per line that contains it.
 */
export function scanForToken(dirs: string[], token: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  for (const rel of dirs) {
    for (const file of walkFiles(join(REPO_ROOT, rel))) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      text.split("\n").forEach((lineText, index) => {
        if (lineText.includes(token)) {
          matches.push({ file: file.slice(REPO_ROOT.length + 1), line: index + 1 });
        }
      });
    }
  }
  return matches;
}

/** A bare `#` comment line in a feature file. */
export interface CommentLine {
  file: string;
  /** 1-based line number of the comment. */
  line: number;
  text: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

/**
 * Read every feature file under the specs directory and report each bare `#`
 * comment line. Gherkin allows a comment anywhere, and a comment reaches every
 * role that reads the spec, so it crosses the context bulkhead by construction:
 * durable non-requirement context belongs in `Rule:` prose instead.
 *
 * A `#` inside a doc string is content the scenario carries, not a comment, so
 * doc-string bodies are read past.
 */
export function findBareComments(
  specsDir: string,
  injected: InjectedSource[] = [],
): CommentLine[] {
  const sources: InjectedSource[] = walkFiles(join(REPO_ROOT, specsDir))
    .filter((file) => file.endsWith(".feature"))
    .map((file) => ({
      file: file.slice(REPO_ROOT.length + 1),
      text: readFileSync(file, "utf8"),
    }));
  sources.push(...injected);

  const comments: CommentLine[] = [];
  for (const source of sources) {
    let inDocString = false;
    source.text.split("\n").forEach((lineText, index) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('"""') || trimmed.startsWith("```")) {
        inDocString = !inDocString;
        return;
      }
      if (inDocString) return;
      if (trimmed.startsWith("#")) {
        comments.push({ file: source.file, line: index + 1, text: trimmed });
      }
    });
  }
  return comments;
}

export interface ShapeResult {
  valid: boolean;
  errors: string[];
}

/** A repo-root-relative "<spec>.feature:<Scenario Name>" reference. */
const REFERENCE = /\.feature:.+/;
/** A tier tag such as @logic, @sandbox, @eval. */
const TIER_TAG = /^@[a-z][a-z0-9-]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a watchbill against its fixed shape: only ordered watch objects
 * named watch1, watch2, and onward, each containing only a "scenarios" array of
 * "<spec>.feature:<Scenario Name>" references or tier tags, with no prose,
 * metadata, or other key.
 */
export function validateWatchbillShape(value: unknown): ShapeResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["watchbill is not a JSON object"] };
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    errors.push("watchbill carries no watches");
  }
  keys.forEach((key, index) => {
    const expected = `watch${index + 1}`;
    if (key !== expected) {
      errors.push(`key "${key}" is not the ordered watch name "${expected}"`);
    }
    const watch = value[key];
    if (!isPlainObject(watch)) {
      errors.push(`watch "${key}" is not an object`);
      return;
    }
    for (const watchKey of Object.keys(watch)) {
      if (watchKey !== "scenarios") {
        errors.push(`watch "${key}" carries a key other than "scenarios": "${watchKey}"`);
      }
    }
    const scenarios = watch.scenarios;
    if (!Array.isArray(scenarios)) {
      errors.push(`watch "${key}" has no "scenarios" array`);
      return;
    }
    scenarios.forEach((entry, position) => {
      if (typeof entry !== "string") {
        errors.push(`watch "${key}" scenario ${position} is not a string`);
        return;
      }
      if (!REFERENCE.test(entry) && !TIER_TAG.test(entry)) {
        errors.push(
          `watch "${key}" scenario ${position} "${entry}" is neither a "<spec>.feature:<Scenario Name>" reference nor a tier tag`,
        );
      }
    });
  });
  return { valid: errors.length === 0, errors };
}
