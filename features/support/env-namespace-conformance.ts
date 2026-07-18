// Structural conformance checker for feature 026's @logic @property scenario
// "Production reads only product-namespaced configuration, and harness knobs
// stay in the harness".
//
// Every environment variable production code reads is one of:
//   - a `JOLLY_*` product setting (and a name that says "harness" never hides
//     under the JOLLY_ prefix — a harness-only knob carries HARNESS_),
//   - a target project's / spawned toolchain's own expected variable, each
//     entry justified below, or
//   - a `HARNESS_*` affordance readable only when the harness guard is set:
//     the read sits in the guard function itself (the function whose body IS
//     the HARNESS_RUN_ID presence test) or in a seam that consults that guard.
// Anything else — an unknown namespace, a mis-namespaced harness knob, an
// unguarded harness read, or a dynamic read whose variable name cannot be
// resolved — is reported with the variable and the site.
//
// A dynamic read (`process.env[name]`) is resolved one hop: a string-literal
// index reads that name; an identifier bound to a literal reads that literal;
// a parameter reads the literal arguments of the enclosing function's call
// sites. A name that cannot be resolved this way is a read the check cannot
// classify, so it is reported rather than trusted.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

/**
 * The target project's and spawned toolchain's own expected variables:
 *   - NEXT_PUBLIC_SALEOR_API_URL / NEXT_PUBLIC_DEFAULT_CHANNEL: the Paper
 *     storefront's own build-time configuration (features 002, 012, 029),
 *   - SALEOR_TOKEN / SALEOR_URL: the agent-facing store credentials the
 *     configurator and MCP tooling expect (features 004, 018),
 *   - NO_COLOR: the terminal ecosystem's colour opt-out feature 020's output
 *     Rule binds ("when `NO_COLOR` is set"),
 *   - NPM_CONFIG_LOGLEVEL / npm_config_loglevel: the spawned npm/npx
 *     toolchain's own log-level setting.
 */
const TARGET_PROJECT_VARS = new Set([
  "NEXT_PUBLIC_SALEOR_API_URL",
  "NEXT_PUBLIC_DEFAULT_CHANNEL",
  "SALEOR_TOKEN",
  "SALEOR_URL",
  "NO_COLOR",
  "NPM_CONFIG_LOGLEVEL",
  "npm_config_loglevel",
]);

const GUARD_VAR = "HARNESS_RUN_ID";

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

export interface EnvRead {
  file: string;
  line: number;
  /** The variable name, or undefined when a dynamic read resolves to none. */
  name?: string;
  /** Whether the read's seam is, or consults, the harness guard. */
  guarded: boolean;
}

function isProcessEnv(expression: Node): boolean {
  return expression.getText() === "process.env";
}

/** Whether this env access is a write or delete target rather than a read. */
function isWriteSite(access: Node): boolean {
  const parent = access.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent)) {
    return (
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
      parent.getLeft() === access
    );
  }
  return Node.isDeleteExpression(parent);
}

function enclosingFunction(node: Node): Node | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

function functionName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getName();
  }
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  if (parent && Node.isPropertyAssignment(parent)) return parent.getName();
  return undefined;
}

/**
 * The names of the guard functions: every function in the scanned sources
 * whose body reads the HARNESS_RUN_ID presence. There is normally exactly one.
 */
function guardFunctionNames(sources: Node[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    for (const access of [
      ...source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ]) {
      const text = access.getText();
      if (!text.startsWith("process.env")) continue;
      if (!text.includes(GUARD_VAR)) continue;
      const fn = enclosingFunction(access);
      if (!fn) continue;
      const name = functionName(fn);
      if (name) names.add(name);
    }
  }
  return names;
}

/** Whether the seam consults one of the guard functions by name. */
function consultsGuard(seam: Node | undefined, guards: Set<string>): boolean {
  if (!seam) return false;
  for (const identifier of seam.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (guards.has(identifier.getText())) return true;
  }
  return false;
}

