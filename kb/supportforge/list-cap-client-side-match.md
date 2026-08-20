---
tech: supportforge
tags: [pagination, list-endpoint, personas, client-side-filter, react-query, msp-scope, silent-failure]
severity: high
---
# A capped list endpoint plus client-side matching is a record that vanishes past the cap

## PROBLEM

`GET /v1/personas/list` clamps `limit` to 200 (`Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)`) and orders by `persona_updated_at DESC NULLS LAST, eu.id DESC`. Three dashboard pages asked it for `?limit=200` with no filter and then found their record in the browser: the person record matched on id or email, the organization People tab and its people count matched on organization name.

That works until the MSP has more than 200 people with a portrait. WellForce had 336 (the sidebar's People count uses the same `c.msp_id = $1 AND eu.persona_portrait IS NOT NULL` predicate, so it is the honest total), which left 136 people unreachable through their own record and made whole organizations read as empty accounts.

The tell is an asymmetry that points away from the real cause. The search palette sends `?search=<q>&limit=6`, so the server ILIKEs across every row and finds the person; the record the palette links to then scans a capped page and does not. Search works, the record says "Person not found", and the empty state offers two wrong explanations ("may belong to an organization you cannot see, or have no persona profile yet") -- so the investigation goes to MSP scoping or persona generation. Nothing is logged, no request fails, and the API returns 200 with a well-formed page every time. Ordering by `persona_updated_at` also means the victims are whoever has been quiet longest, which reads like stale data rather than pagination.

Two traps ride along with the fix:

- All three pages shared the react-query key `['people', 'list']` because they shared one URL. Give a page a narrower URL without a narrower key and its one-row payload lands in the cache the other pages read.
- The org tab keyed and linked on `user.id`, which this endpoint never returns (it maps `user_id: r.id`), so every row pointed at `/people/undefined`. Client-side matching is what hid it: a filter over a field name that does not exist returns fewer rows, never an error.

## WRONG

```ts
// Server: the only filter is a fuzzy search, so a caller holding an exact id
// has no way to ask for one row.
const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
if (search) {
  params.push(`%${search}%`);
  searchClause = `AND (eu.name ILIKE $${params.length} OR eu.email ILIKE $${params.length})`;
}

// Client: fetch a page, find the record in the browser.
const { data } = useQuery({
  queryKey: ['people', 'list'],           // shared by three differently-scoped pages
  queryFn: async () => (await fetch('/api/v1/personas/list?limit=200')).json(),
})
const person = data?.items?.find((p) => String(p.user_id) === personId)
const users  = (data?.items ?? []).filter((u) => u.organization === orgName)
const count  = users.length                // "0 people" for an org past the cap
```

## RIGHT

```ts
// Server: exact-identity filters alongside the fuzzy one, built through the same
// params array so placeholder indexes stay in step.
if (userIdParam) {
  const userId = Number(userIdParam);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'invalid user_id' });
  }
  params.push(userId);
  filters.push(`AND eu.id = $${params.length}`);
}
if (emailParam) {
  params.push(emailParam.toLowerCase());
  filters.push(`AND LOWER(eu.email) = $${params.length}`);
}
if (clientIdParam) {                       // the msp_id predicate still applies
  params.push(clientIdParam);
  filters.push(`AND eu.client_id = $${params.length}`);
}

// Client: ask for the one record, under its own cache key.
const lookup = /^\d+$/.test(segment) ? `user_id=${segment}` : `email=${encodeURIComponent(segment)}`
const { data } = useQuery({
  queryKey: ['people', 'record', segment],
  queryFn: async () => (await fetch(`/api/v1/personas/list?limit=1&${lookup}`)).json(),
})
const person = data?.items?.[0]

// A count is the server's `total` (the endpoint's COUNT(*) runs under the same
// filters), never the length of the page that came back.
const peopleCount = data?.total ?? 0
```

## NOTES

- The general rule, beyond this endpoint: a list endpoint that caps `limit` owes callers an exact-identity filter, because otherwise every detail view is a scan whose correctness depends on a row's position. If you cannot add the filter, the caller must page until it finds the record, not assume one page is the set.
- Never render a count from `items.length` when the response carries `total`. The two agree only while nothing is truncated, which is exactly when the bug is invisible.
- When a list is deliberately truncated in the UI, say so on screen ("Showing the first N of M"). Silence is what turned this into a bug report rather than a known limit.
- Symptom triage: if server-side search finds a record but its detail page does not, suspect the detail page's fetch shape before suspecting tenancy or permissions. Compare the two request URLs first.
- Fixed 2026-08-20 in supportforge-platform (`/v1/personas/list` gained `user_id`, `email`, `client_id`; person record and org People tab rewritten). Related: [single-key ticket aggregates undercount](single-key-ticket-aggregates-undercount.md) and [org "user" counts are recent requesters](org-user-counts-are-recent-requesters.md) -- the same family, a query whose scope is narrower than the question being asked.
