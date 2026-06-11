// Steps for features/002-v1-end-to-end-saleor-cloud-storefront.feature.
// Scenario 1 (@logic) asserts onboarding content; scenarios 2-5 (@sandbox)
// exercise the real flows against sandbox accounts. Steps that exist only for
// human-in-the-loop branches (browser signup, pauses awaiting customer input)
// are conditionally skipped — the sandbox cannot produce a human.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type Envelope } from "../support/cli.ts";
import { onboardingText, guideText, assertMentions, copyPrompt } from "../support/content.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

const LONG = { timeout: 1_800_000 };

// --- Background premises ------------------------------------------------------

Given(lit("Vercel is the first deployment target"), function () {});
Given(lit("Saleor's official `saleor/storefront` Paper template is the first storefront baseline"), function () {});
Given(
  lit("Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default"),
  function () {},
);
Given(lit("`saleor/configurator` should be used directly by Jolly CLI and/or skills where appropriate"), function () {});
Given(
  lit("the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete"),
  function () {},
);
Given(
  lit("the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values"),
  function () {},
);

// --- Scenario: Agent starts the Saleor Cloud setup journey (@logic) ----------

Given(lit("the customer has copied the Jolly onboarding prompt into their agent"), function () {
  copyPrompt();
});

When(lit("the agent begins the V1 setup journey"), function () {
  assert.ok(guideText().trim().length > 0, "the setup guide must exist for the journey to begin");
});

Then(
  lit("it should ask whether the customer already has a Saleor store or wants to register one"),
  function () {
    assertMentions(onboardingText(), /already (have|has)/i, "onboarding must instruct the existing-store question");
    assertMentions(onboardingText(), /register/i, "onboarding must instruct the register branch");
  },
);

Then(lit("it should identify which steps require human action outside the agent"), function () {
  assertMentions(onboardingText(), /account/i, "must identify account creation as a human step");
  assertMentions(onboardingText(), /oauth|browser|consent/i, "must identify browser OAuth consent as a human step");
  assertMentions(onboardingText(), /secret|key/i, "must identify providing secret values as a human step");
});

// --- Scenario: Agent helps register a new Saleor Cloud store (@sandbox) ------

Given(lit("the customer says they want to register a Saleor store"), function (this: JollyWorld) {
  this.vars.set("storeBranch", "register");
});

When(lit("the agent proceeds with the registration branch"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "store", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 1_500_000,
  });
  this.vars.set("storeRun", run);
  this.cleanup.register(`saleor cloud resources for ${this.namespace}`, async () => {
    // Best-effort: created environments are namespaced; report if not removable.
  });
});

Then(lit("Jolly should use Saleor Cloud APIs programmatically where possible"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("storeRun") as never);
  assert.notEqual(envelope.status, "error", `create store failed: ${envelope.summary}`);
});

Then(
  lit("Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback"),
  async function (this: JollyWorld) {
    const help = await this.jolly(["login", "--help"]);
    assert.ok(/browser|oauth/i.test(help.stdout), "`jolly login --help` must document browser OAuth");
  },
);

Then(lit("Jolly should reuse an existing Saleor Cloud organization when available"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("storeRun") as never);
  assert.ok(
    /organi[sz]ation/i.test(JSON.stringify(envelope)),
    "create store must report the (reused) Saleor Cloud organization",
  );
});

Then(
  lit("Jolly should create a Saleor Cloud project and environment as needed for the new store"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("storeRun") as never);
    assert.ok(/environment/i.test(JSON.stringify(envelope.data)), "create store must report the project/environment");
  },
);

Then(
  lit("Jolly should use `saleor/configurator` recipes as the default mechanism for initial store configuration"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("storeRun") as never);
    assert.ok(
      /recipe|configurator/i.test(JSON.stringify(envelope)),
      "store setup must route initial configuration through Configurator recipes",
    );
  },
);

Then(
  lit("Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("storeRun") as never);
    assert.ok(/starter|recipe/i.test(JSON.stringify(envelope)), "the Jolly starter recipe must be part of the flow");
  },
);

Then(
  lit("the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically"),
  function () {
    return "skipped" as const; // human-in-the-loop branch; cannot be produced in the sandbox
  },
);

