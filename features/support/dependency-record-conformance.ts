// Verification support for the methodology-conformance scenario "The
// dependency record and the package manifest agree" (@logic @invariant).
//
// RIGGING.md's `## Dependencies` section records the project's dependency
// decisions; package.json installs them. A recorded-but-uninstalled dependency
// is a decision the tree does not honour, and an installed-but-unreferenced
// dependency is dead weight no verification can see (the gap that let `c8`
// ship undeclared and `happy-dom` linger unused). This check joins the two:
//   - every dependency recorded in RIGGING.md must be installed in
//     package.json, and
//   - every package.json dependency must be referenced by the tree.
//
// "Referenced by the tree" is a token match over the repository's text files,
// with two mechanism-accurate refinements:
//   - package.json's own dependency blocks are stripped before the search (the
//     listing is not a reference), while its scripts section still counts (a
//     build script invoking `esbuild` is a real reference), and
//   - a `@types/X` package is consumed by the typecheck gate's compiler via
//     tsconfig `compilerOptions.types` (or implicitly when `types` is unset),
//     never by an import, so it is referenced exactly when tsconfig consumes it.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
/** `## Dependencies` list keys that are section metadata, not package names. */
const META_KEYS = new Set(["policy", "dependency-audit"]);
/** A RIGGING.md list-item line: `- <key>: <value...>`. */
const VALUE_LINE = /^- (\S+):\s/;

/** Directories the reference corpus never reads. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
/** Files the reference corpus never reads: the lockfile restates the manifest,
 * `.env` holds credentials, and `CAPTAIN.md` is Captain-only. */
const SKIP_FILES = new Set(["package-lock.json", ".env", "CAPTAIN.md"]);
/** Text extensions the corpus reads; an extensionless file is a launcher. */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".cjs",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".feature",
  ".py",
  ".sh",
  ".txt",
]);

/** The dependency names `## Dependencies` records. */
export function parseRecordedDependencies(riggingText: string): string[] {
  const names: string[] = [];
  let inSection = false;
  for (const line of riggingText.split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.trim() === "## Dependencies";
      continue;
    }
    if (!inSection) continue;
    const match = VALUE_LINE.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    if (META_KEYS.has(key)) continue;
    names.push(key);
  }
  return names;
}

export interface DependencyNameViolation {
  name: string;
  /** The side the dependency is missing from. */
  missingFrom: "rigging" | "manifest";
  message: string;
}

/**
 * The two-way join by dependency name: every name package.json declares is
 * recorded under RIGGING.md's `## Dependencies`, and every name recorded there
 * is declared in the manifest. Either file read alone hides a one-sided entry,
 * so the join is the only place the disagreement is visible.
 */
export function joinDependencyNames(
  declared: string[],
  recorded: string[],
): DependencyNameViolation[] {
  const violations: DependencyNameViolation[] = [];
  const recordedSet = new Set(recorded);
  const declaredSet = new Set(declared);
  for (const name of declared) {
    if (recordedSet.has(name)) continue;
    violations.push({
      name,
      missingFrom: "rigging",
      message: `package.json declares the dependency "${name}", which the rigging does not record`,
    });
  }
  for (const name of recorded) {
    if (declaredSet.has(name)) continue;
    violations.push({
      name,
      missingFrom: "manifest",
      message: `the rigging records the dependency "${name}", which package.json does not declare`,
    });
  }
  return violations;
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** Every dependency name package.json installs (runtime and dev). */
export function manifestDependencyNames(manifestText: string): string[] {
  const manifest = JSON.parse(manifestText) as Manifest;
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

export interface CorpusFile {
  file: string;
  text: string;
}

function walkTextFiles(dir: string, out: CorpusFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkTextFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const extension = extname(entry.name);
    if (extension !== "" && !TEXT_EXTENSIONS.has(extension)) continue;
    try {
      out.push({
        file: full.slice(REPO_ROOT.length + 1),
        text: readFileSync(full, "utf8"),
      });
    } catch {
      // Unreadable file: not part of the text corpus.
    }
  }
}

/**
 * The reference corpus: every repository text file, with package.json replaced
 * by a copy whose dependency blocks are stripped, so the manifest's own listing
 * never counts as a reference while its scripts section still does.
 */
export function referenceCorpus(manifestText: string): CorpusFile[] {
  const corpus: CorpusFile[] = [];
  walkTextFiles(REPO_ROOT, corpus);
  const manifest = JSON.parse(manifestText) as Manifest;
  delete manifest.dependencies;
  delete manifest.devDependencies;
  const stripped = JSON.stringify(manifest);
  return corpus.map((entry) =>
    entry.file === "package.json" ? { file: entry.file, text: stripped } : entry,
  );
}
