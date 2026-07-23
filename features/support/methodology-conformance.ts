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

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

/** A repo-root-relative "<spec>.feature:<Scenario Name>" reference. */
const REFERENCE = /\.feature:.+/;
/** A tier tag such as @logic, @sandbox, @eval. */
const TIER_TAG = /^@[a-z][a-z0-9-]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
