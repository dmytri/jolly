// The repo root, computed with no dependency on cucumber (unlike world.ts,
// which registers a World constructor as an import-time side effect and so
// cannot be imported outside an actual cucumber run — e.g. from the
// standalone reclaim-cli.ts preflight).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
