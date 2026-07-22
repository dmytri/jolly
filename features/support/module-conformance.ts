// Structural conformance checker for Jolly's module layering, its single
// env-creation seam, and its single command-surface parser seam (features
// module-boundary-conformance, single-creation-seam, and the feature 006
// global-output-flags @property scenario — all @logic @property).
//
// One owned ts-morph checker covers three facets a module-graph tool alone
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
//   - The single command-surface parser seam: the global output flags
//     (`--json`, `--quiet`, `--yes`) are declared once in GLOBAL_BOOLEAN_FLAGS
//     and reach every command through the one @bomb.sh/args parser call in
//     src/index.ts — never a per-command parser that omits or overrides them.
//
// This file excludes itself from the seam scan so its own pattern literals are
// never self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface Violation {
  file: string;
  line: number;
  message: string;
}

const ENV_FACTORY = "features/support/env-factory.ts";
const SANDBOX_SEAM = "features/support/sandbox.ts";
const CHECKER_FILE = "features/support/module-conformance.ts";
const EXCEPTION_MARKER = "env-factory-exception";
const SINGLE_SEAM_EXCEPTION = "single-seam-exception";
const CREATE_STORE_LITERALS = ["create", "store", "--create-environment"];
const VERCEL_PROJECT_ADD_LITERALS = ["vercel", "project", "add"];
const DRY_RUN = "--dry-run";

const CLI_ENTRY = "src/index.ts";
const BOMB_ARGS_MODULE = "@bomb.sh/args";
const BOMB_ARGS_EXPORT = "parse";
const GLOBAL_FLAGS_DECL = "GLOBAL_BOOLEAN_FLAGS";
// The three global OUTPUT flags every command must accept through the one
// parser seam (feature 006 Rule "Thin command surface"). GLOBAL_BOOLEAN_FLAGS
// carries more (`dry-run`, `help`); these are the ones this scenario guards.
const REQUIRED_GLOBAL_FLAGS = ["json", "quiet", "yes"];

function project(): Project {
  return sharedProject();
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

/**
 * Single Vercel-project-seam violations: real `vercel project add` CLI spawns in
 * the verification layer located outside features/support/sandbox.ts. A
 * `--dry-run` array (a preview that creates nothing) and an array whose site
 * carries a `single-seam-exception:` marker (a loopback fake) are not real
 * creations. `project add` is the discriminator, so the sibling `vercel project
 * remove` and `vercel whoami` spawns are not flagged.
 */
export function findVercelProjectSeamViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!file.startsWith("features/")) continue;
    if (file === CHECKER_FILE) continue;
    for (const array of source.getDescendantsOfKind(
      SyntaxKind.ArrayLiteralExpression,
    )) {
      const literals = stringElements(array);
      if (
        !VERCEL_PROJECT_ADD_LITERALS.every((literal) =>
          literals.includes(literal),
        )
      ) {
        continue;
      }
      if (literals.includes(DRY_RUN)) continue;
      if (file === SANDBOX_SEAM) continue;
      if (markerText(array).includes(SINGLE_SEAM_EXCEPTION)) continue;
      const line = array.getStartLineNumber();
      violations.push({
        file,
        line,
        message:
          `${file}:${line} spawns a real \`vercel project add\` outside the single ` +
          `Vercel-project seam ${SANDBOX_SEAM}. Route it through the sandbox helper, or, ` +
          `if it only drives a loopback fake and creates no real resource, record a ` +
          `${SINGLE_SEAM_EXCEPTION}: marker at its site.`,
      });
    }
  }
  return violations;
}

export interface SeamLocation {
  file: string;
  line: number;
  seamKey: string;
  seamLabel: string;
}

function enclosingFunctionName(node: Node): string {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.getName() ?? "<anonymous>";
  }
  const parent = node.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  if (parent && Node.isPropertyAssignment(parent)) return parent.getName();
  return "<anonymous>";
}

/**
 * The enclosing production seam of a spawn array: the nearest function that
 * contains it. Two spawns in the same function share one seam key; spawns in
 * different functions have different keys. A top-level array keys to module
 * scope.
 */
