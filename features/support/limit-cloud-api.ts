// Shared limit-rejecting Cloud API loopback harness.
//
// Drives the REAL create-environment path against a LOCAL in-process Cloud API
// that answers the read GETs (org/projects/envs/services) but rejects the
// environment-creation POST with a 4xx "limit" payload — exactly the condition
// Jolly maps to the stable ENVIRONMENT_LIMIT_REACHED code. The shared When (002
// step file) runs the real command against this loopback when notes.limitHarness
// is set, with the runtime credentials unset (plus a stand-in token), so no real
// account is touched.
//
// @exceptional-double: an organization already at its sandbox-environment limit
// cannot be produced on demand against the real test org (the harness reclaims
// capacity by deleting jolly-cannon-fodder environments), so this loopback returns the
// real ENVIRONMENT_LIMIT_REACHED rejection. It never replaces the real create
// path; features 004/012 @sandbox provisioning exercises a real `create store`.
import { createServer, type Server } from "node:http";
import type { JollyWorld } from "./world.ts";

export interface LimitHarness {
  server: Server;
  baseUrl: string;
  /** Writes (POST/PUT/DELETE) the run issued; only the env-create POST is expected. */
  writes: Array<{ method: string; url: string }>;
}

export async function startLimitRejectingCloudApi(
  world: JollyWorld,
): Promise<LimitHarness> {
  const writes: Array<{ method: string; url: string }> = [];
  // @exceptional-double: a Cloud organization already AT its environment limit
  // (so the create request is rejected with ENVIRONMENT_LIMIT_REACHED) cannot be
  // produced on demand without deleting real environments; this loopback injects
  // that rejection. The real provisioning path is covered by the @sandbox tier.
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    if (method === "POST" && /\/environments\/?($|\?)/.test(url)) {
      // The org's sandbox environment limit is reached: reject the creation.
      writes.push({ method, url });
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          detail:
            "You have reached the sandbox environment limit for this organization.",
        }),
      );
      return;
    }
    if (method !== "GET") {
      writes.push({ method, url });
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: "unexpected write during limit scenario" }));
      return;
    }
    res.statusCode = 200;
    // Order: /services/ before /projects/ (the services path also contains
    // "/projects/"). Return an existing project so creation REUSES it (no
    // project-creation POST), then an empty environment list, so the run
    // proceeds straight to the rejected environment-creation POST.
    if (/\/services\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/projects\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([{ name: "jolly-store", slug: "jolly-store" }]));
      return;
    }
    if (/\/environments\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/organizations\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([{ slug: "demo-org", name: "Demo Org" }]));
      return;
    }
    res.end(JSON.stringify([]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/platform/api`;
  world.cleanup.register(`limit-rejecting Cloud API server :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { server, baseUrl, writes };
}
