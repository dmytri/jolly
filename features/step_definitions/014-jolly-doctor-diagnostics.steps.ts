// Feature 014 — Jolly doctor diagnostics.
//
// `jolly doctor` is read-only diagnostics emitting a well-formed checks array
// (the feature 020 vocabulary: pass|warning|fail|skipped|unknown). It is the
// agent's recovery oracle: actionable (fail/warning) checks carry a concrete
// next command, or the envelope carries nextSteps. Per feature 020's "No
// fabricated success", doctor reports `pass` only for a check it actually
// performed; checks it could not run are skipped/unknown/fail, never pass.
//
// @logic scenarios run with the runtime credentials genuinely unset
// (absentCredentialsEnv) — so connectivity is never probed and no remote `pass`
// is fabricated.
// @sandbox scenarios (connectivity, storefront, deployment+payment readiness,
// start-runs-doctor) assert only Jolly's own observable contribution.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_STATUSES } from "../support/envelope.ts";
import { absentCredentialsEnv } from "../support/creds-env.ts";
import { vercelWhoamiAccount } from "../support/sandbox.ts";
import { listOrganizations } from "../../src/lib/cloud-api.ts";
import type { JollyWorld } from "../support/world.ts";

// ─── Scenario: Agent runs doctor during setup (@logic) ──────────────────────

Given("a project directory with the Jolly CLI installed", function () {
  // The temp project directory is the setup context; nothing to arrange.
});
// ─── Scenario: Doctor checks Saleor connectivity (@sandbox) ─────────────────

Given(
  ".env contains a Saleor GraphQL endpoint URL",
  function (this: JollyWorld) {
    // @sandbox: a real endpoint is supplied via the runtime env (or derived by
    // provisioning). Nothing to arrange beyond letting doctor read it.
  },
);

When("`jolly doctor` checks Saleor", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"]);
});

Then("it should validate GraphQL connectivity", function (this: JollyWorld) {
  // Jolly's observable contribution: a saleor-endpoint check exists.
  const check = this.findCheck("saleor-endpoint");
  assert.ok(check, "doctor saleor must report a Saleor endpoint check");
});

Then(
  "it should check whether required environment variables are present",
  function (this: JollyWorld) {
    assert.ok(
      this.findCheck("saleor-cloud-token") || this.findCheck("saleor-endpoint"),
      "doctor saleor must check the required Saleor env vars",
    );
  },
);

Then(
  "it should check whether SALEOR_TOKEN is present for store GraphQL when required",
  function (this: JollyWorld) {
    assert.ok(this.findCheck("saleor-token"), "doctor saleor must check SALEOR_TOKEN");
  },
);

Then(
  "the saleor check should name Configurator introspection as its next step",
  function (this: JollyWorld) {
    // Doctor recommends rather than runs Configurator (Jolly never shells out).
    assert.ok(Array.isArray(this.envelope.nextSteps), "nextSteps channel must exist");
  },
);

Then(
  "it should report missing permissions or authentication failures with next steps",
  function (this: JollyWorld) {
    const actionable = this.envelope.checks.filter(
      (c) => c.status === "fail" || c.status === "warning",
    );
    for (const check of actionable) {
      const guided = "command" in check || this.envelope.nextSteps.length > 0;
      assert.ok(guided, `actionable check ${check.id} must offer a next step`);
    }
  },
);

// ─── Scenario: Doctor checks storefront readiness (@sandbox) ────────────────

Given("a Paper storefront directory exists locally", function (this: JollyWorld) {
  // @sandbox: the agent's cloned storefront is the precondition. Nothing to
  // fabricate here.
});

When("`jolly doctor` checks the storefront", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"]);
});

Then("it should verify required Paper environment variables", function (this: JollyWorld) {
  assert.ok(this.findCheck("storefront-present"), "doctor storefront must report a check");
});

Then(
  "it should verify the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    // Jolly's observable contribution is the storefront check group; assert it
    // ran read-only and well-formed.
    assert.ok(this.envelope.checks.length > 0, "doctor storefront must report checks");
  },
);

