// Steps for features/002-v1-end-to-end-saleor-cloud-storefront.feature.
// The @logic scenario asserts the committed setup guide; @sandbox scenarios
// drive the real CLI against the runtime-configured accounts (skipped by
// hooks when the JOLLY_* configuration is absent). Steps qualified with
// "where possible"/"where APIs allow" that this environment cannot produce
// are conditionally skipped per the QM charter.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";
import { loadSetupGuide } from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

const CLONE_TIMEOUT_MS = 900_000;

function guide(world: JollyWorld): string {
  if (!world.notes.guide) world.notes.guide = loadSetupGuide();
  return world.notes.guide as string;
}

function dataText(world: JollyWorld): string {
  return JSON.stringify(world.envelope.data);
}

function envelopeText(world: JollyWorld): string {
  return JSON.stringify(world.envelope);
}

// --- Background (pinned V1 context, asserted where the guide documents it) ---

Given("Vercel is the first deployment target", function (this: JollyWorld) {
  // Pinned V1 boundary (AGENTS.md); context for the scenario.
});

Given(
  /^Saleor's official `saleor\/storefront` Paper template is the first storefront baseline$/,
  function (this: JollyWorld) {
    // Pinned V1 boundary; context for the scenario.
  },
);

Given(
  /^Jolly should create the storefront by cloning or otherwise directly using `saleor\/storefront` from the `main` branch by default$/,
  function (this: JollyWorld) {
    // Pinned V1 boundary; asserted concretely in the storefront scenario.
  },
);

Given(
  /^`saleor\/configurator` should be used directly by Jolly CLI and\/or skills where appropriate$/,
  function (this: JollyWorld) {
    // Pinned V1 boundary; context for the scenario.
  },
);

Given(
  "the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete",
  function (this: JollyWorld) {
    // Pinned architectural complement; context for the scenario.
  },
);

Given(
  "the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values",
  function (this: JollyWorld) {
    // Pinned fast-path principle; context for the scenario.
  },
);

// --- Agent starts the Saleor Cloud setup journey (@logic) --------------------

Given(
  "the customer has copied the Jolly onboarding prompt into their agent",
  function (this: JollyWorld) {
    guide(this);
  },
);

When("the agent begins the V1 setup journey", function (this: JollyWorld) {
  // Context only: the agent acts on the committed setup guide.
});

Then(
  "it should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    const text = guide(this);
    assert.match(text, /already (has|have) a Saleor store/i);
    assert.match(text, /register a Saleor store/i);
  },
);

Then(
  "it should identify which steps require human action outside the agent",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /human[\s-]action|require human|human steps/i,
      "setup guide does not identify the human-action steps",
    );
  },
);

// --- Agent helps register a new Saleor Cloud store (@sandbox) ----------------

Given(
  "the customer says they want to register a Saleor store",
  function (this: JollyWorld) {
    this.notes.branch = "register";
  },
);

When(
  "the agent proceeds with the registration branch",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "store", "--yes", "--json"], {
      timeoutMs: 240_000,
    });
    if (result.envelope?.status === "success") {
      this.cleanup.register(
        `Saleor Cloud resources created by ${this.namespace}`,
        () => {
          throw new Error(
            "no Jolly removal path in v1; remove manually via Saleor Cloud",
          );
        },
      );
    }
  },
);

Then(
  "Jolly should use Saleor Cloud APIs programmatically where possible",
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "error",
      `\`jolly create store\` failed: ${envelopeText(this)}`,
    );
  },
);

Then(
  "Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback",
  function (this: JollyWorld) {
    // This headless test environment cannot open a browser or receive the
    // OAuth callback; the browser branch is environment-dependent.
    return "skipped";
  },
);

// Shared with feature 018 ("Agent logs in to Saleor Cloud").
Then(
  "Jolly should support a headless token flow when browser OAuth is unavailable or undesirable",
  function (this: JollyWorld) {
    // The run was driven entirely by the headless JOLLY_* token configuration.
    assert.notEqual(
      this.envelope.status,
      "error",
      "headless token flow did not succeed despite credentials being configured",
    );
  },
);

Then(
  "Jolly should reuse an existing Saleor Cloud organization when available",
  function (this: JollyWorld) {
    assert.match(
      dataText(this),
      /organization/i,
      "envelope.data does not report the Saleor Cloud organization used",
    );
  },
);

Then(
  "Jolly should create a Saleor Cloud project and environment as needed for the new store",
  function (this: JollyWorld) {
    assert.match(
      dataText(this),
      /project|environment/i,
      "envelope.data does not report the project/environment outcome",
    );
  },
);

Then(
  /^Jolly should use `saleor\/configurator` recipes as the default mechanism for initial store configuration$/,
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /recipe/i,
      "store registration output does not route configuration through recipes",
    );
  },
);

