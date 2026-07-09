// Standalone preflight: reclaim stale jolly-cannon-fodder leftovers (Cloud
// environments and local scratch dirs) without running any cucumber tier.
// The same reclamation also runs automatically from an unconditional
// BeforeAll (hooks.ts) on every cucumber invocation; this entrypoint exists
// so it can be run on its own — e.g. before kicking off a verification
// session — per RIGGING.md's Commands convention.
import "./dotenv.ts";
import { reclaimStaleResources } from "./provision.ts";

// Reclaim only when this module is the process entrypoint — i.e. run standalone
// via `npm run reclaim` (`node features/support/reclaim-cli.ts`). Cucumber's
// support-file glob (cucumber.js `import: features/support/**/*.ts`) imports
// every file under features/support/ on every invocation, so an unguarded body
// would fire the reclaim a SECOND time — and print — on every cucumber run, on
// top of the once-per-invocation BeforeAll reclaim (hooks.ts). The guard keeps a
// cucumber invocation's reclamation to exactly one, from BeforeAll alone.
if (import.meta.main) {
  const reclaimed = await reclaimStaleResources();
  if (reclaimed.length === 0) {
    console.log("No stale jolly-cannon-fodder leftovers found.");
  } else {
    console.log(`Reclaimed ${reclaimed.length} leftover environment(s):`);
    for (const env of reclaimed) console.log(`  - ${env.org}/${env.name}`);
  }
}
