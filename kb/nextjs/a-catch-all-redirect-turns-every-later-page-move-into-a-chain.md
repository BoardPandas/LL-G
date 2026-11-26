---
tech: nextjs
tags: [redirects, next-config, catch-all, redirect-chain, url-migration, permanent-redirect]
severity: high
---
# A catch-all redirect turns every later page move under its destination into a two-hop chain

## PROBLEM
A prefix rename is usually done with one catch-all:

```js
{ source: '/account/:path*', destination: '/settings/:path*', permanent: true }
```

That is one hop on the day it ships. But it forwards to *whatever path the
visitor asked for*, so every page under `/settings` that later moves and gets
its own redirect becomes reachable through the catch-all in two hops
(`/account/billing` -> `/settings/billing` -> `/settings/account?tab=billing`),
and the next move makes it three.

Nothing fails. Each redirect is individually correct, a "no chains" test that
compares each destination with the list of sources passes (the catch-all's
destination is a pattern, not a concrete source), and the chain only shows up
in a network trace. If the catch-all is permanent, browsers have cached the
first hop and it can never be removed.

## WRONG
```js
// Years apart, each fine on its own:
{ source: '/account/:path*', destination: '/settings/:path*', permanent: true },
{ source: '/settings/billing', destination: '/settings/account?tab=billing', permanent: true },
```

## RIGHT
```js
// Keep the redirects in one table and repeat every entry whose source sits
// under the catch-all's destination prefix under the OLD prefix too, ahead of
// the catch-all (first match wins), pointing at the final page.
function aliasesUnder(fromPrefix, toPrefix, entries) {
  return entries
    .filter((entry) => entry.source.startsWith(`${fromPrefix}/`))
    .map((entry) => ({ ...entry, source: toPrefix + entry.source.slice(fromPrefix.length) }))
}

const at = entries.findIndex((entry) => entry.source === '/account/:path*')
const redirects = [...entries.slice(0, at), ...aliasesUnder('/settings', '/account', entries), ...entries.slice(at)]
```
```ts
// And make the chain test honest about catch-alls: probe every plain source
// under the destination prefix, but only count it when the catch-all is the
// rule that would really answer the corresponding request.
const request = sourcePrefix + other.source.slice(destinationPrefix.length)
if (resolve(request, redirects)?.rule === catchAll) probes.push(other.source)
```

## NOTES
- Generating the aliases from the table means a redirect added later is covered
  without anyone remembering the catch-all exists.
- Copy conditional (`has`) entries too, keeping their order, so a
  tab-specific redirect still precedes the general one for the same path.
- An alias inherits the permanence of the entry it copies. A visitor whose
  browser cached the old permanent first hop still takes two hops; new visitors
  take one.
- Related: `a-next-config-redirect-carries-the-source-query-to-the-destination.md`.
