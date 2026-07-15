// Verification support for the two plank checks in feature
// methodology-conformance (@logic @invariant):
//   - plank FORM: every `@planks` token in the implementation directories sits
//     in a docblock attached to the declaration it describes, and names a
//     Given/When/Then step, and
//   - plank FRESHNESS: every plank's step text still exists in a feature file.
//
// The RIGGING `plank-inventory` command is a text search, so it reports plank
// PRESENCE only: a token in a line comment, a token inside a function body, or
// a docblock attached to a type alias sitting above the seam all read as
// planked. These checks read the TypeScript AST instead, so form is observed
// rather than assumed.
//
// `bin/jolly` is an extensionless JavaScript launcher, so it is added to the
// AST project under a virtual `.js` path; its text is the real file's.
import { Node, Project, SyntaxKind } from "ts-morph";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface PlankViolation {
  file: string;
  line: number;
  message: string;
}

export interface Plank {
  file: string;
  line: number;
  /** The Gherkin step text inside `@planks(...)`, quotes stripped. */
  step: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  /** Repo-root-relative path the violation is reported under. */
  file: string;
  text: string;
}

const PLANK_TOKEN = "@planks";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"]);
const STEP_KEYWORDS = ["Given", "When", "Then"];

/**
 * The declaration kinds a plank may be attached to: a seam is a declaration
 * that carries behaviour. A type alias or an interface declares shape, never
 * behaviour, so a docblock on one is a plank that has drifted off its seam.
 */
function isSeamDeclaration(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isVariableStatement(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isPropertyAssignment(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isExportAssignment(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node)
  );
}

function declarationLabel(node: Node): string {
  return node.getKindName();
}

function walkFiles(dir: string, keep: (name: string) => boolean): string[] {
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
      out.push(...walkFiles(full, keep));
      continue;
    }
    if (entry.isFile() && keep(entry.name)) out.push(full);
  }
  return out;
}

/** Source files the AST reads. An extensionless file is a launcher script. */
function walkSourceFiles(dir: string): string[] {
  return walkFiles(dir, (name) => {
    const extension = extname(name);
    return extension === "" || SOURCE_EXTENSIONS.has(extension);
  });
}

/**
 * An AST project over the implementation directories. Each file is added under
 * a virtual path keyed by its repo-root-relative name, with a `.js` suffix
 * appended when the real file is extensionless, so the parser sees a source
 * file it can read while the reported path stays the real one.
 */
function implementationProject(
  dirs: string[],
  injected: InjectedSource[],
): Map<string, { source: ReturnType<Project["createSourceFile"]>; text: string }> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources = new Map<
    string,
    { source: ReturnType<Project["createSourceFile"]>; text: string }
  >();
  const add = (file: string, text: string) => {
    const virtual = extname(file) === "" ? `${file}.js` : file;
    sources.set(file, { source: project.createSourceFile(virtual, text), text });
  };
  for (const rel of dirs) {
    for (const absolute of walkSourceFiles(join(REPO_ROOT, rel))) {
      const file = absolute.slice(REPO_ROOT.length + 1);
      add(file, readFileSync(absolute, "utf8"));
    }
  }
  for (const source of injected) add(source.file, source.text);
  return sources;
}

