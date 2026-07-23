// Verification support for the methodology-conformance scenario "No dead
// verification-support artifact accumulates" (@logic @invariant).
//
// A verification-support artifact that nothing binds is dead weight: it reads
// as coverage while proving nothing, and it accumulates every time a scenario
// is removed without its support. Two kinds accumulate, and neither the
// runner's green nor a tooling gate sees them:
//   - a step-definition pattern no current scenario binds: `step-usage` reports
//     it with an empty `matches` array, so the join names the orphan, its file,
//     and its line, and
//   - an exported `features/support/` symbol no other file in the tree
//     references: dead verification helper code, found by a delimited-token
//     search over the repository corpus with the defining file itself excluded.
//
// Both are QM-owned verification support, not production code. The orphan join
// reads the same `usage-json` the RIGGING `step-usage` command emits; the
// export search reuses the reference corpus the dependency-record check builds.
import { Project } from "ts-morph";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import { referenceCorpus, type CorpusFile } from "./dependency-record-conformance.ts";

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  /** Repo-root-relative path the violation is reported under. */
  file: string;
  text: string;
}

// ─── Orphaned step-definition patterns ──────────────────────────────────────

/** One `usage-json` entry: a step-definition pattern and the scenarios it binds. */
export interface StepUsageEntry {
  /** The step-definition pattern verbatim, as `step-usage` reports it. */
  pattern: string;
  /** Repo-root-relative path of the step-definition file. */
  uri: string;
  /** 1-based line of the step-definition declaration. */
  line: number;
  /** One entry per scenario step the pattern binds; empty for an orphan. */
  matches: unknown[];
}

/**
 * The step-definition patterns the `step-usage` runner reports, each with the
 * scenarios it binds. The RIGGING `step-usage` command runs the whole suite dry
 * on the tag-free `all` profile, so every configured tier is enumerated and no
 * step definition reads as a false-positive orphan for a tier the run skipped.
 */
export function collectStepUsageEntries(): StepUsageEntry[] {
  const result = spawnSync(
    "npx",
    [
      "cucumber-js",
      "-p",
      "all",
      "--dry-run",
      "--format",
      "usage-json",
      "--tags",
      "not @captain and not @shipwright",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
    throw new Error(
      `step-usage produced no usage-json on stdout (status ${result.status}); stderr:\n${result.stderr ?? ""}`,
    );
  }
  const usage = JSON.parse(result.stdout) as Array<{
    pattern: string;
    uri: string;
    line: number;
    matches?: unknown[];
  }>;
  return usage.map((entry) => ({
    pattern: entry.pattern,
    uri: entry.uri,
    line: entry.line,
    matches: entry.matches ?? [],
  }));
}

/** A step-definition pattern no current scenario binds. */
export interface OrphanPattern {
  pattern: string;
  file: string;
  line: number;
  message: string;
}

/**
 * The orphaned patterns: every `step-usage` entry whose `matches` array is
 * empty, so no current scenario binds it. The report names the pattern, its
 * file, and its line, so the orphan is removable without a further search.
 */
export function findOrphanPatterns(entries: StepUsageEntry[]): OrphanPattern[] {
  return entries
    .filter((entry) => entry.matches.length === 0)
    .map((entry) => ({
      pattern: entry.pattern,
      file: entry.uri,
      line: entry.line,
      message:
        `${entry.uri}:${entry.line} step-definition pattern ` +
        `"${entry.pattern}" is bound by no current scenario`,
    }));
}

// ─── Unreferenced features/support/ exports ─────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
/** Module source extensions ts-morph reads for exported declarations. */
const MODULE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".mjs", ".js"]);
/** Declaration files re-state types, never own an original export. */
const DECLARATION = /\.d\.[cm]?ts$/;

/** An exported symbol declared under the support directory. */
export interface SupportExport {
  /** Repo-root-relative path of the file declaring the export. */
  file: string;
  /** The exported identifier. */
  symbol: string;
}

function walkModuleFiles(dir: string): string[] {
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
      out.push(...walkModuleFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (DECLARATION.test(entry.name)) continue;
    if (MODULE_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * Every exported symbol declared under the support directory. Each module file
 * is parsed for its exported declarations; an injected virtual source serves
 * the planted-red proof and never touches disk.
 */
export function collectSupportExports(
  supportDir = "features/support/",
  injected: InjectedSource[] = [],
): SupportExport[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources: InjectedSource[] = walkModuleFiles(
    join(REPO_ROOT, supportDir),
  ).map((absolute) => ({
    file: absolute.slice(REPO_ROOT.length + 1),
    text: readFileSync(absolute, "utf8"),
  }));
  sources.push(...injected);

  const exportsOut: SupportExport[] = [];
  for (const source of sources) {
    // ts-morph resolves `.ts` extensions off; a virtual `.ts` path parses.
    const virtual = extname(source.file) === ".mjs" ? `${source.file}.ts` : source.file;
    const file = project.createSourceFile(virtual, source.text, {
      overwrite: true,
    });
    for (const name of file.getExportedDeclarations().keys()) {
      if (name === "default") continue;
      exportsOut.push({ file: source.file, symbol: name });
    }
  }
  return exportsOut;
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether some corpus file OTHER than the defining file names the symbol as a
 * delimited token. A symbol used only inside its own file is not referenced as
 * an export, so the defining file is excluded from its own reference search.
 */
function isReferencedElsewhere(
  supportExport: SupportExport,
  corpus: CorpusFile[],
): boolean {
  const token = new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(supportExport.symbol)}([^A-Za-z0-9_$]|$)`,
    "m",
  );
  return corpus.some(
    (entry) => entry.file !== supportExport.file && token.test(entry.text),
  );
}

/** An exported support symbol no other file in the tree references. */
export interface UnreferencedExport {
  file: string;
  symbol: string;
  message: string;
}

/**
 * The support exports no other file references. The corpus defaults to the
 * repository's text files, per the dependency-record reference corpus; a
 * planted-red proof passes an explicit corpus so the plant's own token is the
 * only occurrence.
 */
export function findUnreferencedExports(
  supportExports: SupportExport[],
  corpus: CorpusFile[] = referenceCorpus(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ),
): UnreferencedExport[] {
  return supportExports
    .filter((supportExport) => !isReferencedElsewhere(supportExport, corpus))
    .map((supportExport) => ({
      file: supportExport.file,
      symbol: supportExport.symbol,
      message:
        `${supportExport.file} exports "${supportExport.symbol}", ` +
        `which no other file in the tree references — dead verification helper`,
    }));
}