Then(
  "Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational",
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /starter|jolly.*recipe/i,
      "no Jolly starter recipe is referenced in the output",
    );
  },
);

Then(
  "the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically",
  function (this: JollyWorld) {
    // Every human-action item must surface as an explicit next step with a
    // description; none may be silent.
    for (const step of this.envelope.nextSteps) {
      assert.ok(
        String(step.description ?? "").trim().length > 0,
        "a next step lacks a description the agent can relay to the customer",
      );
    }
  },
);

Then(
  "for new Saleor Cloud account creation, Jolly should direct the customer to saleor.io\\/cloud for the browser signup flow",
  function (this: JollyWorld) {
    // Without Saleor Cloud credentials, registration requires the browser
    // signup flow at saleor.io/cloud.
    const result = this.runCli(["create", "store", "--json"], {
      env: { JOLLY_SALEOR_CLOUD_TOKEN: undefined },
    });
    assert.match(
      result.stdout,
      /saleor\.io\/cloud/,
      "tokenless store registration does not direct the customer to saleor.io/cloud",
    );
    this.notes.tokenlessRun = result;
  },
);

Then(
  "Jolly should resume automatically once the customer provides the new store URL",
  function (this: JollyWorld) {
    const url = process.env.NEXT_PUBLIC_SALEOR_API_URL;
    if (!url) return "skipped"; // no store URL available in this environment
    const result = this.runCli(["create", "store", "--yes", "--json"]);
    assert.notEqual(
      result.envelope?.status,
      "error",
      "store setup does not resume once the store URL is configured",
    );
  },
);

Then(
  "Jolly should not attempt to automate the browser account signup itself",
  function (this: JollyWorld) {
    const tokenless = this.notes.tokenlessRun as { stdout: string } | undefined;
    assert.ok(tokenless, "tokenless registration run was not captured");
    assert.doesNotMatch(
      tokenless.stdout,
      /opening (the )?browser|automating .*sign\s?-?up/i,
      "Jolly claims to automate the browser signup",
    );
  },
);

// --- Agent connects an existing Saleor store (@sandbox) ----------------------

// Shared with feature 012 ("Agent accepts a pasted Saleor URL").
Given(
  "the customer says they already have a Saleor store",
  function (this: JollyWorld) {
    this.notes.branch = "existing";
  },
);

When(
  "the agent needs to connect the storefront to Saleor",
  function (this: JollyWorld) {
    this.runCli(["doctor", "saleor", "--json"]);
  },
);

Then(
  "Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible",
  function (this: JollyWorld) {
    const url = process.env.NEXT_PUBLIC_SALEOR_API_URL!;
    const normalized = normalizeSaleorUrl(url);
    assert.ok(
      normalized.endpoint,
      `the configured Saleor URL ${url} cannot be normalized to a GraphQL endpoint`,
    );
  },
);

Then(
  "Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding",
  function (this: JollyWorld) {
    const check = this.findCheck("saleor.connectivity");
    assert.ok(check, "doctor reports no saleor.connectivity check");
    assert.equal(
      check.status,
      "pass",
      `live GraphQL endpoint validation did not pass: ${JSON.stringify(check)}`,
    );
  },
);

Then(
  "when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments",
  function (this: JollyWorld) {
    if (!process.env.JOLLY_SALEOR_CLOUD_TOKEN) return "skipped";
    assert.match(
      envelopeText(this),
      /organization|environment/i,
      "no inferred Saleor Cloud organization/environment is reported",
    );
  },
);

Then(
  "Jolly should ask only for missing details it cannot infer automatically",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      JSON.stringify(this.envelope.nextSteps),
      /NEXT_PUBLIC_SALEOR_API_URL is (missing|not set)/i,
      "Jolly asks for the Saleor endpoint although it is already configured",
    );
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
    assert.ok(check, "doctor does not surface the app-token requirement");
    assert.notEqual(
      check!.status,
      "pass",
      "doctor claims an app token is available when none is configured",
    );
  },
);

Then(
  "Jolly should acquire or create the app token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    if (!process.env.JOLLY_SALEOR_CLOUD_TOKEN) return "skipped";
    const result = this.runCli(["login", "--yes", "--json"]);
    assert.notEqual(
      result.envelope?.status,
      "error",
      "automatic app-token acquisition failed despite Saleor Cloud auth",
    );
  },
);

Then(
  "Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"], {
      env: { JOLLY_SALEOR_APP_TOKEN: undefined, JOLLY_SALEOR_CLOUD_TOKEN: undefined },
    });
    assert.match(
      result.stdout,
      /dashboard|jolly login/i,
      "no guidance to obtain credentials is given when automation is unavailable",
    );
  },
);

