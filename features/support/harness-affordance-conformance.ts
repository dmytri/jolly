// Structural conformance checker for the harness-affordance guard (feature 026,
// @logic @property "No harness-only affordance in the shipped CLI is reachable
// without the harness guard").
//
// A harness-only affordance is a production code path that FABRICATES a service
// response instead of asking the service: an injected organization list, an
// injected environment list. That is a test double living in production, and a
// customer running the shipped CLI must never reach it. The affordances are
// declared as `mock-*` command-line flags, so they are enumerable: every read of
// a `mock-*` flag or option in src/ is a site where a service response can be
// fabricated.
//
// Each such site must consult the harness guard. The guard's variable name is a
// production detail this check does not pin — it recognises the guard by the
// harness reference in the affordance's own seam (an identifier, a call, or an
// environment read naming the harness), so production stays free to name it. A
// site whose seam consults no guard at all is reachable from the shipped surface
// and is reported.
//
// This file excludes itself from the scan so its own literals are never
// self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

/** A harness-only affordance is declared as a `mock-*` command-line flag. */
const AFFORDANCE_PREFIX = "mock-";
/** The harness guard is recognised by the harness it names, not by its spelling. */
const HARNESS_REFERENCE = /harness/i;
const CHECKER_FILE = "features/support/harness-affordance-conformance.ts";

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

export interface AffordanceSite {
  file: string;
  line: number;
  /** The `mock-*` flag this site reads. */
  affordance: string;
  /** Whether the seam that reads it consults the harness guard. */
  guarded: boolean;
}

/**
 * The seam a node sits in: the function whose body decides whether the
 * fabrication happens. The guard is looked for across this whole seam, because a
 * seam guards its affordance equally well by an early return, an enclosing `if`,
 * or a ternary on the guard.
 */
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

/** Whether a seam consults the harness guard anywhere in its body. */
function consultsHarnessGuard(seam: Node | undefined): boolean {
  if (!seam) return false;
  for (const identifier of seam.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (HARNESS_REFERENCE.test(identifier.getText())) return true;
  }
  for (const literal of seam.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (HARNESS_REFERENCE.test(literal.getLiteralValue())) return true;
  }
  return false;
}

/**
 * Whether a `mock-*` string literal is READ here — passed to `args.flags.has(..)`
 * or used to index `args.options[..]` — rather than merely declared in the
 * flag-surface list. A declaration fabricates nothing; a read is the fabrication
 * seam.
 */
function isReadSite(literal: Node): boolean {
  const parent = literal.getParent();
  if (!parent) return false;
  if (Node.isElementAccessExpression(parent)) {
    return parent.getArgumentExpression() === literal;
  }
  if (Node.isCallExpression(parent)) {
    return parent.getArguments().includes(literal as never);
  }
  return false;
}

/**
 * Every harness-only affordance the production source declares, at the site that
 * reads it, with whether that site's seam consults the harness guard. Optional
 * virtual sources are injected for a planted-red proof and removed again; they
 * never touch disk.
 */
export function enumerateHarnessAffordances(
  injected: InjectedSource[] = [],
): AffordanceSite[] {
  const sites: AffordanceSite[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!file.startsWith("src/")) continue;
      if (file === CHECKER_FILE) continue;
      for (const literal of source.getDescendantsOfKind(
        SyntaxKind.StringLiteral,
      )) {
        const value = literal.getLiteralValue();
        if (!value.startsWith(AFFORDANCE_PREFIX)) continue;
        if (!isReadSite(literal)) continue;
        sites.push({
          file,
          line: literal.getStartLineNumber(),
          affordance: value,
          guarded: consultsHarnessGuard(enclosingSeam(literal)),
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return sites;
}

/**
 * The harness-only affordances a customer can reach: a site that fabricates a
 * service response with no harness guard consulted in its seam.
 */
export function findUnguardedHarnessAffordances(
  injected: InjectedSource[] = [],
): Violation[] {
  return enumerateHarnessAffordances(injected)
    .filter((site) => !site.guarded)
    .map((site) => ({
      file: site.file,
      line: site.line,
      message:
        `${site.file}:${site.line} reads the harness-only affordance \`${site.affordance}\` ` +
        "with no harness guard consulted in its seam — the shipped CLI would fabricate a " +
        "service response for a customer",
    }));
}
