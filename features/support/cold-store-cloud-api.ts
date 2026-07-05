// Cold-store readiness loopback Cloud API.
//
// Drives the REAL store-provisioning path (org / project / service /
// environment) against a LOCAL in-process Cloud API that answers the read GETs
// and SUCCEEDS the environment-creation POST, but hands back a namespaced,
// NON-EXISTENT `*.saleor.cloud` domain. `runStoreStage`'s readiness gate then
// probes a first-party endpoint that never answers as GraphQL, so the gate runs
// out its readiness budget and blocks the store stage — exactly the "never
// becomes reachable" condition.
//
// @exceptional-double: a freshly-provisioned Saleor Cloud store whose GraphQL
// endpoint NEVER becomes reachable cannot be produced against the real Cloud (a
// real store cold-starts and then serves). This loopback injects that
// never-serving endpoint. It never replaces the real path: the sibling "waits"
// scenario exercises a real `jolly start --yes` auto-provision, whose fresh
// store genuinely cold-starts and then serves.
import { createServer, type Server } from "node:http";
import type { JollyWorld } from "./world.ts";

export interface ColdStoreHarness {
  server: Server;
  /** The Cloud API base to point Jolly at (JOLLY_SALEOR_CLOUD_API_URL). */
  baseUrl: string;
  /** The GraphQL endpoint provisioning hands back — a locally-refused address
   *  that never answers a live GraphQL probe, deterministically and offline. */
  unreachableEndpoint: string;
}

export async function startColdStoreCloudApi(
  world: JollyWorld,
): Promise<ColdStoreHarness> {
  // A locally-refused address (loopback, unused port 1): the readiness probe
  // never gets a GraphQL answer, deterministically and with no DNS or network
  // wait, so the gate runs out its whole readiness budget and blocks. A real
  // *.saleor.cloud subdomain would depend on live DNS (wildcard records resolve
  // to servers whose slow timeouts stretch the run past the budget under test);
  // a refused loopback address is the harmless, offline, instant "unreachable".
  const domain = "127.0.0.1:1";
  // @exceptional-double: a freshly-provisioned Saleor Cloud store whose GraphQL
  // endpoint never becomes reachable cannot be produced on demand against the
  // real Cloud (a real store cold-starts and then serves). This in-process Cloud
  // API drives the real create path, then hands back a never-serving endpoint so
  // the store stage's readiness gate blocks. It never replaces normal-path real
  // coverage: the sibling "waits" scenario exercises a real auto-provision.
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    if (method === "POST" && /\/environments\/?($|\?)/.test(url)) {
      // Environment creation SUCCEEDS with a real record: a domain that will
      // never serve. No task_id / key, so provisionStore uses this domain
      // directly and reports environmentCreated = true (the gate only runs for a
      // freshly created environment).
      res.statusCode = 201;
      res.end(JSON.stringify({ name: "jolly-cold-store", domain }));
      return;
    }
    res.statusCode = 200;
    // Order: /services/ before /projects/ (the services path also contains
    // "/projects/"). Empty services → provisionStore's pickService falls back to
    // the "saleor" default. An existing project is reused (no project-creation
    // POST); an empty environment list forces the create path.
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
  world.cleanup.register(`cold-store Cloud API server :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { server, baseUrl, unreachableEndpoint: `https://${domain}/graphql/` };
}
