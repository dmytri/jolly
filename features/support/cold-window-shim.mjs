// Cold-start-window fetch shim, preloaded into the spawned Jolly CLI process
// (NODE_OPTIONS --import, composed by feature 002's "the store stage runs"
// step) for the scenario "jolly start waits for a not-yet-serving store to
// serve before completing the store stage".
//
// @exceptional-double: a store endpoint inside its cold-start window (feature
// 026 Rule "Live-by-design conformance"). The REAL fresh-provision wait is
// proven for real at the shared provisioning seam's first build and self-heal
// (features/support/provision.ts); re-provisioning a store per run to
// reproduce the window is the re-spend the licensed-spend rule forbids. This
// shim doubles ONLY the window: the CLI's own live GraphQL readiness probes
// (`query { __typename }`) against the resolved store's host are refused for
// the first HARNESS_COLD_PROBE_REFUSALS probes — observed cold, exactly as a
// cold-starting store refuses its first probes — and every other request, and
// every probe after the window, passes through untouched to the LIVE shared
// store. Nothing is canned: beyond the refusals, every byte the CLI sees is
// the real endpoint's real answer.
//
// Only probe-shaped requests are refused so a DEFECTIVE (gate-less) production
// build cannot be pushed into a real configurator deploy by a refused catalog
// read: stage traffic always passes through to the live store, and the missing
// gate is what the scenario's ledger assertion catches (the FIRST store-host
// contact must be a refused readiness probe).
//
// One JSON line per intercepted store-host request is appended to
// HARNESS_COLD_LEDGER — the scenario's observation ledger.
import { appendFileSync } from "node:fs";

const host = process.env.HARNESS_COLD_HOST;
const ledger = process.env.HARNESS_COLD_LEDGER;
if (host && ledger) {
  const refusals = Number(process.env.HARNESS_COLD_PROBE_REFUSALS ?? "3");
  const realFetch = globalThis.fetch;
  let probes = 0;
  globalThis.fetch = async function coldWindowFetch(input, init) {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return realFetch(input, init);
    }
    if (url.hostname !== host) return realFetch(input, init);
    const body = typeof init?.body === "string" ? init.body : "";
    const probeShaped = body.includes("__typename");
    const refused = probeShaped && ++probes <= refusals;
    appendFileSync(
      ledger,
      JSON.stringify({
        t: Date.now(),
        path: url.pathname,
        probeShaped,
        refused,
      }) + "\n",
    );
    if (refused) {
      throw new TypeError(
        `fetch failed: ${host} is not yet serving (cold-start window, probe refusal ${probes}/${refusals})`,
      );
    }
    return realFetch(input, init);
  };
}
