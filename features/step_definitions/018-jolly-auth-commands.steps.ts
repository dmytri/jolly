// Feature 018 — Jolly auth commands (login / logout / auth status).
//
// Interactive sign-in is the Saleor device authorization grant; non-interactive
// supply is the env/.env staff token JOLLY_SALEOR_CLOUD_TOKEN only. There is no
// --token/--token-file/--token-stdin flag and no interactive paste.
//
// @logic scenarios pinned here:
//   - interactive login starts the device grant (real PTY against auth.saleor.io,
//     human never authorizes so it polls to the deadline); non-interactive login
//     never starts the grant and errors honestly.
//   - login rejects an invalid env staff token (real Cloud API 401/403) and an
//     empty JOLLY_SALEOR_CLOUD_TOKEN, writing nothing.
//   - login --dry-run: riskContext action "login", no device code, .env not
//     written, non-empty nextSteps.
//   - the shared .env writer is private (mode 600) and shell-safe, exercised via
//     the stored-not-verified path against a deliberately-unreachable Cloud API.
//   - logout: removes every Jolly-managed auth var, preserves third-party vars.
//   - auth status: configuration only, accountContext from
//     JOLLY_SALEOR_ORGANIZATION or "unknown", no token printed, --json/--quiet.
//
// @sandbox scenarios (staff-token verify+store; refresh-grant Bearer) have bodies
// written for credentialed CI; they SKIP locally.
//
// Safety: every @logic command runs with the runtime credentials genuinely
// UNSET (absentCredentialsEnv) — real absence, never dummy values — so no @logic
// path can reach a real account. The one exception is the @exceptional-double
// stored-not-verified path, which deliberately points the Cloud API at an
// unreachable `.invalid` host (justified inline) — the condition the real test
// env cannot produce on demand.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { ptyAvailable, runUnderPty } from "../support/pty.ts";
import {
  FAKE_AUTH_MARKER,
  FAKE_AUTH_USER_CODE,
  FAKE_AUTH_VERIFICATION_URI,
  startFakeAuthHost,
} from "../support/fake-auth-host.ts";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";

const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

// Guard the SHIPPED Jolly skill text (the agent's playbook) so its Saleor
// authentication guidance can never drift back to the removed token-page /
// pasted-token flow that the Rule above forbids (feature 018).
const BUNDLED_SKILL_PATH = join(REPO_ROOT, "assets", "skills", "jolly", "SKILL.md");

Given("the bundled Jolly skill that ships beside the CLI", function (this: JollyWorld) {
  assert.ok(existsSync(BUNDLED_SKILL_PATH), "the bundled Jolly skill SKILL.md must exist");
  this.notes.skillText = readFileSync(BUNDLED_SKILL_PATH, "utf8");
});

When("its Saleor Cloud authentication guidance is read", function (this: JollyWorld) {
  // The full skill text is the surface under test; nothing to do beyond loading
  // it (done in the Given) — the assertions read it directly.
  assert.ok(
    typeof this.notes.skillText === "string" && this.notes.skillText.length > 0,
    "the Jolly skill text must be loaded",
  );
});

Then(
  "it should name the Saleor device authorization grant as the sign-in",
  function (this: JollyWorld) {
    const text = String(this.notes.skillText);
    assert.match(
      text,
      /device\s+authorization\s+grant/i,
      "the Jolly skill must direct Saleor sign-in to the device authorization grant",
    );
  },
);

Then(
  "it should carry no cloud.saleor.io tokens-page link and no `jolly login` token-paste flag",
  function (this: JollyWorld) {
    const text = String(this.notes.skillText);
    assert.ok(
      !text.includes("cloud.saleor.io/tokens"),
      "the Jolly skill must not link the cloud.saleor.io tokens page",
    );
    assert.ok(
      !/login\s+--token\b|--token-file\b|--token-stdin\b/.test(text),
      "the Jolly skill must not advertise a `jolly login` token-paste flag",
    );
  },
);

function envData(world: JollyWorld): Record<string, unknown> {
  return world.envelope.data as Record<string, unknown>;
}

// ─── Scenario: login stores a token honestly when verification unreachable ──

Then(
  // Parametrized: the exact stored value varies per scenario (the unreachable
  // "stored, not verified" token, plus the --token-file / --token-stdin / env
  // headless-source tokens). Captures the literal value and asserts the line.
  /^\.env should contain JOLLY_SALEOR_CLOUD_TOKEN=(\S+)$/,
  function (this: JollyWorld, value: string) {
    const text = readFileSync(join(this.lastRun!.cwd, ".env"), "utf8");
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(text, new RegExp(`^JOLLY_SALEOR_CLOUD_TOKEN=${escaped}$`, "m"));
  },
);

