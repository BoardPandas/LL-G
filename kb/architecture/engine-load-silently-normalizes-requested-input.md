---
tech: architecture
tags: [input-validation, engine-integration, normalization, identity, quantities, simulation, forge, data-integrity]
severity: high
---
# A successful engine load can silently change the requested input

## PROBLEM

An integration validates a request's shape and item count, hands it to an engine, and trusts the engine's returned object or completed output. The engine's loader may normalize names, substitute unsupported placeholders, remove entries, or relocate them between sections without throwing. The result can be internally consistent and still describe a different input from the one the caller approved.

Observed in Table Elo's Forge integration: requests contained 100 physical cards, but the legacy deck loader accepted some combined card names as unsupported placeholders. A later method named `getValid()` mutated the deck by removing unsupported entries. Commander entries could also move out of the commander section. Successful deserialization and a plausible game result therefore did not prove that the requested deck had been played.

A load-only audit of **415 eligible lists** found **69 below 100 cards after legacy validation**: 67 involved unsupported combined-name requests and two involved ordinary unresolved names. **Six commanders changed sections.** There were **193 unsupported requested copies**, but the first `getValid()` pass removed only **189**, leaving **four unsupported copies**: the legacy removal operated on one copy per unsupported pool entry. Counting removals, or checking only the final total, understated the defect.

## WRONG

```java
// Request validation has already counted 100 cards.
Deck deck = DeckSerializer.fromSections(requestedSections);
Deck playable = deck.getValid().getLeft();
// The returned object exists, but validation may have mutated it.
return runMatch(playable);
```

```js
// A tempting naming workaround silently discards identity information.
const engineName = requestedName.split("//")[0].trim();

// A second trap: partial stdout can contain a plausible result before failure.
const result = parseEngineOutput(stdout);
if (result.games.length) await applyRatingChanges(result);
```

## RIGHT

Treat loading as a potentially lossy boundary. Resolve the caller's complete requested identities independently of the loader's transformed output, then compare the actual loaded inventory before allowing any match or other consequential work.

```text
expected = parse request with strict quantities and known sections
resolve each requested name to one supported, complete physical identity
preserve valid aliases, printing selection, foil flags, and functional variants
reject ambiguous identities, invalid quantities, and invalid section placement

loaded = engine.load(resolved request)
before = inventory(loaded, keyed by section + complete identity, with quantities)
require before == expected canonical inventory
require every loaded entry is supported

validationReport = engine.validate(loaded)
after = inventory(loaded)
require validationReport reports no removals
require after == before
require configured match preparation will not remove or relocate entries

only now construct/start the match
```

Keep identity, quantity, and section checks separate. A replacement can keep the total unchanged; a section move can preserve every card; a set comparison loses duplicate quantities. Include the ordered faces/layout and functional variant where they define one physical object. Format policy, such as a 100-card Commander list, is another check; integrity validation must also preserve valid non-100 inputs for other formats.

For Forge names, try a supported exact primary identity first. `SP//dr, Piloted by Peni` contains literal `//`; a genuine split card can also use a full combined name. Only use a combined-name fallback after proving that **both supplied faces, in order**, belong to the same supported physical card. A primary name plus an unrelated, reversed, empty, or third face must fail. Resolve engine-supported aliases and unique reverse-face shorthand without guessing; reject an ambiguous reverse face. Preserve the requested printing/foil/variant suffix instead of rebuilding the request from a truncated name. Identity lookup must not consume the game's RNG.

Reject failures before match startup, and keep the process-result boundary strict too:

```js
const parsed = parseEngineOutput(stdout);
if (exitCode !== 0 || parsed.unsupported.length > 0) {
  // Missing exit status is not success. Retain diagnostic evidence separately.
  return { games: 0, error: "engine_input_or_process_failed" };
}
return acceptCompletedResults(parsed);
```

No outcome parsed from a failed request should update ratings or be treated as a completed experiment. Distinguish a pre-dispatch refusal from a failure after dispatch so an automatic fallback does not run the work again under a false "nothing started" assumption.

## NOTES

- The corrected load-only audit accepted **413 lists with exactly 100 cards, preserved commander sections, and no removals**, and explicitly rejected the two unresolved inputs. It ran **zero games**. These aggregate results establish input loading behavior, not the validity or magnitude of historical rating changes.
- The fix passed **160 focused Java assertions**, including combined names, literal separators, aliases, printing/variant preservation, ambiguous faces, duplicate quantities, section moves, unsupported placeholders, validation-time mutation, match-configured removals, and capture-on/off starting-state/RNG parity. Run the real engine and its pinned catalog; a loader mock can simply repeat the integration's mistaken assumptions.
- Audit the existing supported corpus before tightening validation. An intermediate strict-name fix rejected legitimate aliases; rejecting more input is not evidence of correctness. Include positive compatibility cases as well as malformed inputs.
- Record a private source fingerprint, canonical inventory fingerprint, requested/loaded totals, and section counts with the run. A hash proves which input was checked only after the canonicalization contract is correct. Do not publish private lists, per-deck identifiers, or raw engine logs as proof; aggregate exposure counts separately.
- Implementation evidence: TCG commit [f65f496](https://github.com/BoardPandas/tcg/commit/f65f496c09d5cd0362b13dd663a41796aae10d4d), particularly `forge-sim/RichSimDeckLoader.java` and `RichSimDeckLoaderProbe.java`. The findings describe that tested engine/catalog version, not every Forge release.
- Related: [A conservation check cannot detect a misread source](conservation-check-cannot-detect-misread-source.md) covers an incorrect initial interpretation; this case changes a valid request at a downstream loader. [A precondition gate must count what the consumer processes](precondition-gate-counts-unfiltered-collection.md) covers planned filtering. [Zod strips undeclared persisted keys](../typescript/zod-object-strips-undeclared-keys.md) is the schema round-trip version of a successful but lossy boundary.