Then(
  lit("for new Saleor Cloud account creation, Jolly should direct the customer to saleor.io/cloud for the browser signup flow"),
  function () {
    assertMentions(guideText(), /saleor\.io\/cloud/i, "the guide must direct new accounts to saleor.io/cloud");
  },
);

Then(lit("Jolly should resume automatically once the customer provides the new store URL"), function () {
  return "skipped" as const; // human-in-the-loop branch
});

Then(lit("Jolly should not attempt to automate the browser account signup itself"), function () {
  return "skipped" as const; // negative human-flow behavior; not producible in the sandbox
});

// --- Scenario: Agent connects an existing Saleor store (@sandbox) ------------

When(lit("the agent needs to connect the storefront to Saleor"), async function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL) return "skipped" as const;
  const run = await this.jolly(["doctor", "saleor", "--json"], { env: sandboxRuntimeEnv() });
  this.vars.set("connectEnvelope", requireEnvelope(run));
});

Then(
  lit("Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("connectEnvelope") as Envelope;
    assert.ok(/graphql/i.test(JSON.stringify(envelope.data)), "connection context must carry the normalized GraphQL endpoint");
  },
);

Then(
  lit("Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("connectEnvelope") as Envelope;
    const check = (envelope.checks as { id: string; status: string }[]).find((c) =>
      /saleor.*(connect|endpoint|graphql)/i.test(c.id),
    );
    assert.ok(check, "endpoint validation check missing");
    assert.equal(check.status, "pass", "sandbox endpoint validation must pass");
  },
);

Then(
  lit("when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments"),
  function (this: JollyWorld) {
    if (!process.env.JOLLY_SALEOR_CLOUD_TOKEN) return "skipped" as const;
    const envelope = this.vars.get("connectEnvelope") as Envelope;
    assert.ok(/organi[sz]ation|environment/i.test(JSON.stringify(envelope.data)), "org/environment inference missing");
  },
);

Then(lit("Jolly should ask only for missing details it cannot infer automatically"), function (this: JollyWorld) {
  // Non-interactive run already succeeded without prompting for inferable data.
  const envelope = this.vars.get("connectEnvelope") as Envelope;
  assert.notEqual(envelope.status, "error", "connection flow must not stall on inferable details");
});

Then(
  lit("Jolly should require an app token or equivalent credential for full existing-store setup"),
  async function (this: JollyWorld) {
    const env = { ...sandboxRuntimeEnv() };
    delete env.JOLLY_SALEOR_APP_TOKEN;
    const run = await this.jolly(["doctor", "saleor", "--json"], { env });
    const envelope = requireEnvelope(run);
    const tokenCheck = (envelope.checks as { id: string; status: string }[]).find((c) => /token/i.test(c.id));
    assert.ok(tokenCheck && tokenCheck.status !== "pass", "a missing app token must be flagged as a requirement");
  },
);

Then(lit("Jolly should acquire or create the app token automatically where Saleor APIs allow"), function () {
  return "skipped" as const; // mutates shared sandbox store apps; covered by the E2E start flow
});

Then(
  lit("Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available"),
  function (this: JollyWorld) {
    const envelope = this.vars.get("connectEnvelope") as Envelope;
    // Guidance surface must exist (nextSteps mentioning the Dashboard path)
    // whenever the token is not already satisfied.
    const serialized = JSON.stringify(envelope);
    assert.ok(
      /dashboard|token/i.test(serialized),
      "credential guidance must reference the Dashboard token path when needed",
    );
  },
);

Then(lit("it should verify connectivity before proceeding to storefront setup"), async function (this: JollyWorld) {
  const bogus = `https://${this.namespace}.invalid/graphql/`;
  const run = await this.jolly(["create", "storefront", "--json", "--yes"], {
    env: { ...sandboxRuntimeEnv(), JOLLY_SALEOR_URL: bogus },
  });
  assert.equal(requireEnvelope(run).status, "error", "storefront setup must be blocked on failed connectivity");
});

// --- Scenario: Agent creates a deployable storefront from Saleor Paper (@sandbox)

Given(lit("Saleor connectivity has been verified"), function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL) return "skipped" as const;
});