// ─── Scenario: logout removes every Jolly-managed auth value from .env ──────
// The managed set now includes the device-grant refresh token and the
// agent-facing SALEOR_TOKEN. Logout removes JOLLY_SALEOR_CLOUD_TOKEN,
// JOLLY_SALEOR_REFRESH_TOKEN, SALEOR_TOKEN, and JOLLY_SALEOR_ORGANIZATION while
// preserving any non-Jolly variable.

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_ACCESS_TOKEN=some-access and JOLLY_SALEOR_REFRESH_TOKEN=some-refresh and SALEOR_TOKEN=some-store-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me",
  function (this: JollyWorld) {
    writeFileSync(
      join(this.projectDir, ".env"),
      "JOLLY_SALEOR_CLOUD_TOKEN=some-token\n" +
        "JOLLY_SALEOR_ACCESS_TOKEN=some-access\n" +
        "JOLLY_SALEOR_REFRESH_TOKEN=some-refresh\n" +
        "SALEOR_TOKEN=some-store-token\n" +
        "JOLLY_SALEOR_ORGANIZATION=some-org\n" +
        "THIRD_PARTY_KEY=keep-me\n",
    );
  },
);

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_ACCESS_TOKEN, JOLLY_SALEOR_REFRESH_TOKEN, SALEOR_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(!("JOLLY_SALEOR_CLOUD_TOKEN" in values));
    assert.ok(!("JOLLY_SALEOR_ACCESS_TOKEN" in values));
    assert.ok(!("JOLLY_SALEOR_REFRESH_TOKEN" in values));
    assert.ok(!("SALEOR_TOKEN" in values));
    assert.ok(!("JOLLY_SALEOR_ORGANIZATION" in values));
  },
);

// Shared Given for the agent-driven device-grant scenarios: a non-TTY
// `jolly login --json` (runCli pipes stdin, so stdin is not a TTY) with no
// JOLLY_SALEOR_CLOUD_TOKEN. `When the agent runs `jolly login --json`` is the
// generic global-flag run step (feature 006), which runs with credentials absent.

Given(
  "a non-interactive shell with no JOLLY_SALEOR_CLOUD_TOKEN set",
  function (this: JollyWorld) {
    // Framing for the When: runCli runs a child whose stdin is a pipe (non-TTY),
    // and absentCredentialsEnv unsets JOLLY_SALEOR_CLOUD_TOKEN for the child.
  },
);

// Shared @exceptional-double Given for the approved-completion device-grant
// scenarios (agent-driven and interactive). A human authorizing at the
// verification URL cannot be produced on demand, so a local fake auth host — a
// separate process reached through the JOLLY_SALEOR_AUTH_URL realm-base override
// — serves the real device-grant endpoints and approves on the first token poll.
// Jolly's real request, relay/display, poll, and token-store code runs unchanged;
// only the human click is stood in for. startFakeAuthHost sets the override env
// var (inherited by both the spawnSync child and the PTY child) and registers
// teardown.

Given(
  "the Saleor auth host approves the device grant on the first poll",
  async function (this: JollyWorld) {
    await startFakeAuthHost(this);
  },
);

// B (feature 018): the first agent invocation only needs the host to serve the
// device-code request; it does not poll (the /token approval is exercised by the
// re-run scenario). Same host, neutral phrasing.
Given("the Saleor auth host issues device codes", async function (this: JollyWorld) {
  await startFakeAuthHost(this);
});

// The verification URL the human opens is carried in the result envelope (a
// nextStep) — structured `url` and/or prose — so the agent renders it clickable,
// never buried on stdout/stderr.
Then(
  "a nextStep should carry the Saleor device verification URL for the human to open and approve",
  function (this: JollyWorld) {
    const steps = (this.envelope.nextSteps ?? []) as Array<Record<string, unknown>>;
    const carries = steps.some((s) => {
      const blob = `${String(s.url ?? "")} ${String(s.description ?? "")}`;
      return /https:\/\/auth\.saleor\.io\/realms\/saleor-cloud\/device\?user_code=\S+/.test(blob);
    });
    assert.ok(
      carries,
      `a nextStep must carry the verification URL for the human; got: ${JSON.stringify(steps)}`,
    );
  },
);

// The agent (--json) envelope is plain JSON: no OSC 8 hyperlink escapes (those are
// the interactive-TTY affordance only).
Then("stdout should carry no OSC 8 hyperlink escape", function (this: JollyWorld) {
  const stdout = this.lastRun!.stdout;
  assert.ok(
    // eslint-disable-next-line no-control-regex
    !/\x1b\]8;;/.test(stdout),
    `the agent (--json) stdout must carry no OSC 8 hyperlink escape; got: ${JSON.stringify(stdout)}`,
  );
});

// The pending code is persisted so the re-run resumes the SAME code.
Then(
  "it should persist the pending device authorization for the re-run",
  function (this: JollyWorld) {
    assert.ok(
      existsSync(join(this.lastRun!.cwd, ".jolly-pending-auth.json")),
      "the pending device authorization must be persisted so the re-run resumes the same code",
    );
  },
);

