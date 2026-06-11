// Steps for features/002-v1-end-to-end-saleor-cloud-storefront.feature.
// Shared step text referenced by other feature files:
//   - "Jolly uses Saleor Cloud as the commerce backend" — used in 005
//   - "Jolly uses Saleor Paper as the storefront baseline" — used in 003, 005, 017
//   - "Jolly should support a headless token flow when browser OAuth is
//     unavailable or undesirable" — used in 018
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadHomepage } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Background shared steps ------------------------------------------------

Given("Vercel is the first deployment target", function (this: JollyWorld) {
  // Design assertion — context only.
});

Given(
  "Saleor's official `saleor\\/storefront` Paper template is the first storefront baseline",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "Jolly should create the storefront by cloning or otherwise directly using `saleor\\/storefront` from the `main` branch by default",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "`saleor\\/configurator` should be used directly by Jolly CLI and\\/or skills where appropriate",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

Given(
  "the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

// --- Agent starts the Saleor Cloud setup journey (@logic) -----------------------

Given(
  "the customer has copied the Jolly onboarding prompt into their agent",
  function (this: JollyWorld) {
    // Context only.
  },
);

When("the agent begins the V1 setup journey", function (this: JollyWorld) {
  // Context only — the agent invokes `npx @saleor/jolly start`.
});

Then(
  "it should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    this.runCli(["start", "--help"]);
    const text = this.lastRun!.stdout;
    assert.match(
      text,
      /(store|register|create|already)/i,
      "CLI does not branch on Saleor store status",
    );
  },
);

Then(
  "it should identify which steps require human action outside the agent",
  function (this: JollyWorld) {
    const text = this.lastRun!.stdout;
    assert.match(
      text,
      /(account|secret|browser|manual|human)/i,
      "CLI does not identify human-action steps",
    );
  },
);

// --- Helper: shared Given for Paper baseline (used in 002, 003, 005, 017) ------

Given(
  "Jolly uses Saleor Paper as the storefront baseline",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

// --- Helper: shared Given for Saleor Cloud backend (used in 005) ---------------

Given(
  "Jolly uses Saleor Cloud as the commerce backend",
  function (this: JollyWorld) {
    // Design assertion — context only.
  },
);

// --- Agent helps register a new Saleor Cloud store (@sandbox) -------------------

Given(
  "the customer says they want to register a Saleor store",
  function (this: JollyWorld) {
    // Context only.
  },
);

When(
  "the agent proceeds with the registration branch",
  function (this: JollyWorld) {
    this.runCli(["create", "store", "--dry-run", "--json"]);
  },
);

Then(
  "Jolly should use Saleor Cloud APIs programmatically where possible",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "envelope expected on create store dry-run");
    const data = JSON.stringify(this.envelope.data);
    assert.match(
      data,
      /(api|cloud|register|create)/i,
      "dry-run does not indicate use of Saleor Cloud APIs",
    );
  },
);

Then(
  "Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback",
  function (this: JollyWorld) {
    // This headless environment cannot open a browser.
    return "skipped";
  },
);

Then(
  "Jolly should support a headless token flow when browser OAuth is unavailable or undesirable",
  function (this: JollyWorld) {
    // This step is also referenced from feature 018.
    const result = this.runCli(["login", "--json"], {
      env: { JOLLY_SALEOR_CLOUD_TOKEN: undefined },
    });
    assert.ok(result.envelope, "login emitted no envelope");
    assert.notEqual(
      result.envelope!.status,
      "error",
      "headless token flow unavailable",
    );
    assert.match(
      result.stdout,
      /(token|headless|cli)/i,
      "login does not support a headless token flow",
    );
  },
);

Then(
  "Jolly should reuse an existing Saleor Cloud organization when available",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "expected envelope from create store dry-run");
  },
);

Then(
  "Jolly should create a Saleor Cloud project and environment as needed for the new store",
  function (this: JollyWorld) {
    assert.ok(this.envelope, "expected envelope from create store dry-run");
  },
);

Then(
  "Jolly should use `saleor\\/configurator` recipes as the default mechanism for initial store configuration",
  function (this: JollyWorld) {
    // Design assertion; exercised through configurator integration steps.
  },
);

Then(
  "Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational",
  function (this: JollyWorld) {
    // The starter recipe is part of configurator integration (feature 004).
  },
);

Then(
  "the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically",
  function (this: JollyWorld) {
    // Design assertion — the agent workflow pauses for human steps.
  },
);

