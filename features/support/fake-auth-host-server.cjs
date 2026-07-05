// Standalone fake Saleor auth host for the device-authorization-grant
// @exceptional-double (feature 018). It runs as its OWN process: the harness
// drives the Jolly CLI with blocking spawnSync (runCli) and a blocking PTY
// driver (runUnderPty), either of which would deadlock an in-process server, so
// the fake must answer from a separate event loop.
//
// It implements the two Keycloak device-grant endpoints of the saleor-cloud
// realm and APPROVES on the first token poll, issuing marker-stamped JWTs so the
// step file can prove a stored token came from THIS grant. The CLI is pointed
// here through the JOLLY_SALEOR_AUTH_URL realm-base override. A `.cjs` extension
// keeps it out of cucumber's `features/support/**/*.ts` import glob.
const { createServer } = require("node:http");
const { randomBytes } = require("node:crypto");

const MARKER = process.env.FAKE_AUTH_MARKER;
const USER_CODE = process.env.FAKE_AUTH_USER_CODE;
const VERIFICATION_URI = process.env.FAKE_AUTH_VERIFICATION_URI;

function jwt(extra) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", typ: "JWT" });
  const payload = b64({ iss: "saleor-cloud", marker: MARKER, exp: now + 300, ...extra });
  return `${header}.${payload}.${randomBytes(24).toString("base64url")}`;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = req.url || "";
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && url.includes("/auth/device")) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          device_code: `fake-device-${randomBytes(8).toString("hex")}`,
          user_code: USER_CODE,
          verification_uri: VERIFICATION_URI,
          verification_uri_complete: `${VERIFICATION_URI}?user_code=${USER_CODE}`,
          interval: 1,
          expires_in: 600,
        }),
      );
      return;
    }
    if (req.method === "POST" && url.includes("/token")) {
      // The human approval cannot be produced on demand; approve on the first
      // poll so the real poll-and-store path completes without waiting. The same
      // endpoint answers the refresh grant (grant_type=refresh_token) with a
      // fresh marker-stamped access token, so Jolly's real refresh-and-store path
      // completes headlessly.
      const now = Math.floor(Date.now() / 1000);
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          access_token: jwt({ typ: "Bearer" }),
          refresh_token: jwt({ typ: "Refresh", exp: now + 86400 }),
          token_type: "Bearer",
          expires_in: 300,
        }),
      );
      return;
    }
    if (req.method === "GET" && url.includes("/organizations")) {
      // The platform-API organizations read Jolly makes with the refreshed
      // `Authorization: Bearer <access>` token. Returns an org ONLY when a
      // marker-stamped token this host issued is presented, so a scenario proves
      // Jolly actually made the Bearer read (not that Saleor's auth works — the
      // real device-grant token cannot be produced on demand, hence this double).
      const auth = req.headers["authorization"] || "";
      const bearer = /^Bearer\s+(.+)$/.exec(auth);
      let issued = false;
      if (bearer) {
        try {
          const part = bearer[1].split(".")[1];
          const payload = JSON.parse(Buffer.from(part, "base64url").toString());
          issued = payload.marker === MARKER;
        } catch {
          issued = false;
        }
      }
      if (!issued) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify([{ slug: "jolly-fake-org", name: "Jolly Fake Org" }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});