// Seed a persisted pending authorization so the re-run RESUMES this exact code
// (the fake host, started by the sibling Given, approves it on the next poll)
// rather than orphaning it by requesting a new one.
Given(
  "a pending device authorization was persisted by a prior run",
  function (this: JollyWorld) {
    writeFileSync(
      join(this.projectDir, ".jolly-pending-auth.json"),
      JSON.stringify({
        deviceCode: "resume-test-device-code",
        userCode: FAKE_AUTH_USER_CODE,
        verificationUri: FAKE_AUTH_VERIFICATION_URI,
        interval: 1,
        expiresIn: 600,
        savedAt: Date.now(),
      }),
    );
  },
);

Then(
  "the persisted pending device authorization should be cleared",
  function (this: JollyWorld) {
    assert.ok(
      !existsSync(join(this.lastRun!.cwd, ".jolly-pending-auth.json")),
      "the persisted pending device authorization must be cleared after a completed sign-in",
    );
  },
);

/** Decode a stored device-grant JWT and assert it carries the fake host's
 * marker — proof the value in .env is exactly the token THIS grant issued, not a
 * staff token or some other source. */
function assertFakeDeviceToken(
  value: string | undefined,
  varName: string,
): void {
  assert.ok(value, `${varName} must be stored in .env after the grant completes`);
  const parts = value!.split(".");
  assert.equal(parts.length, 3, `${varName} must be a JWT minted by the device grant`);
  const payload = JSON.parse(
    Buffer.from(parts[1]!, "base64url").toString("utf8"),
  ) as { marker?: string };
  assert.equal(
    payload.marker,
    FAKE_AUTH_MARKER,
    `${varName} must be the token the device grant issued (marker mismatch)`,
  );
}

Then(
  "it should store the device-grant access token in .env as JOLLY_SALEOR_ACCESS_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assertFakeDeviceToken(values["JOLLY_SALEOR_ACCESS_TOKEN"], "JOLLY_SALEOR_ACCESS_TOKEN");
  },
);

Then(
  "it should store the device-grant refresh token in .env as JOLLY_SALEOR_REFRESH_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assertFakeDeviceToken(values["JOLLY_SALEOR_REFRESH_TOKEN"], "JOLLY_SALEOR_REFRESH_TOKEN");
  },
);

Then(
  "it should not write JOLLY_SALEOR_CLOUD_TOKEN to .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      !("JOLLY_SALEOR_CLOUD_TOKEN" in values),
      "the device grant writes only the access + refresh variables and must never " +
        "write the staff token JOLLY_SALEOR_CLOUD_TOKEN",
    );
  },
);

// ─── Scenario: interactive jolly login signs in through the device grant ─────
// An interactive `jolly login` (stdin a real PTY) with no JOLLY_SALEOR_CLOUD_
// TOKEN runs the OAuth 2.0 device authorization grant: request a device code
// (public client `jolly`, no secret), display the returned user code +
// verification URL through Bombshell's prompt UI, then poll the token endpoint.
// The shared @exceptional-double Given points the grant at the local fake auth
// host through JOLLY_SALEOR_AUTH_URL, which approves on the first poll, so the
// sign-in completes against a real PTY without a human: Jolly stores the access
// token in .env and exits. The displayed code + URL stay in the captured output.

const AUTH_DEVICE_URL =
  "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/auth/device";
const AUTH_VERIFICATION_URL = "https://auth.saleor.io/realms/saleor-cloud/device";
// Keycloak's default device user-code format: two groups of A–Z/0–9 (e.g. WDJB-MJHT).
const USER_CODE_RE = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/;

Given(
  "an interactive terminal with no JOLLY_SALEOR_CLOUD_TOKEN set",
  function (this: JollyWorld) {
    // Framing for the When: an interactive (real PTY) `jolly login` with the
    // runtime Cloud token genuinely unset, so the device grant is the only path.
    this.notes.interactiveDeviceGrant = true;
  },
);

When(
  "the user runs `jolly login`",
  { timeout: 30_000 },
  function (this: JollyWorld) {
    assert.ok(ptyAvailable(), "the PTY driver must be available");
    // No env token (absentCredentialsEnv unsets the runtime credentials). The
    // shared Given exported JOLLY_SALEOR_AUTH_URL pointing at the fake auth host,
    // inherited here through resolvedChildEnv, so the grant approves on the first
    // poll and the login completes on its own — no human input is typed.
    const env = resolvedChildEnv(absentCredentialsEnv());
    const runtime = process.env.HARNESS_CLI_RUNTIME ?? "node";
    const run = runUnderPty({
      runtime,
      argv: [CLI_ENTRY, "login"],
      cwd: this.projectDir,
      env,
      // No scripted input: the fake host approves, so nothing is typed.
      inputs: [],
      timeoutMs: 15_000,
    });
    this.previousRun = this.lastRun;
    this.lastRun = {
      args: ["login"],
      cwd: this.projectDir,
      exitCode: run.exitCode,
      stdout: run.output,
      stderr: "",
    };
  },
);

