// Verification support for feature 026's @logic @invariant scenario "Every
// composition-ground spy serves only scenarios tagged @composition".
//
// The composition ground admits a spy for internal composition or wiring —
// launch order, await joins, seam hand-off — because the seams it wires are
// proven for real at their own seams (feature 026 Rule "Live-by-design
// conformance"). The lane stays legible only while every spy justified on that
// ground serves scenarios that DECLARE the lane with the @composition tag: a
// composition spy serving an untagged scenario is a service-effect double
// hiding under the composition licence.
//
// The check joins two enumerations:
//   - composition-ground spies: every `@exceptional-double` annotation in the
//     verification layer whose named condition is the composition/wiring
//     ground, located to the step-definition registration it justifies, and
//   - the executable scenarios (cucumber's dry-run pickle stream), each with
//     its tags and resolved step texts.
// A spy serves a scenario when one of the scenario's steps binds the spy's
// step-definition pattern.
//
// This file excludes itself from the scan so its own literals are never
// self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { InjectedSource, Violation } from "./module-conformance.ts";

const CHECKER_FILE = "features/support/composition-lane-conformance.ts";
const VERIFICATION_DIRS = ["features/support/", "features/step_definitions/"];
/** The composition/wiring ground, as named in a justification. */
const COMPOSITION_GROUND = /\bcomposition\b|\bwiring\b|call order|launch order|seams? in order|await join/i;
const ANNOTATION = /@exceptional-double:?\s*(.*)$/;
const STEP_REGISTRARS = new Set(["Given", "When", "Then"]);

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

interface SpyPattern {
  kind: "string" | "regex";
  source: string;
  flags?: string;
}

export interface CompositionSpy {
  file: string;
  line: number;
  justification: string;
  /** The step-definition pattern the spy's step registers. */
  pattern: SpyPattern;
}

export interface PickleInfo {
  uri: string;
  name: string;
  tags: string[];
  steps: string[];
}

interface StepRegistration {
  line: number;
  pattern: SpyPattern;
}

function stepRegistrations(source: ReturnType<Project["getSourceFiles"]>[number]): StepRegistration[] {
  const registrations: StepRegistration[] = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee) || !STEP_REGISTRARS.has(callee.getText())) continue;
    const first = call.getArguments()[0];
    if (!first) continue;
    let pattern: SpyPattern | undefined;
    if (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) {
      pattern = { kind: "string", source: first.getLiteralValue() };
    } else if (Node.isRegularExpressionLiteral(first)) {
      const text = first.getText();
      const closing = text.lastIndexOf("/");
      pattern = {
        kind: "regex",
        source: text.slice(1, closing),
        flags: text.slice(closing + 1),
      };
    }
    if (!pattern) continue;
    registrations.push({ line: call.getStartLineNumber(), pattern });
  }
  return registrations;
}

/**
 * Every composition-ground spy in the verification layer: an
 * `@exceptional-double` annotation naming the composition/wiring ground,
 * located to the nearest step registration at or after it (or the registration
 * that encloses it). The ground is read from the annotation line plus up to
 * four following comment lines, because a multi-line justification names the
 * ground where its sentence lands.
 */
export function enumerateCompositionSpies(
  injected: InjectedSource[] = [],
): CompositionSpy[] {
  const spies: CompositionSpy[] = [];
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
      const text = source.getFullText();
      if (!text.includes("@exceptional-double")) continue;
      const lines = text.split("\n");
      const registrations = stepRegistrations(source);

      lines.forEach((raw, index) => {
        const annotation = ANNOTATION.exec(raw);
        if (!annotation) return;
        const justification = [
          annotation[1] ?? "",
          ...lines
            .slice(index + 1, index + 5)
            .filter((following) => /^\s*(\/\/|\*)/.test(following)),
        ].join(" ");
        if (!COMPOSITION_GROUND.test(justification)) return;
        const line = index + 1;
        const following = registrations
          .filter((registration) => registration.line >= line)
          .sort((a, b) => a.line - b.line)[0];
        const registration =
          following && following.line - line <= 60
            ? following
            : registrations
                .filter((candidate) => candidate.line <= line)
                .sort((a, b) => b.line - a.line)[0];
        if (!registration) return;
        spies.push({
          file,
          line,
          justification: justification.trim(),
          pattern: registration.pattern,
        });
      });
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return spies;
}

/**
 * The executable scenarios: cucumber's dry-run pickle stream over every tier
 * (the tag-free `all` profile), excluding `@captain` / `@shipwright` exactly as
 * every derived verification command does.
 */
export function collectExecutablePickles(): PickleInfo[] {
  const result = spawnSync(
    "npx",
    [
      "cucumber-js",
      "-p",
      "all",
      "--dry-run",
      "--format",
      "message",
      "--tags",
      "not @captain and not @shipwright",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
    throw new Error(
      `the pickle dry-run produced no message stream (status ${result.status}); stderr:\n${result.stderr ?? ""}`,
    );
  }
  const pickles: PickleInfo[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.trim() === "") continue;
    let message: {
      pickle?: {
        uri: string;
        name: string;
        tags?: Array<{ name: string }>;
        steps?: Array<{ text: string }>;
      };
    };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const pickle = message.pickle;
    if (!pickle) continue;
    pickles.push({
      uri: pickle.uri,
      name: pickle.name,
      tags: (pickle.tags ?? []).map((tag) => tag.name),
      steps: (pickle.steps ?? []).map((step) => step.text),
    });
  }
  return pickles;
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a pickle step text binds the pattern. Cucumber-expression
 * parameters are matched loosely; a literal pattern matches by equality. */
function patternMatchesStep(pattern: SpyPattern, stepText: string): boolean {
  if (pattern.kind === "regex") {
    try {
      return new RegExp(pattern.source, pattern.flags).test(stepText);
    } catch {
      return false;
    }
  }
  if (!pattern.source.includes("{")) return pattern.source === stepText;
  const converted = escapeRegExp(pattern.source)
    .replace(/\\\{string\\\}/g, '"[^"]*"')
    .replace(/\\\{int\\\}/g, "-?\\d+")
    .replace(/\\\{float\\\}/g, "-?[\\d.]+")
    .replace(/\\\{word\\\}/g, "\\S+")
    .replace(/\\\{\\\}/g, ".*");
  try {
    return new RegExp(`^${converted}$`).test(stepText);
  } catch {
    return false;
  }
}

/**
 * Every composition-ground spy serving a scenario that does not declare the
 * lane: the violation names the spy (file, line, pattern) and the scenario.
 */
export function findCompositionLaneViolations(
  spies: CompositionSpy[],
  pickles: PickleInfo[],
  requiredTag: string,
): Violation[] {
  const violations: Violation[] = [];
  for (const spy of spies) {
    for (const pickle of pickles) {
      if (pickle.tags.includes(requiredTag)) continue;
      if (!pickle.steps.some((step) => patternMatchesStep(spy.pattern, step))) continue;
      violations.push({
        file: spy.file,
        line: spy.line,
        message:
          `${spy.file}:${spy.line} composition-ground spy (pattern ${JSON.stringify(
            spy.pattern.source,
          )}) serves scenario "${pickle.name}" (${pickle.uri}), which is not tagged ${requiredTag}`,
      });
    }
  }
  return violations;
}
