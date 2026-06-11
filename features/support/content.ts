// Cached access to the homepage and setup-guide content for content-contract
// steps (features 001, 002, 003, 016), plus small assertion helpers.
//
// Several specs describe what the customer's agent should *do*; the durable,
// testable artifact for that behavior is the committed setup guide and copy-box
// prompt that instruct the agent. Content steps therefore assert that the
// guide/prompt contains those instructions.
import assert from "node:assert/strict";
import { loadHomepage, loadSetupGuideText, findCopyPrompt, type LoadedPage } from "./homepage.ts";

let cachedPage: LoadedPage | undefined;
let cachedGuide: string | undefined;
let cachedPrompt: string | undefined;

export function homepage(): LoadedPage {
  return (cachedPage ??= loadHomepage());
}

export function homepageText(): string {
  return homepage().text;
}

export function guideText(): string {
  return (cachedGuide ??= loadSetupGuideText());
}

export function copyPrompt(): string {
  return (cachedPrompt ??= findCopyPrompt(homepage().document));
}

export function assertMentions(haystack: string, pattern: RegExp | string, what: string): void {
  const found =
    typeof pattern === "string"
      ? haystack.toLowerCase().includes(pattern.toLowerCase())
      : pattern.test(haystack);
  assert.ok(found, `${what} (expected to match ${pattern} in the content)`);
}

export function assertGuideMentions(pattern: RegExp | string, what: string): void {
  assertMentions(guideText(), pattern, `setup guide: ${what}`);
}

export function assertHomepageMentions(pattern: RegExp | string, what: string): void {
  assertMentions(homepageText(), pattern, `homepage: ${what}`);
}

export function assertPromptMentions(pattern: RegExp | string, what: string): void {
  assertMentions(copyPrompt(), pattern, `copy-box prompt: ${what}`);
}

/** Both surfaces an agent reads before running anything: prompt + guide. */
export function onboardingText(): string {
  return `${copyPrompt()}\n${guideText()}`;
}
