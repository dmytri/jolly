// Step definitions for step text shared verbatim by more than one feature.
// Cucumber's step registry is global, so each shared text is defined exactly
// once, here. Feature-unique steps live in <feature-slug>.steps.ts.
import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import { findCopyBox, COPY_BOX_PHRASE } from "../support/homepage.ts";
import { homepage } from "../support/content.ts";
import type { JollyWorld } from "../support/world.ts";

// --- Declarative premises (features 005, 008, 017, 020 backgrounds) ---------

Given(lit("Jolly is executable via `npx`"), function () {
  // Premise: local runs exercise src/index.ts directly (see support/cli.ts).
});

Given(lit("Jolly uses Saleor Paper as the storefront baseline"), function () {
  // Premise (AGENTS.md V1 scope).
});

// --- Shared branch context (features 002, 012) -------------------------------

Given(lit("the customer says they already have a Saleor store"), function (this: JollyWorld) {
  this.vars.set("storeBranch", "existing");
});

// --- Shared homepage assertion (features 001, 016) ---------------------------

Then(
  lit('the copy box should say "copy this to your agent to get started"'),
  function () {
    const box = findCopyBox(homepage().document);
    assert.ok(
      (box.textContent ?? "").toLowerCase().includes(COPY_BOX_PHRASE),
      "copy box must carry the literal call-to-action phrase",
    );
  },
);

// --- Shared login capability assertion (features 002, 018) -------------------

Then(
  lit("Jolly should support a headless token flow when browser OAuth is unavailable or undesirable"),
  async function (this: JollyWorld) {
    // The capability contract is asserted on the documented surface: the login
    // help must describe a headless/token alternative to browser OAuth.
    const run = await this.jolly(["login", "--help"]);
    assert.ok(
      /headless|token/i.test(run.stdout),
      `\`jolly login --help\` must document a headless token flow.\nstdout: ${run.stdout.slice(0, 1000)}\nstderr: ${run.stderr.slice(0, 500)}`,
    );
  },
);
