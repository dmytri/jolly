// Feature 008 — Jolly create subcommands.
//
// These @logic scenarios pin the thin-CLI create surface (decision
// 2026-06-13): `jolly create --help` lists exactly store/app-token/stripe and
// NOT the retired tool-wrapping subcommands (deployment/deploy/recipe/
// storefront); and a create subcommand with unmet preconditions errors with a
// stable code and never fabricates a created/configured/stored resource or a
// `pass` check.
//
// Safety: every command runs under logicSafeEnv() — dummy credentials for all
// groups + an unroutable `.invalid` Cloud API base — so no side-effecting path
// can reach a real account (the "012 incident" lesson).
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { logicSafeEnv } from "../support/logic-env.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background ------------------------------------------------------------
// `Jolly is executable via \`npx\`` is defined in 020's step file (shared).

Given(
  "Jolly is a thin CLI that does not wrap or shell out to the Vercel CLI or `@saleor\\/configurator`",
  function () {
    // Capability statement; the thin surface is verified by the help scenario.
  },
);

Given(
  "the customer's own agent runs the official CLIs, guided by the Jolly skill",
  function () {
    // Capability statement.
  },
);

// --- Scenario: Agent discovers create subcommands --------------------------

Given(
  "the agent needs to create a specific resource",
  function () {
    // Framing; the help inspection happens in the When.
  },
);

When("it inspects `jolly create --help`", function (this: JollyWorld) {
  this.runCli(["create", "--help", "--json"], { env: logicSafeEnv() });
});

function helpSubcommandNames(world: JollyWorld): string[] {
  const data = world.envelope.data as { subcommands?: unknown };
  const subs = Array.isArray(data.subcommands) ? data.subcommands : [];
  return subs
    .map((s) => (s && typeof s === "object" ? (s as { name?: unknown }).name : s))
    .filter((n): n is string => typeof n === "string");
}

Then(
  "it should see only the plumbing subcommands `store`, `app-token`, and `stripe`",
  function (this: JollyWorld) {
    const names = helpSubcommandNames(this);
    assert.deepEqual(
      [...names].sort(),
      ["app-token", "store", "stripe"],
      `create --help should list exactly store, app-token, stripe; got ${JSON.stringify(names)}`,
    );
  },
);

Then(
  "each subcommand should have a clear resource boundary",
  function (this: JollyWorld) {
    const data = this.envelope.data as { subcommands?: unknown };
    const subs = Array.isArray(data.subcommands) ? data.subcommands : [];
    for (const sub of subs) {
      assert.ok(sub && typeof sub === "object", "subcommand entry must be an object");
      const desc = (sub as { description?: unknown }).description;
      assert.equal(typeof desc, "string", "each subcommand needs a description");
      assert.ok((desc as string).length > 0, "subcommand description non-empty");
    }
  },
);

Then(
  "the help output should be understandable to both agents and humans",
  function (this: JollyWorld) {
    // Hybrid output: machine-readable envelope (asserted above) plus a
    // human-readable summary string.
    assert.equal(typeof this.envelope.summary, "string");
    assert.ok(this.envelope.summary.length > 0, "summary must be non-empty");
  },
);

Then(
  "it should not list `deployment`, `deploy`, `recipe`, or `storefront` — those are run by the agent via the official CLIs per the Jolly skill",
  function (this: JollyWorld) {
    const names = helpSubcommandNames(this);
    for (const retired of ["deployment", "deploy", "recipe", "storefront"]) {
      assert.ok(
        !names.includes(retired),
        `create --help must not list the retired subcommand "${retired}"`,
      );
    }
  },
);

// --- Scenario: never report a resource they did not produce ----------------

Given(
  "the agent runs a `jolly create` subcommand whose preconditions are unmet or whose work cannot be performed",
  function (this: JollyWorld) {
    // `create app-token` with no instance URL and an unroutable Cloud API is a
    // precondition-unmet path: there is no Saleor GraphQL endpoint to reach, so
    // the command must error honestly. logicSafeEnv points everything at
    // `.invalid` and the temp project has no NEXT_PUBLIC_SALEOR_API_URL.
    this.runCli(["create", "app-token", "--json"], {
      env: logicSafeEnv({ NEXT_PUBLIC_SALEOR_API_URL: undefined }),
    });
  },
);

When("the command runs with `--json`", function (this: JollyWorld) {
  // The command already ran in the Given with --json.
  assert.ok(this.lastRun?.envelope, "expected a --json envelope");
});

Then(
  "the envelope status should be {string} with a stable error code",
  function (this: JollyWorld, status: string) {
    assert.equal(this.envelope.status, status);
    assert.ok(this.envelope.errors.length > 0, "expected at least one error");
    for (const err of this.envelope.errors) {
      assert.equal(typeof err.code, "string");
      assert.match(
        err.code as string,
        /^[A-Z][A-Z0-9_]*$/,
        `error code "${err.code}" must be a stable machine identifier`,
      );
    }
  },
);

Then(
  "the output must not report a created, configured, or stored resource it did not produce",
  function (this: JollyWorld) {
    const env = this.envelope;
    assert.notEqual(env.status, "success", "an unmet-precondition run must not succeed");
    const haystack = JSON.stringify(env.data).toLowerCase() + " " + env.summary.toLowerCase();
    // No fabricated success language for work that did not happen.
    for (const claim of ["created", "configured", "stored ", "acquired", "provisioned"]) {
      assert.ok(
        !haystack.includes(claim),
        `error output must not claim a resource was ${claim.trim()}; summary/data: ${haystack}`,
      );
    }
  },
);

Then(
  "no check should report {string} for work that did not happen",
  function (this: JollyWorld, badStatus: string) {
    for (const check of this.envelope.checks) {
      assert.notEqual(
        check.status,
        badStatus,
        `check ${check.id} reports "${badStatus}" for work that did not happen`,
      );
    }
  },
);
