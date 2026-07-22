// Verification support for the verification-economy scenario "A step that runs
// pinned at its declared read ceiling reds the check" (@logic @invariant).
//
// The sibling check in features/support/interactive-reads.ts proves every
// interactive read DECLARES an ending signal. Declaring one is not running on
// one: a `readUntil` marker that never appears, or a `runCli` whose process
// never produces the output the caller waits for, still ends on the fixed
// `timeoutMs`. The declaration reads as a budget; the run pays it in full.
//
// The evidence is already in the wake. Every tier command writes its message
// stream, which carries each step's measured duration alongside the step
// definition's source reference. A step whose measured duration sits at its
// declared ceiling was ended by the timer, not by its signal: the ceiling is a
// failure bound, so a step reaching it is the failure, arriving as a green.
//
// This file excludes itself from the scan, so its own example literals are
// never self-flagged.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { REPO_ROOT } from "./repo-root.ts";

/**
 * A read ceiling declared in the verification support: the `timeoutMs` a call
 * carries, attributed to the step definition whose registration encloses it.
 */
export interface DeclaredCeiling {
  /** Repo-relative step-definition file. */
  file: string;
  /** Start line of the enclosing `Given`/`When`/`Then` registration. */
  line: number;
  ceilingMs: number;
  /** Line of the `timeoutMs` declaration itself, for the report. */
  declaredAtLine: number;
}

/** A step's measured duration, as a tier run wrote it into the wake. */
export interface StepMeasurement {
  file: string;
  line: number;
  pattern: string;
  durationMs: number;
  /** The wake record the measurement came from. */
  recordPath: string;
}

/** A step that ran pinned at its declared ceiling. */
export interface PinnedReadFinding {
  file: string;
  line: number;
  pattern: string;
  ceilingMs: number;
  durationMs: number;
  message: string;
}

/**
 * A measured duration at or above this fraction of its declared ceiling was
 * ended by the timer rather than by its signal. A read that ends on an observed
 * signal returns when the signal fires, which is not a hair under the failure
 * bound; the margin absorbs scheduler jitter without licensing a pinned read.
 */
const PINNED_FRACTION = 0.95;

const CHECKER_FILE = "features/support/read-ceilings.ts";
const VERIFICATION_DIRS = ["features/support/", "features/step_definitions/"];
const REGISTRARS = new Set(["Given", "When", "Then"]);

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

/** The numeric value a ceiling initializer carries, when it carries one that
 * can be read without executing the file: a literal, or an identifier bound to
 * a literal in the same source. */
function ceilingValue(initializer: Node): number | undefined {
  const literal = initializer.asKind(SyntaxKind.NumericLiteral);
  if (literal) return literal.getLiteralValue();
  if (Node.isIdentifier(initializer)) {
    for (const definition of initializer.getDefinitionNodes()) {
      if (!Node.isVariableDeclaration(definition)) continue;
      const bound = definition.getInitializer();
      if (!bound) continue;
      const boundLiteral = bound.asKind(SyntaxKind.NumericLiteral);
      if (boundLiteral) return boundLiteral.getLiteralValue();
    }
  }
  return undefined;
}

/** The `Given`/`When`/`Then` registration enclosing a node, when one does. */
function enclosingRegistration(node: Node): Node | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression();
      if (Node.isIdentifier(callee) && REGISTRARS.has(callee.getText())) return current;
    }
    current = current.getParent();
  }
  return undefined;
}

/**
 * Every read ceiling the verification support declares, attributed to the step
 * definition that owns it. A `timeoutMs` outside any step registration, such as
 * one in shared support, carries no step to join against and is not returned.
 */
export function declaredReadCeilings(): DeclaredCeiling[] {
  const ceilings: DeclaredCeiling[] = [];
  for (const source of project().getSourceFiles()) {
    const file = repoRelative(source.getFilePath());
    if (!VERIFICATION_DIRS.some((dir) => file.startsWith(dir))) continue;
    if (file === CHECKER_FILE) continue;
    for (const property of source.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (property.getName() !== "timeoutMs") continue;
      const initializer = property.getInitializer();
      if (!initializer) continue;
      const ceilingMs = ceilingValue(initializer);
      if (ceilingMs === undefined || ceilingMs <= 0) continue;
      const registration = enclosingRegistration(property);
      if (!registration) continue;
      ceilings.push({
        file,
        line: registration.getStartLineNumber(),
        ceilingMs,
        declaredAtLine: property.getStartLineNumber(),
      });
    }
  }
  return ceilings;
}

