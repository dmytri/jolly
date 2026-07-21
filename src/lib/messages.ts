// Leaf module for the human-facing CLI copy. The interactive layer renders every
// human string from the message catalog asset (`assets/messages/cli.json`) by
// key, never an inline literal at the render site (feature 027). A catalog value
// may carry `{name}` placeholders the renderer fills with run values such as the
// organization, the store URL, and the live URLs (feature 006 substitution).
//
// This module imports nothing from src/index.ts or src/lib/start-close.ts, so
// both can import `cliMessage` from here without a circular import.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cliMessageCatalog: Record<string, string> | undefined;

// The catalog ships in the package and is read at runtime. esbuild bundles this
// module into `dist/index.js` at the package root, where `../assets/...` resolves
// the shipped catalog; dev runs raw from `src/lib/`, where `../../assets/...`
// resolves it. Try both candidate paths and use the one that exists.
function catalogPath(): string {
  const candidates = ["../assets/messages/cli.json", "../../assets/messages/cli.json"].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * @planks('^the CLI renders the `([\w.]+)` message with organization "([^"]+)"$')
 * @planks('^the CLI renders the `([\w.]+)` message$')
 */
export function cliMessage(
  key: string,
  vars?: Record<string, string | number | undefined>,
): string {
  if (!cliMessageCatalog) {
    cliMessageCatalog = JSON.parse(readFileSync(catalogPath(), "utf8")) as Record<string, string>;
  }
  let value = cliMessageCatalog[key];
  if (value === undefined) {
    throw new Error(`the message catalog has no entry for the key "${key}"`);
  }
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}
