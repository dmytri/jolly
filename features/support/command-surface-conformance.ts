// Structural conformance checker for Jolly's top-level command surface
// (feature command-surface-consistency, @logic @property).
//
// A command name is written in four independent places: the shell completion
// registration, the help output's command data, the dispatch switch, and the
// unknown-command remediation prose in the message catalog. Adding, renaming,
// or splitting a command means editing all four, and nothing joins them. This
// checker reads each site and compares it against the surface Jolly declares,
// so a command present in one site and absent from another is reported rather
// than discovered by a human reading four files.
//
// The declared surface is the anchor: one exported declaration every site
// derives from. Where no such declaration exists, that absence is itself the
// violation, because four hand-maintained copies cannot be joined to anything.
import { Node, Project, SyntaxKind } from "ts-morph";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

/** The name of the single exported declaration every command site derives from. */
export const DECLARED_SURFACE = "COMMAND_SURFACE";

const CATALOG_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");
const REMEDIATION_KEY = "cli.error.unknownCommand.remediation";

/** One of the four places a command name is written. */
export interface CommandSite {
  /** A human-readable name for the site, used in the violation message. */
  name: string;
  /** Where the site lives, for the report. */
  file: string;
  /** The command names the site carries, or undefined when it could not be read. */
  commands?: string[];
}

export interface SurfaceViolation {
  /** The command the sites disagree about, or "(surface)" for a missing anchor. */
  command: string;
  /** The site the command is missing from. */
  site: string;
  message: string;
}

let cachedProject: Project | undefined;

function project(): Project {
  cachedProject ??= new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
  });
  return cachedProject;
}

function sourceFile(relativePath: string) {
  return project().getSourceFile(join(REPO_ROOT, relativePath));
}

/** Every string literal an array-literal node carries, flattening tuples. */
function stringsIn(node: Node): string[] {
  const found: string[] = [];
  for (const literal of node.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    found.push(literal.getLiteralText());
  }
  if (Node.isArrayLiteralExpression(node)) {
    // A tuple site such as `[name, description]` carries the name first, so
    // take only the leading literal of each element.
    const elements = node.getElements();
    if (elements.every((element) => Node.isArrayLiteralExpression(element))) {
      return elements
        .map((element) => element.getDescendantsOfKind(SyntaxKind.StringLiteral)[0])
        .filter((literal) => literal !== undefined)
        .map((literal) => literal.getLiteralText());
    }
  }
  return found;
}

/**
 * The surface Jolly declares: the exported `COMMAND_SURFACE` declaration, read
 * as the command names it carries. Undefined when no such declaration exists,
 * which is itself the violation the check reports.
 */
export function declaredSurface(): string[] | undefined {
  for (const source of project().getSourceFiles()) {
    const file = source.getFilePath();
    if (!file.includes("/src/")) continue;
    const declaration = source.getVariableDeclaration(DECLARED_SURFACE);
    if (!declaration) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const commands = stringsIn(initializer);
    if (commands.length > 0) return commands;
  }
  return undefined;
}

/** The completion registration: the command list `completion.ts` registers. */
function completionSite(): CommandSite {
  const site: CommandSite = {
    name: "the shell completion registration",
    file: "src/lib/completion.ts",
  };
  const source = sourceFile(site.file);
  const declaration = source?.getVariableDeclaration("COMMANDS");
  const initializer = declaration?.getInitializer();
  if (initializer) site.commands = stringsIn(initializer);
  return site;
}

/** The help output's command data: the `commands` array the help envelope carries. */
function helpSite(): CommandSite {
  const site: CommandSite = {
    name: "the help output's command data",
    file: "src/index.ts",
  };
  const source = sourceFile(site.file);
  if (!source) return site;
  for (const property of source.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (property.getName().replace(/^["']|["']$/g, "") !== "commands") continue;
    const initializer = property.getInitializer();
    if (!initializer || !Node.isArrayLiteralExpression(initializer)) continue;
    const commands = stringsIn(initializer);
    // The help envelope is the only `commands:` array of plain command names.
    if (commands.length > 0) {
      site.commands = commands;
      break;
    }
  }
  return site;
}

/** The dispatch switch: the case labels the top-level command switch carries. */
function dispatchSite(): CommandSite {
  const site: CommandSite = {
    name: "the dispatch switch",
    file: "src/index.ts",
  };
  const source = sourceFile(site.file);
  if (!source) return site;
  for (const statement of source.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    // The top-level dispatch is the switch on the parsed command token.
    if (statement.getExpression().getText() !== "cmd") continue;
    const commands: string[] = [];
    for (const clause of statement.getClauses()) {
      if (!Node.isCaseClause(clause)) continue;
      const label = clause.getExpression();
      if (Node.isStringLiteral(label)) commands.push(label.getLiteralText());
    }
    if (commands.length > 0) {
      site.commands = commands;
      break;
    }
  }
  return site;
}

/** The unknown-command remediation: the command list the catalog prose names. */
function remediationSite(): CommandSite {
  const site: CommandSite = {
    name: "the unknown-command remediation",
    file: "assets/messages/cli.json",
  };
  let catalog: Record<string, string>;
  try {
    catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Record<string, string>;
  } catch {
    return site;
  }
  const remediation = catalog[REMEDIATION_KEY];
  if (typeof remediation !== "string") return site;
  const match = /Supported commands:\s*(.+?)\./.exec(remediation);
  if (!match) return site;
  site.commands = match[1]!
    .split(/,\s*/)
    .map((command) => command.trim())
    .filter(Boolean);
  return site;
}

/** The four sites a command name is written in today. */
export function commandSites(): CommandSite[] {
  return [completionSite(), helpSite(), dispatchSite(), remediationSite()];
}

/**
 * The join: every site's command set against the declared surface. A command in
 * the surface and absent from a site, or in a site and absent from the surface,
 * is reported naming the command and the site missing it.
 */
export function commandSurfaceViolations(
  surface: string[] | undefined,
  sites: CommandSite[],
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];
  if (!surface) {
    violations.push({
      command: "(surface)",
      site: `the declared surface \`${DECLARED_SURFACE}\``,
      message:
        `no exported \`${DECLARED_SURFACE}\` declaration exists in src/, so the ` +
        `four command sites derive from nothing and cannot be joined`,
    });
    return violations;
  }
  const declared = new Set(surface);
  for (const site of sites) {
    if (!site.commands) {
      violations.push({
        command: "(site)",
        site: site.name,
        message: `${site.name} (${site.file}) could not be read as a command set`,
      });
      continue;
    }
    const present = new Set(site.commands);
    for (const command of declared) {
      if (present.has(command)) continue;
      violations.push({
        command,
        site: site.name,
        message: `the command "${command}" is declared in \`${DECLARED_SURFACE}\` and absent from ${site.name} (${site.file})`,
      });
    }
    for (const command of present) {
      if (declared.has(command)) continue;
      violations.push({
        command,
        site: site.name,
        message: `the command "${command}" appears in ${site.name} (${site.file}) and is absent from \`${DECLARED_SURFACE}\``,
      });
    }
  }
  return violations;
}
