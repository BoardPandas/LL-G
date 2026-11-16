---
tech: express
tags: [express, routing, case-sensitivity, deny-list, security, llm-integration, passthrough]
severity: high
---
# A path deny-list in front of Express must fold case like the router

## PROBLEM
Express matches route literals case-insensitively by default (`caseSensitive: false`). A guard in front of it that compares paths exactly can be bypassed. Examples of such guards: a deny-list on an AI tool's REST passthrough, a gateway rule, or a route catalog that maps a path to a template.

In our case, the catalog's case-sensitive matcher read `PUT /v1/portal/settings/INTEGRATIONS` as the open `PUT /v1/portal/settings/:clientId`. Express instead ran the blocked `PUT /v1/portal/settings/integrations` handler, which is registered first. No rule matched, and the request overwrote an integration credential.

A second trap is that Express chooses by registration order, which a catalog does not record. A "most specific template wins" guess can therefore judge a different handler than the one that actually runs.

## WRONG
```ts
const route = catalog.find((r) => r.method === m && matchExact(r.path, path)); // case-sensitive
if (denied(route.path)) refuse();                                            // judges one template
```

## RIGHT
```ts
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();  // as Express does
const candidates = catalog.filter((r) => r.method === m && matchFolded(r.path, path));
if ([...candidates.map((c) => c.path), path].some(denied)) refuse();         // every reachable template
if (!candidates.some((c) => matchExact(c.path, path))) refuse('use the listed case');
```

## NOTES
- Lowercase both sides inside the deny-rule comparison as well.
- Judge the concrete path too, not only the template it matched.
- Test with a recased literal that sits beside a `:param` sibling.
- An adversarial review that tried every capitalisation of every blocked route found the one real bypass.
- Related: [router-guard-by-mount-not-prefix](router-guard-by-mount-not-prefix.md).