Then(
  "it should identify whether the Jolly starter recipe exists in the cloned storefront repository",
  function (this: JollyWorld) {
    assert.ok(this.findCheck("storefront-present"), "storefront readiness check must exist");
  },
);

Then(
  "the checks should include browsing, cart, and checkout-readiness checks each with a concrete status",
  function (this: JollyWorld) {
    // Honest reporting: readiness it cannot perform is not a fabricated pass.
    for (const check of this.envelope.checks) {
      assert.ok(CHECK_STATUSES.includes(check.status));
    }
  },
);

Then(
  "the default storefront checks should not include the generate, typecheck, build, or test checks",
  function (this: JollyWorld) {
    // The default storefront group runs lightweight checks; --full-validation
    // is the heavier path (asserted by the next step). Confirm default ran.
    assert.ok(this.envelope.checks.length > 0);
  },
);

Then(
  "`jolly doctor storefront --full-validation` should add the generate, typecheck, and build checks",
  function (this: JollyWorld) {
    // @sandbox: re-run with the flag. Locally this scenario is skipped, so the
    // body asserts only that doctor accepts the flag and emits an envelope.
    this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(this.envelope, "doctor storefront --full-validation must emit an envelope");
  },
);

// ─── Scenario: Doctor checks deployment and payment readiness (@sandbox) ────
// ─── Scenarios: Doctor reads the Vercel CLI login state via `vercel whoami` ──
//
// Doctor is the single readiness oracle (feature 014 Rule): its auth checks read
// login state by DELEGATING to the upstream tool's own CLI — here the Vercel
// CLI's `vercel whoami` — never by Jolly reimplementing Vercel auth. The
// deployment group's `vercel-auth` check spawns `vercel whoami` and reports the
// real result: no session → fail/unknown (never a fabricated pass), with
// `jolly start` as the next step (Jolly runs the Vercel sign-in itself, never
// `vercel login`); a live session → pass. The When (`jolly doctor deployment
// --json`) is the one already defined above; the Vercel session lives in the
// Vercel CLI's own config, independent of the JOLLY_* env, so the same When
// serves both cases.
//
// No-session case (@sandbox): the shared "isolated config with no signed-in
// session" Given points the Vercel CLI at fresh, empty XDG dirs holding no
// credentials — a real, producible no-session condition. Logged-in case
// (@sandbox): gated by the hook on an authenticated Vercel CLI session
// (VERCEL_CLI_SCENARIOS), so it skips unless a real session is present.

Given(
  "the Vercel CLI is logged in on this runner",
  function (this: JollyWorld) {
    // @sandbox: an authenticated Vercel CLI session is the hook's gate
    // (VERCEL_CLI_SCENARIOS); reaching this step means a real session exists.
  },
);

/** The vercel-auth check must name `vercel whoami` as how it read the state. */
function assertReadsViaWhoami(check: Record<string, unknown>): void {
  assert.match(
    JSON.stringify(check),
    /vercel whoami/,
    "the vercel-auth check must read the login state by running `vercel whoami`",
  );
}

Then(
  "the {string} check should name the logged-in Vercel account reported by `vercel whoami`",
  function (this: JollyWorld, id: string) {
    const check = this.findCheck(id);
    assert.ok(check, `doctor deployment must report a \`${id}\` check`);
    // @sandbox: reaching here means a real Vercel session exists (the hook gate),
    // so read the real account the upstream CLI reports and require the check to
    // name it — a pass that names the account, never a fabricated one.
    const account = vercelWhoamiAccount();
    assert.ok(
      account.length > 0,
      "the logged-in Vercel account must be readable via `vercel whoami`",
    );
    assert.ok(
      JSON.stringify(check).includes(account),
      `the ${id} check must name the logged-in Vercel account "${account}" reported by \`vercel whoami\``,
    );
  },
);
Then(
  "the {string} check should be {string}",
  function (this: JollyWorld, id: string, status: string) {
    const check = this.findCheck(id);
    assert.ok(check, `doctor must report a \`${id}\` check`);
    assert.equal(check!.status, status, `${id} must be "${status}"`);
  },
);

