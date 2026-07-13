// Verification support for the verification-economy scenario "An interactive
// scenario waits for the prompt it is answering, never a guessed delay"
// (@logic @invariant).
//
// The PTY driver (features/support/pty.ts) can feed a scripted input chunk two
// ways: after its `waitFor` marker is observed in the terminal output, or on
// the `inputDelayMs` cadence. The cadence is a guess: it is paid in full on
// every run, and it is paid again as flake when it guesses short. This check
// enumerates every place the verification layer feeds an interactive terminal
// and reports any chunk whose wait is ended by a delay rather than by the
// prompt it answers.
//
// This file excludes itself from the scan, so its own example literals are
// never self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

export interface WaitViolation {
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
const CHECKER_FILE = "features/support/interactive-waits.ts";
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

function propertyValue(
  literal: Node,
  name: string,
): { node: Node; shorthand: boolean } | undefined {
  const object = literal.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!object) return undefined;
  for (const property of object.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === name) {
      const initializer = property.getInitializer();
      if (initializer) return { node: initializer, shorthand: false };
    }
    if (
      Node.isShorthandPropertyAssignment(property) &&
      property.getName() === name
    ) {
      return { node: property, shorthand: true };
    }
  }
  return undefined;
}

/** Elements of an array literal, or undefined when the value is not one. */
function arrayElements(node: Node): Node[] | undefined {
  const array = node.asKind(SyntaxKind.ArrayLiteralExpression);
  return array ? array.getElements() : undefined;
}

/**
 * Guessed-delay violations across the verification layer: every `runUnderPty`
 * call that feeds input chunks must end each wait on the prompt it observed,
 * declared as a `waitFor` marker for that chunk. A call that feeds no input
 * waits for nothing and is not reported.
 */
export function findGuessedDelayWaits(
  injected: InjectedSource[] = [],
): WaitViolation[] {
  const violations: WaitViolation[] = [];
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
        const inputs = propertyValue(options, "inputs");
        if (!inputs) continue;
        const line = call.getStartLineNumber();

        const inputElements = inputs.shorthand
          ? undefined
          : arrayElements(inputs.node);
        // A call that feeds no chunk performs no wait.
        if (inputElements && inputElements.length === 0) continue;

        const waitFor = propertyValue(options, "waitFor");
        if (!waitFor) {
          violations.push({
            file,
            line,
            message:
              `${file}:${line} feeds interactive input on the \`inputDelayMs\` cadence with no \`waitFor\` markers — ` +
              `each chunk is sent on a guessed delay rather than on the prompt it answers`,
          });
          continue;
        }
        const markers = waitFor.shorthand ? undefined : arrayElements(waitFor.node);
        if (!markers) continue;
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
              `${file}:${marker.getStartLineNumber()} chunk ${index} carries an empty \`waitFor\` marker, ` +
              `so its wait falls back to the guessed \`inputDelayMs\` cadence`,
          });
        });
        if (inputElements && markers.length < inputElements.length) {
          violations.push({
            file,
            line,
            message:
              `${file}:${line} feeds ${inputElements.length} input chunks but declares ${markers.length} \`waitFor\` markers — ` +
              `the unmarked chunks are sent on a guessed delay`,
          });
        }
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return violations;
}