function enclosingSeam(array: Node): { key: string; label: string } {
  let node: Node | undefined = array.getParent();
  while (node) {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node)
    ) {
      const file = repoRelative(node.getSourceFile().getFilePath());
      const line = node.getStartLineNumber();
      const name = enclosingFunctionName(node);
      return { key: `${file}:${line}`, label: `${name} (${file}:${line})` };
    }
    node = node.getParent();
  }
  const file = repoRelative(array.getSourceFile().getFilePath());
  return { key: `${file}:module`, label: `module scope of ${file}` };
}

/**
 * Production spawn-seam locations: every real CLI-spawn array in src/ whose
 * string literals include all of `literals`, each mapped to its enclosing
 * production seam. A `--dry-run` preview array and an array whose site carries a
 * `single-seam-exception:` marker create no real resource and are excluded. When
 * every located spawn shares one enclosing seam, the resource is created at a
 * single seam.
 */
export function locateProductionSpawnSeams(literals: string[]): SeamLocation[] {
  const locations: SeamLocation[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!file.startsWith("src/")) continue;
    for (const array of source.getDescendantsOfKind(
      SyntaxKind.ArrayLiteralExpression,
    )) {
      const found = stringElements(array);
      if (!literals.every((literal) => found.includes(literal))) continue;
      if (found.includes(DRY_RUN)) continue;
      if (markerText(array).includes(SINGLE_SEAM_EXCEPTION)) continue;
      const { key, label } = enclosingSeam(array);
      locations.push({
        file,
        line: array.getStartLineNumber(),
        seamKey: key,
        seamLabel: label,
      });
    }
  }
  return locations;
}

/**
 * Global-output-flag seam violations: the command surface declares `--json`,
 * `--quiet`, and `--yes` ONCE, at the single @bomb.sh/args parser seam in
 * src/index.ts, with no per-command divergence.
 *
 * The single parser seam is checkable, not conventional:
 *   - src/index.ts imports the parser from @bomb.sh/args and calls it exactly
 *     once (a second call would be a per-command parse path diverging from the
 *     seam).
 *   - GLOBAL_BOOLEAN_FLAGS declares "json", "quiet", and "yes" (drop one and a
 *     command can no longer accept that flag through the one parser).
 *   - That single parser call feeds its `boolean` set from GLOBAL_BOOLEAN_FLAGS,
 *     so the global flags reach every command uniformly rather than being
 *     re-declared per command.
 * Each missing piece would let a command diverge from the shared flag surface,
 * so each is reported as a violation.
 */
/**
 * One creation seam the checker declares for an externally-created resource.
 * A verification-layer resource declares the file its real spawn lives in; a
 * production resource declares the spawn literals that locate it, and its seam
 * is the single enclosing function those spawns share.
 */
export interface DeclaredCreationSeam {
  resource: string;
  scope: "verification" | "production";
  /** The declared file seam, for a verification-layer resource. */
  file?: string;
  /** The spawn literals that locate a production resource's real spawns. */
  literals?: string[];
}

/**
 * Every CLI-spawned external resource and the single seam its creation lives
 * in. One structural fact, applied uniformly, so a new resource adds a seam
 * declaration here rather than a scenario to the spec.
 */
export const DECLARED_CREATION_SEAMS: DeclaredCreationSeam[] = [
  { resource: "Saleor environment", scope: "verification", file: ENV_FACTORY },
  { resource: "Vercel project", scope: "verification", file: SANDBOX_SEAM },
  {
    resource: "Vercel deployment",
    scope: "production",
    literals: ["deploy", "--prod"],
  },
  {
    // Feature 004 pins the spawned form as `npx @saleor/configurator@latest
    // deploy`, so the locator matches that exact spawn element.
    resource: "starter-recipe deploy",
    scope: "production",
    literals: ["@saleor/configurator@latest", "deploy"],
  },
  {
    resource: "Paper storefront clone",
    scope: "production",
    literals: ["clone", "https://github.com/saleor/storefront.git"],
  },
];

