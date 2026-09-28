---
tech: architecture
tags: [api-design, http-get, read-only, evaluation, background-jobs]
severity: high
---
# GET endpoints can schedule writes, so read-only audits must trace side effects

## PROBLEM
A GET route can look like a safe source for a baseline or evaluation while its cache-fill,
refresh, or background-job path persists data. The HTTP verb and the caller's intent do not make
the full handler chain read-only. A supposedly observational scorecard can silently enqueue work,
replace derived rows, or refresh stored payloads before the baseline is captured, invalidating the
comparison while every request still returns 200.

## WRONG
```js
// "It is a GET, so this production baseline cannot change anything."
const overview = await api.get("/derived/overview");
for (const row of overview.rows) {
	await api.get(`/derived/${row.id}`);
}
```

## RIGHT
```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Export only already-materialized payloads. Report stale/missing rows instead
-- of calling a route whose read path schedules or stores a refresh.
SELECT item_key, corpus_stamp, payload
FROM derived_state
WHERE status = 'ready' AND payload IS NOT NULL
ORDER BY item_key;

COMMIT;
```

## NOTES
Trace the entire handler, including cache misses, stale checks, queue submission, and synchronous
fallbacks, before classifying a route as read-only. For an evaluation baseline, preserve and report
staleness rather than refreshing it away. A database `READ ONLY` transaction is an enforceable
boundary; naming a request GET is not.
