---
tech: typescript
tags: [acl, authorization, joins, maps, identity, data-leak]
severity: high
---
# Joining ACL summaries to usage by a nonunique key leaks private data

## PROBLEM

A listing can combine authorization-filtered summaries with usage metadata loaded
from a second source. If both are joined through a nonunique display key such as a
slug, a `Map<slug, usage>` silently keeps only the last record. The later loop can
authorize one public summary and serialize the usage that belongs to a different,
private record with the same slug. Every individual ACL check passes, so the result
looks authorized while exposing private data.

## WRONG

```ts
const usageBySlug = new Map<string, Usage>();
for (const manifest of manifests) {
  usageBySlug.set(manifest.slug, usageFor(manifest));
}

return visibleSummaries.flatMap((summary) => {
  if (!canRead(viewer, summary)) return [];
  const usage = usageBySlug.get(summary.slug);
  return usage ? [{ ...summary, usage }] : [];
});
```

## RIGHT

```ts
const candidates = manifests.map((manifest) => ({
  summary: summaryFor(manifest),
  usage: usageFor(manifest),
}));

const seen = new Set<string>();
return candidates.flatMap(({ summary, usage }) => {
  if (!canRead(viewer, summary)) return [];
  if (seen.has(summary.id)) return [];
  seen.add(summary.id);
  return [{ ...summary, usage }];
});
```

## NOTES

- Keep each authorization subject paired with the derived data from the same
  authoritative record until after the ACL check. Do not rebuild that pair by a
  display key unless uniqueness is enforced at storage and validated at load time.
- A regression fixture needs two records with the same slug/key, one visible and
  one private, and must assert that the visible result never contains the private
  record's derived fields. Include a same-record control so the test cannot pass by
  dropping all usage.
- This is a data-join defect, not an ACL-policy defect. Deduplicate only after
  authorization and preserve a stable internal identity for the dedupe key.
