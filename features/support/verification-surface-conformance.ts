// Verification support for the methodology-conformance scenario "Every
// verification surface in the tree is run by a configured tier command"
// (@logic @invariant).
//
// A test surface no configured tier command reaches is verification nobody
// runs: it stays green-looking while proving nothing (the gap that let the
// `tests/` node:test unit suite sit outside every RIGGING.md command). This
// check enumerates the tree's test surfaces and RIGGING.md's `## Commands`
// entries, resolves each command's `npm run <script>` indirection through
// package.json, and reports every surface no command reaches.
//
// Reach is judged per runner mechanism:
//   - the cucumber specs surface (a directory of `.feature` files) is run by
//     any command that invokes `cucumber-js` (cucumber's configured default
//     paths cover the specs directory), and
//   - a unit-suite surface (a directory of `*.test.*` / `*.spec.*` files) is
//     run by a command whose resolved text names that directory.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface TestSurface {
  /** Repo-root-relative directory, with a trailing slash, e.g. "tests/". */
  dir: string;
  kind: "cucumber" | "unit";
}

export interface ConfiguredCommand {
  key: string;
  command: string;
  /** The command with every `npm run <script>` / `npm test` expanded. */
  resolved: string;
}

export interface SurfaceViolation {
  surface: TestSurface;
  message: string;
}

/** A RIGGING.md value line: `- <key>: \`<command>\`` with optional prose. */
const VALUE_LINE = /^- ([a-z-]+): `(.+?)`/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every `## Commands` entry, with npm-script indirection resolved. */
export function readConfiguredCommands(
  riggingText: string,
  manifestText: string,
): ConfiguredCommand[] {
  const scripts =
    (JSON.parse(manifestText) as { scripts?: Record<string, string> }).scripts ??
    {};
  const commands: ConfiguredCommand[] = [];
  let inCommands = false;
  for (const line of riggingText.split("\n")) {
    if (line.startsWith("## ")) {
      inCommands = line.trim() === "## Commands";
      continue;
    }
    if (!inCommands) continue;
    const match = VALUE_LINE.exec(line.trim());
    if (!match) continue;
    const [, key, command] = match as unknown as [string, string, string];
    let resolved = command;
    for (const scriptMatch of command.matchAll(
      /\bnpm (?:run |run-script )([A-Za-z0-9:_-]+)|\bnpm (test|t)\b/g,
    )) {
      const script = scriptMatch[1] ?? "test";
      const body = scripts[script];
      if (body) resolved += ` ${body}`;
    }
    commands.push({ key, command, resolved });
  }
  return commands;
}

function containsFeatureFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith(".feature"));
  } catch {
    return false;
  }
}

function containsTestFiles(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && TEST_FILE.test(entry.name)) return true;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      if (containsTestFiles(join(dir, entry.name))) return true;
    }
  }
  return false;
}

/**
 * The tree's test surfaces: the cucumber specs directory, plus every top-level
 * directory holding `*.test.*` / `*.spec.*` files (the node:test unit suite,
 * and any suite added later).
 */
export function enumerateTestSurfaces(specsDir: string): TestSurface[] {
  const surfaces: TestSurface[] = [];
  if (containsFeatureFiles(join(REPO_ROOT, specsDir))) {
    surfaces.push({ dir: specsDir.endsWith("/") ? specsDir : `${specsDir}/`, kind: "cucumber" });
  }
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${entry.name}/`;
    if (rel === (specsDir.endsWith("/") ? specsDir : `${specsDir}/`)) continue;
    if (!containsTestFiles(join(REPO_ROOT, entry.name))) continue;
    surfaces.push({ dir: rel, kind: "unit" });
  }
  return surfaces;
}

/** Whether one configured command runs the surface, per its runner mechanism. */
export function commandReaches(
  surface: TestSurface,
  command: ConfiguredCommand,
): boolean {
  if (surface.kind === "cucumber") {
    return /\bcucumber-js\b/.test(command.resolved);
  }
  return command.resolved.includes(surface.dir);
}

/** Every test surface no configured tier command reaches. */
export function findUnreachedSurfaces(
  surfaces: TestSurface[],
  commands: ConfiguredCommand[],
): SurfaceViolation[] {
  return surfaces
    .filter((surface) => !commands.some((command) => commandReaches(surface, command)))
    .map((surface) => ({
      surface,
      message:
        `the ${surface.kind} test surface "${surface.dir}" is run by no configured ` +
        `RIGGING.md command — its verification never executes`,
    }));
}
