// Harness for the device-authorization-grant @exceptional-double (feature 018):
// start the local fake Saleor auth host and point Jolly at it through the
// JOLLY_SALEOR_AUTH_URL realm-base override.
//
// The fake runs as a SEPARATE process (fake-auth-host-server.cjs) because the
// harness drives the CLI with blocking spawnSync (runCli / runUnderPty); an
// in-process server would never get a turn to answer. The fake approves the
// device grant on the first token poll, so Jolly's real request, relay, poll,
// and token-store path completes without waiting on a human authorization that
// cannot be produced on demand.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JollyWorld } from "./world.ts";

/**
 * Marker embedded in every JWT the fake host issues. The step file decodes a
 * stored token and checks for it, proving the token came from THIS grant rather
 * than some other source.
 */
export const FAKE_AUTH_MARKER = "jolly-fake-device-grant";

/** Keycloak-format device user code the fake returns (USER_CODE_RE matches it). */
export const FAKE_AUTH_USER_CODE = "WDJB-MJHT";

/**
 * The canonical Saleor verification URL the fake returns as `verification_uri`,
 * so the code + URL Jolly displays/relays match the scenario assertions even
 * though the requests reach the local host.
 */
export const FAKE_AUTH_VERIFICATION_URI =
  "https://auth.saleor.io/realms/saleor-cloud/device";

const SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "fake-auth-host-server.cjs",
);

interface FakeAuthHostOptions {
  /**
   * Answer the first token poll with this OAuth error (e.g. "slow_down") and
   * approve the next, so Jolly's real backoff path runs. The server records
   * poll arrival times, served at GET /polls on the host origin.
   */
  firstPollError?: string;
}

/**
 * Start the fake Saleor auth host as a separate process and set
 * JOLLY_SALEOR_AUTH_URL to its realm base, so the spawned CLI (which inherits
 * the test process env) directs the device + refresh grant there. Registers
 * teardown to stop the process and restore the previous env value. Returns the
 * realm-base URL.
 */
export async function startFakeAuthHost(
  world: JollyWorld,
  options: FakeAuthHostOptions = {},
): Promise<string> {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      FAKE_AUTH_MARKER,
      FAKE_AUTH_USER_CODE,
      FAKE_AUTH_VERIFICATION_URI,
      ...(options.firstPollError
        ? { FAKE_AUTH_FIRST_POLL: options.firstPollError }
        : {}),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("fake auth host did not report a port within 10s")),
      10_000,
    );
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fake auth host exited before reporting a port (code ${code})`));
    });
  });
  const realmBase = `http://127.0.0.1:${port}/realms/saleor-cloud`;
  const previous = process.env["JOLLY_SALEOR_AUTH_URL"];
  process.env["JOLLY_SALEOR_AUTH_URL"] = realmBase;
  world.cleanup.register(`fake auth host :${port}`, () => {
    if (previous === undefined) delete process.env["JOLLY_SALEOR_AUTH_URL"];
    else process.env["JOLLY_SALEOR_AUTH_URL"] = previous;
    child.kill("SIGKILL");
  });
  return realmBase;
}
