// Homepage and agent setup-guide loading (features 001 and 016).
// DOM-level checks use happy-dom per the testing strategy in AGENTS.md.
//
// Harness conventions for the copy box: the homepage marks the primary copy
// box with [data-jolly-copy-box] (fallback: the element containing the
// required "copy this to your agent to get started" phrase), and the
// copyable agent prompt with [data-jolly-agent-prompt] (fallback: the first
// textarea/pre/code inside the copy box).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { REPO_ROOT } from "./world.ts";

const HOMEPAGE_PATH = join(REPO_ROOT, "homepage", "index.html");
const SETUP_GUIDE_PATH = join(REPO_ROOT, "homepage", "setup-guide.md");

export interface HomepageDom {
  window: Window;
  document: Window["document"];
}

export function loadHomepage(): HomepageDom {
  const html = readFileSync(HOMEPAGE_PATH, "utf8");
  const window = new Window();
  window.document.write(html);
  return { window, document: window.document };
}

export function homepageText(dom: HomepageDom): string {
  return dom.document.body?.textContent ?? "";
}

export function loadSetupGuide(): string {
  return readFileSync(SETUP_GUIDE_PATH, "utf8");
}

const COPY_BOX_PHRASE = "copy this to your agent to get started";

interface DomElement {
  textContent?: string | null;
  parentElement: DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomElement[];
}

/**
 * The prominent copy box on the homepage: the [data-jolly-copy-box] element,
 * or the nearest container that holds both the required phrase and the
 * copyable prompt (textarea/pre/code).
 */
export function findCopyBox(dom: HomepageDom): DomElement {
  const doc = dom.document as unknown as DomElement;
  const marked = doc.querySelector("[data-jolly-copy-box]");
  if (marked) return marked;
  const candidates = [...doc.querySelectorAll("*")].filter((el) =>
    (el.textContent ?? "").toLowerCase().includes(COPY_BOX_PHRASE),
  );
  assert.ok(
    candidates.length > 0,
    `homepage has no copy box: no [data-jolly-copy-box] element and no element ` +
      `containing the phrase "${COPY_BOX_PHRASE}"`,
  );
  // Innermost element with the phrase, then up to the container that also
  // carries the copyable prompt (if any container does).
  const innermost = candidates[candidates.length - 1];
  let current: DomElement | null = innermost;
  while (current) {
    if (current.querySelector("textarea, pre, code")) return current;
    current = current.parentElement;
  }
  return innermost;
}

/** The copyable agent prompt carried by the copy box. */
export function copyBoxPrompt(dom: HomepageDom): string {
  const doc = dom.document as unknown as DomElement;
  const source =
    doc.querySelector("[data-jolly-agent-prompt]") ??
    findCopyBox(dom).querySelector("textarea, pre, code");
  assert.ok(
    source,
    "homepage copy box has no copyable prompt: expected [data-jolly-agent-prompt] " +
      "or a textarea/pre/code inside the copy box",
  );
  const el = source as unknown as { value?: string; textContent?: string | null };
  const prompt = (el.value ?? el.textContent ?? "").trim();
  assert.ok(prompt.length > 0, "homepage agent prompt is empty");
  return prompt;
}
