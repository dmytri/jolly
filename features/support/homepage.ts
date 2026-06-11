// Homepage and setup-guide test helpers (feature 016).
//
// Provides DOM-parsing helpers for the Jolly homepage (homepage/index.html)
// and the SKILL.md-style setup guide (homepage/setup.md).
// Uses happy-dom so step definitions can assert text content, tagline,
// copy box, flow section, and setup-guide contents without a browser.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window, Document as HappyDocument } from "happy-dom";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface HomepageDOM {
  window: Window;
  document: HappyDocument;
  /** The homepage HTML as a string. */
  html: string;
}

export interface SetupGuide {
  /** The full markdown content of the setup guide. */
  markdown: string;
}

/**
 * Load the homepage HTML and set up a happy-dom window for testing.
 * Throws if the homepage file does not exist (expected until the Crew Mate
 * creates it — tests can assert on the absence to drive implementation).
 */
export function loadHomepage(): HomepageDOM {
  const html = readFileSync(join(REPO_ROOT, "homepage", "index.html"), "utf8");
  const window = new Window({ url: "https://jolly.cool" });
  const document = window.document;
  document.write(html);
  document.close();
  return { window, document, html };
}

/**
 * Load the setup guide markdown content.
 * Throws if the file does not exist.
 */
export function loadSetupGuide(): SetupGuide {
  const markdown = readFileSync(
    join(REPO_ROOT, "homepage", "setup.md"),
    "utf8",
  );
  return { markdown };
}
