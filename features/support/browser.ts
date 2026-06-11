// Browser capability detection for @requires-browser scenarios (feature 018,
// Rule "Browser OAuth prerequisites").
//
// Tier order is fixed by the spec: native browser first, then Playwright.
//   Tier 1 — native browser: the platform-appropriate open command
//            (`open` on macOS, `xdg-open` on Linux, `start` on Windows)
//            exits 0 — a display is present and a browser can open.
//   Tier 2 — Playwright headless: the `playwright` npm package imports AND
//            its chromium executable exists on disk. Fast synchronous check,
//            no browser launch. Running Tier 2 additionally needs the
//            harness-only knobs HARNESS_SALEOR_EMAIL / HARNESS_SALEOR_PASSWORD
//            (CI/test secrets piped into Jolly's stdin prompt — never Jolly
//            settings, never written to .env).
//   Tier 3 — neither: the scenario skips with guidance to install Playwright
//            or use `jolly login --token <value>`.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** Harness-only knobs for the Tier 2 Playwright login (feature 018). */
export const HARNESS_LOGIN_KNOBS = [
  "HARNESS_SALEOR_EMAIL",
  "HARNESS_SALEOR_PASSWORD",
] as const;

function openCommand(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    default:
      return "xdg-open";
  }
}

let nativeBrowserCache: boolean | undefined;

/**
 * Tier 1 check: try the platform-appropriate open command. Exit code 0 means
 * a browser is available. On a headless machine the command fails fast (no
 * display / no handler), so probing `about:blank` is harmless; on a machine
 * with a display the worst case is a blank tab.
 */
export function nativeBrowserAvailable(): boolean {
  if (nativeBrowserCache !== undefined) return nativeBrowserCache;
  try {
    execSync(`${openCommand()} about:blank`, {
      stdio: "ignore",
      timeout: 10_000,
    });
    nativeBrowserCache = true;
  } catch {
    nativeBrowserCache = false;
  }
  return nativeBrowserCache;
}

let playwrightCache: boolean | undefined;

/**
 * Tier 2 check: the `playwright` package can be imported and its chromium
 * executable exists on disk. Synchronous; never launches a browser.
 */
export function playwrightAvailable(): boolean {
  if (playwrightCache !== undefined) return playwrightCache;
  try {
    const require = createRequire(import.meta.url);
    const playwright = require("playwright") as {
      chromium: { executablePath(): string };
    };
    playwrightCache = existsSync(playwright.chromium.executablePath());
  } catch {
    playwrightCache = false;
  }
  return playwrightCache;
}

/** Names of the Tier 2 harness knobs that are unset or blank. */
export function missingLoginKnobs(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return HARNESS_LOGIN_KNOBS.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
}

export type BrowserTier =
  | { tier: 1; mode: "native" }
  | { tier: 2; mode: "playwright" }
  | { tier: 3; mode: "skip"; reason: string };

/**
 * Resolve the @requires-browser tier, in spec order: native browser first,
 * then Playwright (with the harness login knobs), then skip.
 */
export function resolveBrowserTier(): BrowserTier {
  if (nativeBrowserAvailable()) return { tier: 1, mode: "native" };
  if (playwrightAvailable()) {
    const missing = missingLoginKnobs();
    if (missing.length === 0) return { tier: 2, mode: "playwright" };
    return {
      tier: 3,
      mode: "skip",
      reason:
        `Playwright is available but the harness login knobs ${missing.join(", ")} ` +
        "are not set; cannot complete the Playwright login flow.",
    };
  }
  return {
    tier: 3,
    mode: "skip",
    reason:
      "No native browser and no Playwright with browser binaries available. " +
      "Install Playwright (and its chromium binaries) to automate the flow, or " +
      "authenticate with `jolly login --token <value>` instead.",
  };
}
