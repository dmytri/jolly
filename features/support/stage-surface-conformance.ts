// Structural conformance checker for Jolly's setup-stage surface (feature
// stage-surface-consistency, @logic @property).
//
// A stage name is written in four independent places: `DEFAULT_STAGE_RUNNERS`
// maps a stage to the function that runs it, `STAGE_DESCRIPTIONS` maps the same
// names to the progress descriptions, `HIGH_RISK_STAGES` names the stages
// `jolly start` gates on, and `SIDE_EFFECTING` in `src/lib/start-close.ts` names
// the stages whose failure makes a close dishonest. Nothing joins them, so each
// list is maintained by hand against the other three. This checker reads each
// site and compares it against the surface Jolly declares.
//
// The lists are not all the same set, and the declaration carries that: every
// stage takes a description, only the stages `jolly start` runs itself take a
// runner, and `init` and `auth` are progress rows rather than side-effecting
// work. So the declaration names each stage with the facets it carries, and each
// site is compared against the stages declared for that site's facet, never
// against all four lists being equal.
//
// The declared surface is the anchor: one exported declaration every site
// derives from, read as a record of stage name to the facets it carries:
//
//   export const STAGE_SURFACE = {
//     init: ["description"],
//     store: ["runner", "description", "highRisk", "sideEffecting"],
//   } as const;
//
// Where no such declaration exists, that absence is itself the violation,
// because four hand-maintained copies cannot be joined to anything.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

/** The name of the single exported declaration every stage site derives from. */
export const DECLARED_SURFACE = "STAGE_SURFACE";

/** The facets a stage may carry, one per site. */
type StageFacet = "runner" | "description" | "highRisk" | "sideEffecting";

/** The surface: each stage name mapped to the facets it carries. */
export type StageSurface = Record<string, StageFacet[]>;

/** One of the four places a stage name is written today. */
export interface StageSite {
  /** A human-readable name for the site, used in the violation message. */
  name: string;
  /** Where the site lives, for the report. */
  file: string;
  /** The facet this site carries, so it is compared against that facet alone. */
  facet: StageFacet;
  /** The stage names the site carries, or undefined when it could not be read. */
  stages?: string[];
}

export interface StageViolation {
  /** The stage the sites disagree about, or "(surface)" for a missing anchor. */
  stage: string;
  /** The site the stage is missing from, or the site naming an undeclared stage. */
  site: string;
  message: string;
}

function project(): Project {
  return sharedProject();
}

function sourceFile(relativePath: string) {
  return project().getSourceFile(join(REPO_ROOT, relativePath));
}