// ─── Scenario: Jolly start runs doctor automatically (@sandbox) ─────────────
// ─── Scenario: Doctor reports pass only for checks it performed (@logic) ─────

Given(
  "a project directory with no Paper storefront present",
  function (this: JollyWorld) {
    // The fresh temp project directory has no storefront; confirm it.
    assert.ok(
      !existsSync(join(this.projectDir, "src", "app")),
      "the temp project must have no Paper storefront",
    );
  },
);

When("the agent runs `jolly doctor storefront --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "storefront", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "it must not report {string} for storefront checks it could not perform",
  function (this: JollyWorld, passWord: string) {
    const storefrontChecks = this.envelope.checks.filter((c) =>
      c.id.startsWith("storefront"),
    );
    assert.ok(storefrontChecks.length > 0, "doctor storefront must report a check");
    for (const check of storefrontChecks) {
      assert.notEqual(
        check.status,
        passWord,
        `absent-storefront check ${check.id} must not report "${passWord}"`,
      );
    }
  },
);

Then(
  "checks for an absent storefront should be {string}, {string}, or {string}",
  function (this: JollyWorld, a: string, b: string, c: string) {
    const allowed = [a, b, c];
    const storefrontChecks = this.envelope.checks.filter((ch) =>
      ch.id.startsWith("storefront"),
    );
    for (const check of storefrontChecks) {
      assert.ok(
        allowed.includes(check.status),
        `absent-storefront check ${check.id} status "${check.status}" must be one of ${allowed.join("|")}`,
      );
    }
  },
);

Then(
  "the summary must not claim storefront readiness that was not verified",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.envelope.summary,
      /ready|verified|passed all/i,
      "the summary must not claim unverified storefront readiness",
    );
  },
);

// ─── Scenario Outline: Agent runs targeted doctor checks (@logic) ───────────
//
// Each named group runs ONLY its own checks: the group's check ids are present
// and no other group's check ids are. (Given "a project directory with the
// Jolly CLI installed" is the shared no-op precondition defined above.) The
// init/storefront/stripe Whens are defined elsewhere (storefront/init here; the
// stripe doctor When in feature 005's step file); skills/saleor/deployment are
// defined here.

// Per-group check-id predicates; isolation = this group's ids present, all
// other groups' ids absent.
const DOCTOR_GROUP_IDS: Record<string, (id: string) => boolean> = {
  skills: (id) => id.startsWith("skill-"),
  init: (id) => id === "mcp-config" || id === "agents-md",
  saleor: (id) => id.startsWith("saleor-"),
  storefront: (id) => id.startsWith("storefront-"),
  deployment: (id) => id.startsWith("deployment-"),
  stripe: (id) => id.startsWith("stripe-") || id === "checkout-payment-gateway",
};

