// Steps for features/003-saleor-source-repositories-and-integration.feature.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSetupGuide } from "../support/homepage.ts";
import { REPO_ROOT, type JollyWorld } from "../support/world.ts";
import { assertRiskContextShape, findRiskContexts } from "../support/envelope.ts";

const CLONE_TIMEOUT_MS = 900_000;

function guide(world: JollyWorld): string {
  if (!world.notes.guide) world.notes.guide = loadSetupGuide();
  return world.notes.guide as string;
}

/** All committed Jolly production sources (the disposable CLI implementation). */
function productionSources(): string[] {
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(REPO_ROOT, "src"));
  return sources;
}

// --- Use Saleor Paper as the storefront baseline (@sandbox) -------------------

Given("Jolly needs to create a storefront project", function (this: JollyWorld) {
  // Context only.
});

When(
  "the customer's agent reaches the storefront creation step",
  { timeout: CLONE_TIMEOUT_MS + 60_000 },
  function (this: JollyWorld) {
    this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
  },
);

Then(
  /^it should clone or directly use `saleor\/storefront`$/,
  function (this: JollyWorld) {
    assert.notEqual(this.envelope.status, "error", this.lastRun!.stdout);
    assert.ok(
      existsSync(join(this.projectDir, "storefront", "package.json")),
      "no storefront was cloned",
    );
  },
);

Then("it should treat Paper as the first storefront baseline", function (this: JollyWorld) {
  const dir = join(this.projectDir, "storefront");
  assert.ok(
    existsSync(join(dir, "paper-version.json")) ||
      /paper/i.test(JSON.stringify(this.envelope.data)),
    "the cloned storefront is not the Paper baseline",
  );
});

Then(
  "it should preserve Paper's architecture unless the customer explicitly asks for customization",
  function (this: JollyWorld) {
    const dir = join(this.projectDir, "storefront");
    assert.ok(
      existsSync(join(dir, "src")) || existsSync(join(dir, "app")),
      "Paper's source architecture is not preserved",
    );
  },
);

Then(
  "it should install and preserve Paper's agent guidance where applicable",
  function (this: JollyWorld) {
    const dir = join(this.projectDir, "storefront");
    assert.ok(
      existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, "skills")),
      "Paper's embedded agent guidance was not preserved",
    );
  },
);

Then(
  "it should not require the deprecated Saleor CLI to create the storefront",
  function (this: JollyWorld) {
    // The creation just succeeded on a machine without the deprecated CLI;
    // the output must also not instruct installing it.
    assert.doesNotMatch(
      this.lastRun!.stdout,
      /@saleor\/cli|npm i(nstall)? -g saleor|saleor-cli/i,
      "storefront creation points at the deprecated Saleor CLI",
    );
  },
);

// --- Use Saleor Configurator directly for store configuration (@sandbox) -----

Given(
  "Jolly needs to inspect, plan, or apply Saleor store configuration",
  function (this: JollyWorld) {
    // Context only.
  },
);

When(
  "the agent has a Saleor Cloud GraphQL URL and app token",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    // Preview the starter-recipe deployment: the safe, non-mutating entry
    // into the configurator workflow.
    this.runCli(["create", "recipe", "--dry-run", "--json"], {
      timeoutMs: 240_000,
    });
  },
);

Then(
  /^Jolly CLI and\/or Jolly skills should use `saleor\/configurator` directly where appropriate$/,
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /configurator/i,
      "the recipe workflow does not go through saleor/configurator",
    );
  },
);

Then(
  "they should prefer configurator's safe workflow of validate, diff, plan, and deploy",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /validate|diff|plan/i,
      "the safe configurator workflow (validate/diff/plan before deploy) is not surfaced",
    );
  },
);

Then("they should parse structured output when available", function (this: JollyWorld) {
  // The run itself emitted the structured envelope the agent parses.
  assert.ok(this.lastRun!.envelope, "no structured output was produced");
});

Then(
  "they should require human approval before applying destructive or write operations",
  function (this: JollyWorld) {
    // Per features 010/021 the customer's agent decides approval; Jolly must
    // surface the structured risk context (with a dry run available) so that
    // decision can happen before any write.
    const contexts = findRiskContexts(this.envelope);
    assert.ok(
      contexts.length > 0,
      "no riskContext is exposed before the configurator write operation",
    );
    for (const rc of contexts) assertRiskContextShape(rc);
  },
);

// --- Install or reference universal Saleor agent skills (@logic) -------------

Given(
  "the customer's agent environment supports agent skills",
  function (this: JollyWorld) {
    guide(this);
  },
);

When("Jolly onboarding prepares the agent", function (this: JollyWorld) {
  // Context only: onboarding behavior is pinned in the committed guide.
});

Then(
  /^it should direct the agent to install relevant skills from `saleor\/agent-skills`$/,
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /agent-skills|saleor-storefront|jolly skills install/i,
      "the setup guide does not direct skill installation from saleor/agent-skills",
    );
  },
);

Then(
  "it should include Paper's embedded skill after the storefront is cloned",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /saleor-paper-storefront/,
      "the setup guide does not include Paper's embedded skill post-clone",
    );
  },
);

Then(
  "it should explain which skills are mandatory, recommended, or situational",
  function (this: JollyWorld) {
    assert.match(
      guide(this),
      /mandatory|recommended|situational/i,
      "the setup guide does not classify skills by necessity",
    );
  },
);

// --- Study the deprecated Saleor CLI without depending on it (@logic) --------

Given(
  "some Saleor Cloud registration and setup behavior is poorly documented elsewhere",
  function (this: JollyWorld) {
    // Context only.
  },
);

When("Jolly needs examples of legacy flows", function (this: JollyWorld) {
  // Context only.
});

Then(/^implementation agents may study `saleor\/cli`$/, function (this: JollyWorld) {
  // Research permission; nothing executable to assert.
});

Then("Jolly must not shell out to it", function (this: JollyWorld) {
  for (const source of productionSources()) {
    assert.doesNotMatch(
      source,
      /spawn[^\n]*["'`]saleor["'`]|exec[^\n]*["'`]saleor /,
      "Jolly production code shells out to the deprecated Saleor CLI",
    );
  }
});

Then(
  "Jolly must not require customers or agents to install it",
  function (this: JollyWorld) {
    const packageJson = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    assert.doesNotMatch(
      packageJson,
      /@saleor\/cli|"saleor-cli"|"saleor":/,
      "the deprecated Saleor CLI is a dependency",
    );
    assert.doesNotMatch(
      guide(this),
      /install (the )?(deprecated )?saleor[- ]cli|@saleor\/cli/i,
      "the setup guide instructs installing the deprecated Saleor CLI",
    );
  },
);

Then(
  "Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior",
  function (this: JollyWorld) {
    // Implementation-practice guidance; not separately executable.
  },
);
