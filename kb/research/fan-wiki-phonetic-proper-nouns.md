---
tech: research
tags: [fan-wiki, fandom, tvtropes, source-verification, proper-nouns, audiobook, goodreads, canon, transcription, corpus-coverage]
severity: high
---
# Fan-wiki proper nouns are phonetic guesses when the editor works from audiobooks

## PROBLEM

For a book series, a Fandom wiki is often the only *structured* source in existence, so it becomes the de facto canon for any research pass. But a wiki maintained by someone who consumed the **audiobook** contains phonetic reconstructions of every proper noun, not spellings. The wiki looks authoritative, is internally consistent in tone, and passes every schema and lint check downstream.

Three tells that this has happened, all visible without reading the front page:

- **Duplicate pages for one entity under variant spellings** (`Jarra` / `Jurra`, `AvaSophia` / `Eva Sophia`, `OttoSherman` / `Autosherman`).
- **An infobox `name=` field that disagrees with its own page title** (page `SueLeeta`, infobox `name=Solita`).
- **A page that admits it is a misspelling while its own body text still uses the wrong name throughout** (page `Liara` says "Misspelling of Bashara"; the `Bashara` page then calls her Liara in every paragraph).

The trap that makes this HIGH rather than MEDIUM is the **false corroboration**. Cross-checking against a second fan source (TV Tropes, a wiki mirror, a review) feels like independent confirmation, but those editors may have copied the wiki, or be working from the same audiobook. Two memory-derived sources agreeing is not evidence. In the real case TV Tropes and the Fandom wiki agreed on `SueLeeta` and it was right, agreed on nothing for `Masterbrook` (Toomen vs Truman vs a review's "Holbrook"), and TV Tropes was *alone in being wrong* on `DumDum` (book text: `Dum Dum`, two words).

Failure mode is silent and durable: a wrong proper noun is written into a dossier, a manifest, a custom card name, and then onto a **physically printed object**. Nothing errors. Nobody notices until someone who has read the book looks at it.

## WRONG

```bash
# Pull the only structured source, treat it as canon.
curl -sL "https://<series>.fandom.com/api.php?action=parse&page=Character&prop=wikitext&format=json" \
     -H "User-Agent: Mozilla/5.0 ..."
# -> "SueLeeta", "Truman Masterbrook", "Kevin", "DumDum"

# "Cross-check" against another fan source, see agreement, call it confirmed.
curl -sL "https://tvtropes.org/pmwiki/pmwiki.php/Literature/<Series>" -H "User-Agent: Mozilla/5.0 ..."

# Ship the names into a durable artifact.
jq '.characters[0].name = "Truman Masterbrook"' dossier.json   # <- unverified, now looks settled

# And the sibling error: conclude a spelling is WRONG from a zero-hit search
# without ever checking the corpus covers the work at all.
curl -s "https://www.googleapis.com/books/v1/volumes?q=%22Toomen%20Masterbrook%22"
# {"totalItems": 0}  ->  "so it must be Truman"      # NO. See RIGHT.
```

## RIGHT

```bash
# 1. Build a VERBATIM-TEXT corpus first. Goodreads quotes and Kindle Notes &
#    Highlights pages are reader-transcribed ebook prose, public, and curl-able.
#    Work IDs come off the book page: grep -o '/work/quotes/[0-9]*' book.html
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
for w in 68973243 71809315 75989224; do
  for p in 1 2 3; do
    curl -sL "https://www.goodreads.com/work/quotes/$w?page=$p" -H "User-Agent: $UA" -o "q-$w-$p.html"
  done
done
curl -sL "https://www.goodreads.com/author/quotes/<author-id>?page=2" -H "User-Agent: $UA" -o q-auth.html

# 2. Extract the quote blocks and grep every candidate spelling against them.
python3 - <<'PY'
import re, html, glob
out, seen = [], set()
for fn in glob.glob('q-*.html'):
    s = open(fn, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'<div class="quoteText">(.*?)</div>', s, re.S):
        t = re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>', '\n', m.group(1)))
        t = html.unescape(t).strip()
        if t[:80] not in seen:
            seen.add(t[:80]); out.append(t)
blob = '\n'.join(out)
for n in ['SueLeeta', 'Solita', 'Toomen', 'Truman', 'Badgelor', 'Badgerlor', 'Dum Dum', 'DumDum']:
    print(f'{n:12} {len(re.findall(re.escape(n), blob))}')
PY

# 3. CRITICAL: a zero-hit only disproves a spelling if the corpus covers the work.
#    Probe coverage with a control query before believing any negative result.
curl -s "https://www.googleapis.com/books/v1/volumes?q=intitle:Noobtown" | jq .totalItems
# 0  -> the SERIES is not indexed at all. Every zero above is "no coverage",
#       NOT "this spelling is absent from the book". Do not conclude anything.

# 4. Record names in two tiers, and never let tier 2 look settled.
#    tier 1: confirmed against verbatim text  -> safe to print
#    tier 2: fan-source only                  -> flagged UNVERIFIED in the artifact itself
```

## NOTES

**Distinguish "absent from the corpus" from "the corpus does not exist."** This is the single highest-value habit here and it generalises far past fan wikis: any negative result from a search API needs a control query proving coverage before it means anything. Google Books returned `totalItems: 0` for every character name *and* for `intitle:<series>` — the series simply is not indexed, so the zeros carried no information at all. Treating them as disconfirmation would have "verified" the wrong spelling with apparent rigour.

**Access notes for the sources involved** (each of these silently fails in a different way):

- Fandom `/wiki/<Page>` HTML is behind a Cloudflare interstitial that returns **HTTP 200 with ~5 KB of nothing**, so a naive tag-strip yields an empty digest rather than an error. Use `api.php?action=parse&prop=wikitext`. Note `prop=extracts` is a Wikipedia extension and is not installed on Fandom.
- TV Tropes returns **403 to most fetchers** but serves fine to `curl` with a browser User-Agent. Strip `<script>` blocks *before* locating the article body, or the extraction swallows inline JS. Its per-book `Funny/` and `Awesome/` subpages carry folder-per-book structure, which is the cheapest way to scope findings to a subset of a series.
- Goodreads **aggregate** notes pages (`/notes/<book-id>`) require sign-in; individual per-reader URLs (`/notes/<book-id>/<user>`) render fine. The `/work/quotes/` and `/author/quotes/` pages are fully public.
- Royal Road and Patreon are worth one check each and usually dead: many LitRPG series were never serialised publicly, and Patreon chapter posts are member-gated.

**Yield in the real case:** 141 unique passages settled 7 of 13 disputed names, disproved 2 spellings that both fan sources had agreed on, and caught a bonus factual error (the wiki reported an in-world term as the canonical name for a power that book text calls something else entirely). The remaining 6 were recorded as explicitly UNVERIFIED rather than guessed — which is the actual deliverable, because a flagged unknown costs a lookup and a confident wrong answer costs a reprint.

Related: `kb/architecture/` on source-of-truth drift, and the general rule that a summary of a source is not the source.