interface WakeStepDefinition {
  uri: string;
  line: number;
  pattern: string;
}

/**
 * Every step measurement a wake record carries: each step's measured duration,
 * joined through the run's own test cases to the step definition that ran it.
 */
export function readStepMeasurements(recordPath: string): StepMeasurement[] {
  if (!existsSync(recordPath)) return [];
  const definitions = new Map<string, WakeStepDefinition>();
  const stepDefinitionByTestStep = new Map<string, string>();
  const measurements: StepMeasurement[] = [];
  const finished: Array<{ testStepId: string; durationMs: number }> = [];
  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let message: {
      stepDefinition?: {
        id: string;
        pattern?: { source?: string };
        sourceReference?: { uri?: string; location?: { line?: number } };
      };
      testCase?: {
        testSteps?: Array<{ id: string; stepDefinitionIds?: string[] }>;
      };
      testStepFinished?: {
        testStepId: string;
        testStepResult?: { duration?: { seconds: number; nanos: number } };
      };
    };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const definition = message.stepDefinition;
    if (definition?.sourceReference?.uri && definition.sourceReference.location?.line) {
      definitions.set(definition.id, {
        uri: definition.sourceReference.uri,
        line: definition.sourceReference.location.line,
        pattern: definition.pattern?.source ?? "",
      });
    }
    for (const step of message.testCase?.testSteps ?? []) {
      // A step matching exactly one definition is attributable; an ambiguous
      // match carries no single ceiling to judge.
      const ids = step.stepDefinitionIds ?? [];
      if (ids.length === 1) stepDefinitionByTestStep.set(step.id, ids[0]!);
    }
    const step = message.testStepFinished;
    const duration = step?.testStepResult?.duration;
    if (step && duration) {
      finished.push({
        testStepId: step.testStepId,
        durationMs: duration.seconds * 1000 + duration.nanos / 1_000_000,
      });
    }
  }
  for (const { testStepId, durationMs } of finished) {
    const definitionId = stepDefinitionByTestStep.get(testStepId);
    if (!definitionId) continue;
    const definition = definitions.get(definitionId);
    if (!definition) continue;
    measurements.push({
      file: definition.uri,
      line: definition.line,
      pattern: definition.pattern,
      durationMs,
      recordPath,
    });
  }
  return measurements;
}

/**
 * Join each measured duration against its step's declared ceiling. A step whose
 * measured duration reaches the ceiling ran on the timer, not on its signal.
 * Only the worst measurement per step is reported: one finding per pinned step.
 */
export function pinnedReadFindings(
  ceilings: readonly DeclaredCeiling[],
  measurements: readonly StepMeasurement[],
): PinnedReadFinding[] {
  const ceilingByStep = new Map<string, DeclaredCeiling>();
  for (const ceiling of ceilings) {
    const key = `${ceiling.file}:${ceiling.line}`;
    // A step declaring several ceilings is judged against its smallest: that is
    // the first bound a pinned read reaches.
    const current = ceilingByStep.get(key);
    if (!current || ceiling.ceilingMs < current.ceilingMs) ceilingByStep.set(key, ceiling);
  }
  const worst = new Map<string, PinnedReadFinding>();
  for (const measurement of measurements) {
    const key = `${measurement.file}:${measurement.line}`;
    const ceiling = ceilingByStep.get(key);
    if (!ceiling) continue;
    if (measurement.durationMs < ceiling.ceilingMs * PINNED_FRACTION) continue;
    const finding: PinnedReadFinding = {
      file: measurement.file,
      line: measurement.line,
      pattern: measurement.pattern,
      ceilingMs: ceiling.ceilingMs,
      durationMs: measurement.durationMs,
      message:
        `${measurement.file}:${measurement.line} "${measurement.pattern}" ran ` +
        `${(measurement.durationMs / 1000).toFixed(1)}s against its declared ` +
        `${(ceiling.ceilingMs / 1000).toFixed(1)}s read ceiling: the read ended on ` +
        `the timer, not on the signal it declared`,
    };
    const current = worst.get(key);
    if (!current || finding.durationMs > current.durationMs) worst.set(key, finding);
  }
  return [...worst.values()];
}
