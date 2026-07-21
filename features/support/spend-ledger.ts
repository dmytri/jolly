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
// run id. A sandbox tier-record run's coordinating process appends a run-end
// entry at exit (armRunEndRecording, wired in cucumber.js), so completion is
// legible in the ledger itself and readers stay run-scoped under overlapped
// siblings. Recording is armed only for the sandbox tier, so logic runs write
// nothing.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERCEL_OBS_PATH } from "./eval-captures.ts";
import { messageRecordPathFromArgv } from "./pressure.ts";
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

/**
 * The toolchain element each spend kind belongs to. The storefront
 * preparation is ONE element of two spend kinds — its clone and install are
 * one behaviour — so the element licences (@creates-env single element,
 * @toolchain-element) count elements, never raw kinds, and the chain is
 * spends spanning more than one element.
 */
const TOOLCHAIN_ELEMENT_OF: Record<string, string> = {
  "git-clone": "storefront-preparation",
  "pnpm-install": "storefront-preparation",
  "configurator-deploy": "configurator-deploy",
  "vercel-deploy": "vercel-deploy",
};

export type SpendKind =
  | (typeof TOOLCHAIN_SPENDS)[number]
  | "environment-creation"
  | "environment-reuse"
  | "shared-provisioning"
  | "run-start"
  | "run-end";

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

// ─── Run-end: completion, legible in the ledger itself ──────────────────────

/** True when this process's argv selects a sandbox profile: the runs whose
 * ledger writes need a completion marker. */
function sandboxProfileSelected(argv: readonly string[]): boolean {
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-p" || arg === "--profile") profile = argv[i + 1];
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
  }
  return profile === "sandbox" || profile === "sandboxSerial";
}

/**
 * Arm run-end recording for this run: a sandbox tier-record run appends one
 * `run-end` entry at its coordinating process's exit, so a run-scoped reader
 * can tell a completed run from a live sibling's partial one (feature
 * verification-economy, Rule "The wake is read run-scoped"). Called from
 * cucumber.js at config load, mirroring the pressure recorder's gates: a
 * worker child, a run naming no `message:<path>` record target (focused runs,
 * discovery, step-usage), and every non-sandbox profile arm nothing, so only
 * the sandbox tier's own record runs mark completion. A crashed run appends no
 * run-end and correctly never reads as completed.
 */
