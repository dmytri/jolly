// Verification support for the methodology-conformance scenario "The
// architecture document's structural claims match the tree" (@logic @invariant).
//
// ARCHITECTURE.md is a self-contained orientation document: a deliberate second
// copy of facts whose homes are elsewhere in the repository. A hand-maintained
// second copy drifts, so its structural claims are pinned by this check rather
// than by discipline. Three claim families, per the scenario:
//   - the counts it states for feature files, step-definition files, and
//     unit-test files,
//   - the modules it lists under src/lib/ (the Library Modules section and the
//     project-structure tree), in both directions,
//   - the verification technologies it names (the BDD Verification section's
//     Technologies line), each of which must be referenced in the tree via a
//     package.json dependency.
// A claim the document no longer states in a parseable form is itself drift:
// an unparseable claim is a claim nobody checks.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export type ClaimKind = "count" | "module" | "technology";

export interface ArchitectureViolation {
  kind: ClaimKind;
  message: string;
}

export const ARCHITECTURE_DOCUMENT = join(REPO_ROOT, "ARCHITECTURE.md");

const MODULES_SECTION = "Library Modules";
const VERIFICATION_SECTION = "BDD Verification";
const TECHNOLOGIES_MARKER = "**Technologies:**";

function filesWithSuffix(directory: string, suffix: string): string[] {
  // An absent directory holds zero files: the check reports the count drift
  // honestly instead of crashing on a legitimately retired surface.
  let entries: string[];
  try {
    entries = readdirSync(join(REPO_ROOT, directory));
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(suffix));
}

/** The body of the first section whose heading contains `title`. */
function section(documentText: string, title: string): string | undefined {
  const lines = documentText.split("\n");
  const start = lines.findIndex(
    (line) => /^#{1,6}\s/.test(line) && line.includes(title),
  );
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** Every stated count matching `pattern`, as numbers. */
function statedCounts(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

function checkCounts(documentText: string, violations: ArchitectureViolation[]): void {
  const claims: { label: string; pattern: RegExp; actual: number }[] = [
    {
      label: "feature files",
      pattern: /(\d+)\s+(?:Gherkin\s+)?feature files/g,
      actual: filesWithSuffix("features", ".feature").length,
    },
    {
      label: "step-definition files",
      pattern: /(\d+)\s+step-definition files/g,
      actual: filesWithSuffix("features/step_definitions", ".steps.ts").length,
    },
  ];
  for (const claim of claims) {
    const stated = statedCounts(documentText, claim.pattern);
    if (stated.length === 0) {
      violations.push({
        kind: "count",
        message: `the document states no count for ${claim.label}; the tree has ${claim.actual}`,
      });
      continue;
    }
    for (const count of stated) {
      if (count !== claim.actual) {
        violations.push({
          kind: "count",
          message: `the document states ${count} ${claim.label}; the tree has ${claim.actual}`,
        });
      }
    }
  }

  const unitTests = filesWithSuffix("tests", ".test.ts").length;
  const unitSection = section(documentText, "Unit Tests");
  const stated = unitSection ? statedCounts(unitSection, /(\d+)\s+files/g) : [];
  if (stated.length === 0) {
    // A document claiming nothing about a surface the tree does not have is
    // agreement, not drift; the missing-claim violation fires only while the
    // tree actually holds unit-test files.
    if (unitTests > 0) {
      violations.push({
        kind: "count",
        message: `the document states no count for unit-test files; the tree has ${unitTests}`,
      });
    }
  } else if (stated[0] !== unitTests) {
    violations.push({
      kind: "count",
      message: `the document states ${stated[0]} unit-test files; the tree has ${unitTests}`,
    });
  }
}

/** Module names the project-structure tree lists under `lib/`. */
function treeListedModules(documentText: string): string[] {
  const lines = documentText.split("\n");
  const start = lines.findIndex((line) => /──\s+lib\//.test(line));
  if (start === -1) return [];
  const libColumn = lines[start]!.indexOf("──");
  const modules: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const column = line.indexOf("──");
    if (column === -1) continue;
    if (column <= libColumn) break;
    for (const match of line.matchAll(/([A-Za-z0-9._-]+\.ts)\b/g)) {
      modules.push(match[1]!);
    }
  }
  return modules;
}

function checkModules(documentText: string, violations: ArchitectureViolation[]): void {
  const sectionBody = section(documentText, MODULES_SECTION);
  if (sectionBody === undefined) {
    violations.push({
      kind: "module",
      message: `the document has no "${MODULES_SECTION}" section listing src/lib/ modules`,
    });
    return;
  }
  const listed = new Set<string>();
  for (const match of sectionBody.matchAll(/`([A-Za-z0-9._-]+\.ts)`/g)) {
    listed.add(match[1]!);
  }
  for (const name of treeListedModules(documentText)) listed.add(name);
  const existing = new Set(filesWithSuffix("src/lib", ".ts"));
  for (const name of listed) {
    if (!existing.has(name)) {
      violations.push({
        kind: "module",
        message: `the document lists "src/lib/${name}", which does not exist`,
      });
    }
  }
  for (const name of existing) {
    if (!listed.has(name)) {
      violations.push({
        kind: "module",
        message: `"src/lib/${name}" exists but the document does not list it`,
      });
    }
  }
}

/** The technology names on the verification section's Technologies line. */
export function namedVerificationTechnologies(documentText: string): string[] {
  const sectionBody = section(documentText, VERIFICATION_SECTION);
  if (sectionBody === undefined) return [];
  const line = sectionBody
    .split("\n")
    .find((candidate) => candidate.includes(TECHNOLOGIES_MARKER));
  if (!line) return [];
  const items = line.slice(
    line.indexOf(TECHNOLOGIES_MARKER) + TECHNOLOGIES_MARKER.length,
  );
  return items
    .split(",")
    .map((item) => {
      const bare = item.replace(/\([^)]*\)/g, "").trim();
      const backticked = bare.match(/`([^`]+)`/);
      return backticked ? backticked[1]! : bare;
    })
    .filter((name) => name.length > 0);
}

function checkTechnologies(
  documentText: string,
  violations: ArchitectureViolation[],
): void {
  const named = namedVerificationTechnologies(documentText);
  if (named.length === 0) {
    violations.push({
      kind: "technology",
      message:
        `the document names no verification technologies (no ` +
        `"${TECHNOLOGIES_MARKER}" line in its "${VERIFICATION_SECTION}" section)`,
    });
    return;
  }
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dependencyKeys = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ].map((key) => key.toLowerCase());
  for (const name of named) {
    const lowered = name.toLowerCase();
    const referenced = dependencyKeys.some(
      (key) => key === lowered || key.split("/").pop() === lowered,
    );
    if (!referenced) {
      violations.push({
        kind: "technology",
        message:
          `the document names the verification technology "${name}", which no ` +
          `package.json dependency references`,
      });
    }
  }
}

/**
 * Every structural claim in the architecture document that drifts from the
 * tree. Pass `documentText` to check a planted variant for a planted-red
 * proof; the default is the document on disk.
 */
export function findArchitectureDrift(
  documentText: string = readFileSync(ARCHITECTURE_DOCUMENT, "utf8"),
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  checkCounts(documentText, violations);
  checkModules(documentText, violations);
  checkTechnologies(documentText, violations);
  return violations;
}
