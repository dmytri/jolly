// Verification support for the verification-economy scenario "An interactive
// scenario reads the output it asserts on, never whatever a timer happened to
// catch" (@logic @invariant).
//
// The PTY driver (features/support/pty.ts) ends its read one of two ways. It can
// end on an observed signal — the child exiting, or every `readUntil` marker (the
// output the caller asserts on) appearing in the terminal. Or it can end on the
// `timeoutMs` ceiling, returning whatever the terminal happened to have produced
// by then. A read ended by the timer is paid in full on every run, and what it
// captures is what the timer caught rather than what the scenario asserts on.
//
// This check enumerates every place the verification layer reads an interactive
// terminal and reports any read that does not declare its ending signal.
//
// This file excludes itself from the scan, so its own example literals are never
// self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface ReadViolation {
  file: string;
  line: number;
  message: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

const PTY_ENTRY = "runUnderPty";
const CHECKER_FILE = "features/support/interactive-reads.ts";
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

function propertyValue(literal: Node, name: string): Node | undefined {
  const object = literal.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!object) return undefined;
  for (const property of object.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === name) {
      return property.getInitializer();
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === name) {
      return property;
    }
  }
  return undefined;
}

/**
 * Timer-ended reads across the verification layer: every `runUnderPty` call must
 * declare what ends its read — `"exit"` when the child completes on its own, or
 * the `readUntil` markers naming the output the caller asserts on. A call that
 * declares neither is read until the `timeoutMs` ceiling fires and returns
 * whatever the terminal had produced by then.
 */
export function findTimerEndedReads(injected: InjectedSource[] = []): ReadViolation[] {
  const violations: ReadViolation[] = [];
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
        const callee = call.getExpression();
        if (!Node.isIdentifier(callee) || callee.getText() !== PTY_ENTRY) continue;
        const options = call.getArguments()[0];
        if (!options) continue;
        const line = call.getStartLineNumber();

        const readUntil = propertyValue(options, "readUntil");
        if (!readUntil) {
          violations.push({
            file,
            line,
            message:
              `${file}:${line} declares no \`readUntil\` — its read is ended by the fixed \`timeoutMs\`, ` +
              `returning whatever the terminal had produced by then rather than the output it asserts on`,
          });
          continue;
        }
        if (Node.isStringLiteral(readUntil) && readUntil.getLiteralValue() === "exit") {
          continue;
        }
        const markers = readUntil.asKind(SyntaxKind.ArrayLiteralExpression)?.getElements();
        // A value that is neither "exit" nor an array literal (a variable, a call)
        // carries its markers elsewhere; the type keeps it honest.
        if (!markers) continue;
        if (markers.length === 0) {
          violations.push({
            file,
            line,
            message:
              `${file}:${line} declares an empty \`readUntil\` — no output ends the read, ` +
              `so it runs to the fixed \`timeoutMs\` and returns whatever the terminal caught`,
          });
          continue;
        }
        markers.forEach((marker, index) => {
          const empty =
            marker.getKind() === SyntaxKind.NullKeyword ||
            marker.getText() === "undefined" ||
            (Node.isStringLiteral(marker) && marker.getLiteralValue().trim() === "");
          if (!empty) return;
          violations.push({
            file,
            line: marker.getStartLineNumber(),
            message:
              `${file}:${marker.getStartLineNumber()} \`readUntil\` marker ${index} is empty, ` +
              `so no observed output ends the read and the fixed \`timeoutMs\` does`,
          });
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return violations;
}