export function armRunEndRecording(): void {
  if (process.env.CUCUMBER_WORKER_ID !== undefined) return; // worker child
  if (messageRecordPathFromArgv(process.argv) === undefined) return; // not a tier-record run
  if (!sandboxProfileSelected(process.argv)) return; // the ledger is sandbox-only
  process.on("exit", () => {
    const record: SpendEntry = {
      run: runId(),
      tier: "sandbox",
      at: Date.now(),
      scenario: "(run)",
      spend: "run-end",
    };
    try {
      mkdirSync(join(REPO_ROOT, "coverage", "weather"), { recursive: true });
      appendFileSync(SPEND_LEDGER_PATH, JSON.stringify(record) + "\n");
    } catch (error) {
      // Loud, not fatal: a run missing its run-end never reads as completed,
      // which is exactly what the run-scope conformance check guards.
      process.stderr.write(`run-end record write failed: ${String(error)}\n`);
    }
  });
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

/**
 * The entries of the ledger's most recent COMPLETED run: the latest run id
 * carrying a `run-end` entry, appended by a sandbox tier run's coordinating
 * process at exit (armRunEndRecording). Run-scoped per feature
 * verification-economy's Rule "The wake is read run-scoped": a live sibling
 * invocation appends entries but no `run-end` until it exits, so its partial
 * run is never selected, even when it appended last. Where the whole ledger
 * carries no `run-end` — a wake recorded before the run-end recorder existed —
 * the last entry's run id stands: no writer of that era runs as an overlapped
 * sibling.
 */
export function lastRunEntries(entries: SpendEntry[]): SpendEntry[] {
  let completed: string | undefined;
  for (const entry of entries) {
    if (entry.spend === "run-end") completed = entry.run;
  }
  if (completed === undefined) {
    const last = entries[entries.length - 1];
    if (!last) return [];
    completed = last.run;
  }
  return entries.filter((entry) => entry.run === completed);
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

/**
 * The expensive spend classes and the tag that licenses each. The Rule names
 * exactly two expensive spends: the full toolchain chain and a Saleor Cloud
 * environment creation. One creation test per creation seam, and one means one,
 * so at most a single scenario in the corpus may hold either licence.
 *
 * The element licences (@creates-env's single-element clause, and
 * @toolchain-element) are NOT listed here: they license the toolchain elements
 * that are a scenario's own specified assertion against its own namespaced
 * resources, never an expensive spend class, so several scenarios may hold one.
 */
export const EXPENSIVE_SPEND_LICENCES: ReadonlyArray<{
  tag: string;
  spendClass: string;
}> = [
  { tag: "@pipeline", spendClass: "the full toolchain chain" },
  { tag: "@creates-env", spendClass: "Saleor Cloud environment creation" },
];

/**
 * The tag a scenario declares when its assertion cannot exist without its own
 * creation. The Rule exempts such a scenario from the one-holder count, so the
 * true licensed set stays enumerable from tags alone.
 */
export const SPEND_IS_THE_ASSERTION = "@spend-is-the-assertion";

/**
 * Every expensive spend class mapped to the scenarios holding its licence and
 * counted against the one-holder rule. A holder declaring
 * `@spend-is-the-assertion` is exempt, so it is not grouped.
 */
export function licensedScenariosBySpendClass(
  tags: Map<string, Set<string>>,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { tag, spendClass } of EXPENSIVE_SPEND_LICENCES) {
    const holders: string[] = [];
    for (const [scenario, scenarioTags] of tags) {
      if (!scenarioTags.has(tag)) continue;
      if (scenarioTags.has(SPEND_IS_THE_ASSERTION)) continue;
      holders.push(scenario);
    }
    grouped.set(spendClass, holders.sort());
  }
  return grouped;
}

/**
 * Every scenario declaring `@spend-is-the-assertion` while holding no expensive
 * spend licence. The declaration exempts a licence it does not hold, so it
 * claims an exception it cannot use.
 */
export function strayExemptionScenarios(
  tags: Map<string, Set<string>>,
): string[] {
  const stray: string[] = [];
  for (const [scenario, scenarioTags] of tags) {
    if (!scenarioTags.has(SPEND_IS_THE_ASSERTION)) continue;
    const holdsLicence = EXPENSIVE_SPEND_LICENCES.some(({ tag }) =>
      scenarioTags.has(tag),
    );
    if (!holdsLicence) stray.push(scenario);
  }
  return stray.sort();
}

export interface LicenceExclusivityViolation {
  spendClass: string;
  holders: string[];
  message: string;
}

/** Every spend class held by more than one scenario, named with its holders. */
export function licenceExclusivityViolations(
  grouped: Map<string, string[]>,
): LicenceExclusivityViolation[] {
  const violations: LicenceExclusivityViolation[] = [];
  for (const [spendClass, holders] of grouped) {
    if (holders.length <= 1) continue;
    violations.push({
      spendClass,
      holders,
      message:
        `${spendClass} carries ${holders.length} licensed scenarios, and one ` +
        `means one: ${holders.map((holder) => `"${holder}"`).join(", ")}`,
    });
  }
  return violations;
}

export interface SpendViolation {
  scenario: string;
  spend: string;
  message: string;
}

/**
 * Argv aimed at a declared unroutable stand-in: the loopback port-1 endpoint
 * this repo's doubles declare (features/support/cold-store-cloud-api.ts). A
 * future double declaring a different stand-in grows this pattern with it.
 */
const UNROUTABLE_STANDIN = /(127\.0\.0\.1|\[::1\]|localhost):1(?!\d)/;

/** The unroutable stand-in an entry's argv aims at, if any. */
function unroutableTarget(entry: SpendEntry): string | undefined {
  return entry.argv?.find((arg) => UNROUTABLE_STANDIN.test(arg));
}

/** True when the entry is a toolchain spend aimed at a declared unroutable
 * stand-in by a scenario carrying @exceptional-double: the double's own
 * failure path, never a real toolchain spend. */
function isDoubleClassified(
  entry: SpendEntry,
  tags: Map<string, Set<string>>,
): boolean {
  return (
    (TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend) &&
    unroutableTarget(entry) !== undefined &&
    tags.get(entry.scenario)?.has("@exceptional-double") === true
  );
}

export interface DoubleClassifiedSpend {
  scenario: string;
  spend: string;
  /** The declared unroutable stand-in the spend was aimed at. */
  target: string;
}

/**
 * Every toolchain spend aimed at a declared unroutable stand-in by a scenario
 * carrying @exceptional-double: the shim records it, and the check classifies
 * it to that scenario's double rather than the licence set (feature
 * verification-economy's licence Rule).
 */
export function doubleClassifiedSpends(
  entries: SpendEntry[],
  tags: Map<string, Set<string>>,
): DoubleClassifiedSpend[] {
  return entries
    .filter((entry) => isDoubleClassified(entry, tags))
    .map((entry) => ({
      scenario: entry.scenario,
      spend: entry.spend,
      target: unroutableTarget(entry)!,
    }));
}

/**
 * Every recorded spend whose attributed scenario holds no licence for it: a
 * toolchain-chain spend outside the run's shared provisioning and outside the
 * @pipeline scenario, or an environment creation outside the run's shared
 * provisioning and outside a @creates-env scenario. A scenario tagged
 * @creates-env MAY additionally drive a SINGLE toolchain element against the
 * environment it created, and a scenario tagged @toolchain-element is licensed
 * for the toolchain element that is its own assertion (feature
 * verification-economy's licence Rule); neither element licence extends to the
 * chain, so a licensed scenario whose toolchain spends span more than one
 * element reddens. A spend aimed at a declared unroutable stand-in by a
 * scenario carrying @exceptional-double is classified to the double
 * ({@link doubleClassifiedSpends}) and never judged as a real toolchain spend.
 */
/** The identity a creation entry and its annulling reuse entry share: the
 * scenario that drove the seam and the exact argv it drove it with. */
function creationKey(entry: SpendEntry): string {
  return `${entry.scenario} ${(entry.argv ?? []).join(" ")}`;
}

export function unlicensedSpends(
  entries: SpendEntry[],
  tags: Map<string, Set<string>>,
): SpendViolation[] {
  const violations: SpendViolation[] = [];
  // The element licences are judged per scenario: how many DISTINCT toolchain
  // ELEMENTS each attributed scenario spent in the judged set. Spends
  // classified to a double are the double's own failure path and count toward
  // no element.
  // An environment-creation entry is recorded BEFORE the create runs, so a
  // crash mid-create is still accounted. The seam reports the OUTCOME
  // afterwards, and a reuse creates nothing: the CLI answered with an existing
  // environment. Such an entry is annulled by its matching reuse entry, so the
  // licence join judges what was actually spent rather than what was attempted.
  const annulled = new Set(
    entries
      .filter((entry) => entry.spend === "environment-reuse")
      .map((entry) => creationKey(entry)),
  );
  const elements = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!(TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend)) continue;
    if (isDoubleClassified(entry, tags)) continue;
    const spent = elements.get(entry.scenario) ?? new Set<string>();
    spent.add(TOOLCHAIN_ELEMENT_OF[entry.spend]!);
    elements.set(entry.scenario, spent);
  }
  for (const entry of entries) {
    if ((TOOLCHAIN_SPENDS as readonly string[]).includes(entry.spend)) {
      if (isDoubleClassified(entry, tags)) continue;
      const scenarioTags = tags.get(entry.scenario);
      const elementLicence = scenarioTags?.has("@creates-env")
        ? "@creates-env"
        : scenarioTags?.has("@toolchain-element")
          ? "@toolchain-element"
          : undefined;
      const spentElements = elements.get(entry.scenario)?.size ?? 0;
      const licensedElement = elementLicence !== undefined && spentElements === 1;
      if (
        entry.scenario !== SHARED_PROVISIONING &&
        !scenarioTags?.has("@pipeline") &&
        !licensedElement
      ) {
        const chainByElementLicence =
          elementLicence !== undefined && spentElements > 1;
        violations.push({
          scenario: entry.scenario,
          spend: entry.spend,
          message: chainByElementLicence
            ? `"${entry.scenario}" holds a ${elementLicence} element licence but spent the ` +
              `toolchain CHAIN (${[...(elements.get(entry.scenario) ?? [])].join(", ")}); ` +
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
        !tags.get(entry.scenario)?.has("@creates-env") &&
        !annulled.has(creationKey(entry))
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

// ─── Sweep-leg selection: every profile leg of the last sweep ───────────────

/** Grace after a leg window's recorded end inside which its coordinating
 * process's run-end entry lands: the run-end is appended by an exit handler
 * milliseconds after the message record's last write. */
const RUN_END_GRACE_MS = 60_000;

export interface SweepLegRun {
  tier: string;
  /** The leg's selected completed run id; undefined when no run-end matches
   * the leg's window, a broken or disarmed recorder. */
  run?: string;
  window: RunWindow;
}

export interface SweepSelection {
  legs: SweepLegRun[];
  /** The union of the selected runs' entries. */
  entries: SpendEntry[];
}

/**
 * The entries of every profile leg of the sandbox tier's last sweep: for each
 * leg window, the completed run whose run-end lies nearest the window's end,
 * within the window plus a short grace; the union of the selected runs'
 * entries. Run-scoped per feature verification-economy's Rule "The wake is
 * read run-scoped": only a run carrying a run-end is selectable, so a live
 * sibling's partial record is never consumed. Judging every leg means the
 * order the legs ran in can never leave one leg's spends unjudged.
 */
export function sweepLegEntries(
  entries: SpendEntry[],
  legs: Array<{ tier: string; startMs: number; endMs: number }>,
): SweepSelection {
  const selected: SweepLegRun[] = [];
  const runs = new Set<string>();
  for (const leg of legs) {
    let best: { run: string; distance: number } | undefined;
    for (const entry of entries) {
      if (entry.spend !== "run-end") continue;
      if (entry.at < leg.startMs || entry.at > leg.endMs + RUN_END_GRACE_MS) continue;
      const distance = Math.abs(entry.at - leg.endMs);
      if (!best || distance < best.distance) best = { run: entry.run, distance };
    }
    selected.push({
      tier: leg.tier,
      ...(best ? { run: best.run } : {}),
      window: { startMs: leg.startMs, endMs: leg.endMs },
    });
    if (best) runs.add(best.run);
  }
  return {
    legs: selected,
    entries: entries.filter((entry) => runs.has(entry.run)),
  };
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

// ─── Per-tier ledger coverage: every tier that can spend records a ledger ────

/** The tier tags a configured tier is known by (RIGGING.md "## Tiers"). */
export const TIER_TAGS = ["@logic", "@sandbox", "@eval"] as const;

/**
 * The tags a scenario carries to be entitled to spawn an expensive command: a
 * spend licence (@pipeline, @creates-env), a toolchain-element licence, or the
 * @spend-is-the-assertion declaration. A tier hosting any such scenario can
 * spend, so its spawns must be recorded in a ledger.
 */
export const SPEND_LICENCE_TAGS = [
  "@pipeline",
  "@creates-env",
  "@toolchain-element",
  SPEND_IS_THE_ASSERTION,
] as const;

/**
 * Every tier that hosts a scenario licensed to spawn an expensive command,
 * derived from the specs' tags: a scenario carrying a spend-licence tag places
 * the tier tag it also carries (@logic/@sandbox/@eval) in the can-spend set.
 */
export function tiersThatCanSpend(tags: Map<string, Set<string>>): Set<string> {
  const tiers = new Set<string>();
  for (const scenarioTags of tags.values()) {
    if (!SPEND_LICENCE_TAGS.some((tag) => scenarioTags.has(tag))) continue;
    for (const tier of TIER_TAGS) {
      if (scenarioTags.has(tier)) tiers.add(tier);
    }
  }
  return tiers;
}

/**
 * Every tier whose spends the wake's ledger carries, from the entries' tier
 * field, normalized to the RIGGING tier tag (`sandbox` → `@sandbox`).
 */
export function tiersWithLedger(entries: SpendEntry[]): Set<string> {
  const tiers = new Set<string>();
  for (const entry of entries) tiers.add(`@${entry.tier}`);
  return tiers;
}

export interface LedgerCoverageFinding {
  tier: string;
  message: string;
}

/**
 * Every tier that can spend (hosts a spend-licensed scenario) yet wrote no
 * ledger: its spawns go unrecorded by construction, so no entry exists to join
 * against its licensed set. The default tier, paid on every inner-loop run, is
 * the most expensive place for this gap.
 */
export function tiersMissingLedger(
  canSpend: Set<string>,
  withLedger: Set<string>,
): LedgerCoverageFinding[] {
  const findings: LedgerCoverageFinding[] = [];
  for (const tier of canSpend) {
    if (withLedger.has(tier)) continue;
    findings.push({
      tier,
      message:
        `the ${tier} tier hosts a scenario licensed to spawn an expensive ` +
        `command but wrote no spend ledger, so its spends go unrecorded and ` +
        `cannot be joined against its licensed set`,
    });
  }
  return findings;
}
