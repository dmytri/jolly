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
// resource-limited, and each heavy scenario runs a full toolchain (`git clone` Paper,
// `pnpm install` a whole Next.js app, `@saleor/configurator` deploy, `npx vercel`
// deploy, node). Two of those at once saturate the VM's CPU, memory, and network,
// and that is where the "unable to connect" errors come from. So the tier is a
// heavy/light phase split. HEAVY scenarios (a full `jolly start` / real deploy /
// provision, tagged @heavy) run SERIAL — only one toolchain fits the VM. The lever
// for heavy parallelism is a bigger test-runner VM. The env-creating scenarios
// (@creates-env) also run serial, since they need a slot the parallel phase's two
// isolated envs would consume. Everything else is a light query/check that runs in
// parallel across the two isolated worker envs.
export const logic = { ...common, tags: "@logic", parallel: 2 };
export const sandbox = { ...common, tags: "@sandbox and not @heavy and not @creates-env", parallel: 2 };
export const sandboxSerial = { ...common, tags: "@sandbox and (@heavy or @creates-env)", parallel: 1 };

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
