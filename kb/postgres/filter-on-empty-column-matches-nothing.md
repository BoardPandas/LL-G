---
tech: postgres
tags: [null-handling, data-assumptions, silent-failure, filtering, thresholds, verification, schema-drift, etl]
severity: high
---
# A column that exists but is NULL corpus-wide makes any filter on it silently match zero rows

## PROBLEM

Reading a schema is not the same as reading the data. A column can exist, be correctly typed, be populated by the ORM/model layer, be `SELECT`ed by shipped code, and still be **NULL on every single row** — because the writer that was supposed to fill it never ran, was removed, or only ever populated a sibling column.

The moment you build a predicate on that column, the failure is completely silent:

- `WHERE col <= $1` matches **nothing**. Not an error — an empty result set.
- `ORDER BY col DESC` degenerates to arbitrary order (and see the NULLS FIRST trap in `order-by-desc-nulls-first.md`).
- An aggregate like `AVG(col)` returns NULL, which then propagates through every downstream calculation.

Every layer above reports success. The endpoint returns HTTP 200. The response envelope echoes your new parameter back. Tests written against a mock or a hand-seeded fixture pass, because the fixture has values the real table does not. The feature ships and looks fine to everyone except the user, who just gets an empty list forever.

What makes this a *high* severity trap rather than a rookie mistake is that the existing code actively misleads you. If a shipped read path already `SELECT`s the column, coerces it, and hands it to a formatter, that is strong circumstantial evidence the column has data. It isn't evidence at all — passing NULL through a coercion helper is indistinguishable from passing a value through it.

Real case: a card co-occurrence table had columns `lift`, `inclusion`, and `potential_decks`. Shipped code selected `inclusion`, normalised it through a percent helper, and rendered it. A new feature was designed around `WHERE inclusion <= $threshold` to find "rarely played" rows. Querying the deployed endpoint and reading the actual rows showed `inclusion` was NULL on all of them — only `lift` and `potential_decks` were ever written by the crawler. The filter would have returned an empty list in production, permanently, with no error anywhere. The fix was to derive the same signal from a different column that demonstrably held data.

## WRONG

```sql
-- The column exists in the schema and shipped code SELECTs it,
-- so it must have data... right?
SELECT related_card, lift, inclusion
  FROM edhrec_card_relations
 WHERE lower(card_name) = lower($1)
   AND inclusion <= $2          -- NULL <= 0.10 is NULL, never true
 ORDER BY lift DESC NULLS LAST
 LIMIT $3;
-- Returns 0 rows. Always. No error, no warning, HTTP 200.
```

```bash
# "Verifying" the deploy by checking the status code and the echoed params.
# This passes even when the query matches nothing.
curl -s -o /dev/null -w '%{http_code}' "$API/relations?mode=outlier"   # 200 -> ship it
```

## RIGHT

```sql
-- Step 1: BEFORE designing the predicate, profile the column against real data.
SELECT count(*)                                   AS total,
       count(inclusion)                           AS inclusion_present,   -- count(col) skips NULLs
       count(lift)                                AS lift_present,
       min(inclusion), max(inclusion)
  FROM edhrec_card_relations;
--  total | inclusion_present | lift_present | min | max
-- -------+-------------------+--------------+-----+-----
--  91442 |                 0 |        91442 |     |
--                           ^ the column is empty corpus-wide; do not filter on it.
```

```sql
-- Step 2: build the predicate on a column that demonstrably holds data.
-- Here, obscurity comes from the joined card's global rank, not from `inclusion`.
SELECT r.related_card, r.lift, r.inclusion
  FROM edhrec_card_relations r
  JOIN LATERAL (
    SELECT edhrec_rank FROM cards
     WHERE lower(name) = lower(r.related_card) AND lang = 'en'
     ORDER BY released_at DESC NULLS LAST
     LIMIT 1
  ) c ON true
 WHERE lower(r.card_name) = lower($1)
   AND c.edhrec_rank IS NOT NULL
   AND c.edhrec_rank >= $2
 ORDER BY r.lift DESC NULLS LAST
 LIMIT $3;
```

```bash
# Step 3: verify against the deployed system by reading the DATA, not the status
# code. Prove the predicate actually discriminates -- compare filtered vs unfiltered.
curl -s "$API/relations?limit=25"                  | jq '[.data.cards[].edhrec_rank] | min'  # 1559
curl -s "$API/relations?limit=25&mode=outlier"     | jq '[.data.cards[].edhrec_rank] | min'  # 2384
# Different minima => the filter is doing work. Identical output => it is a no-op.
```

```sql
-- Step 4: encode the finding so nobody re-derives it. A comment on the column
-- outlives any commit message or code comment.
COMMENT ON COLUMN edhrec_card_relations.inclusion IS
  'NULL corpus-wide: the crawler only writes lift + potential_decks. '
  'Selected for shape compatibility only -- never filter or sort on this.';
```

## NOTES

- **`count(col)` vs `count(*)` is the one-liner for this.** `count(col)` skips NULLs, so `count(col) = 0` alongside a nonzero `count(*)` proves the column is empty without scanning it by eye. Run it on every column you plan to put in a `WHERE`, `ORDER BY`, `JOIN ... ON`, or aggregate.
- **A green test suite does not protect you.** Unit tests that mock the pool, or integration tests against a hand-seeded fixture, both supply values the production table lacks. The only thing that catches this is real data. Where the query is built dynamically, assert the *SQL structure* in unit tests and verify the *data* against a real database — they catch different bugs.
- **Verifying a deploy by status code is the sibling mistake.** HTTP 200 with an empty array is the exact shape this failure takes. So is a response envelope that faithfully echoes your new `mode=outlier` parameter while the query underneath matches nothing. Always diff filtered against unfiltered output and confirm the results actually differ.
- **This generalises past NULL.** Same trap for a column that is entirely `0`, entirely `''`, or entirely a default sentinel — and for a column whose values are in a different *shape* than you assume (a fraction `0.1` where you expected a percent `10`, so `<= 10` matches everything instead of nothing). Profile `min`/`max`/`count(distinct)` before trusting a threshold.
- **Suspect ETL-populated and enrichment tables first.** Columns written by a crawler, scraper, nightly sync, or third-party import are the usual offenders: the schema is designed for the full upstream payload, then the writer is scoped down to the subset actually needed and the rest are never backfilled.
- Related: `order-by-desc-nulls-first.md` — the same nullable column bites again at sort time, where `DESC` defaults to `NULLS FIRST` and floats the empty rows to the top instead of dropping them.
