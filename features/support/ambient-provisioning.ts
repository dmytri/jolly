// Verification support for the verification-economy scenario "Ambient setup
// cost is paid once per run, never per scenario" (@logic @invariant).
//
// Ambient state no scenario asserts is setup cost: built once per run behind a
// lock, marker file, or module-level memo, never rebuilt per scenario. The
// breach is invisible on a green run — every scenario passes while one of them
// quietly pays the same provisioning cost again on every execution — so only a
// check over the support code itself can redden on it.
//
// What counts as an ambient provisioning site, structurally:
//   - a spawn-family call in the verification layer whose result is entirely
//     discarded (an expression statement): a result no code consumes is a
//     result no scenario asserts, so the call exists only for its side effect,
//   - whose arguments are all static literals: a call parameterized by a
//     run value provisions a scenario-scoped, namespaced resource, while a call
//     with fully static arguments provisions the same ambient thing every time,
//     such as pre-warming an external CLI into the npx cache.
//
// What counts as a once-per-run guard, structurally:
//   - an enclosing `if` whose condition reads a module-level variable of the
//     same file (a module-level memo) or calls `existsSync` (a marker file),
//   - or a preceding early-return `if` in an enclosing block with the same
//     condition shape, the `ensureCliBundle` idiom.
//
// This file excludes itself from the scan, so its own example literals are
// never self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface ProvisionViolation {
  file: string;
  line: number;
  message: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

const SPAWN_CALLEES = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
]);
const MARKER_PROBE = "existsSync";
const CHECKER_FILE = "features/support/ambient-provisioning.ts";
const VERIFICATION_DIRS = ["features/support/", "features/step_definitions/"];

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

function spawnCalleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return undefined;
}

/**
 * A value that is the same on every execution: literals, and arrays and object
 * literals of literals. An identifier, a call, or a template substitution
 * carries a run value, so a call using one provisions scenario-scoped state.
 */
function isStatic(node: Node): boolean {
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    node.getKind() === SyntaxKind.TrueKeyword ||
    node.getKind() === SyntaxKind.FalseKeyword ||
    node.getKind() === SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (Node.isPrefixUnaryExpression(node)) return isStatic(node.getOperand());
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node)) {
    return isStatic(node.getExpression());
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((element) => isStatic(element));
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((property) => {
      if (!Node.isPropertyAssignment(property)) return false;
      const initializer = property.getInitializer();
      return initializer ? isStatic(initializer) : false;
    });
  }
  return false;
}

/**
 * A condition that makes its branch once-per-run: it reads a module-level
 * variable of the same file (a module-level memo flag), or probes a marker
 * file with `existsSync`.
 */
function conditionQualifies(condition: Node): boolean {
  const sourceFile = condition.getSourceFile();
  const nodes = [condition, ...condition.getDescendants()];
  for (const node of nodes) {
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      const name = Node.isIdentifier(callee)
        ? callee.getText()
        : Node.isPropertyAccessExpression(callee)
          ? callee.getName()
          : undefined;
      if (name === MARKER_PROBE) return true;
    }
    if (Node.isIdentifier(node)) {
      const declaration = node.getSymbol()?.getValueDeclaration();
      if (
        declaration &&
        Node.isVariableDeclaration(declaration) &&
        declaration.getSourceFile() === sourceFile &&
        declaration
          .getVariableStatement()
          ?.getParentIfKind(SyntaxKind.SourceFile)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** The then-branch bails out, so the statements after the `if` run at most once. */
function branchBailsOut(thenStatement: Node): boolean {
  if (
    Node.isReturnStatement(thenStatement) ||
    Node.isThrowStatement(thenStatement)
  ) {
    return true;
  }
  return (
    thenStatement.getDescendantsOfKind(SyntaxKind.ReturnStatement).length > 0 ||
    thenStatement.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0
  );
}

/** Whether a once-per-run guard dominates the call site. */
function isGuarded(call: Node): boolean {
  // An enclosing `if` whose condition is a memo flag or a marker probe.
  for (const ancestor of call.getAncestors()) {
    if (Node.isIfStatement(ancestor) && conditionQualifies(ancestor.getExpression())) {
      return true;
    }
  }
  // A preceding early-return `if` in an enclosing block (the marker idiom
  // `if (existsSync(...)) return;` before the provisioning call).
  let node: Node = call;
  for (const ancestor of call.getAncestors()) {
    if (Node.isBlock(ancestor) || Node.isSourceFile(ancestor)) {
      const statements = ancestor.getChildSyntaxList()?.getChildren() ?? [];
      const index = statements.findIndex(
        (statement) => statement === node || statement.containsRange(call.getPos(), call.getEnd()),
      );
      for (let i = 0; i < index; i++) {
        const statement = statements[i]!;
        if (
          Node.isIfStatement(statement) &&
          conditionQualifies(statement.getExpression()) &&
          branchBailsOut(statement.getThenStatement())
        ) {
          return true;
        }
      }
    }
    node = ancestor;
  }
  return false;
}

/**
 * Every ambient provisioning site in the verification layer that re-provisions
 * per scenario without a once-per-run guard.
 *
 * Pass `injected` to plant a violation for a planted-red proof; the injected
 * sources are virtual and are removed before returning.
 */
export function findUnguardedAmbientProvisioning(
  injected: InjectedSource[] = [],
): ProvisionViolation[] {
  const violations: ProvisionViolation[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!VERIFICATION_DIRS.some((dir) => file.startsWith(dir))) continue;
      if (file === CHECKER_FILE) continue;
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = spawnCalleeName(call);
        if (!callee || !SPAWN_CALLEES.has(callee)) continue;
        // A consumed result is state some assertion can reach; a discarded one
        // exists only for its ambient side effect.
        if (!Node.isExpressionStatement(call.getParent() ?? call)) continue;
        // A run-value argument provisions a scenario-scoped, namespaced
        // resource; fully static arguments provision the same ambient thing
        // every time.
        if (!call.getArguments().every((argument) => isStatic(argument))) continue;
        if (isGuarded(call)) continue;
        const line = call.getStartLineNumber();
        violations.push({
          file,
          line,
          message:
            `${file}:${line} re-provisions ambient state (${callee} with static ` +
            `arguments, result discarded) on every scenario that runs through it — ` +
            `put it behind a once-per-run guard: a lock, a marker file, or a ` +
            `module-level memo`,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return violations;
}