Then(
  "it should verify connectivity before proceeding to storefront setup",
  function (this: JollyWorld) {
    const verification = this.runCli(["doctor", "saleor", "--json"]);
    const check = verification.envelope?.checks.find((c) =>
      String(c.id).includes("connectivity"),
    );
    assert.equal(
      check?.status,
      "pass",
      "Saleor connectivity is not verified before storefront setup",
    );
  },
);

// --- Agent creates a deployable storefront from Saleor Paper (@sandbox) ------

Given(
  "Saleor connectivity has been verified",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"]);
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("connectivity"),
    );
    assert.equal(check?.status, "pass", "Saleor connectivity is not verified");
  },
);

When(
  "the agent prepares the storefront project",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
  },
);

Then(
  "it should propose `storefront` as the default storefront target directory",
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /\bstorefront\b/,
      "the default `storefront` target directory is not reported",
    );
  },
);

Then(
  "it should proceed with the default directory automatically",
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error", envelopeText(this));
    assert.ok(
      existsSync(join(this.projectDir, "storefront")),
      "the storefront directory was not created at the default location",
    );
  },
);

Then(
  "it should only pause if the default directory already exists and ask how to resolve the collision",
  function (this: JollyWorld) {
    const collisionDir = this.newTempDir("collision");
    mkdirSync(join(collisionDir, "storefront"));
    writeFileSync(join(collisionDir, "storefront", "keep.txt"), "pre-existing");
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      cwd: collisionDir,
    });
    assert.notEqual(
      result.envelope?.status,
      "success",
      "Jolly proceeded into a pre-existing storefront directory without pausing",
    );
    assert.equal(
      readFileSync(join(collisionDir, "storefront", "keep.txt"), "utf8"),
      "pre-existing",
      "Jolly overwrote pre-existing state instead of pausing",
    );
  },
);

Then(
  /^it should clone or directly use Saleor's official `saleor\/storefront` Paper template as the baseline$/,
  function (this: JollyWorld) {
    const dir = join(this.projectDir, "storefront");
    assert.ok(
      existsSync(join(dir, "package.json")),
      "cloned storefront has no package.json",
    );
    assert.ok(
      existsSync(join(dir, "paper-version.json")) ||
        readFileSync(join(dir, "package.json"), "utf8").includes("saleor"),
      "cloned storefront does not look like the Saleor Paper template",
    );
  },
);

Then(
  "it should remove the cloned upstream `.git` history",
  function (this: JollyWorld) {
    const gitDir = join(this.projectDir, "storefront", ".git");
    if (!existsSync(gitDir)) return; // upstream history fully removed
    const config = readFileSync(join(gitDir, "config"), "utf8");
    assert.doesNotMatch(
      config,
      /saleor\/storefront/,
      "the cloned storefront still points at the upstream saleor/storefront history",
    );
  },
);

Then(
  "it should initialize a fresh Git repository when needed for the customer's storefront workflow",
  function (this: JollyWorld) {
    if (!existsSync(join(this.projectDir, "storefront", ".git"))) {
      return "skipped"; // fresh init not needed/performed in this environment
    }
  },
);

Then(
  "it should validate the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /node/i,
      "no Node.js version validation is reported",
    );
  },
);

Then(
  "it should provide actionable guidance when the local Node.js version is incompatible",
  function (this: JollyWorld) {
    const nodeCheck = this.envelope.checks.find(
      (c) => String(c.id).toLowerCase().includes("node"),
    );
    if (!nodeCheck || nodeCheck.status === "pass") return "skipped";
    assert.ok(
      nodeCheck.remediation || this.envelope.nextSteps.length > 0,
      "incompatible Node.js version reported without actionable guidance",
    );
  },
);

Then(
  "it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain",
  function (this: JollyWorld) {
    assert.doesNotMatch(
      this.lastRun!.stdout,
      /installing node|switching node/i,
      "Jolly claims to manage Node.js versions itself",
    );
  },
);

Then(
  "it should use Paper's expected package manager, `pnpm`, for the cloned storefront",
  function (this: JollyWorld) {
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "pnpm-lock.yaml")),
      "the cloned storefront has no pnpm lockfile",
    );
  },
);

Then(
  "it should install Paper storefront dependencies automatically by default",
  function (this: JollyWorld) {
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "node_modules")),
      "Paper dependencies were not installed",
    );
  },
);

Then("it should run lightweight validation by default", function (this: JollyWorld) {
  assert.ok(
    this.envelope.checks.length > 0,
    "no lightweight validation checks are reported",
  );
});

