// Verification support for the verification-economy licence scenarios
// (@logic @invariant): the sandbox tier's spend ledger.
//
// Per the feature's Rule "Expensive spend is licensed, recorded, and joined",
// the expensive spends are the full-toolchain-pipeline spawns — `git` clone,
// `pnpm` install, `@saleor/configurator` deploy, `npx vercel` deploy — and a
// Saleor Cloud environment creation. They are recorded at run time and each
// ledger entry is attributed to the running scenario:
//   - toolchain spawns are intercepted by PATH shims (the feature 025 idiom:
//     log argv, then exec the real binary), armed for @sandbox scenarios by
//     the hook in hooks.ts; the shims read the attribution from the
//     environment the spawning scenario exported;
//   - environment creation is recorded at the single env-creation seam
//     (env-factory.ts createEnvironment);
//   - shared ambient provisioning (provision.ts, storefront-fixture.ts,
//     recipe-on-shared.ts) runs under the "shared provisioning" attribution
//     and records one class entry per resource class it actually builds.
// The ledger lives in the wake (git-ignored coverage/weather/), one JSON
// object per line, appended across invocations; readers select one run by its
// run id. Recording is armed only for the sandbox tier, so logic runs write
// nothing.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERCEL_OBS_PATH } from "./eval-captures.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { runId } from "./sandbox.ts";

/** The wake path of the sandbox spend ledger. */
export const SPEND_LEDGER_PATH = join(
  REPO_ROOT,
  "coverage",
  "weather",
  "sandbox-spend-ledger.ndjson",
);

/** The attribution shared ambient provisioning records its spends under. */
export const SHARED_PROVISIONING = "shared provisioning";

/** The full-toolchain-pipeline spend kinds the PATH shims record. */
export const TOOLCHAIN_SPENDS = [
  "git-clone",
  "pnpm-install",
  "configurator-deploy",
  "vercel-deploy",
] as const;

export type SpendKind =
  | (typeof TOOLCHAIN_SPENDS)[number]
  | "environment-creation"
  | "shared-provisioning"
  | "run-start";

export interface SpendEntry {
  /** The run id (HARNESS_RUN_ID) the spend belongs to. */
  run: string;
  /** The tier the recorder was armed for. */
  tier: string;
  /** Epoch milliseconds at which the spend was recorded. */
  at: number;
  /** The scenario the spend is attributed to, or "shared provisioning". */
  scenario: string;
  spend: SpendKind;
  /** The resource class of a shared-provisioning entry. */
  class?: string;
  /** The intercepted argv, for observability. */
  argv?: string[];
}

/** The current attribution: the running scenario the arming hook exported. */
export function currentSpendAttribution(): string {
  const name = process.env.HARNESS_SPEND_SCENARIO;
  return name && name.trim() !== "" ? name : "(unattributed)";
}

export function setSpendAttribution(scenario: string): void {
  process.env.HARNESS_SPEND_SCENARIO = scenario;
}

export function clearSpendAttribution(): void {
  delete process.env.HARNESS_SPEND_SCENARIO;
}

/**
 * Append one ledger entry attributed to the current scenario. A no-op unless
 * the recorder is armed (HARNESS_SPEND_TIER=sandbox), so nothing outside the
 * sandbox tier writes to the ledger.
 */
export function recordSpend(entry: {
  spend: SpendKind;
  class?: string;
  argv?: string[];
  scenario?: string;
}): void {
  if (process.env.HARNESS_SPEND_TIER !== "sandbox") return;
  const record: SpendEntry = {
    run: runId(),
    tier: "sandbox",
    at: Date.now(),
    scenario: entry.scenario ?? currentSpendAttribution(),
    spend: entry.spend,
    ...(entry.class !== undefined ? { class: entry.class } : {}),
    ...(entry.argv !== undefined ? { argv: entry.argv } : {}),
  };
  mkdirSync(join(REPO_ROOT, "coverage", "weather"), { recursive: true });
  appendFileSync(SPEND_LEDGER_PATH, JSON.stringify(record) + "\n");
}

/**
 * Run shared ambient provisioning under the "shared provisioning" attribution,
 * recording its one class entry. Call at the site that actually builds; an
 * adoption of an already-present resource records nothing.
 */
