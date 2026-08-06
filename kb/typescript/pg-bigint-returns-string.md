---
tech: typescript
tags: [postgres, node-postgres, pg, bigint, bigserial, types, silent-failure, database, identity, set-lookup, sqlite, multi-driver, audit]
severity: high
---
# node-postgres returns BIGINT as a string, so `id: number` is a lie tsc cannot catch

## PROBLEM

`pg` (node-postgres) parses `int2`/`int4` into JS numbers but leaves `int8`
(`BIGINT`, `BIGSERIAL`) as a **string**, because a 64-bit integer does not fit
in a JS number without possible precision loss. It does this by default, in
every process, with no warning.

Hand-written row interfaces almost always declare `id: number`. That
annotation is never checked against anything: `pool.query<Row>(...)` is a
generic the caller supplies, so TypeScript takes your word for it. The
declared type and the runtime type disagree, `tsc` is green, and every review
reads the interface as truth.

What makes it *silent* rather than merely wrong is that the two operations you
reach for most still appear to work:

| Operation | With `"705"` | Looks right? |
|---|---|---|
| `a - b`, `>`, `>=`, `<` | numeric coercion | **yes** — sorting and comparisons behave |
| `` `${id}` ``, `WHERE id = $1` | stringifies / pg accepts | **yes** — templates and queries work |
| `set.has(id)`, `map.get(id)` | never matches a number key | **no — silently empty** |
| `id === 705`, `arr.find(x => x.id === n)` | always false | **no — silently empty** |
| `a + b` | `"1" + "2" === "12"` | **no — concatenates** |

So the failure only appears where a lookup or an identity comparison happens,
and it appears as *"nothing matched"* — indistinguishable from a legitimately
empty result. This shipped in a disk-reclamation sweep: a `Set<number>` of live
ids matched **zero** of 430 files, so 402 live thumbnails were classified as
orphans and queued for deletion. Every number the tool printed looked
plausible. It was caught only because an independent shell/SQL count of the
same thing disagreed.

The precision danger is real too, and worse than a wrong lookup: `Number()`-ing
an id past 2^53 silently rounds it, so the query addresses **a different row**
rather than failing.

## WRONG

```ts
interface ExampleRow {
  id: number;              // BIGSERIAL -- pg actually hands back "705"
  cover_id: number | null; // BIGINT    -- ditto
  apply_count: number;     // BIGINT    -- ditto
}

const { rows } = await pool.query<ExampleRow>(`SELECT id FROM examples`);
const live = new Set(rows.map((r) => r.id));   // Set<string> at runtime!

// Parse "705-320.png" -> 705, then ask whether the row is still alive.
const id = Number(filename.split("-")[0]);
if (!live.has(id)) {
  await unlink(path);   // ALWAYS taken: Set<string>.has(number) is never true
}

// Same shape, same silence:
const row = rows.find((r) => r.id === Number(req.params.id));  // never matches

// And an id past 2^53 is rounded to a DIFFERENT existing id:
Number("9007199254740993");  // -> 9007199254740992
```

## RIGHT

```ts
// 1. Tell the truth about identities. They are opaque handles, not arithmetic.
interface ExampleRow {
  id: string;
  cover_id: string | null;
}

const live = new Set(rows.map((r) => r.id));   // Set<string>, honestly typed
const id = parseBigIntId(filename.split("-")[0]);
if (id && !live.has(id)) await unlink(path);   // string vs string

// 2. Validate ids as digit-strings. Never round-trip through Number().
export function parseBigIntId(raw: string | null | undefined): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const normalized = raw.replace(/^0+(?=\d)/, ""); // "007" and "7" are one row
  return normalized === "0" ? null : normalized;   // BIGSERIAL starts at 1
}

// 3. For small COUNTERS that genuinely want to be numbers, cast in SQL so the
//    declared `number` becomes true at the source. Safe here precisely because
//    it would be wrong for an id: a per-row counter cannot approach 2^53.
await pool.query<{ apply_count: number }>(
  `SELECT apply_count::int AS apply_count FROM styles WHERE id = $1`, [id],
);

// 4. If the same table is served by MORE THAN ONE driver, no single scalar type
//    is true -- SQLite hands back a real number for INTEGER, pg a string for
//    BIGINT. Type the RAW row as the honest union and normalize in one mapper,
//    so callers downstream see a single type and nobody re-derives it.
interface RawRoomRow { seq: number | string }   // sqlite | postgres
interface Room       { seq: number }            // what callers actually get

const rowToRoom = (r: RawRoomRow): Room => ({ seq: Number(r.seq) });
// `seq + 1` is now safe. On the raw row it would have been "5" + 1 === "51".
```

