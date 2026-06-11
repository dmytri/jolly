// Homepage / setup-guide artifact discovery and DOM loading (features 001, 016).
//
// The homepage implementation shape is left to the implementation agent
// (feature 016 open questions), so the harness pins only a discovery
// convention (QM-owned): the homepage must be a static HTML document at one of
// the candidate paths below (or pointed to by HARNESS_HOMEPAGE_HTML), and
// the agent setup guide must be a sibling document at one of the guide
// candidates (or HARNESS_SETUP_GUIDE). A build step is fine as long as the
// committed repository contains (or can resolve to) these artifacts.
//
// DOM-level checks use happy-dom per the testing strategy in AGENTS.md.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { repoRoot } from "./cli.ts";

export const HOMEPAGE_CANDIDATES = [
  "homepage/index.html",
  "homepage/dist/index.html",
  "site/index.html",
  "public/index.html",
];

export const SETUP_GUIDE_CANDIDATES = [
  "homepage/setup-guide.html",
  "homepage/setup-guide.md",
  "homepage/dist/setup-guide.html",
  "site/setup-guide.html",
  "site/setup-guide.md",
  "public/setup-guide.html",
  "public/setup-guide.md",
];

export const COPY_BOX_PHRASE = "copy this to your agent to get started";

function resolveFirst(candidates: string[], override: string | undefined, what: string): string {
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`${what} override does not exist: ${override}`);
  }
  for (const candidate of candidates) {
    const path = join(repoRoot, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(
    `${what} not found. Expected one of: ${candidates.join(", ")} (relative to the repo root). ` +
      "The homepage is not implemented yet, or it does not follow the harness discovery convention " +
      "documented in features/support/homepage.ts.",
  );
}

export function homepagePath(): string {
  return resolveFirst(HOMEPAGE_CANDIDATES, process.env.HARNESS_HOMEPAGE_HTML, "Jolly homepage HTML");
}

export function setupGuidePath(): string {
  return resolveFirst(SETUP_GUIDE_CANDIDATES, process.env.HARNESS_SETUP_GUIDE, "Jolly agent setup guide");
}

export interface LoadedPage {
  window: Window;
  document: Document;
  text: string;
  html: string;
}

export function loadHomepage(): LoadedPage {
  const html = readFileSync(homepagePath(), "utf8");
  const window = new Window();
  window.document.write(html);
  const document = window.document as unknown as Document;
  return { window, document, text: document.body?.textContent ?? "", html };
}

/** Setup guide as plain text (works for both .md and .html guides). */
export function loadSetupGuideText(): string {
  const path = setupGuidePath();
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".md")) return raw;
  const window = new Window();
  window.document.write(raw);
  return (window.document.body?.textContent ?? "") + collectAttributeText(window);
}

// Include href targets so "see invocation examples / URLs" checks also match links.
function collectAttributeText(window: Window): string {
  const anchors = Array.from(window.document.querySelectorAll("a[href]"));
  return "\n" + anchors.map((a) => a.getAttribute("href") ?? "").join("\n");
}

/** The element containing the literal copy-box phrase (features 001/016). */
export function findCopyBox(document: Document): Element {
  const all = Array.from(document.querySelectorAll("body *"));
  const matches = all.filter((el) =>
    (el.textContent ?? "").toLowerCase().includes(COPY_BOX_PHRASE),
  );
  if (matches.length === 0) {
    throw new Error(`homepage has no element containing the copy-box phrase "${COPY_BOX_PHRASE}"`);
  }
  // Innermost match = the element whose own subtree is the copy box.
  return matches[matches.length - 1];
}

/**
 * The copyable agent prompt. Convention: the prompt is the text of a
 * <pre>, <code>, or <textarea> element (or an element with a `data-copy`
 * attribute) inside or immediately after the copy box.
 */
export function findCopyPrompt(document: Document): string {
  const explicit = document.querySelector("[data-copy]");
  if (explicit) {
    return explicit.getAttribute("data-copy") || explicit.textContent || "";
  }
  const box = findCopyBox(document);
  const scopes: Element[] = [box];
  if (box.parentElement) scopes.push(box.parentElement);
  for (const scope of scopes) {
    const node = scope.querySelector("pre, code, textarea");
    if (node && (node.textContent ?? "").trim().length > 0) return node.textContent ?? "";
  }
  throw new Error(
    "copy box found, but no copyable prompt element (pre/code/textarea or [data-copy]) inside or around it",
  );
}
