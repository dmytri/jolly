> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-13, after harbour)

Full-tier regression GREEN, 221/221: `@logic` 165, `@sandbox` 15, `sandboxSerial` 40, `@eval` 1. Coverage 82.9% composed, zero uncovered modules. `sandboxSerial` had never completed a clean run before this harbour. npm at `@dk/jolly@0.12.4`, pushed.

`watchbill.json` carries the 7 scenarios promoted out of harbour. QM has never seen them: they are spec-only, no step definitions, so every one is expected RED on first run. That is the point.

## Standing rule, learned the hard way

**Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.** 0.12.1 and 0.12.2 both shipped "verified" and both were broken, because the mechanism was tested in a bespoke harness on a box that already had a Vercel session and a warm npx cache: never the customer's conditions. The repo had the real-PTY harness the whole time. Drive the real path or do not claim it works.

## Decisions taken this harbour (dk)

- **Verification economy is latency only.** Model invocations and tokens are NOT a harness-cost concern. dk's reframing, and it is the better one: in `@eval` they measure how well Jolly's setup instructions and CLI output guide an agent. A run that scrapes through in thirty confused turns passes the old affordance scenario identically to one that glides through in eight. So they live in feature 025 as **agent affordance efficiency**, a product contract.
- **The turn-by-turn affordance map is the prize**, not the total. `pi` records per-turn usage; feature 025 already installs a PATH shim logging every Jolly argv. Joined, they name WHICH turn and WHICH piece of Jolly's output made the agent flail. That names the copy to fix.
- **Dropped** the "no model outside `@eval`" hard zero. A guard against a hypothetical, and it muddied the distinction above.
- **Budget scenario HELD at `@captain`** (`025:A baseline agent sets up a project within its declared turn and token budget`). It needs a ceiling, and we have no measurement: `pi`'s session is deleted with the throwaway `$HOME` on every run. Promote it only after the map lands and gives a real anchor. Do not invent the number.
- **`012` previewed-vs-sent recast as `@logic @property`.** First draft burned a real Saleor environment to check a structural fact. The fact is: exactly one seam builds the env-create POST body. The AST settles that for free; the runtime effect is already covered by the existing `@creates-env` creation scenario.

## Standing findings, not yet acted on

- **`src/index.ts` is 5707 lines / 97 functions**: 15 commands and 6 stages and the TUI and 35 envelope builders and 19 auth functions and 10 Vercel functions. Reported, not perturbed (dk's call). A perturbation proves only what the scenarios pin; before planting over 97 functions, confirm the seams' scenarios pin what must survive. That is its own cycle.
- **`happy-dom`**: unused devDependency, zero source references, under a `locked` policy. Boatswain hygiene.
- **The env-create body is built twice** (`index.ts` preview literal vs the real POST literal) and they already diverge on `service`. The promoted `@logic @property` scenario is the guard. Przemek's sample-data suspicion was investigated and is **false**: a Jolly-created store carries only the recipe's products, no Saleor sample dataset. `database_population: null` works. No latency to win there.

## Where the latency actually is

`@logic` mean 4.5s against a median of 653ms. About 72% of the default tier's time sits in about 10% of its scenarios, every one PTY-driven, every one paying `inputDelayMs: 600`, a guessed fixed delay, on the tier that runs on every inner-loop change. The harness already implements prompt-aware `waitFor`; almost nothing used it. Promoted `verification-economy:An interactive scenario waits for the prompt it is answering, never a guessed delay` reddens on exactly this, so the fix reaches QM as a failing target rather than as prose.
