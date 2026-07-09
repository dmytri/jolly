// Standalone preflight: reclaim stale jolly-cannon-fodder leftovers (Cloud
// environments and local scratch dirs) without running any cucumber tier.
// The same reclamation also runs automatically from an unconditional
// BeforeAll (hooks.ts) on every cucumber invocation; this entrypoint exists
// so it can be run on its own — e.g. before kicking off a verification
// session — per RIGGING.md's Commands convention.
import "./dotenv.ts";
import { argv } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reclaimStaleResources } from "./provision.ts";

// Reclaim only when this module is the process entrypoint — i.e. run standalone
// via `npm run reclaim` (`node features/support/reclaim-cli.ts`). Cucumber's
// support-file glob (cucumber.js `import: features/support/**/*.ts`) imports
// every file under features/support/ on every invocation, so an unguarded body
// would fire the reclaim a SECOND time — and print — on every cucumber run, on
// top of the once-per-invocation BeforeAll reclaim (hooks.ts). The guard keeps a
// cucumber invocation's reclamation to exactly one, from BeforeAll alone.
//
// Compare the resolved entrypoint path to this module's URL rather than using
// `import.meta.main`, which Node added in v24.2 — above this project's declared
// runtime floor (RIGGING.md `runtime: node@20`, package.json engines >=20.12).
// The comparison holds from Node 20, so `npm run reclaim` fires on every
// conformant runtime, not only Node >=24.2.
const invokedDirectly =
  argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(argv[1])).href;
if (invokedDirectly) {
  const reclaimed = await reclaimStaleResources();
  if (reclaimed.length === 0) {
    console.log("No stale jolly-cannon-fodder leftovers found.");
  } else {
    console.log(`Reclaimed ${reclaimed.length} leftover environment(s):`);
    for (const env of reclaimed) console.log(`  - ${env.org}/${env.name}`);
  }
}
