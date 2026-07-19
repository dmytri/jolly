// Task-status-poll loopback Cloud API (feature 004, task-poll retry scenarios).
//
// Drives the REAL create-environment path (org / project / service /
// environment) against a LOCAL in-process Cloud API that answers the read GETs,
// SUCCEEDS the environment-creation POST with a `task_id`, and then answers the
// GET /platform/api/service/task-status/{task_id}/ poll with an HTTP 502 —
// exactly once before reporting the task SUCCEEDED ("one-502-then-done"), or on
// every poll ("always-502"). Every poll served is recorded in order, so the
// retry contract is observable directly: "502" then "succeeded" and nothing
// after is a retry that stopped at the first successful poll.
//
// The succeeded task's result domain points at this harness's own HTTPS
// GraphQL responder, which answers the `query { __typename }` readiness probe
// (provisionStore rebuilds the domain as `https://…/graphql/`, so the responder
// must really serve TLS). The child CLI trusts it via NODE_EXTRA_CA_CERTS with
// the committed loopback-test certificate (features/support/tls/, generated
// once with `openssl req -x509 … -addext "subjectAltName=IP:127.0.0.1"`; it
// secures nothing but this 127.0.0.1 test responder).
//
// @exceptional-double: a momentary HTTP 502 on the Cloud task-status poll — one
// bad poll answer in an otherwise-successful provisioning — cannot be produced
// on demand against the real Cloud API (observed in the wild exactly once,
// where it failed a whole serial-leg scenario's Given; see
// features/support/env-factory.ts). This loopback injects that answer, once or
// persistently, and creates no real resource. It never replaces normal-path
// real coverage: the real create-and-poll path is exercised by the @sandbox
// provisioning (features 004/012).
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";
import type { JollyWorld } from "./world.ts";

/** How the harness answers the task-status poll. */
export type TaskPollMode = "one-502-then-done" | "always-502";

export interface TaskPollHarness {
  /** The Cloud API base to point Jolly at (JOLLY_SALEOR_CLOUD_API_URL). */
  baseUrl: string;
  /** Certificate path for NODE_EXTRA_CA_CERTS: the child CLI trusts the
   *  harness's HTTPS GraphQL responder (readiness probe) with it. */
  caCertPath: string;
  /** Task-status polls served, in order: "502" or "succeeded". */
  polls: Array<"502" | "succeeded">;
  /** GraphQL readiness probes the HTTPS responder answered. */
  probes: number;
}

const TLS_DIR = join(REPO_ROOT, "features", "support", "tls");
const TASK_ID = "jolly-task-poll-task";
const ENV_KEY = "jolly-task-poll-env";

export async function startTaskPollCloudApi(
  world: JollyWorld,
  mode: TaskPollMode,
): Promise<TaskPollHarness> {
  const polls: Array<"502" | "succeeded"> = [];
  const harness: TaskPollHarness = {
    baseUrl: "",
    caCertPath: join(TLS_DIR, "loopback-test.crt"),
    polls,
    probes: 0,
  };

  // The HTTPS GraphQL responder the succeeded task's domain points at: it
  // answers the readiness probe's `query { __typename }` as a real GraphQL
  // endpoint, over real TLS, so a retried-to-success provisioning ends
  // "success" rather than timing out the readiness gate.
  const graphqlServer = createHttpsServer(
    {
      key: readFileSync(join(TLS_DIR, "loopback-test.key")),
      cert: readFileSync(join(TLS_DIR, "loopback-test.crt")),
    },
    (req, res) => {
      harness.probes += 1;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Connection", "close");
      res.statusCode = 200;
      res.end(JSON.stringify({ data: { __typename: "Query" } }));
    },
  );
  graphqlServer.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => graphqlServer.listen(0, "127.0.0.1", resolve));
  const graphqlAddress = graphqlServer.address();
  const graphqlPort =
    typeof graphqlAddress === "object" && graphqlAddress ? graphqlAddress.port : 0;
  const domain = `127.0.0.1:${graphqlPort}`;

  const server: Server = createHttpServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Connection", "close");
    if (/\/task-status\//.test(url)) {
      // The poll under test: a transient (or persistent) upstream 502.
      if (mode === "always-502" || polls.length === 0) {
        polls.push("502");
        res.statusCode = 502;
        res.end(JSON.stringify({ detail: "Bad Gateway" }));
        return;
      }
      polls.push("succeeded");
      res.statusCode = 200;
      res.end(JSON.stringify({ status: "SUCCEEDED", result: { domain } }));
      return;
    }
    if (method === "POST" && /\/environments\/?($|\?)/.test(url)) {
      // Environment creation is ACCEPTED with a task_id (async provisioning),
      // and no domain: the domain arrives only in the succeeded task's result,
      // so completion genuinely rides on the task-status poll.
      res.statusCode = 201;
      res.end(JSON.stringify({ name: ENV_KEY, key: ENV_KEY, task_id: TASK_ID }));
      return;
    }
    res.statusCode = 200;
    // Order: /services/ before /projects/ (the services path also contains
    // "/projects/"); the keyed environment GET before the bare list.
    if (/\/services\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([]));
      return;
    }
    if (/\/projects\/?($|\?)/.test(url)) {
      res.end(JSON.stringify([{ name: "jolly-store", slug: "jolly-store" }]));
      return;
    }
    if (new RegExp(`/environments/${ENV_KEY}/?($|\\?)`).test(url)) {
      res.end(JSON.stringify({ name: ENV_KEY, key: ENV_KEY, domain }));
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
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  harness.baseUrl = `http://127.0.0.1:${port}/platform/api`;
  world.cleanup.register(`task-poll Cloud API server :${port}`, () => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  world.cleanup.register(`task-poll GraphQL responder :${graphqlPort}`, () => {
    return new Promise<void>((resolve) => graphqlServer.close(() => resolve()));
  });
  return harness;
}