/** Resolve a dynamic env index to the names it can read, one hop. */
function resolveDynamicNames(argument: Node): string[] | undefined {
  if (
    Node.isStringLiteral(argument) ||
    Node.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return [argument.getLiteralValue()];
  }
  if (!Node.isIdentifier(argument)) return undefined;
  const definitions = argument.getDefinitionNodes();
  const definition = definitions[0];
  if (!definition) return undefined;
  if (Node.isVariableDeclaration(definition)) {
    const initializer = definition.getInitializer();
    if (
      initializer &&
      (Node.isStringLiteral(initializer) ||
        Node.isNoSubstitutionTemplateLiteral(initializer))
    ) {
      return [initializer.getLiteralValue()];
    }
    return undefined;
  }
  if (!Node.isParameterDeclaration(definition)) return undefined;
  const fn = definition.getParent();
  if (
    !Node.isFunctionDeclaration(fn) &&
    !Node.isFunctionExpression(fn) &&
    !Node.isArrowFunction(fn) &&
    !Node.isMethodDeclaration(fn)
  ) {
    return undefined;
  }
  const index = fn.getParameters().indexOf(definition);
  if (index < 0) return undefined;
  let nameNode: Node | undefined;
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    nameNode = fn.getNameNode();
  } else {
    const parent = fn.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      nameNode = parent.getNameNode();
    }
  }
  if (!nameNode || !Node.isIdentifier(nameNode)) return undefined;
  const names: string[] = [];
  for (const reference of nameNode.findReferencesAsNodes()) {
    const call = reference.getParent();
    if (!call || !Node.isCallExpression(call)) continue;
    if (call.getExpression() !== reference) continue;
    const arg = call.getArguments()[index];
    if (!arg) continue;
    if (
      Node.isStringLiteral(arg) ||
      Node.isNoSubstitutionTemplateLiteral(arg)
    ) {
      names.push(arg.getLiteralValue());
      continue;
    }
    return undefined;
  }
  return names.length > 0 ? [...new Set(names)] : undefined;
}

/**
 * Every environment-variable read in the production sources under `dir`, with
 * the read's variable name (where resolvable) and whether its seam is, or
 * consults, the harness guard. Optional virtual sources are injected for a
 * planted-red proof and removed again; they never touch disk.
 */
export function enumerateProductionEnvReads(
  dir = "src/",
  injected: InjectedSource[] = [],
): EnvRead[] {
  const reads: EnvRead[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    const scanned = project()
      .getSourceFiles()
      .filter((source) => repoRelative(source.getFilePath()).startsWith(dir));
    const guards = guardFunctionNames(scanned);
    for (const source of scanned) {
      const file = repoRelative(source.getFilePath());

      for (const access of source.getDescendantsOfKind(
        SyntaxKind.PropertyAccessExpression,
      )) {
        if (!isProcessEnv(access.getExpression())) continue;
        if (isWriteSite(access)) continue;
        const name = access.getName();
        const seam = enclosingFunction(access);
        const seamName = seam ? functionName(seam) : undefined;
        reads.push({
          file,
          line: access.getStartLineNumber(),
          name,
          guarded:
            (seamName !== undefined && guards.has(seamName)) ||
            consultsGuard(seam, guards),
        });
      }

      for (const access of source.getDescendantsOfKind(
        SyntaxKind.ElementAccessExpression,
      )) {
        if (!isProcessEnv(access.getExpression())) continue;
        if (isWriteSite(access)) continue;
        const argument = access.getArgumentExpression();
        const line = access.getStartLineNumber();
        const seam = enclosingFunction(access);
        const seamName = seam ? functionName(seam) : undefined;
        const guarded =
          (seamName !== undefined && guards.has(seamName)) ||
          consultsGuard(seam, guards);
        const names = argument ? resolveDynamicNames(argument) : undefined;
        if (names === undefined) {
          reads.push({ file, line, guarded });
          continue;
        }
        for (const name of names) reads.push({ file, line, name, guarded });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return reads;
}

export type EnvViolationKind =
  | "unresolved-dynamic"
  | "mis-namespaced"
  | "unguarded-harness"
  | "unclassified";

export interface EnvViolation extends Violation {
  kind: EnvViolationKind;
}

/** Classify every read; anything outside the contract is a violation. */
export function findEnvNamespaceViolations(
  reads: EnvRead[],
): EnvViolation[] {
  const violations: EnvViolation[] = [];
  for (const read of reads) {
    const site = `${read.file}:${read.line}`;
    if (read.name === undefined) {
      violations.push({
        kind: "unresolved-dynamic",
        file: read.file,
        line: read.line,
        message: `${site} reads process.env with a dynamic name the check cannot resolve — an unclassifiable environment read`,
      });
      continue;
    }
    const name = read.name;
    const saysHarness = /HARNESS/i.test(name);
    if (name.startsWith("HARNESS_")) {
      if (read.guarded) continue;
      violations.push({
        kind: "unguarded-harness",
        file: read.file,
        line: read.line,
        message: `${site} reads the harness affordance ${name} without consulting the harness guard — the shipped CLI can reach it`,
      });
      continue;
    }
    if (saysHarness) {
      violations.push({
        kind: "mis-namespaced",
        file: read.file,
        line: read.line,
        message: `${site} reads ${name} — a harness-only knob must carry the HARNESS_ prefix, never ${name.startsWith("JOLLY_") ? "JOLLY_" : "another namespace"}`,
      });
      continue;
    }
    if (name.startsWith("JOLLY_")) continue;
    if (TARGET_PROJECT_VARS.has(name)) continue;
    violations.push({
      kind: "unclassified",
      file: read.file,
      line: read.line,
      message: `${site} reads ${name}, which is neither a JOLLY_* product setting, a target project's expected variable, nor a guarded HARNESS_* affordance`,
    });
  }
  return violations;
}