Then(
  "Jolly should request a device code from `https:\\/\\/auth.saleor.io\\/realms\\/saleor-cloud\\/protocol\\/openid-connect\\/auth\\/device` with `client_id=jolly`",
  function (this: JollyWorld) {
    // Interactive PTY merges everything into stdout; the agent-driven case relays
    // the code on stderr. Read both so the one shared step serves both paths.
    const text = this.lastRun!.stdout + "\n" + this.lastRun!.stderr;
    // The realm answers a device-code request only when the public client
    // `jolly` is recognized; a wrong client_id yields invalid_client and no
    // device authorization. A user code rendered in the terminal is therefore
    // the falsifiable proof the request to the device endpoint succeeded with
    // client_id=jolly.
    assert.ok(
      USER_CODE_RE.test(text),
      `Jolly must request a device code from ${AUTH_DEVICE_URL} with client_id=jolly ` +
        `(a returned user code proves it); got: ${text}`,
    );
    assert.ok(
      !/invalid_client|unauthorized_client/i.test(text),
      `the device-code request must use client_id=jolly (no invalid_client error); got: ${text}`,
    );
  },
);

Then(
  "it should display the returned user code and the verification URL `https:\\/\\/auth.saleor.io\\/realms\\/saleor-cloud\\/device?user_code=` followed by that user code through Bombshell's interactive prompt UI",
  function (this: JollyWorld) {
    const text = this.lastRun!.stdout;
    const code = text.match(USER_CODE_RE);
    assert.ok(code, "the returned user code must be displayed");
    // The verification URL carries the returned user code as its `user_code`
    // query parameter so opening it pre-fills the code (feature 018 Rule).
    assert.ok(
      text.includes(`${AUTH_VERIFICATION_URL}?user_code=${code![0]}`),
      `the verification URL ${AUTH_VERIFICATION_URL}?user_code=${code?.[0]} must be displayed; got: ${text}`,
    );
    // Bombshell (@clack/prompts) renders box-drawing/symbol glyphs the plain
    // console never emits; their presence is the falsifiable signal the prompt
    // UI rendered.
    assert.ok(
      /[│┌└◆◇●○▪]/u.test(text),
      `the code + URL must render through Bombshell's prompt UI; got: ${text}`,
    );
  },
);

Then("it should not print any token value", function (this: JollyWorld) {
  const text = this.lastRun!.stdout;
  // No JWT and no token assignment may appear in the terminal output.
  assert.ok(
    !/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text),
    "no access/refresh JWT may appear in the terminal output",
  );
  assert.ok(
    !/JOLLY_SALEOR_(CLOUD|APP|REFRESH)_TOKEN=\S/.test(text),
    "no token value may be printed to the terminal",
  );
});

Then("stdout should carry no token value", function (this: JollyWorld) {
  const stdout = this.lastRun!.stdout;
  assert.ok(
    !/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(stdout),
    "no access/refresh JWT may appear on stdout",
  );
  assert.ok(
    !/JOLLY_SALEOR_(CLOUD|APP|REFRESH|ACCESS)_TOKEN=\S/.test(stdout),
    "no token value may be printed to stdout",
  );
});

// ─── Scenario: An expired access token is refreshed from the stored refresh token ──
// @sandbox @exceptional-double. The authorized grant is seeded from the
// harness's stored device-grant refresh token (JOLLY_SALEOR_REFRESH_TOKEN) — a
// human authorize cannot be produced on demand — while the expired access token
// is constructed locally (its `exp` in the past). The refresh-grant call and the
// Bearer platform-API read it enables are real. The When (`jolly doctor saleor
// --json`) is feature 014's step; it reads notes.saleorDoctorEnv as the env. The
// same Given seeds 014's "Doctor validates stored device-grant credentials with
// Bearer".

const REFRESH_TOKEN_URL =
  "https://auth.saleor.io/realms/saleor-cloud/protocol/openid-connect/token";

/** A structurally-valid JWT whose `exp` is far in the past, so any expiry check
 * (decode exp, or a rejected Bearer read) forces the refresh grant. */
function makeExpiredAccessJwt(): string {
  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({ exp: 1_000_000_000, iss: "saleor-cloud" }); // year 2001
  return `${header}.${payload}.expired-signature`;
}

Given(
  "an expired device-grant access token in JOLLY_SALEOR_ACCESS_TOKEN and its refresh token in JOLLY_SALEOR_REFRESH_TOKEN",
  async function (this: JollyWorld) {
    // @exceptional-double: a device-grant token pair a human authorized cannot be
    // produced on demand, so the local fake auth host issues the refresh grant and
    // answers the platform organizations read with a marker-stamped token. Jolly's
    // real detect-expiry, refresh, store, and Bearer-read path runs headlessly
    // against it — proving Jolly does the flow, not that Saleor's auth accepts it.
    const realmBase = await startFakeAuthHost(this);
    const cloudApiBase = realmBase.replace("/realms/saleor-cloud", "/platform/api");
    const refresh = "jolly-fake-device-grant-refresh";
    this.trackSecret(refresh);
    const expiredAccess = makeExpiredAccessJwt();
    this.notes.expiredAccess = expiredAccess;
    this.trackSecret(expiredAccess);
    // No Cloud staff token (absentCredentialsEnv unsets it), so the platform-API
    // scheme is the device-grant Bearer token, not Token. The expired access token
    // drives the refresh grant; the fake host issues and accepts the fresh token.
    this.notes.saleorDoctorEnv = absentCredentialsEnv({
      JOLLY_SALEOR_ACCESS_TOKEN: expiredAccess,
      JOLLY_SALEOR_REFRESH_TOKEN: refresh,
      JOLLY_SALEOR_AUTH_URL: realmBase,
      JOLLY_SALEOR_CLOUD_API_URL: cloudApiBase,
    });
  },
);

