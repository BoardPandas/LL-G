---
tech: nextjs
tags: [redirects, next-config, query-string, has, tabs, url-migration]
severity: high
---
# A next.config redirect carries the source query to the destination, including the key that `has` matched

## PROBLEM
`redirects()` in `next.config.js` does not drop the incoming query string. The
source query is appended to the destination, and where both carry the same key
the destination's value wins. A key matched by a `has` condition is carried
over as well.

So a redirect written to move one tab of a page somewhere else delivers the old
tab id to the new page:

- `/settings/account?tab=account` -> destination `/settings/my-notifications`
  arrives as `/settings/my-notifications?tab=account`.
- `/old?tab=foo&x=1` -> destination `/new?tab=bar` arrives as
  `/new?tab=bar&x=1`. The destination's `tab` wins, but it keeps the position
  the key had in the source query, so string comparisons of the final URL that
  assume "destination params first" fail.

Nothing errors. The destination page opens, reads a `tab` value it has never
heard of, and either shows the wrong tab, shows nothing, or writes the stale
value back into its own URL. A test that asserts only the config entry
(`destination: '/new'`) passes while the real Location header differs.

## WRONG
```js
// next.config.js
{ source: '/settings/account', has: [{ type: 'query', key: 'tab', value: 'account' }],
  destination: '/settings/my-notifications', permanent: false }
```
```tsx
// The destination trusts whatever ?tab= says.
const tab = searchParams.get('tab') ?? 'general'   // 'account' -> renders no panel
```

## RIGHT
```tsx
// Every page that reads ?tab= validates it against the tabs it actually has.
const requested = searchParams.get('tab')
const tab = requested && ALLOWED.includes(requested) ? requested : DEFAULT_TAB
```
```js
// When the old value must not leak, set the key on the destination: its value wins.
{ source: '/settings/persona', has: [{ type: 'query', key: 'tab', value: 'support' }],
  destination: '/settings/support-grants?tab=impersonation', permanent: false }
```
```ts
// Test the final URL, not the config entry. Resolve it the way Next does:
// first match in array order, `has` checked against the query, then
// { ...sourceQuery, ...destinationQuery }.
expect(resolve('/settings/blacklists?tab=foo&x=1')).toBe('/settings/email?tab=blocked&x=1')
```

## NOTES
- Verified on Next 16 against `next dev` with `curl -D -`, and in
  `next/dist/shared/lib/router/utils/prepare-destination.js`
  (`{ ...args.query, ...parsedDestination.query }`).
- This is also what makes `?org=7` or `?template=x` survive a redirect for
  free, so it is usually wanted. The hazard is only the destination that does
  not validate.
- A redirect from `/page?tab=old` to `/page?tab=new` (same path) is not a loop:
  the conditional source no longer matches once the destination's value has
  replaced the old one.
- Related: `search-params-stale-after-replace.md` (keep the open tab in state
  rather than reading it back from `useSearchParams()`).