/** A real creation spawn sitting outside the single seam declared for its resource. */
export interface CreationSeamFinding {
  resource: string;
  /** The spawn's site, `<file>:<line>`. */
  site: string;
  /** The seam the spawn belongs in. */
  seam: string;
  message: string;
}

/**
 * Judge one production resource's located spawns against the single-seam rule:
 * every located spawn shares one enclosing seam. The seam the resource's
 * spawns already share stands as the declared one, so a spawn that drifted out
 * of it is named against the seam it belongs in. Pure over its input, so the
 * planted red judges the same code path the real assertion does.
 */
export function judgeProductionSeam(
  resource: string,
  locations: SeamLocation[],
): CreationSeamFinding[] {
  if (locations.length === 0) {
    return [
      {
        resource,
        site: "(none located)",
        seam: "(none)",
        message:
          `no real ${resource} spawn is located in src/ — the creation seam is ` +
          `missing from production source`,
      },
    ];
  }
  const seams = new Map<string, { label: string; count: number }>();
  for (const location of locations) {
    const current = seams.get(location.seamKey);
    if (current) current.count += 1;
    else seams.set(location.seamKey, { label: location.seamLabel, count: 1 });
  }
  if (seams.size === 1) return [];
  // The seam holding the most spawns is the resource's home; the strays are named against it.
  const [homeKey, home] = [...seams.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  )[0]!;
  return locations
    .filter((location) => location.seamKey !== homeKey)
    .map((location) => ({
      resource,
      site: `${location.file}:${location.line}`,
      seam: home.label,
      message:
        `${resource}: the spawn at ${location.file}:${location.line} sits in ` +
        `${location.seamLabel}, outside the single seam ${home.label} the ` +
        `resource's other spawns share`,
    }));
}

/**
 * Every real creation spawn that falls outside the single seam declared for
 * the resource it creates, across the verification layer and production source.
 */
export function findCreationSeamFindings(): CreationSeamFinding[] {
  const findings: CreationSeamFinding[] = [];
  for (const declared of DECLARED_CREATION_SEAMS) {
    if (declared.scope === "verification") {
      const violations =
        declared.file === ENV_FACTORY
          ? findCreationSeamViolations()
          : findVercelProjectSeamViolations();
      for (const violation of violations) {
        findings.push({
          resource: declared.resource,
          site: `${violation.file}:${violation.line}`,
          seam: declared.file!,
          message: violation.message,
        });
      }
      continue;
    }
    findings.push(
      ...judgeProductionSeam(
        declared.resource,
        locateProductionSpawnSeams(declared.literals!),
      ),
    );
  }
  return findings;
}

