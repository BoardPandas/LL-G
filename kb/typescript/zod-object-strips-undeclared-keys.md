---
tech: typescript
tags: [zod, schema, validation, data-loss, persistence, round-trip, unknown-keys, silent-failure]
severity: high
---
# Zod `z.object()` strips undeclared keys, erasing them on a load-modify-write round-trip

## PROBLEM

`z.object()` strips unknown keys. That is documented and usually harmless -- until the parsed object is written back to the same store it was read from.

The moment you have a load-through-schema -> mutate -> write cycle, every field that is persisted but NOT declared on the schema is permanently deleted on the first save. There is no error, no warning, and no type error:

- **Zod does not complain.** Stripping is the default success path, not a failure. `safeParse` returns `success: true`.
- **TypeScript does not complain.** The writer that originally produced the field usually builds a loose object literal, a `Record<string, unknown>`, or an `any`-typed shell precisely because the field isn't in the schema -- so nothing is ever checked against the schema on the way in.
- **The reader does not complain.** Consumers read the field with optional chaining and get `undefined`, which is a legal "not set" value.

So the field is written correctly, survives every read that does not go through the schema, and then vanishes the first time any unrelated code path happens to load-and-save that record. The bug surfaces much later as unexplained behavior drift, and it looks like a logic bug in whatever feature depended on the field.

This is the mirror image of [Adding Zod validation at a persisted-data load boundary can brick old data](zod-validation-at-persisted-data-boundary.md). That entry is about a strict schema **rejecting** records it should accept (loud). This one is about a permissive schema **silently discarding** data it should preserve (quiet, and therefore worse).

**Real case (TCG repo, 3.284.4.4).** `officialPrecon`, `gauntletDeck`, `releasedAt`, and `archidektSetCode` were written onto deck manifests by the precon import/sync jobs and read back by the ACL layer to decide which list view a deck belongs to and whether admin triggers are enabled. None of the four were declared on `ProxyDeckManifestSchema`. Any code path that called `parseManifest()` and then wrote the manifest erased all four, demoting an Official Precon to an ordinary deck -- which then leaked into users' personal deck lists and the public gallery and lost its admin gate. The write path used a deliberately loose shell (with a lint suppression noting the schema "never declares" those fields), so the drift was invisible to `tsc`.

## WRONG

```ts
// schema.ts -- four persisted fields are simply not modelled
const DeckManifest = z.object({
  version: z.literal(1),
  slug: z.string(),
  cards: z.array(CardSchema),
  // officialPrecon / gauntletDeck / releasedAt / archidektSetCode: absent
});
export const parseManifest = (d: unknown) => DeckManifest.parse(d);

// precon-import.ts -- writes them anyway, through a loose shell so tsc stays quiet
const manifest: any = { version: 1, slug, cards: [] };
manifest.officialPrecon = true;          // persisted...
manifest.releasedAt = "2024-11-15";
writeJsonAtomic(path, manifest);

// any-unrelated-route.ts -- and silently destroyed here
const m = parseManifest(JSON.parse(readFileSync(path, "utf8")));
m.tags = [...(m.tags ?? []), "new-tag"];  // unrelated edit
writeJsonAtomic(path, m);                 // officialPrecon + releasedAt are GONE

// scope.ts -- now reads undefined, and reports "not a precon" with no error
export const isOfficialPrecon = (d) => d?.officialPrecon === true;  // false forever
```

## RIGHT

```ts
// Declare EVERY persisted field. Optional, so records lacking it still parse
// (see the sibling entry: loosening is safe, tightening bricks old data).
const DeckManifest = z.object({
  version: z.literal(1),
  slug: z.string(),
  cards: z.array(CardSchema),

  // Written by precon-import/sync, read by scope.ts. z.object() STRIPS unknown
  // keys, so omitting these here silently erases them on any parse->write cycle.
  officialPrecon: z.boolean().optional(),
  gauntletDeck: z.boolean().optional(),
  releasedAt: z.string().nullable().optional(),
  archidektSetCode: z.string().nullable().optional(),
});
```

Lock it in with a round-trip test that includes a **control** for the stripping behavior, so the test cannot pass vacuously if someone later switches the schema to `passthrough`/`loose`:

```ts
it("round-trips every persisted field", () => {
  const out = parseManifest({ ...base, officialPrecon: true, releasedAt: "2024-11-15" });
  expect(out.officialPrecon).toBe(true);
  expect(out.releasedAt).toBe("2024-11-15");
});

it("still strips genuinely unknown keys (control)", () => {
  // Without this, the test above would also pass under z.looseObject(),
  // which would hide the fact that the fields are declared at all.
  expect(parseManifest({ ...base, notARealField: "x" })).not.toHaveProperty("notARealField");
});
```

## NOTES

- **How to audit an existing codebase.** Grep for assignments to the persisted object that are NOT in the schema: `grep -rn "manifest\.\w* =" src/` and diff the field names against the schema's keys. Any name that appears in a write but not in the schema is already losing data. Do this before assuming a "missing field" is a logic bug.
- **The tell.** A field the code clearly writes, which readers keep seeing as `undefined`, and a type shim somewhere (`as any`, `& { extraField?: X }`, a `Record<string, unknown>` intersection, or a lint suppression) that exists specifically to let the writer set it. That shim is the marker of schema drift -- the author worked around the schema instead of extending it.
- **Verify the stripping empirically rather than trusting recall of the defaults.** One line settles it for your Zod version: `z.object({a: z.string()}).parse({a: "x", b: "y"})` -> `{a: "x"}`.
- **`z.looseObject()` (v4) / `.passthrough()` (v3) is the wrong global fix here.** It preserves the fields but also silently readmits typos and stale keys forever, and it makes the schema stop describing the data. Prefer declaring fields explicitly; reserve passthrough for genuine pass-through envelopes.
- **Same trap in other validators.** Yup `.noUnknown()`, io-ts exact codecs, `class-transformer`'s `excludeExtraneousValues`, Mongoose's non-strict-mode key dropping, and any `SELECT`-then-`UPDATE` ORM mapping with an incomplete model all destroy undeclared fields on write-back for the same structural reason.
- Related: [Adding Zod validation at a persisted-data load boundary can brick old data](zod-validation-at-persisted-data-boundary.md) (the loud inverse), and [Weak-type parameter rejects a wider interface (TS2559)](weak-type-param-rejects-wider-interface.md) (same two flags, the type-level symptom of the same drift).