export async function withSharedProvisioningSpend<T>(
  resourceClass: string,
  build: () => T | Promise<T>,
): Promise<T> {
  const prior = process.env.HARNESS_SPEND_SCENARIO;
  setSpendAttribution(SHARED_PROVISIONING);
  recordSpend({ spend: "shared-provisioning", class: resourceClass });
  try {
    return await build();
  } finally {
    if (prior === undefined) clearSpendAttribution();
    else setSpendAttribution(prior);
  }
}

/** Synchronous form of {@link withSharedProvisioningSpend}. */
export function withSharedProvisioningSpendSync<T>(
  resourceClass: string,
  build: () => T,
): T {
  const prior = process.env.HARNESS_SPEND_SCENARIO;
  setSpendAttribution(SHARED_PROVISIONING);
  recordSpend({ spend: "shared-provisioning", class: resourceClass });
  try {
    return build();
  } finally {
    if (prior === undefined) clearSpendAttribution();
    else setSpendAttribution(prior);
  }
}

// ─── Arming: shims on the PATH, once per worker process ─────────────────────

const SHIM_DIR = join(REPO_ROOT, "coverage", "spend-shims");

// Each shim logs the spend it recognizes to the ledger named by the
// environment, then execs the real binary resolved from the PATH minus its own
// directory (the feature 025 idiom). Absolute paths are not baked in, so one
// shim directory serves every run.
//
// The shims are ES modules: they are extensionless files (they must shadow the
// real `git`/`npx` names on the PATH), and node types an extensionless script
// by the NEAREST package.json — this repo's, which declares "type": "module".
// CommonJS `require` in that position crashes every shimmed spawn with
// "require is not defined in ES module scope", which read as `vercel whoami`
// reporting signed-out and recorded nothing.
const GIT_SHIM = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";
const argv = process.argv.slice(2);
const ownDir = dirname(process.argv[1]);
const path = (process.env.PATH || "").split(delimiter).filter((d) => d !== ownDir).join(delimiter);
const ledger = process.env.HARNESS_SPEND_LEDGER;
if (ledger && process.env.HARNESS_SPEND_TIER === "sandbox" && argv[0] === "clone") {
  const rec = { run: process.env.HARNESS_RUN_ID || "", tier: "sandbox", at: Date.now(),
    scenario: process.env.HARNESS_SPEND_SCENARIO || "(unattributed)", spend: "git-clone", argv };
  try { appendFileSync(ledger, JSON.stringify(rec) + "\\n"); } catch {}
}
const r = spawnSync("git", argv, { stdio: "inherit", env: { ...process.env, PATH: path } });
process.exit(r.status == null ? 1 : r.status);
`;

const NPX_SHIM = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";
const argv = process.argv.slice(2);
const ownDir = dirname(process.argv[1]);
const path = (process.env.PATH || "").split(delimiter).filter((d) => d !== ownDir).join(delimiter);
let i = 0;
while (i < argv.length && argv[i].startsWith("-")) i++;
const pkg = argv[i] || "";
const rest = argv.slice(i + 1);
let spend;
if (pkg === "pnpm" && rest.includes("install")) spend = "pnpm-install";
else if (pkg.startsWith("@saleor/configurator") && rest.includes("deploy")) spend = "configurator-deploy";
else if ((pkg === "vercel" || pkg.startsWith("vercel@")) && rest.includes("deploy")) spend = "vercel-deploy";
const ledger = process.env.HARNESS_SPEND_LEDGER;
if (ledger && process.env.HARNESS_SPEND_TIER === "sandbox" && spend) {
  const rec = { run: process.env.HARNESS_RUN_ID || "", tier: "sandbox", at: Date.now(),
    scenario: process.env.HARNESS_SPEND_SCENARIO || "(unattributed)", spend, argv };
  try { appendFileSync(ledger, JSON.stringify(rec) + "\\n"); } catch {}
}
// Golden-capture observation (feature 025): record the real Vercel CLI's
// argv, exit, and stdout for the NON-INTERACTIVE subcommands, so the licensed
// run's real invocations are replayable as golden captures. stdout is piped
// and written through unchanged; \`login\` (interactive device grant) and every
// other package keep stdio inherited untouched.
const obs = process.env.HARNESS_VERCEL_OBS;
const isVercel = pkg === "vercel" || pkg.startsWith("vercel@");
const observable = isVercel && ["whoami", "deploy", "project", "env", "link", "ls"].includes(rest.find((t) => !t.startsWith("-")) || "");
if (obs && observable) {
  const r = spawnSync("npx", argv, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, PATH: path },
    maxBuffer: 64 * 1024 * 1024,
  });
  const rec = { run: process.env.HARNESS_RUN_ID || "", argv,
    exit: r.status == null ? 1 : r.status, stdout: r.stdout || "" };
  try { appendFileSync(obs, JSON.stringify(rec) + "\\n"); } catch {}
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status == null ? 1 : r.status);
}
const r = spawnSync("npx", argv, { stdio: "inherit", env: { ...process.env, PATH: path } });
process.exit(r.status == null ? 1 : r.status);
`;