export function findGlobalOutputFlagViolations(): Violation[] {
  const violations: Violation[] = [];
  const source = project().getSourceFile(
    (file) => repoRelative(file.getFilePath()) === CLI_ENTRY,
  );
  if (!source) {
    violations.push({
      file: CLI_ENTRY,
      line: 0,
      message: `${CLI_ENTRY} not found — cannot check the command surface for the global output flags`,
    });
    return violations;
  }

  // Resolve the local name the single Bombshell parser is imported under
  // (`import { parse as parseBombArgs } from "@bomb.sh/args"`).
  let parserName: string | undefined;
  for (const importDeclaration of source.getImportDeclarations()) {
    if (importDeclaration.getModuleSpecifierValue() !== BOMB_ARGS_MODULE) continue;
    for (const named of importDeclaration.getNamedImports()) {
      if (named.getName() !== BOMB_ARGS_EXPORT) continue;
      parserName = named.getAliasNode()?.getText() ?? named.getName();
    }
  }
  if (!parserName) {
    violations.push({
      file: CLI_ENTRY,
      line: 0,
      message: `${CLI_ENTRY} does not import the ${BOMB_ARGS_MODULE} parser — the single Bombshell parser seam is missing`,
    });
    return violations;
  }

  // The one parser seam: exactly one call to that parser. Zero means no seam;
  // more than one means a per-command parse path has diverged from the seam.
  const parserCalls = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const expression = call.getExpression();
      return Node.isIdentifier(expression) && expression.getText() === parserName;
    });
  if (parserCalls.length === 0) {
    violations.push({
      file: CLI_ENTRY,
      line: 0,
      message: `${CLI_ENTRY} never calls the Bombshell parser ${parserName}() — the single command-surface parser seam is missing`,
    });
    return violations;
  }
  for (const extra of parserCalls.slice(1)) {
    const line = extra.getStartLineNumber();
    violations.push({
      file: CLI_ENTRY,
      line,
      message: `${CLI_ENTRY}:${line} calls the Bombshell parser a second time — a per-command parse path diverges from the single parser seam`,
    });
  }
  const seam = parserCalls[0]!;

  // The global output flags are declared once, in GLOBAL_BOOLEAN_FLAGS.
  const declaration = source.getVariableDeclaration(GLOBAL_FLAGS_DECL);
  if (!declaration) {
    violations.push({
      file: CLI_ENTRY,
      line: 0,
      message: `${CLI_ENTRY} has no ${GLOBAL_FLAGS_DECL} declaration — the global output flags are not declared at one seam`,
    });
    return violations;
  }
  const initializer = declaration.getInitializer();
  // Unwrap a trailing `as const` so the array literal is reached.
  const arrayNode =
    initializer && Node.isAsExpression(initializer)
      ? initializer.getExpression()
      : initializer;
  const globalFlags = arrayNode ? stringElements(arrayNode) : [];
  const declarationLine = declaration.getStartLineNumber();
  for (const flag of REQUIRED_GLOBAL_FLAGS) {
    if (globalFlags.includes(flag)) continue;
    violations.push({
      file: CLI_ENTRY,
      line: declarationLine,
      message: `${CLI_ENTRY}:${declarationLine} ${GLOBAL_FLAGS_DECL} omits "${flag}" — no command could accept --${flag} through the single parser seam`,
    });
  }

  // The single parser call feeds its boolean set from GLOBAL_BOOLEAN_FLAGS, so
  // the global flags reach every command uniformly (no per-command override).
  const optionsArg = seam.getArguments()[1];
  const feedsFromGlobal =
    optionsArg !== undefined &&
    optionsArg
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((identifier) => identifier.getText() === GLOBAL_FLAGS_DECL);
  if (!feedsFromGlobal) {
    const line = seam.getStartLineNumber();
    violations.push({
      file: CLI_ENTRY,
      line,
      message: `${CLI_ENTRY}:${line} the single Bombshell parser does not feed its boolean set from ${GLOBAL_FLAGS_DECL} — the global output flags may not reach every command uniformly`,
    });
  }

  return violations;
}

/**
 * The property set that discriminates the environment-creation POST body sent
 * to /platform/api/organizations/{organization}/environments/ (feature 012).
 * An object literal carrying all of these IS that request body, wherever it is
 * built.
 */
const ENV_CREATION_BODY_KEYS = [
  "name",
  "project",
  "domain_label",
  "database_population",
  "service",
];

export interface BodySite {
  file: string;
  line: number;
  seamLabel: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

/**
 * Every place in src/ that builds the environment-creation POST body: an object
 * literal carrying the body's discriminating properties. One site means the
 * `--dry-run` preview reports the very body the real request sends. A second,
 * independently constructed site means the preview vouches for a request that
 * is built somewhere else, and can drift from it silently.
 */
export function findEnvironmentCreationBodySites(
  injected: InjectedSource[] = [],
): BodySite[] {
  const sites: BodySite[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!file.startsWith("src/")) continue;
      for (const literal of source.getDescendantsOfKind(
        SyntaxKind.ObjectLiteralExpression,
      )) {
        // Shorthand (`service,`) names the property just as a longhand
        // assignment does, so both count: a body is a body however it is written.
        const properties = literal
          .getProperties()
          .filter(
            (property) =>
              Node.isPropertyAssignment(property) ||
              Node.isShorthandPropertyAssignment(property),
          )
          .map((property) => property.getName().replace(/^["']|["']$/g, ""));
        if (!ENV_CREATION_BODY_KEYS.every((key) => properties.includes(key))) continue;
        const { label } = enclosingSeam(literal);
        sites.push({
          file,
          line: literal.getStartLineNumber(),
          seamLabel: label,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return sites;
}