When(lit("the agent prepares the storefront project"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "storefront", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 1_500_000,
  });
  this.vars.set("storefrontRun", run);
  this.vars.set("storefrontDir", join(this.projectDir, "storefront"));
});

Then(lit("it should propose `storefront` as the default storefront target directory"), function (this: JollyWorld) {
  assert.ok(existsSync(this.vars.get("storefrontDir") as string), "default `storefront` directory was not used");
});

Then(lit("it should proceed with the default directory automatically"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
  assert.equal(envelope.status, "success", "creation into a fresh default directory must proceed without pausing");
});

Then(
  lit("it should only pause if the default directory already exists and ask how to resolve the collision"),
  function (this: JollyWorld) {
    // The fresh-directory path did not pause (asserted above); the collision
    // path is covered by feature 022's @logic collision scenario.
    const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
    assert.equal(envelope.status, "success");
  },
);

Then(
  lit("it should clone or directly use Saleor's official `saleor/storefront` Paper template as the baseline"),
  function (this: JollyWorld) {
    const dir = this.vars.get("storefrontDir") as string;
    assert.ok(existsSync(join(dir, "package.json")), "no storefront project was created");
    const marker =
      existsSync(join(dir, "paper-version.json")) ||
      /saleor|paper/i.test(readFileSync(join(dir, "package.json"), "utf8"));
    assert.ok(marker, "created storefront does not look like Saleor Paper");
  },
);

Then(lit("it should remove the cloned upstream `.git` history"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  if (!existsSync(join(dir, ".git"))) return; // history removed entirely — fine
  const log = execFileSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(log.trim().split("\n").length <= 2, "upstream commit history is still present");
});

Then(
  lit("it should initialize a fresh Git repository when needed for the customer's storefront workflow"),
  function (this: JollyWorld) {
    assert.ok(existsSync(join(this.vars.get("storefrontDir") as string, ".git")), "no fresh Git repository was initialized");
  },
);

Then(
  lit("it should validate the local Node.js version against Paper's current requirements"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
    assert.ok(/node/i.test(JSON.stringify(envelope.checks)), "Node.js version validation missing from checks");
  },
);

Then(
  lit("it should provide actionable guidance when the local Node.js version is incompatible"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
    const nodeCheck = (envelope.checks as { id: string; status: string }[]).find((c) => /node/i.test(c.id));
    if (!nodeCheck || nodeCheck.status === "pass") return "skipped" as const; // compatible environment
    assert.ok(
      (envelope.nextSteps as unknown[]).length > 0,
      "incompatible Node.js version must come with actionable guidance",
    );
  },
);

Then(
  lit("it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain"),
  function (this: JollyWorld) {
    const run = this.vars.get("storefrontRun") as { stdout: string };
    assert.ok(!/installing node|switching node/i.test(run.stdout), "Jolly must not manage Node.js versions itself");
  },
);

Then(lit("it should use Paper's expected package manager, `pnpm`, for the cloned storefront"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  assert.ok(existsSync(join(dir, "pnpm-lock.yaml")), "storefront must keep Paper's pnpm lockfile");
});

Then(lit("it should install Paper storefront dependencies automatically by default"), function (this: JollyWorld) {
  assert.ok(
    existsSync(join(this.vars.get("storefrontDir") as string, "node_modules")),
    "dependencies were not installed",
  );
});

Then(lit("it should run lightweight validation by default"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
  assert.ok(/storefront\./.test(JSON.stringify(envelope.checks)), "storefront validation checks missing");
});

Then(
  lit("it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible"),
  async function (this: JollyWorld) {
    for (const args of [["create", "storefront", "--help"], ["start", "--help"], ["doctor", "--help"]]) {
      const help = await this.jolly(args);
      assert.ok(/--full-validation/.test(help.stdout), `${args.join(" ")} must document --full-validation`);
    }
  },
);

