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

function failedStages(core: CloseEnvelope): string[] {
  const stages = (core.data as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  return (stages as StageEntry[])
    .filter(
      (s) =>
        SIDE_EFFECTING.includes(s.stage) &&
        (s.status === "blocked" || s.status === "failed"),
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
  opts: { endpoint?: string; stripeStep: string },
): E {
  const failed = failedStages(core);

  let summary: string;
  if (failed.length > 0) {
    const stageLabel = failed.join(", ");
    const reasons = failureReasons(core);
    const plural = failed.length > 1 ? "stages" : "stage";
    summary =
      `Setup did not finish — the ${stageLabel} ${plural} failed` +
      (reasons.length > 0 ? `: ${reasons.join("; ")}` : "") +
      ".";
  } else {
    const dashboardUrl = dashboardUrlFrom(core, opts.endpoint);
    const storefrontUrl = storefrontUrlFrom(core);
    const parts: string[] = [];
    if (dashboardUrl) parts.push(`Saleor Dashboard: ${dashboardUrl}`);
    if (storefrontUrl) parts.push(`storefront: ${storefrontUrl}`);
    const urls = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
    summary = `Your store is live${urls}. ${opts.stripeStep}`;
  }

  return { ...core, summary, checks: [], nextSteps: [] } as E;
}
