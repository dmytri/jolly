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
  findCompletionCopy,
  findInlineProseLiterals,
  findRiskContextProse,
  findThrowSiteProse,
  joinCliMessageKeys,
  type CatalogJoin,
  type CompletionCopy,
  type InjectedSource,
  type ProseLiteral,
  type ThrowSiteProse,
} from "../support/copy-catalog-conformance.ts";
import { cliMessage } from "../../src/lib/messages.ts";
import { absentCredentialsEnv, STAND_IN_TOKEN } from "../support/creds-env.ts";

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

Then(
  "the clarifying question Jolly returns should match the catalog's entry",
  function (this: JollyWorld) {
    const normalized = this.notes.normalized as {
      endpoint: string | null;
      clarification?: string;
    };
    // The catalog entry is the comparison's one source of truth: read it here
    // when no earlier Given loaded it (the feature 012 rejected-URL outline has
    // no catalog Given), and reuse the loaded copy when one did.
    const expected =
      (this.notes.clarificationEntry as string | undefined) ??
      catalogMessage(CLARIFICATION_KEY);
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

// ─── A key is a contract, resolved or refused ─────────────────────────────
//
// The join between code and catalog is total in both directions. A site
// referencing a key the catalog lacks and a catalog entry no site references
// are both reported; each direction is proven by its own planted red.

/** A site referencing a key the catalog lacks, for the planted-red proof. */
const PLANTED_MISSING_KEY = "planted.key.the.catalog.lacks";
const PLANTED_MISSING_KEY_SITE: InjectedSource = {
  file: "src/planted-missing-key-reference.ts",
  text: [
    "declare function cliMessage(key: string): string;",
    `export const planted = cliMessage("${PLANTED_MISSING_KEY}");`,
  ].join("\n"),
};

/** A catalog entry no site references, for the planted-red proof. */
const PLANTED_UNREFERENCED_ENTRY = "planted.entry.no.site.references";

Given("Jolly's source tree and the message catalog", function (this: JollyWorld) {
  const catalog = JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<
    string,
    string
  >;
  assert.ok(
    Object.keys(catalog).length > 0,
    `the message catalog at ${CLI_MESSAGES_PATH} defines no entries`,
  );
});

When(
  "every `cliMessage` key referenced in {string} and {string} is joined against the catalog entries",
  function (this: JollyWorld, _sourceDir: string, _binDir: string) {
    this.notes.catalogJoin = joinCliMessageKeys();
  },
);

Then(
  "every referenced key should resolve to a catalog entry",
  function (this: JollyWorld) {
    const join = this.notes.catalogJoin as CatalogJoin;
    assert.equal(
      join.unresolved.length,
      0,
      `referenced keys the catalog lacks — each would ship the word "undefined" ` +
        `as prose. Give each its own entry in ${CLI_MESSAGES_PATH}:\n${join.unresolved
          .map((ref) => `  - ${ref.file}:${ref.line} "${ref.key}"`)
          .join("\n")}`,
    );
  },
);

Then(
  "every catalog entry should be referenced by at least one site",
  function (this: JollyWorld) {
    const join = this.notes.catalogJoin as CatalogJoin;
    assert.equal(
      join.unreferenced.length,
      0,
      `catalog entries no site references — dead copy that drifts unread. ` +
        `Reference each from the implementation or remove it from ` +
        `${CLI_MESSAGES_PATH}:\n${join.unreferenced
          .map((key) => `  - "${key}"`)
          .join("\n")}`,
    );
  },
);

Then(
  "planting a reference to a key the catalog lacks should redden the check",
  function () {
    const join = joinCliMessageKeys([PLANTED_MISSING_KEY_SITE]);
    assert.ok(
      join.unresolved.some(
        (ref) =>
          ref.file === PLANTED_MISSING_KEY_SITE.file &&
          ref.key === PLANTED_MISSING_KEY,
      ),
      `a reference to the missing key "${PLANTED_MISSING_KEY}" was not reported, ` +
        `so an unresolvable key would ship "undefined" as prose unnoticed`,
    );
  },
);

Then(
  "planting a catalog entry no site references should redden the check",
  function () {
    const join = joinCliMessageKeys([], {
      [PLANTED_UNREFERENCED_ENTRY]: "planted dead copy",
    });
    assert.ok(
      join.unreferenced.includes(PLANTED_UNREFERENCED_ENTRY),
      `the planted entry "${PLANTED_UNREFERENCED_ENTRY}" is referenced by no ` +
        `site and was not reported, so dead copy would drift unread`,
    );
  },
);

// ─── A missing key fails loudly instead of rendering prose ────────────────
//
// Exercises the real renderer seam: `cliMessage` from src/lib/messages.ts.

const RENDERED_NOTE = "missingKeyRendered";
const RENDER_FAILURE_NOTE = "missingKeyFailure";
// ─── Every thrown error's prose resolves to a catalog entry ─────────────────
// ─── The non-first-party host refusal reads its sentence from the catalog ───
// ─── The completion surface carries copy the shell shows the human ──────────
// ─── Risk-context prose reaches the agent and the human alike ───────────────

/** A risk context carrying its action as an inline clause. */
const PLANTED_RISK_ACTION: InjectedSource = {
  file: "src/.planted-risk-action.ts",
  text: `export const planted = {
  action: "Deploy the planted storefront to production",
  target: "planted",
  riskLevel: "medium",
  categories: [],
  reversible: false,
  sideEffects: [],
  dryRunAvailable: true,
};
`,
};

/** A risk context carrying an inline clause in its side-effect list. */
const PLANTED_RISK_SIDE_EFFECT: InjectedSource = {
  file: "src/.planted-risk-side-effect.ts",
  text: `export const planted = {
  action: "planted",
  target: "planted",
  riskLevel: "medium",
  categories: [],
  reversible: false,
  sideEffects: ["Writes the planted key and channel into the project .env"],
  dryRunAvailable: true,
};
`,
};