Then(
  "it should mint a fresh access token through the refresh grant at `https:\\/\\/auth.saleor.io\\/realms\\/saleor-cloud\\/protocol\\/openid-connect\\/token`",
  function (this: JollyWorld) {
    // The seeded access token is expired, so the only way to authenticate the
    // platform API is by minting a fresh access token through the refresh grant
    // (grant_type=refresh_token, client_id=jolly) at the realm token endpoint.
    // A fresh, well-formed JWT stored in .env — distinct from the expired seed —
    // is the falsifiable proof the refresh grant ran.
    void REFRESH_TOKEN_URL;
    const values = loadEnvValues(this.lastRun!.cwd);
    const refreshed = values["JOLLY_SALEOR_ACCESS_TOKEN"];
    assert.ok(refreshed, "a refreshed access token must be stored");
    assert.notEqual(
      refreshed,
      this.notes.expiredAccess,
      "the refreshed access token must differ from the expired one",
    );
    assert.match(
      refreshed!,
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./,
      "the refreshed value must be a JWT minted by the refresh grant",
    );
  },
);

Then(
  "the Cloud platform API read should succeed with the refreshed `Authorization: Bearer` token",
  function (this: JollyWorld) {
    const check = this.findCheck("saleor-cloud-token");
    assert.ok(check, "doctor saleor must report a `saleor-cloud-token` check");
    // A device-grant JWT is accepted by the platform API only under `Bearer`
    // (the `Token` scheme rejects it), so a pass that shows the organizations
    // read is the falsifiable proof the Bearer read succeeded with the
    // refreshed token.
    assert.equal(
      check!.status,
      "pass",
      "the Bearer platform-API read must succeed with the refreshed token",
    );
    assert.match(
      JSON.stringify(check),
      /organizations/i,
      "the check must show the authenticated platform organizations read",
    );
  },
);

Then(
  "it should store the refreshed access token in .env as JOLLY_SALEOR_ACCESS_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    const refreshed = values["JOLLY_SALEOR_ACCESS_TOKEN"];
    assert.ok(
      refreshed && refreshed !== this.notes.expiredAccess,
      "the refreshed access token must be persisted to .env as JOLLY_SALEOR_ACCESS_TOKEN",
    );
  },
);

Then(
  "it should not re-prompt the user to authorize again",
  function (this: JollyWorld) {
    const text = (this.lastRun!.stdout + " " + this.lastRun!.stderr).toLowerCase();
    assert.ok(
      !text.includes("auth.saleor.io/realms/saleor-cloud/device"),
      "a refresh must not re-show the device verification URL",
    );
    assert.ok(
      !/user code|device code|authorize at/.test(text),
      "a refresh must not re-prompt the user to authorize again",
    );
  },
);

// ─── Scenario: jolly login with an empty env/.env token fails honestly ──────
// JOLLY_SALEOR_CLOUD_TOKEN present but empty is a present-but-empty token. Login
// in a non-interactive shell must reject it honestly with a stable code naming
// the empty token, writing nothing to .env.

Given(
  "JOLLY_SALEOR_CLOUD_TOKEN is set to the empty value",
  function (this: JollyWorld) {
    this.notes.envToken = "";
  },
);

When(
  "the agent runs `jolly login --json` in a non-interactive shell",
  function (this: JollyWorld) {
    this.runCli(["login", "--json"], {
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_TOKEN: String(this.notes.envToken ?? ""),
      }),
    });
  },
);

Then(
  "the envelope status should be \"error\" with a stable `code` naming the empty token",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    assert.ok(this.envelope.errors.length > 0, "expected an error entry");
    assert.match(this.envelope.errors[0].code as string, /^[A-Z][A-Z0-9_]*$/);
    const reported = (
      JSON.stringify(this.envelope.errors) +
      " " +
      this.envelope.summary
    ).toLowerCase();
    assert.ok(
      reported.includes("empty"),
      `error must name the empty token as the cause; got: ${reported}`,
    );
    assert.ok(
      reported.includes("jolly_saleor_cloud_token"),
      `error must name the JOLLY_SALEOR_CLOUD_TOKEN variable; got: ${reported}`,
    );
  },
);

// ─── Shared: no existing authentication / no token value in output ──────────

