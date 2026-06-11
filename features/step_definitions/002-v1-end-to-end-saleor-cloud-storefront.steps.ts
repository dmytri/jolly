// Step definitions for feature 002: V1 end-to-end Saleor Cloud storefront setup.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvValues } from "../../src/lib/env-file.ts";
import type { JollyWorld } from "../support/world.ts";

// ── Background ───────────────────────────────────────────────────────────

Given("Vercel is the first deployment target", function (this: JollyWorld) {
  // Contract.
});

// `Saleor's official...Paper template is the first storefront baseline` handled by regex below

Given(
  "Jolly should create the storefront by cloning or otherwise directly using `saleor/storefront` from the `main` branch by default",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  "`saleor/configurator` should be used directly by Jolly CLI and\\/or skills where appropriate",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  "the Saleor MCP server at mcp.saleor.app provides read-only access to live store data such as products, orders, and customers after setup is complete",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  "the setup path must minimize human intervention to new account creation, browser OAuth consent, and providing secret values",
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  /^Saleor's official `saleor\/storefront` Paper template is the first storefront baseline$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  /^Jolly should create the storefront by cloning or otherwise directly using `saleor\/storefront` from the `main` branch by default$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Given(
  /^`saleor\/configurator` should be used directly by Jolly CLI and\/or skills where appropriate$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Agent starts setup journey ───────────────────────────────────────────

Given(
  "the customer has copied the Jolly onboarding prompt into their agent",
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  "the agent begins the V1 setup journey",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should ask whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    // Contract - verified by 001 scenarios.
  },
);

Then(
  "it should identify which steps require human action outside the agent",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Create a deployable storefront from Paper ────────────────────────────

Given(
  "Saleor connectivity has been verified",
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  "the agent prepares the storefront project",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should propose `storefront` as the default storefront target directory",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should proceed with the default directory automatically",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should only pause if the default directory already exists and ask how to resolve the collision",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^it should clone or directly use Saleor's official `saleor\/storefront` Paper template as the baseline$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should remove the cloned upstream `.git` history",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should initialize a fresh Git repository when needed for the customer's storefront workflow",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should validate the local Node.js version against Paper's current requirements",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should provide actionable guidance when the local Node.js version is incompatible",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should not install or switch Node.js versions automatically because runtime management is the customer's agent's domain",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should use Paper's expected package manager, `pnpm`, for the cloned storefront",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should install Paper storefront dependencies automatically by default",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should run lightweight validation by default",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should provide `--full-validation` on relevant commands including `jolly create storefront`, `jolly start`, and `jolly doctor storefront` for full Paper validation such as generate, typecheck, build, or tests where feasible",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should provide actionable guidance if `pnpm` is missing",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should optionally install `pnpm` where possible when the agent\\/customer allows it",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should preserve Paper's intended architecture and default presentation rather than rewriting or re-theming it unnecessarily",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── Deploy to Vercel ─────────────────────────────────────────────────────

Given(
  "the storefront is ready for deployment",
  function (this: JollyWorld) {
    // Contract.
  },
);

When(
  "the agent guides Vercel deployment",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should ask whether the customer already has a Vercel account",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should branch between existing Vercel account setup and new Vercel account registration guidance",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should identify required Vercel account\\/project steps",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should ask whether the customer wants Git repository setup when Git-based deployment is useful",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "GitHub should be the default Git provider",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "other Git providers are deferred to v2",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should support GitHub repository creation\\/configuration where needed for Vercel",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should use Vercel CLI\\/API automation where possible",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should fall back to guided Vercel Git import flow when automation is unavailable or inappropriate",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should configure required environment variables in Vercel",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should verify that the deployed storefront can reach Saleor Cloud",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should automatically update Saleor allowed\\/trusted origins for the deployed storefront URL where APIs allow",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "it should report the deployed URL and any remaining manual steps",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── @sandbox: Register new store ─────────────────────────────────────────

Given("the customer says they want to register a Saleor store", function (this: JollyWorld) {
  // Contract - @sandbox.
});

When("the agent proceeds with the registration branch", function (this: JollyWorld) {
  // Contract.
});

Then("Jolly should use Saleor Cloud APIs programmatically where possible", function (this: JollyWorld) {
  // Contract.
});

Then(
  "Jolly should support browser OAuth authentication when the environment can open a browser and receive the callback",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should support a headless token flow when browser OAuth is unavailable or undesirable",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("Jolly should reuse an existing Saleor Cloud organization when available", function (this: JollyWorld) {
  // Contract.
});

Then(
  "Jolly should create a Saleor Cloud project and environment as needed for the new store",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^Jolly should use `saleor\/configurator` recipes as the default mechanism for initial store configuration$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should provide or select a Jolly-specific starter recipe optimized for making the Paper storefront immediately operational",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "the agent should clearly pause for any browser, email, payment, or account-verification step that cannot be completed programmatically",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^for new Saleor Cloud account creation, Jolly should direct the customer to saleor\.io\/cloud for the browser signup flow$/, // regex
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("Jolly should resume automatically once the customer provides the new store URL", function (this: JollyWorld) {
  // Contract.
});

Then(
  "Jolly should not attempt to automate the browser account signup itself",
  function (this: JollyWorld) {
    // Contract.
  },
);

// ── @sandbox: Connect existing store ─────────────────────────────────────

When("the agent needs to connect the storefront to Saleor", function (this: JollyWorld) {
  // Contract.
});

Then(
  /^Jolly should accept a Saleor URL from the customer and normalize it to the GraphQL endpoint where possible$/, // regex with /
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should validate the GraphQL endpoint using an introspection-style request before proceeding",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  /^when Saleor Cloud authentication is available, Jolly should infer the organization and environment by matching the instance host against Saleor Cloud environments$/, // regex with /
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should ask only for missing details it cannot infer automatically",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should require an app token or equivalent credential for full existing-store setup",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should acquire or create the app token automatically where Saleor APIs allow",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then(
  "Jolly should guide the customer to obtain required credentials from Saleor Dashboard only when automation is not available",
  function (this: JollyWorld) {
    // Contract.
  },
);

Then("it should verify connectivity before proceeding to storefront setup", function (this: JollyWorld) {
  // Contract.
});
