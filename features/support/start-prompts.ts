// The prompt sequence an interactive `jolly start` renders, and the markers the
// PTY driver waits for before feeding each answer.
//
// A scripted interactive run answers prompts in order. Feeding each answer on a
// fixed delay guesses how long the prompt takes to arrive: the guess is paid in
// full on every run, and paid again as flake when it guesses short. Feeding each
// answer when its prompt is OBSERVED costs what the prompt actually costs
// (feature verification-economy).
//
// Which prompts render is decided by the run's own inputs, so the sequence is
// derived from them rather than assumed:
//   - the organization picker renders only when the token resolves more than one,
//   - the reuse-or-create store picker renders only when the org holds
//     environments,
//   - the environment-name prompt renders only when no store is configured yet,
//   - the storefront project directory always renders, and
//   - the proceed confirmation renders on a real run; `--dry-run` returns its
//     preview before the gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

const CLI_MESSAGES_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");

/**
 * A marker is the leading, unwrapped part of the catalog message the prompt
 * renders: clack wraps its box at the terminal width, so a marker that spans a
 * wrap point would never be observed as one substring. Each is checked against
 * the catalog at load, so copy drift reddens here rather than hanging a run.
 */
const MARKERS: Record<string, { key: string; marker: string }> = {
  organization: { key: "start.prompt.organization", marker: "Choose the Saleor organization" },
  store: { key: "start.prompt.store", marker: "Create a new store" },
  envName: { key: "start.prompt.envName", marker: "Environment name" },
  projectDir: { key: "start.prompt.projectDir", marker: "Storefront project directory" },
  proceed: { key: "start.proceed", marker: "Build your store now?" },
};

function catalogMarker(name: keyof typeof MARKERS): string {
  const catalog = JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<
    string,
    string
  >;
  const { key, marker } = MARKERS[name]!;
  const message = catalog[key];
  if (typeof message !== "string" || !message.includes(marker)) {
    throw new Error(
      `the prompt marker "${marker}" is no longer part of the catalog message "${key}" (${String(message)}) — ` +
        `update the marker so the PTY driver still observes the prompt it answers`,
    );
  }
  return marker;
}

export interface StartRunShape {
  /** The argv the run is driven with, `start` first. */
  argv: string[];
  /** The project directory whose `.env` decides whether a store is configured. */
  cwd: string;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const entry = argv.find((argument) => argument.startsWith(`${flag}=`));
  return entry === undefined ? undefined : entry.slice(flag.length + 1);
}

function storeConfigured(cwd: string): boolean {
  try {
    return readFileSync(join(cwd, ".env"), "utf8").includes(
      "NEXT_PUBLIC_SALEOR_API_URL=",
    );
  } catch {
    return false;
  }
}

/**
 * The ordered prompt markers an interactive `jolly start` renders for this run:
 * one marker per answer the run must feed.
 */
export function startPromptSequence(shape: StartRunShape): string[] {
  const { argv, cwd } = shape;
  const sequence: string[] = [];

  // @exceptional-double: a Cloud token resolving more than one organization
  // cannot be produced on demand from the single-org test account, so the
  // multi-org list is injected at the caller. The driver reads that same
  // injected list here because it decides whether the org picker renders, and
  // therefore whether an answer must be fed for it.
  const organizations = flagValue(argv, "--mock-organizations");
  if (organizations !== undefined && organizations.includes(",")) {
    sequence.push(catalogMarker("organization"));
  }

  const configured = storeConfigured(cwd);
  if (!configured) {
    const environments = flagValue(argv, "--mock-environments");
    if (environments) sequence.push(catalogMarker("store"));
    // Accepting the picker's default creates a new store, so the environment
    // name is still asked.
    sequence.push(catalogMarker("envName"));
  }

  sequence.push(catalogMarker("projectDir"));

  // `--dry-run` returns its preview before the proceed gate, so no confirmation
  // renders.
  if (!argv.includes("--dry-run")) sequence.push(catalogMarker("proceed"));

  return sequence;
}

/** One Enter per prompt in the sequence: accept every pre-filled default. */
export function acceptEveryPrompt(sequence: string[]): string[] {
  return sequence.map(() => "\r");
}