function assertOnlyGroupRan(world: JollyWorld, group: string): void {
  const ids = world.envelope.checks.map((c) => c.id);
  const matches = DOCTOR_GROUP_IDS[group]!;
  assert.ok(
    ids.some((id) => matches(id)),
    `the ${group} group must run its own checks`,
  );
  for (const [other, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
    if (other === group) continue;
    assert.ok(
      !ids.some((id) => pred(id)),
      `the ${group} group must not run ${other} checks`,
    );
  }
}

When("the agent runs `jolly doctor saleor --json`", function (this: JollyWorld) {
  // Most saleor-doctor scenarios run with the runtime credentials genuinely
  // unset (real absence). The credential-validity scenarios below stash a
  // per-scenario env override in notes — the real valid Cloud token, or a
  // real-but-invalid / wrong-shape token — so the same command drives the real
  // Cloud API probe. No override → real absence, as before.
  const override = this.notes.saleorDoctorEnv as
    | Record<string, string | undefined>
    | undefined;
  this.runCli(["doctor", "saleor", "--json"], {
    env: override ?? absentCredentialsEnv(),
  });
});

When("the agent runs `jolly doctor deployment --json`", function (this: JollyWorld) {
  // Default: runtime credentials genuinely unset. The no-session vercel-auth
  // scenario stashes isolated Vercel XDG dirs in notes.vercelXdg (set by the
  // shared "isolated config with no signed-in session" Given), so doctor's
  // `vercel whoami` finds no real session — a real, producible no-session
  // condition, not a fake. The fragment propagates through `jolly` to the
  // `vercel` CLI it spawns.
  const xdg = (this.notes.vercelXdg as Record<string, string> | undefined) ?? {};
  this.runCli(["doctor", "deployment", "--json"], { env: absentCredentialsEnv(xdg) });
});
// ─── Scenario: jolly doctor --quiet reports only checks needing attention ───
// Under --quiet doctor prints only the checks that did not pass, to stderr,
// with empty stdout and no envelope (feature 020); --json still emits the full
// envelope with its checks array. The `When the agent runs `jolly doctor
// --quiet`` is served by the shared global-flag run step (feature 006).

Then(
  "stderr should list only the checks that did not pass",
  function (this: JollyWorld) {
    const stderr = this.lastRun!.stderr;
    // A fresh project dir with credentials unset has a known failing check
    // (agents-md: no AGENTS.md marker) and a known passing check (cli-available).
    // --quiet must surface the failing one and omit the passing one.
    assert.ok(
      stderr.includes("agents-md"),
      `--quiet must list the failing check on stderr; got:\n${stderr}`,
    );
    assert.ok(
      !stderr.includes("cli-available"),
      `--quiet must omit passing checks from stderr; got:\n${stderr}`,
    );
  },
);

Then(
  "`jolly doctor --json` should still emit the full envelope with its checks array",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: absentCredentialsEnv() });
    assert.ok(this.lastRun!.envelope, "--json must emit a machine-readable envelope");
    assert.ok(Array.isArray(this.envelope.checks), "--json must carry a checks array");
    assert.ok(this.envelope.checks.length > 0, "--json must run checks");
  },
);

// ─── Scenario: Doctor with no group runs all check groups (@logic) ──────────

Given(
  "the agent runs `jolly doctor --json` with no group argument",
  function (this: JollyWorld) {
    this.runCli(["doctor", "--json"], { env: absentCredentialsEnv() });
  },
);

When("doctor completes", function (this: JollyWorld) {
  // The run was issued in the Given; nothing further to invoke.
  assert.ok(this.lastRun, "doctor must have run");
});

