// Browser capability detection for @requires-browser scenarios (feature 018,
// "Browser OAuth prerequisites" rule). The harness checks native browser
// capability first, then Playwright, in that order:
//   Tier 1 — native browser: a display is available and the platform open
//            command (`open`/`xdg-open`/`start`) works (exit code 0).
//   Tier 2 — Playwright headless: the `playwright` npm package can be
//            imported AND its chromium browser binary exists on disk.
//            Fast synchronous check, no browser launch.
//   Tier 3 — neither: the scenario skips with guidance to install Playwright
//            or use `jolly login --token <value>`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Native browser availability: platform-appropriate open command exits 0.
 * On Linux a display must also be present — `xdg-open` exists on headless
 * boxes but cannot open a browser there.
 */
export function nativeBrowserAvailable(): boolean {
  const platform = process.platform;
  if (platform === "linux") {
    const hasDisplay =
      (process.env.DISPLAY ?? "").trim() !== "" ||
      (process.env.WAYLAND_DISPLAY ?? "").trim() !== "";
    if (!hasDisplay) return false;
    return commandExitsZero("xdg-open", ["--version"]);
  }
  if (platform === "darwin") {
    // `open -Ra Safari` resolves the app without launching it.
    return commandExitsZero("open", ["-Ra", "Safari"]);
  }
  if (platform === "win32") {
    // `start` is a cmd builtin; cmd presence implies it.
    return commandExitsZero("cmd", ["/c", "exit", "0"]);
  }
  return false;
}

/**
 * Playwright availability: the `playwright` package resolves and its
 * chromium executable exists on disk. Synchronous; never launches a browser.
 */
export function playwrightAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url);
    const playwright = require("playwright");
    const executable = playwright?.chromium?.executablePath?.();
    return typeof executable === "string" && existsSync(executable);
  } catch {
    return false;
  }
}

export type BrowserTier = "native" | "playwright" | "none";

/** Highest available tier, checking native browser before Playwright. */
export function browserTier(): BrowserTier {
  if (nativeBrowserAvailable()) return "native";
  if (playwrightAvailable()) return "playwright";
  return "none";
}

function commandExitsZero(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, { stdio: "ignore", timeout: 5_000 });
    return result.status === 0;
  } catch {
    return false;
  }
}
