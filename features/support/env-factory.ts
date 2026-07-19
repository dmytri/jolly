// The single env-creation seam (feature single-creation-seam).
//
// Every REAL `create store --create-environment` invocation in the verification
// layer lives here. The shared-store creator (provision.ts), the disposable-
// leftover seeder (feature 026), and the @creates-env creators (feature 012)
// call `createEnvironment` rather than re-implementing the create-and-wait-out-
// the-limit flow. This is the ONLY site that spawns the create-environment CLI
// against the real Cloud; a test that only drives the create CLI against a
// loopback fake creates no real resource and is a justified exception recorded
// at its own site (`env-factory-exception:`), not a second creation seam.
//
// The create-store string literals are held ONLY in this file: the module-
// conformance checker (features/support/module-conformance.ts) locates the
// `["create", "store", "--create-environment", ...]` argument array directly,
// so any such array outside this seam that is neither a `--dry-run` preview nor
// an `env-factory-exception:` loopback fails the single-creation-seam scenario.
import {
  deleteEnvironment,
  leftoverTestEnvironments,
  listAllEnvironments,
} from "./cloud.ts";
import { findEnvelope } from "./envelope.ts";
import { recordSpend } from "./spend-ledger.ts";
import type { CliResult, RunCliOptions } from "./world.ts";

/** The one place the create-environment CLI verb string literals live. */
const CREATE_ENVIRONMENT_ARGS = ["create", "store", "--create-environment"];

/** Runs the Jolly CLI and reports the parsed result. Supplied by the caller so
 * this seam owns the argument shape while the caller owns the spawn mechanism
 * (the World's async runner, or a standalone spawnSync in a scratch dir). */
export type CliRunner = (
  args: string[],
  options?: RunCliOptions,
) => Promise<CliResult>;

/** Actively free one org sandbox slot by deleting prior-run leftovers. */
export interface ReclaimContext {
  token: string;
  runNamespace: string;
  spareNames: ReadonlySet<string>;
}

export interface CreateEnvironmentOptions {
  /** `--name` value for the created environment. */
  name?: string;
  /** `--domain-label` value for the created environment. */
  domainLabel?: string;
  /** Extra CLI flags inserted before `--json` (for example a region override). */
  extraArgs?: string[];
  /** Passed through to the runner (cwd, env, per-call timeout, stdin). */
  runOptions?: RunCliOptions;
  /** Budget for waiting out ENVIRONMENT_LIMIT_REACHED. 0 (default) means a
   * single attempt with no wait; a caller that provisions under a parallel run
   * passes a real budget so a sibling worker can free a slot. */
  limitBudgetMs?: number;
  /** When present, a limit rejection actively reclaims a slot by deleting
   * prior-run leftovers before waiting and retrying. Absent means wait only. */
  reclaim?: ReclaimContext;
}

function buildArgs(opts: CreateEnvironmentOptions): string[] {
  return [
    ...CREATE_ENVIRONMENT_ARGS,
    ...(opts.name ? ["--name", opts.name] : []),
    ...(opts.domainLabel ? ["--domain-label", opts.domainLabel] : []),
    ...(opts.extraArgs ?? []),
    "--json",
  ];
}

/** True when the result carries an ENVIRONMENT_LIMIT_REACHED error. */
export function atEnvironmentLimit(result: CliResult): boolean {
  const envelope = result.envelope;
  return (
    !!envelope &&
    envelope.status === "error" &&
    envelope.errors.some(
      (error) => (error as { code?: string }).code === "ENVIRONMENT_LIMIT_REACHED",
    )
  );
}

/**
 * A transient upstream fault: an HTTP 502/503/504 from the Cloud API or its
 * task-status poll, or a connection-level failure. The Verification agreement
 * gives transient statuses a bounded retry budget; a momentary Cloud blip
 * during provisioning must not surface as a terminal creation failure
 * (observed: one HTTP 502 on the task-status check reported
 * TASK_STATUS_FAILED and failed a whole serial-leg scenario's Given).
 */
const TRANSIENT_FAULT =
  /HTTP 50[234]|Bad Gateway|Service Unavailable|Gateway Time-?out|network error|unable to connect|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN/i;

/** True when the result failed on a transient upstream fault. */
export function transientCreateFault(result: CliResult): boolean {
  const envelope = result.envelope;
  return (
    !!envelope &&
    envelope.status === "error" &&
    envelope.errors.some((error) => TRANSIENT_FAULT.test(JSON.stringify(error)))
  );
}

async function reclaimOneSlot(ctx: ReclaimContext): Promise<void> {
  for (const env of leftoverTestEnvironments(
    await listAllEnvironments(ctx.token),
    ctx.runNamespace,
    ctx.spareNames,
  )) {
    await deleteEnvironment(ctx.token, env.org, env.key);
  }
}

/**
 * Create a real Saleor Cloud environment via `jolly create store
 * --create-environment`, waiting out ENVIRONMENT_LIMIT_REACHED within the given
 * budget (optionally reclaiming a slot first). Returns the CLI result for the
 * caller to derive values from or assert against; it does not itself assert
 * success, so a caller that inspects a reuse or limit outcome can do so.
 */
export async function createEnvironment(
  run: CliRunner,
  opts: CreateEnvironmentOptions = {},
): Promise<CliResult> {
  const args = buildArgs(opts);
  // The expensive spend is recorded at this single creation seam, attributed to
  // the running scenario or to shared provisioning (feature verification-economy).
  recordSpend({ spend: "environment-creation", argv: args });
  const deadline = Date.now() + (opts.limitBudgetMs ?? 0);
  // Bounded, signal-matched retry of a transient upstream fault. Retrying the
  // create is duplicate-safe: every caller namespaces and registers teardown
  // before creating, and the CLI reuses a same-label environment rather than
  // duplicating (feature 012), so a retry after a mid-flight 5xx converges on
  // the same environment. Two retries with short backoff, then the last
  // result surfaces loudly — never an unbounded loop, never a silent pass.
  const runCreate = async (): Promise<CliResult> => {
    let result = await run(args, opts.runOptions);
    for (let attempt = 0; attempt < 2 && transientCreateFault(result); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10_000 * (attempt + 1)));
      result = await run(args, opts.runOptions);
    }
    return result;
  };
  let result = await runCreate();
  while (atEnvironmentLimit(result) && Date.now() < deadline) {
    if (opts.reclaim) await reclaimOneSlot(opts.reclaim);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    result = await runCreate();
  }
  // The outcome the CLI reports. `environmentCreated: false` means it answered
  // with an environment that already existed, so nothing was created and no
  // expensive spend was made; annul the pre-recorded creation entry so the
  // licence join judges the real spend. A result that reports no outcome at all
  // leaves the creation entry standing, which is the safe direction.
  const data = findEnvelope(result.stdout)?.data as
    | { environmentCreated?: unknown }
    | undefined;
  if (data?.environmentCreated === false) {
    recordSpend({ spend: "environment-reuse", argv: args });
  }
  return result;
}
