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
import {
  findInlineProseLiterals,
  type InjectedSource,
  type ProseLiteral,
} from "../support/copy-catalog-conformance.ts";

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

// ─── The envelope prose surface ───────────────────────────────────────────
//
// The check keys on each field's resolved TYPE, so the plants below are shaped
// like the real thing rather than named like it. Each is a virtual source the
// checker injects and removes; neither is ever written to disk.

/**
 * An envelope carrying its summary as an inline literal. The checker resolves
 * this shape structurally, so the plant needs no import to be an Envelope.
 */
const PLANTED_ENVELOPE_PROSE: InjectedSource = {
  file: "src/planted-envelope-prose.ts",
  text: `export const planted = {
  tool: "jolly",
  command: "planted",
  status: "error",
  summary: "This planted summary is inline copy the catalog should own.",
  data: {},
  checks: [],
  nextSteps: [],
  errors: [],
};
`,
};

/**
 * A word selected by a condition, handed to `cliMessage` as a placeholder
 * value. The copy never appears at the call itself, so this reddens only
 * because the checker follows the variable to its initializer.
 */
const PLANTED_CLI_MESSAGE_PROSE: InjectedSource = {
  file: "src/planted-climessage-prose.ts",
  text: `declare function cliMessage(key: string, vars?: Record<string, string>): string;
declare const many: boolean;
const stageWord = many ? "planted stages" : "planted stage";
export const planted = cliMessage("planted.key", { stageWord });
`,
};

function plantedIn(file: string): ProseLiteral[] {
  return findInlineProseLiterals([
    file === PLANTED_ENVELOPE_PROSE.file
      ? PLANTED_ENVELOPE_PROSE
      : PLANTED_CLI_MESSAGE_PROSE,
  ]).filter((literal) => literal.file === file);
}

function reportLiterals(literals: ProseLiteral[]): string {
  return literals
    .map(
      (literal) =>
        `  - ${literal.file}:${literal.line} ${literal.field}: ${JSON.stringify(literal.text)}`,
    )
    .join("\n");
}

When(
  "its envelope prose fields are checked against the message catalog",
  function (this: JollyWorld) {
    this.notes.inlineProse = findInlineProseLiterals();
  },
);

Then("no inline user-facing literal is found", function (this: JollyWorld) {
  const literals = this.notes.inlineProse as ProseLiteral[];
  assert.equal(
    literals.length,
    0,
    `user-facing copy is owned in the message catalog (${CLI_MESSAGES_PATH}), but ` +
      `${literals.length} inline prose literal(s) reach a user through the envelope ` +
      `prose surface. Give each its own catalog key and render it with cliMessage:\n` +
      `${reportLiterals(literals)}`,
  );
});

Then(
  "planting a prose literal at an envelope prose field should redden the check",
  function () {
    const planted = plantedIn(PLANTED_ENVELOPE_PROSE.file);
    assert.ok(
      planted.length > 0,
      `a summary carrying inline copy must be reported, or the check would pass ` +
        `while inline copy still ships. Nothing was reported for ${PLANTED_ENVELOPE_PROSE.file}.`,
    );
    assert.ok(
      planted.some((literal) => literal.field === "Envelope.summary"),
      `the planted literal must be reported at Envelope.summary; got: ` +
        `${planted.map((literal) => literal.field).join(", ")}`,
    );
  },
);

Then(
  "planting a prose literal in a `cliMessage` variable should redden the check",
  function () {
    const planted = plantedIn(PLANTED_CLI_MESSAGE_PROSE.file);
    assert.ok(
      planted.length > 0,
      `copy handed to cliMessage as a variable is still copy, so it must be ` +
        `reported; without that the rule passes while inline copy ships through ` +
        `the placeholder. Nothing was reported for ${PLANTED_CLI_MESSAGE_PROSE.file}.`,
    );
    assert.ok(
      planted.some((literal) => literal.text.includes("planted stage")),
      `the planted word selected by a condition must be reported; got: ` +
        `${planted.map((literal) => JSON.stringify(literal.text)).join(", ")}`,
    );
  },
);