let shimsReady = false;
let runStartRecorded = false;

// The marker carries the shim-source version, so a shim directory persisted in
// the wake from an older source is regenerated rather than trusted: a stale
// broken shim on the PATH fails every spawn it intercepts.
const SHIM_SOURCE_VERSION = "3-vercel-obs";

function ensureSpendShims(): void {
  if (shimsReady) return;
  const marker = join(SHIM_DIR, ".ready");
  const current = existsSync(marker) ? readFileSync(marker, "utf8") : "";
  if (current !== SHIM_SOURCE_VERSION) {
    mkdirSync(SHIM_DIR, { recursive: true });
    writeFileSync(join(SHIM_DIR, "git"), GIT_SHIM, { mode: 0o755 });
    writeFileSync(join(SHIM_DIR, "npx"), NPX_SHIM, { mode: 0o755 });
    writeFileSync(marker, SHIM_SOURCE_VERSION);
  }
  shimsReady = true;
}

/**
 * Arm sandbox spend recording for this worker process: build the PATH shims,
 * put them first on the PATH, and export the ledger location so every child
 * the scenarios spawn inherits them. Records one run-start entry per worker,
 * so a sandbox run always leaves a ledger trace even when it spends nothing.
 */
export function armSandboxSpendRecording(): void {
  ensureSpendShims();
  process.env.HARNESS_SPEND_TIER = "sandbox";
  process.env.HARNESS_SPEND_LEDGER = SPEND_LEDGER_PATH;
  // Golden-capture observation (feature 025): the shim records the real Vercel
  // CLI invocations of this run into the wake, so a heal's real `jolly deploy`
  // leaves replayable captures.
  process.env.HARNESS_VERCEL_OBS = VERCEL_OBS_PATH;
  const path = process.env.PATH ?? "";
  if (!path.split(":").includes(SHIM_DIR)) {
    process.env.PATH = `${SHIM_DIR}:${path}`;
  }
  if (!runStartRecorded) {
    recordSpend({ spend: "run-start", scenario: "(run)" });
    runStartRecorded = true;
  }
}

// ─── Reading and judging the ledger ─────────────────────────────────────────

/** Every parseable entry of the ledger, in append order. */
export function readSpendLedger(path: string = SPEND_LEDGER_PATH): SpendEntry[] {
  if (!existsSync(path)) return [];
  const entries: SpendEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as SpendEntry;
      if (typeof entry.run === "string" && typeof entry.spend === "string") {
        entries.push(entry);
      }
    } catch {
      // A malformed line is void, never a crash.
    }
  }
  return entries;
}

/** The entries of the ledger's most recent run: the last entry's run id. */
export function lastRunEntries(entries: SpendEntry[]): SpendEntry[] {
  const last = entries[entries.length - 1];
  if (!last) return [];
  return entries.filter((entry) => entry.run === last.run);
}

/**
 * Scenario name to tags, parsed from the durable specs: the licensed set is
 * declared in the specs, enumerable from tags alone.
 */