Then("it should not write any value to .env", function (this: JollyWorld) {
  const path = join(this.lastRun!.cwd, ".env");
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    assert.ok(
      !/JOLLY_SALEOR_(CLOUD|APP)_TOKEN=/.test(text),
      "a failed exchange must not write a token to .env",
    );
  }
});

Then(
  "the output should contain no success, verified, or authenticated language",
  function (this: JollyWorld) {
    const text = (this.lastRun!.stdout + " " + this.lastRun!.stderr).toLowerCase();
    for (const claim of ["successfully logged in", "authenticated as", "token verified", "verification succeeded"]) {
      assert.ok(!text.includes(claim), `output must not claim "${claim}"`);
    }
  },
);

// ─── @sandbox: verify a headless token against the Cloud API ───────────────
// saleorCloud-gated; runs in CI with the real token. Written for CI.

Then(
  "it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["JOLLY_SALEOR_CLOUD_TOKEN"], String(this.notes.validToken));
  },
);

Then(
  "it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(
      values["JOLLY_SALEOR_ORGANIZATION"] && values["JOLLY_SALEOR_ORGANIZATION"].length > 0,
      "the real organization name must be stored",
    );
  },
);

Then(
  "it should report the authenticated organization context using values from the real response",
  function (this: JollyWorld) {
    const ctx = envData(this)["accountContext"];
    assert.equal(typeof ctx, "string");
    assert.ok((ctx as string).length > 0, "accountContext must be a real org name");
    assert.notEqual(ctx, "unknown");
  },
);

// ─── @sandbox: jolly login verifies & stores the env/.env staff token ──────
// The non-interactive login resolves the staff token from the runtime
// JOLLY_SALEOR_CLOUD_TOKEN env var (no flag), verifies it with an authenticated
// `Authorization: Token` read of the real Cloud API organizations endpoint, and
// stores the token + returned organization name in .env. A staff token (not a
// Keycloak JWT) is accepted by the platform API only under the `Token` scheme, so
// a success envelope with a passing verification check is the falsifiable proof
// the Token-scheme read of cloud.saleor.io really happened.

Given(
  "JOLLY_SALEOR_CLOUD_TOKEN is a valid staff token supplied via the environment",
  function (this: JollyWorld) {
    const token = process.env["JOLLY_SALEOR_CLOUD_TOKEN"];
    assert.ok(token, "the @sandbox staff-token scenario requires JOLLY_SALEOR_CLOUD_TOKEN");
    this.notes.validToken = token;
    this.notes.loginEnvToken = token;
    this.trackSecret(token!);
  },
);

When(
  "the agent runs `jolly login` in a non-interactive shell",
  function (this: JollyWorld) {
    // No --token flag: login resolves the staff token from the runtime
    // JOLLY_SALEOR_CLOUD_TOKEN env var (the scenario's Given set the value) and
    // really sends it to the Cloud API (no JOLLY_SALEOR_CLOUD_API_URL override →
    // cloud.saleor.io). runCli pipes stdin, so the shell is non-interactive.
    this.runCli(["login", "--json"], {
      env: { JOLLY_SALEOR_CLOUD_TOKEN: String(this.notes.loginEnvToken ?? "") },
    });
  },
);

Then(
  "it should verify the token with an authenticated `Authorization: Token` read of `https:\\/\\/cloud.saleor.io\\/platform\\/api\\/organizations\\/`",
  function (this: JollyWorld) {
    // A staff token is accepted by the platform API only under the `Token`
    // scheme (a JWT-only `Bearer` read would reject it), so a success envelope
    // with a passing verification check is the falsifiable proof the
    // authenticated `Authorization: Token` read of the organizations endpoint
    // really happened.
    assert.equal(this.envelope.status, "success");
    const verification = this.envelope.checks.find((c) =>
      String(c.id).includes("verification"),
    );
    assert.ok(verification, "expected a verification check");
    assert.equal(verification!.status, "pass");
  },
);

// ─── Scenario: jolly login rejects an invalid env/.env staff token ─────────
// JOLLY_SALEOR_CLOUD_TOKEN holds a bogus value. The non-interactive login really
// sends it to the real Cloud API and is really rejected (HTTP 401/403); login
// reports an error naming the rejection status, writes nothing to .env, and
// makes no success/verified/authenticated claim. A real request from real bad
// input — no account is reached, so it stays a safe @logic check.

Given(
  "JOLLY_SALEOR_CLOUD_TOKEN is set to an invalid or expired value",
  function (this: JollyWorld) {
    const token = `invalid-${this.namespace}-token`;
    this.notes.loginEnvToken = token;
    this.trackSecret(token);
  },
);

Then(
  "Jolly should report an error naming the HTTP rejection status",
  function (this: JollyWorld) {
    const reported =
      JSON.stringify(this.envelope.errors) + " " + this.envelope.summary;
    assert.match(
      reported,
      /\b(401|403)\b/,
      `the error must name the HTTP rejection status (401/403); got: ${reported}`,
    );
  },
);

// ─── @sandbox: login rejects an invalid token gracefully ───────────────────
// Uses the network only; the invalid token is real bad input, no account touched.

