// Pure transform of the completed `runStartCore` envelope into the interactive
// `jolly start` human close (feature 027 Rule "Interactive start runs
// end-to-end in one session"). The close is a CONCISE prose summary — not the
// machine envelope — that:
//   - on success names the live store URLs (Saleor Dashboard AND deployed
//     storefront) and ends with the remaining human Stripe step;
//   - on a GENUINE stage failure (a side-effecting stage that is blocked or
//     failed) reports the failure honestly and never fabricates success;
//   - never renders the per-check `checks[]` enumeration or the `nextSteps[]`
//     `next:` lines on the human stream.
//
// Structurally compatible with the feature-020 envelope (see
// features/support/envelope.ts). No I/O, no env reads, no imports from
// features/**. The human summary lines are sourced from the message catalog by
// key via `cliMessage` from the leaf `src/lib/messages.ts` module, which imports
// nothing from src/index.ts, so there is no circular import.
import { cliMessage } from "./messages.ts";

interface CloseEnvelope {
  command: string;
  status: string;
  summary: string;
  data: Record<string, unknown>;
  checks: Array<{ id: string; status: string; [key: string]: unknown }>;
  nextSteps: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

/**
 * Side-effecting stages whose blocked/failed status is a genuine failure.
 * @planks("the stage runners, the stage descriptions, the high-risk gate, and the side-effecting close list are each read")
 */
const SIDE_EFFECTING = ["store", "storefront", "recipe", "stock", "deploy", "stripe"];

interface StageEntry {
  stage: string;
  status: string;
}

// Side-effecting stages that did NOT complete. A "live" close requires EVERY
// side-effecting stage to be `completed` (or legitimately `skipped`, e.g. a
// store that was already configured). Anything else — `blocked`, `failed`, or
// `pending` (the stage never ran, e.g. the Vercel sign-in was not approved so
// deploy was left pending) — means setup did not finish, and the close must say
// so honestly rather than fabricate a live store (feature 027 Rule).
/**
 * @planks("the interactive output should state that setup stopped and nothing was created")
 */
function incompleteStages(core: CloseEnvelope): string[] {
  const stages = (core.data as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  return (stages as StageEntry[])
    .filter(
      (s) =>
        SIDE_EFFECTING.includes(s.stage) &&
        s.status !== "completed" &&
        s.status !== "skipped",
    )
    .map((s) => s.stage);
}

/**
 * @planks("the closing summary on stdout should name the store's Saleor Dashboard URL")
 */
function dashboardUrlFrom(core: CloseEnvelope, endpoint?: string): string | undefined {
  const store = (core.data as { store?: { dashboardUrl?: unknown } }).store;
  if (typeof store?.dashboardUrl === "string") return store.dashboardUrl;
  if (endpoint) {
    try {
      return new URL("/dashboard/", endpoint).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * @planks("the closing summary on stdout should name the deployed storefront URL")
 */
function storefrontUrlFrom(core: CloseEnvelope): string | undefined {
  const deploy = (core.data as {
    deploy?: { storefrontUrl?: unknown; deploymentUrl?: unknown };
  }).deploy;
  const url = deploy?.storefrontUrl ?? deploy?.deploymentUrl;
  return typeof url === "string" ? url : undefined;
}

// Short honest reasons for a failed run: the descriptions of the genuine
// stage-outcome failing checks. Pre-flight bootstrap readiness checks the run's
// own stages then resolve (`doctor-*` connectivity/presence probes, `init-*`
// bootstrap) are never a failure of the completed run (feature 027 Rule), so
// they are excluded — only true stage outcomes (e.g. `recipe-deployed`,
// `vercel-deployed`, `store-provisioned`, `stripe-app-installed`) remain.
/**
 * @planks("the interactive output should state that setup stopped and nothing was created")
 */
function failureReasons(core: CloseEnvelope): string[] {
  return core.checks
    .filter(
      (c) =>
        c.status === "fail" &&
        typeof c.description === "string" &&
        !c.id.startsWith("doctor-") &&
        !c.id.startsWith("init-"),
    )
    .map((c) => String(c.description));
}

/**
 * @planks("the human result on stdout should state in prose that the plan was previewed and nothing was created")
 * @planks("the human result on stdout should carry no per-check `[status] check-id` enumeration line")
 * @planks("the human result on stdout should carry no `next:` command line")
 * @planks("the closing summary on stdout should name the store's Saleor Dashboard URL")
 * @planks("the closing summary on stdout should name the deployed storefront URL")
 * @planks("the closing summary on stdout should name the Stripe Dashboard key entry as the human's remaining step")
 * @planks("the closing summary on stdout should not enumerate per-check results as `[status] check-id` lines")
 * @planks("the closing summary on stdout should not present the Saleor endpoint or SALEOR_TOKEN readiness check, which the store stage resolved, as a failure of the completed run")
 * @planks("the interactive output should state that setup stopped and nothing was created")
 */
export function interactiveCloseSummary<E extends CloseEnvelope>(
  core: E,
  opts: { endpoint?: string; stripeStep: string; link?: (url: string) => string },
): E {
  const incomplete = incompleteStages(core);
  const link = opts.link ?? ((url: string) => url);
  const dashboardUrl = dashboardUrlFrom(core, opts.endpoint);
  const storefrontUrl = storefrontUrlFrom(core);

  let summary: string;
  if (incomplete.length > 0) {
    // Honest close: name the stage(s) that did not finish and surface whatever
    // DID come up (e.g. the store exists even when deploy did not run), then
    // point at the re-run. Never claim the store is live.
    const stageLabel = incomplete.join(", ");
    const reasons = failureReasons(core);
    const plural =
      incomplete.length > 1
        ? cliMessage("start.close.stageWord.plural")
        : cliMessage("start.close.stageWord.singular");
    const reasonsText = reasons.length > 0 ? `: ${reasons.join("; ")}` : "";
    const lines = [
      cliMessage("start.close.notFinished", {
        stages: stageLabel,
        stageWord: plural,
        reasons: reasonsText,
      }),
    ];
    if (storefrontUrl) {
      lines.push(`  ${cliMessage("start.close.storefrontLabel")}       ${link(storefrontUrl)}`);
    }
    if (dashboardUrl) {
      lines.push(`  ${cliMessage("start.close.dashboardLabel")} ${link(dashboardUrl)}`);
    }
    lines.push(`  ${cliMessage("start.close.reRun")}`);
    summary = lines.join("\n");
  } else {
    // Every side-effecting stage completed — the store really is live. The
    // remaining Stripe step is a calm final note, each line on its own (027).
    const lines = [cliMessage("start.close.live")];
    if (storefrontUrl) {
      lines.push(`  ${cliMessage("start.close.storefrontLabel")}       ${link(storefrontUrl)}`);
    }
    if (dashboardUrl) {
      lines.push(`  ${cliMessage("start.close.dashboardLabel")} ${link(dashboardUrl)}`);
    }
    lines.push(`  ${opts.stripeStep}`);
    // A blank line, then a minimal "keep building" orientation: the two
    // artifacts setup leaves on disk and the CLI that drives each, with
    // reference links. Success-only — these files exist only once every stage
    // completed; the installed jolly skill carries the how-to.
    lines.push("");
    lines.push(`  ${cliMessage("start.close.keepBuilding")}`);
    lines.push(`  • ${cliMessage("start.close.keepStorefront")}`);
    lines.push(`  • ${cliMessage("start.close.keepRecipe")}`);
    lines.push(`  ${cliMessage("start.close.guides")}`);
    summary = lines.join("\n");
  }

  return { ...core, summary, checks: [], nextSteps: [] } as E;
}
