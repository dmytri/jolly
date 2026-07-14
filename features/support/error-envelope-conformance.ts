// Structural conformance checker for Jolly's error-envelope recovery contract
// (feature 020, @logic @property "Every error envelope carries the recovery, so
// the agent never has to go looking for it").
//
// Every error envelope Jolly can emit is constructed at one seam: the
// errorEnvelope(command, summary, errors, extra?) helper in src/index.ts. The
// error envelopes Jolly "can emit" are therefore enumerable as the call sites of
// that seam, and the recovery contract is checkable at each one:
//   - the envelope carries at least one `nextSteps` entry, and
//   - every `errors` entry carries a `remediation`.
//
// The check reads the construction code rather than driving each failure path,
// because a failure path Jolly cannot be made to take at will (a Cloud API 500,
// an environment-limit rejection) would otherwise go unchecked. A site whose
// `nextSteps` or `remediation` value is computed at run time is reported as
// carried: the code supplies a value there, and only an absent or provably empty
// one breaks the contract.
//
// This file excludes itself from the scan so its own literals are never
// self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

/** The error-envelope construction seams in Jolly's code. */
const ERROR_ENVELOPE_SEAM = "errorEnvelope";
const ENVELOPE_SEAM = "envelope";
/** A status an envelope can be built with that is not an error. */
const NON_ERROR_STATUSES = ["success", "warning"];
const CHECKER_FILE = "features/support/error-envelope-conformance.ts";

let cachedProject: Project | undefined;

function project(): Project {
  cachedProject ??= new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
  });
  return cachedProject;
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

/**
 * The value of a named property on an object literal, with a spread's object
 * literal searched too, so `{ ...base, nextSteps: [...] }` is read.
 */
function property(object: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const member of object.getProperties()) {
    if (Node.isPropertyAssignment(member)) {
      if (member.getName().replace(/^["']|["']$/g, "") === name) {
        return member.getInitializer();
      }
    }
    if (Node.isShorthandPropertyAssignment(member)) {
      if (member.getName() === name) return member.getNameNode();
    }
  }
  return undefined;
}

/**
 * An expression's array literal, following a single identifier to its
 * declaration's initializer so `const errors = [...]; errorEnvelope(.., errors)`
 * is read. A value this cannot resolve is computed at run time; the caller
 * treats it as carried rather than guessing at its contents.
 */
function arrayLiteral(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node;
  if (Node.isIdentifier(node)) {
    const declaration = node
      .getSymbol()
      ?.getDeclarations()
      .find((candidate) => Node.isVariableDeclaration(candidate));
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer && Node.isArrayLiteralExpression(initializer)) {
        return initializer;
      }
    }
  }
  return undefined;
}

/** An empty string literal is no remediation at all; a computed value is one. */
function isEmptyValue(node: Node | undefined): boolean {
  if (!node) return true;
  if (Node.isStringLiteral(node)) return node.getLiteralValue().trim() === "";
  return false;
}

/**
 * Whether a `nextSteps` expression can reach an empty value on some path.
 *
 * Recovery is owed on every error envelope, whatever its code. Code-keyed
 * recovery breaks that: `code === "X" ? [step] : []` supplies the steps for one
 * code and leaves every other code with nothing, and `BY_CODE[code] ?? []` does
 * the same through a lookup. Both read as "computed" to a check that only looks
 * for an array literal, so the branches are walked here: a ternary's arms, a
 * `??`/`||` fallback's sides, and an identifier's initializer. An expression
 * this cannot resolve is genuinely computed at run time and stays carried.
 */
function reachesEmpty(node: Node | undefined, seen = new Set<Node>()): boolean {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (Node.isParenthesizedExpression(node)) {
    return reachesEmpty(node.getExpression(), seen);
  }
  if (Node.isArrayLiteralExpression(node)) return node.getElements().length === 0;
  if (Node.isConditionalExpression(node)) {
    return (
      reachesEmpty(node.getWhenTrue(), seen) ||
      reachesEmpty(node.getWhenFalse(), seen)
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    const isFallback =
      operator === SyntaxKind.QuestionQuestionToken ||
      operator === SyntaxKind.BarBarToken;
    if (!isFallback) return false;
    return (
      reachesEmpty(node.getLeft(), seen) || reachesEmpty(node.getRight(), seen)
    );
  }
  if (Node.isIdentifier(node)) {
    const declaration = node
      .getSymbol()
      ?.getDeclarations()
      .find((candidate) => Node.isVariableDeclaration(candidate));
    if (declaration && Node.isVariableDeclaration(declaration)) {
      return reachesEmpty(declaration.getInitializer(), seen);
    }
  }
  return false;
}

export interface ErrorEnvelopeSite {
  file: string;
  line: number;
}

/** One enumerated error envelope: where it is built, and the recovery it carries. */
interface Construction {
  file: string;
  line: number;
  /** The `errors` array the envelope is built with. */
  errors: Node | undefined;
  /** The object the envelope's `nextSteps` rides on. */
  carrier: Node | undefined;
}

/**
 * The name of the function a node sits inside, so the errorEnvelope wrapper's
 * own internal envelope() call is not enumerated as a second envelope.
 */
function enclosingFunctionName(node: Node): string | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) return current.getName();
    current = current.getParent();
  }
  return undefined;
}