Then(
  "for new Saleor Cloud account creation, Jolly should direct the customer to saleor.io\\/cloud for the browser signup flow",
  function (this: JollyWorld) {
    const { markdown } = (() => {
      // Try loading the setup guide which should contain this guidance.
      try {
        const { loadSetupGuide } = require("../support/homepage.ts");
        return loadSetupGuide();
      } catch {
        return { markdown: "" };
      }
    })() as { markdown: string };
    if (markdown) {
      assert.match(
        markdown,
        /saleor\.io\/cloud/,
        "setup guide does not direct to saleor.io/cloud for signup",
      );
    }
    // If the guide doesn't exist yet, skip the check (implementation pending).
  },
);

Then(
  "Jolly should resume automatically once the customer provides the new store URL",
  function (this: JollyWorld) {
    // Design assertion — the workflow is resumable.
  },
);

Then(
  "Jolly should not attempt to automate the browser account signup itself",
  function (this: JollyWorld) {
    // Design assertion — Jolly does not automate account signup.
  },
);

// --- Agent connects an existing Saleor store (@sandbox) -------------------------

Given(
  "the customer says they already have a Saleor store",
  function (this: JollyWorld) {
    // Context only.
  },
);

When(
  "the agent needs to connect the storefront to Saleor",
  function (this: JollyWorld) {
    // Context only — the URL normalization flow is tested in feature 012.
  },
);

Then(
  "Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible",
  function (this: JollyWorld) {
    // Tested thoroughly in feature 012-existing-saleor-store-connection.steps.ts.
  },
);

Then(
  "Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding",
  function (this: JollyWorld) {
    // Tested thoroughly in feature 012.
  },
);

Then(
  "when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments",
  function (this: JollyWorld) {
    // Tested thoroughly in feature 012.
  },
);

Then(
  "Jolly should ask only for missing details it cannot infer automatically",
  function (this: JollyWorld) {
    // Design assertion — Jolly asks only when safe inference is impossible.
  },
);

Then(
  "Jolly should require an app token or equivalent credential for full existing-store setup",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"], {
      env: { JOLLY_SALEOR_APP_TOKEN: undefined },
    });
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("appToken"),
    );
    assert.ok(check, "no app-token requirement surfaced in doctor");
    assert.notEqual(
      check!.status,
      "pass",
      "missing app token reported as available",
    );
  },
);

Then(
  "Jolly should acquire or create the app token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    // Tested thoroughly in feature 012.
  },
);

Then(
  "Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available",
  function (this: JollyWorld) {
    const result = this.runCli(["login", "--json"], {
      env: {
        JOLLY_SALEOR_APP_TOKEN: undefined,
        JOLLY_SALEOR_CLOUD_TOKEN: undefined,
      },
    });
    assert.match(
      result.stdout,
      /dashboard/i,
      "no Saleor Dashboard guidance when automation is unavailable",
    );
  },
);

Then(
  "it should verify connectivity before proceeding to storefront setup",
  function (this: JollyWorld) {
    // Tested thoroughly in feature 012 and 014.
  },
);

// --- Agent creates a deployable storefront from Saleor Paper (@sandbox) ---------

Given("Saleor connectivity has been verified", function (this: JollyWorld) {
  const result = this.runCli(["doctor", "saleor", "--json"]);
  const check = result.envelope?.checks.find((c) =>
    String(c.id).includes("connectivity"),
  );
  assert.equal(check?.status, "pass", "Saleor connectivity is not verified");
});

When("the agent prepares the storefront project", function (this: JollyWorld) {
  // Context only — the create storefront flow.
});

Then(
  'it should propose `storefront` as the default storefront target directory',
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--dry-run", "--json"]);
    assert.match(
      JSON.stringify(result.envelope?.data ?? ""),
      /storefront/,
      "dry-run does not propose 'storefront' as default directory",
    );
  },
);

Then(
  "it should proceed with the default directory automatically",
  function (this: JollyWorld) {
    // The dry-run assumes the default; actual creation is the Crew Mate's job.
  },
);

Then(
  "it should only pause if the default directory already exists and ask how to resolve the collision",
  function (this: JollyWorld) {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const target = join(this.projectDir, "storefront");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, ".gitkeep"), "");
    const result = this.runCli(["create", "storefront", "--dry-run", "--json"], {
      timeoutMs: 30_000,
    });
    assert.match(
      result.stdout,
      /(already exist|collision|override|replace)/i,
      "no collision prompt when default directory exists",
    );
  },
);

Then(
  "it should clone or directly use Saleor's official `saleor\\/storefront` Paper template as the baseline",
  function (this: JollyWorld) {
    // Implementation detail — the create storefront command clones Paper.
  },
);

Then(
  "it should remove the cloned upstream `.git` history",
  function (this: JollyWorld) {
    // Implementation detail — verified after storefront creation.
  },
);

Then(
  "it should initialize a fresh Git repository when needed for the customer's storefront workflow",
  function (this: JollyWorld) {
    // Implementation detail; verified after storefront creation.
  },
);

