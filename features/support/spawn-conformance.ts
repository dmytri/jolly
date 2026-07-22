// Structural conformance checker for feature 006's @logic @property scenario
// "Jolly's code spawns only the delegated official tools".
//
// Feature 006's "Thin command surface" Rule is a delegation contract: Jolly
// orchestrates the OFFICIAL current CLIs (`git`, `pnpm`, and `npx`-launched
// `@saleor/configurator`, `vercel`, `pnpm`, `skills`) and never the deprecated
// `saleor` CLI or any other tool. This check enumerates every child-process
// spawn site in the implementation directories and resolves what each can
// launch; a site launching a binary or npx package outside the delegated set —
// or one whose target cannot be statically resolved, which would make the
// spawn surface unenumerable — is a violation.
//
// Callee recognition mirrors the seam rules of the sibling checkers
// (net-request-conformance, module-conformance): a bare identifier call
// (`spawnSync(...)`, the form the implementation uses via named imports from
// node:child_process) or a property call on a child_process-named object
// (`cp.spawn(...)`). A property call on any OTHER object (e.g. `lineRe.exec`,
// a RegExp) is not a process spawn and is ignored.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

/** child_process launch functions, by callee name. */
const SPAWN_CALLEES = /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/;
/** Object names a property-form child_process call is recognized under. */
const CHILD_PROCESS_OBJECTS = /^(cp|child_process|childProcess)$/;

/** The delegated binaries feature 006 permits Jolly's own code to spawn. */
export const ALLOWED_BINARIES = ["git", "pnpm", "npx"] as const;
/** The delegated packages feature 006 permits Jolly to launch through npx. */
export const ALLOWED_NPX_PACKAGES = [
  "@saleor/configurator",
  "vercel",
  "pnpm",
  "skills",
] as const;

/** The implementation directories (RIGGING.md `## Directories`) this scans. */
const IMPLEMENTATION_DIRS = ["src/", "bin/"];

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

export interface SpawnSite {
  file: string;
  line: number;
  /** The launched binary, or "<unresolved>" when not statically resolvable. */
  binary: string;
  /** For an `npx` launch: the package spec's package name (version stripped). */
  npxPackage?: string;
}

/** A string statically resolvable from this expression, else undefined. */
function resolveString(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isIdentifier(node)) {
    for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const initializer = declaration.getInitializer();
      if (
        initializer &&
        (Node.isStringLiteral(initializer) ||
          Node.isNoSubstitutionTemplateLiteral(initializer))
      ) {
        return initializer.getLiteralText();
      }
    }
  }
  return undefined;
}

/** The argument-array elements, following one identifier to its initializer. */
function resolveArgumentArray(node: Node | undefined): Node[] | undefined {
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node.getElements();
  if (Node.isIdentifier(node)) {
    for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const initializer = declaration.getInitializer();
      if (initializer && Node.isArrayLiteralExpression(initializer)) {
        return initializer.getElements();
      }
    }
  }
  return undefined;
}

/** `@scope/name@version` / `name@version` → the bare package name. */
function stripVersionSuffix(spec: string): string {
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
}

/**
 * The package an `npx` argument array launches: the first non-flag element,
 * resolved to a string and stripped of any version suffix. Undefined when the
 * array or the element is not statically resolvable — an unenumerable launch.
 */
function npxPackageOf(argumentsNode: Node | undefined): string | undefined {
  const elements = resolveArgumentArray(argumentsNode);
  if (!elements) return undefined;
  for (const element of elements) {
    if (Node.isSpreadElement(element)) return undefined;
    const value = resolveString(element);
    if (value === undefined) return undefined;
    if (value.startsWith("-")) continue;
    return stripVersionSuffix(value);
  }
  return undefined;
}

/** Whether this call expression launches a child process. */
function isSpawnCall(call: Node): call is import("ts-morph").CallExpression {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return SPAWN_CALLEES.test(callee.getText());
  if (Node.isPropertyAccessExpression(callee)) {
    return (
      SPAWN_CALLEES.test(callee.getName()) &&
      CHILD_PROCESS_OBJECTS.test(callee.getExpression().getText())
    );
  }
  return false;
}

/**
 * Every child-process spawn site in the implementation directories, with the
 * binary (and, for npx, the package) it launches. Optional virtual sources are
 * injected for a planted-red proof and removed again; they never touch disk.
 */
export function enumerateSpawnSites(injected: InjectedSource[] = []): SpawnSite[] {
  const sites: SpawnSite[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION_DIRS.some((dir) => file.startsWith(dir))) continue;
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!isSpawnCall(call)) continue;
        const [binaryNode, argumentsNode] = call.getArguments();
        const binary = binaryNode ? resolveString(binaryNode) : undefined;
        const site: SpawnSite = {
          file,
          line: call.getStartLineNumber(),
          binary: binary ?? "<unresolved>",
        };
        if (binary === "npx") {
          site.npxPackage = npxPackageOf(argumentsNode) ?? "<unresolved>";
        }
        sites.push(site);
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return sites;
}

/**
 * The spawn sites that launch outside the delegated official-tool set, or
 * whose launch target cannot be statically resolved. Each is a delegation the
 * feature 006 contract forbids or a spawn surface it cannot enumerate.
 */
export function findSpawnViolations(injected: InjectedSource[] = []): Violation[] {
  const violations: Violation[] = [];
  for (const site of enumerateSpawnSites(injected)) {
    if (site.binary === "<unresolved>") {
      violations.push({
        file: site.file,
        line: site.line,
        message:
          `${site.file}:${site.line} spawns a binary that cannot be statically resolved — ` +
          `the spawn surface must stay enumerable; launch a literal delegated binary`,
      });
      continue;
    }
    if (!(ALLOWED_BINARIES as readonly string[]).includes(site.binary)) {
      violations.push({
        file: site.file,
        line: site.line,
        message:
          `${site.file}:${site.line} spawns \`${site.binary}\`, outside the delegated ` +
          `set (${ALLOWED_BINARIES.join(", ")})`,
      });
      continue;
    }
    if (site.binary !== "npx") continue;
    if (site.npxPackage === "<unresolved>") {
      violations.push({
        file: site.file,
        line: site.line,
        message:
          `${site.file}:${site.line} launches an npx package that cannot be statically ` +
          `resolved — the spawn surface must stay enumerable; launch a literal delegated package`,
      });
      continue;
    }
    if (!(ALLOWED_NPX_PACKAGES as readonly string[]).includes(site.npxPackage!)) {
      violations.push({
        file: site.file,
        line: site.line,
        message:
          `${site.file}:${site.line} launches \`${site.npxPackage}\` through npx, outside the ` +
          `delegated set (${ALLOWED_NPX_PACKAGES.join(", ")}); the deprecated saleor CLI and ` +
          `non-configurator @saleor/* packages are forbidden (feature 006)`,
      });
    }
  }
  return violations;
}
