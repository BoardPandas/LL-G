---
tech: research
tags: [fan-wiki, adaptation, quotes, fabrication, canon, dossier, scraping, verification, subagents]
severity: high
---
# Documenting an adaptation, an LLM quotes the source novel and presents it as sourced

## PROBLEM

When you scrape a fan wiki to build a durable artifact about an **adaptation** (a TV show, a film, a game of a book), an LLM writing from those digests will reach past them for the lines it already knows -- and the lines it knows best are the **source novel's**, not the adaptation's. The result is a quotation that is famous, in character, thematically perfect, attributed to the right speaker, and **not in the thing you are documenting**.

It is undetectable by reading. The failure has none of the usual tells: no hedging, no vagueness, no broken formatting. It sits in a `quotes` array next to a real citation URL, so the artifact asserts provenance it does not have.

Caught 2026-09-03 building a Game of Thrones (HBO) dossier from 857 scraped wiki pages. A writer emitted Old Nan's `"Oh, my sweet summer child. What do you know about fear?"`. Grepping the full string, then an eight-word fragment, across every digest and every raw wikitext file in the tree returned **zero hits**. The wiki page has no Quotes section at all -- only indirect speech buried in a plot summary ("She retorts that he is a *sweet summer child* who knows nothing about fear"). The verbatim line is the novel's. So a single field was simultaneously a fabricated quote and a book-canon leak, in a corpus deliberately built with the "In the books" sections stripped out precisely to prevent the second one.

The same reflex corrupts non-quote fields, and there it is even quieter:

- **Physical description from the book, not the screen.** A character logged at "over seven feet tall" -- the novel's figure. The wiki's own dropped section says the actor is 6'10" and camera angles do the rest. An art brief built on that number is wrong in a way no reader of the brief can catch.
- **Locations swapped for the book's.** An event relocated to a castle that never appears in the adaptation.
- **Roles invented for characters who never appear.** A knight briefed as "killed at the Blackwater" turns out to be book-only; the adaptation never puts him on screen.

Scale matters here: **14 independent auditors over 14 fragments found 111 canon errors, and not one fragment came back clean.** This is not an occasional slip. It is the default behaviour of an LLM writing about an adaptation of something it has memorised.

## WRONG

```bash
# Brief the writer to use the digests, then trust the output because it cites a URL.
# "Quotes must be verbatim from the source" is an instruction, not a check --
# the model believes it is complying: the line IS verbatim, just from the wrong text.
python3 -c "
import json
d = json.load(open('fragment.json'))
print(len(d), 'entries')          # parses, so it is 'validated'
"
# Schema validation passes. Every field is a string. Every source URL resolves.
# The artifact ships with a fabricated quote in it.
```

## RIGHT

```bash
# Grep every quoted line back to the corpus. Zero hits = fabrication, not a near-miss.
# Match on a distinctive FRAGMENT: exact-string grep fails on smart quotes,
# ellipses and wiki markup even when the line is genuinely present.
python3 - <<'PY'
import json, subprocess, glob, re

CORPUS = "digest/ raw/"                      # scraped text only, never the model's memory
for path in glob.glob("frag-*.json"):
    for e in json.load(open(path)):
        for q in e.get("quotes", []):
            words = re.sub(r"[^\w\s]", " ", q).split()
            probe = " ".join(words[:8])      # 8 words: long enough to be unique,
            if len(words) < 4:               # short enough to survive punctuation drift
                continue
            hit = subprocess.run(
                f'grep -rioF "{probe}" {CORPUS}', shell=True, capture_output=True
            ).stdout
            if not hit:
                print(f"FABRICATED  {path}  {e['name']}: {q[:70]}")
PY
```

```
# Structurally: the writer cannot be its own auditor. Run a separate pass whose
# ONLY job is to disprove the writing, prompted adversarially:
#
#   "Assume there ARE problems and go looking for them; a clean verdict must be earned.
#    For each quoted line, grep the digest and the raw wikitext for a distinctive
#    fragment. A line that appears nowhere is an invented quote and is the single
#    worst defect possible here."
#
# Then a third pass applies the findings and is allowed to REJECT the auditor
# (39 of 222 findings were rejected as wrong on inspection -- auditors overreach too).
```

## NOTES

- **Strip the source-material sections at scrape time, not at write time.** Dropping every "In the books" / "In the novel" / "Differences from the source" section from the digest is necessary but *not sufficient* -- it removes the leak path through the corpus and leaves the one through the model's weights wide open. The Old Nan line proves the second path is live: the fact was absent from every digest and appeared anyway.
- **A zero-hit grep is only evidence if the corpus actually covers the topic.** Same control-query discipline as [Fan-wiki proper nouns are phonetic guesses when the editor works from audiobooks](fan-wiki-phonetic-proper-nouns.md) -- prove the corpus contains the character's page before treating a missing quote as fabricated, or you will "disprove" lines that are simply on a page you failed to fetch.
- **An empty `quotes: []` is a correct answer** and must be stated as acceptable in the brief. Writers fabricate hardest when they believe a field is mandatory.
- **Indirect speech in a plot summary is the trap's bait.** "She retorts that he is a sweet summer child" is genuinely in the source and genuinely about that line, which is exactly what makes the model confident enough to promote it to a verbatim quotation. Paraphrase in the corpus licenses fabrication of the quote it paraphrases.
- **Audit the non-quote fields with the same suspicion.** Heights, ages, hair colour, locations and who-killed-whom all drift toward the source novel, and unlike a quote they cannot be grep-verified -- they need a human-readable claim-by-claim diff against the digest.
- The instruction "the digest wins over your memory, always" was in the brief for every writer that produced these errors. Briefing does not prevent this. Only an independent verification pass does.