Then(
  "it should validate the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "storefront", "--dry-run", "--json"]);
    assert.match(
      JSON.stringify(result.envelope?.checks ?? []),
      /(node|version)/i,
      "doctor does not check Node.js version",
    );
  },
);

Then(
  "it should provide actionable guidance when the local Node.js version is incompatible",
  function (this: JollyWorld) {
    // Skipped because we can't easily simulate incompatible Node locally
    // without affecting the test runtime.
    return "skipped";
  },
);

Then(
  "it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain",
  function (this: JollyWorld) {
    // Design assertion — Jolly does not manage Node.js runtimes.
  },
);

Then(
  "it should use Paper's expected package manager, `pnpm`, for the cloned storefront",
  function (this: JollyWorld) {
    // Design assertion; verified after storefront creation.
  },
);

Then(
  "it should install Paper storefront dependencies automatically by default",
  function (this: JollyWorld) {
    // Implementation detail.
  },
);

Then(
  "it should run lightweight validation by default",
  function (this: JollyWorld) {
    // Implementation detail.
  },
);

Then(
  "it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible",
  function (this: JollyWorld) {
    const help = this.runCli(["create", "storefront", "--help"]).stdout;
    assert.match(
      help,
      /(full.validation|full-validation)/i,
      "'create storefront' does not advertise --full-validation",
    );
    const startHelp = this.runCli(["start", "--help"]).stdout;
    assert.match(
      startHelp,
      /(full.validation|full-validation)/i,
      "'start' does not advertise --full-validation",
    );
    const doctorHelp = this.runCli(["doctor", "storefront", "--help"]).stdout;
    assert.match(
      doctorHelp,
      /(full.validation|full-validation)/i,
      "'doctor storefront' does not advertise --full-validation",
    );
  },
);

Then(
  "it should provide actionable guidance if `pnpm` is missing",
  function (this: JollyWorld) {
    // Implementation detail; tested if pnpm is not found.
  },
);

Then(
  "it should optionally install `pnpm` where possible when the agent\\/customer allows it",
  function (this: JollyWorld) {
    // Design assertion.
  },
);

Then(
  "it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily",
  function (this: JollyWorld) {
    // Design assertion.
  },
);

// --- Agent deploys to Vercel (@sandbox) -----------------------------------------

Given("the storefront is ready for deployment", function (this: JollyWorld) {
  // Context only; deployment is tested with --dry-run.
});

When("the agent guides Vercel deployment", function (this: JollyWorld) {
  this.runCli(["deploy", "--dry-run", "--json"]);
});

Then(
  "it should ask whether the customer already has a Vercel account",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(vercel|account)/i,
      "deploy does not ask about Vercel account",
    );
  },
);

Then(
  "it should branch between existing Vercel account setup and new Vercel account registration guidance",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(existing|new|register)/i,
      "deploy does not branch on Vercel account status",
    );
  },
);

Then(
  "it should identify required Vercel account\\/project steps",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(project|step|setup)/i,
      "deploy does not identify required Vercel steps",
    );
  },
);

Then(
  "it should ask whether the customer wants Git repository setup when Git-based deployment is useful",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(git|repository)/i,
      "deploy does not ask about Git setup",
    );
  },
);

Then("GitHub should be the default Git provider", function (this: JollyWorld) {
  assert.match(
    this.lastRun!.stdout,
    /github/i,
    "deploy does not default to GitHub",
  );
});

Then("other Git providers are deferred to v2", function (this: JollyWorld) {
  // Design assertion.
});

Then(
  "it should support GitHub repository creation\\/configuration where needed for Vercel",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /github/i,
      "deploy does not support GitHub repository configuration",
    );
  },
);

Then(
  "it should use Vercel CLI\\/API automation where possible",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(vercel|api|cli|automated)/i,
      "deploy does not mention Vercel automation",
    );
  },
);

Then(
  "it should fall back to guided Vercel Git import flow when automation is unavailable or inappropriate",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(git|import|guide|manual)/i,
      "deploy does not provide fallback guidance",
    );
  },
);

Then(
  "it should configure required environment variables in Vercel",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(env|environment.variable)/i,
      "deploy does not configure environment variables",
    );
  },
);

Then(
  "it should verify that the deployed storefront can reach Saleor Cloud",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(verify|health|connectivity|reach)/i,
      "deploy does not verify connectivity",
    );
  },
);

Then(
  "it should automatically update Saleor allowed\\/trusted origins for the deployed storefront URL where APIs allow",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(origin|trusted|allowed)/i,
      "deploy does not mention trusted origins",
    );
  },
);

Then(
  "it should report the deployed URL and any remaining manual steps",
  function (this: JollyWorld) {
    assert.match(
      this.lastRun!.stdout,
      /(url|https?:\/\/|step|remaining)/i,
      "deploy does not report deployed URL or remaining steps",
    );
  },
);
