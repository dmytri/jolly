// Structural conformance checker for Jolly's module layering and its single
// env-creation seam (features module-boundary-conformance and
// single-creation-seam, @logic @property).
//
// One owned ts-morph checker covers two facets a module-graph tool alone
// cannot:
//   - Module-layering boundaries, resolved by real module resolution (each
//     import is resolved to its source file, not matched as a specifier string):
//     src/lib never imports src/index.ts, and src/ never imports the
//     verification layer (features/support, features/step_definitions).
//   - The single env-creation seam: every real `create store
//     --create-environment` CLI spawn — a call whose argument array carries
//     those string literals — lives in features/support/env-factory.ts. A
//     `--dry-run` array creates nothing (a preview) and is excluded; a loopback
//     fake array marked `env-factory-exception:` at its site creates no real
//     resource and is excluded.
//
// This file excludes itself from the seam scan so its own pattern literals are
// never self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface Violation {
  file: string;
  line: number;
  message: string;
}

const ENV_FACTORY = "features/support/env-factory.ts";
const CHECKER_FILE = "features/support/module-conformance.ts";
const EXCEPTION_MARKER = "env-factory-exception";
const CREATE_STORE_LITERALS = ["create", "store", "--create-environment"];
const DRY_RUN = "--dry-run";

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
 * Module-layering boundary violations, resolved by real module resolution:
 * each import/export is resolved to its source file, so the boundary holds by
 * resolution rather than by matching specifier strings.
 */
export function findModuleLayeringViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const source of project().getSourceFiles()) {
    const from = repoRelative(source.getFilePath());
    if (!from.startsWith("src/")) continue;
    const specifiers = [
      ...source.getImportDeclarations(),
      ...source.getExportDeclarations(),
    ];
    for (const declaration of specifiers) {
      const target = declaration.getModuleSpecifierSourceFile();
      if (!target) continue;
      const to = repoRelative(target.getFilePath());
      const line = declaration.getStartLineNumber();
      if (from.startsWith("src/lib/") && to === "src/index.ts") {
        violations.push({
          file: from,
          line,
          message: `${from}:${line} imports src/index.ts — a leaf utility must not depend on the orchestration entrypoint`,
        });
      }
      if (
        to.startsWith("features/support/") ||
        to.startsWith("features/step_definitions/")
      ) {
        violations.push({
          file: from,
          line,
          message: `${from}:${line} imports the verification layer (${to}) — production must not depend on verification code`,
        });
      }
    }
  }
  return violations;
}

function stringElements(array: Node): string[] {
  return array
    .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
    .getElements()
    .filter((element) => Node.isStringLiteral(element))
    .map((element) => element.getLiteralValue());
}

function isCreateStoreArray(literals: string[]): boolean {
  return CREATE_STORE_LITERALS.every((literal) => literals.includes(literal));
}

function markerText(array: Node): string {
  const parts: string[] = [];
  let node: Node | undefined = array;
  // Walk up to the enclosing statement, collecting leading comments at each
  // level so an `env-factory-exception:` marker recorded on the spawn statement
  // or the call is found regardless of exact placement.
  for (let depth = 0; node && depth < 6; depth++) {
    for (const comment of node.getLeadingCommentRanges()) {
      parts.push(comment.getText());
    }
    const parent = node.getParent();
    if (!parent) break;
    const kind = parent.getKind();
    if (
      kind === SyntaxKind.Block ||
      kind === SyntaxKind.SourceFile ||
      kind === SyntaxKind.ModuleBlock ||
      kind === SyntaxKind.CaseClause ||
      kind === SyntaxKind.DefaultClause
    ) {
      break;
    }
    node = parent;
  }
  return parts.join("\n");
}

/**
 * Single-creation-seam violations: real `create store --create-environment` CLI
 * spawns located outside features/support/env-factory.ts. A `--dry-run` array
 * (a preview that creates nothing) and an array whose site carries an
 * `env-factory-exception:` marker (a loopback fake) are not real creations.
 */
export function findCreationSeamViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!file.startsWith("features/")) continue;
    if (file === CHECKER_FILE) continue;
    for (const array of source.getDescendantsOfKind(
      SyntaxKind.ArrayLiteralExpression,
    )) {
      const literals = stringElements(array);
      if (!isCreateStoreArray(literals)) continue;
      if (literals.includes(DRY_RUN)) continue;
      if (file === ENV_FACTORY) continue;
      if (markerText(array).includes(EXCEPTION_MARKER)) continue;
      const line = array.getStartLineNumber();
      violations.push({
        file,
        line,
        message:
          `${file}:${line} spawns a real \`create store --create-environment\` outside the ` +
          `single env-creation seam ${ENV_FACTORY}. Route it through createEnvironment, or, ` +
          `if it only drives a loopback fake and creates no real resource, record an ` +
          `${EXCEPTION_MARKER}: marker at its site.`,
      });
    }
  }
  return violations;
}
