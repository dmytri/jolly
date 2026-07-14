> STOP. Captain's notes: non-binding. Captain writes, Captain trims. Anyone else: close this file now.

# Captain Notes

Binding behaviour lives in `.feature` specs and referenced `assets/**`. History lives in git. These notes carry only what the next cycle needs.

## Deck state (2026-07-14)

HEAD `8d9866a`. npm still at `@dk/jolly@0.12.4`; **nothing outbound this voyage**. `@logic` 176/176 green at that commit. `## Known false-failure modes` in `RIGGING.md` is EMPTY, which is the healthy state — keep it that way by engineering defects out, never by recording them.

**The Cloud account changed.** `.env` now carries dk's new Saleor account: org `jollystores-organization`, holding dk's own store `jollystore's Environment` / `store-hqdxy4uo`. That store is NOT reclaimable (its namespace is in neither its name nor its domain label) — verified against the reclaim predicate, not assumed. The org's environment cap is **2**. The previous account is abandoned: do not raise it, do not clean it, it is gone.

## What landed this voyage

- **Error envelopes carry their own recovery** (020). It was not a corner case: 12 of 20 construction sites shipped an empty `nextSteps`, and `cloudErrorEnvelope` gave next steps to `ENVIRONMENT_LIMIT_REACHED` alone — every other Cloud error shipped empty. Now every code carries recovery, guarded structurally AND by a live envelope.
- **The shipped CLI can no longer fabricate.** `--mock-organizations` / `--mock-environments` shipped UNGATED in the released binary, specified by no feature: a customer could make Jolly invent an org list. Now behind a harness guard, and 026's no-double invariant scans production, not just the verification layer.
- **The environment leak is closed.** A leaked `jolly-store` env whose namespace lived only in its DOMAIN LABEL was invisible to a name-only reclaim and squatted the org's last slot; every create-an-environment scenario starved while every reuse scenario passed. Reclaim now matches on name OR domain label, proven by planted red and by a real create-and-reclaim against the live org.
- **Interactive waits are prompt-gated**, not delay-guessed (the 72%-of-`@logic` latency sink).
- **Verification economy + plank form/staleness checks** are executable and proven by planted reds.

## The pattern worth remembering: false-PASS checks

Five checks this voyage were GREEN while the defect they existed to catch was live. Every one inspected the wrong thing:

- `plank-inventory` grepped for a token, so it saw plank PRESENCE and never plank FORM.
- The `remediation` step read a note only the sibling scenario set, so it filtered an empty list and passed **without inspecting the envelope**.
- The error-envelope check saw the `nextSteps:` KEY present and never evaluated that its ternary yields `[]` on every branch but one.
- The no-double invariant scanned the verification layer while the double's mechanism sat in production.
- Reclaim matched on name while the leak's identity was its domain label.

**A check that inspects shape rather than value is not a check.** When a guard is written, ask what live counterexample would still pass it. Three of these five were disclosed by the roles themselves rather than discovered — that honesty is the only reason they were found.

## Closed: the flaky device-auth read (`5b67dc1`)

`027:...clickable terminal hyperlink` passed focused every time and failed intermittently under tier concurrency: a READ ending on a timer, returning whatever the terminal had produced by then. A green tier sweep proved nothing — QM ran one, correctly refused to call it a fix, and said so.

**The routing lesson, and it cost a cycle.** The diagnosis was sent to QM in a MESSAGE. QM ignored it and worked the file, exactly as the bulkhead requires. Intent that lives in chat does not exist. The fix was to recast the finding as a durable check carrying no rationale: a new `@logic @invariant` in `verification-economy` outlawing a read that ends on a timer. The defect then reddens on inspection, with no concurrency luck needed.

The repair is a contract, not a patch: `readUntil` is now a REQUIRED field on `runUnderPty`, `timeoutMs` is demoted to a failure ceiling that throws, and the type system enforces it at all ten call sites. The hyperlink scenario fell 16.8s to 3.0s. `@logic` 177/177 green.

## Next, in order

1. **Pre-outbound full regression, all tiers.** Production changed since the last green board, and green does not transfer across a diff. It runs against the NEW account — a genuinely cold org, closer to a customer's first run than anything tested so far. Two things it must settle: `@sandbox` has NOT run against the new PTY driver envelope (`tsc` proves every call site declares `readUntil`, so the risk is low but UNPROVEN), and `@eval` is a required green gate.
2. **Harbour** (Shipwright): the stale `step-usage` count in `RIGGING.md`; the 16 zero-usage step definitions (orphan candidates); the verification-economy audit against the per-scenario cost record this voyage built; and `findTimerEndedReads` does not statically check a `readUntil` passed as a variable (sound, since the type makes it mandatory, but noted).
3. **Outbound** — npm + vercel-homepage — only on dk's explicit go, and only on a green board. dk's standing position: 0.12.4 serves both the terminal and agent paths, so there is no pressure to ship a red tree.

## Wake is stale, do not trust it

`coverage/weather/tiers.tsv` still records `eval RED(rc=1)` and a `logic` row of 165 from a PRE-voyage run; today's `@logic` is 177 and `@eval` ran 3/3 green. The roll-up is not written automatically by a tier run. Read a tier result from the run, never from that file.

## Open finding, not yet acted on

**A live Cloud-error scenario costs ~5 minutes in `@logic`.** The new `020:A Cloud API error carries the recovery whatever its code` drives a real rejected create. `@logic` runs on every inner-loop change, so a 5-minute scenario there is paid constantly. Judge tier placement at harbour: `@sandbox` is the likely home. This is exactly the finding the verification-economy record exists to surface.

## Held, deliberately

**Budget scenario stays `@captain`** (`025:A baseline agent sets up a project within its declared turn and token budget`). The affordance map records turns and tokens on every `@eval` run, so anchors accumulate on their own. The only fully-recorded anchor is still the FLAILING run (21 turns, 197k prompt + 9.7k completion). A ceiling drawn from a bad run is not a ceiling. Do not invent the number.

## Standing rule, learned the hard way

**Any change to the interactive path MUST be verified through `features/support/pty.ts` `runUnderPty`.** 0.12.1 and 0.12.2 both shipped "verified" and both were broken, because the mechanism was tested in a bespoke harness on a box that already had a Vercel session and a warm npx cache: never the customer's conditions. Drive the real path or do not claim it works.

## Standing findings

- **`src/index.ts` is ~5700 lines / 97 functions.** Reported, not perturbed (dk's call). A perturbation proves only what the scenarios pin; before planting over 97 functions, confirm the seams' scenarios pin what must survive. Its own cycle.
- **`happy-dom`**: unused devDependency, zero source references, under a `locked` policy. Boatswain hygiene.

## Operating notes for the next Captain

- **One writer at a time.** Two QMs on the same tree corrupted a step-definitions file mid-cycle; the second QM correctly refused to trust the deck and withdrew. Never resume an old role agent while a new one holds the deck.
- **Dispatch thin.** A Boatswain dispatch carrying the refit narrative, relayed proof, and a pre-excused red was refused as contaminated — correctly. A role that inherits a conclusion cannot independently reach it. Role and base commit; the artifacts are the hand-off.
- **dk wants live play-by-play**, not silent background runs. Poll in short windows and report each tick; a long blocking poll reads as running dark.