/** The `@planks(...)` step text on a docblock line, quotes and backticks stripped. */
function stepTextOf(line: string): string | undefined {
  const match = /@planks\(\s*(["'`])([\s\S]*?)\1\s*\)/.exec(line);
  return match ? match[2] : undefined;
}

/**
 * Plank-form violations across the implementation directories: every `@planks`
 * token must sit in a docblock attached to a seam declaration and name a
 * Given/When/Then step. A token in a line comment, a token inside a function
 * body, and a docblock attached to a type alias or interface are each reported.
 */
export function findPlankFormViolations(
  dirs: string[],
  injected: InjectedSource[] = [],
): PlankViolation[] {
  const violations: PlankViolation[] = [];
  for (const [file, { source, text }] of implementationProject(dirs, injected)) {
    if (!text.includes(PLANK_TOKEN)) continue;

    // Every plank token in a docblock, mapped to the declaration that docblock
    // is attached to.
    const inDocblock = new Set<number>();
    for (const doc of source.getDescendantsOfKind(SyntaxKind.JSDoc)) {
      const docText = doc.getText();
      if (!docText.includes(PLANK_TOKEN)) continue;
      const parent = doc.getParent();
      const firstLine = doc.getStartLineNumber();
      docText.split("\n").forEach((docLine, offset) => {
        if (!docLine.includes(PLANK_TOKEN)) return;
        const line = firstLine + offset;
        inDocblock.add(line);
        if (!parent || !isSeamDeclaration(parent)) {
          violations.push({
            file,
            line,
            message:
              `${file}:${line} plank sits on a ${parent ? declarationLabel(parent) : "detached docblock"}, ` +
              `not on a seam declaration — hoist it to the declaration whose behaviour the step requires`,
          });
        }
        if (stepTextOf(docLine) === undefined) {
          violations.push({
            file,
            line,
            message: `${file}:${line} plank carries no quoted step text in \`@planks("...")\` form`,
            });
          return;
        }
        const step = stepTextOf(docLine)!;
        if (!STEP_KEYWORDS.some((keyword) => step.startsWith(`${keyword} `))) {
          violations.push({
            file,
            line,
            message: `${file}:${line} plank step "${step}" starts with no "Given", "When", or "Then" keyword`,
          });
        }
      });
    }

    // Every plank token the docblock reader could not see: a line comment, a
    // block comment inside a function body, or a bare token in code.
    text.split("\n").forEach((lineText, index) => {
      const line = index + 1;
      if (!lineText.includes(PLANK_TOKEN)) return;
      if (inDocblock.has(line)) return;
      violations.push({
        file,
        line,
        message:
          `${file}:${line} plank token sits outside a docblock on a declaration, ` +
          `so no docblock reader can inventory it — hoist it to the seam's docblock`,
      });
    });
  }
  return violations;
}

/** Every well-formed plank in the implementation directories. */
export function collectPlanks(
  dirs: string[],
  injected: InjectedSource[] = [],
): Plank[] {
  const planks: Plank[] = [];
  for (const [file, { text }] of implementationProject(dirs, injected)) {
    text.split("\n").forEach((lineText, index) => {
      const step = stepTextOf(lineText);
      if (step !== undefined) planks.push({ file, line: index + 1, step });
    });
  }
  return planks;
}

/**
 * The step-definition patterns the `step-usage` runner reports, as verbatim
 * strings. The RIGGING `step-usage` command runs the whole suite dry (executing
 * nothing) and emits one `usage-json` array; each entry carries the step
 * definition's `pattern`. A plank's durable contract is one of these patterns,
 * so this set is what a plank cross-references against.
 */
export function collectStepUsagePatterns(): string[] {
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
  const usage = JSON.parse(result.stdout) as Array<{ pattern: string }>;
  return usage.map((entry) => entry.pattern);
}

/** A plank step with its leading Given/When/Then keyword removed, so it can be
 * compared against a keyword-less step-definition pattern. */
function withoutKeyword(step: string): string {
  for (const keyword of STEP_KEYWORDS) {
    const prefix = `${keyword} `;
    if (step.startsWith(prefix)) return step.slice(prefix.length);
  }
  return step;
}

/**
 * Unpatterned planks: planks whose step matches no current step-definition
 * pattern by exact string. `step-usage` reports each pattern without a leading
 * keyword, so a plank matches when its keyword-stripped step equals a pattern
 * verbatim. A plank carrying a concrete example line rather than the pattern
 * matches nothing and is reported: it stores a second copy of the join the
 * runner already derives, and drifts with every data edit.
 */
export function findUnpatternedPlanks(planks: Plank[], patterns: Iterable<string>): Plank[] {
  const patternSet = new Set(patterns);
  return planks.filter(
    (plank) => !patternSet.has(plank.step) && !patternSet.has(withoutKeyword(plank.step)),
  );
}
