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
// features/** — `stripeStep` is passed in so this module never reaches back
// into the CLI's message catalog (avoids a circular import with src/index.ts).

interface CloseEnvelope {
  command: string;
  status: string;
  summary: string;
  data: Record<string, unknown>;
  checks: Array<{ id: string; status: string; [key: string]: unknown }>;
  nextSteps: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

// Side-effecting stages whose blocked/failed status is a genuine failure.
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
    const plural = incomplete.length > 1 ? "stages" : "stage";
    const lines = [
      `Setup did not finish — the ${stageLabel} ${plural} did not complete` +
        (reasons.length > 0 ? `: ${reasons.join("; ")}` : "") +
        ".",
    ];
    if (storefrontUrl) lines.push(`  Storefront:       ${link(storefrontUrl)}`);
    if (dashboardUrl) lines.push(`  Saleor Dashboard: ${link(dashboardUrl)}`);
    lines.push("  Re-run `jolly start` to finish the remaining stages.");
    summary = lines.join("\n");
  } else {
    // Every side-effecting stage completed — the store really is live. The
    // remaining Stripe step is a calm final note, each line on its own (027).
    const lines = ["Your store is live! 🎉"];
    if (storefrontUrl) lines.push(`  Storefront:       ${link(storefrontUrl)}`);
    if (dashboardUrl) lines.push(`  Saleor Dashboard: ${link(dashboardUrl)}`);
    lines.push(`  ${opts.stripeStep}`);
    summary = lines.join("\n");
  }

  return { ...core, summary, checks: [], nextSteps: [] } as E;
}
