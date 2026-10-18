---
tech: architecture
tags: [api-design, staleness, degraded, empty-result, envelope, search]
severity: high
---
# A staleness flag carried only on result items vanishes on an empty result

## PROBLEM
A search or listing API marks each result item as stale or degraded (`{ results: [{ ..., stale: true }] }`) when the index or source behind it is out of date. On an empty result there is no item to carry the flag, so a query against an unbuilt, failed or out-of-date index returns `{ results: [] }`, exactly what a fresh index with no match returns. The caller concludes "nothing relevant exists" at precisely the moment the answer is least trustworthy. Every test with hits passes; only the miss is wrong.

## WRONG
```ts
return { results: rows.map((row) => ({ ...row, stale: index.behind })) };
// Unbuilt index: { results: [] }, indistinguishable from "no match".
```

## RIGHT
```ts
// State about how the answer was produced goes on the envelope, present on every response.
return {
  results: rows.map(toResult),
  stale: index.behind,
  behind: { docs: { index_sha: index.sha, main_sha: index.mainSha } },
  note:
    rows.length === 0 && index.behind
      ? "No match, but the index is behind its source, so a newer entry may exist."
      : undefined,
};
```
Per-item flags still help when items come from sources in different states, but the envelope must summarise them.

## NOTES
- The same goes for `degraded` (a fallback search path ran), `truncated`, `partial` and "source unavailable": anything about how the answer was produced belongs on the response, not on the things in it.
- Test the empty case against a stale and a never-built index. A test asserting the flag on the first item passes while the empty case is broken.
- Found in review of a knowledge-base search tool, where a miss from a stale or never-built index read as a plain miss.
