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
  findThrowSiteProse,
  joinCliMessageKeys,
  type CatalogJoin,
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

Given(
  "the message catalog has no entry for the key {string}",
  function (this: JollyWorld, key: string) {
    const catalog = JSON.parse(readFileSync(CLI_MESSAGES_PATH, "utf8")) as Record<
      string,
      string
    >;
    assert.ok(
      !(key in catalog),
      `the catalog at ${CLI_MESSAGES_PATH} defines "${key}", so this scenario ` +
        `cannot exercise the missing-key path with it`,
    );
    this.notes.missingKey = key;
  },
);

When(
  /^the CLI renders the `([\w.]+)` message$/,
  function (this: JollyWorld, key: string) {
    try {
      this.notes[RENDERED_NOTE] = cliMessage(key);
    } catch (error) {
      this.notes[RENDER_FAILURE_NOTE] = error;
    }
  },
);

Then(
  "the render should fail, naming {string} as the missing key",
  function (this: JollyWorld, key: string) {
    const failure = this.notes[RENDER_FAILURE_NOTE];
    assert.ok(
      failure instanceof Error,
      `rendering the missing key "${key}" did not fail; it rendered ` +
        `${JSON.stringify(String(this.notes[RENDERED_NOTE]))} — a silent fallback ` +
        `puts "undefined" on a human's screen`,
    );
    assert.ok(
      failure.message.includes(key),
      `the render failed without naming "${key}" as the missing key; it said: ` +
        `${failure.message}`,
    );
  },
);

Then(
  "no rendered output should carry the text {string}",
  function (this: JollyWorld, forbidden: string) {
    const rendered = this.notes[RENDERED_NOTE];
    const output = rendered === undefined ? "" : String(rendered);
    assert.ok(
      !output.includes(forbidden),
      `the rendered output carries the text "${forbidden}": ${JSON.stringify(output)}`,
    );
  },
);

// ─── Every thrown error's prose resolves to a catalog entry ─────────────────

When(
  "every error message authored at a throw site in {string} is joined against the catalog entries",
  function (this: JollyWorld, _sourceDir: string) {
    this.notes.throwSiteProse = findThrowSiteProse();
  },
);

Then(
  "every authored sentence should resolve to a catalog entry",
  function (this: JollyWorld) {
    const authored = this.notes.throwSiteProse as ThrowSiteProse[];
    assert.equal(
      authored.length,
      0,
      `sentences authored at a throw site instead of resolving through the catalog:\n${authored
        .map((site) => `  - ${site.file}:${site.line} ${JSON.stringify(site.text)}`)
        .join("\n")}`,
    );
  },
);

Then(
  "a sentence authored inline at a throw site should redden the check, naming its file and line",
  function () {
    const planted: InjectedSource = {
      file: "src/.planted-throw-site-prose.ts",
      text: [
        "export function plantedThrowSite(host: string): never {",
        "  throw new Error(`Refusing to reach the planted host ${host}.`);",
        "}",
      ].join("\n"),
    };
    const reported = findThrowSiteProse([planted]).find(
      (site) => site.file === planted.file,
    );
    assert.ok(reported, "a sentence authored inline at a throw site was not reported");
    assert.ok(
      reported.line > 0,
      `the report must name the line: ${JSON.stringify(reported)}`,
    );
    assert.ok(
      reported.text.includes("Refusing to reach the planted host"),
      `the report must carry the authored sentence: ${reported.text}`,
    );
  },
);

Then(
  "a sentence assembled by concatenation at a throw site should redden the check, since a sentence split across operands is still authored copy",
  function () {
    const planted: InjectedSource = {
      file: "src/.planted-concatenated-throw-site-prose.ts",
      text: [
        "export function plantedConcatenatedThrowSite(host: string): never {",
        '  throw new Error("Refusing to reach the planted host " + host + " on this run.");',
        "}",
      ].join("\n"),
    };
    const reported = findThrowSiteProse([planted]).find(
      (site) => site.file === planted.file,
    );
    assert.ok(
      reported,
      "a sentence assembled by concatenation at a throw site was not reported",
    );
    assert.ok(
      reported.text.includes("Refusing to reach the planted host") &&
        reported.text.includes("on this run"),
      `the report must carry the wording from both operands: ${reported.text}`,
    );
  },
);

Then(
  "the catalog resolver's own missing-key refusal should be exempt, since no entry can render the failure to find an entry",
  function (this: JollyWorld) {
    const authored = this.notes.throwSiteProse as ThrowSiteProse[];
    assert.equal(
      authored.filter((site) => site.file === "src/lib/messages.ts").length,
      0,
      "the catalog resolver's own missing-key refusal must be exempt: a key " +
        "lookup for that sentence is the same lookup that just failed",
    );
    // The exemption is the resolver seam, not the file: a sentence authored at
    // any other throw in the same file is still reported.
    const planted: InjectedSource = {
      file: "src/lib/messages.ts",
      text: [
        readFileSync(join(REPO_ROOT, "src/lib/messages.ts"), "utf8"),
        "export function plantedResolverNeighbour(): never {",
        '  throw new Error("The planted neighbour refuses to run.");',
        "}",
      ].join("\n"),
    };
    const reported = findThrowSiteProse([planted]).find((site) =>
      site.text.includes("The planted neighbour refuses to run"),
    );
    assert.ok(
      reported,
      "the exemption must cover the resolver seam alone; a sentence authored " +
        "at another throw in the same file was not reported",
    );
  },
);

// ─── The non-first-party host refusal reads its sentence from the catalog ───

When(
  "Jolly is asked to reach the host {string}",
  function (this: JollyWorld, host: string) {
    // The refusal is pre-flight, before any request is sent, so the customer-
    // supplied host is never contacted; the token is a stand-in that keeps the
    // run from stopping at the auth gate instead of the host guard.
    this.notes.refusedHost = host;
    this.runCli(
      ["create", "store", "--url", `https://${host}/graphql/`, "--json"],
      { env: absentCredentialsEnv({ JOLLY_SALEOR_CLOUD_TOKEN: STAND_IN_TOKEN }) },
    );
  },
);

Then(
  "the run should fail with the stable code `NON_FIRST_PARTY_HOST`",
  function (this: JollyWorld) {
    const envelope = this.lastRun?.envelope;
    assert.ok(envelope, "the run produced no envelope");
    assert.equal(envelope.status, "error", "the run did not fail");
    const codes = (envelope.errors ?? []).map((entry) => entry["code"]);
    assert.ok(
      codes.includes("NON_FIRST_PARTY_HOST"),
      `errors[] must carry the stable code NON_FIRST_PARTY_HOST; got ${JSON.stringify(codes)}`,
    );
  },
);

Then(
  "the error message should be the catalog's non-first-party host sentence",
  function (this: JollyWorld) {
    const refusal = (this.lastRun?.envelope?.errors ?? []).find(
      (entry) => entry["code"] === "NON_FIRST_PARTY_HOST",
    );
    assert.ok(refusal, "expected a NON_FIRST_PARTY_HOST error entry");
    const message = String(refusal["message"]);
    this.notes.refusalMessage = message;
    const host = String(this.notes.refusedHost);
    assert.equal(
      message,
      cliMessage("createStore.error.nonFirstPartyHost.message", { pastedHost: host }),
      "the refusal message must be the catalog's sentence, rendered with the refused host",
    );
  },
);

Then(
  "the message should name {string} as the refused host",
  function (this: JollyWorld, host: string) {
    const message = String(this.notes.refusalMessage);
    assert.ok(
      message.includes(host),
      `the refusal must name the refused host "${host}"; got: ${message}`,
    );
  },
);
