// Golden captures for the @eval tier (feature 025 "Live agent, golden-captured
// services"; feature 026's golden-capture Rule).
//
// The @eval baseline-agent run is LIVE end to end, but the four expensive
// service effects Jolly's commands would produce — the Saleor Cloud environment
// creation, the storefront clone + install, the configurator deploy, and the
// Vercel deploy — are served from golden captures. Every capture is RECORDED
// MECHANICALLY at the sandbox tier's licensed shared-pipeline provisioning
// seams (the same `jolly` commands the licence Rule in feature
// verification-economy names), against the run-shared persistent resources:
//   - environment creation → the shared store the provisioner created through
//     the real `jolly create store --create-environment` (provision.ts); its
//     recorded domain stays LIVE because the shared store outlives runs.
//   - storefront clone + install → the prepared-storefront template built by
//     the real `git clone` + `npx pnpm install` (storefront-fixture.ts).
//   - Vercel deploy → the shared deployment produced by the real
//     `jolly deploy --yes --json` heal (deployed-storefront.ts), plus the real
//     Vercel CLI invocations that run observed (recorded by the sandbox PATH
//     shim, spend-ledger.ts) — replayed verbatim, never hand-authored.
//   - configurator deploy → no replay at all: the recipe was deployed onto the
//     shared store for real (recipe-on-shared.ts), so the eval's `jolly start`
//     resume path detects the store's REAL catalog state and needs no deploy.
// The capture store is COMMITTED with the verification support (this
// directory's `captures/eval-captures.json`), carries no secret, and each
// section names its source run. Re-verified against the live services at
// harbour; a capture whose endpoint stopped serving fails the eval loudly.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import { runId } from "./sandbox.ts";

/** The committed capture store (verification support, not wake). */
export const EVAL_CAPTURES_PATH = join(
  REPO_ROOT,
  "features",
  "support",
  "captures",
  "eval-captures.json",
);

/** The wake file the sandbox PATH shim records raw Vercel CLI observations to. */
export const VERCEL_OBS_PATH = join(
  REPO_ROOT,
  "coverage",
  "weather",
  "vercel-cli-observations.ndjson",
);

/** One recorded real Vercel CLI invocation, replayable by argv family. */
export interface VercelCapture {
  /** The real argv the licensed run passed to the Vercel CLI, verbatim. */
  argv: string[];
  exit: number;
  /** The real stdout the licensed run observed (what Jolly parses). */
  stdout: string;
}

export interface EvalCaptures {
  environmentCreation?: {
    /** The shared store's real Cloud environment name. */
    name: string;
    /** The shared store's real, still-serving `*.saleor.cloud` domain. */
    domain: string;
    dashboardUrl: string;
    sourceRun: string;
  };
  storefrontTemplate?: {
    /** The persistent template dir basename under tmpdir (storefront-fixture.ts). */
    dirname: string;
    sourceRun: string;
  };
  deployment?: {
    /** The shared deployment's real, still-serving production URL. */
    url: string;
    project: string;
    storeEndpoint: string;
    sourceRun: string;
  };
  vercel?: {
    /** Replayable records keyed by subcommand family (whoami, deploy, ...). */
    families: Record<string, VercelCapture>;
    sourceRun: string;
  };
}

export function readEvalCaptures(): EvalCaptures {
  try {
    return JSON.parse(readFileSync(EVAL_CAPTURES_PATH, "utf8")) as EvalCaptures;
  } catch {
    return {};
  }
}

function writeEvalCaptures(captures: EvalCaptures): void {
  // Stable top-level key order, full nested content (a replacer ARRAY would
  // filter keys at EVERY depth and empty the sections).
  const ordered = Object.fromEntries(
    Object.entries(captures).sort(([a], [b]) => a.localeCompare(b)),
  );
  const next = JSON.stringify(ordered, null, 2) + "\n";
  mkdirSync(join(REPO_ROOT, "features", "support", "captures"), { recursive: true });
  const current = existsSync(EVAL_CAPTURES_PATH)
    ? readFileSync(EVAL_CAPTURES_PATH, "utf8")
    : "";
  if (current !== next) writeFileSync(EVAL_CAPTURES_PATH, next);
}

/**
 * The Vercel CLI subcommand family of an argv (the tokens after the package
 * name): `["deploy", "--prod", ...]` → "deploy",
 * `["project", "protection", "disable", "--sso"]` → "project-protection-disable",
 * `["env", "add", ...]` → "env-add". Flags and free values are not part of the
 * family; the replay serves the record whose family matches.
 */
export function vercelFamilyOf(rest: string[]): string {
  const words: string[] = [];
  for (const token of rest) {
    if (token.startsWith("-")) continue;
    words.push(token);
    // Subcommand words come first; stop at the first value-looking token after
    // the known multi-word groups.
    if (words.length >= 3) break;
    if (!["project", "env"].includes(words[0]!)) break;
  }
  return words.join("-") || "(none)";
}

/**
 * Record the environment-creation capture from the shared store the licensed
 * provisioning created (or adopted). Called by provision.ts once per run, by
 * the one worker that provisioned. `sourceRun` names the run that CREATED the
 * store when known; an adopted marker predating source-run recording is named
 * as adopted by the current run.
 */
