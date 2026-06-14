// Harness fakes for the CLIs `jolly start` spawns in the storefront and deploy
// stages, used by feature 002 (@logic) to keep those stages hermetic. The
// storefront stage spawns `git` (clone Paper, fresh init) and `pnpm` (install);
// the deploy stage spawns `npx vercel` (the fake `npx` in configurator-cli-fake
// already shadows that) and may invoke `vercel` directly. Placed first on the
// child's PATH, each fake answers WITHOUT any network call by exiting non-zero —
// a CLI that did not complete (here, offline) — so the storefront/deploy stages
// can only be reported blocked/pending, never a fabricated completion. This
// mirrors the no-fabrication contract the fake `npx` enforces for the recipe
// stage; the real clone/install/deploy is verified by the @sandbox scenarios.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** An offline stub CLI: prints to stderr and exits non-zero, contacting nothing. */
function writeStub(dir: string, name: string): string {
  const script = `#!/usr/bin/env node
"use strict";
process.stderr.write(${JSON.stringify(`fake ${name}: offline stub\n`)});
process.exit(1);
`;
  const path = join(dir, name);
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

/**
 * Write executable fake `git`, `pnpm`, and `vercel` into `dir` (sibling to the
 * fake `npx`). Put `dir` first on the PATH of the process under test so the
 * storefront/deploy stages resolve these instead of the real binaries and make
 * no network call.
 */
export function writeFakeStorefrontClis(dir: string): void {
  writeStub(dir, "git");
  writeStub(dir, "pnpm");
  writeStub(dir, "vercel");
}