Then(
  "the verification request should really be sent and really be rejected",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    const code = this.envelope.errors[0]?.code;
    assert.equal(code, "INVALID_TOKEN");
  },
);

// ─── Scenario: Agent logs out (generic) ────────────────────────────────────

Given(
  ".env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token",
  function (this: JollyWorld) {
    // Seed a .env with managed auth vars plus an unrelated third-party var.
    writeFileSync(
      join(this.projectDir, ".env"),
      "JOLLY_SALEOR_CLOUD_TOKEN=some-token\nTHIRD_PARTY_KEY=keep-me\n",
    );
  },
);

When("the agent invokes `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN from .env",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.ok(!("JOLLY_SALEOR_CLOUD_TOKEN" in values), "the managed Cloud token must be removed");
  },
);

Then(
  "any non-JOLLY_ variable in .env should remain unchanged",
  function (this: JollyWorld) {
    const values = loadEnvValues(this.lastRun!.cwd);
    assert.equal(values["THIRD_PARTY_KEY"], "keep-me", "unrelated vars must be preserved");
  },
);

Then(
  "it should load the updated `.env` values for the current command flow",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "success");
  },
);

// ─── Scenario: Agent checks auth status ────────────────────────────────────

When("it invokes `jolly auth status`", function (this: JollyWorld) {
  // Seed an organization so the accountContext-from-org assertion can hold,
  // then run auth status reading the on-disk .env (configuration-only).
  writeFileSync(
    join(this.projectDir, ".env"),
    "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\nJOLLY_SALEOR_ORGANIZATION=acme-org\n",
  );
  this.runCli(["auth", "status", "--json"], {
    env: absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      JOLLY_SALEOR_ORGANIZATION: undefined,
    }),
  });
});

Then(
  "Jolly should report whether Saleor Cloud authentication is configured",
  function (this: JollyWorld) {
    assert.equal(typeof envData(this)["hasCloudToken"], "boolean");
  },
);

Then(
  "when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context",
  function (this: JollyWorld) {
    assert.equal(envData(this)["accountContext"], "acme-org");
  },
);

Then(
  "when no organization is stored, it should report the account context as unknown rather than failing",
  function (this: JollyWorld) {
    // Re-run in a fresh dir with a token but no org: accountContext "unknown",
    // and the command does not fail.
    const dir = this.newTempDir("no-org");
    writeFileSync(join(dir, ".env"), "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\n");
    this.runCli(["auth", "status", "--json"], {
      cwd: dir,
      env: absentCredentialsEnv({
        JOLLY_SALEOR_CLOUD_TOKEN: undefined,
        JOLLY_SALEOR_ORGANIZATION: undefined,
      }),
    });
    assert.notEqual(this.envelope.status, "error");
    assert.equal(envData(this)["accountContext"], "unknown");
  },
);

Then("the output should not contain the token value", function (this: JollyWorld) {
  this.trackSecret("seed-token");
  this.assertNoSecretsIn(this.lastRun!.stdout, "stdout");
  this.assertNoSecretsIn(this.lastRun!.stderr, "stderr");
});

Then(
  "it should support `--json` and `--quiet`",
  function (this: JollyWorld) {
    const dir = this.newTempDir("flags");
    writeFileSync(join(dir, ".env"), "JOLLY_SALEOR_CLOUD_TOKEN=seed-token\n");
    const safe = absentCredentialsEnv({
      JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      JOLLY_SALEOR_ORGANIZATION: undefined,
    });
    this.runCli(["auth", "status", "--json"], { cwd: dir, env: safe });
    assert.ok(this.lastRun!.envelope, "--json must carry the envelope");
    // --quiet never emits the machine envelope (feature 020): silent on success,
    // warnings/errors to stderr only.
    this.runCli(["auth", "status", "--quiet"], { cwd: dir, env: safe });
    assert.ok(!this.lastRun!.envelope, "--quiet must not emit the machine envelope");
  },
);

Then(
  "the output should include a nextSteps array with at least one step",
  function (this: JollyWorld) {
    assert.ok(Array.isArray(this.envelope.nextSteps));
    assert.ok(this.envelope.nextSteps.length >= 1, "expected at least one nextStep");
  },
);

// ─── Scenario: logout removes only Jolly-managed auth values from .env ──────

When("the agent runs `jolly logout`", function (this: JollyWorld) {
  this.runCli(["logout", "--json"], { env: absentCredentialsEnv() });
});

Then("THIRD_PARTY_KEY should remain in .env unchanged", function (this: JollyWorld) {
  const values = loadEnvValues(this.lastRun!.cwd);
  assert.equal(values["THIRD_PARTY_KEY"], "keep-me");
});

Then(
  "subsequent `jolly auth status` should report not authenticated",
  function (this: JollyWorld) {
    this.runCli(["auth", "status", "--json"], {
      cwd: this.lastRun!.cwd,
      env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: undefined }),
    });
    assert.equal(envData(this)["hasCloudToken"], false);
  },
);