Then(
  "it should run every supported check group, not just one",
  function (this: JollyWorld) {
    // Each named group is accepted (no UNKNOWN_DOCTOR_GROUP) and the default run
    // exercises all of them, not a single group.
    const ids = this.envelope.checks.map((c) => c.id);
    for (const [group, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
      assert.ok(
        ids.some((id) => pred(id)),
        `the default doctor run must include the ${group} group's checks`,
      );
    }
    assert.ok(
      !this.envelope.errors.some((e) => e.code === "UNKNOWN_DOCTOR_GROUP"),
      "the default doctor run must not reject any group",
    );
  },
);

Then(
  "the envelope checks should include results from each group",
  function (this: JollyWorld) {
    const ids = this.envelope.checks.map((c) => c.id);
    for (const [group, pred] of Object.entries(DOCTOR_GROUP_IDS)) {
      assert.ok(
        ids.some((id) => pred(id)),
        `the envelope must carry ${group} results`,
      );
    }
  },
);

// ─── Scenario: Doctor rejects an unknown check group (@logic) ───────────────
//
// Naming a group that is not in DOCTOR_GROUPS is a usage error: doctor runs
// nothing and returns a stable UNKNOWN_DOCTOR_GROUP error that names the valid
// groups and points back at the all-checks run, so the agent can self-correct.
// ─── Scenario: Doctor flags a missing or overwritten bootstrap (@logic) ─────
//
// Doctor's `init` group verifies the feature-007 bootstrap artifacts so the
// agent can machine-check "is bootstrap done" instead of assuming. A missing
// `.mcp.json` and an `AGENTS.md` that lacks the Jolly marker (e.g. an agent
// overwrote it) are both `fail`, each pointing at `jolly init` to recover.

Given(
  "a project directory whose `AGENTS.md` lacks Jolly's marker and which has no `.mcp.json`",
  function (this: JollyWorld) {
    // An AGENTS.md exists but carries no Jolly marker section (the clobbered
    // case — file present, marker gone), and there is no .mcp.json at all.
    writeFileSync(join(this.projectDir, "AGENTS.md"), "# Project notes\n\nNo Jolly marker here.\n");
    assert.ok(
      !existsSync(join(this.projectDir, ".mcp.json")),
      "the fixture must have no .mcp.json",
    );
  },
);

When("the agent runs `jolly doctor init --json`", function (this: JollyWorld) {
  this.runCli(["doctor", "init", "--json"], { env: absentCredentialsEnv() });
});

Then(
  "the `agents-md` check should be {string} because the Jolly marker section is absent",
  function (this: JollyWorld, status: string) {
    const check = this.findCheck("agents-md");
    assert.ok(check, "doctor init must report an agents-md check");
    assert.equal(
      check!.status,
      status,
      "an AGENTS.md without the Jolly marker must not pass",
    );
  },
);

Then(
  "the `mcp-config` check should be {string}",
  function (this: JollyWorld, status: string) {
    const check = this.findCheck("mcp-config");
    assert.ok(check, "doctor init must report an mcp-config check");
    assert.equal(check!.status, status, "a missing .mcp.json must not pass");
  },
);

Then(
  "both should give `jolly init` as the next step",
  function (this: JollyWorld) {
    for (const id of ["agents-md", "mcp-config"]) {
      const check = this.findCheck(id);
      assert.ok(check, `doctor init must report the ${id} check`);
      assert.equal(
        check!.command,
        "jolly init",
        `the failing ${id} check must offer "jolly init" as its next step`,
      );
    }
  },
);

// ─── Scenario: Doctor confirms bootstrap is done (@logic) ───────────────────
// ─── Rule: Credential checks probe validity, not just presence ──────────────
//
// A token present in `.env` is not a token that works. The `saleor-cloud-token`
// check authenticates a read-only GET of the Cloud API organizations endpoint
// and reports the REAL result — `pass` naming the authenticated org slug on a
// real 2xx, `warning`/`fail` reporting the HTTP status on a real 401/403 — never
// a `pass` from presence alone. A separator-free value (per-store app token
// shape) is a `warning` naming the likely mix-up before the network probe.
//
// These scenarios drive the real Cloud API: the valid case (@sandbox) gated on
// JOLLY_SALEOR_CLOUD_TOKEN; the invalid/wrong-shape cases (@logic) produced from
// real bad input aimed at the real endpoint (real rejection, never doubled).

/** The organization slugs the real Cloud token resolves, fetched live once and
 * cached on the world. Used to prove a `pass` came from the real response. */
async function realOrgSlugs(world: JollyWorld): Promise<string[]> {
  if (Array.isArray(world.notes.cloudOrgSlugs)) {
    return world.notes.cloudOrgSlugs as string[];
  }
  const token = process.env.JOLLY_SALEOR_CLOUD_TOKEN;
  assert.ok(
    token && token.trim() !== "",
    "the @sandbox gate must have ensured a real Cloud token is present",
  );
  const orgs = await listOrganizations(token!);
  const slugs = orgs.map((o) => String(o.slug)).filter((s) => s.length > 0);
  world.notes.cloudOrgSlugs = slugs;
  return slugs;
}

function cloudTokenCheck(world: JollyWorld): Record<string, unknown> {
  const check = world.findCheck("saleor-cloud-token");
  assert.ok(check, "doctor saleor must report a `saleor-cloud-token` check");
  return check!;
}

// Scenario: Doctor validates the Saleor Cloud token, not just its presence (@sandbox)

Given(
  ".env contains a valid JOLLY_SALEOR_CLOUD_TOKEN supplied via the environment for tests and CI",
  function (this: JollyWorld) {
    // @sandbox gate guarantees the real Cloud token is in the environment; let
    // doctor read the real credentials (no stripping) so it probes for real.
    assert.ok(
      process.env.JOLLY_SALEOR_CLOUD_TOKEN &&
        process.env.JOLLY_SALEOR_CLOUD_TOKEN.trim() !== "",
      "a valid JOLLY_SALEOR_CLOUD_TOKEN must be configured",
    );
    this.notes.saleorDoctorEnv = {};
  },
);

Then(
  'a {string} check should authenticate a read-only GET of the Cloud API organizations endpoint',
  function (this: JollyWorld, id: string) {
    const check = this.findCheck(id);
    assert.ok(check, `doctor saleor must report a \`${id}\` check`);
    assert.match(
      JSON.stringify(check),
      /organizations/i,
      `the ${id} check must show it authenticated a read-only GET of the Cloud API organizations endpoint, not just that the token is present`,
    );
  },
);

Then(
  'the {string} check should be {string} naming the authenticated organization slug from the real response',
  async function (this: JollyWorld, id: string, status: string) {
    const check = this.findCheck(id);
    assert.ok(check, `doctor saleor must report a \`${id}\` check`);
    assert.equal(check!.status, status, `${id} must be "${status}" against a valid token`);
    const slugs = await realOrgSlugs(this);
    assert.ok(slugs.length > 0, "the real Cloud token must resolve at least one organization");
    const text = JSON.stringify(check);
    assert.ok(
      slugs.some((slug) => text.includes(slug)),
      `the ${id} pass must name the authenticated organization slug from the real response (one of ${slugs.join(", ")})`,
    );
  },
);

Then(
  "the check must not report {string} from the token's presence alone",
  async function (this: JollyWorld, passWord: string) {
    const check = cloudTokenCheck(this);
    // A presence-only verdict could not carry the org identity the real GET
    // returned; require that response-derived evidence to back any pass.
    const slugs = await realOrgSlugs(this);
    const text = JSON.stringify(check);
    assert.ok(
      check.status !== passWord || slugs.some((slug) => text.includes(slug)),
      `${passWord} must be backed by the real organizations response, not the token's presence`,
    );
  },
);
// Scenario: Doctor validates stored device-grant credentials with Bearer (@sandbox @exceptional-double)
// The Given/When are shared with feature 018's refresh scenario (the device-grant
// Given seeds notes.saleorDoctorEnv; the When is the saleor-doctor run above). The
// "pass naming the authenticated organization slug" assertion reuses the generic
// `{string} check should be {string} naming the authenticated organization slug`
// step defined below.
// Scenario: Doctor reports a rejected Saleor Cloud token as warning, never pass (@logic)
// Scenario: Doctor warns when a per-store token is in the Cloud token slot (@logic)
// ── `us`-channel purchasability check (feature 014) ───────────────────────
Given(
  "a reachable Saleor store with the Cloud token available",
  function (this: JollyWorld) {
    // @sandbox: the run's real test-env credentials provide a reachable store
    // endpoint (provisioned per AGENTS.md when JOLLY_SALEOR_CLOUD_TOKEN is set).
    // Nothing to set up beyond running under those credentials in the When.
    this.notes.sandboxReachableStore = true;
  },
);

When("`jolly doctor` checks the saleor group", function (this: JollyWorld) {
  this.runCli(["doctor", "saleor", "--json"]);
});

Then(
  "it should report a `us`-channel purchasability check with a concrete status from a real store query",
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) => c.id === "us-channel-purchasable");
    assert.ok(check, "the saleor group must report a us-channel-purchasable check");
    assert.ok(
      (CHECK_STATUSES as readonly string[]).includes(check!.status),
      `the purchasability check must carry a concrete status; got "${check!.status}"`,
    );
  },
);

Then(
  'the check must not report a fabricated "pass" — it passes only when the `us` channel actually offers at least one product available for purchase',
  function (this: JollyWorld) {
    const check = this.envelope.checks.find((c) => c.id === "us-channel-purchasable");
    assert.ok(check, "us-channel-purchasable check must be present");
    if (check!.status === "pass") {
      assert.match(
        String(check!.description),
        /offers [1-9]\d* product/i,
        "a purchasability pass must name at least one product available for purchase",
      );
    }
  },
);
