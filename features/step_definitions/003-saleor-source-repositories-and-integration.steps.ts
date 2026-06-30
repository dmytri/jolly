// Feature 003 — Saleor source repositories and integration boundaries.
//
// This feature describes which upstream repos Jolly leans on (saleor/storefront
// "Paper", @saleor/configurator, saleor/agent-skills) and which it must NOT
// depend on (the deprecated saleor/cli). Cloning Paper, running the configurator,
// and studying legacy flows are the AGENT's actions, not Jolly's code — so the
// observable boundary is the orchestrated plan Jolly previews with
// `jolly start --dry-run --json`. Each scenario shares the Given
// ("a fresh empty project directory") and When ("the agent runs
// `jolly start --dry-run --json`") defined in feature 001's step file, which
// leaves the previewed plan in `this.envelope.data.plan`; the Then steps below
// assert the plan's stages name the current upstream sources and never the
// deprecated `saleor` CLI binary.
import { Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { JollyWorld } from "../support/world.ts";

type PlanStage = {
  stage?: string;
  effects?: Record<string, unknown>;
  riskContext?: Record<string, unknown>;
};

function plan(world: JollyWorld): PlanStage[] {
  const p = world.envelope.data.plan as PlanStage[];
  assert.ok(Array.isArray(p) && p.length > 0, "data.plan must be a non-empty array");
  return p;
}

// --- Scenario: Use Saleor Paper as the storefront baseline (@sandbox) --------

Then(
  "the plan's storefront stage should name `saleor\\/storefront` as the baseline to clone",
  function (this: JollyWorld) {
    // Carried from "it should clone or directly use `saleor/storefront`":
    // the storefront baseline is saleor/storefront. The plan's storefront stage
    // clones it (effects.repositoriesCloned) and names it as the baseline.
    const storefront = plan(this).find((s) => s.stage === "storefront");
    assert.ok(storefront, "the plan must include a storefront stage");
    const blob = JSON.stringify(storefront).toLowerCase();
    assert.ok(
      blob.includes("saleor/storefront"),
      "the storefront stage must name `saleor/storefront` as the baseline to clone",
    );
  },
);

// BLOCKER — step "the plan should preserve Paper's embedded `AGENTS.md` and
// `skills/saleor-paper-storefront/SKILL.md`" is intentionally left UNDEFINED.
// The corresponding old step ("it should install and preserve Paper's agent
// guidance where applicable") was a narrative no-op carrying no assertion, and
// the previewed plan's storefront stage does not surface that it preserves
// Paper's embedded AGENTS.md or skills/saleor-paper-storefront/SKILL.md. With no
// existing assertion to carry and nothing in the plan to pin, fabricating one
// would add product behavior — out of bounds for this string re-sync.

Then(
  "the plan should not name the deprecated `saleor` CLI as required to create the storefront",
  function (this: JollyWorld) {
    // Carried from "it should not require the deprecated Saleor CLI to create
    // the storefront": Jolly's storefront stage spawns `git`/`pnpm`, never the
    // deprecated saleor/cli.
    const storefront = plan(this).find((s) => s.stage === "storefront");
    assert.ok(storefront, "the plan must include a storefront stage");
    const blob = JSON.stringify(storefront).toLowerCase();
    assert.ok(
      !blob.includes("saleor/cli") && !blob.includes("@saleor/cli"),
      "the storefront stage must not name the deprecated `saleor` CLI",
    );
  },
);

// --- Scenario: Use Saleor Configurator through the official CLI (@logic) -----

Then(
  "the plan's recipe stage should name the spawned command `npx @saleor\\/configurator@latest deploy`",
  function (this: JollyWorld) {
    // The recipe stage's spawned command is the official configurator at its
    // latest published release: Jolly tags every npx-resolved official CLI spawn
    // `@latest` so a stale npx cache never pins an older release (feature 003 Rule
    // "Jolly integration principles").
    const recipe = plan(this).find((s) => s.stage === "recipe");
    assert.ok(recipe, "the plan must include a recipe stage");
    const blob = JSON.stringify(recipe);
    assert.ok(
      blob.includes("npx @saleor/configurator@latest deploy"),
      "the recipe stage must name the spawned command `npx @saleor/configurator@latest deploy`",
    );
  },
);

// --- Scenario: Jolly never depends on the deprecated Saleor CLI (@logic) -----

Then(
  "no planned stage should spawn the `saleor` CLI binary",
  function (this: JollyWorld) {
    // Carried from "Jolly must not shell out to it": no stage in the previewed
    // plan invokes the deprecated saleor/cli binary.
    const blob = JSON.stringify(plan(this)).toLowerCase();
    assert.ok(
      !blob.includes("saleor/cli") && !blob.includes("@saleor/cli"),
      "no planned stage may spawn the deprecated `saleor` CLI binary",
    );
  },
);

Then(
  "no planned stage should require the `saleor` CLI to be installed",
  function (this: JollyWorld) {
    // Carried from "Jolly must not require customers or agents to install it":
    // no stage references installing the deprecated @saleor/cli package.
    const blob = JSON.stringify(plan(this)).toLowerCase();
    assert.ok(
      !blob.includes("@saleor/cli"),
      "no planned stage may require the deprecated `saleor` CLI to be installed",
    );
  },
);