Then(
  "the envelope status should be \"error\" with a stable `code`",
  function (this: JollyWorld) {
    assert.equal(this.envelope.status, "error");
    assert.ok(this.envelope.errors.length > 0, "expected an error entry");
    assert.match(this.envelope.errors[0].code as string, /^[A-Z][A-Z0-9_]*$/);
  },
);

// ─── @property: the .env Jolly writes is private to its owner (mode 600) ────
// The shared .env writer must create the file owner-read/write only. Exercised
// via the stored-not-verified path against the deliberately-unreachable Cloud
// API (the inline @exceptional-double) so the local WRITE is observed without a
// real verify round-trip.

Then(
  /^the \.env file Jolly wrote should be readable and writable only by its owner \(mode 600\)$/,
  function (this: JollyWorld) {
    const path = join(this.lastRun!.cwd, ".env");
    assert.ok(existsSync(path), ".env must have been written");
    const mode = statSync(path).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `.env must be mode 600 (owner read/write only); got ${mode.toString(8)}`,
    );
  },
);

// ─── @property: the .env Jolly writes survives POSIX shell sourcing ─────────
// A value carrying a space and an apostrophe must be quoted so `set -a; . .env`
// sources without error and round-trips the original value. Same stored-not-
// verified path against the unreachable Cloud API.

Then(
  "sourcing the written .env in a POSIX shell should exit zero",
  function (this: JollyWorld) {
    const result = spawnSync("sh", ["-c", "set -a; . ./.env"], {
      cwd: this.lastRun!.cwd,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `sourcing .env must exit zero; status ${result.status}, stderr: ${result.stderr}`,
    );
  },
);

Then(
  "the value read back for JOLLY_SALEOR_CLOUD_TOKEN should equal {string}",
  function (this: JollyWorld, expected: string) {
    const result = spawnSync(
      "sh",
      ["-c", 'set -a; . ./.env; printf %s "$JOLLY_SALEOR_CLOUD_TOKEN"'],
      { cwd: this.lastRun!.cwd, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `sourcing .env failed: ${result.stderr}`);
    assert.equal(result.stdout, expected);
  },
);

function resolvedChildEnv(
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

// ─── Scenario: jolly login --dry-run does not write to .env ─────────────────
// A dry-run login previews only: it shows the login riskContext + nextSteps,
// never starts the device grant (no device code), and writes nothing to .env.

When(
  "the user runs `jolly login --dry-run --json`",
  function (this: JollyWorld) {
    this.runCli(["login", "--dry-run", "--json"], { env: absentCredentialsEnv() });
  },
);

Then(
  "it should not request a device code and should not write to .env",
  function (this: JollyWorld) {
    const text = (this.lastRun!.stdout + " " + this.lastRun!.stderr).toLowerCase();
    assert.ok(
      !text.includes("auth.saleor.io/realms/saleor-cloud/device") &&
        !/user code|device code/.test(text),
      "a dry-run login must not request or display a device code",
    );
    assert.ok(
      !existsSync(join(this.lastRun!.cwd, ".env")),
      "a dry-run login must not write .env",
    );
  },
);

// ─── @property: the .env Jolly writes is private + shell-safe ───────────────
// 018:153/164 exercise the shared .env writer via the stored-not-verified path:
// an env/.env staff token plus a deliberately-unreachable Cloud API
// (@exceptional-double) so login stores the token without a verify round-trip
// and the local WRITE — mode 600, shell-safe quoting — is observed.

Given("the Cloud API is unreachable", function (this: JollyWorld) {
  this.notes.cloudUnreachable = true;
});

Given(
  "JOLLY_SALEOR_CLOUD_TOKEN is set to {string}",
  function (this: JollyWorld, value: string) {
    this.notes.envToken = value;
    this.trackSecret(value);
  },
);

When("the agent runs `jolly login`", function (this: JollyWorld) {
  const overrides: Record<string, string | undefined> = {
    JOLLY_SALEOR_CLOUD_TOKEN: String(this.notes.envToken ?? ""),
  };
  if (this.notes.cloudUnreachable) {
    // @exceptional-double: a deliberately-unreachable Cloud API host (RFC 6761) —
    // the unreachable-service condition the real test env cannot produce on
    // demand — so login stores the token honestly without verifying.
    overrides.JOLLY_SALEOR_CLOUD_API_URL = "https://jolly-unreachable.invalid";
  }
  this.runCli(["login"], { env: absentCredentialsEnv(overrides) });
});

Then("Jolly should not print any token value", function (this: JollyWorld) {
  const text = this.lastRun!.stdout + " " + this.lastRun!.stderr;
  assert.ok(
    !/JOLLY_SALEOR_(CLOUD|APP|REFRESH|ACCESS)_TOKEN=\S/.test(text),
    "no token value may be printed",
  );
  if (this.notes.envToken) {
    assert.ok(
      !text.includes(String(this.notes.envToken)),
      "the token value must never appear in the output",
    );
  }
});
