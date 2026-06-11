// Steps for features/003-saleor-source-repositories-and-integration.feature.
// Scenarios 1-2 (@sandbox) exercise real cloning/Configurator use; scenarios
// 3-4 (@logic) assert onboarding content and enforcement-level dependency
// boundaries against the implementation source.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { repoRoot, requireEnvelope, type Envelope } from "../support/cli.ts";
import { findRiskContexts } from "../support/envelope.ts";
import { guideText, assertGuideMentions } from "../support/content.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

const LONG = { timeout: 1_800_000 };

function sourceFiles(dir = join(repoRoot, "src")): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|js|mts|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// --- Scenario: Use Saleor Paper as the storefront baseline (@sandbox) --------

Given(lit("Jolly needs to create a storefront project"), function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL) return "skipped" as const;
});

When(lit("the customer's agent reaches the storefront creation step"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "storefront", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 1_500_000,
  });
  this.vars.set("storefrontRun", run);
  this.vars.set("storefrontDir", join(this.projectDir, "storefront"));
});

Then(lit("it should clone or directly use `saleor/storefront`"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  assert.ok(existsSync(join(dir, "package.json")), "no storefront was created from saleor/storefront");
});

Then(lit("it should treat Paper as the first storefront baseline"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  const isPaper =
    existsSync(join(dir, "paper-version.json")) ||
    /paper/i.test(readFileSync(join(dir, "package.json"), "utf8"));
  assert.ok(isPaper, "created storefront is not the Paper baseline");
});

Then(
  lit("it should preserve Paper's architecture unless the customer explicitly asks for customization"),
  function (this: JollyWorld) {
    const dir = this.vars.get("storefrontDir") as string;
    assert.ok(
      readdirSync(dir).some((entry) => entry === "src" || entry === "app"),
      "Paper's source architecture is missing",
    );
  },
);

Then(lit("it should install and preserve Paper's agent guidance where applicable"), function (this: JollyWorld) {
  const dir = this.vars.get("storefrontDir") as string;
  const guidance =
    existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, "skills", "saleor-paper-storefront"));
  assert.ok(guidance, "Paper's embedded agent guidance was not preserved");
});

Then(lit("it should not require the deprecated Saleor CLI to create the storefront"), function (this: JollyWorld) {
  // The controlled test environment has no `saleor` binary; success without it
  // proves there is no dependency.
  const envelope = requireEnvelope(this.vars.get("storefrontRun") as never);
  assert.equal(envelope.status, "success", "storefront creation must work without the deprecated Saleor CLI");
});

// --- Scenario: Use Saleor Configurator directly (@sandbox) -------------------

Given(lit("Jolly needs to inspect, plan, or apply Saleor store configuration"), function (this: JollyWorld) {
  if (!process.env.JOLLY_SALEOR_URL || !process.env.JOLLY_SALEOR_APP_TOKEN) {
    return "skipped" as const;
  }
});

When(lit("the agent has a Saleor Cloud GraphQL URL and app token"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "recipe", "--dry-run", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 900_000,
  });
  this.vars.set("recipeRun", run);
});

Then(
  lit("Jolly CLI and/or Jolly skills should use `saleor/configurator` directly where appropriate"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("recipeRun") as never);
    assert.ok(/configurator/i.test(JSON.stringify(envelope)), "recipe flow must go through saleor/configurator");
  },
);

Then(
  lit("they should prefer configurator's safe workflow of validate, diff, plan, and deploy"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(requireEnvelope(this.vars.get("recipeRun") as never));
    assert.ok(/validate|diff|plan/i.test(serialized), "recipe preview must surface the safe validate/diff/plan workflow");
  },
);

Then(lit("they should parse structured output when available"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("recipeRun") as never);
  assert.ok(
    envelope.data && typeof envelope.data === "object" && Object.keys(envelope.data).length > 0,
    "configurator results must be carried as structured data, not prose",
  );
});

Then(
  lit("they should require human approval before applying destructive or write operations"),
  function (this: JollyWorld) {
    // Jolly-side contract: write operations expose riskContext so the agent
    // can route approval (feature 010/021); the preview itself made no writes.
    const envelope = requireEnvelope(this.vars.get("recipeRun") as never) as Envelope;
    assert.ok(findRiskContexts(envelope).length > 0, "write operations must expose riskContext for approval routing");
  },
);

// --- Scenario: Install or reference universal Saleor agent skills (@logic) ---

Given(lit("the customer's agent environment supports agent skills"), function () {
  // Premise.
});

When(lit("Jolly onboarding prepares the agent"), function () {
  assert.ok(guideText().trim().length > 0, "setup guide must exist");
});

Then(lit("it should direct the agent to install relevant skills from `saleor/agent-skills`"), function () {
  assertGuideMentions(/agent-skills|jolly skills install/i, "must direct skill installation from saleor/agent-skills");
});

Then(lit("it should include Paper's embedded skill after the storefront is cloned"), function () {
  assertGuideMentions(/saleor-paper-storefront|paper.*skill/i, "must include Paper's embedded skill post-clone");
});

Then(lit("it should explain which skills are mandatory, recommended, or situational"), function () {
  for (const tier of ["mandatory", "recommended", "situational"]) {
    assertGuideMentions(new RegExp(tier, "i"), `must classify skills as ${tier} where applicable`);
  }
});

// --- Scenario: Study the deprecated Saleor CLI without depending on it (@logic)

Given(lit("some Saleor Cloud registration and setup behavior is poorly documented elsewhere"), function () {
  // Premise.
});

When(lit("Jolly needs examples of legacy flows"), function () {
  // Premise.
});

Then(lit("implementation agents may study `saleor/cli`"), function () {
  // Permission, not an obligation — nothing to assert.
});

Then(lit("Jolly must not shell out to it"), function () {
  const sources = sourceFiles();
  assert.ok(sources.length > 0, "src/ not implemented yet — boundary cannot be verified");
  const offenders = sources.filter((path) =>
    /(spawn|spawnSync|exec|execSync|execFile|execFileSync)[^\n]*["'`]saleor["'`]/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(offenders, [], `implementation shells out to the deprecated saleor binary: ${offenders.join(", ")}`);
});

Then(lit("Jolly must not require customers or agents to install it"), function () {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const banned of ["@saleor/cli", "saleor-cli", "saleor"]) {
    assert.ok(!(banned in deps), `package.json must not depend on deprecated ${banned}`);
  }
  assert.ok(
    !/npm i(nstall)?( -g)? (@saleor\/cli|saleor-cli)|install the saleor cli/i.test(guideText()),
    "the setup guide must not instruct installing the deprecated Saleor CLI",
  );
});

Then(
  lit("Jolly should avoid copying deprecated UX or removed commands without validating them against current Saleor Cloud behavior"),
  function () {
    // Concrete deprecated default the integration principles call out: the
    // old CLI cloned the storefront from `canary`; Jolly must default to main.
    const sources = sourceFiles();
    assert.ok(sources.length > 0, "src/ not implemented yet — boundary cannot be verified");
    const offenders = sources.filter((path) => /["'`]canary["'`]/.test(readFileSync(path, "utf8")));
    assert.deepEqual(offenders, [], `deprecated canary default found in: ${offenders.join(", ")}`);
  },
);
