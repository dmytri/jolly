// Cucumber.js configuration. See AGENTS.md (test tiers and harness mechanics).
// Step definitions and support code are TypeScript, loaded directly under
// native Node >= 23, which strips types on import (these project files are
// not under node_modules). Dev/CI run on Node >= 23 + npm.
// No explicit `paths`: cucumber's default is features/**/*.feature, and
// leaving it unset lets `npx cucumber-js <file>[:line]` target a single
// feature or scenario.
// A run-wide id shared by every parallel worker. The main process sets it here
// on config load and the worker child processes inherit it, keeping it via `??=`.
// The @sandbox provisioner namespaces each worker's store by this run id plus the
// worker id, so concurrent workers reclaim and tear down only their own
// environment, never a sibling's live store (features/support/provision.ts).
process.env.HARNESS_RUN_ID ??= `run-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

// Yesterday's weather (feature verification-economy, pressure Rule): each
// parallel tier's worker count derives from the pressure line its own wake
// record carries. A record carrying a pressure signal — an out-of-memory kill,
// or peak RSS at the machine's ceiling — backs the next run off below its
// green worker count instead of rediscovering the crash at full price; a
// record carrying none leaves the green count standing; no record leaves the
// configured starting prior. The record paths are the same cwd-relative
// message streams the tier commands in RIGGING.md write.
import { armPressureRecording, deriveWorkerCount } from "./features/support/pressure.ts";
import { armRunEndRecording } from "./features/support/spend-ledger.ts";
const logicWorkers = deriveWorkerCount("coverage/weather/logic.ndjson", 2);
const sandboxWorkers = deriveWorkerCount("coverage/weather/sandbox.ndjson", 2);

// Record this run's own pressure into the message stream its argv names (only
// a tier-record run names one; focused runs, discovery, and worker children
// record nothing). Armed here at config load so the machinery rides the run
// config the tier command itself loads — a command that stopped loading it
// stops recording, which is exactly what the pressure-record conformance
// scenario reddens on.
armPressureRecording({
  default: 1,
  logic: logicWorkers,
  sandbox: sandboxWorkers,
  sandboxSerial: 1,
  eval: 1,
  all: 1,
});

// Run-scoped wake reading (feature verification-economy, "The wake is read
// run-scoped"): a sandbox tier-record run marks its completion in the spend
// ledger at exit, so ledger readers select a completed run's record and never
// a live overlapped sibling's partial one. Same config-load ride as the
// pressure recorder: a command that stopped loading this config stops marking,
// which the run-scope conformance check reddens on.
armRunEndRecording();

const common = {
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
};

// Default: the product worklist. Excludes @eval (the opt-in skill-affordance
// evaluation, feature 025, which drives a live baseline agent — non-deterministic,
// credentialed, and slow), which runs on its own profile as a required green/red
// gate at the boundary rather than on every default run. Credentials for @sandbox
// and @eval are present by fitting-out; the CLIs and API clients read them from the
// environment. Verification runs every target and never branches on credential
// presence: a scenario whose credential is absent fails as a fitting-out blocker,
// so the gap is visible.
export default { ...common, tags: "not @eval" };

// Targeted profiles: `cucumber-js -p logic` / `-p sandbox` / `-p sandboxSerial` / `-p eval`.
// The logic tier is pure local behavior with no shared external state, so it runs
// in parallel for fast status/worklist feedback. The sandbox tier gives EACH
// worker its own isolated jolly-cannon-fodder environment, namespaced by run id +
// worker id (features/support/provision.ts, features/support/sandbox.ts). Isolation
// removes cross-worker COLLISION, but does not remove concurrent LOAD. The binding
// cause is LOCAL, per AGENTS.md "Sandbox harness mechanics": this test VM is
// resource-limited, and a full toolchain chain (`git clone` Paper, `pnpm install`
// a whole Next.js app, `@saleor/configurator` deploy, `npx vercel` deploy, node)
// saturates the VM's CPU, memory, and network; two at once is where the "unable
// to connect" errors come from. So the tier serializes the LICENSED spends, per
// feature verification-economy's licence Rule and feature 028: the full-pipeline
// proofs (@pipeline) and the env-creating scenarios (@creates-env, which need a
// slot the parallel phase's isolated envs would consume) run SERIAL — only one
// toolchain fits the VM, and the lever for pipeline parallelism is a bigger
// test-runner VM. Everything else is a light query/check that runs in parallel
// across the isolated worker envs.
export const logic = { ...common, tags: "@logic", parallel: logicWorkers };
export const sandbox = { ...common, tags: "@sandbox and not @pipeline and not @creates-env", parallel: sandboxWorkers };
// Serial by licence (one toolchain fits the VM), never derived from weather.
export const sandboxSerial = { ...common, tags: "@sandbox and (@pipeline or @creates-env)", parallel: 1 };

// The eval profile runs ONLY the opt-in @eval tier (feature 025). `eval` is a
// reserved identifier, so it is exported under that name via an alias.
const evalProfile = { ...common, tags: "@eval" };
export { evalProfile as eval };

// The tag-free profile: every scenario in every tier, seen by construction.
// Cucumber ANDs a profile's tags with the CLI's, so the default profile's
// `not @eval` cannot be lifted from the command line and no profile above can
// enumerate the whole suite. Static discovery (`discover`) and step-usage
// enumeration must see EVERY tier, or a tier they miss reads as bound and its
// step definitions read as orphans — silently, and green. This profile carries
// no tags, so a tier added later is covered with no further wiring. It is for
// enumeration, not execution: running it would run the credentialed @eval tier
// alongside the rest.
export const all = { ...common };