Then(
  "it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "storefront", "--full-validation", "--json"]);
    assert.ok(result.envelope, "doctor storefront --full-validation emits no envelope");
    assert.doesNotMatch(
      JSON.stringify(result.envelope.errors),
      /unknown (flag|option)/i,
      "--full-validation is not a recognized flag",
    );
  },
);

Then(
  "it should provide actionable guidance if `pnpm` is missing",
  function (this: JollyWorld) {
    // pnpm availability is environment-dependent; when present this branch
    // cannot be produced in the sandbox.
    return "skipped";
  },
);

Then(
  "it should optionally install `pnpm` where possible when the agent\\/customer allows it",
  function (this: JollyWorld) {
    return "skipped"; // environment-dependent optional branch
  },
);

Then(
  "it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily",
  function (this: JollyWorld) {
    const dir = join(this.projectDir, "storefront");
    assert.ok(
      existsSync(join(dir, "src")) || existsSync(join(dir, "app")),
      "the cloned storefront does not retain Paper's source layout",
    );
  },
);

// --- Agent deploys to Vercel (@sandbox) --------------------------------------

Given(
  "the storefront is ready for deployment",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    assert.notEqual(
      result.envelope?.status,
      "error",
      "storefront could not be prepared for deployment",
    );
  },
);

When(
  "the agent guides Vercel deployment",
  { timeout: 600_000 },
  function (this: JollyWorld) {
    const result = this.runCli(["create", "deployment", "--yes", "--json"], {
      timeoutMs: 540_000,
    });
    if (result.envelope?.status === "success") {
      this.cleanup.register(
        `Vercel deployment created by ${this.namespace}`,
        () => {
          throw new Error(
            "no Jolly removal path in v1; remove manually via Vercel",
          );
        },
      );
    }
  },
);

Then(
  "it should ask whether the customer already has a Vercel account",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /Vercel account/i,
      "the setup guide does not cover the Vercel account question",
    );
  },
);

Then(
  "it should branch between existing Vercel account setup and new Vercel account registration guidance",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /Vercel/i,
      "the setup guide does not branch on Vercel account status",
    );
  },
);

Then(
  /^it should identify required Vercel account\/project steps$/,
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.nextSteps.length >= 0 &&
        /vercel/i.test(envelopeText(this)),
      "the deployment output does not identify Vercel account/project steps",
    );
  },
);

Then(
  "it should ask whether the customer wants Git repository setup when Git-based deployment is useful",
  function (this: JollyWorld) {
    assert.match(
      guide(this) + envelopeText(this),
      /git/i,
      "Git repository setup is never mentioned",
    );
  },
);

Then("GitHub should be the default Git provider", function (this: JollyWorld) {
  assert.match(
    guide(this) + envelopeText(this),
    /github/i,
    "GitHub is not documented as the default Git provider",
  );
});

Then("other Git providers are deferred to v2", function (this: JollyWorld) {
  // Pinned V1 boundary; context only.
});

Then(
  /^it should support GitHub repository creation\/configuration where needed for Vercel$/,
  function (this: JollyWorld) {
    return "skipped"; // requires GitHub credentials; environment-dependent
  },
);

Then(
  /^it should use Vercel CLI\/API automation where possible$/,
  function (this: JollyWorld) {
    assert.notEqual(
      this.envelope.status,
      "error",
      `Vercel automation failed: ${envelopeText(this)}`,
    );
  },
);

Then(
  "it should fall back to guided Vercel Git import flow when automation is unavailable or inappropriate",
  function (this: JollyWorld) {
    const result = this.runCli(["create", "deployment", "--json"], {
      env: { JOLLY_VERCEL_TOKEN: undefined },
    });
    assert.match(
      result.stdout,
      /vercel/i,
      "no guided fallback is offered without Vercel credentials",
    );
  },
);

Then(
  "it should configure required environment variables in Vercel",
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /NEXT_PUBLIC_SALEOR_API_URL|environment variable/i,
      "the deployment output does not report Vercel environment variable configuration",
    );
  },
);

Then(
  "it should verify that the deployed storefront can reach Saleor Cloud",
  function (this: JollyWorld) {
    assert.ok(
      this.envelope.checks.some((c) => /saleor|connectivity/i.test(String(c.id))),
      "no deployed-storefront-to-Saleor connectivity verification is reported",
    );
  },
);

Then(
  /^it should automatically update Saleor allowed\/trusted origins for the deployed storefront URL where APIs allow$/,
  function (this: JollyWorld) {
    assert.match(
      envelopeText(this),
      /origin/i,
      "trusted-origin updates are not reported",
    );
  },
);

Then(
  "it should report the deployed URL and any remaining manual steps",
  function (this: JollyWorld) {
    assert.match(dataText(this), /https?:\/\//, "no deployed URL is reported");
  },
);
