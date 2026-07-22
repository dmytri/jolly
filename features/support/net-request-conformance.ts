// Structural conformance checker for feature 020's @logic @property scenario
// "Every network request site in Jolly's own code applies the first-party
// pre-flight guard".
//
// Feature 020's "First-party hosts only" Rule is a security contract: Jolly's
// own request-sending code contacts only first-party hosts, refused pre-flight
// otherwise. The predicate lives in the canonical module src/lib/hosts.ts
// (isFirstPartyHost) and is applied at the request seams through the
// assertFirstParty / assertFirstPartyUrl wrappers. This check enumerates every
// site in the implementation directory that can reach the network — a `fetch`
// call, or an import of a lower-level network client the guard model does not
// cover — and reports each site whose enclosing seam consults no first-party
// predicate: such a site can send without the pre-flight.
//
// The seam is the enclosing function (or the module, for a top-level call): a
// seam guards its sends equally well by an early assert, an enclosing `if`, or
// a shared helper, so the guard is looked for across the whole seam — the same
// recognition rule the harness-affordance checker uses.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

/** The first-party predicate and its pre-flight wrappers, by callee name. */
const GUARD_CALLEES = /^(isFirstPartyHost|assertFirstParty|assertFirstPartyUrl)$/;
/** The canonical predicate module: its own body IS the predicate. */
const PREDICATE_MODULE = "src/lib/hosts.ts";
/**
 * Lower-level network clients the guard model does not cover. An import of one
 * is a request path that can send without the predicate, so it is reported and
 * the code routes through the guarded fetch seams instead.
 */
const NETWORK_MODULES = new Set([
  "http",
  "https",
  "net",
  "tls",
  "dgram",
  "http2",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:http2",
  "undici",
]);

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

export interface RequestSite {
  file: string;
  line: number;
  /** What can send here: a `fetch` call, or a named network-module import. */
  mechanism: string;
  /** Whether the enclosing seam consults the first-party predicate. */
  guarded: boolean;
}

/** The enclosing function-like seam, or undefined for a top-level site. */
function enclosingSeam(node: Node): Node | undefined {
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

/** Whether a seam (or, top-level, the whole module) calls the predicate. */
function consultsPredicate(scope: Node): boolean {
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : callee.getText();
    if (GUARD_CALLEES.test(name)) return true;
  }
  return false;
}

/** Whether this call expression is a `fetch(...)` send. */
function isFetchCall(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText() === "fetch";
  if (Node.isPropertyAccessExpression(callee)) {
    return callee.getName() === "fetch";
  }
  return false;
}

/**
 * Every network request site under `dir` (repo-root-relative), with whether its
 * seam consults the first-party predicate. Optional virtual sources are
 * injected for a planted-red proof and removed again; they never touch disk.
 */
export function enumerateRequestSites(
  dir: string,
  injected: InjectedSource[] = [],
): RequestSite[] {
  const sites: RequestSite[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!file.startsWith(dir)) continue;

      // A lower-level network client import: a send path the predicate model
      // does not cover.
      for (const declaration of source.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!NETWORK_MODULES.has(specifier)) continue;
        sites.push({
          file,
          line: declaration.getStartLineNumber(),
          mechanism: `import of ${specifier}`,
          guarded: false,
        });
      }

      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!isFetchCall(call)) continue;
        const seam = enclosingSeam(call);
        const guarded =
          file === PREDICATE_MODULE ||
          consultsPredicate(seam ?? source);
        sites.push({
          file,
          line: call.getStartLineNumber(),
          mechanism: "fetch call",
          guarded,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return sites;
}

/**
 * The request sites that can send without consulting the first-party
 * predicate: each is a pre-flight the security contract requires and the code
 * does not perform.
 */
export function findUnguardedRequestSites(
  dir: string,
  injected: InjectedSource[] = [],
): Violation[] {
  return enumerateRequestSites(dir, injected)
    .filter((site) => !site.guarded)
    .map((site) => ({
      file: site.file,
      line: site.line,
      message:
        `${site.file}:${site.line} reaches the network (${site.mechanism}) through a seam ` +
        `that consults no first-party host predicate before sending — route it through ` +
        `isFirstPartyHost / an assertFirstParty pre-flight`,
    }));
}
