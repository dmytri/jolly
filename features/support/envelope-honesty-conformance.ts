// Structural conformance checker for Jolly's envelope-honesty contract
// (feature 020, @logic @property "No envelope reports overall success while
// carrying a failed check").
//
// An envelope's `status` is the claim the agent reads first. A `checks` entry
// whose status is `fail` is a claim that something did not work. An envelope
// that carries both at once tells the agent the run succeeded while its own
// payload says otherwise, and the agent believes the status — that is the
// fabricated success this check forbids.
//
// The envelopes Jolly "can emit" are enumerated from the construction code
// rather than by driving each path, because a failure Jolly cannot be made to
// take at will would otherwise go unchecked. Two shapes are decidable at a
// construction site, and only those two are reported:
//
//   1. LITERAL. The site carries a `checks` array literal holding a check whose
//      status is the literal "fail", while its own status is the literal
//      "success". The contradiction is visible in one expression.
//
//   2. AGGREGATED. The site folds ANOTHER envelope's checks into its own
//      (`checks: [...someEnv.checks.map(...)]`) while its `status` expression
//      never reads the checks collection it just built. Aggregating a
//      sub-envelope's checks discards the status that sub-envelope already
//      computed over them, so the aggregator owes a status derived from what it
//      now carries. A status computed from unrelated flags can report success
//      over a failed check it is carrying, and cannot be made not to.
//
// A site that builds its checks locally and guards its own status with an early
// non-success return is NOT reported: it never emits success over a failure, and
// its guard is real behaviour a local literal scan cannot see. Reporting it
// would be a false red on honest code, which is worse than the gap.
//
// This file excludes itself from the scan so its own literals are never
// self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

const ENVELOPE_SEAM = "envelope";
const CHECKER_FILE = "features/support/envelope-honesty-conformance.ts";

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

