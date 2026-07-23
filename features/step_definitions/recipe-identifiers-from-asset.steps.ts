// Recipe identifiers come from the shipped recipe asset, not built-in constants.
//
// The cloud-api module derives the warehouse slug, the product slugs, and the
// collection memberships from a recipe.yml asset at runtime, so the values it
// uses to assign collection membership and seed stock can never drift from the
// deployed recipe. These steps exercise the real derivation seam
// (`deriveRecipeIdentifiers`) against both a purpose-built fixture asset and the
// shipped `assets/skills/jolly/recipe.yml`.

import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";
import { deriveRecipeIdentifiers } from "../../src/lib/cloud-api.ts";

Given(
  "a recipe asset that declares the warehouse slug {string}, the product slugs {string} and {string}, and a collection {string} containing {string}",
  function (
    this: JollyWorld,
    warehouseSlug: string,
    firstProduct: string,
    secondProduct: string,
    collectionSlug: string,
    member: string,
  ) {
    const recipe = [
      "warehouses:",
      `  - name: ${warehouseSlug} Warehouse`,
      `    slug: ${warehouseSlug}`,
      "products:",
      `  - name: ${firstProduct}`,
      `    slug: ${firstProduct}`,
      `  - name: ${secondProduct}`,
      `    slug: ${secondProduct}`,
      "collections:",
      `  - name: ${collectionSlug}`,
      `    slug: ${collectionSlug}`,
      "    products:",
      `      - ${member}`,
      "",
    ].join("\n");
    const path = join(this.newTempDir("recipe"), "recipe.yml");
    writeFileSync(path, recipe, "utf8");
    this.notes.recipeAssetPath = path;
  },
);
When(
  /^the cloud-api module derives the recipe identifiers from (?:that asset|it)$/,
  function (this: JollyWorld) {
    this.notes.recipeIdentifiers = deriveRecipeIdentifiers(
      this.notes.recipeAssetPath as string,
    );
  },
);

function identifiers(world: JollyWorld): {
  warehouseSlug: string;
  productSlugs: string[];
  collections: Array<{ slug: string; products: string[] }>;
} {
  return world.notes.recipeIdentifiers as {
    warehouseSlug: string;
    productSlugs: string[];
    collections: Array<{ slug: string; products: string[] }>;
  };
}

Then(
  "the warehouse slug it uses should be {string}",
  function (this: JollyWorld, expected: string) {
    assert.equal(identifiers(this).warehouseSlug, expected);
  },
);

Then(
  "the product slugs it uses should be {string} and {string}",
  function (this: JollyWorld, first: string, second: string) {
    assert.deepEqual(
      [...identifiers(this).productSlugs].sort(),
      [first, second].sort(),
    );
  },
);
Then(
  "the {string} collection it assigns should contain {string}",
  function (this: JollyWorld, collectionSlug: string, member: string) {
    const collection = identifiers(this).collections.find(
      (c) => c.slug === collectionSlug,
    );
    assert.ok(
      collection,
      `derived identifiers should carry a "${collectionSlug}" collection`,
    );
    assert.ok(
      collection.products.includes(member),
      `the "${collectionSlug}" collection should contain "${member}"; got ${JSON.stringify(collection.products)}`,
    );
  },
);