export function recordEnvironmentCreationCapture(marker: {
  name: string;
  url: string;
  sourceRun?: string;
}): void {
  let domain: string;
  try {
    domain = new URL(marker.url).host;
  } catch {
    return;
  }
  const captures = readEvalCaptures();
  const sourceRun =
    marker.sourceRun ??
    captures.environmentCreation?.sourceRun ??
    `licensed shared-pipeline provisioning of an earlier sandbox run (adopted by ${runId()})`;
  captures.environmentCreation = {
    name: marker.name,
    domain,
    dashboardUrl: `https://${domain}/dashboard/`,
    sourceRun,
  };
  writeEvalCaptures(captures);
}

/** Record the storefront-template capture (storefront-fixture.ts). */
export function recordStorefrontTemplateCapture(
  dirname: string,
  freshBuild: boolean,
): void {
  const captures = readEvalCaptures();
  if (!freshBuild && captures.storefrontTemplate?.dirname === dirname) return;
  captures.storefrontTemplate = {
    dirname,
    sourceRun: freshBuild
      ? runId()
      : `licensed shared-pipeline provisioning of an earlier sandbox run (adopted by ${runId()})`,
  };
  writeEvalCaptures(captures);
}

/**
 * Record the deployment capture and fold in the raw Vercel CLI observations the
 * sandbox PATH shim recorded for THIS run (a heal ran the real `jolly deploy`,
 * whose real `npx vercel ...` children the shim observed). Called by
 * deployed-storefront.ts after the shared deployment is provisioned or healed.
 * An adopt run has no fresh observations and leaves the recorded families as
 * they stand.
 */
export function recordDeploymentCapture(marker: {
  url: string;
  project: string;
  storeEndpoint: string;
  sourceRun?: string;
}): void {
  const captures = readEvalCaptures();
  captures.deployment = {
    url: marker.url,
    project: marker.project,
    storeEndpoint: marker.storeEndpoint,
    sourceRun:
      marker.sourceRun ??
      captures.deployment?.sourceRun ??
      `licensed shared-pipeline provisioning of an earlier sandbox run (adopted by ${runId()})`,
  };

  const observed = readVercelObservations(runId());
  if (Object.keys(observed).length > 0) {
    const families = { ...(captures.vercel?.families ?? {}) };
    // A run that performed the real deploy (a heal) re-recorded the whole
    // family set, so its observations refresh everything. A merely consuming
    // run (shared-deployment adopt: ls, whoami, link) only fills families the
    // store lacks: its observations of volatile listings differ every run and
    // would churn this committed file without adding coverage.
    const healed = "deploy" in observed;
    for (const [family, record] of Object.entries(observed)) {
      if (healed || !(family in families)) families[family] = record;
    }
    // Keep only stable, replayable families. A family keyed on a per-run
    // namespaced value (a scenario's own disposable project) can never be
    // asked for by the eval and would churn this committed file on every
    // sandbox run.
    for (const family of Object.keys(families)) {
      if (/-run-[a-z0-9]+-/.test(family)) delete families[family];
    }
    // Re-record only when the folded content differs: an observing run whose
    // families match what is already recorded leaves the committed file — and
    // its sourceRun provenance — untouched, so consuming runs do not churn it.
    const current = JSON.stringify(captures.vercel?.families ?? {});
    if (current !== JSON.stringify(families)) {
      captures.vercel = { families, sourceRun: runId() };
    }
  }
  writeEvalCaptures(captures);
}

/**
 * The raw Vercel CLI observations of one run, folded to one replayable record
 * per subcommand family (the last observation wins). Secrets never reach the
 * observation: the shim records argv, exit, and stdout only, and the Vercel
 * CLI prints no credential on those surfaces.
 */
export function readVercelObservations(
  run: string,
): Record<string, VercelCapture> {
  if (!existsSync(VERCEL_OBS_PATH)) return {};
  const families: Record<string, VercelCapture> = {};
  for (const line of readFileSync(VERCEL_OBS_PATH, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let entry: { run?: string; argv?: string[]; exit?: number; stdout?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.run !== run || !Array.isArray(entry.argv)) continue;
    let i = 0;
    while (i < entry.argv.length && entry.argv[i]!.startsWith("-")) i++;
    const rest = entry.argv.slice(i + 1);
    families[vercelFamilyOf(rest)] = {
      argv: entry.argv,
      exit: typeof entry.exit === "number" ? entry.exit : 1,
      stdout: (entry.stdout ?? "").slice(0, 8_000),
    };
  }
  return families;
}

/**
 * Assert the committed capture store carries every section the eval needs, and
 * name the recording route when one is missing: the captures are recorded by
 * the sandbox tier's licensed shared-pipeline provisioning, so the remedy is a
 * sandbox run (broad-sandbox / broad-sandbox-serial in RIGGING.md), with the
 * shared-deploy marker invalidated where the Vercel families were never
 * observed.
 */
export function assertCapturesComplete(captures: EvalCaptures): asserts captures is Required<EvalCaptures> {
  const missing: string[] = [];
  if (!captures.environmentCreation) missing.push("environmentCreation");
  if (!captures.storefrontTemplate) missing.push("storefrontTemplate");
  if (!captures.deployment) missing.push("deployment");
  const families = captures.vercel?.families ?? {};
  for (const family of ["whoami", "deploy"]) {
    if (!families[family]) missing.push(`vercel.${family}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `the golden-capture store ${EVAL_CAPTURES_PATH} lacks: ${missing.join(", ")}. ` +
        `Captures are recorded mechanically by the licensed @pipeline sandbox tier's ` +
        `shared-pipeline provisioning: run the sandbox tier (broad-sandbox and ` +
        `broad-sandbox-serial in RIGGING.md); the Vercel families record when the ` +
        `shared-deployment heal actually runs the real \`jolly deploy\`.`,
    );
  }
}
