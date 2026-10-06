---
tech: architecture
tags: [spoilers, access-control, testing, data-masking]
severity: high
---
# A spoiler/visibility filter leaks through source lists, and a leak test that greps JSON gives false hits

## PROBLEM
A per-book spoiler mask filtered every content table, yet the exhaustive leak test still found Book 4 names: the sources attached to each record are titled after the pages they cite. Fixing that, the test then flagged ids like `bob` and `crew` that collide with kind/enum values, and names such as 'George' inside a visible 'George Butterworth'.

## WRONG
```ts
expect(JSON.stringify(res)).not.toContain(hidden.id);
expect(JSON.stringify(res)).not.toContain(hidden.name);
```

## RIGHT
```ts
const ids = [...res.entities.map(e => e.id), ...res.relationships.flatMap(r => [r.sourceId, r.targetId])];
expect(ids).not.toContain(hidden.id);
let text = JSON.stringify(res);
for (const v of visibleNames) text = text.replaceAll(v, "");
expect(text).not.toMatch(new RegExp(`\\b${escape(hidden.name)}\\b`));
```

## NOTES
Run it for every mask (2^books), against the real data, not just a fixture.
