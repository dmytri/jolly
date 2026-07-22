// Cucumber.js configuration. See AGENTS.md (test tiers and harness mechanics).
// Step definitions and support code are TypeScript, loaded directly under
// native Node >= 23, which strips types on import (these project files are
// not under node_modules). Dev/CI run on Node >= 23 + npm.
// No explicit `paths`: cucumber's default is features/**/*.feature, and
// leaving it unset lets `npx cucumber-js <file>[:line]` target a single
// feature or scenario.
// A run-wide id. The main process sets it here on config load and any child
// process inherits it, keeping it via `??=`. The @sandbox provisioner
// namespaces its store by this run id, so a run reclaims and tears down only
// its own environment, never a concurrent foreign agent's live store
// (features/support/provision.ts).
process.env.HARNESS_RUN_ID ??= `run-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

// Yesterday's weather (feature verification-economy, pressure Rule): a tier
// run records its own pressure — peak RSS, out-of-memory kills, wall clock —
// into the wake, so the next run reads what the last one observed instead of
// rediscovering a crash at full price. The record paths are the same
// cwd-relative message streams the tier commands in RIGGING.md write.
import {
  armPressureRecording,
  CONFIGURED_PARALLELISM,
} from "./features/support/pressure.ts";
import { armRunEndRecording } from "./features/support/spend-ledger.ts";
import { armEvalRunEndRecording } from "./features/support/eval-spend-ledger.ts";
import { armProcessReclaimRecording } from "./features/support/process-reclaim.ts";
// Record this run's own pressure into the message stream its argv names (only
// a tier-record run names one; focused runs, discovery, and worker children
// record nothing). Armed here at config load so the machinery rides the run
// config the tier command itself loads — a command that stopped loading it
// stops recording, which is exactly what the pressure-record conformance
// scenario reddens on.
armPressureRecording({ ...CONFIGURED_PARALLELISM });

// Run-scoped wake reading (feature verification-economy, "The wake is read
// run-scoped"): a sandbox tier-record run marks its completion in the spend
// ledger at exit, so ledger readers select a completed run's record and never
// a live overlapped sibling's partial one. Same config-load ride as the
// pressure recorder: a command that stopped loading this config stops marking,
// which the run-scope conformance check reddens on.
armRunEndRecording();
// The same completion marking for the @eval tier's own ledger: an eval
// tier-record run appends its run-end at exit, so the eval ledger's readers
// select a completed run and never a live sibling's partial one.
armEvalRunEndRecording();

// Process reclamation (feature verification-economy, "A run reclaims the
// processes it spawned"): a tier-record run records the descendants still alive
// at its coordinating process's exit into its own message stream, so a detached
// child that outlived the run is legible rather than invisibly green. Same
// config-load ride as the recorders above.
armProcessReclaimRecording();

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
// NO PROFILE SETS `parallel`: cucumber is serial by default, and nothing here
// runs in parallel. This VM is resource-limited, and a full toolchain chain
// (`git clone` Paper, `pnpm install` a whole Next.js app, `@saleor/configurator`
// deploy, `npx vercel` deploy, node) saturates its CPU, memory, and network;
// two at once is where the "unable to connect" errors came from. The lever for
// pipeline parallelism is a bigger test-runner VM, not a worker count here.
//
// The @sandbox tier is split across TWO profiles for ORDER, not concurrency:
// `sandboxSerial` runs the licensed @pipeline and @creates-env scenarios FIRST,
// building the shared state that the `sandbox` leg's derivative satisfied-state
// scenarios then assert against, so a broken creation or chain seam reds before
// anything spends against it (RIGGING.md `## Tiers`, `order`).
export const logic = { ...common, tags: "@logic" };
export const sandbox = { ...common, tags: "@sandbox and not @pipeline and not @creates-env" };
// Serial by licence (one toolchain fits the VM), never derived from weather.
export const sandboxSerial = { ...common, tags: "@sandbox and (@pipeline or @creates-env)" };

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