Do not "fix" this globally with `pg.types.setTypeParser(20, Number)`. That flips
**every** int8 in the process at once — ms-epoch timestamps, monotonic `seq`
columns, counters — including code already written against strings, and it
reintroduces the >2^53 truncation everywhere instead of in one place.

## NOTES

- **Verify, do not infer.** Reading the DDL tells you the column is `BIGINT`; it
  does not tell you what your pool returns, because a `setTypeParser` anywhere
  in the import graph changes the answer. Probe the real pool:
  ```ts
  const r = await pool.query(`SELECT id, apply_count FROM t LIMIT 1`);
  for (const [k, v] of Object.entries(r.rows[0])) console.log(k, typeof v);
  ```
- **Audit by column type, not by symptom, and enumerate from the DATABASE.**
  `schema.sql` misses every column added by a migration, by an auth library, or
  by hand, so grepping it under-reports:
  ```sql
  SELECT table_schema||'.'||table_name||'.'||column_name
    FROM information_schema.columns
   WHERE data_type = 'bigint'
     AND table_schema NOT IN ('pg_catalog','information_schema');
  ```
  Then state the arithmetic, or "no findings" means nothing: one audit found 44
  columns, of which 24 belonged to the `pg_stat_statements` extension view and
  were not modeled in TS, leaving 20 real ones — 7 lying, 13 correct.
- **Look in SINGLE-DRIVER code first — that is where the lie lives.** In a
  codebase where the same row type is served by *both* a SQLite and a Postgres
  driver, this bug is systematically ABSENT. It has to be: SQLite returns a
  number and pg returns a string for the same logical column, so the author
  could not avoid noticing, and what they wrote is pattern 4 above. Postgres-only
  code is where nothing forces the question. Across 20 audited columns every
  single lie was in Postgres-only code, and every dual-driver table was already
  correct — so audit by *how many drivers a table has*, not by how important it
  looks.
- **Fixing the shared interface does not finish the job.** `pool.query<T>()` takes
  the generic per call, so a call site can restate the lie inline —
  `client.query<{ id: number }>(...)` — and keep compiling after the interface is
  corrected. Sweep for the inline form too:
  ```
  grep -rnE 'query<\{[^}]*\bid: number\b' src/
  ```
- **Belt and braces, where it matters.** The most robust store audited did both:
  typed the id `string` AND selected `id::text`, so the row is a string even if
  someone later registers a type parser. Its SQLite twin types the same field
  `number`, and both normalize to one public `string`.
- **A defensive coercion at a boundary is a tell.** Client code doing
  `Number(raw.apply_count) || 0` means someone already met the string on the
  wire and patched it locally instead of at the type. Grep for that pattern —
  it points straight at the mistyped fields.
- Same trap, other drivers: `mysql2` returns `BIGINT` as a string when
  `supportBigNumbers` is on, and `better-sqlite3` returns `BigInt` (not
  `number`) once `safeIntegers` is enabled. Both are silent in the same way.
- Related: [Type assertions with as](type-assertions.md) — the same root cause,
  a type the compiler was told to trust and never verified.
  [Number(null) silently coerces null/empty to 0](number-null-coercion.md) —
  the `Number()` half of this failure.
