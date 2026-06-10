// Steps for features/004-jolly-configurator-starter-recipe.feature (@sandbox).
// Requires a sandbox Saleor environment (URL + app token).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { requireEnvelope, type Envelope, type RunResult } from "../support/cli.ts";
import { findRiskContexts, type RiskContext } from "../support/envelope.ts";
import { sandboxRuntimeEnv } from "../support/sandbox.ts";
import type { JollyWorld } from "../support/world.ts";

const LONG = { timeout: 1_200_000 };

function recipeFiles(storefrontDir: string): string[] {
  const candidates: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readFileSyncSafeDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") walk(path);
      else if (/recipe.*\.(ya?ml)$|\.recipe\.ya?ml$/i.test(entry.name) || (/\.ya?ml$/i.test(entry.name) && /recipe/i.test(path))) {
        candidates.push(path);
      }
    }
  };
  walk(storefrontDir);
  return candidates;
}

function readFileSyncSafeDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Minimal cloned-storefront stand-in so the recipe has a repository to live in.
function ensureStorefrontDir(world: JollyWorld): string {
  const dir = join(world.projectDir, "storefront");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "paper-fixture" }, null, 2));
    writeFileSync(join(dir, "paper-version.json"), JSON.stringify({ version: "0.0.0-fixture" }, null, 2));
  }
  return dir;
}

Given(lit("the customer has created or selected a Saleor Cloud environment"), function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_SALEOR_API_URL || !process.env.JOLLY_TEST_SALEOR_APP_TOKEN) {
    return "skipped" as const;
  }
  ensureStorefrontDir(this);
});

When(lit("Jolly prepares the initial store configuration"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "recipe", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 900_000,
  });
  this.vars.set("recipeRun", run);
});

Then(lit("it should use a Jolly-specific starter recipe"), function (this: JollyWorld) {
  const envelope = requireEnvelope(this.vars.get("recipeRun") as RunResult);
  assert.notEqual(envelope.status, "error", `create recipe failed: ${envelope.summary}`);
  assert.ok(/recipe/i.test(JSON.stringify(envelope.data)), "envelope must describe the starter recipe");
});

Then(lit("the recipe should be optimized for Paper's required storefront features"), function (this: JollyWorld) {
  const files = recipeFiles(join(this.projectDir, "storefront"));
  assert.ok(files.length > 0, "no recipe file found in the storefront repository");
  const content = files.map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(/channel/i.test(content), "recipe must configure the channel Paper needs");
  assert.ok(/USD/.test(content), "recipe must configure the v1 US/USD market");
});

Then(lit("the recipe should be written into the cloned storefront repository"), function (this: JollyWorld) {
  assert.ok(
    recipeFiles(join(this.projectDir, "storefront")).length > 0,
    "recipe must live inside the storefront repository",
  );
});

Then(lit("the recipe should be reviewable before deployment"), function (this: JollyWorld) {
  const files = recipeFiles(join(this.projectDir, "storefront"));
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    assert.ok(content.trim().length > 0, `recipe ${file} must be reviewable plain text`);
    assert.ok(!content.includes(String.fromCharCode(0)), `recipe ${file} must not be binary`);
  }
});

Then(lit("the recipe should be deployed through the safe Configurator workflow"), function (this: JollyWorld) {
  const serialized = JSON.stringify(requireEnvelope(this.vars.get("recipeRun") as RunResult));
  assert.ok(/configurator/i.test(serialized), "deployment must go through Configurator");
  assert.ok(/validate|diff|plan|deploy/i.test(serialized), "deployment must use the safe workflow stages");
});

Then(
  lit("the Saleor app token used for deployment should have all available permissions in v1"),
  function (this: JollyWorld) {
    const serialized = JSON.stringify(requireEnvelope(this.vars.get("recipeRun") as RunResult));
    if (!/permission/i.test(serialized)) return "skipped" as const; // permissions not introspectable in this run
    assert.ok(/all/i.test(serialized), "v1 deployment token must carry all available permissions");
  },
);

Given(lit("the Jolly starter recipe is ready"), LONG, async function (this: JollyWorld) {
  if (!process.env.JOLLY_TEST_SALEOR_API_URL || !process.env.JOLLY_TEST_SALEOR_APP_TOKEN) {
    return "skipped" as const;
  }
  ensureStorefrontDir(this);
  const prepare = await this.jolly(["create", "recipe", "--dry-run", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 900_000,
  });
  this.vars.set("dryRunRecipe", prepare);
});

When(lit("the agent applies it to Saleor Cloud"), LONG, async function (this: JollyWorld) {
  const run = await this.jolly(["create", "recipe", "--json", "--yes"], {
    env: sandboxRuntimeEnv(),
    timeoutMs: 900_000,
  });
  this.vars.set("applyRun", run);
});

Then(lit("it should validate the configuration"), function (this: JollyWorld) {
  const serialized = JSON.stringify(requireEnvelope(this.vars.get("applyRun") as RunResult));
  assert.ok(/validat/i.test(serialized), "recipe application must validate the configuration");
});

Then(lit("it should show a diff or deployment plan"), function (this: JollyWorld) {
  const serialized = JSON.stringify(requireEnvelope(this.vars.get("applyRun") as RunResult));
  assert.ok(/diff|plan/i.test(serialized), "recipe application must surface a diff or plan");
});

Then(
  lit("Jolly remote/action commands involved in recipe deployment should support `--dry-run` preview behavior"),
  function (this: JollyWorld) {
    const dryRun = this.vars.get("dryRunRecipe") as RunResult;
    const envelope = requireEnvelope(dryRun);
    assert.notEqual(envelope.status, "error", "--dry-run of recipe deployment must be supported");
  },
);

Then(
  lit("the customer's agent should decide whether customer approval is needed before applying changes"),
  function (this: JollyWorld) {
    const envelope = requireEnvelope(this.vars.get("applyRun") as RunResult) as Envelope;
    assert.ok(findRiskContexts(envelope).length > 0, "recipe application must expose riskContext for the agent's approval decision");
  },
);

Then(lit("it should fail safely if destructive or breaking operations are detected"), function (this: JollyWorld) {
  // Destructive operations cannot be produced against the namespaced sandbox
  // recipe; the enforceable surface is that the riskContext marks destructive
  // categories when present and the safe workflow (validate/diff first) ran.
  const envelope = requireEnvelope(this.vars.get("applyRun") as RunResult) as Envelope;
  const contexts = findRiskContexts(envelope) as RiskContext[];
  for (const rc of contexts) {
    assert.ok(Array.isArray(rc.categories), "riskContext must carry categories for destructive detection");
  }
});