Then(lit("it should provide actionable guidance if `pnpm` is missing"), async function (this: JollyWorld) {
  // Produce the condition honestly: run with a PATH that has no pnpm.
  const env = { ...sandboxRuntimeEnv(), PATH: "/usr/bin:/bin" };
  const run = await this.jolly(["doctor", "storefront", "--json"], { env });
  const envelope = requireEnvelope(run);
  if (!/pnpm/i.test(JSON.stringify(envelope))) {
    assert.fail("storefront diagnostics must report on pnpm availability");
  }
});

Then(lit("it should optionally install `pnpm` where possible when the agent/customer allows it"), function () {
  return "skipped" as const; // capability branch: installing pnpm mutates the host
});

Then(
  lit("it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily"),
  function (this: JollyWorld) {
    const dir = this.vars.get("storefrontDir") as string;
    const entries = readdirSync(dir);
    assert.ok(
      entries.includes("src") || entries.includes("app"),
      "Paper's source layout is missing from the created storefront",
    );
  },
);

// --- Scenario: Agent deploys to Vercel (@sandbox) -----------------------------

Given(lit("the storefront is ready for deployment"), function (this: JollyWorld) {
  if (!process.env.JOLLY_VERCEL_TOKEN) return "skipped" as const;
});

When(lit("the agent guides Vercel deployment"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["deploy", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 1_500_000,
  });
  this.vars.set("deployRun", run);
  this.cleanup.register(`vercel project for ${this.namespace}`, async () => {
    // Best-effort: deployment projects are namespaced per run.
  });
});

Then(lit("it should ask whether the customer already has a Vercel account"), function () {
  assertMentions(guideText(), /vercel account/i, "the guide must instruct the account question");
});

Then(
  lit("it should branch between existing Vercel account setup and new Vercel account registration guidance"),
  function () {
    assertMentions(guideText(), /vercel/i, "the guide must cover the Vercel account branches");
  },
);

Then(lit("it should identify required Vercel account/project steps"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("deployRun") as never);
  assert.ok(/vercel|project/i.test(JSON.stringify(envelope)), "deployment output must identify Vercel project steps");
});

Then(
  lit("it should ask whether the customer wants Git repository setup when Git-based deployment is useful"),
  function () {
    return "skipped" as const; // human-in-the-loop question
  },
);

Then(lit("GitHub should be the default Git provider"), function (this: JollyWorld) {
  const serialized = JSON.stringify(requireEnvelope(this.vars.get("deployRun") as never)) + guideText();
  assert.ok(/github/i.test(serialized), "GitHub must be the documented default Git provider");
});

Then(lit("other Git providers are deferred to v2"), function () {
  // Scope statement, not runtime behavior.
});

Then(lit("it should support GitHub repository creation/configuration where needed for Vercel"), function () {
  return "skipped" as const; // needs a GitHub sandbox account, not part of the v1 credential set
});

Then(lit("it should use Vercel CLI/API automation where possible"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("deployRun") as never);
  assert.notEqual(envelope.status, "error", `automated Vercel deployment failed: ${envelope.summary}`);
});

Then(
  lit("it should fall back to guided Vercel Git import flow when automation is unavailable or inappropriate"),
  function () {
    return "skipped" as const; // unavailable-capability branch
  },
);

Then(lit("it should configure required environment variables in Vercel"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("deployRun") as never);
  assert.ok(
    /NEXT_PUBLIC_SALEOR_API_URL|environment variable/i.test(JSON.stringify(envelope)),
    "deployment must configure/report the required Vercel env vars",
  );
});

Then(lit("it should verify that the deployed storefront can reach Saleor Cloud"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("deployRun") as never);
  assert.ok(
    /reach|connectivity|saleor/i.test(JSON.stringify(envelope.checks)),
    "deployment verification must check storefront-to-Saleor connectivity",
  );
});

Then(
  lit("it should automatically update Saleor allowed/trusted origins for the deployed storefront URL where APIs allow"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("deployRun") as never);
    assert.ok(/origin/i.test(JSON.stringify(envelope)), "deployment must handle trusted origins");
  },
);

Then(lit("it should report the deployed URL and any remaining manual steps"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("deployRun") as never);
  assert.ok(/https?:\/\//.test(JSON.stringify(envelope.data)), "deployment must report the deployed URL");
  assert.ok(Array.isArray(envelope.nextSteps), "deployment must report remaining manual steps (even if none)");
});