export function scenarioTagsFromSpecs(
  specsDir: string = join(REPO_ROOT, "features"),
): Map<string, Set<string>> {
  const tags = new Map<string, Set<string>>();
  for (const name of readdirSync(specsDir)) {
    if (!name.endsWith(".feature")) continue;
    let featureTags: string[] = [];
    let pending: string[] = [];
    for (const raw of readFileSync(join(specsDir, name), "utf8").split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("@")) {
        pending.push(...line.split(/\s+/));
        continue;
      }
      if (line.startsWith("Feature:")) {
        featureTags = pending;
        pending = [];
        continue;
      }
      if (line.startsWith("Scenario:") || line.startsWith("Scenario Outline:")) {
        const scenarioName = line.slice(line.indexOf(":") + 1).trim();
        tags.set(scenarioName, new Set([...featureTags, ...pending]));
      }
      pending = [];
    }
  }
  return tags;
}

export interface SpendViolation {
  scenario: string;
  spend: string;
  message: string;
}

/**
 * Every recorded spend whose attributed scenario holds no licence for it: a
 * toolchain-chain spend outside the run's shared provisioning and outside the
 * @pipeline scenario, or an environment creation outside the run's shared
 * provisioning and outside a @creates-env scenario. A scenario tagged
 * @creates-env MAY additionally drive a SINGLE toolchain element against the
 * environment it created (feature verification-economy's licence Rule); the
 * element licence never extends to the chain, so a @creates-env scenario whose
 * toolchain spends span more than one element kind reddens.
 */
export function unlicensedSpends(
  entries: SpendEntry[],
  tags: Map<string, Set<string>>,
): SpendViolation[] {
  const violations: SpendViolation[] = [];
  // The element licence is judged per scenario: how many DISTINCT toolchain
  // element kinds each attributed scenario spent in the judged set.
  const elementKinds = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!(TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend)) continue;
    const kinds = elementKinds.get(entry.scenario) ?? new Set<string>();
    kinds.add(entry.spend);
    elementKinds.set(entry.scenario, kinds);
  }
  for (const entry of entries) {
    if ((TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend)) {
      const scenarioTags = tags.get(entry.scenario);
      const licensedElement =
        scenarioTags?.has("@creates-env") === true &&
        (elementKinds.get(entry.scenario)?.size ?? 0) === 1;
      if (
        entry.scenario !== SHARED_PROVISIONING &&
        !scenarioTags?.has("@pipeline") &&
        !licensedElement
      ) {
        const chainByCreatesEnv =
          scenarioTags?.has("@creates-env") === true &&
          (elementKinds.get(entry.scenario)?.size ?? 0) > 1;
        violations.push({
          scenario: entry.scenario,
          spend: entry.spend,
          message: chainByCreatesEnv
            ? `"${entry.scenario}" holds a @creates-env element licence but spent the ` +
              `toolchain CHAIN (${[...(elementKinds.get(entry.scenario) ?? [])].join(", ")}); ` +
              `the element licence never extends to the chain`
            : `"${entry.scenario}" made the toolchain-chain spend ${entry.spend}` +
              `${entry.argv ? ` (${entry.argv.join(" ")})` : ""} without a @pipeline ` +
              `licence and outside the run's shared provisioning`,
        });
      }
      continue;
    }
    if (entry.spend === "environment-creation") {
      if (
        entry.scenario !== SHARED_PROVISIONING &&
        !tags.get(entry.scenario)?.has("@creates-env")
      ) {
        violations.push({
          scenario: entry.scenario,
          spend: entry.spend,
          message:
            `"${entry.scenario}" made the environment-creation spend without a ` +
            `@creates-env licence and outside the run's shared provisioning`,
        });
      }
    }
  }
  return violations;
}

/** Resource classes the run's shared provisioning recorded more than once. */
export function duplicateSharedClasses(
  entries: SpendEntry[],
): Array<{ resourceClass: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.scenario !== SHARED_PROVISIONING || entry.class === undefined) continue;
    counts.set(entry.class, (counts.get(entry.class) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([resourceClass, count]) => ({ resourceClass, count }));
}

export interface RunWindow {
  startMs: number;
  endMs: number;
}

/** The ledger entries recorded inside a run's wall-clock window. */
export function ledgerEntriesWithin(
  window: RunWindow,
  entries: SpendEntry[],
): SpendEntry[] {
  return entries.filter(
    (entry) => entry.at >= window.startMs && entry.at <= window.endMs,
  );
}
