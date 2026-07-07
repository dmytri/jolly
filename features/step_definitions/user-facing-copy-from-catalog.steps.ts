// User-facing copy is owned in the message catalog, not scattered as string
// literals in `src/`. The pasted-URL clarifying question is the concrete anchor:
// when a user pastes something that is not a usable Saleor URL, the clarifying
// question Jolly returns is the catalog's `saleorUrl.clarification` entry.
//
// These steps exercise the real seam that produces the clarifying question,
// `normalizeSaleorUrl` in `src/lib/saleor-url.ts`, and compare its returned
// clarification against the live catalog entry read from
// `assets/messages/cli.json`. The comparison reads the catalog at run time, so
// the property reddens if the catalog copy and the returned copy ever diverge.

import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/world.ts";
import type { JollyWorld } from "../support/world.ts";
import { normalizeSaleorUrl } from "../../src/lib/saleor-url.ts";

const CLI_MESSAGES_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");
const CLARIFICATION_KEY = "saleorUrl.clarification";

function catalogMessage(key: string): string {
  const catalog = JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<
    string,
    string
  >;
  const message = catalog[key];
  assert.ok(
    typeof message === "string" && message.length > 0,
    `the message catalog must define a non-empty "${key}"`,
  );
  return message;
}

Given(
  "the message catalog defines the clarifying question for an unusable Saleor URL",
  function (this: JollyWorld) {
    this.notes.clarificationEntry = catalogMessage(CLARIFICATION_KEY);
  },
);

When(
  "the agent pastes {string} as the store URL",
  function (this: JollyWorld, pasted: string) {
    this.notes.normalized = normalizeSaleorUrl(pasted);
  },
);

Then(
  "the clarifying question Jolly returns should match the catalog's entry",
  function (this: JollyWorld) {
    const normalized = this.notes.normalized as {
      endpoint: string | null;
      clarification?: string;
    };
    const expected = this.notes.clarificationEntry as string;
    assert.equal(
      normalized.endpoint,
      null,
      `an unusable Saleor URL must not normalize to an endpoint; got: ${normalized.endpoint}`,
    );
    assert.equal(
      normalized.clarification,
      expected,
      `the clarifying question Jolly returns must be the "${CLARIFICATION_KEY}" ` +
        `catalog entry ("${expected}"); got: ${normalized.clarification}`,
    );
  },
);
