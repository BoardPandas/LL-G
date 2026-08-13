---
tech: typescript
tags: [generics, type-inference, contextual-typing, callbacks, noinfer, api-design]
severity: high
---
# A callback that consumes `T` before the one that produces it collapses the generic to `unknown`

## PROBLEM

When a generic function takes two callbacks and both need their parameter types
from context, TypeScript resolves them in **argument order**. If the callback
that *consumes* `T` is written before the callback that *produces* `T`, then `T`
has no inference candidate when the consumer is checked, so it is fixed to
`unknown` — and the producer's return type is then discarded rather than used.

Two things make this expensive to diagnose:

- **The error appears at the use site, not the call.** `TS18046: 'x.value' is of
  type 'unknown'` or `TS2698: Spread types may only be created from object types`
  fires wherever the result is read, which can be dozens of lines below (or in
  another file) from the signature that actually caused it.
- **It looks intermittent.** It only bites when the producer is
  *context-sensitive* — i.e. it has a parameter needing a contextual type. The
  same API infers correctly when a caller happens to write `async () => ({...})`
  and collapses when the next caller writes `async (tx) => {...}`. Nothing about
  the signature changed.

`NoInfer<T>` does **not** rescue this. `NoInfer` removes a competing inference
*candidate*; here there is no competing candidate, only a producer that is
processed too late to supply one.

Placing a `T`-consuming callback inside the options object is the common way to
walk into this, because options objects idiomatically come first.

## WRONG

```ts
interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }
interface Pool extends Queryable { connect(): Promise<Queryable & { release(): void }> }

type Options<T> = {
  mspId: string
  // Consumes T -- and sits in the options object, which comes first.
  describeOutcome?: (value: T) => { detail?: unknown }
}

declare function withAudit<T>(
  pool: Pool,
  options: Options<T>,                     // checked first: no candidate for T yet
  effect: (tx: Queryable) => Promise<T>,   // produces T, but checked too late
): Promise<{ value: T }>

const audited = await withAudit(
  db,
  { mspId, describeOutcome: (value) => ({ detail: value }) },
  async (tx) => {                          // context-sensitive: `tx` needs a contextual type
    const counted = await tx.query('SELECT count(*) AS total FROM t')
    return { recordCount: Number(counted.rows[0].total) }
  },
)

audited.value.recordCount
//      ~~~~~ TS18046: 'audited.value' is of type 'unknown'

// NoInfer does not help -- the problem is ordering, not a competing candidate:
//   describeOutcome?: (value: NoInfer<T>) => { detail?: unknown }   // still unknown
```

## RIGHT

```ts
// The T-consuming callback becomes a trailing parameter, so it is checked
// AFTER the callback that produces T. Options no longer needs to be generic.
type Options = { mspId: string }
type DescribeOutcome<T> = (value: T) => { detail?: unknown }

declare function withAudit<T>(
  pool: Pool,
  options: Options,
  effect: (tx: Queryable) => Promise<T>,   // produces T, checked first
  describeOutcome?: DescribeOutcome<T>,    // consumes T, checked after
): Promise<{ value: T }>

const audited = await withAudit(
  db,
  { mspId },
  async (tx) => {
    const counted = await tx.query('SELECT count(*) AS total FROM t')
    return { recordCount: Number(counted.rows[0].total) }
  },
  (value) => ({ detail: value.recordCount }),  // fully typed
)

audited.value.recordCount   // number
```

## NOTES

- **Order the parameters so producers precede consumers.** That is the
  structural fix: it cannot be forgotten by a future caller.
- Annotating the producer's parameter (`async (tx: Queryable) => {...}`) also
  fixes it, because an annotated callback is no longer context-sensitive and is
  resolved in the first pass. Do not rely on this — it puts the burden on every
  call site forever, and the failure when someone omits it is the silent one
  above.
- **Under a loose config this can produce no error at all.** If the result is
  spread into an `any`, passed to an untyped consumer, or the project does not
  have `strict` on, `unknown` propagates quietly and you simply lose the types.
  A green build is not evidence the inference worked.
- To confirm the diagnosis in seconds, delete the consuming callback from the
  call. If `T` suddenly infers, the ordering is the cause.
- Reproduced on TypeScript 7.0.2 (the native port) and consistent with the
  documented 5.x context-sensitive inference ordering, so treat it as inherent
  to how inference rounds work rather than a version-specific bug.
