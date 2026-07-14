> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-14)

Last QM cycle spent its 7-target watchbill green and closed at `5108aad`. The verification-economy and plank checks are executable and proven by planted reds. npm still at `@dk/jolly@0.12.4`; nothing outbound since.

Landed that cycle, worth remembering:

- The env-create body is now built by ONE seam (`environmentCreationBody`, `src/lib/cloud-api.ts`). The two literals HAD already diverged, on `service` and on project name-vs-slug, exactly as suspected.
- The interactive PTY scenarios are prompt-gated (`waitFor`), not delay-guessed. That was the 72%-of-`@logic` latency sink.
- Harness Cloud reads now retry transient 5xx like production does. That mode and the plank-inventory false-PASS mode are both struck from `RIGGING.md`.

## Closed: the 020 recovery contract (commits 39e932d, 928ee30)

The `@eval` affordance map landed and immediately earned its keep. Run A (21 turns, 197k prompt + 9.7k completion, 8m44) caught the agent running `jolly create store --json`, getting an error envelope with an EMPTY `nextSteps`, and burning the next turn on `jolly create store --help`. Run B took a clean path and never reproduced it, which is the whole argument for a deterministic guard.

The gap was in the spec, not the agent: feature 020 made `remediation` optional and permitted an empty `nextSteps` on an error envelope, while feature 025 asserts the agent never falls back to `--help`. Both could not be right. Decided with dk: 020 is now the tighter contract.

It was not a corner case: **12 of 20 error-envelope construction sites carried no `nextSteps`.** The empty-recovery envelope was the majority. Crew closed all of them.

Two guards now stand, and they cover different ground. The `@logic @property` scenario enumerates both construction seams statically — every `errorEnvelope(...)` call AND every `envelope({...})` whose status is not literally success/warning, because doctor COMPUTES its status and would otherwise escape as a false pass. The `@logic` doctor scenario drives a live envelope, because doctor derives `nextSteps` at run time by filtering failing checks on `c.command`, and four checks fail without one (`cloud-token-verification` among them) — no static check can see that. The structural guard cannot prove the runtime list non-empty; only the live one can.

QM disclosed that residual itself rather than let its own scenario pass on it. It also found a false-PASS in its own step definition: the shared `remediation` step read a note only the structural scenario set, so on the live scenario it would have filtered an empty list and passed WITHOUT inspecting the envelope. Fixed to assert non-vacuously on both paths.

## Held, deliberately

**Budget scenario stays `@captain`** (`025:A baseline agent sets up a project within its declared turn and token budget`). The map now records turns and tokens on every `@eval` run, so anchors accumulate on their own. But the only fully-recorded anchor today is the FLAILING run, and a ceiling drawn from a bad run is not a ceiling. Promote after a few clean runs give a real baseline. Still: do not invent the number.

## Standing rule, learned the hard way

**Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.** 0.12.1 and 0.12.2 both shipped "verified" and both were broken, because the mechanism was tested in a bespoke harness on a box that already had a Vercel session and a warm npx cache: never the customer's conditions. Drive the real path or do not claim it works.

## Standing findings, not yet acted on

- **`src/index.ts` is ~5700 lines / 97 functions**: 15 commands, 6 stages, the TUI, 35 envelope builders, 19 auth functions, 10 Vercel functions. Reported, not perturbed (dk's call). A perturbation proves only what the scenarios pin; before planting over 97 functions, confirm the seams' scenarios pin what must survive. That is its own cycle.
- **`happy-dom`**: unused devDependency, zero source references, under a `locked` policy. Boatswain hygiene.

## Owed before outbound

A pre-outbound full regression across every tier. `RIGGING.md` names two targets: npm and vercel-homepage.
