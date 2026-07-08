// Standalone preflight: reclaim stale jolly-cannon-fodder leftovers (Cloud
// environments and local scratch dirs) without running any cucumber tier.
// The same reclamation also runs automatically from an unconditional
// BeforeAll (hooks.ts) on every cucumber invocation; this entrypoint exists
// so it can be run on its own — e.g. before kicking off a verification
// session — per RIGGING.md's Commands convention.
import { reclaimStaleResources } from "./provision.ts";

const reclaimed = await reclaimStaleResources();
if (reclaimed.length === 0) {
  console.log("No stale jolly-cannon-fodder leftovers found.");
} else {
  console.log(`Reclaimed ${reclaimed.length} leftover environment(s):`);
  for (const env of reclaimed) console.log(`  - ${env.org}/${env.name}`);
}