function unquote(name: string): string {
  return name.replace(/^["']|["']$/g, "");
}

/** Strip `as const` and parentheses so the underlying literal is reached. */
function unwrap(node: Node): Node {
  let current = node;
  while (Node.isAsExpression(current) || Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

/** The property names an object-literal initializer declares, in order. */
function recordKeys(node: Node): string[] | undefined {
  const literal = unwrap(node);
  if (!Node.isObjectLiteralExpression(literal)) return undefined;
  const keys: string[] = [];
  for (const member of literal.getProperties()) {
    if (Node.isPropertyAssignment(member) || Node.isShorthandPropertyAssignment(member)) {
      keys.push(unquote(member.getName()));
    }
  }
  return keys;
}

/** The string elements an array-literal initializer carries, in order. */
function arrayStrings(node: Node): string[] | undefined {
  const literal = unwrap(node);
  if (!Node.isArrayLiteralExpression(literal)) return undefined;
  const values: string[] = [];
  for (const element of literal.getElements()) {
    const value = unwrap(element);
    if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
      values.push(value.getLiteralText());
    }
  }
  return values;
}

/** The initializer of a named variable declaration in an implementation file. */
function initializerOf(relativePath: string, name: string): Node | undefined {
  const source = sourceFile(relativePath);
  return source?.getVariableDeclaration(name)?.getInitializer();
}

const FACETS: StageFacet[] = ["runner", "description", "highRisk", "sideEffecting"];

function isFacet(value: string): value is StageFacet {
  return (FACETS as string[]).includes(value);
}

/**
 * The surface Jolly declares: the exported `STAGE_SURFACE` declaration, read as
 * each stage name mapped to the facets it carries. Undefined when no such
 * declaration exists, which is itself the violation the check reports.
 */
export function declaredStageSurface(): StageSurface | undefined {
  for (const source of project().getSourceFiles()) {
    if (!source.getFilePath().includes("/src/")) continue;
    const initializer = source.getVariableDeclaration(DECLARED_SURFACE)?.getInitializer();
    if (!initializer) continue;
    const literal = unwrap(initializer);
    if (!Node.isObjectLiteralExpression(literal)) continue;
    const surface: StageSurface = {};
    for (const member of literal.getProperties()) {
      if (!Node.isPropertyAssignment(member)) continue;
      const stage = unquote(member.getName());
      const value = member.getInitializer();
      if (!value) continue;
      const facets = (arrayStrings(value) ?? []).filter(isFacet);
      surface[stage] = facets;
    }
    if (Object.keys(surface).length > 0) return surface;
  }
  return undefined;
}

/** The stage runners: the keys of the default stage-runner record. */
function runnerSite(): StageSite {
  const site: StageSite = {
    name: "the stage runners",
    file: "src/index.ts",
    facet: "runner",
  };
  const initializer = initializerOf(site.file, "DEFAULT_STAGE_RUNNERS");
  if (initializer) site.stages = recordKeys(initializer);
  return site;
}

/** The stage descriptions: the keys of the progress-description record. */
function descriptionSite(): StageSite {
  const site: StageSite = {
    name: "the stage descriptions",
    file: "src/index.ts",
    facet: "description",
  };
  const initializer = initializerOf(site.file, "STAGE_DESCRIPTIONS");
  if (initializer) site.stages = recordKeys(initializer);
  return site;
}

/** The high-risk gate: the stages `jolly start` runs itself and gates on. */
function highRiskSite(): StageSite {
  const site: StageSite = {
    name: "the high-risk gate",
    file: "src/index.ts",
    facet: "highRisk",
  };
  const initializer = initializerOf(site.file, "HIGH_RISK_STAGES");
  if (initializer) site.stages = arrayStrings(initializer);
  return site;
}

/** The side-effecting close list: the stages whose failure makes a close dishonest. */
function sideEffectingSite(): StageSite {
  const site: StageSite = {
    name: "the side-effecting close list",
    file: "src/lib/start-close.ts",
    facet: "sideEffecting",
  };
  const initializer = initializerOf(site.file, "SIDE_EFFECTING");
  if (initializer) site.stages = arrayStrings(initializer);
  return site;
}

/** The four sites a stage name is written in today. */
export function stageSites(): StageSite[] {
  return [runnerSite(), descriptionSite(), highRiskSite(), sideEffectingSite()];
}

/** The stages the surface declares as carrying a given facet. */
function stagesForFacet(surface: StageSurface, facet: StageFacet): string[] {
  return Object.keys(surface).filter((stage) => surface[stage]?.includes(facet));
}

/**
 * The join: every site's stage set against the stages declared for that site's
 * facet. A stage declared for the facet and absent from the site, or named in
 * the site and absent from the declared surface, is reported naming the stage
 * and the site.
 */
export function stageSurfaceViolations(
  surface: StageSurface | undefined,
  sites: StageSite[],
): StageViolation[] {
  const violations: StageViolation[] = [];
  if (!surface) {
    violations.push({
      stage: "(surface)",
      site: `the declared surface \`${DECLARED_SURFACE}\``,
      message:
        `no exported \`${DECLARED_SURFACE}\` declaration exists in src/, so the ` +
        `four stage sites derive from nothing and cannot be joined`,
    });
    return violations;
  }
  for (const site of sites) {
    if (!site.stages) {
      violations.push({
        stage: "(site)",
        site: site.name,
        message: `${site.name} (${site.file}) could not be read as a stage set`,
      });
      continue;
    }
    const declared = new Set(stagesForFacet(surface, site.facet));
    const present = new Set(site.stages);
    for (const stage of declared) {
      if (present.has(stage)) continue;
      violations.push({
        stage,
        site: site.name,
        message:
          `the stage "${stage}" is declared in \`${DECLARED_SURFACE}\` as carrying ` +
          `the "${site.facet}" facet and is absent from ${site.name} (${site.file})`,
      });
    }
    for (const stage of present) {
      if (declared.has(stage)) continue;
      const known = stage in surface;
      violations.push({
        stage,
        site: site.name,
        message: known
          ? `the stage "${stage}" appears in ${site.name} (${site.file}) and is not ` +
            `declared in \`${DECLARED_SURFACE}\` as carrying the "${site.facet}" facet`
          : `the stage "${stage}" appears in ${site.name} (${site.file}) and is ` +
            `absent from \`${DECLARED_SURFACE}\``,
      });
    }
  }
  return violations;
}
