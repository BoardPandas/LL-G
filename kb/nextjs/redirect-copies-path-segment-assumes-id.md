---
tech: nextjs
tags: [redirects, next-config, dynamic-segment, slug, id, query-params]
severity: high
---
# A redirect that copies a path segment into a query parameter assumes the segment is an id

## PROBLEM
A `next.config` redirect can move a dynamic segment into the destination's query: `/organizations/:orgId?tab=devices` to `/devices?org=:orgId`. It copies the raw segment. If the route also accepts a human-readable slug (`/organizations/acme-corp`) that the page resolves to an id at render time, the destination receives `?org=acme-corp`.

The destination treats the parameter as an id, finds nothing, and renders a valid empty list. Nothing errors and nothing is logged. A redirect test passes too, because it asserts the URL the redirect produces, and that URL is exactly what was configured.

## WRONG
```js
// next.config.js
{
  source: '/organizations/:orgId',
  has: [{ type: 'query', key: 'tab', value: 'devices' }],
  destination: '/devices?org=:orgId', // :orgId may be "acme-corp"
  permanent: false,
}
```

## RIGHT
```tsx
// In the page, after the record has resolved to a real id.
const OLD_TABS = { devices: (id) => `/devices?org=${id}`, activity: (id) => `/jobs?org=${id}` }

const identity = useResolvedOrganization(params.orgId) // accepts an id or a slug
useEffect(() => {
  const to = OLD_TABS[tab]
  if (identity.data && to) router.replace(to(identity.data.id))
}, [identity.data, tab])
```

## NOTES
- A config redirect runs before any data is available, so it can only move values, never translate them. Anything that needs a lookup belongs in the page or in a server component that calls `redirect()`.
- Show a loading state while the identity resolves, so the old page does not flash, and do nothing when it cannot be resolved (render the normal not-found state) so the effect cannot loop.
- Add a test that the slug form of the old URL is NOT matched by the redirect table.
- A client-side replace is seen at its old URL by URL observers for one render; see [A client-side redirect page is seen at its old URL by every URL observer](a-client-side-redirect-page-is-seen-at-its-old-url-by-every-url-observer-unlike.md). Prefer a server `redirect()` when the lookup can run on the server.
- Related: [A next.config redirect carries the source query to the destination](a-next-config-redirect-carries-the-source-query-to-the-destination.md).
