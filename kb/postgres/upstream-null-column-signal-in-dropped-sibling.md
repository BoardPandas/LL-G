---
tech: postgres
tags: [etl, crawler, cache, upstream-api, null-column, schema, data-modeling, metrics]
severity: high
---
# An empty cached column can be upstream-null, with the real signal in a sibling field the ETL drops

## PROBLEM

Sibling entry `filter-on-empty-column-matches-nothing.md` covers the symptom: a
column that is NULL corpus-wide makes any predicate on it match nothing. This
entry is about what you do *next*, because the obvious next step is wrong.

On finding such a column in a table cached from an upstream API, the instinct is
"the crawler didn't populate it -- re-crawl." That can be false in a way that
costs a whole feature. There are two very different root causes:

1. The crawler failed to write a value the upstream *did* send. Re-crawling fixes it.
2. **The upstream itself sends `null` for that field, permanently.** Re-crawling
   can never fix it. No amount of operational work will populate that column.

Case 2 has a nasty companion: the real signal is often present in the upstream
payload under a *different* field, which the ETL's upsert silently drops because
that field was never given a column. So the data you need has been arriving on
every single fetch, and being thrown away, for the life of the crawler.

This bites hardest when the empty column has the *most obviously correct name*
for what you want. Building a play-rate metric, `inclusion` is exactly the column
you would reach for -- and it is the dead one, while the live numerator sits in
`num_decks`/`potential_decks`, which the upsert never persisted.

Three signals that you are in case 2, none of which require a re-crawl to check:

- **The upstream payload has the field as null too.** Fetch the raw upstream JSON
  and count nulls. This is the decisive test and it takes one curl.
- **The ETL's upsert column list is missing a field the payload carries.** The
  `INSERT INTO ... (cols)` list is the authoritative record of what is even
  *recoverable* from a re-crawl. Diff it against the upstream payload's keys.
- **No shipped consumer reads the column.** If every existing query in the
  codebase uses a different column for the same concept, the team already routed
  around this years ago without writing it down.

## WRONG

```ts
// The column exists, is correctly typed, and is SELECTed by shipped code.
// Nothing errors. The metric silently computes to 0 for every deck forever.
const rows = await pool.query(
  `SELECT card_name, inclusion FROM edhrec_card_commanders WHERE commander_slug = $1`,
  [slug],
);
const score = rows.rows.reduce((sum, r) => sum + Number(r.inclusion ?? 0), 0);

// ...and when the numbers come back as zeros, the wrong conclusion:
//   "the crawler must be behind -- kick off a re-crawl"
// The re-crawl runs for hours, succeeds, and changes nothing, because the
// upstream sends "inclusion": null on every record and always has.
```

## RIGHT

```bash
# 1. Profile the DB column (the sibling entry's check).
psql -c "SELECT count(*) AS total, count(inclusion) AS present FROM edhrec_card_commanders;"

# 2. DECISIVE: profile the UPSTREAM payload, not just the DB. If upstream is
#    null too, no re-crawl will ever help -- and look for the sibling field
#    that actually carries the signal.
curl -s https://json.edhrec.com/pages/commanders/atraxa-praetors-voice.json \
  | python3 -c '
import json,sys
cvs=[cv for cl in json.load(sys.stdin)["container"]["json_dict"]["cardlists"]
        for cv in cl["cardviews"]]
for f in ("inclusion","num_decks","potential_decks","synergy"):
    print(f, sum(1 for cv in cvs if cv.get(f) is not None), "/", len(cvs))'
# inclusion 0 / 125        <- upstream-null: re-crawling is futile
# num_decks 125 / 125      <- the real numerator, arriving on every fetch
# potential_decks 125 / 125
# synergy 125 / 125
```

```ts
// 3. Confirm what a re-crawl could even recover: read the ETL's upsert column
//    list. `num_decks` is absent -> it is dropped on ingest, so persisting it
//    is a schema + ETL change, NOT an operational one. Scope accordingly.
//    src/server/edhrec/persistence-commanders.ts
`INSERT INTO edhrec_card_commanders
   (card_name, commander_slug, synergy, inclusion, potential_decks, trend_zscore, fetched_at)`
//                                       ^^^^^^^^^ always null
//   num_decks: present upstream, never given a column, silently discarded

// 4. Ship on a column that is actually populated, and isolate the weight
//    behind one function so swapping it later is a one-line change.
function weightOf(card: ConsensusCard): number {
  const raw = Number(card.weight); // today: `synergy`; later: num_decks/potential_decks
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

// 5. Make "no data" distinguishable from "zero". An all-zero weight set must
//    report null, never a confident 0 -- otherwise this bug's next incarnation
//    looks like a real score.
if (denominator <= 0) return { score: null };
```

## NOTES

- **Companion to `filter-on-empty-column-matches-nothing.md`.** That entry tells
  you the column is empty; this one tells you whether it is fixable and where the
  real value went. Read both.
- **The fix classification matters for planning.** "Crawler is behind" is an ops
  ticket. "Upstream sends null and the ETL drops the real field" is a schema
  migration plus an ETL change plus a full re-crawl before any data appears --
  a different phase of work entirely. Misclassifying it turns a one-session
  feature into a blocked one, discovered late.
- **Check what shipped code already uses.** Before trusting a column's *name*,
  grep every existing query against the table. If nothing reads it, that is
  strong evidence it has never carried data. Here, four separate consumers all
  keyed on `synergy` and none on `inclusion`.
- **Beware the well-named dead column.** Empty columns are dangerous in
  proportion to how right their name sounds for your use case -- a plausible name
  suppresses the instinct to verify.
- **Derived-metric corollary:** when a metric divides by a category total, check
  that the categories are densely populated first. Sparse categorical tagging
  (only ~35% of rows tagged) makes every `count / total` land in a narrow band
  near the ceiling, producing an axis that looks computed but cannot
  discriminate. Normalize against the largest category instead, and keep the raw
  share as a separate field.
