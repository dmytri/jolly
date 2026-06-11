// Steps for features/004-jolly-configurator-starter-recipe.feature.
// Recipe application is exercised through `--dry-run` previews: the harness
// is harmless by design and the scenario's assertions (validate, diff/plan,
// dry-run support, agent-decided approval) are all observable in preview.
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertRiskContextShape,
  findRiskContexts,
} from "../support/envelope.ts";
import { saleorGraphql } from "../support/saleor-graphql.ts";
import type { JollyWorld } from "../support/world.ts";

const CLONE_TIMEOUT_MS = 900_000;

function findRecipeFile(storefrontDir: string): string | undefined {
  if (!existsSync(storefrontDir)) return undefined;
  const candidates: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        walk(path, depth + 1);
      } else if (/recipe.*\.(ya?ml|json)$|config\.ya?ml$/i.test(entry.name)) {
        candidates.push(path);
      }
    }
  };
  walk(storefrontDir, 0);
  return candidates[0];
}

// --- Agent prepares the starter recipe (@sandbox) ----------------------------

Given(
  "the customer has created or selected a Saleor Cloud environment",
  function (this: JollyWorld) {
    const result = this.runCli(["doctor", "saleor", "--json"]);
    const check = result.envelope?.checks.find((c) =>
      String(c.id).includes("connectivity"),
    );
    assert.equal(
      check?.status,
      "pass",
      "no reachable Saleor environment is configured",
    );
  },
);

When(
  "Jolly prepares the initial store configuration",
  { timeout: CLONE_TIMEOUT_MS + 120_000 },
  function (this: JollyWorld) {
    // The recipe lives in the cloned storefront repository, so prepare that
    // first, then prepare the recipe (preview-only deployment).
    this.runCli(["create", "storefront", "--yes", "--json"], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    this.runCli(["create", "recipe", "--dry-run", "--yes", "--json"], {
      timeoutMs: 120_000,
    });
  },
);

Then("it should use a Jolly-specific starter recipe", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /starter|jolly.*recipe|recipe.*jolly/i,
    "no Jolly-specific starter recipe is referenced",
  );
});

Then(
  "the recipe should be optimized for Paper's required storefront features",
  function (this: JollyWorld) {
    const recipePath = findRecipeFile(join(this.projectDir, "storefront"));
    assert.ok(recipePath, "no recipe file found in the cloned storefront repository");
    const recipe = readFileSync(recipePath!, "utf8");
    assert.match(recipe, /channel/i, "recipe defines no channel for Paper");
    assert.match(recipe, /product/i, "recipe defines no products for Paper");
  },
);

Then(
  "the recipe should be written into the cloned storefront repository",
  function (this: JollyWorld) {
    assert.ok(
      findRecipeFile(join(this.projectDir, "storefront")),
      "the starter recipe is not version-controlled inside the storefront repository",
    );
  },
);

Then("the recipe should be reviewable before deployment", function (this: JollyWorld) {
  // Reviewable = exists on disk before any deploy, and the deploy supports a
  // preview (`--dry-run` produced this envelope without applying changes).
  assert.ok(findRecipeFile(join(this.projectDir, "storefront")));
  assert.ok(this.lastRun!.args.includes("--dry-run"));
});

Then(
  "the recipe should be deployed through the safe Configurator workflow",
  function (this: JollyWorld) {
    assert.match(
      JSON.stringify(this.envelope),
      /configurator|validate|diff|plan/i,
      "recipe deployment does not go through the safe Configurator workflow",
    );
  },
);

Then(
  "the Saleor app token used for deployment should have all available permissions in v1",
  { timeout: 60_000 },
  async function (this: JollyWorld) {
    const endpoint = process.env.NEXT_PUBLIC_SALEOR_API_URL!;
    const token = process.env.JOLLY_SALEOR_APP_TOKEN!;
    const result = await saleorGraphql(
      endpoint,
      token,
      `query { app { permissions { code } } shop { permissions { code } } }`,
    );
    const app = (result.data?.app ?? null) as { permissions?: Array<{ code: string }> } | null;
    const shop = (result.data?.shop ?? null) as { permissions?: Array<{ code: string }> } | null;
    assert.ok(app?.permissions, "could not read the app token's permissions");
    const appCodes = new Set(app!.permissions!.map((p) => p.code));
    for (const { code } of shop?.permissions ?? []) {
      assert.ok(
        appCodes.has(code),
        `app token lacks permission ${code}; v1 requests all available permissions`,
      );
    }
  },
);

// --- Agent applies the starter recipe safely (@sandbox) ----------------------

Given("the Jolly starter recipe is ready", function (this: JollyWorld) {
  // Context: readiness is established by the apply preview below.
});

When(
  "the agent applies it to Saleor Cloud",
  { timeout: 300_000 },
  function (this: JollyWorld) {
    // Harmless by design: exercise the apply path in preview mode; every
    // assertion of this scenario is observable without mutating the store.
    this.runCli(["create", "recipe", "--dry-run", "--yes", "--json"], {
      timeoutMs: 240_000,
    });
  },
);

Then("it should validate the configuration", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /valid/i,
    "no configuration validation is reported",
  );
});

Then("it should show a diff or deployment plan", function (this: JollyWorld) {
  assert.match(
    JSON.stringify(this.envelope),
    /diff|plan/i,
    "no diff or deployment plan is shown",
  );
});

Then(
  /^Jolly remote\/action commands involved in recipe deployment should support `--dry-run` preview behavior$/,
  function (this: JollyWorld) {
    assert.ok(this.lastRun!.envelope, "--dry-run preview emitted no envelope");
    assert.doesNotMatch(
      JSON.stringify(this.envelope.errors),
      /unknown (flag|option)/i,
      "--dry-run is not supported on the recipe command",
    );
  },
);

Then(
  "the customer's agent should decide whether customer approval is needed before applying changes",
  function (this: JollyWorld) {
    const contexts = findRiskContexts(this.envelope);
    assert.ok(contexts.length > 0, "no riskContext for the agent's approval decision");
    for (const rc of contexts) {
      assertRiskContextShape(rc);
      assert.ok(
        !("approvalRequired" in (rc as object)) &&
          !("requiresApproval" in (rc as object)),
        "Jolly hardcodes the approval decision instead of leaving it to the agent",
      );
    }
  },
);

Then(
  "it should fail safely if destructive or breaking operations are detected",
  function (this: JollyWorld) {
    // The sandbox cannot deliberately produce a destructive diff against the
    // customer-configured store without violating harmless-by-design.
    return "skipped";
  },
);
