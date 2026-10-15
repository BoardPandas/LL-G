---
tech: architecture
tags: [serialization, multiset, multiplicity, cardinality, counters, bounds, overflow, immutable-snapshot]
severity: high
---
# Bounded serializers must count distinct values without expanding multiplicity

## PROBLEM

A multiset stores a distinct value with a quantity, but its ordinary iterator can yield that value once per copy. Sending it through a generic bounded-list serializer confuses quantity with structural complexity. One type with 184 copies becomes 184 list items and fails a 128-item limit, even though its complete representation needs only one type and one integer.

This can stop a passive recorder while the primary workload continues. Small fixtures pass, the recorded prefix looks plausible, and increasing the generic list limit merely moves the failure to a larger quantity. Removing the limit instead makes CPU, memory and output size grow with multiplicity.

In a verified incident, a recorded quantity increased from 120 to 184 immediately before capture stopped. The exact previous packaged serializer accepted 120 and 128 copies but rejected 129 and 184 with `diagnostic_list_limit`. The original exception had not been retained: this establishes a matching serialization boundary and an independent reproduction, not recovery of that missing exception.

## WRONG

```java
List<Object> encode(Iterable<?> values) {
    List<Object> out = new ArrayList<>();
    for (Object value : values) {
        if (out.size() >= 128) throw new IllegalArgumentException("list_limit");
        out.add(encodeOne(value));
    }
    return List.copyOf(out);
}

// A multiset iterator repeats each value according to its count.
encode(counterMultiset); // One type with count 184 fails at item 129.
```

Deduplicating into a set also fails: it fits the bound by silently discarding the quantities.

## RIGHT

Use the source collection's distinct-entry API and copy each identity and count directly. Apply separate limits to distinct types, identity length, numeric range and encoded bytes. The following is pseudocode; the identity and integer bounds must match the actual data contract.

```text
rows = []
for entry in multiset.distinctEntries():
    require rows.length < MAX_DISTINCT_TYPES
    require entry.type is a supported, non-null type
    require entry.count is an integer within 1..MAX_COUNT
    identity = boundedCanonicalIdentity(entry.type)
    rows.append({type: identity, count: entry.count})

sort rows by complete canonical type identity
snapshot = deepImmutableCopy(rows)
require boundedJsonEncode(snapshot) fits MAX_EVENT_BYTES
return snapshot
```

For example, one million copies become `[{"type":"charge","count":1000000}]`, not a million repeated strings. Do not enumerate the copies merely to regroup them afterward: that still incurs the multiplicity-dependent work.

Preserve every distinct type and its exact quantity. A display label alone may merge different identities. If the source already groups by the correct identity, use its stored count without summing all counts. If regrouping is necessary, use checked addition and reject overflow explicitly. Two independently valid large counts must not overflow merely because their combined total exceeds a signed 32-bit integer. For JSON consumers, either keep counts inside the agreed exact integer range or define a decimal-string representation; do not silently round larger integers.

Keep the generic iterable bound for real lists. This is a typed representation change for counted values, not permission to relax limits everywhere. Copy into immutable rows before queueing so later source mutation cannot alter the serialized snapshot. Publish a format version or implementation fingerprint when changing an archive representation, and keep historical data in its original format.

## NOTES

- The corrected production serializer passed **54 assertions**. The same new boundary probe against the exact old packaged classes failed at the 184-copy case, establishing a useful negative control.
- Coverage included quantities 0, 1, 128, 129, 184, one million and the maximum signed 32-bit value; multiple independently large counts; custom types; stable ordering; source and snapshot immutability; invalid counts/types; and 128 versus 129 distinct types. The generic 128-item list limit remained unchanged.
- Quantity-zero may be represented by absence, as in the verified multiset contract. Do not invent a positive-count entry for an absent value. Reject malformed explicit zero or negative entries when that contract forbids them.
- Test the real source collection and the production serializer. A mock that exposes only distinct values cannot reproduce an iterator that expands multiplicity. Keep the serialized-size assertion small enough to prove the quantity was not expanded.