/**
 * Every error envelope Jolly can emit, at its construction site. Two seams build
 * one:
 *   - errorEnvelope(command, summary, errors, extra?), whose every call is an
 *     error envelope by construction, and
 *   - envelope({ status, ... }) called with a status that is not literally
 *     `success` or `warning` — the doctor envelope computes its status, so it
 *     can be an error envelope and is enumerated as one. A call with a literal
 *     non-error status can never emit an error and is skipped.
 */
function errorConstructions(): Construction[] {
  const constructions: Construction[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!file.startsWith("src/")) continue;
    if (file === CHECKER_FILE) continue;
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isIdentifier(expression)) continue;
      const name = expression.getText();
      const line = call.getStartLineNumber();
      const args = call.getArguments();

      if (name === ERROR_ENVELOPE_SEAM) {
        constructions.push({ file, line, errors: args[2], carrier: args[3] });
        continue;
      }

      if (name !== ENVELOPE_SEAM) continue;
      // The errorEnvelope wrapper's own envelope() call builds the very envelope
      // its call sites are already enumerated for; counting it again would report
      // the wrapper's parameters rather than any real envelope.
      if (enclosingFunctionName(call) === ERROR_ENVELOPE_SEAM) continue;
      const partial = args[0];
      if (!partial || !Node.isObjectLiteralExpression(partial)) continue;
      const status = property(partial, "status");
      // A literal success/warning status can never emit an error envelope.
      if (
        status &&
        Node.isStringLiteral(status) &&
        NON_ERROR_STATUSES.includes(status.getLiteralValue())
      ) {
        continue;
      }
      constructions.push({
        file,
        line,
        errors: property(partial, "errors"),
        carrier: partial,
      });
    }
  }
  return constructions;
}

/** The error envelopes Jolly can emit, located at their construction sites. */
export function enumerateErrorEnvelopeSites(): ErrorEnvelopeSite[] {
  return errorConstructions().map(({ file, line }) => ({ file, line }));
}

/**
 * Recovery-contract violations across every error envelope Jolly can emit: an
 * envelope constructed with no `nextSteps` entry, or with an `errors` entry
 * carrying no `remediation`. Optional virtual sources are injected for a
 * planted-red proof and removed again; they never touch disk.
 */
export function findErrorEnvelopeRecoveryViolations(
  injected: InjectedSource[] = [],
): Violation[] {
  const violations: Violation[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const { file, line, errors, carrier } of errorConstructions()) {
      // Recovery, part one: at least one `nextSteps` entry, carried on the
      // envelope itself.
      const nextSteps = carrier ? property(carrier, "nextSteps") : undefined;
      const carriesNextSteps =
        nextSteps !== undefined && !reachesEmpty(nextSteps);
      if (!carriesNextSteps) {
        violations.push({
          file,
          line,
          message:
            `${file}:${line} constructs an error envelope with no \`nextSteps\` entry — ` +
            "an error envelope carries its own recovery, so the agent that hit the error " +
            "never has to go looking for what to do next",
        });
      }

      // Recovery, part two: a `remediation` on every `errors` entry.
      const entries = arrayLiteral(errors)
        ?.asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
        .getElements();
      if (!entries) continue;
      for (const entry of entries) {
        if (!Node.isObjectLiteralExpression(entry)) continue;
        const remediation = property(entry, "remediation");
        if (!isEmptyValue(remediation)) continue;
        const code = property(entry, "code");
        const label =
          code && Node.isStringLiteral(code) ? code.getLiteralValue() : "<computed>";
        const entryLine = entry.getStartLineNumber();
        violations.push({
          file,
          line: entryLine,
          message:
            `${file}:${entryLine} error entry ${label} carries no \`remediation\` — ` +
            "every errors entry names how to recover from it",
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return violations;
}