/** The value of a named property on an object literal. */
function property(object: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const member of object.getProperties()) {
    if (Node.isPropertyAssignment(member)) {
      if (member.getName().replace(/^["']|["']$/g, "") === name) {
        return member.getInitializer();
      }
    }
    if (Node.isShorthandPropertyAssignment(member) && member.getName() === name) {
      return member.getNameNode();
    }
  }
  return undefined;
}

/**
 * The variable an identifier resolves to. A SHORTHAND property's name node
 * carries the PROPERTY's symbol, not the value's, so `{ checks }` resolves to
 * the property assignment and never to the `const checks = [...]` it means.
 * Reading the shorthand value symbol is what makes `{ status, checks }` — the
 * shape Jolly's own envelopes are built with — resolvable at all.
 */
function resolvedVariable(node: Node | undefined): Node | undefined {
  if (!node || !Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  const symbol =
    parent && Node.isShorthandPropertyAssignment(parent)
      ? (project().getTypeChecker().getShorthandAssignmentValueSymbol(parent) ??
        node.getSymbol())
      : node.getSymbol();
  return symbol
    ?.getDeclarations()
    .find((candidate: Node) => Node.isVariableDeclaration(candidate));
}

/** The array literal a node is, or that a simple identifier resolves to. */
function arrayLiteral(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node;
  const declaration = resolvedVariable(node);
  if (declaration && Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    if (initializer && Node.isArrayLiteralExpression(initializer)) return initializer;
  }
  return undefined;
}

/** One enumerated envelope construction site and the checks it carries. */
export interface EnvelopeCheckSite {
  file: string;
  line: number;
  /** The literal status the site is built with, when it is a literal. */
  status?: string;
  /** Check ids the site carries whose status is the literal "fail". */
  failingCheckIds: string[];
  /** Sub-envelope check sources the site aggregates, e.g. "initEnv.checks". */
  aggregates: string[];
  /** True when the status expression reads the checks collection it carries. */
  statusReadsChecks: boolean;
}

/**
 * Every `checks` element that is an object literal carrying a literal
 * "fail" status, reported by its literal id where it has one.
 */
function literalFailingCheckIds(checks: Node | undefined): string[] {
  const literal = arrayLiteral(checks);
  if (!literal || !Node.isArrayLiteralExpression(literal)) return [];
  const ids: string[] = [];
  for (const element of literal.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const status = property(element, "status");
    if (!status || !Node.isStringLiteral(status)) continue;
    if (status.getLiteralValue() !== "fail") continue;
    const id = property(element, "id");
    ids.push(id && Node.isStringLiteral(id) ? id.getLiteralValue() : "<computed>");
  }
  return ids;
}

/**
 * The sub-envelope check sources a site folds in: a spread element whose
 * expression reads `.checks` off something else, such as
 * `...initEnv.checks.map((c) => ...)`.
 */
function aggregatedCheckSources(checks: Node | undefined): string[] {
  const literal = arrayLiteral(checks);
  if (!literal || !Node.isArrayLiteralExpression(literal)) return [];
  const sources: string[] = [];
  for (const element of literal.getElements()) {
    if (!Node.isSpreadElement(element)) continue;
    const text = element.getExpression().getText();
    const match = /([A-Za-z_$][\w$]*)\s*\.\s*checks\b/.exec(text);
    if (match) sources.push(`${match[1]}.checks`);
  }
  return sources;
}

/** True when an expression's own text reads the checks collection. */
function textReadsChecks(text: string, checksIdentifier: string | undefined): boolean {
  if (/\.\s*checks\b/.test(text)) return true;
  return checksIdentifier !== undefined
    ? new RegExp(`\\b${checksIdentifier}\\b`).test(text)
    : false;
}

/**
 * True when the status expression is DERIVED from the checks collection,
 * directly or through intermediate variables.
 *
 * The derivation is followed transitively rather than one hop, because
 * `const failed = checks.some(...)` then `status = failed ? ... : ...` is the
 * same honest derivation as inlining the `.some(...)` call, and is the more
 * readable of the two. A checker that only saw the inlined form would red on
 * honest code and push whoever fixed it into contorting the production source
 * to satisfy the checker's text scan. A false red on honest code is worse than
 * a gap: it turns the check into the author of the code it is meant to judge.
 */
function statusReadsChecks(
  status: Node | undefined,
  checksIdentifier: string | undefined,
): boolean {
  if (!status) return false;
  const seen = new Set<string>();
  const derivesFromChecks = (node: Node, depth: number): boolean => {
    if (depth > 8) return false;
    if (textReadsChecks(node.getText(), checksIdentifier)) return true;
    // Follow every identifier the expression references back to what it was
    // computed from.
    const identifiers = Node.isIdentifier(node)
      ? [node]
      : node.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const identifier of identifiers) {
      const key = `${identifier.getText()}@${identifier.getStartLineNumber()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const declaration = resolvedVariable(identifier);
      if (!declaration || !Node.isVariableDeclaration(declaration)) continue;
      const initializer = declaration.getInitializer();
      if (initializer && derivesFromChecks(initializer, depth + 1)) return true;
    }
    return false;
  };
  return derivesFromChecks(status, 0);
}

/** Every envelope construction site that carries checks. */
function envelopeCheckSites(): EnvelopeCheckSite[] {
  const sites: EnvelopeCheckSite[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!file.startsWith("src/")) continue;
    if (file === CHECKER_FILE) continue;
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isIdentifier(expression)) continue;
      if (expression.getText() !== ENVELOPE_SEAM) continue;
      const partial = call.getArguments()[0];
      if (!partial || !Node.isObjectLiteralExpression(partial)) continue;
      const checks = property(partial, "checks");
      if (!checks) continue;
      const statusNode = property(partial, "status");
      const checksIdentifier = Node.isIdentifier(checks) ? checks.getText() : undefined;
      sites.push({
        file,
        line: call.getStartLineNumber(),
        ...(statusNode && Node.isStringLiteral(statusNode)
          ? { status: statusNode.getLiteralValue() }
          : {}),
        failingCheckIds: literalFailingCheckIds(checks),
        aggregates: aggregatedCheckSources(checks),
        statusReadsChecks: statusReadsChecks(statusNode, checksIdentifier),
      });
    }
  }
  return sites;
}

/** The envelopes Jolly can emit, with the checks they carry. */
export function enumerateEnvelopeCheckSites(): EnvelopeCheckSite[] {
  return envelopeCheckSites();
}

/**
 * Every envelope that can report overall success while carrying a failed check.
 * Optional virtual sources are injected for a planted-red proof and removed
 * again; they never touch disk.
 */
export function findEnvelopeHonestyViolations(
  injected: InjectedSource[] = [],
): Violation[] {
  const violations: Violation[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const site of envelopeCheckSites()) {
      // 1. Literal: a carried check is literally failing while the envelope
      //    literally claims success.
      if (site.status === "success" && site.failingCheckIds.length > 0) {
        for (const id of site.failingCheckIds) {
          violations.push({
            file: site.file,
            line: site.line,
            message:
              `${site.file}:${site.line} constructs a \`success\` envelope carrying check ` +
              `\`${id}\` whose status is \`fail\` — the status is the claim the agent reads ` +
              `first, so an envelope must never report success over a check that failed`,
          });
        }
        continue;
      }

      // 2. Aggregated: another envelope's checks are folded in while the status
      //    is computed without reading them.
      if (site.aggregates.length > 0 && !site.statusReadsChecks) {
        violations.push({
          file: site.file,
          line: site.line,
          message:
            `${site.file}:${site.line} folds ${site.aggregates.join(" and ")} into its own ` +
            `\`checks\` but derives its \`status\` without reading them, so it can report ` +
            `\`success\` while carrying a check whose status is \`fail\`. Aggregating a ` +
            `sub-envelope's checks discards the status that envelope computed over them, so ` +
            `the status must be derived from the checks now carried`,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return violations;
}
